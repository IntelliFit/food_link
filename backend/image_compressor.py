"""
Post-analysis image compressor.
Called by worker after AI analysis completes to shrink the stored image.
Keeps the same object key so existing URLs remain valid.
"""
import io
import os
from typing import Optional, Tuple

from PIL import Image, ImageOps
from dotenv import load_dotenv
from cos_storage import (
    FOOD_IMAGES_BUCKET,
    download_bytes,
    resolve_object_key,
    upload_bytes,
)

BACKEND_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(BACKEND_ENV_PATH, override=True)

MAX_EDGE = 1280
JPEG_QUALITY = 62
WEBP_QUALITY = 58
MIN_SAVE_RATIO = 0.15  # only replace if we save at least 15%


def _compress_bytes(raw: bytes, ext: str) -> Tuple[bytes, str]:
    """Compress image bytes, return (compressed_bytes, content_type)."""
    with Image.open(io.BytesIO(raw)) as img:
        img = ImageOps.exif_transpose(img)
        if max(img.size) > MAX_EDGE:
            img.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)

        buf = io.BytesIO()
        ext = ext.lower()

        if ext in (".jpg", ".jpeg"):
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
            return buf.getvalue(), "image/jpeg"
        elif ext == ".webp":
            if img.mode not in ("RGB", "RGBA", "L"):
                img = img.convert("RGB")
            img.save(buf, format="WEBP", quality=WEBP_QUALITY, method=6)
            return buf.getvalue(), "image/webp"
        elif ext == ".png":
            if img.mode == "P":
                img = img.convert("RGBA")
            img.save(buf, format="PNG", optimize=True)
            return buf.getvalue(), "image/png"
        else:
            raise ValueError(f"Unsupported format: {ext}")


def compress_storage_image(bucket: str, object_name: str) -> Optional[dict]:
    """
    Download an image from COS, compress it, and re-upload.
    Returns a dict with stats, or None if skipped/failed.
    """
    try:
        raw = download_bytes(bucket, object_name)
    except Exception:
        return None
    original_size = len(raw)

    if original_size < 50_000:  # <50KB, not worth compressing
        return None

    ext = os.path.splitext(object_name)[1] or ".jpg"
    try:
        compressed, content_type = _compress_bytes(raw, ext)
    except Exception:
        return None

    compressed_size = len(compressed)
    saved_ratio = 1.0 - compressed_size / original_size if original_size > 0 else 0

    if saved_ratio < MIN_SAVE_RATIO:
        return {"status": "skipped", "reason": "savings_too_small", "original": original_size, "compressed": compressed_size}

    try:
        upload_bytes(bucket, object_name, compressed, content_type=content_type)
        return {
            "status": "compressed",
            "original": original_size,
            "compressed": compressed_size,
            "saved_pct": round(saved_ratio * 100, 1),
        }
    except Exception as e:
        return {"status": "upload_error", "error": str(e)}


def compress_task_images(image_urls: list, bucket: str = FOOD_IMAGES_BUCKET):
    """
    Compress all images associated with a completed task.
    Extracts object names from full URLs and compresses each.
    Silently ignores any errors.
    """
    for url in image_urls:
        if not isinstance(url, str):
            continue
        obj_name = resolve_object_key(url, bucket)
        if not obj_name:
            continue

        try:
            result = compress_storage_image(bucket, obj_name)
            if result and result.get("status") == "compressed":
                print(
                    f"[compress] {obj_name}: {result['original']//1024}KB -> {result['compressed']//1024}KB (-{result['saved_pct']}%)",
                    flush=True,
                )
        except Exception:
            pass
