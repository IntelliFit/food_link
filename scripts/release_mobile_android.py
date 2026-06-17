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
  python scripts/release_mobile_android.py --version 0.0.1 --build-number 1 --channel all --artifact-apk dist/app.apk
  python scripts/release_mobile_android.py --version 0.0.1 --build-number 1 --channel beta --build-apk
  python scripts/release_mobile_android.py --version 0.0.1 --build-number 1 --channel all --build-local-apk
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


def load_release_storage_from_apollo(namespace: str) -> dict[str, str]:
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
    storage = config.get("storage") or {}
    return {str(k): str(v) for k, v in storage.items() if v is not None}


def resolve_release_config(namespace: str) -> dict[str, str]:
    storage = load_release_storage_from_apollo(namespace)
    resolved = {
        "secret_id": os.getenv("COS_SECRET_ID", storage.get("cos_secret_id", "")).strip(),
        "secret_key": os.getenv("COS_SECRET_KEY", storage.get("cos_secret_key", "")).strip(),
        "region": os.getenv("COS_REGION", storage.get("cos_region", "ap-beijing")).strip(),
        "bucket": os.getenv("COS_RELEASE_BUCKET", storage.get("release_bucket", "")).strip(),
        "cdn_base": os.getenv("CDN_RELEASE_BASE_URL", storage.get("release_cdn_base_url", "")).strip().rstrip("/"),
    }
    missing = [key for key, value in resolved.items() if not value]
    if missing:
        fail(f"release config missing required fields: {', '.join(missing)}")
    return resolved


def run(cmd: list[str], cwd: Path = ROOT, extra_env: dict[str, str] | None = None) -> str:
    executable = shutil.which(cmd[0])
    if executable:
        cmd = [executable, *cmd[1:]]
    print("+", " ".join(cmd))
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
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
    if completed.returncode != 0:
        print(completed.stdout)
        fail(f"command failed with exit code {completed.returncode}: {' '.join(cmd)}")
    return completed.stdout


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


def eas_build(platform_profile: str, output_path: Path) -> Path:
    eas = shutil.which("eas") or shutil.which("eas.cmd")
    cmd = [eas] if eas else ["npx", "eas"]
    if not eas:
        cmd = ["npx", "eas-cli"]
    cmd += ["build", "-p", "android", "--profile", platform_profile, "--json", "--wait", "--non-interactive"]
    output = run(cmd)
    try:
        payload = json.loads(output[output.find("[") :] if "[" in output else output[output.find("{") :])
    except json.JSONDecodeError as err:
        print(output)
        raise SystemExit("failed to parse EAS JSON output") from err
    artifact_url = extract_eas_artifact_url(payload)
    return download(artifact_url, output_path)


def local_apk_build(output_path: Path) -> Path:
    run(["npx", "expo", "prebuild", "--platform", "android"], cwd=MOBILE_DIR)
    android_dir = MOBILE_DIR / "android"
    gradlew = android_dir / ("gradlew.bat" if os.name == "nt" else "gradlew")
    if not gradlew.exists():
        fail(f"Gradle wrapper not found after prebuild: {gradlew}")
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
    run([str(gradlew), "--init-script", str(init_script), "assembleRelease"], cwd=android_dir, extra_env=extra_env)
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
    parser.add_argument("--build-number", default="1", help="Android versionCode/build number")
    parser.add_argument("--channel", choices=sorted(CHANNELS.keys()), default="beta")
    parser.add_argument("--artifact-apk", type=Path, help="Existing APK file to publish")
    parser.add_argument("--artifact-aab", type=Path, help="Existing AAB file to publish")
    parser.add_argument("--build-apk", action="store_true", help="Run EAS preview build and publish downloaded APK")
    parser.add_argument("--build-aab", action="store_true", help="Run EAS production build and publish downloaded AAB")
    parser.add_argument(
        "--build-local-apk",
        action="store_true",
        help="Build a local release APK with Expo prebuild + Gradle and publish it. Current native config uses debug signing until a production keystore is configured.",
    )
    parser.add_argument("--namespace", default="release-config.yaml", help="Apollo namespace for release config")
    parser.add_argument("--dist-dir", type=Path, default=DEFAULT_DIST)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    expo = load_json(MOBILE_APP_JSON).get("expo") or {}
    version = args.version or str(expo.get("version") or "0.0.1")
    build_number = str(args.build_number)
    channels = CHANNELS[args.channel]

    config = resolve_release_config(args.namespace)
    print(f"release bucket: {config['bucket']}")
    print(f"release cdn: {config['cdn_base']}")
    print(f"version: {version}, build: {build_number}, channels: {', '.join(channels)}")

    artifact_dir = args.dist_dir / "android" / version / build_number
    apk_path = args.artifact_apk
    aab_path = args.artifact_aab

    if args.build_apk:
        apk_path = eas_build("preview", artifact_dir / f"foodlink-{version}-{build_number}.apk")
    if args.build_local_apk:
        apk_path = local_apk_build(artifact_dir / f"foodlink-{version}-{build_number}.apk")
    if args.build_aab:
        aab_path = eas_build("production", artifact_dir / f"foodlink-{version}-{build_number}.aab")

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
    commit = git_value(["rev-parse", "HEAD"], fallback="")
    branch = git_value(["rev-parse", "--abbrev-ref", "HEAD"], fallback="")
    release_manifest = {
        "schemaVersion": 1,
        "app": "food_link",
        "platform": "android",
        "applicationId": expo.get("android", {}).get("package", "cn.healthymax.foodlink"),
        "version": version,
        "buildNumber": build_number,
        "buildKind": "local-release-debug-signed" if args.build_local_apk else "release",
        "releasedAt": now,
        "commit": commit,
        "branch": branch,
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
