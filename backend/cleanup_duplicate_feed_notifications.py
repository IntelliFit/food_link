"""
清理历史重复互动通知。

默认只预览，加 --apply 才会实际删除。

规则：
- 同 recipient / actor / record / parent / notification_type / content_preview
- 若 comment_id 相同，视为同一事件重复写入
- 或在时间窗口内出现多条高度相似通知，只保留最早一条
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv

from database import get_supabase_client


BACKEND_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(BACKEND_ENV_PATH, override=False)


NotificationRow = Dict[str, Any]
Signature = Tuple[str, str, str, str, str, str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="清理历史重复互动通知")
    parser.add_argument("--window-seconds", type=int, default=45, help="宽松重复窗口（秒）")
    parser.add_argument("--page-size", type=int, default=1000, help="分页抓取大小")
    parser.add_argument("--apply", action="store_true", help="实际删除")
    return parser.parse_args()


def parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def build_signature(row: NotificationRow) -> Signature:
    return (
        str(row.get("recipient_user_id") or "").strip(),
        str(row.get("actor_user_id") or "").strip(),
        str(row.get("record_id") or "").strip(),
        str(row.get("parent_comment_id") or "").strip(),
        str(row.get("notification_type") or "").strip(),
        str(row.get("content_preview") or "").strip(),
    )


def fetch_all_notifications(page_size: int) -> List[NotificationRow]:
    supabase = get_supabase_client()
    rows: List[NotificationRow] = []
    offset = 0
    while True:
        result = (
            supabase.table("feed_interaction_notifications")
            .select("id, recipient_user_id, actor_user_id, record_id, comment_id, parent_comment_id, notification_type, content_preview, created_at")
            .order("created_at", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = list(result.data or [])
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def find_duplicate_notification_ids(rows: List[NotificationRow], window_seconds: int) -> Tuple[List[str], List[Dict[str, Any]]]:
    grouped: Dict[Signature, List[NotificationRow]] = defaultdict(list)
    for row in rows:
        signature = build_signature(row)
        if not signature[0] or not signature[4]:
            continue
        grouped[signature].append(row)

    duplicate_ids: List[str] = []
    duplicate_groups: List[Dict[str, Any]] = []

    for signature, items in grouped.items():
        if len(items) < 2:
            continue
        items = sorted(items, key=lambda item: item.get("created_at") or "")
        current_cluster: List[NotificationRow] = []
        cluster_anchor: Optional[datetime] = None

        def flush_cluster() -> None:
            if len(current_cluster) <= 1:
                return
            keep = current_cluster[0]
            drop = current_cluster[1:]
            duplicate_ids.extend([str(item["id"]) for item in drop if item.get("id")])
            duplicate_groups.append({
                "signature": signature,
                "keep_id": keep.get("id"),
                "keep_created_at": keep.get("created_at"),
                "drop_ids": [item.get("id") for item in drop],
                "content": signature[5],
                "notification_type": signature[4],
            })

        for row in items:
            created_at = parse_iso_datetime(row.get("created_at"))
            if not current_cluster:
                current_cluster = [row]
                cluster_anchor = created_at
                continue

            previous = current_cluster[-1]
            same_comment_id = (
                str(previous.get("comment_id") or "").strip()
                and str(previous.get("comment_id") or "").strip() == str(row.get("comment_id") or "").strip()
            )
            if same_comment_id:
                current_cluster.append(row)
                continue

            if cluster_anchor and created_at and (created_at - cluster_anchor).total_seconds() <= window_seconds:
                current_cluster.append(row)
                continue

            flush_cluster()
            current_cluster = [row]
            cluster_anchor = created_at

        flush_cluster()

    return duplicate_ids, duplicate_groups


def delete_notifications(notification_ids: List[str]) -> int:
    if not notification_ids:
        return 0
    supabase = get_supabase_client()
    deleted = 0
    batch_size = 100
    for index in range(0, len(notification_ids), batch_size):
        batch = notification_ids[index:index + batch_size]
        supabase.table("feed_interaction_notifications").delete().in_("id", batch).execute()
        deleted += len(batch)
    return deleted


def main() -> int:
    args = parse_args()
    rows = fetch_all_notifications(args.page_size)
    duplicate_ids, duplicate_groups = find_duplicate_notification_ids(rows, args.window_seconds)

    print(f"总通知数: {len(rows)}")
    print(f"重复簇数量: {len(duplicate_groups)}")
    print(f"待删除重复通知数: {len(duplicate_ids)}")
    for group in duplicate_groups[:20]:
        print(
            f"- 保留 {group['keep_id']} @ {group['keep_created_at']} | "
            f"删除 {len(group['drop_ids'])} 条 | {group['notification_type']} | 内容: {group['content'][:50]}"
        )

    if not args.apply:
        print("当前为预览模式，未执行删除。加 --apply 才会实际清理。")
        return 0

    deleted = delete_notifications(duplicate_ids)
    print(f"实际删除通知数: {deleted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
