"""
Sync Supabase Storage buckets into Tencent COS buckets and verify object parity.

Default behavior:
1. Discover source buckets from Supabase Storage.
2. Map each source bucket to a target COS bucket.
3. Upload missing or mismatched objects.
4. Keep target-only objects unless --delete-extra is passed.
5. Verify object count, keys, and sizes.

Typical usage:
  backend/.venv/Scripts/python.exe backend/scripts/migrate_supabase_storage_to_cos.py --dry-run
  backend/.venv/Scripts/python.exe backend/scripts/migrate_supabase_storage_to_cos.py

Notes:
- The default key strategy keeps the same object key inside each bucket.
- If source and target use different bucket topology, pass --bucket-map.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import traceback
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from typing import Dict, Iterable, List, Optional
from urllib.parse import quote

import requests
from dotenv import load_dotenv

try:
    from qcloud_cos import CosConfig, CosS3Client
except ModuleNotFoundError as err:
    raise SystemExit(
        "missing dependency: qcloud_cos\n"
        "Use the backend virtualenv Python, for example:\n"
        "  backend/.venv/Scripts/python.exe backend/scripts/migrate_supabase_storage_to_cos.py --dry-run\n"
        "or install it into the active Python environment:\n"
        "  python -m pip install cos-python-sdk-v5"
    ) from err


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
DEFAULT_ENV_FILE = BACKEND / ".env"
ENV_BUCKET_MAP = {
    "food-images": "COS_FOOD_IMAGES_BUCKET",
    "health-reports": "COS_HEALTH_REPORTS_BUCKET",
    "user-avatars": "COS_USER_AVATARS_BUCKET",
    "icon": "COS_ICON_BUCKET",
}


@dataclass
class ObjectItem:
    bucket: str
    key: str
    size: int


@dataclass
class RuntimeConfig:
    env_file: Path
    supabase_url: str
    supabase_key: str
    cos_secret_id: str
    cos_secret_key: str
    cos_region: str
    cos_token: str | None
    source_buckets: List[str]
    bucket_map: Dict[str, str]
    dry_run: bool
    deep_verify: bool
    skip_existing: bool
    delete_extra: bool
    verbose_objects: bool
    report_file: Path | None


def log(message: str) -> None:
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync Supabase Storage buckets into Tencent COS.")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE), help="Path to env file.")
    parser.add_argument("--source-buckets", default="", help="Comma-separated source bucket list.")
    parser.add_argument(
        "--bucket-map",
        default="",
        help="Source-to-target bucket mapping, e.g. food-images:food-bucket,user-avatars:avatar-bucket",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print sync plan only.")
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        default=True,
        help="Skip objects that already exist in the target bucket with the same size. Enabled by default.",
    )
    parser.add_argument(
        "--no-skip-existing",
        dest="skip_existing",
        action="store_false",
        help="Disable skip-existing and always re-upload source objects.",
    )
    parser.add_argument(
        "--deep-verify",
        action="store_true",
        help="Download both sides and compare SHA256 for every object after sync.",
    )
    parser.add_argument(
        "--delete-extra",
        action="store_true",
        default=False,
        help="Delete COS objects that do not exist in Supabase. Default: keep target-only objects.",
    )
    parser.add_argument(
        "--keep-extra",
        dest="delete_extra",
        action="store_false",
        help="Keep target-only COS objects. This is the default.",
    )
    parser.add_argument(
        "--verbose-objects",
        action="store_true",
        help="Print every object key while syncing. Default is bucket-level summary only.",
    )
    parser.add_argument(
        "--report-file",
        default="",
        help="Optional JSON report path for sync output.",
    )
    return parser.parse_args()


def parse_bucket_map(raw: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    if not raw.strip():
        return result
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if ":" not in chunk:
            raise RuntimeError(f"invalid --bucket-map entry: {chunk}")
        source, target = chunk.split(":", 1)
        result[source.strip()] = target.strip()
    return result


def parse_bucket_list(raw: str) -> List[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


def load_runtime_config(args: argparse.Namespace) -> RuntimeConfig:
    env_file = Path(args.env_file)
    load_dotenv(env_file)
    supabase_url = (os.getenv("SUPABASE_URL") or "").strip()
    supabase_key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    cos_secret_id = (os.getenv("COS_SECRET_ID") or "").strip()
    cos_secret_key = (os.getenv("COS_SECRET_KEY") or "").strip()
    cos_region = (os.getenv("COS_REGION") or "").strip()
    cos_token = (os.getenv("COS_TOKEN") or "").strip() or None
    missing = [
        name
        for name, value in [
            ("SUPABASE_URL", supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", supabase_key),
            ("COS_SECRET_ID", cos_secret_id),
            ("COS_SECRET_KEY", cos_secret_key),
            ("COS_REGION", cos_region),
        ]
        if not value
    ]
    if missing:
        raise RuntimeError(f"missing required configuration: {', '.join(missing)}")
    report_file = Path(args.report_file).resolve() if args.report_file else None
    return RuntimeConfig(
        env_file=env_file,
        supabase_url=supabase_url,
        supabase_key=supabase_key,
        cos_secret_id=cos_secret_id,
        cos_secret_key=cos_secret_key,
        cos_region=cos_region,
        cos_token=cos_token,
        source_buckets=parse_bucket_list(args.source_buckets),
        bucket_map=parse_bucket_map(args.bucket_map),
        dry_run=bool(args.dry_run),
        deep_verify=bool(args.deep_verify),
        skip_existing=bool(args.skip_existing),
        delete_extra=bool(args.delete_extra),
        verbose_objects=bool(args.verbose_objects),
        report_file=report_file,
    )


def retry_request(
    method: str,
    url: str,
    *,
    headers: Dict[str, str],
    json_body: dict | None = None,
    timeout: int = 120,
    retries: int = 4,
) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            response = requests.request(method, url, headers=headers, json=json_body, timeout=timeout)
            if response.status_code >= 500:
                raise RuntimeError(f"HTTP {response.status_code}: {response.text[:300]}")
            return response
        except Exception as err:  # noqa: BLE001
            last_error = err
            if attempt < retries:
                time.sleep(2 ** (attempt - 1))
                continue
            raise RuntimeError(f"request failed: {method} {url} | {err}") from err
    raise RuntimeError(f"request failed: {method} {url} | {last_error}")


class SupabaseStorageClient:
    def __init__(self, base_url: str, service_role_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

    def list_buckets(self) -> List[str]:
        response = retry_request("GET", f"{self.base_url}/storage/v1/bucket", headers=self.headers)
        response.raise_for_status()
        return [item["id"] for item in response.json()]

    def list_objects(self, bucket: str, prefix: str = "", limit: int = 1000) -> List[ObjectItem]:
        result: List[ObjectItem] = []
        pending_prefixes = [prefix]
        seen_prefixes = {prefix}
        max_workers = 12

        def list_one_prefix(current_prefix: str) -> tuple[List[ObjectItem], List[str]]:
            prefix_result: List[ObjectItem] = []
            nested_prefixes: List[str] = []
            offset = 0
            page = 0
            while True:
                page += 1
                payload = {
                    "prefix": current_prefix,
                    "limit": limit,
                    "offset": offset,
                    "sortBy": {"column": "name", "order": "asc"},
                }
                response = retry_request(
                    "POST",
                    f"{self.base_url}/storage/v1/object/list/{bucket}",
                    headers=self.headers,
                    json_body=payload,
                )
                if response.status_code != 200:
                    raise RuntimeError(
                        f"failed to list objects for {bucket}/{current_prefix}: {response.status_code} {response.text[:300]}"
                    )
                items = response.json()
                if not items:
                    break
                for item in items:
                    metadata = item.get("metadata")
                    name = item.get("name")
                    if metadata is None:
                        nested_prefix = f"{current_prefix}{name}/" if current_prefix else f"{name}/"
                        nested_prefixes.append(nested_prefix)
                    else:
                        full_key = f"{current_prefix}{name}"
                        prefix_result.append(
                            ObjectItem(
                                bucket=bucket,
                                key=full_key,
                                size=int((metadata or {}).get("size") or 0),
                            )
                        )
                if not current_prefix or page > 1:
                    log(
                        f"  source list page={page} prefix='{current_prefix or '/'}' "
                        f"items={len(items)} accumulated={len(prefix_result)}"
                    )
                if len(items) < limit:
                    break
                offset += limit
            return prefix_result, nested_prefixes

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            while pending_prefixes:
                batch = pending_prefixes
                pending_prefixes = []
                futures = [executor.submit(list_one_prefix, current_prefix) for current_prefix in batch]
                for future in as_completed(futures):
                    prefix_result, nested_prefixes = future.result()
                    result.extend(prefix_result)
                    for nested_prefix in nested_prefixes:
                        if nested_prefix not in seen_prefixes:
                            seen_prefixes.add(nested_prefix)
                            pending_prefixes.append(nested_prefix)
                log(
                    f"  source list batch prefixes={len(batch)} "
                    f"objects={len(result)} queued_prefixes={len(pending_prefixes)}"
                )
        return result

    def download(self, bucket: str, key: str) -> bytes:
        quoted = quote(key, safe="/")
        response = retry_request(
            "GET",
            f"{self.base_url}/storage/v1/object/{bucket}/{quoted}",
            headers=self.headers,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"failed to download object {bucket}/{key}: {response.status_code} {response.text[:200]}"
            )
        return response.content


class CosBucketClient:
    def __init__(
        self,
        *,
        secret_id: str,
        secret_key: str,
        region: str,
        bucket: str,
        token: str | None = None,
    ) -> None:
        config = CosConfig(
            Region=region,
            SecretId=secret_id,
            SecretKey=secret_key,
            Token=token,
            Scheme="https",
        )
        self.bucket = bucket
        self.client = CosS3Client(config)

    def upload_bytes(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=BytesIO(data), EnableMD5=False)

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def download(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        return response["Body"].get_raw_stream().read()

    def list_objects(self) -> Dict[str, int]:
        result: Dict[str, int] = {}
        marker = ""
        page = 0
        while True:
            page += 1
            response = self.client.list_objects(
                Bucket=self.bucket,
                Prefix="",
                Marker=marker,
                MaxKeys=1000,
            )
            contents = response.get("Contents", []) or []
            for item in contents:
                key = str(item.get("Key") or "")
                if not key:
                    continue
                result[key] = int(item.get("Size") or 0)
            log(
                f"  target list page={page} bucket={self.bucket} "
                f"items={len(contents)} accumulated={len(result)}"
            )
            if not response.get("IsTruncated"):
                break
            marker = str(response.get("NextMarker") or "")
            if not marker and contents:
                marker = str(contents[-1].get("Key") or "")
            if not marker:
                break
        return result


def resolve_target_bucket(source_bucket: str, cli_map: Dict[str, str]) -> str:
    if source_bucket in cli_map and cli_map[source_bucket].strip():
        return cli_map[source_bucket].strip()
    env_name = ENV_BUCKET_MAP.get(source_bucket, "")
    if env_name:
        candidate = (os.getenv(env_name) or "").strip()
        if candidate:
            return candidate
    raise RuntimeError(
        f"no target COS bucket configured for source bucket {source_bucket}; "
        f"use --bucket-map or set {ENV_BUCKET_MAP.get(source_bucket, 'matching COS env var')}"
    )


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_report(path: Path, report: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    try:
        config = load_runtime_config(parse_args())
    except Exception as err:  # noqa: BLE001
        print(f"configuration error: {err}", file=sys.stderr, flush=True)
        return 2

    source = SupabaseStorageClient(config.supabase_url, config.supabase_key)
    try:
        source_buckets = config.source_buckets or source.list_buckets()
    except Exception as err:  # noqa: BLE001
        print(f"failed to discover source buckets: {err}", file=sys.stderr, flush=True)
        return 1

    cos_clients: Dict[str, CosBucketClient] = {}

    def cos_client(bucket_name: str) -> CosBucketClient:
        if bucket_name not in cos_clients:
            cos_clients[bucket_name] = CosBucketClient(
                secret_id=config.cos_secret_id,
                secret_key=config.cos_secret_key,
                region=config.cos_region,
                bucket=bucket_name,
                token=config.cos_token,
            )
        return cos_clients[bucket_name]

    report: Dict[str, object] = {
        "source_buckets": source_buckets,
        "dry_run": config.dry_run,
        "deep_verify": config.deep_verify,
        "skip_existing": config.skip_existing,
        "delete_extra": config.delete_extra,
        "buckets": [],
    }

    try:
        for source_bucket in source_buckets:
            target_bucket = resolve_target_bucket(source_bucket, config.bucket_map)
            log(f"Syncing {source_bucket} -> {target_bucket}")
            objects = source.list_objects(source_bucket)
            objects.sort(key=lambda item: item.key)
            log(f"  discovered {len(objects)} source objects")
            target = cos_client(target_bucket)
            log("  loading target object index...")
            target_map = target.list_objects()
            log(f"  target currently has {len(target_map)} objects")
            bucket_report = {
                "source_bucket": source_bucket,
                "target_bucket": target_bucket,
                "total_objects": len(objects),
                "uploaded": 0,
                "deleted": 0,
                "skipped": 0,
                "verified": 0,
                "planned_upload": 0,
                "planned_overwrite": 0,
                "planned_delete": 0,
                "mismatches": [],
            }
            for index, obj in enumerate(objects, 1):
                if config.verbose_objects:
                    log(f"  [{index}/{len(objects)}] {obj.key}")
                elif index == 1 or index % 200 == 0 or index == len(objects):
                    log(f"  progress {index}/{len(objects)} key={obj.key}")
                target_size = target_map.get(obj.key)
                same_size = target_size is not None and target_size == obj.size
                if config.dry_run:
                    if same_size and config.skip_existing:
                        bucket_report["skipped"] += 1
                    else:
                        bucket_report["planned_upload"] += 1
                        if target_size is not None:
                            bucket_report["planned_overwrite"] += 1
                    continue

                if same_size and config.skip_existing:
                    bucket_report["skipped"] += 1
                else:
                    log(f"  transferring {obj.key} size={obj.size}")
                    content = source.download(obj.bucket, obj.key)
                    target.upload_bytes(obj.key, content)
                    bucket_report["uploaded"] += 1
                    target_map[obj.key] = len(content)

                if config.deep_verify:
                    source_bytes = source.download(obj.bucket, obj.key)
                    target_bytes = target.download(obj.key)
                    if sha256_hex(source_bytes) != sha256_hex(target_bytes):
                        bucket_report["mismatches"].append(
                            {"key": obj.key, "reason": "sha256 mismatch"}
                        )
                    else:
                        bucket_report["verified"] += 1
                else:
                    latest_size = target_map.get(obj.key, -1)
                    if latest_size != obj.size:
                        bucket_report["mismatches"].append(
                            {
                                "key": obj.key,
                                "reason": f"size mismatch source={obj.size} target={latest_size}",
                            }
                        )
                    else:
                        bucket_report["verified"] += 1

            source_map = {obj.key: obj.size for obj in objects}
            missing_keys = sorted(key for key in source_map if key not in target_map)
            extra_keys = sorted(key for key in target_map if key not in source_map)
            if config.dry_run:
                bucket_report["planned_delete"] = len(extra_keys) if config.delete_extra else 0
            else:
                if extra_keys and config.delete_extra:
                    for index, key in enumerate(extra_keys, 1):
                        if config.verbose_objects:
                            log(f"  deleting extra [{index}/{len(extra_keys)}] {key}")
                        elif index == 1 or index % 200 == 0 or index == len(extra_keys):
                            log(f"  delete progress {index}/{len(extra_keys)} key={key}")
                        target.delete(key)
                        target_map.pop(key, None)
                        bucket_report["deleted"] += 1
                    extra_keys = []
                missing_keys = sorted(key for key in source_map if key not in target_map)
                extra_keys = sorted(key for key in target_map if key not in source_map)
                for key in missing_keys:
                    bucket_report["mismatches"].append({"key": key, "reason": "missing in target"})
                for key in extra_keys:
                    if not config.delete_extra:
                        continue
                    bucket_report["mismatches"].append({"key": key, "reason": "extra in target"})
                for key, source_size in source_map.items():
                    target_size = target_map.get(key)
                    if target_size is not None and target_size != source_size:
                        bucket_report["mismatches"].append(
                            {
                                "key": key,
                                "reason": f"final size mismatch source={source_size} target={target_size}",
                            }
                        )

            report["buckets"].append(bucket_report)
            log(
                "  summary: "
                f"uploaded={bucket_report['uploaded']} "
                f"deleted={bucket_report['deleted']} "
                f"skipped={bucket_report['skipped']} "
                f"verified={bucket_report['verified']} "
                f"planned_upload={bucket_report['planned_upload']} "
                f"planned_delete={bucket_report['planned_delete']} "
                f"mismatches={len(bucket_report['mismatches'])}"
            )
    except Exception as err:  # noqa: BLE001
        print(f"sync failed: {err}", file=sys.stderr, flush=True)
        traceback.print_exc()
        return 1

    if config.report_file:
        write_report(config.report_file, report)
        log(f"Sync report written to: {config.report_file}")

    mismatches = [
        mismatch
        for bucket in report["buckets"]  # type: ignore[index]
        for mismatch in bucket["mismatches"]  # type: ignore[index]
    ]
    if mismatches:
        print("verification failed; mismatched objects found.", file=sys.stderr, flush=True)
        return 1

    log("storage sync verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
