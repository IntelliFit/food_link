"""
腾讯云 COS 对象存储适配层。

职责：
1. 统一 bucket / CDN / 私有访问配置
2. 上传、下载、删除对象
3. 兼容解析旧 Supabase URL、新 CDN URL、COS URL、原始 key
4. 为私有 health-reports 生成短期签名访问地址
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, Iterable, List
from urllib.parse import quote, unquote, urlparse

try:
    from qcloud_cos import CosConfig, CosS3Client  # type: ignore
except Exception:  # pragma: no cover
    CosConfig = None
    CosS3Client = None


FOOD_IMAGES_BUCKET = "food-images"
HEALTH_REPORTS_BUCKET = "health-reports"
USER_AVATARS_BUCKET = "user-avatars"
ICON_BUCKET = "icon"

BUCKET_ENV_MAP = {
    FOOD_IMAGES_BUCKET: "COS_FOOD_IMAGES_BUCKET",
    HEALTH_REPORTS_BUCKET: "COS_HEALTH_REPORTS_BUCKET",
    USER_AVATARS_BUCKET: "COS_USER_AVATARS_BUCKET",
    ICON_BUCKET: "COS_ICON_BUCKET",
}

CDN_ENV_MAP = {
    FOOD_IMAGES_BUCKET: "CDN_FOOD_IMAGES_BASE_URL",
    USER_AVATARS_BUCKET: "CDN_USER_AVATARS_BASE_URL",
    ICON_BUCKET: "CDN_ICON_BASE_URL",
}

DEFAULT_PUBLIC_BUCKETS = {FOOD_IMAGES_BUCKET, USER_AVATARS_BUCKET, ICON_BUCKET}

_cos_client = None


@dataclass(frozen=True)
class StorageObject:
    bucket: str
    key: str
    size: int
    etag: str = ""
    last_modified: str = ""


def _ensure_cos_sdk() -> None:
    if CosConfig is None or CosS3Client is None:
        raise RuntimeError("缺少 qcloud-cos-sdk-v5，请先安装 cos-python-sdk-v5")


def get_cos_client():
    global _cos_client
    if _cos_client is None:
        _ensure_cos_sdk()
        secret_id = (os.getenv("COS_SECRET_ID") or "").strip()
        secret_key = (os.getenv("COS_SECRET_KEY") or "").strip()
        region = (os.getenv("COS_REGION") or "").strip()
        token = (os.getenv("COS_TOKEN") or "").strip() or None
        missing = [
            name
            for name, value in [
                ("COS_SECRET_ID", secret_id),
                ("COS_SECRET_KEY", secret_key),
                ("COS_REGION", region),
            ]
            if not value
        ]
        if missing:
            raise RuntimeError(f"缺少 COS 配置: {', '.join(missing)}")
        config = CosConfig(
            Region=region,
            SecretId=secret_id,
            SecretKey=secret_key,
            Token=token,
            Scheme="https",
        )
        _cos_client = CosS3Client(config)
    return _cos_client


def configured_bucket_name(bucket_alias: str) -> str:
    env_name = BUCKET_ENV_MAP.get(bucket_alias)
    value = (os.getenv(env_name or "") or "").strip() if env_name else ""
    fallback = (os.getenv("COS_BUCKET") or "").strip()
    resolved = value or fallback
    if not resolved:
        raise RuntimeError(
            f"未配置目标桶：{bucket_alias}，请设置 {env_name or '对应桶环境变量'} 或 COS_BUCKET"
        )
    return resolved


def is_private_bucket(bucket_alias: str) -> bool:
    if bucket_alias == HEALTH_REPORTS_BUCKET:
        return True
    return bucket_alias not in DEFAULT_PUBLIC_BUCKETS


def _base_url_from_env(bucket_alias: str) -> str:
    env_name = CDN_ENV_MAP.get(bucket_alias)
    return (os.getenv(env_name or "") or "").strip().rstrip("/")


def _host_from_url(value: str) -> str:
    if not value:
        return ""
    try:
        return (urlparse(value).netloc or "").strip().lower()
    except Exception:
        return ""


def _trusted_supabase_host() -> str:
    return _host_from_url((os.getenv("SUPABASE_URL") or "").strip())


def _trusted_bucket_hosts(bucket_alias: str) -> set[str]:
    hosts = set()
    base_url = _base_url_from_env(bucket_alias)
    if base_url:
        hosts.add(_host_from_url(base_url))
    try:
        hosts.add(_host_from_url(_cos_origin_base_url(bucket_alias)))
    except Exception:
        pass
    supabase_host = _trusted_supabase_host()
    if supabase_host:
        hosts.add(supabase_host)
    return {host for host in hosts if host}


def _cos_origin_base_url(bucket_alias: str) -> str:
    bucket = configured_bucket_name(bucket_alias)
    region = (os.getenv("COS_REGION") or "").strip()
    return f"https://{bucket}.cos.{region}.myqcloud.com"


def build_public_url(bucket_alias: str, key: str) -> str:
    normalized_key = key.lstrip("/")
    base_url = _base_url_from_env(bucket_alias) or _cos_origin_base_url(bucket_alias)
    return f"{base_url}/{quote(normalized_key, safe='/')}"


def build_private_signed_url(bucket_alias: str, key: str, expires: int = 3600) -> str:
    if not key:
        return ""
    bucket = configured_bucket_name(bucket_alias)
    client = get_cos_client()
    url = client.get_presigned_url(
        Method="GET",
        Bucket=bucket,
        Key=key.lstrip("/"),
        Expired=expires,
    )
    return str(url or "")


def build_access_url(bucket_alias: str, key: str, expires: int = 3600) -> str:
    if not key:
        return ""
    if is_private_bucket(bucket_alias):
        return build_private_signed_url(bucket_alias, key, expires=expires)
    return build_public_url(bucket_alias, key)


def upload_bytes(
    bucket_alias: str,
    key: str,
    content: bytes,
    *,
    content_type: str = "application/octet-stream",
) -> str:
    client = get_cos_client()
    bucket = configured_bucket_name(bucket_alias)
    object_key = key.lstrip("/")
    client.put_object(
        Bucket=bucket,
        Body=content,
        Key=object_key,
        ContentType=content_type,
        EnableMD5=False,
    )
    return object_key


def download_bytes(bucket_alias: str, key: str) -> bytes:
    client = get_cos_client()
    bucket = configured_bucket_name(bucket_alias)
    response = client.get_object(Bucket=bucket, Key=key.lstrip("/"))
    body = response["Body"]
    return body.get_raw_stream().read()


def delete_object(bucket_alias: str, key: str) -> None:
    client = get_cos_client()
    bucket = configured_bucket_name(bucket_alias)
    client.delete_object(Bucket=bucket, Key=key.lstrip("/"))


def object_exists(bucket_alias: str, key: str) -> bool:
    client = get_cos_client()
    bucket = configured_bucket_name(bucket_alias)
    try:
        client.head_object(Bucket=bucket, Key=key.lstrip("/"))
        return True
    except Exception:  # noqa: BLE001
        return False


def list_objects(bucket_alias: str, prefix: str = "") -> List[StorageObject]:
    client = get_cos_client()
    bucket = configured_bucket_name(bucket_alias)
    marker = ""
    objects: List[StorageObject] = []
    normalized_prefix = prefix.lstrip("/")
    while True:
        response = client.list_objects(
            Bucket=bucket,
            Prefix=normalized_prefix,
            Marker=marker,
            MaxKeys=1000,
        )
        for item in response.get("Contents", []) or []:
            objects.append(
                StorageObject(
                    bucket=bucket_alias,
                    key=str(item.get("Key") or ""),
                    size=int(item.get("Size") or 0),
                    etag=str(item.get("ETag") or ""),
                    last_modified=str(item.get("LastModified") or ""),
                )
            )
        if response.get("IsTruncated") != "true":
            break
        marker = str(response.get("NextMarker") or "")
        if not marker:
            break
    return objects


def bucket_aliases() -> Iterable[str]:
    return BUCKET_ENV_MAP.keys()


def resolve_object_key(value: Optional[str], bucket_alias: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        return raw.lstrip("/")

    parsed = urlparse(raw)
    path = unquote(parsed.path or "")
    netloc = (parsed.netloc or "").strip().lower()
    bucket_name = configured_bucket_name(bucket_alias)
    trusted_hosts = _trusted_bucket_hosts(bucket_alias)

    supabase_public_prefix = f"/storage/v1/object/public/{bucket_alias}/"
    supabase_private_prefix = f"/storage/v1/object/{bucket_alias}/"
    if (netloc == _trusted_supabase_host() or netloc.endswith(".supabase.co")) and supabase_public_prefix in path:
        return path.split(supabase_public_prefix, 1)[1].lstrip("/")
    if (netloc == _trusted_supabase_host() or netloc.endswith(".supabase.co")) and supabase_private_prefix in path:
        return path.split(supabase_private_prefix, 1)[1].lstrip("/")

    base_url = _base_url_from_env(bucket_alias)
    if base_url and raw.startswith(f"{base_url}/"):
        return raw.split(f"{base_url}/", 1)[1].split("?", 1)[0].lstrip("/")

    if netloc in trusted_hosts and path.startswith(f"/{bucket_alias}/"):
        return path.split(f"/{bucket_alias}/", 1)[1].lstrip("/")
    if netloc in trusted_hosts and path.startswith(f"/{bucket_name}/"):
        return path.split(f"/{bucket_name}/", 1)[1].lstrip("/")

    if f"{bucket_name}.cos." in netloc:
        return path.lstrip("/")

    if netloc in trusted_hosts:
        return path.split("?", 1)[0].lstrip("/")

    return ""


def resolve_reference_url(bucket_alias: str, value: Optional[str], expires: int = 3600) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        return build_access_url(bucket_alias, raw, expires=expires)

    key = resolve_object_key(raw, bucket_alias)
    if key:
        return build_access_url(bucket_alias, key, expires=expires)

    # 未识别为当前项目可控存储来源时，公开桶保持兼容返回原链接；
    # 私有桶则拒绝把任意外链当成可信资源，避免错误签名或绕过访问控制。
    if is_private_bucket(bucket_alias):
        return ""
    return raw


def upload_and_build_access(
    bucket_alias: str,
    key: str,
    content: bytes,
    *,
    content_type: str = "application/octet-stream",
    expires: int = 3600,
) -> Dict[str, str]:
    stored_key = upload_bytes(bucket_alias, key, content, content_type=content_type)
    return {
        "bucket": bucket_alias,
        "key": stored_key,
        "url": build_access_url(bucket_alias, stored_key, expires=expires),
    }

