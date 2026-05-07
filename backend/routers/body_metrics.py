from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import (
    create_user_water_log,
    delete_user_water_logs_by_date,
    list_user_water_logs,
    list_user_weight_records,
    upsert_user_body_metric_settings,
    upsert_user_weight_record,
)
from middleware import get_current_user_info


class BodyWeightUpsertRequest(BaseModel):
    value: float = Field(..., ge=20, le=300, description="体重 kg")
    date: Optional[str] = Field(default=None, description="记录日期 YYYY-MM-DD，默认今天")
    client_id: Optional[str] = Field(default=None, max_length=80, description="客户端幂等 ID")
    source_type: Optional[str] = Field(default="manual", description="manual / imported / ai")


class BodyWaterLogRequest(BaseModel):
    amount_ml: int = Field(..., ge=1, le=5000, description="饮水量 ml")
    date: Optional[str] = Field(default=None, description="记录日期 YYYY-MM-DD，默认今天")
    source_type: Optional[str] = Field(default="manual", description="manual / imported / ai")


class BodyWaterResetRequest(BaseModel):
    date: Optional[str] = Field(default=None, description="要清空的日期 YYYY-MM-DD，默认今天")


class BodyMetricsLocalWeightEntry(BaseModel):
    date: str = Field(..., description="日期 YYYY-MM-DD")
    value: float = Field(..., ge=20, le=300, description="体重 kg")
    client_id: Optional[str] = Field(default=None, max_length=80, description="客户端幂等 ID")
    recorded_at: Optional[str] = Field(default=None, description="记录时间 ISO 字符串")


class BodyMetricsLocalWaterDay(BaseModel):
    total: int = Field(default=0, ge=0, le=20000)
    logs: List[int] = Field(default_factory=list, description="当天分次喝水记录 ml")


class BodyMetricsSyncRequest(BaseModel):
    weight_entries: List[BodyMetricsLocalWeightEntry] = Field(default_factory=list)
    water_by_date: Dict[str, BodyMetricsLocalWaterDay] = Field(default_factory=dict)
    water_goal_ml: Optional[int] = Field(default=None, ge=500, le=10000)



