from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import (
    cancel_food_expiry_notification_jobs_by_item,
    create_analysis_task_sync,
    create_food_expiry_item_v2,
    get_food_expiry_item_v2,
    get_user_by_id,
    list_food_expiry_items_v2,
    update_analysis_task_result_sync,
    update_food_expiry_item_v2,
)
from middleware import get_current_user_info


class FoodExpiryItemUpsertRequest(BaseModel):
    food_name: str = Field(..., min_length=1, max_length=50, description="????")
    category: Optional[str] = Field(default=None, max_length=30, description="????")
    storage_type: Optional[str] = Field(default="refrigerated", description="????: room_temp / refrigerated / frozen")
    quantity_note: Optional[str] = Field(default=None, max_length=40, description="????")
    expire_date: str = Field(..., description="???? YYYY-MM-DD")
    opened_date: Optional[str] = Field(default=None, description="???? YYYY-MM-DD")
    note: Optional[str] = Field(default=None, max_length=200, description="????")
    source_type: Optional[str] = Field(default="manual", description="??: manual / ocr / ai")
    status: Optional[str] = Field(default="active", description="??: active / consumed / discarded")


class FoodExpiryRecognitionRequest(BaseModel):
    image_urls: List[str] = Field(..., min_length=1, max_length=5, description="???????? URL ??")
    additional_context: Optional[str] = Field(default=None, max_length=200, description="??????")


class FoodExpiryStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="??: active / consumed / discarded")


class FoodExpirySubscribeRequest(BaseModel):
    subscribe_status: str = Field(..., description="???????????")
    err_msg: Optional[str] = Field(default=None, description="????????")


