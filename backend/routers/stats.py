from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from database import (
    get_cached_insight,
    get_latest_cached_insight,
    get_streak_days,
    get_user_by_id,
    list_food_records_by_range,
    upsert_insight_cache,
)
from middleware import get_current_user_info

router = APIRouter()

CHINA_TZ = None
_resolve_stats_range_dates = None
_build_body_metrics_summary = None
_empty_body_metrics_summary = None
_build_by_meal_calories = None
_format_health_profile_for_analysis = None


def create_stats_router(
    *,
    china_tz: Any,
    resolve_stats_range_dates: Callable[..., Any],
    build_body_metrics_summary: Callable[..., Any],
    empty_body_metrics_summary: Callable[..., Any],
    build_by_meal_calories: Callable[..., Any],
    format_health_profile_for_analysis: Callable[..., str],
) -> APIRouter:
    global CHINA_TZ
    global _resolve_stats_range_dates
    global _build_body_metrics_summary
    global _empty_body_metrics_summary
    global _build_by_meal_calories
    global _format_health_profile_for_analysis
    CHINA_TZ = china_tz
    _resolve_stats_range_dates = resolve_stats_range_dates
    _build_body_metrics_summary = build_body_metrics_summary
    _empty_body_metrics_summary = empty_body_metrics_summary
    _build_by_meal_calories = build_by_meal_calories
    _format_health_profile_for_analysis = format_health_profile_for_analysis
    return router


