"""
批量压缩 Supabase Storage 中的 food-images。

默认行为:
- 只处理被业务表引用的长期图片
- 默认 dry-run，不会回写远端对象
- 保持对象 key 不变，避免数据库改链

依赖:
- requests
- Pillow

示例:
- 先看预估收益:
  python backend/compress_food_images.py --limit 100

- 真正执行前 50 张:
  python backend/compress_food_images.py --execute --limit 50

- 处理所有被引用图片:
  python backend/compress_food_images.py --execute --scope referenced

- 全量压缩时建议降低终端输出:
  python backend/compress_food_images.py --execute --scope all --progress-every 50
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

import requests
from PIL import Image, ImageOps


BUCKET_NAME = "food-images"
DEFAULT_MAX_EDGE = 1280
DEFAULT_JPEG_QUALITY = 62
DEFAULT_WEBP_QUALITY = 58
MIN_SAVING_RATIO = 0.10
MIN_SAVING_BYTES = 32 * 1024


@dataclass
class StorageObject:
    name: str
    created_at: Optional[str]
    size: int
    mimetype: str

    @property
    def extension(self) -> str:
        suffix = Path(self.name).suffix.lower()
        return suffix or ".jpg"

    @property
    def is_placeholder(self) -> bool:
        return not self.name or self.name.startswith(".")


def load_env(env_path: Path) -> Dict[str, str]:
    values: Dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


class SupabaseStorageClient:
    def __init__(self, base_url: str, service_role_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.service_role_key = service_role_key
        self.session = requests.Session()
        self.session.headers.update(
            {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
            }
        )

    def _request_with_retry(self, method: str, url: str, **kwargs) -> requests.Response:
        last_error: Optional[Exception] = None
        for attempt in range(5):
            try:
                response = self.session.request(method, url, timeout=60, **kwargs)
                response.raise_for_status()
                return response
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt == 4:
                    raise
                time.sleep(1.5 * (attempt + 1))
        assert last_error is not None
        raise last_error

    def fetch_table_rows(self, table: str, select: str, page_size: int = 1000) -> List[dict]:
        rows: List[dict] = []
        offset = 0
        while True:
            headers = {
                "Range-Unit": "items",
                "Range": f"{offset}-{offset + page_size - 1}",
            }
            response = self._request_with_retry(
                "GET",
                f"{self.base_url}/rest/v1/{table}",
                headers=headers,
                params={"select": select},
            )
            batch = response.json()
            rows.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return rows

    def list_bucket_objects(self, bucket: str, page_size: int = 100) -> List[StorageObject]:
        offset = 0
        objects: List[StorageObject] = []
        while True:
            response = self._request_with_retry(
                "POST",
                f"{self.base_url}/storage/v1/object/list/{bucket}",
                headers={"Content-Type": "application/json"},
                json={
                    "prefix": "",
                    "limit": page_size,
                    "offset": offset,
                    "sortBy": {"column": "name", "order": "asc"},
                },
            )
            batch = response.json()
            for item in batch:
                metadata = item.get("metadata") or {}
                objects.append(
                    StorageObject(
                        name=item.get("name") or "",
                        created_at=item.get("created_at"),
                        size=int(metadata.get("size") or 0),
                        mimetype=str(metadata.get("mimetype") or "").strip(),
                    )
                )
            if len(batch) < page_size:
                break
            offset += page_size
        return objects

    def public_object_url(self, bucket: str, object_name: str) -> str:
        return f"{self.base_url}/storage/v1/object/public/{bucket}/{object_name}"

    def download_object(self, bucket: str, object_name: str) -> bytes:
        response = self._request_with_retry(
            "GET",
            f"{self.base_url}/storage/v1/object/{bucket}/{object_name}",
        )
        return response.content

    def upload_object(
        self,
        bucket: str,
        object_name: str,
        content: bytes,
        content_type: str,
        upsert: bool = True,
    ) -> None:
        headers = {
            "Content-Type": content_type,
            "x-upsert": "true" if upsert else "false",
        }
        self._request_with_retry(
            "POST",
            f"{self.base_url}/storage/v1/object/{bucket}/{object_name}",
            headers=headers,
            data=content,
        )


def flat_urls(value: object) -> List[str]:
    if isinstance(value, str):
        url = value.strip()
        return [url] if url else []
    if isinstance(value, list):
        result: List[str] = []
        for item in value:
            if isinstance(item, str):
                url = item.strip()
                if url:
                    result.append(url)
        return result
    return []


def collect_referenced_food_urls(client: SupabaseStorageClient) -> Tuple[Set[str], Set[str], Set[str]]:
    records = client.fetch_table_rows(
        "user_food_records",
        "id,image_path,image_paths,source_task_id",
    )
    public_food = client.fetch_table_rows(
        "public_food_library",
        "id,image_path,image_paths,status",
    )
    analysis = client.fetch_table_rows(
        "analysis_tasks",
        "id,image_url,image_paths,status,task_type",
    )

    record_urls = {
        url
        for row in records
        for url in (flat_urls(row.get("image_path")) + flat_urls(row.get("image_paths")))
        if f"/{BUCKET_NAME}/" in url
    }
    public_urls = {
        url
        for row in public_food
        for url in (flat_urls(row.get("image_path")) + flat_urls(row.get("image_paths")))
        if f"/{BUCKET_NAME}/" in url
    }
    analysis_urls = {
        url
        for row in analysis
        for url in (flat_urls(row.get("image_url")) + flat_urls(row.get("image_paths")))
        if f"/{BUCKET_NAME}/" in url
    }
    return record_urls, public_urls, analysis_urls


def classify_scope(
    objects: Sequence[StorageObject],
    client: SupabaseStorageClient,
    scope: str,
) -> List[StorageObject]:
    record_urls, public_urls, analysis_urls = collect_referenced_food_urls(client)
    chosen: List[StorageObject] = []
    for obj in objects:
        url = client.public_object_url(BUCKET_NAME, obj.name)
        in_record = url in record_urls
        in_public = url in public_urls
        in_analysis = url in analysis_urls
        if scope == "referenced" and (in_record or in_public):
            chosen.append(obj)
        elif scope == "recorded" and in_record:
            chosen.append(obj)
        elif scope == "temp" and in_analysis and not in_record and not in_public:
            chosen.append(obj)
        elif scope == "orphan" and not in_analysis and not in_record and not in_public:
            chosen.append(obj)
        elif scope == "all":
            chosen.append(obj)
    return chosen


def can_handle_image(ext: str, mimetype: str) -> bool:
    ext = ext.lower()
    if ext in {".jpg", ".jpeg", ".webp", ".png"}:
        return True
    if mimetype.lower() in {"image/jpeg", "image/webp", "image/png"}:
        return True
    return False


def compress_image_bytes(
    raw_bytes: bytes,
    *,
    extension: str,
    max_edge: int,
    jpeg_quality: int,
    webp_quality: int,
) -> Tuple[bytes, str, Dict[str, object]]:
    with Image.open(io.BytesIO(raw_bytes)) as image:
        image = ImageOps.exif_transpose(image)
        original_mode = image.mode
        width, height = image.size

        if max(width, height) > max_edge:
            image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)

        output = io.BytesIO()
        ext = extension.lower()
        save_kwargs: Dict[str, object]
        content_type: str

        if ext in {".jpg", ".jpeg"}:
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            save_kwargs = {
                "format": "JPEG",
                "quality": jpeg_quality,
                "optimize": True,
                "progressive": True,
            }
            content_type = "image/jpeg"
        elif ext == ".webp":
            if image.mode not in ("RGB", "RGBA", "L"):
                image = image.convert("RGB")
            save_kwargs = {
                "format": "WEBP",
                "quality": webp_quality,
                "method": 6,
            }
            content_type = "image/webp"
        elif ext == ".png":
            if image.mode == "P":
                image = image.convert("RGBA")
            save_kwargs = {
                "format": "PNG",
                "optimize": True,
            }
            content_type = "image/png"
        else:
            raise ValueError(f"暂不支持的图片格式: {extension}")

        image.save(output, **save_kwargs)
        compressed = output.getvalue()
        info = {
            "original_mode": original_mode,
            "original_width": width,
            "original_height": height,
            "new_width": image.size[0],
            "new_height": image.size[1],
            "content_type": content_type,
        }
        return compressed, content_type, info


def should_replace(original_size: int, compressed_size: int) -> bool:
    saved_bytes = original_size - compressed_size
    if saved_bytes < MIN_SAVING_BYTES:
        return False
    if original_size <= 0:
        return False
    return (saved_bytes / original_size) >= MIN_SAVING_RATIO


def make_report_path(report_dir: Path) -> Path:
    report_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return report_dir / f"food-images-compress-report-{timestamp}.json"


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="批量压缩 Supabase food-images")
    parser.add_argument("--env-file", default="backend/.env", help="环境变量文件路径")
    parser.add_argument(
        "--name",
        action="append",
        default=[],
        help="精确指定要处理的对象名，可重复传多次",
    )
    parser.add_argument(
        "--scope",
        default="referenced",
        choices=["referenced", "recorded", "temp", "orphan", "all"],
        help="压缩范围，默认只压长期引用图片",
    )
    parser.add_argument("--limit", type=int, default=0, help="最多处理多少张，0 表示全部")
    parser.add_argument("--offset", type=int, default=0, help="从第几个候选对象开始处理")
    parser.add_argument("--execute", action="store_true", help="真正回写远端对象")
    parser.add_argument("--max-edge", type=int, default=DEFAULT_MAX_EDGE, help="最长边限制")
    parser.add_argument("--jpeg-quality", type=int, default=DEFAULT_JPEG_QUALITY, help="JPEG 质量")
    parser.add_argument("--webp-quality", type=int, default=DEFAULT_WEBP_QUALITY, help="WEBP 质量")
    parser.add_argument(
        "--progress-every",
        type=int,
        default=1,
        help="每处理多少张打印一次进度；传 0 表示仅打印最终摘要",
    )
    parser.add_argument(
        "--report-dir",
        default="backend/reports",
        help="本地报告输出目录",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    env = load_env(Path(args.env_file))
    base_url = env.get("SUPABASE_URL", "").strip()
    service_role_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not base_url or not service_role_key:
        print("缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    client = SupabaseStorageClient(base_url, service_role_key)
    all_objects = client.list_bucket_objects(BUCKET_NAME)
    target_objects = classify_scope(all_objects, client, args.scope)

    if args.name:
        wanted_names = {name.strip() for name in args.name if name.strip()}
        target_objects = [obj for obj in all_objects if obj.name in wanted_names]
    else:
        target_objects = [obj for obj in target_objects if not obj.is_placeholder]

    if args.offset > 0:
        target_objects = target_objects[args.offset :]

    if args.limit > 0:
        target_objects = target_objects[: args.limit]

    report_items: List[dict] = []
    total_before = 0
    total_after = 0
    replaced = 0
    skipped = 0
    failed = 0

    for index, obj in enumerate(target_objects, start=1):
        item_report = {
            "name": obj.name,
            "created_at": obj.created_at,
            "original_size": obj.size,
            "status": "pending",
        }
        total_before += obj.size

        try:
            if not can_handle_image(obj.extension, obj.mimetype):
                item_report["status"] = "skipped_unsupported"
                total_after += obj.size
                skipped += 1
                report_items.append(item_report)
                continue

            raw_bytes = client.download_object(BUCKET_NAME, obj.name)
            compressed, content_type, meta = compress_image_bytes(
                raw_bytes,
                extension=obj.extension,
                max_edge=args.max_edge,
                jpeg_quality=args.jpeg_quality,
                webp_quality=args.webp_quality,
            )
            compressed_size = len(compressed)
            total_after += min(obj.size, compressed_size) if should_replace(obj.size, compressed_size) else obj.size
            item_report.update(
                {
                    "compressed_size": compressed_size,
                    "estimated_saved_bytes": obj.size - compressed_size,
                    "replace": should_replace(obj.size, compressed_size),
                    "meta": meta,
                }
            )

            if not item_report["replace"]:
                item_report["status"] = "skipped_low_gain"
                skipped += 1
                report_items.append(item_report)
                continue

            if args.execute:
                client.upload_object(
                    BUCKET_NAME,
                    obj.name,
                    compressed,
                    content_type=content_type,
                    upsert=True,
                )
                item_report["status"] = "replaced"
            else:
                item_report["status"] = "dry_run_replace"
            replaced += 1
        except Exception as exc:  # noqa: BLE001
            item_report["status"] = "failed"
            item_report["error"] = str(exc)
            total_after += obj.size
            failed += 1

        report_items.append(item_report)
        if args.progress_every > 0 and (
            index == 1
            or index == len(target_objects)
            or index % args.progress_every == 0
            or item_report["status"] == "failed"
        ):
            print(
                f"[{index}/{len(target_objects)}] "
                f"last={obj.name} status={item_report['status']} "
                f"replaced={replaced} skipped={skipped} failed={failed}",
                flush=True,
            )

    summary = {
        "bucket": BUCKET_NAME,
        "scope": args.scope,
        "execute": args.execute,
        "count": len(target_objects),
        "replaced_or_planned": replaced,
        "skipped": skipped,
        "failed": failed,
        "total_before_mb": round(total_before / 1024 / 1024, 2),
        "total_after_mb": round(total_after / 1024 / 1024, 2),
        "estimated_saved_mb": round((total_before - total_after) / 1024 / 1024, 2),
        "max_edge": args.max_edge,
        "jpeg_quality": args.jpeg_quality,
        "webp_quality": args.webp_quality,
    }

    report = {
        "summary": summary,
        "items": report_items,
    }
    report_path = make_report_path(Path(args.report_dir))
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False), flush=True)
    print(f"report: {report_path}", flush=True)
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
