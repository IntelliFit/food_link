"""
将 Supabase Storage 对象全量复制到腾讯云 COS。

默认行为：
1) 自动发现 Supabase 全部 bucket（也可通过 --source-buckets 指定）
2) 将对象上传到单个 COS bucket
3) 默认在 COS key 前加上 "源bucket名/" 前缀，避免不同源 bucket 文件名冲突

环境变量（建议写在 backend/.env）：
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- COS_SECRET_ID
- COS_SECRET_KEY
- COS_REGION          例如 ap-shanghai
- COS_BUCKET          默认目标桶（可选，作为兜底）

可选：按源 bucket 分别指定目标桶（优先级高于 COS_BUCKET）
- COS_FOOD_IMAGES_BUCKET
- COS_HEALTH_REPORTS_BUCKET
- COS_USER_AVATARS_BUCKET
- COS_ICON_BUCKET

可选环境变量：
- COS_TOKEN           临时密钥时使用
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from io import BytesIO
from typing import Dict, Iterable, List, Optional
from urllib.parse import quote

import requests
from dotenv import load_dotenv

try:
    from qcloud_cos import CosConfig, CosS3Client  # type: ignore
except Exception:  # pragma: no cover - 运行时提示安装依赖
    CosConfig = None
    CosS3Client = None


def _retry_request(
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    json_body: Optional[dict] = None,
    timeout: int = 60,
    retries: int = 3,
) -> requests.Response:
    last_error: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.request(method, url, headers=headers, json=json_body, timeout=timeout)
            if resp.status_code >= 500:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
            return resp
        except Exception as err:  # noqa: BLE001
            last_error = err
            if attempt < retries:
                time.sleep(2 ** (attempt - 1))
            else:
                raise RuntimeError(f"请求失败: {method} {url} | {err}") from err
    raise RuntimeError(f"请求失败: {method} {url} | {last_error}")


@dataclass
class ObjectItem:
    bucket: str
    key: str
    size: int


class SupabaseStorageClient:
    def __init__(self, base_url: str, service_role_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

    def list_buckets(self) -> List[str]:
        resp = _retry_request("GET", f"{self.base_url}/storage/v1/bucket", headers=self.headers)
        resp.raise_for_status()
        data = resp.json()
        return [item["id"] for item in data]

    def list_objects(self, bucket: str, prefix: str = "", limit: int = 1000) -> List[ObjectItem]:
        results: List[ObjectItem] = []
        offset = 0
        while True:
            body = {
                "prefix": prefix,
                "limit": limit,
                "offset": offset,
                "sortBy": {"column": "name", "order": "asc"},
            }
            resp = _retry_request(
                "POST",
                f"{self.base_url}/storage/v1/object/list/{bucket}",
                headers=self.headers,
                json_body=body,
            )
            if resp.status_code != 200:
                raise RuntimeError(f"列举对象失败: {bucket}/{prefix} -> {resp.status_code}: {resp.text[:300]}")
            items = resp.json()
            if not items:
                break
            for item in items:
                metadata = item.get("metadata")
                name = item.get("name")
                if metadata is None:
                    sub_prefix = f"{prefix}{name}/" if prefix else f"{name}/"
                    results.extend(self.list_objects(bucket=bucket, prefix=sub_prefix, limit=limit))
                else:
                    size = int((metadata or {}).get("size") or 0)
                    full_key = f"{prefix}{name}"
                    results.append(ObjectItem(bucket=bucket, key=full_key, size=size))
            if len(items) < limit:
                break
            offset += limit
        return results

    def download(self, bucket: str, key: str) -> bytes:
        quoted = quote(key, safe="/")
        url = f"{self.base_url}/storage/v1/object/{bucket}/{quoted}"
        resp = _retry_request("GET", url, headers=self.headers, timeout=120, retries=4)
        if resp.status_code != 200:
            raise RuntimeError(f"下载失败: {bucket}/{key} -> {resp.status_code}: {resp.text[:200]}")
        return resp.content


class CosStorageClient:
    def __init__(
        self,
        *,
        secret_id: str,
        secret_key: str,
        region: str,
        bucket: str,
        token: Optional[str] = None,
    ) -> None:
        if CosConfig is None or CosS3Client is None:
            raise RuntimeError("缺少依赖 qcloud-cos-sdk，请先执行: pip install cos-python-sdk-v5")
        config = CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key, Token=token, Scheme="https")
        self.client = CosS3Client(config)
        self.bucket = bucket

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:  # noqa: BLE001
            return False

    def upload_bytes(self, key: str, data: bytes) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Body=BytesIO(data),
            Key=key,
            EnableMD5=False,
        )


def parse_bucket_mapping(mapping_text: str) -> Dict[str, str]:
    # 例：food-images:cos-food,health-reports:cos-health
    mapping: Dict[str, str] = {}
    if not mapping_text.strip():
        return mapping
    for pair in mapping_text.split(","):
        pair = pair.strip()
        if not pair:
            continue
        if ":" not in pair:
            raise ValueError(f"--bucket-map 格式错误: {pair}")
        src, dst = pair.split(":", 1)
        mapping[src.strip()] = dst.strip()
    return mapping


def iter_source_buckets(args: argparse.Namespace, sb: SupabaseStorageClient) -> List[str]:
    if args.source_buckets:
        return [s.strip() for s in args.source_buckets.split(",") if s.strip()]
    return sb.list_buckets()


def build_target_key(source_bucket: str, source_key: str, args: argparse.Namespace) -> str:
    key = source_key.lstrip("/")
    if args.no_bucket_prefix:
        return key
    return f"{source_bucket}/{key}"


ENV_BUCKET_MAP = {
    "food-images": "COS_FOOD_IMAGES_BUCKET",
    "health-reports": "COS_HEALTH_REPORTS_BUCKET",
    "user-avatars": "COS_USER_AVATARS_BUCKET",
    "icon": "COS_ICON_BUCKET",
}


def resolve_target_bucket(
    source_bucket: str,
    *,
    cli_map: Dict[str, str],
    default_bucket: str,
) -> str:
    # 优先级：CLI --bucket-map > 专用环境变量 > COS_BUCKET
    from_cli = (cli_map.get(source_bucket) or "").strip()
    if from_cli:
        return from_cli

    env_name = ENV_BUCKET_MAP.get(source_bucket, "")
    if env_name:
        from_env = (os.getenv(env_name) or "").strip()
        if from_env:
            return from_env

    return default_bucket


def main() -> int:
    parser = argparse.ArgumentParser(description="将 Supabase Storage 全量迁移到腾讯云 COS")
    parser.add_argument("--env-file", default="backend/.env", help="环境变量文件路径，默认 backend/.env")
    parser.add_argument("--source-buckets", default="", help="仅迁移指定源 bucket，逗号分隔")
    parser.add_argument("--bucket-map", default="", help="源bucket到目标bucket映射，格式 src1:dst1,src2:dst2")
    parser.add_argument("--no-bucket-prefix", action="store_true", help="上传到 COS 时不加源bucket前缀")
    parser.add_argument("--skip-existing", action="store_true", help="若对象已存在则跳过上传")
    parser.add_argument("--dry-run", action="store_true", help="仅打印迁移计划，不实际上传")
    args = parser.parse_args()

    load_dotenv(args.env_file)

    supabase_url = (os.getenv("SUPABASE_URL") or "").strip()
    supabase_key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    cos_secret_id = (os.getenv("COS_SECRET_ID") or "").strip()
    cos_secret_key = (os.getenv("COS_SECRET_KEY") or "").strip()
    cos_region = (os.getenv("COS_REGION") or "").strip()
    default_cos_bucket = (os.getenv("COS_BUCKET") or "").strip()
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
        print(f"缺少必需环境变量: {', '.join(missing)}")
        return 2

    bucket_map = parse_bucket_mapping(args.bucket_map)

    sb = SupabaseStorageClient(supabase_url, supabase_key)
    cos_clients: Dict[str, CosStorageClient] = {}

    def get_cos_client(bucket_name: str) -> CosStorageClient:
        if bucket_name not in cos_clients:
            cos_clients[bucket_name] = CosStorageClient(
                secret_id=cos_secret_id,
                secret_key=cos_secret_key,
                region=cos_region,
                bucket=bucket_name,
                token=cos_token,
            )
        return cos_clients[bucket_name]

    source_buckets = iter_source_buckets(args, sb)
    if not source_buckets:
        print("未发现可迁移的源 bucket。")
        return 0

    print("将迁移以下源 bucket:")
    for b in source_buckets:
        target_bucket = resolve_target_bucket(
            b,
            cli_map=bucket_map,
            default_bucket=default_cos_bucket,
        )
        if not target_bucket:
            print(
                f"  - {b} -> <未配置，请设置 --bucket-map 或 {ENV_BUCKET_MAP.get(b, 'COS_BUCKET')}>"
            )
            continue
        print(f"  - {b} -> {target_bucket}")
    print("")

    total_files = 0
    total_bytes = 0
    uploaded = 0
    skipped = 0
    failed = 0

    for source_bucket in source_buckets:
        try:
            objects = sb.list_objects(source_bucket)
        except Exception as err:  # noqa: BLE001
            print(f"[ERROR] 列举 bucket 失败: {source_bucket} | {err}")
            failed += 1
            continue

        print(f"[INFO] {source_bucket}: {len(objects)} 个对象")
        total_files += len(objects)
        total_bytes += sum(obj.size for obj in objects)

        target_bucket = resolve_target_bucket(
            source_bucket,
            cli_map=bucket_map,
            default_bucket=default_cos_bucket,
        )
        if not target_bucket:
            failed += len(objects)
            print(
                f"[ERROR] 目标桶未配置: {source_bucket}。"
                f" 请设置 --bucket-map 或环境变量 {ENV_BUCKET_MAP.get(source_bucket, 'COS_BUCKET')}"
            )
            continue
        cos_client = get_cos_client(target_bucket)

        for idx, obj in enumerate(objects, 1):
            target_key = build_target_key(source_bucket, obj.key, args)
            progress = f"{source_bucket} [{idx}/{len(objects)}] {obj.key}"

            try:
                if args.skip_existing and cos_client.exists(target_key):
                    skipped += 1
                    print(f"[SKIP] {progress} -> {target_bucket}/{target_key}")
                    continue

                if args.dry_run:
                    print(f"[PLAN] {progress} -> {target_bucket}/{target_key}")
                    continue

                content = sb.download(source_bucket, obj.key)
                cos_client.upload_bytes(target_key, content)
                uploaded += 1
                print(f"[OK]   {progress} -> {target_bucket}/{target_key}")
            except Exception as err:  # noqa: BLE001
                failed += 1
                print(f"[FAIL] {progress} | {err}")

    print("\n===== 迁移完成 =====")
    print(f"源对象总数: {total_files}")
    print(f"源总大小: {total_bytes / 1024 / 1024:.2f} MB")
    print(f"成功上传: {uploaded}")
    print(f"跳过已存在: {skipped}")
    print(f"失败数: {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