async def _generate_nutrition_insight(
    user: Dict[str, Any],
    range_type: str,
    start_date: str,
    end_date: str,
    tdee: float,
    streak_days: int,
    total_calories: float,
    avg_calories_per_day: float,
    cal_surplus_deficit: float,
    total_protein: float,
    total_carbs: float,
    total_fat: float,
    by_meal: Dict[str, float],
    daily_list: List[Dict[str, Any]],
    macro_percent: Dict[str, float],
    body_metrics: Optional[Dict[str, Any]] = None,
) -> str:
    """
    调用大模型生成个性化营养洞察（200-300 字）。
    使用 DeepSeek V4 Flash。
    """
    range_label = "近一周" if range_type == "week" else "近一月"
    # 优先用身体指标最新体重，否则 fallback 到健康档案体重
    latest_weight_from_metrics = body_metrics.get("latest_weight") if body_metrics else None
    health_summary = _format_health_profile_for_analysis(user, latest_weight=latest_weight_from_metrics) if user else ""
    diet_goal = user.get("diet_goal") or "none"
    diet_goal_label = {"fat_loss": "减脂", "muscle_gain": "增肌", "maintain": "维持体重", "none": "无"}.get(diet_goal, diet_goal)

    stats_str = f"""
统计周期：{range_label}（{start_date} 至 {end_date}）
用户 TDEE：{tdee:.0f} kcal/天
饮食目标：{diet_goal_label}

本期数据：
- 总热量：{total_calories:.0f} kcal
- 日均摄入：{avg_calories_per_day:.0f} kcal
- 日均与 TDEE 差值：{cal_surplus_deficit:+.0f} kcal（正为盈余，负为亏损）
- 连续记录天数：{streak_days} 天
- 餐次分布：早餐 {by_meal.get('breakfast', 0):.0f} kcal、早加餐 {by_meal.get('morning_snack', 0):.0f} kcal、午餐 {by_meal.get('lunch', 0):.0f} kcal、午加餐 {by_meal.get('afternoon_snack', 0):.0f} kcal、晚餐 {by_meal.get('dinner', 0):.0f} kcal、晚加餐 {by_meal.get('evening_snack', 0):.0f} kcal
- 宏量营养素占比：蛋白质 {macro_percent.get('protein', 0):.1f}%、碳水 {macro_percent.get('carbs', 0):.1f}%、脂肪 {macro_percent.get('fat', 0):.1f}%
- 总摄入：蛋白质 {total_protein:.1f}g、碳水 {total_carbs:.1f}g、脂肪 {total_fat:.1f}g
"""
    if daily_list:
        daily_trend = "、".join([f"{d['date'][5:]}({d['calories']:.0f})" for d in daily_list[-5:]])
        stats_str += f"- 每日热量趋势（最近5天）：{daily_trend}\n"

    # 身体指标：最新体重与体重变化趋势
    weight_block = ""
    if body_metrics:
        latest_w = body_metrics.get("latest_weight")
        prev_w = body_metrics.get("previous_weight")
        weight_change = body_metrics.get("weight_change")
        weight_entries = body_metrics.get("weight_entries") or []
        if latest_w is not None:
            weight_block += f"- 本期最新体重：{float(latest_w['value'] if isinstance(latest_w, dict) else latest_w):.1f} kg"
            if weight_change is not None:
                direction = "上升" if weight_change > 0 else "下降" if weight_change < 0 else "持平"
                weight_block += f"（较前一次{direction} {abs(weight_change):.1f} kg）"
            weight_block += "\n"
        if len(weight_entries) >= 3:
            recent_weights = weight_entries[-7:]
            weight_trend_str = " → ".join([f"{w['date'][5:]}({float(w['value']):.1f}kg)" for w in recent_weights])
            weight_block += f"- 近期体重变化趋势：{weight_trend_str}\n"
        if latest_w is not None and user.get("weight") is not None:
            profile_weight = float(user["weight"])
            metrics_weight = float(latest_w["value"] if isinstance(latest_w, dict) else latest_w)
            if abs(profile_weight - metrics_weight) > 1.0:
                weight_block += f"- ⚠️ 健康档案体重（{profile_weight:.1f} kg）与最新记录体重（{metrics_weight:.1f} kg）差异较大，请以最新记录为准\n"
    if weight_block:
        stats_str += "\n身体指标：\n" + weight_block

    prompt = f"""你是一位专业的营养师。请根据以下用户健康档案和饮食统计数据，生成一段 200-300 字的个性化营养洞察。

{health_summary}

{stats_str}

要求：
1. 用温暖、鼓励的语气，结合用户体质和饮食目标
2. 分析本期热量摄入与 TDEE 的关系，给出建议
3. 简要评价宏量营养素比例是否合理
4. 若有连续打卡，给予肯定
5. 如果提供了体重趋势数据，结合体重变化评价饮食计划效果
6. 输出纯中文，不要 JSON 或代码块，直接输出正文
"""
    deepseek_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not deepseek_key:
        return "本期日均摄入与 TDEE 接近，热量控制良好。请继续保持。"

    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
    api_url = f"{base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            api_url,
            headers={
                "Authorization": f"Bearer {deepseek_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "deepseek-v4-flash",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.6,
                "max_tokens": 1024,
            },
        )
        if not response.is_success:
            error_data = response.json() if response.content else {}
            error_msg = error_data.get("error", {}).get("message") or f"DeepSeek API 错误: {response.status_code}"
            raise Exception(error_msg)
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content or not content.strip():
            raise Exception("DeepSeek 返回了空响应")
        return content.strip()


