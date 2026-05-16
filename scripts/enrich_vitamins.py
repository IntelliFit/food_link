#!/usr/bin/env python3
"""
补全 food_nutrition_library 中维生素数据全为 0 的食物。

功能：
1. 查询 food_nutrition_library 表中所有维生素字段均为 0 的记录；
2. 将每条记录的食物名称 + 已知营养数据打包成 prompt，调用大模型推断维生素含量；
3. 解析 AI 返回的 JSON，UPDATE 回数据库。

环境变量（必填）：
    DATABASE_URL 或 SUPABASE_DB_URL    PostgreSQL 连接串
环境变量（可选）：
    AI_MAX_CONCURRENT   最大并发数，默认 5
    AI_TIMEOUT          单条请求超时（秒），默认 60
    AI_MAX_RETRIES      单条请求最大重试次数，默认 2

AI 配置来源（优先级）：
    1. backend/develop-config.yaml 中的 llm_api_url / llm_api_key / llm_model
    2. 环境变量 AI_API_URL / AI_API_KEY / AI_MODEL

用法示例：
    # 先 dry-run 预览要处理哪些食物
    python scripts/enrich_vitamins.py --dry-run

    # 正式执行，只处理前 30 条
    python scripts/enrich_vitamins.py --limit 30

    # 全量执行
    python scripts/enrich_vitamins.py
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    import yaml
except ImportError:
    print("请先安装依赖: pip install psycopg2-binary requests python-dotenv pyyaml", file=sys.stderr)
    raise SystemExit(1)

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------
VITAMIN_COLUMNS = [
    "vitamin_a_rae_mcg_per_100g",
    "vitamin_c_mg_per_100g",
    "vitamin_d_mcg_per_100g",
    "vitamin_e_mg_per_100g",
    "vitamin_k_mcg_per_100g",
    "thiamin_mg_per_100g",
    "riboflavin_mg_per_100g",
    "niacin_mg_per_100g",
    "vitamin_b6_mg_per_100g",
    "folate_mcg_per_100g",
    "vitamin_b12_mcg_per_100g",
]

KNOWN_COLUMNS = [
    "kcal_per_100g",
    "protein_per_100g",
    "carbs_per_100g",
    "fat_per_100g",
    "fiber_per_100g",
    "sugar_per_100g",
    "saturated_fat_per_100g",
    "cholesterol_mg_per_100g",
    "sodium_mg_per_100g",
    "potassium_mg_per_100g",
    "calcium_mg_per_100g",
    "iron_mg_per_100g",
    "magnesium_mg_per_100g",
    "zinc_mg_per_100g",
]

COLUMN_LABELS = {
    "kcal_per_100g": "热量（kcal）",
    "protein_per_100g": "蛋白质（g）",
    "carbs_per_100g": "碳水（g）",
    "fat_per_100g": "脂肪（g）",
    "fiber_per_100g": "膳食纤维（g）",
    "sugar_per_100g": "糖（g）",
    "saturated_fat_per_100g": "饱和脂肪（g）",
    "cholesterol_mg_per_100g": "胆固醇（mg）",
    "sodium_mg_per_100g": "钠（mg）",
    "potassium_mg_per_100g": "钾（mg）",
    "calcium_mg_per_100g": "钙（mg）",
    "iron_mg_per_100g": "铁（mg）",
    "magnesium_mg_per_100g": "镁（mg）",
    "zinc_mg_per_100g": "锌（mg）",
    "vitamin_a_rae_mcg_per_100g": "维生素A（RAE, mcg）",
    "vitamin_c_mg_per_100g": "维生素C（mg）",
    "vitamin_d_mcg_per_100g": "维生素D（mcg）",
    "vitamin_e_mg_per_100g": "维生素E（mg）",
    "vitamin_k_mcg_per_100g": "维生素K（mcg）",
    "thiamin_mg_per_100g": "维生素B1/硫胺素（mg）",
    "riboflavin_mg_per_100g": "维生素B2/核黄素（mg）",
    "niacin_mg_per_100g": "烟酸（mg）",
    "vitamin_b6_mg_per_100g": "维生素B6（mg）",
    "folate_mcg_per_100g": "叶酸（mcg）",
    "vitamin_b12_mcg_per_100g": "维生素B12（mcg）",
}

# ---------------------------------------------------------------------------
# Prompt 模板
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = (
    "你是一位资深食品科学专家和营养师。"
    "你的任务是根据食物的已知营养成分，精确推断其维生素含量（每100g可食部）。"
    "如果某维生素在该食物中确实极微量或不存在，填 0。"
    "必须返回纯 JSON 对象，不要 markdown 代码块，不要任何解释文字。"
)

USER_PROMPT_TEMPLATE = """请补全以下食物的维生素含量。

