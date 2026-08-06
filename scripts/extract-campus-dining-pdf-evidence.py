#!/usr/bin/env python3
"""Extract review-only campus dining evidence from PDF sources in a crawl JSON."""

from __future__ import annotations

import argparse
import io
import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36 "
    "FoodLinkCampusDirectoryResearch/1.0"
)
DINING_RE = re.compile(r"食堂|餐厅|饭堂|餐饮|美食城|美食广场|窗口|档口")
CANTEEN_RE = re.compile(
    r"[\u4e00-\u9fffA-Za-z0-9·（）()]{1,18}"
    r"(?:学生食堂|教工食堂|清真食堂|食堂|餐厅|美食城|美食广场|饭堂)"
)
FLOOR_RE = re.compile(
    r"(?:负?[一二三四五六七八九十两0-9]+(?:楼|层)|"
    r"地下[一二三四五六七八九十两0-9]+层|B[0-9]+|"
    r"[一二三四五六七八九十两0-9]+[至到~-]"
    r"[一二三四五六七八九十两0-9]+(?:楼|层))"
)
WINDOW_RE = re.compile(r"[\u4e00-\u9fffA-Za-z0-9·（）()]{1,18}(?:窗口|档口)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--max-bytes", type=int, default=24 * 1024 * 1024)
    parser.add_argument("--max-text-chars", type=int, default=200_000)
    return parser.parse_args()


def unique_matches(pattern: re.Pattern[str], text: str, limit: int = 80) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for match in pattern.finditer(text):
        value = re.sub(r"\s+", " ", match.group(0)).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
        if len(result) >= limit:
            break
    return result


def dining_excerpt(text: str, radius: int = 600) -> str:
    match = DINING_RE.search(text)
    if not match:
        return ""
    start = max(0, match.start() - radius)
    end = min(len(text), match.end() + radius * 2)
    return re.sub(r"\s+", " ", text[start:end]).strip()


def download(url: str, timeout: int, max_bytes: int) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/pdf,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content = response.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise ValueError(f"PDF exceeds max size {max_bytes}")
        return content


def extract_task(task: dict, options: argparse.Namespace) -> dict:
    base = {
        "school_id": task["school_id"],
        "official_code": task["official_code"],
        "school_name": task["school_name"],
        "url": task["url"],
        "status": "fetch_failed",
        "pages": 0,
        "text_chars": 0,
        "canteen_candidates": [],
        "floor_mentions": [],
        "window_candidates": [],
        "evidence_excerpt": "",
        "text": "",
    }
    last_error = ""
    content = b""
    for attempt in range(2):
        try:
            content = download(task["url"], options.timeout, options.max_bytes)
            break
        except (OSError, ValueError, urllib.error.URLError) as error:
            last_error = str(error)
            if attempt == 0:
                time.sleep(0.8)
    if not content:
        base["error"] = last_error or "empty response"
        return base
    try:
        reader = PdfReader(io.BytesIO(content))
        page_texts = [(page.extract_text() or "") for page in reader.pages]
        text = re.sub(r"[ \t\f\v]+", " ", "\n".join(page_texts))
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        base["pages"] = len(reader.pages)
        base["text_chars"] = len(text)
        base["text"] = text[: options.max_text_chars]
        if not text:
            base["status"] = "scanned_pdf_no_text"
            return base
        if task["school_name"] not in text:
            base["status"] = "school_name_not_found"
            return base
        if not DINING_RE.search(text):
            base["status"] = "no_dining_evidence"
            return base
        base["canteen_candidates"] = unique_matches(CANTEEN_RE, text)
        base["floor_mentions"] = unique_matches(FLOOR_RE, text)
        base["window_candidates"] = unique_matches(WINDOW_RE, text)
        base["evidence_excerpt"] = dining_excerpt(text)
        if base["canteen_candidates"] or base["window_candidates"]:
            base["status"] = "candidate_evidence"
        else:
            base["status"] = "dining_tokens_only"
        return base
    except Exception as error:  # pypdf emits several parser-specific exception types
        base["status"] = "pdf_parse_failed"
        base["error"] = str(error)
        return base


def main() -> None:
    options = parse_args()
    input_path = Path(options.input).resolve()
    output_path = Path(options.output).resolve()
    crawl = json.loads(input_path.read_text(encoding="utf-8"))
    tasks: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for school in crawl.get("schools", []):
        for source in school.get("sources") or []:
            if source.get("status") != "needs_pdf_extraction":
                continue
            key = (school["school_id"], source.get("url", ""))
            if not key[1] or key in seen:
                continue
            seen.add(key)
            tasks.append(
                {
                    "school_id": school["school_id"],
                    "official_code": school.get("official_code", ""),
                    "school_name": school["name"],
                    "url": key[1],
                }
            )
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=max(1, min(options.concurrency, 8))) as executor:
        futures = {executor.submit(extract_task, task, options): task for task in tasks}
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            print(
                f"{len(results)}/{len(tasks)} {result['school_name']} "
                f"{result['status']} pages={result['pages']}"
            )
    results.sort(key=lambda item: (item["official_code"], item["url"]))
    status_counts: dict[str, int] = {}
    for result in results:
        status_counts[result["status"]] = status_counts.get(result["status"], 0) + 1
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": "北京高校官方 PDF 餐饮正文证据；仅供审核，不写数据库",
        "source_input": str(input_path),
        "summary": {
            "sources": len(results),
            "status": status_counts,
            "candidate_sources": sum(
                result["status"] == "candidate_evidence" for result in results
            ),
        },
        "sources": results,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