@router.get("/api/stats/summary")
async def get_stats_summary(
    range: str = "week",
    user_info: dict = Depends(get_current_user_info),
):
    """
    数据统计：按周(week)或月(month)汇总摄入、与 TDEE 对比、连续记录天数、饮食结构（按餐次与宏量），并给出简单分析。
    """
    if range not in ("week", "month"):
        range = "week"
    user_id = user_info["user_id"]
    start_date, end_date, now = _resolve_stats_range_dates(range)
    start_d = datetime.strptime(start_date, "%Y-%m-%d").date()
    today = end_date
    print(f"[get_stats_summary] Range: {range}, Start: {start_date}, End: {end_date}, User: {user_id}")
    try:
        user = await get_user_by_id(user_id)
        tdee = (user.get("tdee") and float(user["tdee"])) or 2000
        records = await list_food_records_by_range(user_id=user_id, start_date=start_date, end_date=end_date)
        print(f"[get_stats_summary] Records found: {len(records)}")
        if records:
            print(f"[get_stats_summary] First record time: {records[0].get('record_time')} type: {type(records[0].get('record_time'))}")
        streak_days = await get_streak_days(user_id)
    except Exception as e:
        print(f"[get_stats_summary] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取统计失败")

    try:
        body_metrics_summary = await _build_body_metrics_summary(user_id=user_id, start_date=start_date, end_date=end_date)
        # print(f"[get_stats_summary] body_metrics_summary: {body_metrics_summary}")
    except Exception as body_metrics_error:
        print(f"[get_stats_summary] 身体指标降级为空摘要: {body_metrics_error}")
        body_metrics_summary = _empty_body_metrics_summary(start_date=start_date, end_date=end_date)

    total_cal = sum(float(r.get("total_calories") or 0) for r in records)
    total_protein = sum(float(r.get("total_protein") or 0) for r in records)
    total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
    total_fat = sum(float(r.get("total_fat") or 0) for r in records)
    by_meal_out = _build_by_meal_calories(records)

    daily_cal: Dict[str, float] = {}
    for r in records:
        rt = r.get("record_time")
        if rt:
            try:
                # record_time 存的是 UTC 时间戳，这里转换为中国时区的自然日
                dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                dt_local = dt_utc.astimezone(CHINA_TZ)
                dt_str = dt_local.date().isoformat()
                daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
            except Exception as e:
                print(f"[get_stats_summary] Date parse error for {rt}: {e}")
                pass
    full_daily_list = []
    cursor = start_d
    end_day = now.date()
    while cursor <= end_day:
        date_key = cursor.isoformat()
        full_daily_list.append({"date": date_key, "calories": round(daily_cal.get(date_key, 0.0), 1)})
        cursor += timedelta(days=1)
    daily_list = full_daily_list
    print(f"[get_stats_summary] Daily list: {daily_list}")

    recorded_days = len(daily_cal)
    avg_cal_per_day = round(total_cal / recorded_days, 1) if recorded_days > 0 else 0
    cal_surplus_deficit = round(avg_cal_per_day - tdee, 1)

    total_macros = total_protein * 4 + total_carbs * 4 + total_fat * 9
    if total_macros <= 0:
        pct_p, pct_c, pct_f = 0, 0, 0
    else:
        pct_p = round(total_protein * 4 / total_macros * 100, 1)
        pct_c = round(total_carbs * 4 / total_macros * 100, 1)
        pct_f = round(total_fat * 9 / total_macros * 100, 1)

    # 只读缓存：不在该接口内调用大模型，避免统计接口超时
    data_fingerprint = f"{total_cal:.0f}_{avg_cal_per_day:.1f}_{recorded_days}_{pct_p}_{pct_c}_{pct_f}"
    cached = await get_cached_insight(user_id, range, today)
    if not cached:
        cached = await get_latest_cached_insight(user_id, range)

    analysis_summary = ""
    analysis_summary_generated_date = None
    analysis_summary_needs_refresh = False
    if cached:
        analysis_summary = cached.get("insight_text", "") or ""
        analysis_summary_generated_date = cached.get("generated_date")
        analysis_summary_needs_refresh = (
            cached.get("generated_date") != today
            or cached.get("data_fingerprint") != data_fingerprint
        )

    return {
        "range": range,
        "start_date": start_date,
        "end_date": end_date,
        "tdee": int(tdee),
        "streak_days": streak_days,
        "total_calories": round(total_cal, 1),
        "avg_calories_per_day": avg_cal_per_day,
        "cal_surplus_deficit": cal_surplus_deficit,
        "total_protein": round(total_protein, 1),
        "total_carbs": round(total_carbs, 1),
        "total_fat": round(total_fat, 1),
        "by_meal": by_meal_out,
        "daily_calories": daily_list,
        "macro_percent": {"protein": pct_p, "carbs": pct_c, "fat": pct_f},
        "analysis_summary": analysis_summary,
        "analysis_summary_generated_date": analysis_summary_generated_date,
        "analysis_summary_needs_refresh": analysis_summary_needs_refresh,
        "body_metrics": body_metrics_summary,
    }