食物名称：{canonical_name}

已知营养成分（每100g）：
{known_nutrients}

请基于该食物的类别和已知营养成分，推断以下维生素含量：
- vitamin_a_rae_mcg_per_100g: 维生素A（mcg，视黄醇活性当量）
- vitamin_c_mg_per_100g: 维生素C（mg）
- vitamin_d_mcg_per_100g: 维生素D（mcg）
- vitamin_e_mg_per_100g: 维生素E（mg）
- vitamin_k_mcg_per_100g: 维生素K（mcg）
- thiamin_mg_per_100g: 维生素B1/硫胺素（mg）
- riboflavin_mg_per_100g: 维生素B2/核黄素（mg）
- niacin_mg_per_100g: 烟酸（mg）
- vitamin_b6_mg_per_100g: 维生素B6（mg）
- folate_mcg_per_100g: 叶酸（mcg）
- vitamin_b12_mcg_per_100g: 维生素B12（mcg）

返回格式示例（纯JSON，不要markdown代码块）：
{{"vitamin_a_rae_mcg_per_100g": 12.3, "vitamin_c_mg_per_100g": 0, ...}}
"""


def build_user_prompt(row: Dict[str, Any]) -> str:
    lines = []
    for col in KNOWN_COLUMNS:
        label = COLUMN_LABELS.get(col, col)
        val = row.get(col)
        if val is not None:
            lines.append(f"- {label}: {val}")
    return USER_PROMPT_TEMPLATE.format(
        canonical_name=row["canonical_name"],
        known_nutrients="\n".join(lines),
    )


# ---------------------------------------------------------------------------
# 配置读取（优先 backend/*.yaml，其次 .env）
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"


def load_yaml(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except Exception:
        return None


def get_db_url() -> str:
    # 优先 backend/config.yaml
    cfg = load_yaml(BACKEND_DIR / "config.yaml")
    db_cfg = cfg.get("database") if cfg else None
    if db_cfg:
        user = db_cfg.get("user", "")
        password = db_cfg.get("password", "")
        host = db_cfg.get("host", "")
        port = db_cfg.get("port", 5432)
        name = db_cfg.get("name", "")
        sslmode = db_cfg.get("sslmode", "disable")
        return f"postgresql://{user}:{password}@{host}:{port}/{name}?sslmode={sslmode}"

    # 回退到环境变量
    url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit(
            "错误：未找到数据库配置。\n"
            "1) 确保 backend/config.yaml 存在且包含 database 字段；或\n"
            "2) 设置环境变量 DATABASE_URL 或 SUPABASE_DB_URL。"
        )
    return url


def get_ai_config() -> tuple[str, str, str]:
    # 优先 backend/develop-config.yaml
    dev_cfg = load_yaml(BACKEND_DIR / "develop-config.yaml")
    if dev_cfg:
        url = dev_cfg.get("llm_api_url")
        key = dev_cfg.get("llm_api_key")
        model = dev_cfg.get("llm_model")
        if url and key and model:
            return str(url), str(key), str(model)

    # 回退到环境变量
    url = os.getenv("AI_API_URL")
    key = os.getenv("AI_API_KEY")
    model = os.getenv("AI_MODEL")
    if not url or not key or not model:
        raise SystemExit(
            "错误：未找到 AI 配置。\n"
            "1) 确保 backend/develop-config.yaml 存在且包含 llm_api_url / llm_api_key / llm_model；或\n"
            "2) 设置环境变量 AI_API_URL / AI_API_KEY / AI_MODEL。"
        )
    return url, key, model


ALCOHOL_KEYWORDS = [
    "alcoholic", "wine", "beer", "liquor", "whiskey", "whisky",
    "vodka", "rum", "sake", "gin", "tequila", "brandy",
    "champagne", "cocktail", "spirit", "margarita", "cognac",
]


def fetch_vitamin_zero_foods(
    conn,
    limit: Optional[int] = None,
    exclude_alcohol: bool = False,
    exclude_pattern: Optional[str] = None,
) -> List[Dict[str, Any]]:
    where_clause = " AND ".join(f"{c} = 0" for c in VITAMIN_COLUMNS)
    conditions = [where_clause]

    if exclude_alcohol:
        alcohol_excludes = " AND ".join(
            f"canonical_name NOT ILIKE '%{k}%'" for k in ALCOHOL_KEYWORDS
        )
        conditions.append(alcohol_excludes)

    if exclude_pattern:
        import re
        # 简单安全检查：只允许字母数字空格逗号括号等常见字符
        safe_pattern = re.sub(r"[^a-zA-Z0-9\s,\(\)\-\_%\.\/]", "", exclude_pattern)
        if safe_pattern:
            conditions.append(f"canonical_name !~* '{safe_pattern}'")

    full_where = " AND ".join(conditions)
    sql = f"""
        SELECT id, canonical_name, {', '.join(KNOWN_COLUMNS)}
        FROM public.food_nutrition_library
        WHERE {full_where}
        ORDER BY canonical_name
    """
    if limit:
        sql += f" LIMIT {int(limit)}"
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql)
        return [dict(r) for r in cur.fetchall()]


def update_vitamins(conn, food_id: str, vitamins: Dict[str, float]) -> None:
    columns = []
    values = []
    for col in VITAMIN_COLUMNS:
        if col in vitamins:
            columns.append(f"{col} = %s")
            values.append(vitamins[col])
    if not columns:
        return
    values.append(food_id)
    sql = f"""
        UPDATE public.food_nutrition_library
        SET {', '.join(columns)}, updated_at = now()
        WHERE id = %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, values)


