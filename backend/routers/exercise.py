from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, Form, HTTPException, Query
from pydantic import BaseModel, Field

from database import (
    create_analysis_task_sync,
    delete_user_exercise_log,
    exercise_fallback_task_type,
    get_user_by_id,
    list_user_exercise_logs,
)
from exercise_llm import ExerciseLlmError, estimate_exercise_calories_sync
from middleware import get_current_user_info


class ExerciseCaloriesEstimateRequest(BaseModel):
    exercise_desc: str = Field(..., min_length=1, max_length=200, description="运动描述，如'慢跑5公里'")


class ExerciseLogResponse(BaseModel):
    id: str
    exercise_desc: str
    calories_burned: int
    recorded_on: str
    recorded_at: str
    ai_reasoning: Optional[str] = None


async def _estimate_exercise_calories_llm(
    exercise_desc: str,
    profile_snapshot: Optional[Dict[str, Any]] = None,
) -> Tuple[int, Optional[str], str]:
    """将运动描述交给大模型估算千卡（与 Worker 共用 exercise_llm 实现）。"""
    try:
        return await asyncio.to_thread(estimate_exercise_calories_sync, exercise_desc, profile_snapshot)
    except ExerciseLlmError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


def create_exercise_router(
    *,
    china_tz,
    parse_date_string: Callable[[Optional[str], str], Optional[str]],
    resolve_recorded_on_date: Callable[[Optional[str], str], str],
    get_effective_membership: Callable[[str], Awaitable[Optional[Dict[str, Any]]]],
    format_membership_response: Callable[[Optional[Dict[str, Any]]], Any],
    raise_if_exercise_credits_insufficient: Callable[..., Awaitable[Dict[str, Any]]],
    build_exercise_profile_snapshot: Callable[[str], Awaitable[Dict[str, Any]]],
    should_use_exercise_debug_queue: Callable[[], bool],
    consume_earned_credits_after_success: Callable[..., Awaitable[None]],
    credit_cost_per_exercise_log: int,
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/exercise-logs")
    async def get_exercise_logs(
        date: Optional[str] = Query(None, description="指定日期（ISO格式），默认为今天"),
        start_date: Optional[str] = Query(None, description="开始日期范围"),
        end_date: Optional[str] = Query(None, description="结束日期范围"),
        user_info: dict = Depends(get_current_user_info),
    ):
        """获取用户的运动记录列表"""
        user_id = user_info["user_id"]

        try:
            if date:
                target_date = parse_date_string(date, "date") or datetime.now(china_tz).date().isoformat()
                logs = await list_user_exercise_logs(user_id=user_id, start_date=target_date, end_date=target_date)
            elif start_date or end_date:
                logs = await list_user_exercise_logs(
                    user_id=user_id,
                    start_date=start_date if start_date else None,
                    end_date=end_date if end_date else None,
                )
            else:
                today = datetime.now(china_tz).date().isoformat()
                logs = await list_user_exercise_logs(user_id=user_id, start_date=today, end_date=today)

            total_calories = sum(int(log.get("calories_burned") or 0) for log in logs)

            return {
                "logs": logs,
                "total_calories": total_calories,
                "count": len(logs),
            }
        except Exception as e:
            print(f"[get_exercise_logs] 错误: {e}")
            raise HTTPException(status_code=500, detail="获取运动记录失败")

    @router.post("/api/exercise-logs")
    async def create_exercise_log(
        exercise_desc: str = Form("", description="运动描述原文"),
        image_url: Optional[str] = Form(None, description="运动图片 URL，上传后传入"),
        date: Optional[str] = Form(None, description="记录日期 ISO，可选"),
        user_info: dict = Depends(get_current_user_info),
    ):
        """提交运动分析异步任务（与 `POST /api/analyze/submit` 同一套模式）。"""
        user_id = user_info["user_id"]
        desc = (exercise_desc or "").strip()
        img_url = (image_url or "").strip()

        if not desc and not img_url:
            raise HTTPException(status_code=422, detail="运动描述和图片不能同时为空")
        if desc and len(desc) > 200:
            raise HTTPException(status_code=422, detail="运动描述过长")

        recorded_on = resolve_recorded_on_date(date, "date")
        user = await get_user_by_id(user_id)
        membership = await get_effective_membership(user_id)
        membership_resp = format_membership_response(membership)
        credits_info = await raise_if_exercise_credits_insufficient(
            user_id=user_id,
            user_row=user,
            membership=membership,
            membership_resp=membership_resp,
            recorded_on=recorded_on,
        )
        profile_snapshot = await build_exercise_profile_snapshot(user_id)
        task_payload = {
            "recorded_on": recorded_on,
            "credit_usage": dict((credits_info.get("credit_spend_plan") or {})),
        }
        if profile_snapshot:
            task_payload["profile_snapshot"] = profile_snapshot

        if should_use_exercise_debug_queue():
            task = await asyncio.to_thread(
                create_analysis_task_sync,
                user_id=user_id,
                task_type=exercise_fallback_task_type(),
                text_input=desc or None,
                image_url=img_url or None,
                payload={**task_payload, "exercise": True},
            )
            await consume_earned_credits_after_success(
                user_id,
                credits_info,
                cost=credit_cost_per_exercise_log,
                reason="exercise_reward_spend",
                source_key=f"exercise:{task['id']}",
                meta={"task_id": task["id"], "task_type": task.get("task_type")},
            )
            return {
                "task_id": task["id"],
                "message": "运动分析任务已提交，请轮询任务状态直至完成",
            }

        try:
            task = await asyncio.to_thread(
                create_analysis_task_sync,
                user_id=user_id,
                task_type="exercise",
                text_input=desc or None,
                image_url=img_url or None,
                payload=task_payload,
            )
            await consume_earned_credits_after_success(
                user_id,
                credits_info,
                cost=credit_cost_per_exercise_log,
                reason="exercise_reward_spend",
                source_key=f"exercise:{task['id']}",
                meta={"task_id": task["id"], "task_type": task.get("task_type")},
            )
        except Exception as e:
            err_s = str(e)
            if (
                "23514" in err_s
                or "analysis_tasks_task_type_check" in err_s
                or "violates check constraint" in err_s.lower()
            ):
                try:
                    task = await asyncio.to_thread(
                        create_analysis_task_sync,
                        user_id=user_id,
                        task_type=exercise_fallback_task_type(),
                        text_input=desc or None,
                        image_url=img_url or None,
                        payload={**task_payload, "exercise": True},
                    )
                    await consume_earned_credits_after_success(
                        user_id,
                        credits_info,
                        cost=credit_cost_per_exercise_log,
                        reason="exercise_reward_spend",
                        source_key=f"exercise:{task['id']}",
                        meta={"task_id": task["id"], "task_type": task.get("task_type")},
                    )
                except Exception as e2:
                    print(f"[create_exercise_log] 回退投递仍失败: {e2}")
                    raise HTTPException(
                        status_code=500,
                        detail=f"提交运动分析任务失败: {e2}",
                    )
            else:
                print(f"[create_exercise_log] 错误: {e}")
                raise HTTPException(status_code=500, detail=f"提交运动分析任务失败: {e}")

        return {
            "task_id": task["id"],
            "message": "运动分析任务已提交，请轮询任务状态直至完成",
        }

    @router.delete("/api/exercise-logs/{log_id}")
    async def delete_exercise_log(
        log_id: str,
        user_info: dict = Depends(get_current_user_info),
    ):
        """删除运动记录"""
        user_id = user_info["user_id"]

        try:
            success = await delete_user_exercise_log(user_id=user_id, log_id=log_id)
            if not success:
                raise HTTPException(status_code=404, detail="记录不存在")
            return {"message": "已删除"}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[delete_exercise_log] 错误: {e}")
            raise HTTPException(status_code=500, detail="删除运动记录失败")

    @router.post("/api/exercise-logs/estimate-calories")
    async def estimate_exercise_calories(
        body: ExerciseCaloriesEstimateRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """仅调用大模型估算千卡（不落库），与 Worker 共用 exercise_llm。"""
        try:
            profile_snapshot = await build_exercise_profile_snapshot(user_info["user_id"])
            calories, ai_raw, reasoning = await _estimate_exercise_calories_llm(
                body.exercise_desc,
                profile_snapshot,
            )
            return {
                "estimated_calories": calories,
                "exercise_desc": body.exercise_desc.strip(),
                "ai_response": ai_raw,
                "reasoning": reasoning,
                "profile_snapshot": profile_snapshot,
            }
        except HTTPException:
            raise
        except Exception as e:
            print(f"[estimate_exercise_calories] 错误: {e}")
            raise HTTPException(status_code=500, detail="估算卡路里失败")

    return router
