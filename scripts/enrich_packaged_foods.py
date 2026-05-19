#!/usr/bin/env python3
"""
Collect packaged snack nutrition data into public.packaged_food_library.

The script accepts explicit product names or a text file, searches public web
pages, asks the configured AI to extract label data from the snippets, and
upserts only rows with a product name, package weight, calories, and at least
one macro nutrient.

Examples:
    python scripts/enrich_packaged_foods.py --dry-run --query "奥利奥 夹心饼干 97g"
    python scripts/enrich_packaged_foods.py --input scripts/packaged_food_queries.txt --limit 50
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import requests
from dotenv import load_dotenv

psycopg2 = None
RealDictCursor = None
yaml = None

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"


def lazy_imports() -> None:
    global psycopg2, RealDictCursor, yaml
    if psycopg2 is None:
        import psycopg2 as _psycopg2
        from psycopg2.extras import RealDictCursor as _RealDictCursor

        psycopg2 = _psycopg2
        RealDictCursor = _RealDictCursor
    if yaml is None:
        import yaml as _yaml

        yaml = _yaml


def load_yaml(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    lazy_imports()
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def config_value(config: Dict[str, Any], *keys: str) -> Optional[str]:
    cur: Any = config
    for key in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    if cur is None:
        return None
    text = str(cur).strip()
    return text or None


def database_dsn() -> str:
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(BACKEND_DIR / ".env")
    for env in ("DATABASE_URL", "SUPABASE_DB_URL"):
        value = os.getenv(env)
        if value:
            return value
    cfg = load_yaml(BACKEND_DIR / "config.yaml")
    host = config_value(cfg, "postgresql", "host")
    if not host:
        raise RuntimeError("Database config not found. Set DATABASE_URL or backend/config.yaml postgresql.*")
    port = config_value(cfg, "postgresql", "port") or "5432"
    user = config_value(cfg, "postgresql", "user") or "postgres"
    password = config_value(cfg, "postgresql", "password") or ""
    database = config_value(cfg, "postgresql", "database") or "postgres"
    sslmode = config_value(cfg, "postgresql", "sslmode") or "disable"
    return f"host={host} port={port} user={user} password={password} dbname={database} sslmode={sslmode}"


def ai_config() -> Dict[str, str]:
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(BACKEND_DIR / ".env")
    cfg = load_yaml(BACKEND_DIR / "develop-config.yaml")
    api_url = os.getenv("AI_API_URL") or config_value(cfg, "llm_api_url") or config_value(cfg, "llm", "api_url")
    api_key = os.getenv("AI_API_KEY") or config_value(cfg, "llm_api_key") or config_value(cfg, "llm", "api_key")
    model = os.getenv("AI_MODEL") or config_value(cfg, "llm_model") or config_value(cfg, "llm", "model") or "deepseek-v4-pro"
    if not api_url or not api_key:
        raise RuntimeError("AI config not found. Set AI_API_URL and AI_API_KEY or backend/develop-config.yaml")
    return {"api_url": api_url.rstrip("/"), "api_key": api_key, "model": model}


def normalize_name(value: str) -> str:
    return "".join(ch.lower() for ch in value.strip() if ch.isalnum())


def search_web(query: str, timeout: int) -> List[Dict[str, str]]:
    url = "https://duckduckgo.com/html/"
    resp = requests.get(url, params={"q": query + " 营养成分 净含量"}, timeout=timeout, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    html = resp.text
    results: List[Dict[str, str]] = []
    for match in re.finditer(r'<a rel="nofollow" class="result__a" href="(?P<url>[^"]+)">(?P<title>.*?)</a>', html, re.S):
        title = re.sub(r"<.*?>", "", match.group("title"))
        source_url = match.group("url").replace("&amp;", "&")
        if title.strip():
            results.append({"title": title.strip(), "url": source_url})
        if len(results) >= 6:
            break
    return results


def build_prompt(query: str, snippets: List[Dict[str, str]]) -> str:
    return (
        "你是预包装食品营养标签录入助手。根据用户给出的商品名和公开搜索结果，提取可落库数据。"
        "只返回 JSON，不要解释。若公开信息不足，不要编造，返回 confidence < 0.6。\n"
        "必须优先使用包装净含量/规格，不要用视觉估重。\n"
        "JSON 字段：brand, product_name, aliases, net_weight_g, serving_weight_g, "
        "kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, "
        "sugar_per_100g, saturated_fat_per_100g, sodium_mg_per_100g, source_url, confidence。\n"
        f"商品查询：{query}\n搜索结果：{json.dumps(snippets, ensure_ascii=False)}"
    )


def call_ai(prompt: str, cfg: Dict[str, str], timeout: int) -> Dict[str, Any]:
    resp = requests.post(
        cfg["api_url"],
        headers={"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"},
        json={
            "model": cfg["model"],
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    return json.loads(content)


def valid_row(row: Dict[str, Any]) -> bool:
    return (
        str(row.get("product_name") or "").strip()
        and float(row.get("net_weight_g") or 0) > 0
        and float(row.get("kcal_per_100g") or 0) > 0
        and max(float(row.get("protein_per_100g") or 0), float(row.get("carbs_per_100g") or 0), float(row.get("fat_per_100g") or 0)) > 0
        and float(row.get("confidence") or 0) >= 0.6
    )


def upsert_row(conn: Any, row: Dict[str, Any], dry_run: bool) -> None:
    product_name = str(row["product_name"]).strip()
    normalized = normalize_name(product_name)
    payload = {
        "brand": str(row.get("brand") or "").strip(),
        "product_name": product_name,
        "normalized_name": normalized,
        "net_weight_g": float(row.get("net_weight_g") or 0),
        "serving_weight_g": float(row.get("serving_weight_g") or row.get("net_weight_g") or 0),
        "kcal_per_100g": float(row.get("kcal_per_100g") or 0),
        "protein_per_100g": float(row.get("protein_per_100g") or 0),
        "carbs_per_100g": float(row.get("carbs_per_100g") or 0),
        "fat_per_100g": float(row.get("fat_per_100g") or 0),
        "fiber_per_100g": float(row.get("fiber_per_100g") or 0),
        "sugar_per_100g": float(row.get("sugar_per_100g") or 0),
        "saturated_fat_per_100g": float(row.get("saturated_fat_per_100g") or 0),
        "sodium_mg_per_100g": float(row.get("sodium_mg_per_100g") or 0),
        "source_url": str(row.get("source_url") or "").strip(),
        "source": "web_ai_extracted",
    }
    if dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    columns = list(payload.keys())
    placeholders = ", ".join(["%s"] * len(columns))
    updates = ", ".join([f"{c}=EXCLUDED.{c}" for c in columns if c != "normalized_name"])
    sql = f"""
        INSERT INTO public.packaged_food_library ({", ".join(columns)})
        VALUES ({placeholders})
        ON CONFLICT (normalized_name) DO UPDATE SET {updates}, updated_at=now()
        RETURNING id
    """
    with conn.cursor() as cur:
        cur.execute(sql, [payload[c] for c in columns])
        food_id = cur.fetchone()[0]
        aliases = set(str(a).strip() for a in row.get("aliases") or [] if str(a).strip())
        aliases.add(product_name)
        for alias in aliases:
            cur.execute(
                """
                INSERT INTO public.packaged_food_aliases (food_id, alias_name, normalized_alias)
                VALUES (%s, %s, %s)
                ON CONFLICT (normalized_alias) DO UPDATE SET food_id=EXCLUDED.food_id, alias_name=EXCLUDED.alias_name, updated_at=now()
                """,
                (food_id, alias, normalize_name(alias)),
            )
    conn.commit()


def read_queries(args: argparse.Namespace) -> List[str]:
    queries: List[str] = []
    if args.query:
        queries.extend(args.query)
    if args.input:
        for line in Path(args.input).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                queries.append(line)
    if args.limit > 0:
        queries = queries[: args.limit]
    return queries


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich packaged snack nutrition database")
    parser.add_argument("--query", action="append", help="Product query, can be repeated")
    parser.add_argument("--input", help="Text file with one product query per line")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--sleep", type=float, default=1.0)
    args = parser.parse_args()

    queries = read_queries(args)
    if not queries:
        parser.error("Provide --query or --input")
    cfg = ai_config()
    conn = None
    if not args.dry_run:
        lazy_imports()
        conn = psycopg2.connect(database_dsn())
    try:
        for query in queries:
            snippets = search_web(query, args.timeout)
            row = call_ai(build_prompt(query, snippets), cfg, args.timeout)
            if not valid_row(row):
                print(f"[skip] low confidence or incomplete: {query} -> {json.dumps(row, ensure_ascii=False)}")
                continue
            upsert_row(conn, row, args.dry_run)
            print(f"[ok] {query} -> {row.get('product_name')} {row.get('net_weight_g')}g")
            time.sleep(args.sleep)
    finally:
        if conn is not None:
            conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
