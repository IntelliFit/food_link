#!/usr/bin/env python3
"""
Upload static assets from apps/wechat/assets/ to Tencent COS food-images bucket.

Credentials (first match wins):
1. COS_SECRET_ID / COS_SECRET_KEY env vars (or backend/.env)
2. backend/apollo-config.yaml + Apollo app-config.yaml storage section

Usage:
  python scripts/upload_wechat_assets_to_cos.py
  python scripts/upload_wechat_assets_to_cos.py --dry-run
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import mimetypes
import os
import sys
import time
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlparse

import requests
import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
WECHAT_ASSETS = ROOT / "apps" / "wechat" / "assets"
DEFAULT_ENV_FILE = ROOT / "backend" / ".env"
APOLLO_CONFIG_FILE = ROOT / "backend" / "apollo-config.yaml"

UPLOADS: dict[str, str] = {
    "bg/cafeteria-hero.jpg": "wechat/cafeteria-hero.jpg",
    "image.png": "wechat/source-login-logo.png",
    "default_avatar.jpg": "wechat/default_avatar.jpg",
}


def load_env(env_file: Path) -> None:
    if env_file.exists():
        load_dotenv(env_file, override=False)


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


def decode_apollo_raw_config_body(body: str) -> str:
    content = body.strip()
    if content.startswith("content="):
        content = content[len("content=") :]
        content = _unescape_java_properties_value(content)
    return content.strip()


def _unescape_java_properties_value(value: str) -> str:
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


def load_storage_from_apollo() -> dict[str, str] | None:
    if not APOLLO_CONFIG_FILE.exists():
        return None

    apollo_cfg = yaml.safe_load(APOLLO_CONFIG_FILE.read_text(encoding="utf-8")).get("apollo") or {}
    base = str(apollo_cfg.get("config_server_url", "")).rstrip("/") + "/"
    namespace = (apollo_cfg.get("namespaces") or [""])[0]
    app_id = str(apollo_cfg.get("app_id", ""))
    cluster = str(apollo_cfg.get("cluster", ""))
    secret = str(apollo_cfg.get("access_key_secret", ""))
    if not all([base, namespace, app_id, cluster]):
        return None

    rel = f"configfiles/{app_id}/{cluster}/{namespace}"
    query = urlencode({"ip": "127.0.0.1"})
    request_url = urljoin(base, f"{rel}?{query}")
    headers = apollo_auth_headers(request_url, app_id, secret) if secret else {}
    response = requests.get(request_url, headers=headers, timeout=20)
    response.raise_for_status()
    content = decode_apollo_raw_config_body(response.text)
    storage = (yaml.safe_load(content) or {}).get("storage") or {}
    return {str(k): str(v) for k, v in storage.items() if v}


def resolve_cos_config() -> tuple[str, str, str, str, str]:
    secret_id = os.getenv("COS_SECRET_ID", "").strip()
    secret_key = os.getenv("COS_SECRET_KEY", "").strip()
    region = os.getenv("COS_REGION", "ap-beijing").strip()
    bucket = os.getenv("COS_FOOD_IMAGES_BUCKET", "food-images-1370036754").strip()
    cdn_base = os.getenv(
        "CDN_FOOD_IMAGES_BASE_URL",
        "https://cdn-food-images.coachlink.fit",
    ).rstrip("/")

    if not secret_id or not secret_key:
        storage = load_storage_from_apollo()
        if storage:
            secret_id = storage.get("cos_secret_id", secret_id)
            secret_key = storage.get("cos_secret_key", secret_key)
            region = storage.get("cos_region", region)
            bucket = storage.get("food_images_bucket", bucket)
            cdn_base = storage.get("food_images_cdn_base_url", cdn_base).rstrip("/")

    if not secret_id or not secret_key:
        raise SystemExit("COS credentials not found in env or Apollo storage config")

    return secret_id, secret_key, region, bucket, cdn_base


def upload_file(local_path: Path, key: str, *, dry_run: bool) -> str:
    try:
        from qcloud_cos import CosConfig, CosS3Client
    except ModuleNotFoundError as err:
        raise SystemExit(
            "missing dependency: qcloud_cos\n"
            "Install: python -m pip install cos-python-sdk-v5"
        ) from err

    secret_id, secret_key, region, bucket, cdn_base = resolve_cos_config()
    content_type, _ = mimetypes.guess_type(str(local_path))
    if not content_type:
        content_type = "application/octet-stream"

    if dry_run:
        print(f"[dry-run] would upload {local_path} -> {bucket}/{key}")
        return f"{cdn_base}/{key}"

    data = local_path.read_bytes()
    client = CosS3Client(
        CosConfig(
            Region=region,
            SecretId=secret_id,
            SecretKey=secret_key,
        )
    )
    client.put_object(
        Bucket=bucket,
        Body=BytesIO(data),
        Key=key,
        ContentType=content_type,
    )
    url = f"{cdn_base}/{key}"
    print(f"Uploaded: {url} ({len(data) / 1024:.1f} KB)")
    return url


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload wechat/assets static files to COS food-images bucket")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_env(args.env_file)

    uploaded: list[str] = []
    for rel_path, cos_key in UPLOADS.items():
        local_path = WECHAT_ASSETS / rel_path
        if not local_path.exists():
            print(f"Skip missing: {local_path}", file=sys.stderr)
            continue
        uploaded.append(upload_file(local_path, cos_key, dry_run=args.dry_run))

    if not uploaded:
        print("No files uploaded.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
