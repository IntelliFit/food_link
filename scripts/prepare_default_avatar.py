#!/usr/bin/env python3
"""
Prepare default user avatar for registration flow.

Reads apps/wechat/src/assets/default_avatar.png, center-crops to square, resizes to 256x256,
and saves as JPEG to apps/wechat/src/assets/default_avatar.jpg.

Optional --upload uploads to COS user-avatars bucket at _system/default_avatar.jpg
(requires backend/.env or env vars used by other COS scripts).
"""

from __future__ import annotations

import argparse
import os
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WECHAT_APP_ROOT = ROOT / "apps" / "wechat"
SOURCE_PATH = WECHAT_APP_ROOT / "src" / "assets" / "default_avatar.png"
DEST_PATH = WECHAT_APP_ROOT / "src" / "assets" / "default_avatar.jpg"
COS_KEY = "_system/default_avatar.jpg"
TARGET_SIZE = 256


def crop_center_square(img: Image.Image) -> Image.Image:
    width, height = img.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    return img.crop((left, top, left + side, top + side))


def prepare_avatar(source: Path, dest: Path, size: int = TARGET_SIZE) -> bytes:
    if not source.exists():
        raise FileNotFoundError(f"source image not found: {source}")

    with Image.open(source) as img:
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
        squared = crop_center_square(img)
        if squared.mode == "RGBA":
            background = Image.new("RGB", squared.size, (255, 255, 255))
            background.paste(squared, mask=squared.split()[3])
            squared = background
        elif squared.mode != "RGB":
            squared = squared.convert("RGB")
        resized = squared.resize((size, size), Image.LANCZOS)

        dest.parent.mkdir(parents=True, exist_ok=True)
        resized.save(dest, "JPEG", quality=88, optimize=True)

    return dest.read_bytes()


def upload_to_cos(data: bytes, key: str) -> str:
    try:
        from qcloud_cos import CosConfig, CosS3Client
    except ModuleNotFoundError as err:
        raise SystemExit(
            "missing dependency: qcloud_cos\n"
            "Use backend virtualenv, e.g. backend/.venv/Scripts/python.exe\n"
            "  python -m pip install cos-python-sdk-v5"
        ) from err

    secret_id = os.getenv("COS_SECRET_ID", "").strip()
    secret_key = os.getenv("COS_SECRET_KEY", "").strip()
    region = os.getenv("COS_REGION", "ap-beijing").strip()
    bucket = os.getenv("COS_USER_AVATARS_BUCKET", "user-avatars-1370036754").strip()
    if not secret_id or not secret_key:
        raise SystemExit("COS_SECRET_ID and COS_SECRET_KEY are required for --upload")

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
        ContentType="image/jpeg",
    )
    cdn_base = os.getenv(
        "CDN_USER_AVATARS_BASE_URL",
        "http://cdn-food-user-avatars.coachlink.fit",
    ).rstrip("/")
    return f"{cdn_base}/{key}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare default user avatar asset")
    parser.add_argument(
        "--source",
        type=Path,
        default=SOURCE_PATH,
        help=f"source PNG path (default: {SOURCE_PATH})",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=DEST_PATH,
        help=f"output JPEG path (default: {DEST_PATH})",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=TARGET_SIZE,
        help=f"square output size in pixels (default: {TARGET_SIZE})",
    )
    parser.add_argument(
        "--upload",
        action="store_true",
        help=f"upload to COS as {COS_KEY}",
    )
    args = parser.parse_args()

    try:
        data = prepare_avatar(args.source, args.dest, args.size)
    except FileNotFoundError as err:
        print(f"Error: {err}", file=sys.stderr)
        return 1

    size_kb = args.dest.stat().st_size / 1024
    print(f"Saved: {args.dest} ({size_kb:.1f} KB, {args.size}x{args.size})")

    if args.upload:
        url = upload_to_cos(data, COS_KEY)
        print(f"Uploaded: {url}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
