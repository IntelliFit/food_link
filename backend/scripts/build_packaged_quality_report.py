"""Build the canonical portable artifact for the 2026-07-14 food-data audit."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List


ROOT = Path("tmp/packaged-serving-quality-20260714")


def load_json(name: str) -> Any:
    return json.loads((ROOT / name).read_text(encoding="utf-8"))


def model_value(item: Dict[str, Any], key: str) -> str:
    return str((item.get("vision_result") or {}).get(key) or "")


def main() -> int:
    serving_rows: List[Dict[str, Any]] = load_json("all_rows.json")
    serving_summary: Dict[str, Any] = load_json("summary.json")
    vision1: List[Dict[str, Any]] = load_json("vision-audit.json")
    vision2: List[Dict[str, Any]] = load_json("vision-audit-gemini35.json")
    first = {str(row["id"]): row for row in vision1 if row.get("vision_status") == "reviewed"}
    second = {str(row["id"]): row for row in vision2 if row.get("vision_status") == "reviewed"}
    both_ids = sorted(first.keys() & second.keys())
    pair_counts = Counter((model_value(first[row_id], "identity_match"), model_value(second[row_id], "identity_match")) for row_id in both_ids)
    consensus_mismatch = []
    serving_by_id = {str(row["id"]): row for row in serving_rows}
    for row_id in both_ids:
        left, right = first[row_id], second[row_id]
        if model_value(left, "identity_match") != "mismatch" or model_value(right, "identity_match") != "mismatch":
            continue
        source = serving_by_id.get(row_id, {})
        consensus_mismatch.append(
            {
                "id": row_id,
                "display_name": left.get("display_name") or source.get("display_name") or "",
                "container_weight_g": source.get("container_weight_g") or 0,
                "serving_weight_g": source.get("serving_weight_g") or 0,
                "review_status": source.get("review_status") or "active",
                "model_1_reason": model_value(left, "reason"),
                "model_2_reason": model_value(right, "reason"),
            }
        )

    needs_review = []
    for row in serving_rows:
        if row.get("quality_class") != "needs_source_review":
            continue
        needs_review.append(
            {
                "id": row["id"],
                "display_name": row.get("display_name") or "",
                "container_weight_g": row.get("container_weight_g") or 0,
                "serving_weight_g": row.get("serving_weight_g") or 0,
                "review_status": row.get("review_status") or "active",
                "issue": "较小份量未在每份口径、OCR、规格拆分或单位字段中找到证据",
            }
        )

    class_labels = {
        "supported_whole_container": ("整包份量有证据", 1, "份量与净含量一致"),
        "supported_explicit_serving": ("小份量有明确证据", 2, "每份口径、OCR、规格拆分或单位字段支持"),
        "needs_source_review": ("较小份量缺证据", 3, "小于整包但没有可追溯包装证据"),
        "missing_serving": ("缺少份量", 4, "没有 serving_weight_g，运行时回退净含量"),
    }
    class_rows = []
    active_rows = int(serving_summary["active_rows"])
    for key, count in serving_summary["quality_class_counts"].items():
        label, rank, definition = class_labels[key]
        class_rows.append(
            {
                "class": key,
                "category": label,
                "count": int(count),
                "share": int(count) / active_rows,
                "rank": rank,
                "definition": definition,
                "population": active_rows,
            }
        )
    class_rows.sort(key=lambda row: row["count"], reverse=True)

    supported_count = sum(
        int(serving_summary["quality_class_counts"].get(key, 0))
        for key in ("supported_whole_container", "supported_explicit_serving")
    )
    now = datetime.now().astimezone().isoformat()
    headline = [
        {
            "nutrition_rows": 13641,
            "packaged_rows": active_rows,
            "evidence_backed_servings": supported_count,
            "evidence_backed_share": supported_count / active_rows,
            "consensus_image_mismatches": len(consensus_mismatch),
            "double_reviewed_images": len(both_ids),
            "manually_quarantined": 5,
            "hard_invalid_remaining": 0,
        }
    ]

    db_source = {
        "id": "packaged_db_audit",
        "label": "生产包装食品库证据审计",
        "query": {
            "engine": "PostgreSQL",
            "sql": "SELECT * FROM public.packaged_food_library WHERE is_active = TRUE ORDER BY display_name, id",
            "description": "读取全部有效包装食品，并按净含量、份量、OCR、规格、营养口径和单位字段分类。",
            "executed_at": serving_summary["generated_at"],
            "language": "sql",
            "tables_used": ["public.packaged_food_library"],
            "filters": ["is_active = TRUE", "审计口径日期为2026-07-14"],
            "metric_definitions": [
                "证据支持份量 = 整包份量与净含量一致，或较小份量可由每份营养口径、OCR、规格拆分、单位字段之一直接印证",
                "较小份量缺证据 = serving_weight_g < 95% × 整包量，且没有上述任一直接证据",
            ],
        },
    }
    vision_source = {
        "id": "packaged_vision_audit",
        "label": "包装原图双模型视觉审计",
        "query": {
            "engine": "Wanjie Gemini native vision",
            "sql": "SELECT id, display_name, spec_text, source_image_urls, net_weight_g, net_content_value, net_content_unit, serving_weight_g FROM public.packaged_food_library WHERE is_active = TRUE ORDER BY display_name, id",
            "query": "audit_packaged_source_images_vision.py --model gemini-3-flash-preview; independent rerun with gemini-3.5-flash",
            "description": "逐条读取原始包装图，仅转录图片可见商品、净含量、份量拆分和营养表；禁止按常识猜测。",
            "executed_at": now,
            "language": "python",
            "filters": ["第一模型313/313", "第二模型283/313成功复核", "一致错配要求两模型均为mismatch"],
            "metric_definitions": ["双模型一致错配 = 同一条记录在两个独立视觉模型中均判定 identity_match=mismatch"],
        },
    }
    nutrition_source = {
        "id": "nutrition_deepseek_audit",
        "label": "营养主库 DeepSeek V4 Pro 全量审计",
        "query": {
            "engine": "PostgreSQL + Wanjie OpenAI-compatible API",
            "sql": "SELECT id, canonical_name, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g FROM public.food_nutrition_library WHERE is_active = TRUE ORDER BY id",
            "query": "audit_nutrition_quality_deepseek.py --review-mode all --model deepseek-v4-pro",
            "description": "对全部有效营养记录执行确定性规则扫描和逐条模型复核；模型建议不直接写库。",
            "executed_at": "2026-07-14T04:10:00+08:00",
            "language": "python",
            "filters": ["13,641条逐条审核", "模型动作仅作为候选", "硬物理规则单独事务修复"],
            "metric_definitions": ["硬物理错误包括每100g宏量总和超过105g、包装份量超过净含量等可证明冲突"],
        },
    }
    sources = [db_source, vision_source, nutrition_source]

    artifact = {
        "surface": "report",
        "manifest": {
            "version": 1,
            "surface": "report",
            "title": "食物数据库份量与原图证据全量审计",
            "description": "2026-07-14 生产数据快照：营养主库、包装份量与原图一致性",
            "generatedAt": now,
            "sources": sources,
            "cards": [
                {"id": "nutrition_rows", "description": "DeepSeek V4 Pro 逐条审核的有效营养记录", "dataset": "headline", "sourceId": "nutrition_deepseek_audit", "metrics": [{"label": "营养记录全量审核", "field": "nutrition_rows", "format": "number"}]},
                {"id": "packaged_rows", "description": "is_active=true 的全部包装食品", "dataset": "headline", "sourceId": "packaged_db_audit", "metrics": [{"label": "包装食品审计", "field": "packaged_rows", "format": "number"}]},
                {"id": "evidence_backed", "description": "当前整包或较小份量有直接证据", "dataset": "headline", "sourceId": "packaged_db_audit", "metrics": [{"label": "份量有证据", "field": "evidence_backed_servings", "format": "number"}, {"label": "占全部包装食品", "field": "evidence_backed_share", "format": "percent"}]},
                {"id": "image_mismatch", "description": "283条双模型完成项中的一致错配候选", "dataset": "headline", "sourceId": "packaged_vision_audit", "metrics": [{"label": "双模型一致错图", "field": "consensus_image_mismatches", "format": "number"}, {"label": "双模型完成", "field": "double_reviewed_images", "format": "number"}]},
                {"id": "quarantined", "description": "人工查看原图后从线上搜索隔离，未删除", "dataset": "headline", "sourceId": "packaged_db_audit", "metrics": [{"label": "已人工隔离", "field": "manually_quarantined", "format": "number"}]},
            ],
            "charts": [
                {
                    "id": "serving_quality_chart",
                    "title": "包装食品份量证据分类",
                    "subtitle": "313条有效包装食品；2026-07-14 修复后快照",
                    "type": "bar",
                    "dataset": "serving_classes",
                    "sourceId": "packaged_db_audit",
                    "question": "当前包装食品份量中，有多少可由包装证据直接支持？",
                    "rationale": "四个互斥类别适合用横向条形图比较绝对数量，长中文标签保持可读。",
                    "encodings": {
                        "x": {"field": "category", "type": "nominal", "label": "证据分类"},
                        "y": {"field": "count", "type": "quantitative", "label": "记录数", "format": "number"},
                        "tooltip": [
                            {"field": "count", "type": "quantitative", "label": "记录数", "format": "number"},
                            {"field": "share", "type": "quantitative", "label": "占比", "format": "percent"},
                            {"field": "definition", "type": "text", "label": "定义"},
                        ],
                    },
                    "xAxisTitle": "证据分类",
                    "yAxisTitle": "记录数",
                    "valueFormat": "number",
                    "layout": "full",
                    "maxRows": 4,
                }
            ],
            "tables": [
                {
                    "id": "serving_review_table",
                    "title": "较小份量缺少来源证据",
                    "subtitle": "28条修复后仍需补原图背面或规格证据的记录",
                    "dataset": "serving_review",
                    "sourceId": "packaged_db_audit",
                    "defaultSort": {"field": "container_weight_g", "direction": "desc"},
                    "density": "dense",
                    "layout": "full",
                    "columns": [
                        {"field": "display_name", "label": "商品", "type": "text"},
                        {"field": "container_weight_g", "label": "整包g/ml", "format": "number"},
                        {"field": "serving_weight_g", "label": "当前份量g/ml", "format": "number"},
                        {"field": "review_status", "label": "审核状态", "type": "text"},
                        {"field": "issue", "label": "问题", "type": "text"},
                    ],
                },
                {
                    "id": "image_mismatch_table",
                    "title": "双模型一致的原图错配候选",
                    "subtitle": "30条一致候选；只有人工查看确认的5条已隔离",
                    "dataset": "image_mismatches",
                    "sourceId": "packaged_vision_audit",
                    "defaultSort": {"field": "display_name", "direction": "asc"},
                    "density": "dense",
                    "layout": "full",
                    "columns": [
                        {"field": "display_name", "label": "数据库商品", "type": "text"},
                        {"field": "review_status", "label": "审核状态", "type": "text"},
                        {"field": "model_1_reason", "label": "模型1证据", "type": "text"},
                        {"field": "model_2_reason", "label": "模型2证据", "type": "text"},
                    ],
                },
            ],
            "blocks": [
                {"id": "title", "type": "markdown", "body": "# 食物数据库份量与原图证据全量审计", "layout": "full"},
                {"id": "summary", "type": "markdown", "body": "## 技术结论\n\n这不是茶叶蛋和百奇两个孤立案例，而是**份量字段把包装证据、模型建议份量和默认展示份量混在一起**造成的一类系统性问题。修复后，百奇线上已经显示 **504 kcal/100g、整包50g、252 kcal**；本地代码也已改为较小份量必须有每份口径、OCR、规格拆分或单位字段证据，否则回退整包。\n\n全量检查覆盖13,641条营养记录和313条有效包装食品。营养主库硬物理错误修复后为0；包装库仍有28条较小份量缺少来源证据、42条未填写份量。原图第一模型313/313完成，第二模型283/313完成，30条得到双模型一致错配判定；其中5条经人工查看后已隔离，未删除。", "layout": "full"},
                {"id": "metrics", "type": "metric-strip", "cardIds": ["nutrition_rows", "packaged_rows", "evidence_backed", "image_mismatch", "quarantined"], "layout": "full"},
                {"id": "finding_serving", "type": "markdown", "body": "## 份量问题已经按“证据”而不是“是否小于整包”重判\n\n修复后243/313条包装食品份量有直接证据；28条较小份量缺证据，不能继续把25g、30g等常见建议量当作包装事实；42条缺少份量，展示应回退净含量。下图是互斥分类，表格给出仍需补证据的精确清单。", "sourceId": "packaged_db_audit", "layout": "full"},
                {"id": "serving_chart", "type": "chart", "chartId": "serving_quality_chart", "layout": "full"},
                {"id": "serving_table", "type": "table", "tableId": "serving_review_table", "layout": "full"},
                {"id": "finding_images", "type": "markdown", "body": "## 原图错配是第二个独立问题，不能靠改份量掩盖\n\n双模型在283条共同完成记录中对30条一致判为商品、口味或净含量错配。该结果是高优先级候选，不等于30条均已确认；本轮只对我实际查看原图后能逐字举证的5条设置 needs_review，从线上搜索隔离，其余保留在复核表。", "sourceId": "packaged_vision_audit", "layout": "full"},
                {"id": "image_table", "type": "table", "tableId": "image_mismatch_table", "layout": "full"},
                {"id": "scope", "type": "markdown", "body": "## 范围与指标定义\n\n审计快照为2026年7月14日。包装食品总体口径是 `is_active=true` 的313条记录；其中 `review_status=active` 的300条是线上常规搜索候选。整包量优先取 `net_weight_g`，缺失时使用克或毫升口径的净含量。\n\n“份量有证据”要求 serving 与整包一致，或较小份量能够从每份营养口径、OCR原文、`数量×重量`规格、单位含量字段直接印证；字段置信度和模型输出本身不算独立证据。", "sourceId": "packaged_db_audit", "layout": "full"},
                {"id": "method", "type": "markdown", "body": "## 方法把规则、视觉模型和人工写库分成三层\n\n第一层对全部营养和包装记录做确定性物理/口径检查；第二层让两个视觉模型独立读取原图，提示词明确禁止常识补全；第三层只把可逐字举证且人工确认的项目写库。DeepSeek 对营养主库的 fix/deactivate 建议只作为候选，因为复核中出现过把脆皮烤鸭、速溶咖啡粉误判的反例。\n\n图表选择横向条形图，是因为四个类别互斥且目标是比较绝对数量；详细异常以表格交付，便于逐条审核。", "layout": "full"},
                {"id": "limitations", "type": "markdown", "body": "## 仍需注意的限制和稳健性边界\n\n第二视觉模型有30条未成功完成，因此双模型共识只覆盖283条；第一模型仍覆盖313条。只有正面图时，“图上没看到每份”不能证明包装背面一定没有，该类只标为缺证据而不删除。不同地区、年份和口味包装可能共享商品名，规格冲突优先隔离而不是猜一个新值。", "layout": "full"},
                {"id": "next", "type": "markdown", "body": "## 建议的后续动作\n\n1. 部署本轮后端证据门禁，使未来新写入和所有线上搜索都使用同一规则。\n2. 按表补拍28条较小份量记录的营养表/规格面；没有证据的保持整包默认。\n3. 人工复核剩余25条双模型一致错图候选，确认后替换原图或继续隔离。\n4. 数据模型长期应拆分 `label_serving_weight`（包装明示）与 `recommended_portion_weight`（产品建议），禁止再共用一个 serving 字段。", "layout": "full"},
                {"id": "questions", "type": "markdown", "body": "## 需要产品侧最终确认的问题\n\n用户搜索包装食品时，默认数量究竟应是“整包/独立小包装”还是“推荐食用量”？如果两者都需要，前端必须显式标注来源，且数据库应使用两个字段；否则即使热量缩放数学正确，用户仍会质疑25g从何而来。", "layout": "full"},
            ],
        },
        "snapshot": {
            "version": 1,
            "generatedAt": now,
            "status": "ready",
            "datasets": {
                "headline": headline,
                "serving_classes": class_rows,
                "serving_review": needs_review,
                "image_mismatches": consensus_mismatch,
            },
            "accessIssues": [],
        },
        "sources": sources,
    }
    output = ROOT / "report-artifact.json"
    output.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"artifact": str(output), "serving_review_rows": len(needs_review), "consensus_mismatch_rows": len(consensus_mismatch), "pair_counts": {str(key): value for key, value in pair_counts.items()}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