# ---------------------------------------------------------------------------
# AI 调用
# ---------------------------------------------------------------------------
def normalize_api_url(url: str) -> str:
    """自动补全 OpenAI 兼容格式的 chat completions 路径。"""
    url = url.rstrip("/")
    if not url.endswith("/chat/completions"):
        return f"{url}/v1/chat/completions"
    return url


def call_ai(
    api_url: str,
    api_key: str,
    model: str,
    user_prompt: str,
    timeout: int,
) -> Optional[Dict[str, Any]]:
    url = normalize_api_url(api_url)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    # 清理可能的 markdown 代码块
    content = content.strip()
    if content.startswith("```"):
        content = content.strip("`")
        if content.lower().startswith("json"):
            content = content[4:].strip()
    parsed = json.loads(content)
    return parsed


def call_ai_with_retry(
    api_url: str,
    api_key: str,
    model: str,
    user_prompt: str,
    timeout: int,
    max_retries: int,
) -> Optional[Dict[str, Any]]:
    for attempt in range(max_retries + 1):
        try:
            return call_ai(api_url, api_key, model, user_prompt, timeout)
        except Exception as e:
            if attempt == max_retries:
                raise
            wait = 2 ** attempt
            print(f"  请求失败（{e}），{wait}s 后重试（{attempt + 1}/{max_retries}）...")
            time.sleep(wait)
    return None


def parse_vitamins(raw: Dict[str, Any]) -> Dict[str, float]:
    result: Dict[str, float] = {}
    for col in VITAMIN_COLUMNS:
        val = raw.get(col)
        if val is None:
            continue
        try:
            result[col] = float(val)
        except (ValueError, TypeError):
            continue
    return result


