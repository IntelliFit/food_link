"""
Fill packaged-food empty-image review markdown with web image candidates.

This script only updates the local markdown review file. It does not upload
images and does not update the database.

Usage:
    python backend/scripts/fill_packaged_food_image_candidates.py \
        --markdown backend/tmp/packaged-food-empty-image-review.md
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import quote_plus, unquote

import requests


DEFAULT_MARKDOWN = Path("backend/tmp/packaged-food-empty-image-review.md")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0 Safari/537.36"
)
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")


@dataclass
class ReviewRow:
    raw: str
    index: int
    food_id: str
    display_name: str
    brand: str
    product_name: str
    search_term: str


@dataclass
class ImageCandidate:
    image_url: str
    page_url: str
    validated: bool = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fill markdown with image candidates.")
    parser.add_argument("--markdown", default=str(DEFAULT_MARKDOWN), help="Review markdown path.")
    parser.add_argument("--limit", type=int, default=0, help="Limit rows to process. 0 means all rows.")
    parser.add_argument("--sleep", type=float, default=0.6, help="Delay between search requests.")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing filled candidate cells.")
    return parser.parse_args()


def split_markdown_row(line: str) -> list[str]:
    text = line.strip()
    if not text.startswith("|") or not text.endswith("|"):
        return []
    return [cell.strip() for cell in text[1:-1].split("|")]


def parse_rows(lines: list[str]) -> list[ReviewRow]:
    rows: list[ReviewRow] = []
    for line in lines:
        cells = split_markdown_row(line)
        if len(cells) != 11:
            continue
        if not cells[0].isdigit():
            continue
        search_term = cells[7].strip().strip("`")
        food_id = cells[1].strip().strip("`")
        rows.append(
            ReviewRow(
                raw=line,
                index=int(cells[0]),
                food_id=food_id,
                display_name=cells[2],
                brand=cells[3],
                product_name=cells[4],
                search_term=search_term,
            )
        )
    return rows


def candidate_queries(row: ReviewRow) -> list[str]:
    values = [
        row.search_term,
        f"{row.display_name} 包装 图片",
        f"{row.display_name} 京东 商品图",
        f"{row.display_name} 天猫 商品图",
        f"{row.brand} {row.product_name} 商品图",
    ]
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        normalized = " ".join(value.split())
        if normalized and normalized not in seen:
            seen.add(normalized)
            out.append(normalized)
    return out


def search_bing_images(query: str, max_candidates: int = 12) -> list[ImageCandidate]:
    url = f"https://www.bing.com/images/search?q={quote_plus(query)}&form=HDRSC2&first=1"
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20)
    response.raise_for_status()
    text = response.text
    candidates: list[ImageCandidate] = []
    seen: set[str] = set()

    def add_candidate(image_url: str, page_url: str = "") -> None:
        image_url = html.unescape(image_url)
        page_url = html.unescape(page_url)
        image_url = unquote(image_url.replace("\\/", "/"))
        page_url = unquote(page_url.replace("\\/", "/"))
        if not image_url.startswith(("http://", "https://")):
            return
        if image_url in seen:
            return
        seen.add(image_url)
        candidates.append(ImageCandidate(image_url=image_url, page_url=page_url))

    for match in re.finditer(r'murl&quot;:&quot;(.*?)&quot;.*?purl&quot;:&quot;(.*?)&quot;', text):
        add_candidate(match.group(1), match.group(2))
        if len(candidates) >= max_candidates:
            break
    if candidates:
        return candidates

    # Alternate encoding sometimes appears in raw JavaScript JSON.
    for match in re.finditer(r'"murl":"(.*?)".*?"purl":"(.*?)"', text):
        add_candidate(match.group(1), match.group(2))
        if len(candidates) >= max_candidates:
            break
    if candidates:
        return candidates

    # Current Bing pages may expose image URLs without a nearby purl; keep those
    # as candidates and let the reviewer decide from the rendered preview.
    for pattern in (
        r'murl&quot;:&quot;(.*?)&quot;',
        r'"murl":"(.*?)"',
        r'MediaUrl&quot;:&quot;(.*?)&quot;',
        r'"MediaUrl":"(.*?)"',
    ):
        for image_url in re.findall(pattern, text):
            add_candidate(image_url)
            if len(candidates) >= max_candidates:
                break
        if len(candidates) >= max_candidates:
            break
    return candidates


def looks_like_image_url(url: str) -> bool:
    lower = url.lower().split("?", 1)[0]
    return lower.endswith(IMAGE_EXTENSIONS)


def validate_image(url: str) -> bool:
    if not url.startswith(("http://", "https://")):
        return False
    if not looks_like_image_url(url):
        # Many CDN image URLs still omit extensions, so do not reject yet.
        pass
    try:
        with requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Referer": "https://www.bing.com/"},
            timeout=18,
            stream=True,
        ) as response:
            if response.status_code >= 400:
                return False
            content_type = response.headers.get("Content-Type", "").lower()
            if "image/" not in content_type and not looks_like_image_url(url):
                return False
            size = 0
            for chunk in response.iter_content(chunk_size=8192):
                if not chunk:
                    continue
                size += len(chunk)
                if size >= 8 * 1024:
                    return True
            return size >= 4 * 1024
    except requests.RequestException:
        return False


def find_candidate(row: ReviewRow, sleep_seconds: float) -> ImageCandidate | None:
    fallback: ImageCandidate | None = None
    for query in candidate_queries(row):
        try:
            candidates = search_bing_images(query)
        except requests.RequestException as err:
            print(f"[warn] search failed row={row.index} query={query!r}: {err}", file=sys.stderr)
            time.sleep(sleep_seconds)
            continue
        for candidate in candidates:
            if validate_image(candidate.image_url):
                candidate.validated = True
                return candidate
            if fallback is None:
                fallback = candidate
        time.sleep(sleep_seconds)
    return fallback


def markdown_link(candidate: ImageCandidate) -> str:
    image_url = candidate.image_url.replace("|", "%7C")
    page_url = candidate.page_url.replace("|", "%7C")
    parts = [f'<a href="{html.escape(image_url)}">图片链接</a>']
    if page_url:
        parts.append(f'<a href="{html.escape(page_url)}">来源页</a>')
    parts.append(f'<img src="{html.escape(image_url)}" width="120">')
    return "<br>".join(parts)


def replace_candidate_cell(line: str, value: str, validated: bool) -> str:
    cells = split_markdown_row(line)
    if len(cells) != 11:
        return line
    cells[8] = value
    cells[10] = "待人工确认候选图" if validated else "待人工确认候选图（未校验热链）"
    return "| " + " | ".join(cells) + " |\n"


def already_filled(line: str) -> bool:
    cells = split_markdown_row(line)
    return len(cells) == 11 and "待补充" not in cells[8]


def update_markdown(path: Path, limit: int, sleep_seconds: float, overwrite: bool) -> tuple[int, int]:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    rows = parse_rows(lines)
    if limit > 0:
        rows = rows[:limit]
    row_by_index = {row.index: row for row in rows}
    filled = 0
    missing = 0
    new_lines: list[str] = []
    for line in lines:
        cells = split_markdown_row(line)
        if len(cells) != 11 or not cells[0].isdigit():
            new_lines.append(line)
            continue
        row = row_by_index.get(int(cells[0]))
        if row is None:
            new_lines.append(line)
            continue
        if already_filled(line) and not overwrite:
            new_lines.append(line)
            continue
        print(f"[info] searching {row.index:02d}: {row.display_name}", flush=True)
        candidate = find_candidate(row, sleep_seconds)
        if candidate is None:
            missing += 1
            cells[10] = "未找到可访问候选图"
            new_lines.append("| " + " | ".join(cells) + " |\n")
            continue
        filled += 1
        new_lines.append(replace_candidate_cell(line, markdown_link(candidate), candidate.validated))
    path.write_text("".join(new_lines), encoding="utf-8")
    return filled, missing


def main() -> None:
    args = parse_args()
    path = Path(args.markdown)
    if not path.exists():
        raise SystemExit(f"markdown file not found: {path}")
    filled, missing = update_markdown(path, args.limit, args.sleep, args.overwrite)
    print(f"[done] filled={filled} missing={missing} file={path}")


if __name__ == "__main__":
    main()
