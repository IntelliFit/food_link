#!/usr/bin/env python3
"""汇总 results.jsonl 各 status 数量。"""
import json
import sys
from collections import Counter
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: backfill-summarize-results.py <results.jsonl>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"file not found: {path}", file=sys.stderr)
        return 1
    counts: Counter[str] = Counter()
    total = 0
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            total += 1
            row = json.loads(line)
            counts[row.get("status", "unknown")] += 1
    print(f"file: {path}")
    print(f"total lines: {total}")
    for status, n in counts.most_common():
        pct = (100.0 * n / total) if total else 0
        print(f"  {status}: {n} ({pct:.1f}%)")
    ok = counts.get("db_updated", 0) + counts.get("dry_run_match", 0)
    if total:
        print(f"success rate (dry_run_match+db_updated): {ok}/{total} = {100*ok/total:.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
