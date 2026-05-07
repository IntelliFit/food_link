from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import (
    get_exercise_calories_by_date,
    get_user_by_id,
    list_food_expiry_items_v2,
    list_food_records,
    update_user,
)
from middleware import get_current_user_info

DASHBOARD_DEFAULT_MACRO_TARGETS = {"protein": 120.0, "carbs": 250.0, "fat": 65.0}
SNACK_TARGET_TAG = "加餐参考，不计入总目标"


class DashboardTargetsUpdateRequest(BaseModel):
    """首页仪表盘目标热量与三大营养素（与 PUT /api/user/dashboard-targets 共用结构）"""
    calorie_target: float = Field(..., ge=500, le=6000, description="每日目标热量 kcal")
    protein_target: float = Field(..., ge=0, le=500, description="蛋白质目标 g")
    carbs_target: float = Field(..., ge=0, le=1000, description="碳水目标 g")
    fat_target: float = Field(..., ge=0, le=300, description="脂肪目标 g")


def _get_dashboard_targets(user: Dict[str, Any]) -> Dict[str, float]:
    """从用户健康档案 JSON 中读取首页目标值，缺失时回退到默认值。"""
    health_condition = user.get("health_condition") or {}
    dashboard_targets = health_condition.get("dashboard_targets") or {}

    calorie_target = dashboard_targets.get("calorie_target")
    if calorie_target is None:
        calorie_target = (user.get("tdee") and float(user["tdee"])) or 2000

    return {
        "calorie_target": round(float(calorie_target or 2000), 1),
        "protein_target": round(float(dashboard_targets.get("protein_target") or DASHBOARD_DEFAULT_MACRO_TARGETS["protein"]), 1),
        "carbs_target": round(float(dashboard_targets.get("carbs_target") or DASHBOARD_DEFAULT_MACRO_TARGETS["carbs"]), 1),
        "fat_target": round(float(dashboard_targets.get("fat_target") or DASHBOARD_DEFAULT_MACRO_TARGETS["fat"]), 1),
    }