def create_expiry_router(
    *,
    china_tz,
    normalize_food_expiry_item: Callable[..., Dict[str, Any]],
    normalize_expiry_status: Callable[..., str],
    normalize_expiry_storage_type: Callable[[Optional[str]], str],
    normalize_expiry_source_type: Callable[..., str],
    normalize_subscribe_status: Callable[[Optional[str]], str],
    parse_date_string: Callable[[Optional[str], str], Optional[str]],
    get_effective_membership,
    format_membership_response,
    raise_if_food_analysis_credits_insufficient,
    get_food_task_type: Callable[[str], str],
    recognize_food_expiry_from_images_sync,
    reconcile_food_expiry_notification_job,
    consume_earned_credits_after_success,
    credit_cost_per_food_analysis: int,
    expiry_subscribe_accept_statuses: set[str],
    expiry_notification_template_id: str,
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/expiry/dashboard")
    async def get_food_expiry_dashboard(
        user_info: dict = Depends(get_current_user_info),
    ):
        """我的页保质期提醒摘要。"""
        user_id = user_info["user_id"]
        try:
            raw_items = await list_food_expiry_items_v2(user_id=user_id)
            today_local = datetime.now(china_tz)
            items = [normalize_food_expiry_item(row, today_local=today_local) for row in raw_items]
            active_items = [item for item in items if item["status"] == "active"]
            urgency_rank = {"expired": 0, "today": 1, "soon": 2, "fresh": 3}
            active_items.sort(
                key=lambda item: (
                    urgency_rank.get(item.get("urgency"), 9),
                    item.get("days_until_expire") if item.get("days_until_expire") is not None else 9999,
                    item.get("expire_date") or "9999-12-31",
                )
            )
            expired_count = sum(1 for item in active_items if item.get("urgency") == "expired")
            today_count = sum(1 for item in active_items if item.get("urgency") == "today")
            soon_count = sum(1 for item in active_items if item.get("urgency") == "soon")
            processed_count = sum(1 for item in items if item["status"] != "active")
            return {
                "active_count": len(active_items),
                "expired_count": expired_count,
                "today_count": today_count,
                "soon_count": soon_count,
                "processed_count": processed_count,
                "preview_items": active_items[:3],
            }
        except Exception as e:
            print(f"[get_food_expiry_dashboard] 错误: {e}")
            raise HTTPException(status_code=500, detail="获取保质期摘要失败")


    @router.post("/api/expiry/recognize")
    async def recognize_food_expiry_items(
        body: FoodExpiryRecognitionRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """根据图片识别适合录入保质期的多个食物，并返回表单预填建议。"""
        user_id = user_info["user_id"]
        image_urls: List[str] = []
        for raw_url in body.image_urls:
            url = str(raw_url or "").strip()
            if not url:
                continue
            if url not in image_urls:
                image_urls.append(url)
        if not image_urls:
            raise HTTPException(status_code=400, detail="请至少提供 1 张图片")

        additional_context = str(body.additional_context or "").strip()
        user_row = await get_user_by_id(user_id)
        membership = await get_effective_membership(user_id)
        membership_resp = format_membership_response(membership)
        credits_info = await raise_if_food_analysis_credits_insufficient(
            user_id=user_id,
            user_row=user_row,
            membership=membership,
            membership_resp=membership_resp,
        )

        task = None
        try:
            task = await asyncio.to_thread(
                create_analysis_task_sync,
                user_id=user_id,
                task_type=get_food_task_type("food"),
                image_url=image_urls[0],
                image_urls=image_urls,
                payload={
                    "expiry_recognition": True,
                    "recognize_mode": "food_expiry",
                    "additional_context": additional_context or None,
                },
            )
            await asyncio.to_thread(
                update_analysis_task_result_sync,
                task_id=task["id"],
                status="processing",
            )

            recognized = await asyncio.to_thread(
                recognize_food_expiry_from_images_sync,
                image_urls,
                today_local=datetime.now(china_tz),
                additional_context=additional_context,
            )
            result_payload = {
                "recognize_mode": "food_expiry",
                "items": recognized["items"],
            }
            await asyncio.to_thread(
                update_analysis_task_result_sync,
                task_id=task["id"],
                status="done",
                result=result_payload,
            )
            await consume_earned_credits_after_success(
                user_id,
                credits_info,
                cost=credit_cost_per_food_analysis,
                reason="food_analysis_reward_spend",
                source_key=f"food_analysis:{task['id']}",
                meta={
                    "task_id": task["id"],
                    "task_type": task.get("task_type"),
                    "recognize_mode": "food_expiry",
                },
            )
            return {
                "task_id": task["id"],
                "credits_cost": credit_cost_per_food_analysis,
                "items": recognized["items"],
                "message": f"已识别 {len(recognized['items'])} 项食物，可继续补充后保存",
            }
        except HTTPException:
            raise
        except Exception as e:
            if task and task.get("id"):
                try:
                    await asyncio.to_thread(
                        update_analysis_task_result_sync,
                        task_id=task["id"],
                        status="failed",
                        error_message=str(e)[:300],
                    )
                except Exception:
                    pass
            print(f"[recognize_food_expiry_items] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e) or "保质期识别失败")


    @router.get("/api/expiry/items")
    async def get_food_expiry_items(
        status: Optional[str] = None,
        user_info: dict = Depends(get_current_user_info),
    ):
        """获取当前用户的保质期条目。"""
        user_id = user_info["user_id"]
        try:
            normalized_status = normalize_expiry_status(status) if status else None
            rows = await list_food_expiry_items_v2(user_id=user_id, status=normalized_status)
            today_local = datetime.now(china_tz)
            items = [normalize_food_expiry_item(row, today_local=today_local) for row in rows]
            active_items = [item for item in items if item["status"] == "active"]
            processed_items = [item for item in items if item["status"] != "active"]
            urgency_rank = {"expired": 0, "today": 1, "soon": 2, "fresh": 3}
            active_items.sort(
                key=lambda item: (
                    urgency_rank.get(item.get("urgency"), 9),
                    item.get("days_until_expire") if item.get("days_until_expire") is not None else 9999,
                    item.get("expire_date") or "9999-12-31",
                )
            )
            processed_items.sort(
                key=lambda item: item.get("updated_at") or item.get("created_at") or "",
                reverse=True,
            )
            return {"items": active_items + processed_items}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[get_food_expiry_items] 错误: {e}")
            raise HTTPException(status_code=500, detail="获取保质期列表失败")


    @router.get("/api/expiry/items/{item_id}")
    async def get_food_expiry_item_detail(
        item_id: str,
        user_info: dict = Depends(get_current_user_info),
    ):
        user_id = user_info["user_id"]
        try:
            row = await get_food_expiry_item_v2(user_id=user_id, item_id=item_id)
            if not row:
                raise HTTPException(status_code=404, detail="条目不存在")
            return {"item": normalize_food_expiry_item(row)}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[get_food_expiry_item_detail] 错误: {e}")
            raise HTTPException(status_code=500, detail="获取详情失败")


    @router.post("/api/expiry/items")
    async def create_food_expiry_item_endpoint(
        body: FoodExpiryItemUpsertRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        user_id = user_info["user_id"]
        food_name = body.food_name.strip()
        if not food_name:
            raise HTTPException(status_code=400, detail="food_name 不能为空")

        expire_date = parse_date_string(body.expire_date, "expire_date")
        opened_date = parse_date_string(body.opened_date, "opened_date")
        if opened_date and expire_date and opened_date > expire_date:
            raise HTTPException(status_code=400, detail="opened_date 不能晚于 expire_date")

        payload = {
            "food_name": food_name,
            "category": (body.category or "").strip() or None,
            "storage_type": normalize_expiry_storage_type(body.storage_type),
            "quantity_note": (body.quantity_note or "").strip() or None,
            "expire_date": expire_date,
            "opened_date": opened_date,
            "note": (body.note or "").strip() or None,
            "source_type": normalize_expiry_source_type(body.source_type),
            "status": normalize_expiry_status(body.status),
        }
        try:
            row = await create_food_expiry_item_v2(user_id=user_id, data=payload)
            return {"message": "创建成功", "item": normalize_food_expiry_item(row)}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[create_food_expiry_item_endpoint] 错误: {e}")
            raise HTTPException(status_code=500, detail="创建保质期条目失败")


    @router.put("/api/expiry/items/{item_id}")
    async def update_food_expiry_item_endpoint(
        item_id: str,
        body: FoodExpiryItemUpsertRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        user_id = user_info["user_id"]
        food_name = body.food_name.strip()
        if not food_name:
            raise HTTPException(status_code=400, detail="food_name 不能为空")

        expire_date = parse_date_string(body.expire_date, "expire_date")
        opened_date = parse_date_string(body.opened_date, "opened_date")
        if opened_date and expire_date and opened_date > expire_date:
            raise HTTPException(status_code=400, detail="opened_date 不能晚于 expire_date")

        payload = {
            "food_name": food_name,
            "category": (body.category or "").strip() or None,
            "storage_type": normalize_expiry_storage_type(body.storage_type),
            "quantity_note": (body.quantity_note or "").strip() or None,
            "expire_date": expire_date,
            "opened_date": opened_date,
            "note": (body.note or "").strip() or None,
            "source_type": normalize_expiry_source_type(body.source_type),
            "status": normalize_expiry_status(body.status),
        }
        try:
            row = await update_food_expiry_item_v2(user_id=user_id, item_id=item_id, data=payload)
            if not row:
                raise HTTPException(status_code=404, detail="条目不存在")
            await reconcile_food_expiry_notification_job(
                user_id=user_id,
                openid=user_info["openid"],
                item=normalize_food_expiry_item(row),
                subscribed=True,
                allow_create=False,
            )
            return {"message": "更新成功", "item": normalize_food_expiry_item(row)}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[update_food_expiry_item_endpoint] 错误: {e}")
            raise HTTPException(status_code=500, detail="更新保质期条目失败")


    @router.post("/api/expiry/items/{item_id}/status")
    async def update_food_expiry_item_status_endpoint(
        item_id: str,
        body: FoodExpiryStatusUpdateRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        user_id = user_info["user_id"]
        status = normalize_expiry_status(body.status)
        try:
            row = await update_food_expiry_item_v2(user_id=user_id, item_id=item_id, data={"status": status})
            if not row:
                raise HTTPException(status_code=404, detail="条目不存在")
            await reconcile_food_expiry_notification_job(
                user_id=user_id,
                openid=user_info["openid"],
                item=normalize_food_expiry_item(row),
                subscribed=status == "active",
                allow_create=False,
            )
            return {"message": "状态已更新", "item": normalize_food_expiry_item(row)}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[update_food_expiry_item_status_endpoint] 错误: {e}")
            raise HTTPException(status_code=500, detail="更新状态失败")


    @router.post("/api/expiry/items/{item_id}/subscribe")
    async def subscribe_food_expiry_item_endpoint(
        item_id: str,
        body: FoodExpirySubscribeRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        user_id = user_info["user_id"]
        openid = str(user_info.get("openid") or "").strip()
        if not openid:
            raise HTTPException(status_code=400, detail="当前用户缺少 openid，无法登记提醒")

        subscribe_status = normalize_subscribe_status(body.subscribe_status)
        normalized_status = subscribe_status.lower()
        print(
            f"[subscribe_food_expiry_item_endpoint] user_id={user_id} item_id={item_id} "
            f"subscribe_status={subscribe_status or 'empty'} err_msg={body.err_msg or ''}"
        )

        try:
            row = await get_food_expiry_item_v2(user_id=user_id, item_id=item_id)
            if not row:
                raise HTTPException(status_code=404, detail="条目不存在")

            item = normalize_food_expiry_item(row)
            if item["status"] != "active":
                await cancel_food_expiry_notification_jobs_by_item(item_id)
                return {
                    "subscribed": False,
                    "schedule_created": False,
                    "status": subscribe_status,
                    "scheduled_at": None,
                    "message": "当前条目不是保鲜中状态，未登记提醒",
                }

            if normalized_status not in expiry_subscribe_accept_statuses:
                return {
                    "subscribed": False,
                    "schedule_created": False,
                    "status": subscribe_status,
                    "scheduled_at": None,
                    "message": "用户未接受订阅提醒",
                }

            if not expiry_notification_template_id:
                raise HTTPException(status_code=500, detail="后端未配置保质期提醒模板 ID")

            job = await reconcile_food_expiry_notification_job(
                user_id=user_id,
                openid=openid,
                item=item,
                subscribed=True,
                allow_create=True,
            )
            return {
                "subscribed": True,
                "schedule_created": bool(job),
                "status": subscribe_status,
                "scheduled_at": job.get("scheduled_at") if job else None,
                "message": "提醒任务已登记" if job else "当前不满足提醒条件，未登记任务",
            }
        except HTTPException:
            raise
        except Exception as e:
            print(f"[subscribe_food_expiry_item_endpoint] 错误: {e}")
            raise HTTPException(status_code=500, detail="登记保质期提醒失败")



    return router
