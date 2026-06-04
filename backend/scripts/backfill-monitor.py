#!/usr/bin/env python3
"""实时监控标准食物图片回填各分片进度（DashScope / Qwen 视觉判定）。"""
import argparse
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SHARD_TARGET = 500
REFRESH_DEFAULT_SEC = 10
ACTIVE_WRITE_SEC = 45  # 此秒数内有文件更新视为「可能仍在跑」

# results/state 中可能有切换模型前的旧状态；监控统一按视觉 API 失败展示。
API_FAIL_STATUSES = frozenset({"vision_failed", "kimi_failed"})


def load_json(path: Path) -> dict | None:
    if not path.is_file():
        return None
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    if not raw.strip():
        return None
    return json.loads(raw.decode("utf-8"))


def summarize_state(state_path: Path) -> dict:
    data = load_json(state_path)
    if not data:
        return {
            "entries": 0,
            "counts": Counter(),
            "ok": 0,
            "api_fail": 0,
            "pending_retry": 0,
        }
    entries = data.get("entries") or {}
    counts = Counter(e.get("status", "unknown") for e in entries.values())
    ok = counts.get("db_updated", 0) + counts.get("dry_run_match", 0)
    api_fail = sum(counts.get(s, 0) for s in API_FAIL_STATUSES)
    pending_retry = sum(
        counts.get(s, 0)
        for s in (
            "vision_failed",
            "kimi_failed",
            "db_update_failed",
            "upload_failed",
            "search_failed",
            "download_failed",
        )
    )
    return {
        "entries": len(entries),
        "counts": counts,
        "ok": ok,
        "api_fail": api_fail,
        "pending_retry": pending_retry,
    }


