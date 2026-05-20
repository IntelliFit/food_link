#!/usr/bin/env python3
"""
Build and enrich public.packaged_food_library for common packaged snacks.

Default behavior does not require manual product names. The script uses a
curated seed list of common snacks and drinks, searches public web snippets for
each item, asks the configured AI to extract nutrition label data, and lets the
AI fill missing fields when public snippets are incomplete. Rows are marked by
source:

- web_ai_extracted: required fields were found from public snippets.
- web_ai_completed: public snippets were partial, AI completed missing fields.
- ai_estimated_seed: no useful public snippets, AI estimated from known product
  category/common label patterns.

Examples:
    python scripts/enrich_packaged_foods.py --dry-run --limit 20
    python scripts/enrich_packaged_foods.py --category cookie --limit 50
    python scripts/enrich_packaged_foods.py --input scripts/packaged_food_queries.txt
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv

psycopg2 = None
yaml = None

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
DEFAULT_STATE_FILE = ROOT_DIR / "scripts" / "enrich_packaged_foods.state.json"

COMMON_SNACK_SEEDS: Dict[str, List[str]] = {
    "cookie": [
        "奥利奥 原味夹心饼干 97g",
        "奥利奥 巧克力味夹心饼干 97g",
        "趣多多 香脆曲奇 巧克力味",
        "康师傅 3+2 苏打夹心饼干",
        "太平 梳打饼干 奶盐味",
        "嘉士利 早餐饼干",
        "格力高 百奇 巧克力味",
        "格力高 百醇 注心饼干",
        "丽芝士 纳宝帝 奶酪威化饼干",
        "雀巢 脆脆鲨 威化",
    ],
    "chips": [
        "乐事 美国经典原味薯片",
        "乐事 黄瓜味薯片",
        "乐事 德克萨斯烧烤味薯片",
        "可比克 原味薯片",
        "上好佳 鲜虾片",
        "上好佳 田园薯片",
        "品客 原味薯片",
        "多力多滋 玉米片",
        "旺旺 仙贝",
        "旺旺 雪饼",
    ],
    "candy_chocolate": [
        "德芙 丝滑牛奶巧克力",
        "士力架 花生夹心巧克力",
        "M豆 牛奶巧克力豆",
        "费列罗 榛果威化巧克力",
        "好时 牛奶巧克力",
        "徐福记 酥心糖",
        "阿尔卑斯 牛奶硬糖",
        "曼妥思 薄荷糖",
        "不二家 棒棒糖",
        "悠哈 特浓牛奶糖",
    ],
    "nuts": [
        "洽洽 香瓜子",
        "洽洽 小黄袋 每日坚果",
        "三只松鼠 每日坚果",
        "百草味 每日坚果",
        "良品铺子 每日坚果",
        "沃隆 每日坚果",
        "甘源 蟹黄味瓜子仁",
        "黄飞红 麻辣花生",
        "三只松鼠 碧根果",
        "百草味 巴旦木",
    ],
    "meat_seafood": [
        "良品铺子 猪肉脯",
        "三只松鼠 猪肉脯",
        "来伊份 鸭脖",
        "周黑鸭 鸭脖",
        "卫龙 魔芋爽",
        "卫龙 大面筋",
        "劲仔 小鱼干",
        "口水娃 小鱼仔",
        "无穷 盐焗鸡蛋",
        "双汇 王中王 火腿肠",
    ],
    "bakery": [
        "达利园 法式小面包",
        "盼盼 手撕面包",
        "桃李 醇熟切片面包",
        "好丽友 派 巧克力味",
        "好丽友 蛋黄派",
        "港荣 蒸蛋糕",
        "稻香村 桃酥",
        "友臣 肉松饼",
        "徐福记 沙琪玛",
        "泓一 岩烧乳酪吐司",
    ],
    "drink_dairy": [
        "可口可乐 330ml",
        "百事可乐 330ml",
        "元气森林 气泡水 白桃味 480ml",
        "农夫山泉 东方树叶 茉莉花茶 500ml",
        "统一 阿萨姆奶茶 500ml",
        "康师傅 冰红茶 500ml",
        "伊利 安慕希 希腊风味酸奶",
        "蒙牛 纯甄 风味酸奶",
        "旺仔牛奶 245ml",
        "维他奶 原味豆奶 250ml",
    ],
    "instant": [
        "康师傅 红烧牛肉面",
        "统一 老坛酸菜牛肉面",
        "汤达人 日式豚骨拉面",
        "白象 汤好喝 辣牛肉汤面",
        "合味道 海鲜风味杯面",
        "海底捞 自热火锅",
        "莫小仙 自热米饭",
        "三养 火鸡面",
        "螺霸王 螺蛳粉",
        "好欢螺 螺蛳粉",
    ],
}


def lazy_imports() -> None:
    global psycopg2, yaml
    if psycopg2 is None:
        import psycopg2 as _psycopg2

        psycopg2 = _psycopg2
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
    host = config_value(cfg, "database", "host")
    if not host:
        raise RuntimeError("Database config not found. Set DATABASE_URL or backend/config.yaml database.*")
    port = config_value(cfg, "database", "port") or "5432"
    user = config_value(cfg, "database", "user") or "postgres"
    password = config_value(cfg, "database", "password") or ""
    database = config_value(cfg, "database", "name") or config_value(cfg, "database", "database") or "postgres"
    sslmode = config_value(cfg, "database", "sslmode") or "disable"
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
    return {"api_url": normalize_chat_completions_url(api_url), "api_key": api_key, "model": model}


def normalize_chat_completions_url(api_url: str) -> str:
    url = api_url.strip().rstrip("/")
    if url.endswith("/chat/completions"):
        return url
    if url.endswith("/v1"):
        return url + "/chat/completions"
    return url + "/chat/completions"


def normalize_name(value: str) -> str:
    return "".join(ch.lower() for ch in value.strip() if ch.isalnum())


def load_state(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"processed": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"processed": {}}
    if not isinstance(data, dict):
        return {"processed": {}}
    if not isinstance(data.get("processed"), dict):
        data["processed"] = {}
    return data


def save_state(path: Path, state: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def mark_processed(state: Dict[str, Any], query: str, status: str, row: Optional[Dict[str, Any]] = None) -> None:
    key = normalize_name(query)
    if not key:
        return
    state.setdefault("processed", {})[key] = {
        "query": query,
        "status": status,
        "product_name": str((row or {}).get("product_name") or ""),
        "source": source_from_quality(row or {}) if row else "",
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def already_processed(state: Dict[str, Any], query: str) -> bool:
    return normalize_name(query) in state.get("processed", {})


def existing_normalized_names(conn: Any, queries: List[str]) -> set[str]:
    if conn is None or not queries:
        return set()
    names = [normalize_name(q) for q in queries if normalize_name(q)]
    if not names:
        return set()
    with conn.cursor() as cur:
        try:
            cur.execute(
                "SELECT normalized_name FROM public.packaged_food_library WHERE normalized_name = ANY(%s) AND is_active = true",
                (names,),
            )
        except psycopg2.errors.UndefinedTable as exc:
            conn.rollback()
            raise RuntimeError(
                "packaged_food_library table does not exist in the configured database. "
                "Run backend migration first: cd backend && go run ./cmd/migration -config-dir ."
            ) from exc
        return {row[0] for row in cur.fetchall()}


def search_web(query: str, timeout: int) -> List[Dict[str, str]]:
    url = "https://duckduckgo.com/html/"
    resp = requests.get(
        url,
        params={"q": query + " 营养成分 净含量 蛋白质 脂肪 碳水"},
        timeout=timeout,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    resp.raise_for_status()
    html = resp.text
    results: List[Dict[str, str]] = []
    for match in re.finditer(r'<a rel="nofollow" class="result__a" href="(?P<url>[^"]+)">(?P<title>.*?)</a>', html, re.S):
        title = re.sub(r"<.*?>", "", match.group("title"))
        source_url = match.group("url").replace("&amp;", "&")
        if title.strip():
            results.append({"title": title.strip(), "url": source_url})
        if len(results) >= 8:
            break
    return results


def build_prompt(query: str, snippets: List[Dict[str, str]], allow_ai_completion: bool) -> str:
    completion_rule = (
        "如果公开搜索结果缺少部分字段，可以根据同品牌同规格、常见包装营养标签或同类产品合理补全；"
        "补全字段必须写入 ai_completed_fields，source_quality 标为 partial_web_ai_completed 或 ai_estimated。"
        if allow_ai_completion
        else "如果公开搜索结果缺少必需字段，不要补全；confidence 必须低于 0.6。"
    )
    return (
        "你是预包装食品营养标签录入助手。目标是给健康管理小程序建立可检索的零食数据库。\n"
        "优先从公开搜索结果提取包装净含量和营养成分；不要用视觉估重。\n"
        f"{completion_rule}\n"
        "只返回 JSON，不要解释。字段必须使用数字，不要带单位字符串。\n"
        "required JSON fields: brand, product_name, aliases, net_weight_g, serving_weight_g, "
        "kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, "
        "sugar_per_100g, saturated_fat_per_100g, sodium_mg_per_100g, source_url, "
        "source_quality, ai_completed_fields, confidence.\n"
        "source_quality enum: full_web, partial_web_ai_completed, ai_estimated.\n"
        "confidence: full_web 通常 >=0.8；partial_web_ai_completed 0.6-0.79；ai_estimated 0.45-0.65。\n"
        f"商品查询：{query}\n"
        f"公开搜索结果：{json.dumps(snippets, ensure_ascii=False)}"
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


def as_float(row: Dict[str, Any], key: str) -> float:
    try:
        return float(row.get(key) or 0)
    except (TypeError, ValueError):
        return 0


def valid_row(row: Dict[str, Any], min_confidence: float) -> bool:
    return (
        str(row.get("product_name") or "").strip()
        and as_float(row, "net_weight_g") > 0
        and as_float(row, "kcal_per_100g") > 0
        and max(as_float(row, "protein_per_100g"), as_float(row, "carbs_per_100g"), as_float(row, "fat_per_100g")) > 0
        and as_float(row, "confidence") >= min_confidence
    )


def source_from_quality(row: Dict[str, Any]) -> str:
    quality = str(row.get("source_quality") or "").strip()
    completed = row.get("ai_completed_fields") or []
    if quality == "full_web" and not completed:
        return "web_ai_extracted"
    if quality in {"partial_web_ai_completed", "full_web"}:
        return "web_ai_completed"
    return "ai_estimated_seed"


def upsert_row(conn: Any, row: Dict[str, Any], dry_run: bool) -> None:
    product_name = str(row["product_name"]).strip()
    normalized = normalize_name(product_name)
    payload = {
        "brand": str(row.get("brand") or "").strip(),
        "product_name": product_name,
        "normalized_name": normalized,
        "net_weight_g": as_float(row, "net_weight_g"),
        "serving_weight_g": as_float(row, "serving_weight_g") or as_float(row, "net_weight_g"),
        "kcal_per_100g": as_float(row, "kcal_per_100g"),
        "protein_per_100g": as_float(row, "protein_per_100g"),
        "carbs_per_100g": as_float(row, "carbs_per_100g"),
        "fat_per_100g": as_float(row, "fat_per_100g"),
        "fiber_per_100g": as_float(row, "fiber_per_100g"),
        "sugar_per_100g": as_float(row, "sugar_per_100g"),
        "saturated_fat_per_100g": as_float(row, "saturated_fat_per_100g"),
        "sodium_mg_per_100g": as_float(row, "sodium_mg_per_100g"),
        "source_url": str(row.get("source_url") or "").strip(),
        "source": source_from_quality(row),
    }
    if dry_run:
        print(json.dumps({**payload, "confidence": row.get("confidence"), "ai_completed_fields": row.get("ai_completed_fields")}, ensure_ascii=False, indent=2))
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


def default_seed_queries(categories: Optional[List[str]]) -> List[str]:
    selected = categories or list(COMMON_SNACK_SEEDS.keys())
    queries: List[str] = []
    for category in selected:
        if category not in COMMON_SNACK_SEEDS:
            raise ValueError(f"Unknown category: {category}. Available: {', '.join(COMMON_SNACK_SEEDS)}")
        queries.extend(COMMON_SNACK_SEEDS[category])
    return queries


def read_queries(args: argparse.Namespace) -> List[str]:
    queries: List[str] = []
    if args.query:
        queries.extend(args.query)
    if args.input:
        for line in Path(args.input).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                queries.append(line)
    if not queries:
        queries = default_seed_queries(args.category)
    deduped: List[str] = []
    seen = set()
    for query in queries:
        key = normalize_name(query)
        if key and key not in seen:
            deduped.append(query)
            seen.add(key)
    if args.limit > 0:
        deduped = deduped[: args.limit]
    return deduped


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich packaged snack nutrition database")
    parser.add_argument("--query", action="append", help="Optional extra product query, can be repeated")
    parser.add_argument("--input", help="Optional text file with one product query per line")
    parser.add_argument("--category", action="append", choices=sorted(COMMON_SNACK_SEEDS.keys()), help="Seed category to run; repeatable")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--sleep", type=float, default=1.0)
    parser.add_argument("--min-confidence", type=float, default=0.6)
    parser.add_argument("--no-ai-completion", action="store_true", help="Only accept fields supported by public snippets")
    parser.add_argument("--state-file", default=str(DEFAULT_STATE_FILE), help="Local processed-query state file")
    parser.add_argument("--no-skip-processed", action="store_true", help="Ignore local processed state and reprocess seeds")
    parser.add_argument("--no-skip-existing", action="store_true", help="Do not skip rows already present in packaged_food_library")
    args = parser.parse_args()

    queries = read_queries(args)
    cfg = ai_config()
    state_path = Path(args.state_file)
    state = load_state(state_path)
    conn = None
    if not args.dry_run:
        lazy_imports()
        conn = psycopg2.connect(database_dsn())
    existing = set()
    if conn is not None and not args.no_skip_existing:
        existing = existing_normalized_names(conn, queries)
    try:
        for query in queries:
            query_key = normalize_name(query)
            if not args.no_skip_processed and already_processed(state, query):
                print(f"[skip:state] {query}")
                continue
            if query_key in existing:
                print(f"[skip:db] {query}")
                mark_processed(state, query, "existing_db")
                save_state(state_path, state)
                continue
            snippets = search_web(query, args.timeout)
            row = call_ai(build_prompt(query, snippets, not args.no_ai_completion), cfg, args.timeout)
            if not valid_row(row, args.min_confidence):
                print(f"[skip] incomplete or low confidence: {query} -> {json.dumps(row, ensure_ascii=False)}")
                mark_processed(state, query, "skipped_low_confidence", row)
                save_state(state_path, state)
                continue
            upsert_row(conn, row, args.dry_run)
            mark_processed(state, query, "dry_run_ok" if args.dry_run else "upserted", row)
            save_state(state_path, state)
            print(f"[ok] {source_from_quality(row)} {query} -> {row.get('product_name')} {row.get('net_weight_g')}g")
            time.sleep(args.sleep)
    finally:
        if conn is not None:
            conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
