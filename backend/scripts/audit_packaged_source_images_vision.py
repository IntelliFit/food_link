"""Read-only visual audit for packaged-food source images.

The model is instructed to transcribe only visible package evidence and never
invent a recommended serving. Results are checkpoints/review evidence, not
automatic database updates.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

import requests

from audit_nutrition_quality_deepseek import _connect, _load_local_env, _read_yaml_config


QUERY = """
SELECT id, display_name, spec_text, source_image_urls, net_weight_g,
       net_content_value, net_content_unit, serving_weight_g
FROM public.packaged_food_library
WHERE is_active = TRUE
ORDER BY display_name, id
"""

PROMPT = """你是包装食品原图证据审核员。只读取图片上真正可见的内容，禁止根据常识、品牌或数据库字段猜测。

数据库期望商品：{display_name}
数据库规格（仅用于核对，不能当作图片证据）：{spec_text}
数据库整包量：{container}
数据库 serving_weight_g：{serving}

请核对图片并只输出一个 JSON 对象：
{{
  "identity_match": "match|mismatch|unclear",
  "image_kind": "front|back|nutrition_label|marketing|mixed|unclear",
  "visible_product_name": "图片可见商品名，没有则空字符串",
  "visible_net_content": [{{"value": 数字, "unit": "g|ml|kg|L", "exact_text": "原图短文字"}}],
  "visible_servings": [{{"value": 数字, "unit": "g|ml", "kind": "per_serving|per_unit|unit_breakdown", "exact_text": "原图短文字"}}],
  "has_nutrition_table": true或false,
  "serving_supported": "yes|no|unclear",
  "reason": "一句中文理由"
}}

规则：
1. 推荐食用量、常见30g、数据库字段都不是图片证据。
2. 只有图片明确出现“每份/每包/每条/每颗”或“数量×重量”等文字，才把较小重量写进 visible_servings。
3. 只有正面净含量而没有较小份量时，serving_supported=no。
4. 商品名、口味、净含量明显不一致时 identity_match=mismatch。
5. 看不清就写 unclear，不得补全。不要输出 Markdown。
"""


def _fetch_rows(config: Mapping[str, Any]) -> List[Dict[str, Any]]:
    conn = _connect(config)
    try:
        conn.set_session(readonly=True, autocommit=False)
        with conn.cursor() as cur:
            cur.execute(QUERY)
            columns = [desc[0] for desc in cur.description]
            rows = [dict(zip(columns, row)) for row in cur.fetchall()]
        conn.rollback()
        return rows
    finally:
        conn.close()


def _download_first_image(urls: List[str], timeout: int) -> Tuple[bytes, str, str]:
    last_error = "missing_image"
    for url in urls[:3]:
        try:
            response = requests.get(url, timeout=timeout, headers={"User-Agent": "food-link-quality-audit/1.0"})
            response.raise_for_status()
            content_type = response.headers.get("content-type", "image/jpeg").split(";", 1)[0].strip()
            if not content_type.startswith("image/"):
                content_type = "image/jpeg"
            if not response.content:
                raise ValueError("empty image")
            return response.content, content_type, url
        except Exception as exc:  # noqa: BLE001 - report every source failure
            last_error = f"{type(exc).__name__}: {exc}"
    raise RuntimeError(last_error)


def _extract_text(payload: Mapping[str, Any]) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    parts = (((candidates[0] or {}).get("content") or {}).get("parts") or [])
    return "\n".join(str(part.get("text") or "") for part in parts if isinstance(part, Mapping)).strip()


def _parse_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("model response has no JSON object")
    parsed = json.loads(text[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("model response JSON is not an object")
    return parsed


def _audit_one(row: Dict[str, Any], api_key: str, base_url: str, model: str, timeout: int, retries: int) -> Dict[str, Any]:
    urls = [str(url).strip() for url in (row.get("source_image_urls") or []) if str(url).strip()]
    if not urls:
        return {**row, "vision_status": "missing_image", "vision_result": {}, "vision_error": "no source_image_urls"}
    try:
        image_bytes, mime_type, used_url = _download_first_image(urls, timeout)
    except Exception as exc:  # noqa: BLE001
        return {**row, "vision_status": "download_failed", "vision_result": {}, "vision_error": str(exc)}

    container = row.get("net_weight_g") or f"{row.get('net_content_value') or ''}{row.get('net_content_unit') or ''}"
    prompt = PROMPT.format(
        display_name=row.get("display_name") or "",
        spec_text=row.get("spec_text") or "",
        container=container,
        serving=row.get("serving_weight_g") or 0,
    )
    endpoint = f"{base_url.rstrip('/')}/v1beta/models/{model}:generateContent"
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(image_bytes).decode("ascii")}},
                ],
            }
        ],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json"},
    }
    last_error = ""
    for attempt in range(retries + 1):
        try:
            response = requests.post(
                endpoint,
                params={"key": api_key},
                json=body,
                timeout=timeout,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            response.raise_for_status()
            result = _parse_json(_extract_text(response.json()))
            return {
                **row,
                "vision_status": "reviewed",
                "vision_result": result,
                "vision_error": "",
                "audited_image_url": used_url,
            }
        except Exception as exc:  # noqa: BLE001
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < retries:
                time.sleep(0.5 * (2**attempt))
    return {
        **row,
        "vision_status": "vision_failed",
        "vision_result": {},
        "vision_error": last_error,
        "audited_image_url": used_url,
    }


def _atomic_write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    os.replace(temp, path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit all packaged-food source images with a vision model.")
    parser.add_argument("--config", default=str(Path(__file__).resolve().parent.parent / "config.yaml"))
    parser.add_argument("--out", default="tmp/packaged-serving-quality-20260714/vision-audit.json")
    parser.add_argument("--workers", type=int, default=24)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--model", default="gemini-3-flash-preview")
    parser.add_argument("--base-url", default="https://maas-openapi.wanjiedata.com/api")
    parser.add_argument("--checkpoint-every", type=int, default=10)
    args = parser.parse_args()

    _load_local_env()
    api_key = os.getenv("WANJIE_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("WANJIE_API_KEY is required")
    rows = _fetch_rows(_read_yaml_config(Path(args.config)))
    out_path = Path(args.out)
    existing: Dict[str, Dict[str, Any]] = {}
    if out_path.exists():
        try:
            for item in json.loads(out_path.read_text(encoding="utf-8")):
                if item.get("vision_status") == "reviewed":
                    existing[str(item["id"])] = item
        except Exception:  # noqa: BLE001
            existing = {}
    pending = [row for row in rows if str(row["id"]) not in existing]
    results = dict(existing)
    lock = threading.Lock()
    completed = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {
            pool.submit(_audit_one, row, api_key, args.base_url, args.model, args.timeout, args.retries): row
            for row in pending
        }
        for future in as_completed(futures):
            item = future.result()
            with lock:
                results[str(item["id"])] = item
                completed += 1
                if completed % max(1, args.checkpoint_every) == 0:
                    ordered = [results[str(row["id"])] for row in rows if str(row["id"]) in results]
                    _atomic_write(out_path, ordered)
                    print(json.dumps({"completed_this_run": completed, "total_saved": len(ordered)}, ensure_ascii=False), flush=True)
    ordered = [results[str(row["id"])] for row in rows if str(row["id"]) in results]
    _atomic_write(out_path, ordered)
    counts: Dict[str, int] = {}
    for item in ordered:
        key = str(item.get("vision_status") or "unknown")
        counts[key] = counts.get(key, 0) + 1
    print(json.dumps({"rows": len(rows), "saved": len(ordered), "status_counts": counts, "out": str(out_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