def summarize_results_tail(results_path: Path, tail_n: int = 1) -> dict:
    if not results_path.is_file():
        return {"lines": 0, "latest_name": "", "latest_status": "", "latest_reason": ""}
    lines = 0
    last_row = {}
    try:
        with results_path.open(encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                lines += 1
                last_row = json.loads(line)
    except Exception:
        pass
    reason = (last_row.get("reason") or "")[:80]
    if len(last_row.get("reason") or "") > 80:
        reason += "…"
    return {
        "lines": lines,
        "latest_name": last_row.get("food_name", ""),
        "latest_status": last_row.get("status", ""),
        "latest_reason": reason,
    }


def read_run_meta(shard_dir: Path) -> dict:
    meta = load_json(shard_dir / "run-meta.json") or {}
    started = meta.get("started_at")
    finished = meta.get("finished_at")
    return {
        "workers": meta.get("workers"),
        "apply": meta.get("apply"),
        "started_at": started,
        "finished_at": finished,
        "exit_code": meta.get("exit_code"),
    }


def parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def file_age_sec(path: Path) -> float | None:
    if not path.is_file():
        return None
    return time.time() - path.stat().st_mtime


def activity_label(shard_dir: Path) -> str:
    """根据 state/results 最近写入时间推断是否在跑（无 go 进程时也可用）。"""
    ages = []
    for name in ("state.json", "results.jsonl", "run.log"):
        age = file_age_sec(shard_dir / name)
        if age is not None:
            ages.append(age)
    if not ages:
        return "无数据"
    min_age = min(ages)
    if min_age <= ACTIVE_WRITE_SEC:
        return "写入中"
    meta = read_run_meta(shard_dir)
    if meta.get("finished_at"):
        return "已结束"
    return "空闲"


def display_counts(counts: Counter, total: int) -> None:
    """按业务含义排序展示状态；合并旧状态与当前 Qwen 视觉失败。"""
    merged = Counter(counts)
    if merged.get("kimi_failed") or merged.get("vision_failed"):
        merged["视觉API失败"] = merged.get("vision_failed", 0) + merged.get("kimi_failed", 0)
        if "vision_failed" in merged:
            del merged["vision_failed"]
        if "kimi_failed" in merged:
            del merged["kimi_failed"]

    order = [
        "db_updated",
        "dry_run_match",
        "视觉API失败",
        "db_update_failed",
        "no_match",
        "search_failed",
        "download_failed",
        "upload_failed",
    ]
    shown = set()
    for key in order:
        if key in merged and merged[key]:
            n = merged[key]
            pct = 100.0 * n / total if total else 0
            print(f"      {key}: {n} ({pct:.1f}%)")
            shown.add(key)
    for key, n in merged.most_common():
        if key in shown or not n:
            continue
        pct = 100.0 * n / total if total else 0
        print(f"      {key}: {n} ({pct:.1f}%)")


def main() -> int:
    parser = argparse.ArgumentParser(description="标准食物图片回填分片监控")
    parser.add_argument(
        "-i",
        "--interval",
        type=int,
        default=REFRESH_DEFAULT_SEC,
        help=f"刷新间隔秒数（默认 {REFRESH_DEFAULT_SEC}）",
    )
    parser.add_argument(
        "--shards",
        type=str,
        default="",
        help="只监控指定分片，逗号分隔，如 1,2,3",
    )
    args = parser.parse_args()
    if args.interval < 1:
        print("interval 至少为 1", file=sys.stderr)
        return 2

    root = Path(__file__).parent.parent / "data" / "standard-food-image-backfill" / "runs"
    if not root.exists():
        print(f"目录不存在: {root}")
        return 1

    filter_shards: set[str] | None = None
    if args.shards.strip():
        filter_shards = {f"shard-{int(s):04d}" for s in args.shards.replace(" ", "").split(",") if s}

    prev_entries: dict[str, int] = {}
    while True:
        os.system("cls" if os.name == "nt" else "clear")
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        print(f"=== 标准食物图片回填监控 [{now}] ===")
        print(f"视觉模型: DashScope / Qwen")
        print(f"刷新间隔: {args.interval} 秒 | 分片目标: 每片 {SHARD_TARGET} 条（state 唯一食物数）\n")

        shards = sorted(d for d in root.iterdir() if d.is_dir() and d.name.startswith("shard-"))
        if filter_shards:
            shards = [d for d in shards if d.name in filter_shards]

        grand_ok = 0
        grand_entries = 0
        grand_active = 0

        for shard_dir in shards:
            state_info = summarize_state(shard_dir / "state.json")
            results_info = summarize_results_tail(shard_dir / "results.jsonl")
            meta = read_run_meta(shard_dir)

            prev = prev_entries.get(shard_dir.name, state_info["entries"])
            delta = state_info["entries"] - prev
            prev_entries[shard_dir.name] = state_info["entries"]

            grand_ok += state_info["ok"]
            grand_entries += state_info["entries"]

            activity = activity_label(shard_dir)
            if activity == "写入中":
                grand_active += 1
            icon = {"写入中": "[>>]", "已结束": "[OK]", "空闲": "[--]", "无数据": "[  ]"}.get(activity, "[--]")

            pct_shard = 100.0 * state_info["ok"] / SHARD_TARGET if SHARD_TARGET else 0
            workers = meta.get("workers")
            wtxt = f"workers={workers}" if workers else "workers=?"
            apply_txt = "apply" if meta.get("apply") else "dry-run"
            print(
                f"{icon} {shard_dir.name} [{activity}] {wtxt} {apply_txt} | "
                f"成功 {state_info['ok']}/{SHARD_TARGET} ({pct_shard:.1f}%) | "
                f"state {state_info['entries']} 条 | +{delta}/轮 | "
                f"results行 {results_info['lines']}"
            )
            if meta.get("started_at"):
                fin = meta.get("finished_at") or "进行中"
                print(f"      运行: {meta['started_at']} → {fin}")
            if state_info["entries"]:
                display_counts(state_info["counts"], state_info["entries"])
            if results_info["latest_name"]:
                st = results_info["latest_status"]
                if st in API_FAIL_STATUSES:
                    st = "视觉API失败"
                print(f"      最新结果: [{st}] {results_info['latest_name']}")
                if results_info["latest_reason"]:
                    print(f"      原因: {results_info['latest_reason']}")
            print()

        shard_n = len(shards) or 1
        target_ok = SHARD_TARGET * shard_n
        pct_all = 100.0 * grand_ok / target_ok if target_ok else 0
        print(
            f"汇总: 成功 {grand_ok}/{target_ok} ({pct_all:.1f}%) | "
            f"state 条目 {grand_entries} | 活跃分片 {grand_active}/{shard_n}"
        )
        print(f"\n按 Ctrl+C 退出。每 {args.interval} 秒刷新。")
        try:
            time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n已退出监控。")
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
