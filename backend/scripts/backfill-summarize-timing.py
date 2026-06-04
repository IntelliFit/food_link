#!/usr/bin/env python3
"""汇总分片运行耗时（run-meta.json + results.jsonl + run.log）。"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


def load_json(path: Path) -> dict:
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    return json.loads(raw.decode("utf-8"))


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: backfill-summarize-timing.py <run_dir>", file=sys.stderr)
        return 2
    run_dir = Path(sys.argv[1])
    meta_path = run_dir / "run-meta.json"
    results_path = run_dir / "results.jsonl"
    log_path = run_dir / "run.log"

    started = finished = None
    workers = None
    if meta_path.is_file():
        meta = load_json(meta_path)
        workers = meta.get("workers")
        started = datetime.fromisoformat(meta["started_at"].replace("Z", "+00:00"))
        if meta.get("finished_at"):
            finished = datetime.fromisoformat(meta["finished_at"].replace("Z", "+00:00"))

    run_total = None
    if log_path.is_file():
        text = log_path.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"\[timing\] run_total duration=([0-9.]+[a-z]+)", text)
        if m:
            run_total = m.group(1)
        for line in text.splitlines():
            if "正常完成" in line or "异常退出" in line:
                print(line.strip())

    first_ts = last_ts = None
    lines = 0
    if results_path.is_file():
        for line in results_path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            lines += 1
            row = json.loads(line)
            ts = row.get("processed_at")
            if not ts:
                continue
            t = datetime.fromisoformat(ts)
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
            first_ts = first_ts or t
            last_ts = t

    state_path = run_dir / "state.json"
    state_entries = 0
    if state_path.is_file():
        state_entries = len(load_json(state_path).get("entries", {}))

    now = datetime.now(timezone.utc)
    print(f"run_dir: {run_dir}")
    if workers is not None:
        print(f"workers: {workers}")
    if started:
        end = finished or now
        print(f"wall_clock: {end - started}")
        print(f"started_at: {started.isoformat()}")
        if finished:
            print(f"finished_at: {finished.isoformat()}")
    if run_total:
        print(f"run_total (log): {run_total}")
    if first_ts and last_ts:
        print(f"results_span: {last_ts - first_ts}")
    print(f"results_lines: {lines}")
    print(f"state_entries: {state_entries}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
