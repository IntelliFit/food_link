#!/usr/bin/env python3
"""
Build or publish Android mobile release artifacts to Tencent COS.

Config is loaded from Apollo namespace release-config.yaml by default:

storage:
  cos_region: ap-beijing
  cos_secret_id: ...
  cos_secret_key: ...
  release_bucket: foodlink-releases-1370036754
  release_cdn_base_url: https://download.healthymax.cn

Examples:
  python scripts/release_mobile_android.py
  python scripts/release_mobile_android.py --dry-run
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urljoin, urlparse

import requests
import yaml

ROOT = Path(__file__).resolve().parents[1]
APOLLO_CONFIG_FILE = ROOT / "backend" / "apollo-config.yaml"
MOBILE_APP_JSON = ROOT / "apps" / "mobile" / "app.json"
MOBILE_DIR = ROOT / "apps" / "mobile"
DEFAULT_DIST = ROOT / "dist" / "mobile-release"

CHANNELS = {
    "beta": ["beta"],
    "stable": ["stable"],
    "latest": ["latest"],
    "all": ["beta", "stable"],
}

BRANCH_RELEASES = {
    "dev": {
        "channel": "beta",
        "eas_profile": "preview",
        "api_base_url": "https://dev.api.healthymax.cn",
        "release_name": "体验版",
    },
    "main": {
        "channel": "stable",
        "eas_profile": "production",
        "api_base_url": "https://api.healthymax.cn",
        "release_name": "正式版",
    },
}


def fail(message: str) -> None:
    raise SystemExit(message)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def apollo_auth_headers(request_url: str, app_id: str, secret: str) -> dict[str, str]:
    parsed = urlparse(request_url)
    path_with_query = parsed.path
    if parsed.query:
        path_with_query += "?" + parsed.query
    timestamp = str(int(time.time() * 1000))
    signature = base64.b64encode(
        hmac.new(secret.encode(), f"{timestamp}\n{path_with_query}".encode(), hashlib.sha1).digest()
    ).decode()
    return {
        "Authorization": f"Apollo {app_id}:{signature}",
        "Timestamp": timestamp,
    }


def unescape_java_properties_value(value: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(value):
        ch = value[i]
        if ch != "\\" or i == len(value) - 1:
            out.append(ch)
            i += 1
            continue
        i += 1
        mapping = {"n": "\n", "r": "\r", "t": "\t", "f": "\f", "\\": "\\"}
        out.append(mapping.get(value[i], value[i]))
        i += 1
    return "".join(out)


def decode_apollo_raw_config_body(body: str) -> str:
    content = body.strip()
    if content.startswith("content="):
        content = content[len("content=") :]
        content = unescape_java_properties_value(content)
    return content.strip()


def load_release_config_from_apollo(namespace: str) -> dict[str, Any]:
    if not APOLLO_CONFIG_FILE.exists():
        fail(f"Apollo config file not found: {APOLLO_CONFIG_FILE}")

    apollo_cfg = yaml.safe_load(APOLLO_CONFIG_FILE.read_text(encoding="utf-8")).get("apollo") or {}
    base = str(apollo_cfg.get("config_server_url", "")).rstrip("/") + "/"
    app_id = str(apollo_cfg.get("app_id", ""))
    cluster = str(apollo_cfg.get("cluster", ""))
    secret = str(apollo_cfg.get("access_key_secret", ""))
    if not all([base, app_id, cluster]):
        fail("backend/apollo-config.yaml is missing config_server_url, app_id, or cluster")

    rel = f"configfiles/{app_id}/{cluster}/{namespace}"
    request_url = urljoin(base, rel) + "?" + urlencode({"ip": "127.0.0.1"})
    headers = apollo_auth_headers(request_url, app_id, secret) if secret else {}
    response = requests.get(request_url, headers=headers, timeout=20)
    response.raise_for_status()
    content = decode_apollo_raw_config_body(response.text)
    config = yaml.safe_load(content) or {}
    return config if isinstance(config, dict) else {}


def resolve_release_config(namespace: str) -> dict[str, str]:
    release_config = load_release_config_from_apollo(namespace)
    storage = release_config.get("storage") or {}
    expo = release_config.get("expo") or {}
    eas = release_config.get("eas") or {}
    android_signing = release_config.get("android_signing") or {}
    resolved = {
        "secret_id": os.getenv("COS_SECRET_ID", storage.get("cos_secret_id", "")).strip(),
        "secret_key": os.getenv("COS_SECRET_KEY", storage.get("cos_secret_key", "")).strip(),
        "region": os.getenv("COS_REGION", storage.get("cos_region", "ap-beijing")).strip(),
        "bucket": os.getenv("COS_RELEASE_BUCKET", storage.get("release_bucket", "")).strip(),
        "cdn_base": os.getenv("CDN_RELEASE_BASE_URL", storage.get("release_cdn_base_url", "")).strip().rstrip("/"),
        "expo_token": os.getenv(
            "EXPO_TOKEN",
            expo.get("token") or expo.get("access_token") or eas.get("expo_token") or eas.get("token") or "",
        ).strip(),
        "android_keystore_path": os.getenv(
            "FOODLINK_ANDROID_KEYSTORE_PATH",
            android_signing.get("keystore_path") or "foodlink-release.keystore",
        ).strip(),
        "android_keystore_password": os.getenv(
            "FOODLINK_ANDROID_KEYSTORE_PASSWORD",
            android_signing.get("keystore_password") or "",
        ).strip(),
        "android_key_alias": os.getenv(
            "FOODLINK_ANDROID_KEY_ALIAS",
            android_signing.get("key_alias") or "foodlink-release",
        ).strip(),
        "android_key_password": os.getenv(
            "FOODLINK_ANDROID_KEY_PASSWORD",
            android_signing.get("key_password") or android_signing.get("keystore_password") or "",
        ).strip(),
    }
    optional = {
        "expo_token",
        "android_keystore_path",
        "android_keystore_password",
        "android_key_alias",
        "android_key_password",
    }
    missing = [key for key, value in resolved.items() if key not in optional and not value]
    if missing:
        fail(f"release config missing required fields: {', '.join(missing)}")
    return resolved


def run(cmd: list[str], cwd: Path = ROOT, extra_env: dict[str, str] | None = None, capture_output: bool = True) -> str:
    executable = shutil.which(cmd[0])
    if executable:
        cmd = [executable, *cmd[1:]]
    print("+", " ".join(cmd))
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    if capture_output:
        completed = subprocess.run(
            cmd,
            cwd=cwd,
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
    else:
        completed = subprocess.run(cmd, cwd=cwd, env=env)
    if completed.returncode != 0:
        if capture_output:
            print(completed.stdout)
        fail(f"command failed with exit code {completed.returncode}: {' '.join(cmd)}")
    return completed.stdout if capture_output else ""


def find_java_home() -> str | None:
    current = os.getenv("JAVA_HOME", "").strip()
    if current and (Path(current) / "bin" / ("java.exe" if os.name == "nt" else "java")).exists():
        return current
    if shutil.which("java"):
        return None
    if os.name == "nt":
        candidates = [
            Path("C:/Program Files/Eclipse Adoptium"),
            Path("C:/Program Files/Java"),
            Path("C:/Program Files/Android/Android Studio/jbr"),
        ]
        for candidate in candidates:
            if candidate.name == "jbr" and (candidate / "bin" / "java.exe").exists():
                return str(candidate)
            if candidate.exists():
                for java in sorted(candidate.glob("**/bin/java.exe"), reverse=True):
                    return str(java.parents[1])
    return None


def find_android_sdk_root() -> str | None:
    for env_name in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        current = os.getenv(env_name, "").strip()
        if current and (Path(current) / "platform-tools").exists():
            return current
    if os.name == "nt":
        local_app_data = os.getenv("LOCALAPPDATA", "").strip()
        candidates = [
            Path(local_app_data) / "Android" / "Sdk" if local_app_data else None,
            Path("C:/Android/Sdk"),
            Path("C:/Program Files/Android/Sdk"),
        ]
    else:
        home = Path.home()
        candidates = [
            home / "Android" / "Sdk",
            home / "Library" / "Android" / "sdk",
            Path("/opt/android-sdk"),
        ]
    for candidate in candidates:
        if candidate and (candidate / "platform-tools").exists():
            return str(candidate)
    return None


def write_android_local_properties(android_dir: Path, sdk_root: str) -> None:
    escaped = sdk_root.replace("\\", "\\\\").replace(":", "\\:")
    (android_dir / "local.properties").write_text(f"sdk.dir={escaped}\n", encoding="utf-8")


def write_gradle_mirror_init_script() -> Path:
    init_script = DEFAULT_DIST / "gradle-maven-mirrors.init.gradle"
    init_script.parent.mkdir(parents=True, exist_ok=True)
    init_script.write_text(
        """
