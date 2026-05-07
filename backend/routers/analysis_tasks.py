from __future__ import annotations

import asyncio
import os
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import (
    count_analysis_tasks_by_user_sync,
    get_analysis_task_by_id_sync,
    list_analysis_tasks_by_user_sync,
    update_analysis_task_result,
)
from middleware import get_current_user_info


class UpdateAnalysisResultRequest(BaseModel):
    """更新分析结果请求（用于修正食物名称等）"""
    result: Dict[str, Any] = Field(..., description="新的分析结果 JSON（完整覆盖）")


def create_analysis_tasks_router(
    *,
    biz_tracer: Any,
    trace_add_event: Callable[[str, Dict[str, Any]], None],
    trace_record_error: Callable[..., None],
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/analyze/tasks")
    async def list_analyze_tasks(
        task_type: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        user_info: dict = Depends(get_current_user_info),
    ):
        """查询当前用户的识别任务列表，支持按 task_type, status 筛选。"""
        try:
            tasks = await asyncio.to_thread(
                list_analysis_tasks_by_user_sync,
                user_id=user_info["user_id"],
                task_type=task_type,
                status=status,
                limit=limit,
            )
            return {"tasks": tasks}
        except Exception as e:
            print(f"[analyze/tasks] 错误: {e}")
            raise HTTPException(status_code=500, detail="查询任务列表失败")

    @router.get("/api/analyze/tasks/count")
    async def get_analyze_tasks_count(
        user_info: dict = Depends(get_current_user_info),
    ):
        """获取当前用户的食物分析任务数量"""
        try:
            count = await asyncio.to_thread(
                count_analysis_tasks_by_user_sync,
                user_id=user_info["user_id"],
            )
            return {"count": count}
        except Exception as e:
            print(f"[analyze/tasks/count] 错误: {e}")
            raise HTTPException(status_code=500, detail="获取任务数量失败")

    @router.get("/api/analyze/tasks/status-count")
    async def get_analyze_tasks_status_count(
        user_info: dict = Depends(get_current_user_info),
    ):
        """获取当前用户识别任务的三种业务状态数量：recognizing / waiting_record / recorded。"""
        from database import count_analysis_tasks_by_status_sync

        try:
            result = await asyncio.to_thread(
                count_analysis_tasks_by_status_sync,
                user_id=user_info["user_id"],
            )
            return result
        except Exception as e:
            print(f"[analyze/tasks/status-count] 错误: {e}")
            raise HTTPException(status_code=500, detail="获取任务状态数量失败")

    @router.post("/api/user/last-seen-analyze-history")
    async def mark_analyze_history_seen(
        user_info: dict = Depends(get_current_user_info),
    ):
        """标记用户已查看识别记录列表，更新 last_seen_analyze_history_at 为当前时间。"""
        from database import update_user_last_seen_analyze_history_sync

        try:
            ok = await asyncio.to_thread(
                update_user_last_seen_analyze_history_sync,
                user_id=user_info["user_id"],
            )
            return {"success": ok}
        except Exception as e:
            print(f"[user/last-seen-analyze-history] 错误: {e}")
            raise HTTPException(status_code=500, detail="标记查看状态失败")

    @router.get("/api/analyze/tasks/{task_id}")
    async def get_analyze_task(
        task_id: str,
        user_info: dict = Depends(get_current_user_info),
    ):
        """查询单条任务详情（仅能查看本人任务）。"""
        with biz_tracer.start_as_current_span("biz.get_analyze_task"):
            trace_add_event("biz.task_detail.requested", {"biz.task_id": task_id, "biz.user_id": user_info["user_id"]})
            try:
                task = await asyncio.to_thread(get_analysis_task_by_id_sync, task_id)
                if not task:
                    trace_add_event("biz.task_detail.not_found", {"biz.task_id": task_id})
                    raise HTTPException(status_code=404, detail="任务不存在")
                if task.get("user_id") != user_info["user_id"]:
                    trace_add_event("biz.task_detail.forbidden", {"biz.task_id": task_id})
                    raise HTTPException(status_code=403, detail="无权查看该任务")
                trace_add_event("biz.task_detail.success", {"biz.task_id": task_id, "biz.status": task.get("status") or ""})
                return task
            except HTTPException:
                raise
            except Exception as e:
                trace_record_error("get_analyze_task", e, **{"biz.task_id": task_id})
                raise HTTPException(status_code=500, detail="查询任务详情失败")

    @router.patch("/api/analyze/tasks/{task_id}/result")
    async def update_task_result(
        task_id: str,
        body: UpdateAnalysisResultRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """
        更新指定分析任务的 result 字段。
        主要用于用户在结果页手动修改食物名称后，同步更新后端记录（task.result）。
        """
        try:
            task = await asyncio.to_thread(get_analysis_task_by_id_sync, task_id)
            if not task:
                raise HTTPException(status_code=404, detail="任务不存在")
            if task["user_id"] != user_info["user_id"]:
                raise HTTPException(status_code=403, detail="无权操作此任务")

            updated = await update_analysis_task_result(task_id, body.result)
            return {
                "message": "更新成功",
                "task": {
                    **updated,
                    "created_at": updated["created_at"].replace("+00:00", "Z"),
                    "updated_at": updated["updated_at"].replace("+00:00", "Z"),
                },
            }
        except HTTPException:
            raise
        except Exception as e:
            print(f"[update_task_result] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/analyze/tasks/{task_id}")
    async def delete_analyze_task(
        task_id: str,
        user_info: dict = Depends(get_current_user_info),
    ):
        """
        删除指定的分析任务。
        支持删除任何状态的任务，包括进行中的任务(pending/processing)。
        对于进行中的任务，会先标记为 cancelled 状态，清理关联资源后删除。
        """
        from database import delete_analysis_task_sync

        try:
            result = await asyncio.to_thread(delete_analysis_task_sync, task_id, user_info["user_id"], cancel_processing=True)
            return {
                "message": result.get("message", "删除成功"),
                "deleted": result.get("deleted", True),
                "cancelled": result.get("cancelled", False),
                "images_deleted": result.get("images_deleted", 0),
            }
        except Exception as e:
            error_msg = str(e)
            if "任务不存在" in error_msg or "无权限" in error_msg:
                raise HTTPException(status_code=404, detail=error_msg)
            print(f"[delete_analyze_task] 错误: {e}")
            raise HTTPException(status_code=500, detail=f"删除失败: {error_msg}")

    @router.post("/api/analyze/tasks/cleanup-timeout")
    async def cleanup_timed_out_tasks(
        admin_key: str = Query(..., description="管理密钥"),
        timeout_minutes: int = Query(default=5, ge=1, le=30, description="超时时间（分钟）"),
    ):
        """清理超时的分析任务（内部管理接口）。"""
        from database import mark_timed_out_tasks_sync

        expected_key = os.getenv("ADMIN_API_KEY", "")
        if not expected_key or admin_key != expected_key:
            raise HTTPException(status_code=403, detail="无权限")

        try:
            count = await asyncio.to_thread(mark_timed_out_tasks_sync, timeout_minutes)
            return {"message": f"已标记 {count} 个超时任务", "count": count}
        except Exception as e:
            print(f"[cleanup_timed_out_tasks] 错误: {e}")
            raise HTTPException(status_code=500, detail="清理失败")

    return router
