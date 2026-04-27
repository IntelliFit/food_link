"""
清理历史重复圈子评论。

规则：
- 同用户
- 同动态
- 同父评论 / 同回复目标
- 同内容（trim 后完全一致）
- 在指定时间窗口内重复出现

默认只预览，不删除；加 --apply 才会实际执行删除。

示例：
  python backend/cleanup_duplicate_feed_comments.py
  python backend/cleanup_duplicate_feed_comments.py --window-seconds 45 --apply
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv

from database import get_database_client


BACKEND_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(BACKEND_ENV_PATH, override=False)


CommentRow = Dict[str, Any]
Signature = Tuple[str, str, str, str, str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="清理历史重复圈子评论")
    parser.add_argument("--window-seconds", type=int, default=45, help="判定为重复的时间窗口（秒）")
    parser.add_argument("--page-size", type=int, default=1000, help="分页抓取评论时每页大小")
    parser.add_argument("--apply", action="store_true", help="实际删除重复评论；默认仅预览")
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


def build_signature(row: CommentRow) -> Signature:
    return (
        str(row.get("user_id") or "").strip(),
        str(row.get("record_id") or "").strip(),
        str(row.get("parent_comment_id") or "").strip(),
        str(row.get("reply_to_user_id") or "").strip(),
        str(row.get("content") or "").strip(),
    )


def fetch_all_comments(page_size: int) -> List[CommentRow]:
    db = get_database_client()
    comments: List[CommentRow] = []
    offset = 0
    while True:
        result = (
            db.table("feed_comments")
            .select("id, user_id, record_id, parent_comment_id, reply_to_user_id, content, created_at")
            .order("created_at", desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = list(result.data or [])
        comments.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return comments


def find_duplicate_comment_ids(comments: List[CommentRow], window_seconds: int) -> Tuple[List[str], List[Dict[str, Any]]]:
    grouped: Dict[Signature, List[CommentRow]] = defaultdict(list)
    for row in comments:
        signature = build_signature(row)
        if not signature[0] or not signature[1] or not signature[4]:
            continue
        grouped[signature].append(row)

    duplicate_ids: List[str] = []
    duplicate_groups: List[Dict[str, Any]] = []

    for signature, rows in grouped.items():
        if len(rows) < 2:
            continue
        sorted_rows = sorted(rows, key=lambda item: item.get("created_at") or "")
        current_cluster: List[CommentRow] = []
        cluster_anchor: Optional[datetime] = None

        def flush_cluster() -> None:
            if len(current_cluster) <= 1:
                return
            keep = current_cluster[0]
            drop = current_cluster[1:]
            duplicate_ids.extend([str(item["id"]) for item in drop if item.get("id")])
            duplicate_groups.append({
                "signature": signature,
                "content": signature[4],
                "keep_id": keep.get("id"),
                "keep_created_at": keep.get("created_at"),
                "drop_ids": [item.get("id") for item in drop],
                "drop_created_at": [item.get("created_at") for item in drop],
            })

        for row in sorted_rows:
            created_at = parse_iso_datetime(row.get("created_at"))
            if created_at is None:
                flush_cluster()
                current_cluster = [row]
                cluster_anchor = None
                continue

            if not current_cluster:
                current_cluster = [row]
                cluster_anchor = created_at
                continue

            if cluster_anchor and (created_at - cluster_anchor).total_seconds() <= window_seconds:
                current_cluster.append(row)
                continue

            flush_cluster()
            current_cluster = [row]
            cluster_anchor = created_at

        flush_cluster()

    return duplicate_ids, duplicate_groups


def delete_comments(comment_ids: List[str]) -> int:
    if not comment_ids:
        return 0
    db = get_database_client()
    deleted = 0
    batch_size = 100
    for index in range(0, len(comment_ids), batch_size):
        batch = comment_ids[index:index + batch_size]
        db.table("feed_comments").delete().in_("id", batch).execute()
        deleted += len(batch)
    return deleted


def main() -> int:
    args = parse_args()
    comments = fetch_all_comments(args.page_size)
    duplicate_ids, duplicate_groups = find_duplicate_comment_ids(comments, args.window_seconds)

    print(f"总评论数: {len(comments)}")
    print(f"重复簇数量: {len(duplicate_groups)}")
    print(f"待删除重复评论数: {len(duplicate_ids)}")

    for group in duplicate_groups[:20]:
        preview = group["content"][:50]
        print(
            f"- 保留 {group['keep_id']} @ {group['keep_created_at']} | "
            f"删除 {len(group['drop_ids'])} 条 | 内容: {preview}"
        )

    if not args.apply:
        print("当前为预览模式，未执行删除。加 --apply 才会实际清理。")
        return 0

    deleted = delete_comments(duplicate_ids)
    print(f"实际删除评论数: {deleted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
