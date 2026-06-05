#!/usr/bin/env python3
"""htop-style table monitor for standard food image backfill shards (DashScope / Qwen)."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

SHARD_TARGET = 500
REFRESH_DEFAULT_SEC = 10
ACTIVE_WRITE_SEC = 45

API_FAIL_STATUSES = frozenset({"vision_failed", "kimi_failed"})
RETRY_STATUSES = frozenset(
    {
        "vision_failed",
        "kimi_failed",
        "db_update_failed",
        "upload_failed",
        "search_failed",
        "download_failed",
        "no_match",
    }
)


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
        return {"entries": 0, "counts": Counter(), "ok": 0, "retry": 0, "api_fail": 0}
    entries = data.get("entries") or {}
    counts = Counter(e.get("status", "unknown") for e in entries.values())
    ok = counts.get("db_updated", 0) + counts.get("dry_run_match", 0)
    api_fail = sum(counts.get(s, 0) for s in API_FAIL_STATUSES)
    retry = sum(counts.get(s, 0) for s in RETRY_STATUSES)
    return {"entries": len(entries), "counts": counts, "ok": ok, "api_fail": api_fail, "retry": retry}


def summarize_results_tail(results_path: Path) -> dict:
    if not results_path.is_file():
        return {"latest_name": "", "latest_status": ""}
    last_row: dict = {}
    try:
        with results_path.open(encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if line:
                    last_row = json.loads(line)
    except Exception:
        pass
    st = last_row.get("status", "")
    if st in API_FAIL_STATUSES:
        st = "vision_fail"
    return {"latest_name": (last_row.get("food_name") or "")[:14], "latest_status": st[:12]}


def read_run_meta(shard_dir: Path) -> dict:
    return load_json(shard_dir / "run-meta.json") or {}


def file_age_sec(path: Path) -> float | None:
    if not path.is_file():
        return None
    return time.time() - path.stat().st_mtime


def activity_label(shard_dir: Path) -> str:
    ages = []
    for name in ("state.json", "results.jsonl", "run.log"):
        age = file_age_sec(shard_dir / name)
        if age is not None:
            ages.append(age)
    if not ages:
        return "idle"
    if min(ages) <= ACTIVE_WRITE_SEC:
        return "RUN"
    meta = read_run_meta(shard_dir)
    if meta.get("finished_at"):
        return "DONE"
    return "wait"


def merged_fail_counts(counts: Counter) -> dict[str, int]:
    out: dict[str, int] = {}
    for k, v in counts.items():
        if not v:
            continue
        if k in API_FAIL_STATUSES:
            out["vision"] = out.get("vision", 0) + v
        elif k in RETRY_STATUSES:
            out[k] = out.get(k, 0) + v
        elif k == "db_updated":
            out["ok"] = v
    return out


def col_widths(headers: list[str], rows: list[list[str]]) -> list[int]:
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))
    return widths


def render_table(headers: list[str], rows: list[list[str]]) -> list[str]:
    widths = col_widths(headers, rows)
    sep = "+" + "+".join("-" * (w + 2) for w in widths) + "+"

    def fmt_row(cells: list[str]) -> str:
        parts = []
        for i, w in enumerate(widths):
            text = cells[i] if i < len(cells) else ""
            parts.append(" " + text.ljust(w) + " ")
        return "|" + "|".join(parts) + "|"

    lines = [sep, fmt_row(headers), sep]
    for row in rows:
        lines.append(fmt_row(row))
    lines.append(sep)
    return lines


def clear_screen() -> None:
    if os.name == "nt":
        os.system("cls")
    else:
        print("\033[2J\033[H", end="")


def discover_shard_dirs(root: Path) -> list[Path]:
    return sorted(
        (d for d in root.iterdir() if d.is_dir() and re.fullmatch(r"shard-\d{4}", d.name)),
        key=lambda d: d.name,
    )


def parse_shards_filter(raw: str, root: Path) -> set[str]:
    """解析 --shards：空/all=runs 下全部分片；支持 6-15、6,7,8。"""
    text = raw.strip()
    if not text or text.lower() in {"all", "*"}:
        return {d.name for d in discover_shard_dirs(root)}

    out: set[str] = set()
    for part in text.replace(" ", "").split(","):
        if not part:
            continue
        m = re.fullmatch(r"(\d+)-(\d+)", part)
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            if lo > hi:
                lo, hi = hi, lo
            for n in range(lo, hi + 1):
                out.add(f"shard-{n:04d}")
            continue
        if part.isdigit():
            out.add(f"shard-{int(part):04d}")
            continue
        if re.fullmatch(r"shard-\d{4}", part):
            out.add(part)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="标准食物图片回填分片监控（表格刷新）")
    parser.add_argument("-i", "--interval", type=int, default=REFRESH_DEFAULT_SEC)
    parser.add_argument(
        "--shards",
        type=str,
        default="all",
        help="监控分片：默认 all（runs 下全部 shard-XXXX）；也可 1-5、6-15、6,7,8",
    )
    args = parser.parse_args()
    if args.interval < 1:
        print("interval 至少为 1", file=sys.stderr)
        return 2

    root = Path(__file__).parent.parent / "data" / "standard-food-image-backfill" / "runs"
    if not root.exists():
        print(f"目录不存在: {root}")
        return 1

    shards_arg_display = args.shards.strip() or "all"

    headers = [
        "shard",
        "stat",
        "ent",
        "ok",
        "tgt",
        "retry",
        "vision",
        "db_fail",
        "nomatch",
        "mode",
        "latest",
    ]

    try:
        while True:
            filter_shards = parse_shards_filter(args.shards, root)
            clear_screen()
            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            rows: list[list[str]] = []
            grand_ok = 0
            grand_retry = 0
            grand_active = 0
            shard_n = 0

            for shard_dir in discover_shard_dirs(root):
                if shard_dir.name not in filter_shards:
                    continue
                shard_n += 1
                st = summarize_state(shard_dir / "state.json")
                res = summarize_results_tail(shard_dir / "results.jsonl")
                meta = read_run_meta(shard_dir)
                act = activity_label(shard_dir)
                if act == "RUN":
                    grand_active += 1

                counts = st["counts"]
                fail = merged_fail_counts(counts)
                grand_ok += st["ok"]
                grand_retry += st["retry"]

                mode = (meta.get("mode") or "?")[:10]
                latest = res["latest_name"]
                if res["latest_status"]:
                    latest = f"{res['latest_status']} {latest}".strip()[:22]

                rows.append(
                    [
                        shard_dir.name,
                        act,
                        str(st["entries"]),
                        str(st["ok"]),
                        str(SHARD_TARGET),
                        str(st["retry"]),
                        str(fail.get("vision", 0)),
                        str(counts.get("db_update_failed", 0)),
                        str(counts.get("no_match", 0)),
                        mode,
                        latest,
                    ]
                )

            target = SHARD_TARGET * max(shard_n, 1)
            pct = 100.0 * grand_ok / target if target else 0.0

            print(f" food-link backfill monitor | {now} | refresh {args.interval}s")
            shown = ",".join(sorted(filter_shards)) if filter_shards else "(none)"
            print(f" vision: DashScope Qwen | filter: {shards_arg_display} | showing {shard_n} shard(s)")
            print()
            if shard_n == 0:
                print("  (no matching shards — check --shards or runs/ directory)")
                print(f"  runs: {root}")
                print(f"  available: {', '.join(d.name for d in discover_shard_dirs(root))}")
            else:
                for line in render_table(headers, rows):
                    print(line)
            print()
            print(
                f" TOTAL ok {grand_ok}/{target} ({pct:.1f}%) | "
                f"retry-queue {grand_retry} | active {grand_active}/{shard_n}"
            )
            print(
                " 说明: ent=state 条目数(可>tgt，同目录多轮 full/retry 会累积); "
                "ok=db_updated 累计; tgt=每片设计批量 500"
            )
            print(
                " retry cmd: .\\scripts\\backfill-run-retry-failed.ps1 -Apply "
                "-BingPageOffset 1 -KeepCandidateLimits"
            )
            print(" Ctrl+C exit")

            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n已退出监控。")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