settingsEvaluated { settings ->
  settings.pluginManagement.repositories {
    maven { url = uri('https://maven.aliyun.com/repository/gradle-plugin') }
    maven { url = uri('https://maven.aliyun.com/repository/google') }
    maven { url = uri('https://maven.aliyun.com/repository/central') }
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

allprojects { project ->
  buildscript.repositories {
    maven { url = uri('https://maven.aliyun.com/repository/google') }
    maven { url = uri('https://maven.aliyun.com/repository/central') }
    maven { url = uri('https://maven.aliyun.com/repository/gradle-plugin') }
    google()
    mavenCentral()
    gradlePluginPortal()
  }
  repositories {
    maven { url = uri('https://maven.aliyun.com/repository/google') }
    maven { url = uri('https://maven.aliyun.com/repository/central') }
    maven { url = uri('https://maven.aliyun.com/repository/public') }
    maven { url = uri('https://www.jitpack.io') }
    google()
    mavenCentral()
  }
}
""".lstrip(),
        encoding="utf-8",
    )
    return init_script


def android_signing_env(config: dict[str, str]) -> dict[str, str]:
    keystore_path = config.get("android_keystore_path", "").strip()
    if keystore_path:
        path = Path(keystore_path)
        if not path.is_absolute():
            path = ROOT / path
        keystore_path = str(path)
    return {
        "FOODLINK_ANDROID_KEYSTORE_PATH": keystore_path,
        "FOODLINK_ANDROID_KEYSTORE_PASSWORD": config.get("android_keystore_password", "").strip(),
        "FOODLINK_ANDROID_KEY_ALIAS": config.get("android_key_alias", "").strip(),
        "FOODLINK_ANDROID_KEY_PASSWORD": config.get("android_key_password", "").strip(),
    }


def android_release_keystore_configured(signing_env: dict[str, str]) -> bool:
    return all(
        signing_env.get(name, "").strip()
        for name in (
            "FOODLINK_ANDROID_KEYSTORE_PATH",
            "FOODLINK_ANDROID_KEYSTORE_PASSWORD",
            "FOODLINK_ANDROID_KEY_ALIAS",
            "FOODLINK_ANDROID_KEY_PASSWORD",
        )
    )


def git_value(args: list[str], fallback: str = "") -> str:
    try:
        return run(["git", *args]).strip()
    except SystemExit:
        return fallback


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, output: Path) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=120) as response:
        response.raise_for_status()
        with output.open("wb") as fh:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    fh.write(chunk)
    return output


def extract_eas_artifact_url(payload: Any) -> str:
    candidates = payload if isinstance(payload, list) else [payload]
    for item in candidates:
        if not isinstance(item, dict):
            continue
        artifacts = item.get("artifacts") or {}
        url = artifacts.get("buildUrl") or artifacts.get("applicationArchiveUrl")
        if url:
            return str(url)
    fail("EAS build JSON did not contain artifacts.buildUrl")
    return ""


def eas_build(platform_profile: str, output_path: Path, api_base_url: str, expo_token: str) -> Path:
    eas = shutil.which("eas") or shutil.which("eas.cmd")
    cmd = [eas] if eas else ["npx", "eas"]
    if not eas:
        cmd = ["npx", "eas-cli"]
    cmd += ["build", "-p", "android", "--profile", platform_profile, "--json", "--wait", "--non-interactive"]
    env = {"EXPO_PUBLIC_API_BASE_URL": api_base_url}
    if expo_token:
        env["EXPO_TOKEN"] = expo_token
    output = run(cmd, cwd=MOBILE_DIR, extra_env=env)
    try:
        payload = json.loads(output[output.find("[") :] if "[" in output else output[output.find("{") :])
    except json.JSONDecodeError as err:
        print(output)
        raise SystemExit("failed to parse EAS JSON output") from err
    artifact_url = extract_eas_artifact_url(payload)
    return download(artifact_url, output_path)


def local_apk_build(output_path: Path, api_base_url: str, config: dict[str, str]) -> Path:
    android_dir = MOBILE_DIR / "android"
    gradlew = android_dir / ("gradlew.bat" if os.name == "nt" else "gradlew")
    if not gradlew.exists():
        run(
            ["npx", "expo", "prebuild", "--platform", "android"],
            cwd=MOBILE_DIR,
            extra_env={"EXPO_PUBLIC_API_BASE_URL": api_base_url},
            capture_output=False,
        )
    if not gradlew.exists():
        fail(f"Gradle wrapper not found: {gradlew}")
    java_home = find_java_home()
    sdk_root = find_android_sdk_root()
    extra_env: dict[str, str] = {}
    if java_home:
        extra_env["JAVA_HOME"] = java_home
        print(f"using JAVA_HOME={java_home}")
    if sdk_root:
        extra_env["ANDROID_HOME"] = sdk_root
        extra_env["ANDROID_SDK_ROOT"] = sdk_root
        write_android_local_properties(android_dir, sdk_root)
        print(f"using ANDROID_HOME={sdk_root}")
    else:
        print("ANDROID_HOME not found; Gradle may fail unless android/local.properties already points to an SDK")
    init_script = write_gradle_mirror_init_script()
    signing_env = android_signing_env(config)
    extra_env.update(signing_env)
    keystore_configured = android_release_keystore_configured(signing_env)
    if keystore_configured:
        keystore_path = Path(signing_env["FOODLINK_ANDROID_KEYSTORE_PATH"])
        if not keystore_path.exists():
            fail(f"Android release keystore file not found: {keystore_path}")
        print(f"using Android release keystore: {keystore_path}")
    else:
        print("warning: Android release signing is not fully configured; APK will use debug signing")
    run(
        [str(gradlew), "--init-script", str(init_script), "assembleRelease"],
        cwd=android_dir,
        extra_env={**extra_env, "EXPO_PUBLIC_API_BASE_URL": api_base_url},
        capture_output=False,
    )
    apk = android_dir / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
    if not apk.exists():
        fail(f"local debug APK not found: {apk}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(apk, output_path)
    return output_path


def artifact_payload(path: Path, key: str, cdn_base: str) -> dict[str, Any]:
    return {
        "filename": path.name,
        "key": key,
        "url": f"{cdn_base}/{key}",
        "sha256": file_sha256(path),
        "sizeBytes": path.stat().st_size,
        "contentType": mimetypes.guess_type(str(path))[0] or "application/octet-stream",
    }


def cos_client(config: dict[str, str]):
    try:
        from qcloud_cos import CosConfig, CosS3Client
    except ModuleNotFoundError as err:
        raise SystemExit(
            "missing dependency: qcloud_cos\n"
            "Install: python -m pip install cos-python-sdk-v5"
        ) from err

    return CosS3Client(
        CosConfig(
            Region=config["region"],
            SecretId=config["secret_id"],
            SecretKey=config["secret_key"],
        )
    )


def upload_bytes(client: Any, bucket: str, key: str, data: bytes, content_type: str, cache_control: str, dry_run: bool) -> None:
    if dry_run:
        print(f"[dry-run] upload bytes -> {bucket}/{key} ({content_type})")
        return
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl=cache_control,
        ACL="public-read",
    )


def upload_file(client: Any, bucket: str, key: str, path: Path, dry_run: bool) -> None:
    content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    if dry_run:
        print(f"[dry-run] upload file {path} -> {bucket}/{key} ({content_type})")
        return
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=path.read_bytes(),
        ContentType=content_type,
        CacheControl="public, max-age=31536000, immutable",
        ACL="public-read",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Publish Food Link Android release artifacts to COS")
    parser.add_argument("--version", help="Release version. Defaults to apps/mobile/app.json expo.version")
    parser.add_argument("--build-number", help="Android versionCode/build number. Defaults to apps/mobile/app.json android.versionCode")
    parser.add_argument("--channel", choices=sorted(CHANNELS.keys()), help="Defaults to beta on dev, stable on main")
    parser.add_argument("--eas-profile", help="Defaults to preview on dev, production on main")
    parser.add_argument("--api-base-url", help="Defaults to dev.api on dev, api on main")
    parser.add_argument("--artifact-apk", type=Path, help="Existing APK file to publish")
    parser.add_argument("--artifact-aab", type=Path, help="Existing AAB file to publish")
    parser.add_argument("--build-apk", action="store_true", help="Run EAS Android APK build and publish downloaded APK")
    parser.add_argument("--build-eas-apk", action="store_true", help="Alias for --build-apk")
    parser.add_argument("--build-aab", action="store_true", help="Run EAS production build and publish downloaded AAB")
    parser.add_argument(
        "--build-local-apk",
        action="store_true",
        help="Build a local release APK with Gradle and publish it. This is the default when no artifact/build option is provided.",
    )
    parser.add_argument("--namespace", default="release-config.yaml", help="Apollo namespace for release config")
    parser.add_argument("--dist-dir", type=Path, default=DEFAULT_DIST)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    branch = git_value(["rev-parse", "--abbrev-ref", "HEAD"], fallback="")
    commit = git_value(["rev-parse", "HEAD"], fallback="")
    short_commit = git_value(["rev-parse", "--short=7", "HEAD"], fallback="")
    branch_defaults = BRANCH_RELEASES.get(branch)
    if not branch_defaults:
        fail(
            f"current branch is {branch or 'unknown'}; mobile Android release only supports main or dev.\n"
            "Switch branches and rerun:\n"
            "  git checkout dev   # publish beta APK with https://dev.api.healthymax.cn\n"
            "  git checkout main  # publish stable APK with https://api.healthymax.cn"
        )

    expo = load_json(MOBILE_APP_JSON).get("expo") or {}
    android = expo.get("android") or {}
    version = args.version or str(expo.get("version") or "0.0.1")
    build_number = str(args.build_number or android.get("versionCode") or "1")
    channel = args.channel or branch_defaults["channel"]
    eas_profile = args.eas_profile or branch_defaults["eas_profile"]
    api_base_url = args.api_base_url or branch_defaults["api_base_url"]
    channels = CHANNELS[channel]

    config = resolve_release_config(args.namespace)
    print(f"release bucket: {config['bucket']}")
    print(f"release cdn: {config['cdn_base']}")
    print(f"branch: {branch}")
    print(f"commit: {short_commit}")
    print(f"release: {branch_defaults['release_name']}")
    print(f"eas profile: {eas_profile}")
    print(f"api base url: {api_base_url}")
    print(f"expo token: {'configured' if config['expo_token'] else 'not configured'}")
    print(f"version: {version}, build: {build_number}, channels: {', '.join(channels)}")

    artifact_dir = args.dist_dir / "android" / version / build_number
    apk_path = args.artifact_apk
    aab_path = args.artifact_aab
    if args.build_eas_apk:
        args.build_apk = True
    should_auto_build = not apk_path and not aab_path and not args.build_apk and not args.build_aab and not args.build_local_apk
    if args.dry_run and should_auto_build:
        print("[dry-run] branch and release config resolved; no build or upload will be performed")
        return
    if should_auto_build:
        args.build_local_apk = True

    if (args.build_apk or args.build_aab) and not config["expo_token"] and not os.getenv("EXPO_TOKEN", "").strip():
        print("warning: EXPO_TOKEN is not configured; EAS may require an interactive login on this machine")

    if args.build_apk:
        apk_path = eas_build(eas_profile, artifact_dir / f"foodlink-{version}-{build_number}.apk", api_base_url, config["expo_token"])
    if args.build_local_apk:
        apk_path = local_apk_build(artifact_dir / f"foodlink-{version}-{build_number}.apk", api_base_url, config)
    if args.build_aab:
        aab_path = eas_build(eas_profile, artifact_dir / f"foodlink-{version}-{build_number}.aab", api_base_url, config["expo_token"])

    if not apk_path and not aab_path:
        fail("provide --artifact-apk/--artifact-aab or use --build-apk/--build-aab")

    artifacts: dict[str, Any] = {}
    release_prefix = f"releases/android/{version}/{build_number}"

    if apk_path:
        apk_path = apk_path.resolve()
        if not apk_path.exists():
            fail(f"APK file not found: {apk_path}")
        apk_key = f"{release_prefix}/foodlink-{version}-{build_number}.apk"
        artifacts["apk"] = artifact_payload(apk_path, apk_key, config["cdn_base"])

    if aab_path:
        aab_path = aab_path.resolve()
        if not aab_path.exists():
            fail(f"AAB file not found: {aab_path}")
        aab_key = f"{release_prefix}/foodlink-{version}-{build_number}.aab"
        artifacts["aab"] = artifact_payload(aab_path, aab_key, config["cdn_base"])

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    release_manifest = {
        "schemaVersion": 1,
        "app": "food_link",
        "platform": "android",
        "applicationId": expo.get("android", {}).get("package", "cn.healthymax.foodlink"),
        "version": version,
        "buildNumber": build_number,
        "buildKind": (
            "local-release"
            if args.build_local_apk and android_release_keystore_configured(android_signing_env(config))
            else "local-release-debug-signed"
            if args.build_local_apk
            else "release"
        ),
        "releasedAt": now,
        "commit": commit,
        "branch": branch,
        "releaseName": branch_defaults["release_name"],
        "channelGroup": channel,
        "easProfile": eas_profile,
        "apiBaseUrl": api_base_url,
        "artifacts": artifacts,
        "notes": "Food Link Android release",
    }

    release_manifest_key = f"{release_prefix}/manifest.json"
    release_manifest["url"] = f"{config['cdn_base']}/{release_manifest_key}"
    local_manifest = artifact_dir / "manifest.json"
    write_json(local_manifest, release_manifest)

    client = None if args.dry_run else cos_client(config)
    bucket = config["bucket"]

    if apk_path:
        upload_file(client, bucket, artifacts["apk"]["key"], apk_path, args.dry_run)
        upload_bytes(
            client,
            bucket,
            f"{release_prefix}/foodlink-{version}-{build_number}.apk.sha256",
            (artifacts["apk"]["sha256"] + "\n").encode("utf-8"),
            "text/plain; charset=utf-8",
            "public, max-age=31536000, immutable",
            args.dry_run,
        )
    if aab_path:
        upload_file(client, bucket, artifacts["aab"]["key"], aab_path, args.dry_run)
        upload_bytes(
            client,
            bucket,
            f"{release_prefix}/foodlink-{version}-{build_number}.aab.sha256",
            (artifacts["aab"]["sha256"] + "\n").encode("utf-8"),
            "text/plain; charset=utf-8",
            "public, max-age=31536000, immutable",
            args.dry_run,
        )

    upload_bytes(
        client,
        bucket,
        release_manifest_key,
        json.dumps(release_manifest, ensure_ascii=False, indent=2).encode("utf-8") + b"\n",
        "application/json; charset=utf-8",
        "public, max-age=31536000, immutable",
        args.dry_run,
    )

    for channel in channels:
        channel_manifest = {
            **release_manifest,
            "channel": channel,
            "releaseManifestUrl": release_manifest["url"],
        }
        channel_key = f"channels/{channel}.json"
        upload_bytes(
            client,
            bucket,
            channel_key,
            json.dumps(channel_manifest, ensure_ascii=False, indent=2).encode("utf-8") + b"\n",
            "application/json; charset=utf-8",
            "public, max-age=60, must-revalidate",
            args.dry_run,
        )
        print(f"{channel}: {config['cdn_base']}/{channel_key}")

    print(f"release manifest: {release_manifest['url']}")
    for kind, artifact in artifacts.items():
        print(f"{kind}: {artifact['url']}")


if __name__ == "__main__":
    main()