def create_body_metrics_router(
    *,
    china_tz,
    resolve_stats_range_dates,
    build_body_metrics_summary,
    empty_body_metrics_summary,
    parse_date_string,
    normalize_body_metric_source_type,
    sync_profile_weight_from_latest,
    normalize_weight_entry,
    parse_datetime,
    build_json_datetime,
    build_legacy_weight_client_id,
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/body-metrics/summary")
    async def get_body_metrics_summary(
        range: str = "month",
        user_info: dict = Depends(get_current_user_info),
    ):
        """获取体重/喝水云端摘要，供首页与统计页复用。"""
        stats_range = range if range in ("week", "month") else "month"
        user_id = user_info["user_id"]
        try:
            start_date, end_date, _ = resolve_stats_range_dates(stats_range)
            try:
                summary = await build_body_metrics_summary(user_id=user_id, start_date=start_date, end_date=end_date)
            except Exception as body_metrics_error:
                print(f"[get_body_metrics_summary] 降级为空摘要: {body_metrics_error}")
                summary = empty_body_metrics_summary(start_date=start_date, end_date=end_date)
            return {
                "range": stats_range,
                "start_date": start_date,
                "end_date": end_date,
                **summary,
            }
        except HTTPException:
            raise
        except Exception as e:
            print(f"[get_body_metrics_summary] 错误: {e}")
            raise HTTPException(status_code=500, detail="获取身体指标摘要失败")


    @router.post("/api/body-metrics/weight")
    async def save_body_weight_record(
        body: BodyWeightUpsertRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """
        保存一次体重测量。成功后自动同步到健康档案体重并重算 BMR / TDEE，
        确保 AI 分析、统计洞察等始终参考最新体重。
        """
        user_id = user_info["user_id"]
        recorded_on = parse_date_string(body.date, "date") or datetime.now(china_tz).date().isoformat()
        source_type = normalize_body_metric_source_type(body.source_type)
        client_id = (body.client_id or "").strip() or None
        try:
            row = await upsert_user_weight_record(
                user_id=user_id,
                recorded_on=recorded_on,
                weight_kg=body.value,
                source_type=source_type,
                client_record_id=client_id,
            )
            # 自动同步最新体重到健康档案，并重算 BMR / TDEE
            try:
                await sync_profile_weight_from_latest(user_id)
            except Exception as sync_err:
                print(f"[save_body_weight_record] 同步健康档案体重失败（非致命）: {sync_err}")

            return {"message": "体重已保存", "item": normalize_weight_entry(row)}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[save_body_weight_record] 错误: {e}")
            raise HTTPException(status_code=500, detail="保存体重失败")


    @router.post("/api/body-metrics/water")
    async def save_body_water_log(
        body: BodyWaterLogRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        user_id = user_info["user_id"]
        recorded_on = parse_date_string(body.date, "date") or datetime.now(china_tz).date().isoformat()
        source_type = normalize_body_metric_source_type(body.source_type)
        try:
            row = await create_user_water_log(
                user_id=user_id,
                amount_ml=body.amount_ml,
                recorded_on=recorded_on,
                source_type=source_type,
            )
            return {
                "message": "喝水已记录",
                "item": {
                    "id": row.get("id"),
                    "date": str(row.get("recorded_on") or recorded_on),
                    "amount_ml": int(row.get("amount_ml") or body.amount_ml),
                },
            }
        except HTTPException:
            raise
        except Exception as e:
            print(f"[save_body_water_log] 错误: {e}")
            raise HTTPException(status_code=500, detail="保存喝水记录失败")


    @router.post("/api/body-metrics/water/reset")
    async def reset_body_water_logs(
        body: BodyWaterResetRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        user_id = user_info["user_id"]
        recorded_on = parse_date_string(body.date, "date") or datetime.now(china_tz).date().isoformat()
        try:
            deleted_count = await delete_user_water_logs_by_date(user_id=user_id, recorded_on=recorded_on)
            return {"message": "已清空当日喝水记录", "deleted_count": deleted_count, "date": recorded_on}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[reset_body_water_logs] 错误: {e}")
            raise HTTPException(status_code=500, detail="清空喝水记录失败")


    @router.post("/api/body-metrics/sync-local")
    async def sync_local_body_metrics(
        body: BodyMetricsSyncRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """将旧首页本地体重/喝水记录幂等迁移到云端。"""
        user_id = user_info["user_id"]
        imported_weight_count = 0
        imported_water_count = 0

        try:
            if body.water_goal_ml is not None:
                await upsert_user_body_metric_settings(user_id=user_id, water_goal_ml=body.water_goal_ml)

            if body.weight_entries:
                weight_dates = sorted({
                    entry.date for entry in body.weight_entries
                    if parse_date_string(entry.date, "weight_entries.date")
                })
                existing_weight_client_ids: Set[str] = set()
                existing_weight_pairs: Set[Tuple[str, float]] = set()
                if weight_dates:
                    existing_weight_rows = await list_user_weight_records(
                        user_id=user_id,
                        start_date=weight_dates[0],
                        end_date=weight_dates[-1],
                    )
                    for row in existing_weight_rows:
                        date_key = str(row.get("recorded_on") or "")
                        try:
                            weight_value = round(float(row.get("weight_kg") or 0), 1)
                        except Exception:
                            weight_value = 0.0
                        existing_weight_pairs.add((date_key, weight_value))
                        client_record_id = str(row.get("client_record_id") or "").strip()
                        if client_record_id:
                            existing_weight_client_ids.add(client_record_id)

                def _weight_sync_sort_key(entry: BodyMetricsLocalWeightEntry) -> Tuple[str, str]:
                    parsed = parse_datetime(entry.recorded_at)
                    return (
                        entry.date,
                        build_json_datetime(parsed) if parsed else entry.date,
                    )

                for entry in sorted(body.weight_entries, key=_weight_sync_sort_key):
                    recorded_on = parse_date_string(entry.date, "weight_entries.date")
                    if not recorded_on:
                        continue
                    client_id = (entry.client_id or "").strip() or build_legacy_weight_client_id(recorded_on, entry.value)
                    weight_value = round(float(entry.value), 1)
                    if client_id in existing_weight_client_ids or (recorded_on, weight_value) in existing_weight_pairs:
                        continue
                    recorded_at = build_json_datetime(parse_datetime(entry.recorded_at))
                    await upsert_user_weight_record(
                        user_id=user_id,
                        recorded_on=recorded_on,
                        weight_kg=entry.value,
                        source_type="imported",
                        client_record_id=client_id,
                        recorded_at=recorded_at,
                    )
                    existing_weight_client_ids.add(client_id)
                    existing_weight_pairs.add((recorded_on, weight_value))
                    imported_weight_count += 1

            if body.water_by_date:
                water_dates = sorted({
                    date_key for date_key in body.water_by_date.keys()
                    if parse_date_string(date_key, "water_by_date.key")
                })
                if water_dates:
                    existing_water_logs = await list_user_water_logs(
                        user_id=user_id,
                        start_date=water_dates[0],
                        end_date=water_dates[-1],
                    )
                    existing_water_dates = {str(item.get("recorded_on") or "") for item in existing_water_logs}
                    for date_key, day in body.water_by_date.items():
                        recorded_on = parse_date_string(date_key, "water_by_date.key")
                        if not recorded_on or recorded_on in existing_water_dates:
                            continue
                        logs = [int(amount) for amount in day.logs if int(amount) > 0]
                        if not logs and int(day.total) > 0:
                            logs = [int(day.total)]
                        for amount in logs:
                            await create_user_water_log(
                                user_id=user_id,
                                amount_ml=amount,
                                recorded_on=recorded_on,
                                source_type="imported",
                            )
                            imported_water_count += 1

            return {
                "message": "本地身体指标已同步",
                "imported_weight_count": imported_weight_count,
                "imported_water_count": imported_water_count,
            }
        except HTTPException:
            raise
        except Exception as e:
            print(f"[sync_local_body_metrics] 错误: {e}")
            raise HTTPException(status_code=500, detail="同步本地身体指标失败")



    return router