def create_dashboard_router(
    *,
    china_tz: Any,
    meal_display_order: Tuple[str, ...],
    meal_names: Dict[str, str],
    get_china_today_str: Callable[[], str],
    normalize_meal_type: Callable[..., str],
    build_dashboard_meal_targets: Callable[[float], Dict[str, float]],
    format_china_time_hhmm: Callable[[Any], str],
    normalize_food_expiry_item: Callable[..., Dict[str, Any]],
    build_food_expiry_summary: Callable[[List[Dict[str, Any]]], Dict[str, Any]],
    parse_date_string: Callable[[Optional[str], str], Optional[str]],
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/user/dashboard-targets")
    async def get_dashboard_targets(user_info: dict = Depends(get_current_user_info)):
        """获取当前用户首页仪表盘目标值。"""
        user_id = user_info["user_id"]
        user = await get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        return _get_dashboard_targets(user)

    @router.put("/api/user/dashboard-targets")
    async def update_dashboard_targets(
        body: DashboardTargetsUpdateRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """更新当前用户首页仪表盘目标值，持久化到 health_condition.dashboard_targets。"""
        user_id = user_info["user_id"]
        user = await get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")

        health_condition = dict(user.get("health_condition") or {})
        health_condition["dashboard_targets"] = {
            "calorie_target": round(float(body.calorie_target), 1),
            "protein_target": round(float(body.protein_target), 1),
            "carbs_target": round(float(body.carbs_target), 1),
            "fat_target": round(float(body.fat_target), 1),
        }

        try:
            updated = await update_user(user_id, {"health_condition": health_condition})
            return _get_dashboard_targets(updated)
        except Exception as e:
            print(f"[update_dashboard_targets] 错误: {e}")
            raise HTTPException(status_code=500, detail="更新首页目标失败")

    @router.get("/api/home/dashboard")
    async def get_home_dashboard(
        date: Optional[str] = None,
        user_info: dict = Depends(get_current_user_info),
    ):
        """
        首页数据：指定日期摄入汇总 + 各餐次汇总 + 当日运动消耗（千卡）。目标热量优先用用户 TDEE，否则 2000。

        参数:
            date: 指定日期 (YYYY-MM-DD 格式)，不传则默认今天
        """
        user_id = user_info["user_id"]
        target_date = date if date else get_china_today_str()

        print(f"[DEBUG /api/home/dashboard] user_id={user_id}, date={date}")

        try:
            user = await get_user_by_id(user_id)
            print(f"[DEBUG /api/home/dashboard] user={user.get('nickname') if user else 'None'}")
            targets = _get_dashboard_targets(user)
            calorie_target = float(targets["calorie_target"])
            records = await list_food_records(user_id=user_id, date=target_date, limit=100)
            print(f"[DEBUG /api/home/dashboard] records count={len(records)}")
            expiry_rows = await list_food_expiry_items_v2(user_id=user_id, status="active")
            today_local = datetime.now(china_tz)
            expiry_items = [normalize_food_expiry_item(row, today_local=today_local) for row in expiry_rows]
        except Exception as e:
            print(f"[get_home_dashboard] 错误: {e}")
            raise HTTPException(status_code=500, detail="获取首页数据失败")

        total_cal = sum(float(r.get("total_calories") or 0) for r in records)
        total_protein = sum(float(r.get("total_protein") or 0) for r in records)
        total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
        total_fat = sum(float(r.get("total_fat") or 0) for r in records)

        print(f"[DEBUG /api/home/dashboard] 计算结果: cal={total_cal}, protein={total_protein}, carbs={total_carbs}, fat={total_fat}")

        protein_target = targets["protein_target"]
        carbs_target = targets["carbs_target"]
        fat_target = targets["fat_target"]
        progress = (total_cal / calorie_target * 100) if calorie_target else 0
        progress = min(100.0, round(progress, 1))

        intake_data = {
            "current": round(total_cal, 1),
            "target": round(calorie_target, 1),
            "progress": progress,
            "macros": {
                "protein": {"current": round(total_protein, 1), "target": protein_target},
                "carbs": {"current": round(total_carbs, 1), "target": carbs_target},
                "fat": {"current": round(total_fat, 1), "target": fat_target},
            },
        }

        by_meal: Dict[str, List[dict]] = {}
        for r in records:
            mt = normalize_meal_type(r.get("meal_type"), record_time=r.get("record_time"))
            if mt not in by_meal:
                by_meal[mt] = []
            by_meal[mt].append(r)

        meal_targets = build_dashboard_meal_targets(calorie_target)
        meals_out = []
        for meal_type in meal_display_order:
            if meal_type not in by_meal:
                continue
            items = by_meal[meal_type]
            meal_cal = sum(float(x.get("total_calories") or 0) for x in items)
            meal_protein = sum(float(x.get("total_protein") or 0) for x in items)
            meal_carbs = sum(float(x.get("total_carbs") or 0) for x in items)
            meal_fat = sum(float(x.get("total_fat") or 0) for x in items)
            meal_target = meal_targets.get(meal_type, 0.0)
            meal_progress = (meal_cal / meal_target * 100) if meal_target else 0
            meal_progress = round(meal_progress, 1)
            meal_image_urls: List[str] = []
            seen_image_urls = set()
            for record in items:
                record_image_urls = record.get("image_paths") or []
                if not isinstance(record_image_urls, list):
                    record_image_urls = []
                if not record_image_urls and record.get("image_path"):
                    record_image_urls = [record.get("image_path")]
                for image_url in record_image_urls:
                    if not isinstance(image_url, str):
                        continue
                    image_url = image_url.strip()
                    if not image_url or image_url in seen_image_urls:
                        continue
                    seen_image_urls.add(image_url)
                    meal_image_urls.append(image_url)

            times = [x.get("record_time") for x in items if x.get("record_time")]
            time_str = "00:00"
            if times:
                time_str = format_china_time_hhmm(times[0])

            primary_record_id = None
            if items:
                for rec in items:
                    rid = rec.get("id")
                    if rid is not None and str(rid).strip() != "":
                        primary_record_id = str(rid)
                        break

            meal_record_entries = []
            for rec in items:
                rid = rec.get("id")
                if rid is None or str(rid).strip() == "":
                    continue
                record_title = ""
                record_items = rec.get("items")
                if isinstance(record_items, list) and len(record_items) > 0:
                    first_name = (record_items[0].get("name") or "").strip() if isinstance(record_items[0], dict) else ""
                    if first_name:
                        record_title = first_name
                if not record_title:
                    desc = (rec.get("description") or "").strip()
                    if desc:
                        first_line = desc.split("\n")[0].strip()
                        if len(first_line) > 30:
                            first_line = first_line[:30] + "…"
                        record_title = first_line
                record_image_urls: List[str] = []
                rec_image_paths = rec.get("image_paths") or []
                if not isinstance(rec_image_paths, list):
                    rec_image_paths = []
                if not rec_image_paths and rec.get("image_path"):
                    rec_image_paths = [rec.get("image_path")]
                for img_url in rec_image_paths:
                    if isinstance(img_url, str) and img_url.strip():
                        record_image_urls.append(img_url.strip())
                meal_record_entries.append({
                    "id": str(rid),
                    "record_time": rec.get("record_time"),
                    "total_calories": float(rec.get("total_calories") or 0),
                    "title": record_title,
                    "image_path": record_image_urls[0] if record_image_urls else None,
                    "image_paths": record_image_urls if record_image_urls else None,
                    "full_record": rec,
                })

            meals_out.append({
                "type": meal_type,
                "name": meal_names.get(meal_type, meal_type),
                "time": time_str,
                "calorie": round(meal_cal, 1),
                "protein": round(meal_protein, 1),
                "carbs": round(meal_carbs, 1),
                "fat": round(meal_fat, 1),
                "target": meal_target,
                "progress": meal_progress,
                "tags": [SNACK_TARGET_TAG] if "snack" in meal_type else [],
                "image_path": meal_image_urls[0] if meal_image_urls else None,
                "image_paths": meal_image_urls,
                "primary_record_id": primary_record_id,
                "description": "、".join([e["title"] for e in meal_record_entries if e["title"]]) or None,
                "meal_record_entries": meal_record_entries,
            })

        exercise_burned = await get_exercise_calories_by_date(user_id, target_date)

        return {
            "intakeData": intake_data,
            "meals": meals_out,
            "expirySummary": build_food_expiry_summary(expiry_items),
            "exerciseBurnedKcal": round(float(exercise_burned), 1),
        }

    @router.get("/api/exercise-calories/daily")
    async def get_exercise_calories_daily(
        date: Optional[str] = Query(None, description="YYYY-MM-DD，不传则默认中国时区当天"),
        user_info: dict = Depends(get_current_user_info),
    ):
        """
        单日运动消耗汇总（千卡），数据来自 `user_exercise_logs`（与 migrate_exercise_logs_and_task_type.sql）。
        与 GET /api/home/dashboard 的 `exerciseBurnedKcal` 同源，便于单独调试或客户端兜底拉取。
        """
        user_id = user_info["user_id"]
        target_date = parse_date_string(date, "date") if date else None
        if not target_date:
            target_date = datetime.now(china_tz).date().isoformat()
        total = await get_exercise_calories_by_date(user_id, target_date)
        return {"date": target_date, "total_calories_burned": int(total)}

    return router