class StatsInsightGenerateRequest(BaseModel):
    range: str = Field(default="week", description="统计范围: week 或 month")


class StatsInsightSaveRequest(BaseModel):
    range: str = Field(default="week", description="统计范围: week 或 month")
    analysis_summary: str = Field(..., description="完整的 AI 营养洞察文本")


@router.post("/api/stats/insight/generate")
async def generate_stats_insight(
    body: StatsInsightGenerateRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    生成当前周期的 AI 营养洞察（只调用大模型，不落库）。
    前端拿到完整文本后，本地打字展示，再调用 save 接口保存。
    """
    stats_range = body.range if body.range in ("week", "month") else "week"
    user_id = user_info["user_id"]
    now = datetime.now(CHINA_TZ)
    today = now.strftime("%Y-%m-%d")
    if stats_range == "week":
        start_d = (now - timedelta(days=6)).date()
    else:
        start_d = (now - timedelta(days=29)).date()
    start_date = start_d.strftime("%Y-%m-%d")
    end_date = today

    try:
        user = await get_user_by_id(user_id)
        tdee = (user.get("tdee") and float(user["tdee"])) or 2000
        records = await list_food_records_by_range(user_id=user_id, start_date=start_date, end_date=end_date)
        streak_days = await get_streak_days(user_id)
        # 获取身体指标（体重记录）用于 AI 上下文
        try:
            body_metrics = await _build_body_metrics_summary(user_id=user_id, start_date=start_date, end_date=end_date)
        except Exception as body_err:
            print(f"[generate_stats_insight] 身体指标获取失败，降级: {body_err}")
            body_metrics = None
    except Exception as e:
        print(f"[generate_stats_insight] 准备数据失败: {e}")
        raise HTTPException(status_code=500, detail="生成 AI 洞察失败")

    total_cal = sum(float(r.get("total_calories") or 0) for r in records)
    total_protein = sum(float(r.get("total_protein") or 0) for r in records)
    total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
    total_fat = sum(float(r.get("total_fat") or 0) for r in records)

    by_meal_out = _build_by_meal_calories(records)

    daily_cal: Dict[str, float] = {}
    for r in records:
        rt = r.get("record_time")
        if rt:
            try:
                dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                dt_local = dt_utc.astimezone(CHINA_TZ)
                dt_str = dt_local.date().isoformat()
                daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
            except Exception as e:
                print(f"[generate_stats_insight] Date parse error for {rt}: {e}")
                pass
    daily_list = [{"date": d, "calories": round(c, 1)} for d, c in sorted(daily_cal.items())]

    recorded_days = len(daily_cal)
    avg_cal_per_day = round(total_cal / recorded_days, 1) if recorded_days > 0 else 0
    cal_surplus_deficit = round(avg_cal_per_day - tdee, 1)

    total_macros = total_protein * 4 + total_carbs * 4 + total_fat * 9
    if total_macros <= 0:
        pct_p, pct_c, pct_f = 0, 0, 0
    else:
        pct_p = round(total_protein * 4 / total_macros * 100, 1)
        pct_c = round(total_carbs * 4 / total_macros * 100, 1)
        pct_f = round(total_fat * 9 / total_macros * 100, 1)

    try:
        insight = await _generate_nutrition_insight(
            user=user,
            range_type=stats_range,
            start_date=start_date,
            end_date=end_date,
            tdee=tdee,
            streak_days=streak_days,
            total_calories=total_cal,
            avg_calories_per_day=avg_cal_per_day,
            cal_surplus_deficit=cal_surplus_deficit,
            total_protein=total_protein,
            total_carbs=total_carbs,
            total_fat=total_fat,
            by_meal=by_meal_out,
            daily_list=daily_list,
            macro_percent={"protein": pct_p, "carbs": pct_c, "fat": pct_f},
            body_metrics=body_metrics,
        )
        return {"analysis_summary": insight}
    except Exception as e:
        print(f"[generate_stats_insight] AI 生成失败: {e}")
        raise HTTPException(status_code=500, detail="AI 洞察生成失败，请稍后重试")


@router.post("/api/stats/insight/save")
async def save_stats_insight(
    body: StatsInsightSaveRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    保存前端完整的 AI 洞察文本到缓存表。
    会基于当前数据重新计算指纹，确保与统计数据一致。
    """
    stats_range = body.range if body.range in ("week", "month") else "week"
    text = (body.analysis_summary or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="analysis_summary 不能为空")

    user_id = user_info["user_id"]
    now = datetime.now(CHINA_TZ)
    today = now.strftime("%Y-%m-%d")
    if stats_range == "week":
        start_d = (now - timedelta(days=6)).date()
    else:
        start_d = (now - timedelta(days=29)).date()
    start_date = start_d.strftime("%Y-%m-%d")
    end_date = today

    try:
        records = await list_food_records_by_range(user_id=user_id, start_date=start_date, end_date=end_date)
    except Exception as e:
        print(f"[save_stats_insight] 获取记录失败: {e}")
        raise HTTPException(status_code=500, detail="保存失败")

    total_cal = sum(float(r.get("total_calories") or 0) for r in records)
    total_protein = sum(float(r.get("total_protein") or 0) for r in records)
    total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
    total_fat = sum(float(r.get("total_fat") or 0) for r in records)

    daily_cal: Dict[str, float] = {}
    for r in records:
        rt = r.get("record_time")
        if rt:
            try:
                dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                dt_local = dt_utc.astimezone(CHINA_TZ)
                dt_str = dt_local.date().isoformat()
                daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
            except Exception as e:
                print(f"[save_stats_insight] Date parse error for {rt}: {e}")
                pass

    recorded_days = len(daily_cal)
    avg_cal_per_day = round(total_cal / recorded_days, 1) if recorded_days > 0 else 0

    total_macros = total_protein * 4 + total_carbs * 4 + total_fat * 9
    if total_macros <= 0:
        pct_p, pct_c, pct_f = 0, 0, 0
    else:
        pct_p = round(total_protein * 4 / total_macros * 100, 1)
        pct_c = round(total_carbs * 4 / total_macros * 100, 1)
        pct_f = round(total_fat * 9 / total_macros * 100, 1)

    data_fingerprint = f"{total_cal:.0f}_{avg_cal_per_day:.1f}_{recorded_days}_{pct_p}_{pct_c}_{pct_f}"

    try:
        await upsert_insight_cache(user_id, stats_range, today, data_fingerprint, text)
        return {"message": "ok"}
    except Exception as e:
        print(f"[save_stats_insight] 缓存写入失败: {e}")
        raise HTTPException(status_code=500, detail="保存失败")


async def refresh_stats_insight_for_user(user_id: str) -> None:
    """
    后台刷新指定用户的 AI 营养洞察缓存（周 + 月）。
    在保存记录成功后调用，将耗时从「看统计页」前移到「记完餐」之后。
    为控制成本：同一用户同一 range 每天最多生成一次（按 generated_date=today 判断）。
    """
    now = datetime.now(CHINA_TZ)
    today = now.strftime("%Y-%m-%d")
    try:
        user = await get_user_by_id(user_id)
        if not user:
            return
        tdee = (user.get("tdee") and float(user["tdee"])) or 2000
    except Exception as e:
        print(f"[_refresh_stats_insight_for_user] 获取用户信息失败: {e}")
        return

    for stats_range in ("week", "month"):
        try:
            # 如果今天已经为该范围生成过洞察，则跳过，避免一天多次调用模型
            existing = await get_cached_insight(user_id, stats_range, today)
            if existing:
                continue

            if stats_range == "week":
                start_d = (now - timedelta(days=6)).date()
            else:
                start_d = (now - timedelta(days=29)).date()
            start_date = start_d.strftime("%Y-%m-%d")
            end_date = today

            records = await list_food_records_by_range(
                user_id=user_id,
                start_date=start_date,
                end_date=end_date,
            )
            if not records:
                continue

            total_cal = sum(float(r.get("total_calories") or 0) for r in records)
            total_protein = sum(float(r.get("total_protein") or 0) for r in records)
            total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
            total_fat = sum(float(r.get("total_fat") or 0) for r in records)

            by_meal_out = _build_by_meal_calories(records)

            daily_cal: Dict[str, float] = {}
            for r in records:
                rt = r.get("record_time")
                if rt:
                    try:
                        dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                        dt_local = dt_utc.astimezone(CHINA_TZ)
                        dt_str = dt_local.date().isoformat()
                        daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
                    except Exception as e:
                        print(f"[_refresh_stats_insight_for_user] Date parse error for {rt}: {e}")
                        pass

            recorded_days = len(daily_cal)
            if recorded_days <= 0:
                continue

            avg_cal_per_day = round(total_cal / recorded_days, 1)
            cal_surplus_deficit = round(avg_cal_per_day - tdee, 1)

            total_macros = total_protein * 4 + total_carbs * 4 + total_fat * 9
            if total_macros <= 0:
                pct_p, pct_c, pct_f = 0, 0, 0
            else:
                pct_p = round(total_protein * 4 / total_macros * 100, 1)
                pct_c = round(total_carbs * 4 / total_macros * 100, 1)
                pct_f = round(total_fat * 9 / total_macros * 100, 1)

            # 若 fingerprint 与已有缓存相同，可跳过生成；此处已确认 today 无缓存，直接生成即可
            try:
                # 获取身体指标（体重记录）用于 AI 上下文
                try:
                    bm = await _build_body_metrics_summary(user_id=user_id, start_date=start_date, end_date=end_date)
                except Exception as bm_err:
                    print(f"[_refresh_stats_insight_for_user] 身体指标获取失败，降级: {bm_err}")
                    bm = None
                insight = await _generate_nutrition_insight(
                    user=user,
                    range_type=stats_range,
                    start_date=start_date,
                    end_date=end_date,
                    tdee=tdee,
                    streak_days=await get_streak_days(user_id),
                    total_calories=total_cal,
                    avg_calories_per_day=avg_cal_per_day,
                    cal_surplus_deficit=cal_surplus_deficit,
                    total_protein=total_protein,
                    total_carbs=total_carbs,
                    total_fat=total_fat,
                    by_meal=by_meal_out,
                    daily_list=[{"date": d, "calories": round(c, 1)} for d, c in sorted(daily_cal.items())],
                    macro_percent={"protein": pct_p, "carbs": pct_c, "fat": pct_f},
                    body_metrics=bm,
                )
                data_fingerprint = f"{total_cal:.0f}_{avg_cal_per_day:.1f}_{recorded_days}_{pct_p}_{pct_c}_{pct_f}"
                await upsert_insight_cache(user_id, stats_range, today, data_fingerprint, insight)
            except Exception as e:
                print(f"[_refresh_stats_insight_for_user] 生成 {stats_range} 洞察失败: {e}")
                continue
        except Exception as e:
            print(f"[_refresh_stats_insight_for_user] 处理 {stats_range} 失败: {e}")
            continue


@router.websocket("/ws/stats/insight")
async def ws_stats_insight(websocket: WebSocket):
    """
    WebSocket：实时推送 AI 营养洞察内容（按小段文本流式输出）。

    前端需在 query 参数中传入：
    - range: week | month
    - user_id: 当前用户 ID（前端从本地存储读取）
    """
    await websocket.accept()
    try:
        params = websocket.query_params
        stats_range = params.get("range", "week")
        if stats_range not in ("week", "month"):
            stats_range = "week"
        user_id = params.get("user_id")
        if not user_id:
            await websocket.close(code=1008)
            return

        now = datetime.now(CHINA_TZ)
        today = now.strftime("%Y-%m-%d")
        if stats_range == "week":
            start_d = (now - timedelta(days=6)).date()
        else:
            start_d = (now - timedelta(days=29)).date()
        start_date = start_d.strftime("%Y-%m-%d")
        end_date = today

        # 准备统计数据（与 generate_stats_insight 相同）
        user = await get_user_by_id(user_id)
        tdee = (user.get("tdee") and float(user["tdee"])) or 2000
        records = await list_food_records_by_range(user_id=user_id, start_date=start_date, end_date=end_date)
        streak_days = await get_streak_days(user_id)

        total_cal = sum(float(r.get("total_calories") or 0) for r in records)
        total_protein = sum(float(r.get("total_protein") or 0) for r in records)
        total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
        total_fat = sum(float(r.get("total_fat") or 0) for r in records)

        by_meal_out = _build_by_meal_calories(records)

        daily_cal: Dict[str, float] = {}
        for r in records:
            rt = r.get("record_time")
            if rt:
                try:
                    dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                    dt_local = dt_utc.astimezone(CHINA_TZ)
                    dt_str = dt_local.date().isoformat()
                    daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
                except Exception as e:
                    print(f"[ws_stats_insight] Date parse error for {rt}: {e}")
                    pass
        daily_list = [{"date": d, "calories": round(c, 1)} for d, c in sorted(daily_cal.items())]

        recorded_days = len(daily_cal)
        avg_cal_per_day = round(total_cal / recorded_days, 1) if recorded_days > 0 else 0
        cal_surplus_deficit = round(avg_cal_per_day - tdee, 1)

        total_macros = total_protein * 4 + total_carbs * 4 + total_fat * 9
        if total_macros <= 0:
            pct_p, pct_c, pct_f = 0, 0, 0
        else:
            pct_p = round(total_protein * 4 / total_macros * 100, 1)
            pct_c = round(total_carbs * 4 / total_macros * 100, 1)
            pct_f = round(total_fat * 9 / total_macros * 100, 1)

        # 获取身体指标（体重记录）用于 AI 上下文
        try:
            bm = await _build_body_metrics_summary(user_id=user_id, start_date=start_date, end_date=end_date)
        except Exception as bm_err:
            print(f"[ws_stats_insight] 身体指标获取失败，降级: {bm_err}")
            bm = None

        # 调用大模型生成完整洞察文本
        insight = await _generate_nutrition_insight(
            user=user,
            range_type=stats_range,
            start_date=start_date,
            end_date=end_date,
            tdee=tdee,
            streak_days=streak_days,
            total_calories=total_cal,
            avg_calories_per_day=avg_cal_per_day,
            cal_surplus_deficit=cal_surplus_deficit,
            total_protein=total_protein,
            total_carbs=total_carbs,
            total_fat=total_fat,
            by_meal=by_meal_out,
            daily_list=daily_list,
            macro_percent={"protein": pct_p, "carbs": pct_c, "fat": pct_f},
            body_metrics=bm,
        )

        # 以小块文本流式发给前端（前端负责汇总完整文本并保存）
        chunk_size = 8
        for i in range(0, len(insight), chunk_size):
            await websocket.send_text(insight[i:i + chunk_size])
            await asyncio.sleep(0.04)

        await websocket.close()
    except WebSocketDisconnect:
        print("[ws_stats_insight] 客户端断开连接")
    except Exception as e:
        print(f"[ws_stats_insight] 错误: {e}")
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
