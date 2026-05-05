"""
Translate USDA-imported English food names into Chinese aliases and insert them
into food_nutrition_aliases.

Typical workflow:
1. Pull USDA foods from food_nutrition_library where source starts with `usda_`
2. Skip foods that already have Chinese aliases by default
3. Use a chat model to generate one concise Chinese name plus several aliases
4. Export preview JSON / SQL or directly insert rows into food_nutrition_aliases
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

import httpx
from dotenv import load_dotenv


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_env() -> None:
    load_dotenv(BACKEND_DIR / ".env", override=False)
    load_dotenv(BACKEND_DIR / ".env.local", override=False)


def _get_supabase_client():
    from database import get_supabase_client

    return get_supabase_client()


def _normalize_food_name(name: str) -> str:
    raw = str(name or "").strip().lower()
    if not raw:
        return ""
    normalized = re.sub(r"[\s\r\n\t]+", "", raw)
    normalized = re.sub(r"[()（）【】\[\]{}·,，。.!！:：;；'\"`~\-_\/\\|]+", "", normalized)
    return normalized


def _chunked(items: Sequence[Any], size: int) -> Iterable[Sequence[Any]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _clean_text(value: Any) -> str:
    text = str(value or "").strip()
    return re.sub(r"\s+", " ", text)


def _contains_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def _sleep_with_log(seconds: float, reason: str) -> None:
    if seconds <= 0:
        return
    print(f"[translate_usda_aliases] sleep={seconds:.2f}s reason={reason}")
    time.sleep(seconds)


def _execute_supabase_request(
    request: Any,
    *,
    action: str,
    max_retries: int,
    retry_sleep_seconds: float,
) -> Any:
    attempt = 0
    while True:
        attempt += 1
        try:
            return request.execute()
        except Exception as exc:
            if attempt > max_retries:
                raise RuntimeError(
                    f"Supabase request failed after {attempt} attempts during {action}: {exc}"
                ) from exc
            sleep_seconds = retry_sleep_seconds * attempt
            print(
                f"[translate_usda_aliases] supabase_retry action={action} "
                f"attempt={attempt} sleep={sleep_seconds:.2f}s error={exc}"
            )
            _sleep_with_log(sleep_seconds, f"retry {action}")


class Translator:
    def __init__(self, model: str, timeout_seconds: float = 60.0) -> None:
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.provider = os.getenv("TRANSLATION_PROVIDER", "deepseek").strip().lower()
        self.client = httpx.Client(timeout=timeout_seconds)

    def close(self) -> None:
        self.client.close()

    def _parse_json_response(self, data: Dict[str, Any], empty_message: str) -> Dict[str, Any]:
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            raise RuntimeError(empty_message)
        content = re.sub(r"```json", "", content)
        content = re.sub(r"```", "", content).strip()
        return json.loads(content)

    def _request_openai_compatible(
        self,
        prompt: str,
        *,
        api_key_envs: Sequence[str],
        default_base_url: str,
        empty_message: str,
    ) -> Dict[str, Any]:
        api_key = ""
        for env_name in api_key_envs:
            api_key = os.getenv(env_name, "").strip()
            if api_key:
                break
        if not api_key:
            raise RuntimeError(f"Missing API key, checked: {', '.join(api_key_envs)}")

        base_url = os.getenv("TRANSLATION_BASE_URL", "").strip() or default_base_url
        response = self.client.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                "response_format": {"type": "json_object"},
                "stream": False,
                "temperature": 0.2,
            },
        )
        response.raise_for_status()
        return self._parse_json_response(response.json(), empty_message)

    def _request_deepseek(self, prompt: str) -> Dict[str, Any]:
        return self._request_openai_compatible(
            prompt,
            api_key_envs=["DEEPSEEK_API_KEY"],
            default_base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
            empty_message="DeepSeek returned empty content",
        )

    def _request_dashscope(self, prompt: str) -> Dict[str, Any]:
        return self._request_openai_compatible(
            prompt,
            api_key_envs=["DASHSCOPE_API_KEY", "API_KEY"],
            default_base_url=os.getenv(
                "DASHSCOPE_BASE_URL",
                "https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
            empty_message="DashScope returned empty content",
        )

    def _request_ofox(self, prompt: str) -> Dict[str, Any]:
        return self._request_openai_compatible(
            prompt,
            api_key_envs=["OFOXAI_API_KEY", "ofox_ai_apikey"],
            default_base_url=os.getenv("OFOX_BASE_URL", "https://api.ofox.ai/v1"),
            empty_message="OFOX returned empty content",
        )

    def translate_batch(self, items: Sequence[Dict[str, str]]) -> Dict[str, Any]:
        prompt = self._build_prompt(items)
        if self.provider == "deepseek":
            return self._request_deepseek(prompt)
        if self.provider == "ofox":
            return self._request_ofox(prompt)
        return self._request_dashscope(prompt)

    def _build_prompt(self, items: Sequence[Dict[str, str]]) -> str:
        payload = json.dumps(list(items), ensure_ascii=False, indent=2)
        return f"""