# ---------------------------------------------------------------------------
# 单条处理
# ---------------------------------------------------------------------------
def process_one(
    row: Dict[str, Any],
    api_url: str,
    api_key: str,
    model: str,
    timeout: int,
    max_retries: int,
    dry_run: bool,
) -> Dict[str, Any]:
    food_id = row["id"]
    name = row["canonical_name"]
    prompt = build_user_prompt(row)

    try:
        raw = call_ai_with_retry(api_url, api_key, model, prompt, timeout, max_retries)
        if raw is None:
            return {"food_id": food_id, "name": name, "status": "error", "error": "AI 返回为空"}
        vitamins = parse_vitamins(raw)
        return {"food_id": food_id, "name": name, "status": "ok", "vitamins": vitamins, "dry_run": dry_run}
    except Exception as e:
        return {"food_id": food_id, "name": name, "status": "error", "error": str(e), "dry_run": dry_run}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description="补全 food_nutrition_library 维生素数据")
    parser.add_argument("--dry-run", action="store_true", help="调用 AI 生成数据并打印，但不写入数据库")
    parser.add_argument("--limit", type=int, default=None, help="限制处理数量")
    parser.add_argument("--batch", type=int, default=10, help="每批提交的数据库事务大小（默认 10）")
    parser.add_argument("--exclude-alcohol", action="store_true", help="排除酒精类饮料（wine/beer/liquor/vodka 等）")
    parser.add_argument("--exclude-pattern", type=str, default=None, help="自定义排除正则，匹配 canonical_name 时跳过")
    args = parser.parse_args()

    # 加载环境变量
    backend_dir = Path(__file__).resolve().parent.parent / "backend"
    for env_path in (backend_dir / ".env", Path(".env")):
        if env_path.exists():
            load_dotenv(env_path)
            break

    db_url = get_db_url()
    api_url, api_key, model = get_ai_config()
    max_concurrent = int(os.getenv("AI_MAX_CONCURRENT", "5"))
    timeout = int(os.getenv("AI_TIMEOUT", "60"))
    max_retries = int(os.getenv("AI_MAX_RETRIES", "2"))

    print(f"AI 配置: {api_url} | model={model} | concurrent={max_concurrent} | timeout={timeout}s")
    print(f"运行模式: {'DRY-RUN' if args.dry_run else 'WRITE'}")

    conn = psycopg2.connect(db_url)
    conn.autocommit = False

    try:
        foods = fetch_vitamin_zero_foods(
            conn,
            args.limit,
            exclude_alcohol=args.exclude_alcohol,
            exclude_pattern=args.exclude_pattern,
        )
        total = len(foods)
        print(f"\n查询到维生素全为 0 的食物: {total} 条")
        if total == 0:
            return 0

        if args.dry_run:
            print("\n⚠️ DRY-RUN 模式：会调用 AI 生成数据并打印，但不会写入数据库\n")

        print(f"\n开始调用 AI 补全（并发={max_concurrent}）...\n")

        success = 0
        failed = 0
        skipped = 0
        batch_updates: List[Dict[str, Any]] = []

        def flush_batch() -> None:
            nonlocal success
            if not batch_updates:
                return
            for item in batch_updates:
                if item["status"] == "ok" and item["vitamins"]:
                    update_vitamins(conn, item["food_id"], item["vitamins"])
                    success += 1
            conn.commit()
            batch_updates.clear()

        with ThreadPoolExecutor(max_workers=max_concurrent) as executor:
            futures = {
                executor.submit(
                    process_one,
                    row,
                    api_url,
                    api_key,
                    model,
                    timeout,
                    max_retries,
                    args.dry_run,
                ): row
                for row in foods
            }

            for future in as_completed(futures):
                result = future.result()
                name = result["name"]
                status = result["status"]
                is_dry = result.get("dry_run", False)

                if status == "ok":
                    vitamins = result.get("vitamins", {})
                    if vitamins:
                        if is_dry:
                            print(f"\n📋 [DRY-RUN] {name}")
                            for col in VITAMIN_COLUMNS:
                                val = vitamins.get(col)
                                if val is not None:
                                    print(f"    {COLUMN_LABELS.get(col, col)} = {val}")
                        else:
                            print(f"✅ {name} -> 补全 {len(vitamins)} 个维生素字段")
                            batch_updates.append(result)
                    else:
                        print(f"⚠️  {name} -> AI 未返回有效维生素数据，跳过")
                        skipped += 1
                else:
                    print(f"❌ {name} -> 错误: {result.get('error', 'unknown')}")
                    failed += 1

                if not is_dry and len(batch_updates) >= args.batch:
                    flush_batch()

            if not is_dry:
                flush_batch()

        print(f"\n{'=' * 50}")
        print(f"处理完成: 总计={total}, 成功={success}, 失败={failed}, 跳过={skipped}")
        print(f"{'=' * 50}")

    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