You are a careful food taxonomy assistant helping build a Chinese nutrition database.

Task:
For each English food name, generate:
1. zh_name: the most natural and concise Simplified Chinese food name
2. aliases: 2 to 6 common Simplified Chinese aliases

Rules:
- Use only Simplified Chinese.
- Keep key qualifiers when they matter: raw/cooked, skinless/with skin, whole/skim, sweetened/unsweetened.
- Do not add explanations.
- Do not include English in aliases.
- Do not repeat zh_name verbatim inside aliases.
- Prefer conservative naming over over-translation.
- If a branded or very technical item cannot be translated naturally, choose the most understandable generic Chinese food name.

Return strict JSON in this shape:
{{
  "items": [
    {{
      "food_id": "...",
      "english_name": "...",
      "zh_name": "...",
      "aliases": ["...", "..."]
    }}
  ]
}}

Input:
{payload}
""".strip()


def _fetch_usda_foods(
    limit: int,
    source_prefix: str,
    only_without_zh_alias: bool,
    *,
    alias_lookup_batch_size: int,
    supabase_retries: int,
    supabase_retry_sleep_seconds: float,
    supabase_chunk_sleep_seconds: float,
) -> List[Dict[str, str]]:
    supabase = _get_supabase_client()
    query = (
        supabase.table("food_nutrition_library")
        .select("id, canonical_name, normalized_name, source")
        .ilike("source", f"{source_prefix}%")
        .eq("is_active", True)
        .limit(limit)
    )
    rows = list(
        _execute_supabase_request(
            query,
            action="fetch_usda_foods",
            max_retries=supabase_retries,
            retry_sleep_seconds=supabase_retry_sleep_seconds,
        ).data
        or []
    )
    if not only_without_zh_alias:
        return [
            {
                "food_id": str(row.get("id") or ""),
                "english_name": _clean_text(row.get("canonical_name")),
                "normalized_name": _clean_text(row.get("normalized_name")),
            }
            for row in rows
            if row.get("id") and _clean_text(row.get("canonical_name"))
        ]

    food_ids = [str(row.get("id") or "") for row in rows if row.get("id")]
    alias_rows: List[Dict[str, Any]] = []
    for index, chunk in enumerate(_chunked(food_ids, alias_lookup_batch_size), start=1):
        resp = _execute_supabase_request(
            supabase.table("food_nutrition_aliases")
            .select("food_id, alias_name")
            .in_("food_id", list(chunk)),
            action=f"fetch_existing_zh_aliases_batch_{index}",
            max_retries=supabase_retries,
            retry_sleep_seconds=supabase_retry_sleep_seconds,
        )
        alias_rows.extend(list(resp.data or []))
        _sleep_with_log(supabase_chunk_sleep_seconds, f"after alias lookup batch {index}")

    zh_food_ids = {
        str(row.get("food_id") or "")
        for row in alias_rows
        if _contains_chinese(str(row.get("alias_name") or ""))
    }

    return [
        {
            "food_id": str(row.get("id") or ""),
            "english_name": _clean_text(row.get("canonical_name")),
            "normalized_name": _clean_text(row.get("normalized_name")),
        }
        for row in rows
        if row.get("id")
        and _clean_text(row.get("canonical_name"))
        and str(row.get("id")) not in zh_food_ids
    ]


def _load_foods_from_json(path: Path, limit: int) -> List[Dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError("Input JSON must be a list of USDA rows")
    foods: List[Dict[str, str]] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        food_id = str(row.get("id") or row.get("food_id") or "").strip()
        english_name = _clean_text(row.get("canonical_name") or row.get("english_name"))
        normalized_name = _clean_text(row.get("normalized_name")) or _normalize_food_name(english_name)
        source = _clean_text(row.get("source"))
        if not english_name or not normalized_name:
            continue
        foods.append(
            {
                "food_id": food_id,
                "english_name": english_name,
                "normalized_name": normalized_name,
                "source": source,
            }
        )
        if len(foods) >= limit:
            break
    return foods


def _filter_foods_without_existing_zh_alias(
    foods: Sequence[Dict[str, str]],
    *,
    alias_lookup_batch_size: int,
    supabase_retries: int,
    supabase_retry_sleep_seconds: float,
    supabase_chunk_sleep_seconds: float,
) -> List[Dict[str, str]]:
    if not foods:
        return []

    supabase = _get_supabase_client()
    normalized_names = sorted(
        {
            _clean_text(food.get("normalized_name"))
            for food in foods
            if _clean_text(food.get("normalized_name"))
        }
    )
    normalized_to_food_id: Dict[str, str] = {}
    for index, chunk in enumerate(_chunked(normalized_names, alias_lookup_batch_size), start=1):
        resp = _execute_supabase_request(
            supabase.table("food_nutrition_library")
            .select("id, normalized_name")
            .in_("normalized_name", list(chunk))
            .eq("is_active", True),
            action=f"prefilter_foods_library_batch_{index}",
            max_retries=supabase_retries,
            retry_sleep_seconds=supabase_retry_sleep_seconds,
        )
        for item in list(resp.data or []):
            food_id = str(item.get("id") or "").strip()
            normalized_name = _clean_text(item.get("normalized_name"))
            if food_id and normalized_name:
                normalized_to_food_id[normalized_name] = food_id
        _sleep_with_log(supabase_chunk_sleep_seconds, f"after prefilter library batch {index}")

    food_ids = sorted(set(normalized_to_food_id.values()))
    zh_food_ids: set[str] = set()
    for index, chunk in enumerate(_chunked(food_ids, alias_lookup_batch_size), start=1):
        resp = _execute_supabase_request(
            supabase.table("food_nutrition_aliases")
            .select("food_id, alias_name")
            .in_("food_id", list(chunk)),
            action=f"prefilter_foods_alias_batch_{index}",
            max_retries=supabase_retries,
            retry_sleep_seconds=supabase_retry_sleep_seconds,
        )
        for item in list(resp.data or []):
            food_id = str(item.get("food_id") or "").strip()
            alias_name = str(item.get("alias_name") or "")
            if food_id and _contains_chinese(alias_name):
                zh_food_ids.add(food_id)
        _sleep_with_log(supabase_chunk_sleep_seconds, f"after prefilter alias batch {index}")

    filtered: List[Dict[str, str]] = []
    skipped = 0
    for food in foods:
        normalized_name = _clean_text(food.get("normalized_name"))
        food_id = normalized_to_food_id.get(normalized_name, "")
        if food_id and food_id in zh_food_ids:
            skipped += 1
            continue
        filtered.append(food)
    if skipped:
        print(f"[translate_usda_aliases] skipped_existing_zh_foods={skipped}")
    return filtered


def _dedupe_aliases(zh_name: str, aliases: Sequence[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for candidate in [zh_name, *list(aliases)]:
        text = _clean_text(candidate)
        if not text or not _contains_chinese(text):
            continue
        normalized = _normalize_food_name(text)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(text)
    return out


def _translate_foods(
    foods: Sequence[Dict[str, str]],
    translator: Translator,
    batch_size: int,
    sleep_seconds: float,
) -> List[Dict[str, Any]]:
    translated: List[Dict[str, Any]] = []
    for idx, chunk in enumerate(_chunked(list(foods), batch_size), start=1):
        source_by_food_id = {
            str(item.get("food_id") or "").strip(): item
            for item in chunk
            if str(item.get("food_id") or "").strip()
        }
        source_by_english_name = {
            _clean_text(item.get("english_name")): item
            for item in chunk
            if _clean_text(item.get("english_name"))
        }
        payload = [
            {
                "food_id": item["food_id"],
                "english_name": item["english_name"],
                "normalized_name": item.get("normalized_name", ""),
            }
            for item in chunk
        ]
        result = translator.translate_batch(payload)
        items = result.get("items") or []
        if not isinstance(items, list):
            raise RuntimeError(f"Unexpected translation payload in batch {idx}: missing items list")
        for row in items:
            if not isinstance(row, dict):
                continue
            food_id = str(row.get("food_id") or "").strip()
            english_name = _clean_text(row.get("english_name"))
            zh_name = _clean_text(row.get("zh_name"))
            aliases = row.get("aliases") or []
            normalized_name = _clean_text(row.get("normalized_name"))
            source_item = None
            if food_id:
                source_item = source_by_food_id.get(food_id)
            if source_item is None and english_name:
                source_item = source_by_english_name.get(english_name)
            if not normalized_name and source_item is not None:
                normalized_name = _clean_text(source_item.get("normalized_name"))
            if not isinstance(aliases, list):
                aliases = []
            if not zh_name:
                continue
            translated.append(
                {
                    "food_id": food_id,
                    "english_name": english_name,
                    "normalized_name": normalized_name,
                    "zh_name": zh_name,
                    "aliases": _dedupe_aliases(zh_name, [str(x) for x in aliases]),
                }
            )
        print(f"[translate_usda_aliases] translated batch={idx} size={len(chunk)}")
        if sleep_seconds > 0:
            time.sleep(sleep_seconds)
    return translated


def _flatten_alias_rows(translated_rows: Sequence[Dict[str, Any]]) -> List[Dict[str, str]]:
    flat: List[Dict[str, str]] = []
    for row in translated_rows:
        food_id = str(row.get("food_id") or "").strip()
        library_normalized_name = _clean_text(row.get("normalized_name"))
        for alias in row.get("aliases") or []:
            alias_name = _clean_text(alias)
            normalized_alias = _normalize_food_name(alias_name)
            if not alias_name or not normalized_alias:
                continue
            flat.append(
                {
                    "food_id": food_id,
                    "library_normalized_name": library_normalized_name,
                    "alias_name": alias_name,
                    "normalized_alias": normalized_alias,
                }
            )
    deduped: Dict[str, Dict[str, str]] = {}
    for row in flat:
        deduped[row["normalized_alias"]] = row
    return list(deduped.values())


def _filter_existing_aliases(
    rows: Sequence[Dict[str, str]],
    *,
    alias_lookup_batch_size: int,
    supabase_retries: int,
    supabase_retry_sleep_seconds: float,
    supabase_chunk_sleep_seconds: float,
) -> List[Dict[str, str]]:
    supabase = _get_supabase_client()
    existing: set[str] = set()
    normalized_aliases = [row["normalized_alias"] for row in rows]
    for index, chunk in enumerate(_chunked(normalized_aliases, alias_lookup_batch_size), start=1):
        resp = _execute_supabase_request(
            supabase.table("food_nutrition_aliases")
            .select("normalized_alias")
            .in_("normalized_alias", list(chunk)),
            action=f"filter_existing_aliases_batch_{index}",
            max_retries=supabase_retries,
            retry_sleep_seconds=supabase_retry_sleep_seconds,
        )
        for item in list(resp.data or []):
            value = str(item.get("normalized_alias") or "").strip()
            if value:
                existing.add(value)
        _sleep_with_log(supabase_chunk_sleep_seconds, f"after existing alias check batch {index}")
    return [row for row in rows if row["normalized_alias"] not in existing]


def _write_json(path: Path, translated_rows: Sequence[Dict[str, Any]], alias_rows: Sequence[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "translated_items": list(translated_rows),
                "alias_rows": list(alias_rows),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_sql(path: Path, alias_rows: Sequence[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not alias_rows:
        body = (
            "-- Auto-generated by backend/scripts/translate_usda_aliases.py\n\n"
            "-- No new alias rows generated.\n"
        )
        path.write_text(body, encoding="utf-8")
        return

    use_join_sql = any(not str(row.get("food_id") or "").strip() for row in alias_rows)
    values = []
    if use_join_sql:
        for row in alias_rows:
            values.append(
                "("
                f"{_sql_quote(row['library_normalized_name'])}, "
                f"{_sql_quote(row['alias_name'])}, "
                f"{_sql_quote(row['normalized_alias'])}"
                ")"
            )
        body = (
            "-- Auto-generated by backend/scripts/translate_usda_aliases.py\n\n"
            "with alias_source (library_normalized_name, alias_name, normalized_alias) as (\n"
            "  values\n"
            + ",\n".join(values)
            + "\n"
            ")\n"
            "insert into public.food_nutrition_aliases (\n"
            "  food_id,\n"
            "  alias_name,\n"
            "  normalized_alias\n"
            ")\n"
            "select\n"
            "  f.id,\n"
            "  s.alias_name,\n"
            "  s.normalized_alias\n"
            "from alias_source s\n"
            "join public.food_nutrition_library f\n"
            "  on f.normalized_name = s.library_normalized_name\n"
            "on conflict (normalized_alias) do nothing;\n"
        )
    else:
        for row in alias_rows:
            values.append(
                "("
                f"{_sql_quote(row['food_id'])}::uuid, "
                f"{_sql_quote(row['alias_name'])}, "
                f"{_sql_quote(row['normalized_alias'])}"
                ")"
            )
        body = (
            "-- Auto-generated by backend/scripts/translate_usda_aliases.py\n\n"
            "insert into public.food_nutrition_aliases (\n"
            "  food_id,\n"
            "  alias_name,\n"
            "  normalized_alias\n"
            ")\nvalues\n"
            + ",\n".join(values)
            + "\n"
            "on conflict (normalized_alias) do nothing;\n"
    )
    path.write_text(body, encoding="utf-8")


def _resolve_food_ids_for_alias_rows(
    alias_rows: Sequence[Dict[str, str]],
    *,
    alias_lookup_batch_size: int,
    supabase_retries: int,
    supabase_retry_sleep_seconds: float,
    supabase_chunk_sleep_seconds: float,
) -> List[Dict[str, str]]:
    unresolved_names = sorted(
        {
            str(row.get("library_normalized_name") or "").strip()
            for row in alias_rows
            if not str(row.get("food_id") or "").strip() and str(row.get("library_normalized_name") or "").strip()
        }
    )
    if not unresolved_names:
        return list(alias_rows)

    supabase = _get_supabase_client()
    normalized_to_id: Dict[str, str] = {}
    for index, chunk in enumerate(_chunked(unresolved_names, alias_lookup_batch_size), start=1):
        resp = _execute_supabase_request(
            supabase.table("food_nutrition_library")
            .select("id, normalized_name")
            .in_("normalized_name", list(chunk))
            .eq("is_active", True),
            action=f"resolve_food_ids_batch_{index}",
            max_retries=supabase_retries,
            retry_sleep_seconds=supabase_retry_sleep_seconds,
        )
        for item in list(resp.data or []):
            normalized_name = _clean_text(item.get("normalized_name"))
            food_id = str(item.get("id") or "").strip()
            if normalized_name and food_id:
                normalized_to_id[normalized_name] = food_id
        _sleep_with_log(supabase_chunk_sleep_seconds, f"after resolve food ids batch {index}")

    resolved_rows: List[Dict[str, str]] = []
    unresolved_count = 0
    for row in alias_rows:
        food_id = str(row.get("food_id") or "").strip()
        if not food_id:
            food_id = normalized_to_id.get(str(row.get("library_normalized_name") or "").strip(), "")
        if not food_id:
            unresolved_count += 1
            continue
        resolved_rows.append(
            {
                "food_id": food_id,
                "library_normalized_name": str(row.get("library_normalized_name") or "").strip(),
                "alias_name": str(row.get("alias_name") or "").strip(),
                "normalized_alias": str(row.get("normalized_alias") or "").strip(),
            }
        )
    if unresolved_count:
        print(f"[translate_usda_aliases] unresolved_alias_rows={unresolved_count}")
    return resolved_rows


def _insert_alias_rows(
    alias_rows: Sequence[Dict[str, str]],
    batch_size: int,
    *,
    supabase_retries: int,
    supabase_retry_sleep_seconds: float,
    insert_sleep_seconds: float,
) -> int:
    supabase = _get_supabase_client()
    inserted = 0
    for index, chunk in enumerate(_chunked(list(alias_rows), batch_size), start=1):
        payload = [
            {
                "food_id": str(row.get("food_id") or "").strip(),
                "alias_name": str(row.get("alias_name") or "").strip(),
                "normalized_alias": str(row.get("normalized_alias") or "").strip(),
            }
            for row in chunk
            if str(row.get("food_id") or "").strip()
            and str(row.get("alias_name") or "").strip()
            and str(row.get("normalized_alias") or "").strip()
        ]
        if not payload:
            continue
        _execute_supabase_request(
            supabase.table("food_nutrition_aliases").upsert(
                payload,
                on_conflict="normalized_alias",
                ignore_duplicates=True,
            ),
            action=f"insert_alias_rows_batch_{index}",
            max_retries=supabase_retries,
            retry_sleep_seconds=supabase_retry_sleep_seconds,
        )
        inserted += len(payload)
        _sleep_with_log(insert_sleep_seconds, f"after insert batch {index}")
    return inserted


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Translate USDA English foods into Chinese aliases")
    parser.add_argument(
        "--provider",
        choices=["deepseek", "dashscope", "ofox"],
        default=os.getenv("TRANSLATION_PROVIDER", "deepseek"),
        help="Translation provider, default deepseek",
    )
    parser.add_argument(
        "--model",
        default=os.getenv("TRANSLATION_MODEL") or "deepseek-chat",
        help="Model name, default deepseek-chat",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=1000,
        help="Maximum number of foods to process, default 1000",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=20,
        help="Foods per translation batch, default 20",
    )
    parser.add_argument(
        "--insert-batch-size",
        type=int,
        default=200,
        help="Rows per database insert batch, default 200",
    )
    parser.add_argument(
        "--alias-lookup-batch-size",
        type=int,
        default=100,
        help="Rows per Supabase lookup batch, default 100",
    )
    parser.add_argument(
        "--source-prefix",
        default="usda_",
        help="Only process foods where source starts with this prefix, default usda_",
    )
    parser.add_argument(
        "--input-json",
        default="",
        help="Read USDA food rows from a local JSON file instead of querying Supabase",
    )
    parser.add_argument(
        "--include-with-zh-alias",
        action="store_true",
        help="Re-translate foods that already have Chinese aliases",
    )
    parser.add_argument(
        "--skip-existing-check",
        action="store_true",
        help="Skip checking existing aliases in Supabase before generating SQL",
    )
    parser.add_argument(
        "--sleep-seconds",
        type=float,
        default=0.2,
        help="Pause between translation batches, default 0.2 seconds",
    )
    parser.add_argument(
        "--supabase-chunk-sleep-seconds",
        type=float,
        default=0.3,
        help="Pause between Supabase read batches, default 0.3 seconds",
    )
    parser.add_argument(
        "--insert-sleep-seconds",
        type=float,
        default=0.5,
        help="Pause between Supabase insert batches, default 0.5 seconds",
    )
    parser.add_argument(
        "--supabase-retries",
        type=int,
        default=3,
        help="Retries for Supabase requests, default 3",
    )
    parser.add_argument(
        "--supabase-retry-sleep-seconds",
        type=float,
        default=1.0,
        help="Base sleep between Supabase retries, default 1.0 seconds",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=60.0,
        help="API timeout in seconds, default 60",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview only, do not insert into the database",
    )
    parser.add_argument(
        "--json-output",
        default="",
        help="Write preview JSON to this path",
    )
    parser.add_argument(
        "--sql-output",
        default="",
        help="Write insert SQL to this path",
    )
    return parser.parse_args()


def main() -> int:
    _load_env()
    args = parse_args()
    os.environ["TRANSLATION_PROVIDER"] = str(args.provider)

    if args.input_json:
        foods = _load_foods_from_json(Path(args.input_json), limit=max(1, int(args.limit)))
    else:
        foods = _fetch_usda_foods(
            limit=max(1, int(args.limit)),
            source_prefix=str(args.source_prefix),
            only_without_zh_alias=not bool(args.include_with_zh_alias),
            alias_lookup_batch_size=max(1, int(args.alias_lookup_batch_size)),
            supabase_retries=max(0, int(args.supabase_retries)),
            supabase_retry_sleep_seconds=max(0.0, float(args.supabase_retry_sleep_seconds)),
            supabase_chunk_sleep_seconds=max(0.0, float(args.supabase_chunk_sleep_seconds)),
        )
    if args.input_json and not args.include_with_zh_alias:
        foods = _filter_foods_without_existing_zh_alias(
            foods,
            alias_lookup_batch_size=max(1, int(args.alias_lookup_batch_size)),
            supabase_retries=max(0, int(args.supabase_retries)),
            supabase_retry_sleep_seconds=max(0.0, float(args.supabase_retry_sleep_seconds)),
            supabase_chunk_sleep_seconds=max(0.0, float(args.supabase_chunk_sleep_seconds)),
        )
    print(f"[translate_usda_aliases] fetched_foods={len(foods)}")
    if not foods:
        print("[translate_usda_aliases] no foods need translation")
        return 0

    translator = Translator(
        model=str(args.model),
        timeout_seconds=max(5.0, float(args.timeout_seconds)),
    )
    translated_rows_all: List[Dict[str, Any]] = []
    alias_rows_all: List[Dict[str, str]] = []
    inserted_total = 0
    batch_size = max(1, int(args.batch_size))
    alias_lookup_batch_size = max(1, int(args.alias_lookup_batch_size))
    supabase_retries = max(0, int(args.supabase_retries))
    supabase_retry_sleep_seconds = max(0.0, float(args.supabase_retry_sleep_seconds))
    supabase_chunk_sleep_seconds = max(0.0, float(args.supabase_chunk_sleep_seconds))
    insert_sleep_seconds = max(0.0, float(args.insert_sleep_seconds))

    try:
        total_food_batches = (len(foods) + batch_size - 1) // batch_size
        for batch_index, foods_chunk in enumerate(_chunked(foods, batch_size), start=1):
            translated_rows = _translate_foods(
                foods=list(foods_chunk),
                translator=translator,
                batch_size=batch_size,
                sleep_seconds=max(0.0, float(args.sleep_seconds)),
            )
            alias_rows = _flatten_alias_rows(translated_rows)
            if not args.skip_existing_check:
                alias_rows = _filter_existing_aliases(
                    alias_rows,
                    alias_lookup_batch_size=alias_lookup_batch_size,
                    supabase_retries=supabase_retries,
                    supabase_retry_sleep_seconds=supabase_retry_sleep_seconds,
                    supabase_chunk_sleep_seconds=supabase_chunk_sleep_seconds,
                )

            translated_rows_all.extend(translated_rows)
            alias_rows_all.extend(alias_rows)

            print(
                f"[translate_usda_aliases] batch_progress={batch_index}/{total_food_batches} "
                f"translated_items={len(translated_rows)} new_alias_rows={len(alias_rows)}"
            )

            if batch_index == 1:
                for row in translated_rows[:5]:
                    print(
                        f"  - {row['english_name']} -> {row['zh_name']} | "
                        f"aliases={', '.join(row['aliases'][:5])}"
                    )

            if args.dry_run:
                continue

            alias_rows = _resolve_food_ids_for_alias_rows(
                alias_rows,
                alias_lookup_batch_size=alias_lookup_batch_size,
                supabase_retries=supabase_retries,
                supabase_retry_sleep_seconds=supabase_retry_sleep_seconds,
                supabase_chunk_sleep_seconds=supabase_chunk_sleep_seconds,
            )

            inserted = _insert_alias_rows(
                alias_rows,
                batch_size=max(1, int(args.insert_batch_size)),
                supabase_retries=supabase_retries,
                supabase_retry_sleep_seconds=supabase_retry_sleep_seconds,
                insert_sleep_seconds=insert_sleep_seconds,
            )
            inserted_total += inserted
            print(
                f"[translate_usda_aliases] batch_inserted_alias_rows={inserted} "
                f"inserted_total={inserted_total}"
            )
    finally:
        translator.close()

    print(
        f"[translate_usda_aliases] translated_items={len(translated_rows_all)} "
        f"new_alias_rows={len(alias_rows_all)}"
    )

    if args.json_output:
        _write_json(Path(args.json_output), translated_rows_all, alias_rows_all)
        print(f"[translate_usda_aliases] wrote_json={args.json_output}")

    if args.sql_output:
        _write_sql(Path(args.sql_output), alias_rows_all)
        print(f"[translate_usda_aliases] wrote_sql={args.sql_output}")

    if args.dry_run:
        return 0

    print(f"[translate_usda_aliases] inserted_alias_rows={inserted_total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
