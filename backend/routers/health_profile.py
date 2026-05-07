from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import (
    create_analysis_task_sync,
    get_user_by_id,
    insert_health_document,
    insert_user_mode_switch_log_sync,
    update_user,
    upload_health_report_image,
)
from metabolic import calculate_bmr, calculate_tdee
from middleware import get_current_user_info

router = APIRouter()

VALID_EXECUTION_MODES = {"standard", "strict"}
DEFAULT_EXECUTION_MODE = "standard"
VALID_MODE_SET_BY = {"system", "user_manual", "coach_manual"}


def _normalize_execution_mode(value: Optional[str], default: str = DEFAULT_EXECUTION_MODE) -> str:
    mode = (value or "").strip().lower()
    if mode in VALID_EXECUTION_MODES:
        return mode
    return default


def _parse_execution_mode_or_raise(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    mode = value.strip().lower()
    if not mode:
        return None
    if mode not in VALID_EXECUTION_MODES:
        raise HTTPException(status_code=400, detail="execution_mode ??? standard ? strict")
    return mode


class PrecisionReferenceDimensions(BaseModel):
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None


class PrecisionReferenceObjectInput(BaseModel):
    reference_type: str = Field(default="preset", description="preset / custom")
    reference_name: str = Field(..., description="参考物名称")
    dimensions_mm: Optional[PrecisionReferenceDimensions] = Field(default=None, description="参考物尺寸（毫米）")
    placement_note: Optional[str] = Field(default=None, description="摆放说明")
    applies_to_items: Optional[List[str]] = Field(default=None, description="适用主体 item_key 列表")


VALID_PRECISION_REFERENCE_PRESET_KEYS = {
    "hand",
    "campus_card",
    "large_card",
    "chopsticks",
    "spoon",
    "bank_card",
    "custom",
}


class PrecisionReferencePresetConfig(BaseModel):
    reference_name: str = Field(..., description="默认参考物名称")
    dimensions_mm: Optional[PrecisionReferenceDimensions] = Field(default=None, description="默认参考物尺寸（毫米）")


class PrecisionReferenceDefaults(BaseModel):
    preferred_reference_key: Optional[str] = Field(default=None, description="默认参考物 key")
    presets: Optional[Dict[str, PrecisionReferencePresetConfig]] = Field(default=None, description="按 key 保存的默认参考物配置")


def _normalize_precision_reference_defaults(
    defaults: Optional[PrecisionReferenceDefaults],
) -> Optional[Dict[str, Any]]:
    if defaults is None:
        return None

    preferred_reference_key = str(defaults.preferred_reference_key or "").strip().lower()
    if preferred_reference_key and preferred_reference_key not in VALID_PRECISION_REFERENCE_PRESET_KEYS:
        preferred_reference_key = ""

    normalized_presets: Dict[str, Dict[str, Any]] = {}
    for raw_key, preset in (defaults.presets or {}).items():
        key = str(raw_key or "").strip().lower()
        if key not in VALID_PRECISION_REFERENCE_PRESET_KEYS or preset is None:
            continue
        reference_name = str(preset.reference_name or "").strip()
        if not reference_name:
            continue
        dims = preset.dimensions_mm.dict() if preset.dimensions_mm else {}
        normalized_dims = {
            axis: float(dims[axis])
            for axis in ("length", "width", "height")
            if dims.get(axis) is not None and float(dims[axis]) > 0
        }
        normalized_presets[key] = {
            "reference_name": reference_name,
            "dimensions_mm": normalized_dims or None,
        }

    if not preferred_reference_key and not normalized_presets:
        return None

    return {
        "preferred_reference_key": preferred_reference_key or None,
        "presets": normalized_presets or None,
    }


class DashboardTargetsUpdateRequest(BaseModel):
    """首页仪表盘目标热量与三大营养素（与 PUT /api/user/dashboard-targets 共用结构）"""
    calorie_target: float = Field(..., ge=500, le=6000, description="每日目标热量 kcal")
    protein_target: float = Field(..., ge=0, le=500, description="蛋白质目标 g")
    carbs_target: float = Field(..., ge=0, le=1000, description="碳水目标 g")
    fat_target: float = Field(..., ge=0, le=300, description="脂肪目标 g")


class HealthProfileUpdateRequest(BaseModel):
    """首次/更新健康档案问卷"""
    gender: Optional[str] = Field(None, description="性别: male / female")
    birthday: Optional[str] = Field(None, description="出生日期 YYYY-MM-DD")
    height: Optional[float] = Field(None, ge=50, le=250, description="身高 cm")
    weight: Optional[float] = Field(None, ge=20, le=300, description="体重 kg")
    activity_level: Optional[str] = Field(
        None,
        description="活动水平: sedentary / light / moderate / active / very_active"
    )
    medical_history: Optional[List[str]] = Field(
        default_factory=list,
        description="既往病史：如 diabetes, hypertension, gout 等"
    )
    diet_preference: Optional[List[str]] = Field(
        default_factory=list,
        description="饮食偏好：如 keto, vegetarian, vegan 等"
    )
    allergies: Optional[List[str]] = Field(
        default_factory=list,
        description="过敏原：如 peanuts, seafood 等"
    )
    report_extract: Optional[Dict[str, Any]] = Field(
        None,
        description="体检报告 OCR 识别结果JSON"
    )
    report_image_url: Optional[str] = Field(
        None,
        description="体检报告图片公网 URL"
    )
    diet_goal: Optional[str] = Field(
        None,
        description="目标：fat_loss, muscle_gain, maintain"
    )
    health_notes: Optional[str] = Field(
        None,
        description="特殊情况/补充"
    )
    dashboard_targets: Optional[DashboardTargetsUpdateRequest] = Field(
        None,
        description="首页摄入目标（写入 health_condition.dashboard_targets，兼容未部署独立接口的旧服务）",
    )
    precision_reference_defaults: Optional[PrecisionReferenceDefaults] = Field(
        None,
        description="精准模式默认参考物配置（写入 health_condition.precision_reference_defaults）",
    )
    execution_mode: Optional[str] = Field(
        None,
        description="执行模式: standard / strict"
    )
    mode_set_by: Optional[str] = Field(
        None,
        description="模式设置来源: system / user_manual / coach_manual"
    )
    mode_reason: Optional[str] = Field(
        None,
        description="模式设置原因编码"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "gender": "male",
                "birthday": "1990-01-01",
                "height": 175,
                "weight": 70,
                "activity_level": "moderate",
                "diet_goal": "fat_loss",
                "execution_mode": "strict"
            }
        }


@router.get("/api/user/health-profile")
async def get_health_profile(user_info: dict = Depends(get_current_user_info)):
    """获取当前用户健康档案（需认证）"""
    user_id = user_info["user_id"]
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {
        "height": user.get("height"),
        "weight": user.get("weight"),
        "birthday": user.get("birthday"),
        "gender": user.get("gender"),
        "activity_level": user.get("activity_level"),
        "health_condition": user.get("health_condition") or {},
        "bmr": float(user["bmr"]) if user.get("bmr") is not None else None,
        "tdee": float(user["tdee"]) if user.get("tdee") is not None else None,
        "onboarding_completed": bool(user.get("onboarding_completed")),
        "diet_goal": user.get("diet_goal"),
        "execution_mode": _normalize_execution_mode(user.get("execution_mode")),
        "mode_set_by": user.get("mode_set_by"),
        "mode_set_at": user.get("mode_set_at"),
        "mode_reason": user.get("mode_reason"),
        "mode_commitment_days": user.get("mode_commitment_days"),
        "mode_switch_count_30d": user.get("mode_switch_count_30d"),
    }


@router.put("/api/user/health-profile")
async def update_health_profile(
    body: HealthProfileUpdateRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    提交/更新健康档案问卷。后端根据性别、体重、活动水平自动计算 BMR 与 TDEE。
    """
    user_id = user_info["user_id"]
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    update_dict = {}
    if body.gender is not None:
        update_dict["gender"] = body.gender
    if body.birthday is not None:
        update_dict["birthday"] = body.birthday
    if body.height is not None:
        update_dict["height"] = body.height
    if body.weight is not None:
        update_dict["weight"] = body.weight
    if body.activity_level is not None:
        update_dict["activity_level"] = body.activity_level
    if body.diet_goal is not None:
        update_dict["diet_goal"] = body.diet_goal

    current_mode = _normalize_execution_mode(user.get("execution_mode"))
    requested_mode = _parse_execution_mode_or_raise(body.execution_mode) if body.execution_mode is not None else None
    mode_changed = False
    mode_change_from = current_mode
    mode_change_to = current_mode
    mode_change_set_by = "user_manual"
    mode_change_reason = None
    if requested_mode is not None:
        update_dict["execution_mode"] = requested_mode
        mode_change_to = requested_mode
        mode_changed = requested_mode != current_mode
        if mode_changed:
            raw_set_by = (body.mode_set_by or "user_manual").strip().lower() if body.mode_set_by else "user_manual"
            if raw_set_by not in VALID_MODE_SET_BY:
                raise HTTPException(status_code=400, detail="mode_set_by 不合法")
            mode_change_set_by = raw_set_by
            mode_change_reason = (body.mode_reason or "").strip() or None
            update_dict["mode_set_by"] = mode_change_set_by
            update_dict["mode_set_at"] = datetime.now(timezone.utc).isoformat()
            update_dict["mode_reason"] = mode_change_reason
            prev_count = int(user.get("mode_switch_count_30d") or 0)
            update_dict["mode_switch_count_30d"] = prev_count + 1

    health_condition = dict(user.get("health_condition") or {})
    if body.medical_history is not None:
        health_condition["medical_history"] = body.medical_history
    if body.diet_preference is not None:
        health_condition["diet_preference"] = body.diet_preference
    if body.allergies is not None:
        health_condition["allergies"] = body.allergies
    if body.health_notes is not None:
        health_condition["health_notes"] = body.health_notes
    if body.dashboard_targets is not None:
        dt = body.dashboard_targets
        health_condition["dashboard_targets"] = {
            "calorie_target": round(float(dt.calorie_target), 1),
            "protein_target": round(float(dt.protein_target), 1),
            "carbs_target": round(float(dt.carbs_target), 1),
            "fat_target": round(float(dt.fat_target), 1),
        }
    if body.precision_reference_defaults is not None:
        normalized_precision_reference_defaults = _normalize_precision_reference_defaults(
            body.precision_reference_defaults
        )
        if normalized_precision_reference_defaults:
            health_condition["precision_reference_defaults"] = normalized_precision_reference_defaults
        else:
            health_condition.pop("precision_reference_defaults", None)
    # 若有体检报告 OCR 结果，一并写入 user_health_documents（含 image_url 与识别结果）
    if body.report_extract:
        try:
            await insert_health_document(
                user_id=user_id,
                document_type="report",
                image_url=body.report_image_url,
                extracted_content=body.report_extract,
            )
            health_condition["report_extract"] = body.report_extract
        except Exception as e:
            print(f"[update_health_profile] 写入体检报告失败: {e}")
    update_dict["health_condition"] = health_condition

    # 计算 BMR / TDEE（当前 BMR 使用毛德倩公式，只依赖性别、体重与活动水平）
    gender = update_dict.get("gender") or user.get("gender")
    weight = update_dict.get("weight") if "weight" in update_dict else user.get("weight")
    activity_level = update_dict.get("activity_level") or user.get("activity_level") or "sedentary"

    if gender and weight is not None:
        bmr = calculate_bmr(
            "male" if gender == "male" else "female",
            float(weight),
            0.0,
            0,
        )
        tdee = calculate_tdee(bmr, activity_level or "sedentary")
        update_dict["bmr"] = bmr
        update_dict["tdee"] = tdee

    update_dict["onboarding_completed"] = True

    if not update_dict:
        raise HTTPException(status_code=400, detail="没有要更新的字段")

    # 确保 health_condition 为可序列化 dict（Supabase jsonb）
    if "health_condition" in update_dict and isinstance(update_dict["health_condition"], dict):
        update_dict["health_condition"] = dict(update_dict["health_condition"])

    print(f"[update_health_profile] user_id={user_id}, update_dict keys={list(update_dict.keys())}")

    try:
        updated = await update_user(user_id, update_dict)
        if mode_changed:
            try:
                await asyncio.to_thread(
                    insert_user_mode_switch_log_sync,
                    user_id,
                    mode_change_from,
                    mode_change_to,
                    mode_change_set_by,
                    mode_change_reason,
                )
            except Exception as log_err:
                print(f"[update_health_profile] 写入模式切换日志失败: {log_err}")
        # 二次查询验证：从数据库重新读一次，确认是否真正持久化
        verify = await get_user_by_id(user_id)
        verify_height = verify.get("height") if verify else None
        verify_bmr = verify.get("bmr") if verify else None
        print(
            f"[update_health_profile] 返回行 height={updated.get('height')}, bmr={updated.get('bmr')} | "
            f"验证查询 height={verify_height}, bmr={verify_bmr} | "
            f"Supabase={os.getenv('SUPABASE_URL', '')[:50]}..."
        )
        if verify and verify_height is None and updated.get("height") is not None:
            print("[update_health_profile] 警告: 更新返回有值但验证查询无值，可能未持久化或连接了不同项目，请核对 SUPABASE_URL 与 Dashboard 是否一致")
        return {
            "height": updated.get("height"),
            "weight": updated.get("weight"),
            "birthday": updated.get("birthday"),
            "gender": updated.get("gender"),
            "activity_level": updated.get("activity_level"),
            "health_condition": updated.get("health_condition") or {},
            "bmr": float(updated["bmr"]) if updated.get("bmr") is not None else None,
            "tdee": float(updated["tdee"]) if updated.get("tdee") is not None else None,
            "onboarding_completed": bool(updated.get("onboarding_completed")),
            "diet_goal": updated.get("diet_goal"),
            "execution_mode": _normalize_execution_mode(updated.get("execution_mode")),
            "mode_set_by": updated.get("mode_set_by"),
            "mode_set_at": updated.get("mode_set_at"),
            "mode_reason": updated.get("mode_reason"),
            "mode_commitment_days": updated.get("mode_commitment_days"),
            "mode_switch_count_30d": updated.get("mode_switch_count_30d"),
        }
    except Exception as e:
        err_msg = str(e).lower()
        print(f"[update_health_profile] 错误: {e}")
        if "column" in err_msg and ("does not exist" in err_msg or "不存在" in err_msg):
            raise HTTPException(
                status_code=500,
                detail="数据库表未扩展健康档案字段。请在 Supabase SQL Editor 中执行 backend/database/user_health_profile.sql 迁移脚本。"
            )
        raise HTTPException(status_code=500, detail=f"更新健康档案失败: {str(e)}")


def _ocr_report_prompt() -> str:
    """体检报告 OCR 提示词"""
    return """
你是一个专业的 OCR 文字识别助手。请识别这张体检报告或病例截图中的所有文字内容。
任务要求：
1. **仅提取**图片中实际存在的文字，**严禁**进行总结、概括、分析或生成医疗建议。
2. 如果图片中包含指标数据，请精确提取数值和单位。
3. 如果图片中包含诊断结论，请按原文提取。

请严格按以下 JSON 格式返回（若某项图片中不存在则填空数组或空字符串）：
{
  "indicators": [{"name": "项目名称", "value": "测定值", "unit": "单位", "flag": "异常标记(如↑/↓)"}],
  "conclusions": ["诊断结论1(原文)", "诊断结论2(原文)"],
  "suggestions": ["医学建议(仅提取报告原文中的建议，不要自己生成)"],
  "medical_notes": "其他主要文字内容的原文提取"
}
只返回上述 JSON，不要其他说明。
""".strip()


async def _ocr_extract_report_image(base64_image: str) -> Dict[str, Any]:
    """体检报告 OCR：使用 base64 图片，仅返回提取的 JSON，不写库。"""
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="缺少 DASHSCOPE_API_KEY 环境变量")
    image_data = base64_image.split(",")[1] if "," in base64_image else base64_image
    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            api_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": os.getenv("ANALYZE_MODEL", "gemini-3-flash-preview"),
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": _ocr_report_prompt()},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_data}"}},
                        ],
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.3,
            },
        )
    if not response.is_success:
        raise HTTPException(status_code=500, detail="OCR 识别服务请求失败")
    data = response.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not content:
        raise HTTPException(status_code=500, detail="OCR 返回为空")
    json_str = re.sub(r"```json", "", content)
    json_str = re.sub(r"```", "", json_str).strip()
    return json.loads(json_str)


async def _ocr_extract_report_by_url(image_url: str) -> Dict[str, Any]:
    """体检报告 OCR：使用图片公网 URL 传给多模态模型，仅返回提取的 JSON，不写库。"""
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="缺少 DASHSCOPE_API_KEY 环境变量")
    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            api_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": os.getenv("ANALYZE_MODEL", "gemini-3-flash-preview"),
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": _ocr_report_prompt()},
                            {"type": "image_url", "image_url": {"url": image_url}},
                        ],
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.3,
            },
        )
    if not response.is_success:
        raise HTTPException(status_code=500, detail="OCR 识别服务请求失败")
    data = response.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not content:
        raise HTTPException(status_code=500, detail="OCR 返回为空")
    json_str = re.sub(r"```json", "", content)
    json_str = re.sub(r"```", "", json_str).strip()
    return json.loads(json_str)


class UploadReportImageRequest(BaseModel):
    """上传体检报告图片到 Supabase Storage"""
    base64Image: str = Field(..., description="Base64 编码的体检报告或病例截图")


@router.post("/api/user/health-profile/upload-report-image")
async def upload_report_image(
    body: UploadReportImageRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    将体检报告图片上传到 Supabase Storage，返回公网 URL。
    小程序先调此接口拿 imageUrl，再调 ocr-extract 传 imageUrl 给多模态模型识别。
    """
    user_id = user_info["user_id"]
    if not body.base64Image:
        raise HTTPException(status_code=400, detail="base64Image 不能为空")
    try:
        image_url = upload_health_report_image(user_id, body.base64Image)
        return {"imageUrl": image_url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[upload_report_image] 错误: {e}")
        raise HTTPException(status_code=500, detail="上传失败，请检查 Supabase Storage 是否已创建 bucket「health-reports」并设为 Public")


class SubmitReportExtractionTaskRequest(BaseModel):
    """提交病历信息提取任务（后台异步处理）"""
    imageUrl: str = Field(..., description="体检报告图片在 Supabase Storage 的公网 URL")


@router.post("/api/user/health-profile/submit-report-extraction-task")
async def submit_report_extraction_task(
    body: SubmitReportExtractionTaskRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    提交病历信息提取任务，由 Worker 子进程在后台处理。
    完成后自动写入 user_health_documents 并更新 weapp_user.health_condition.report_extract。
    用户无需等待，保存档案后即可退出。
    """
    user_id = user_info["user_id"]
    if not body.imageUrl or not body.imageUrl.strip():
        raise HTTPException(status_code=400, detail="imageUrl 不能为空")
    try:
        task = await asyncio.to_thread(
            create_analysis_task_sync,
            user_id=user_id,
            task_type="health_report",
            image_url=body.imageUrl.strip(),
            payload={},
        )
        return {"taskId": str(task["id"])}
    except Exception as e:
        print(f"[submit_report_extraction_task] 错误: {e}")
        raise HTTPException(status_code=500, detail="提交任务失败")


class HealthReportOcrRequest(BaseModel):
    """体检报告 OCR 请求：imageUrl 或 base64Image 二选一"""
    imageUrl: Optional[str] = Field(None, description="体检报告图片公网 URL")
    base64Image: Optional[str] = Field(None, description="Base64 编码的报告图片")


@router.post("/api/user/health-profile/ocr-extract")
async def health_report_ocr_extract(
    body: HealthReportOcrRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    仅识别体检报告/病例截图，返回提取的 JSON，不写入数据库。
    推荐先调 upload-report-image 拿到 imageUrl，再传 imageUrl 给本接口；也可直接传 base64Image。
    """
    if body.imageUrl:
        try:
            extracted = await _ocr_extract_report_by_url(body.imageUrl)
            return {"extracted": extracted}
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="OCR 返回格式解析失败")
        except HTTPException:
            raise
        except Exception as e:
            print(f"[health_report_ocr_extract] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    if body.base64Image:
        try:
            extracted = await _ocr_extract_report_image(body.base64Image)
            return {"extracted": extracted}
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="OCR 返回格式解析失败")
        except HTTPException:
            raise
        except Exception as e:
            print(f"[health_report_ocr_extract] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    raise HTTPException(status_code=400, detail="请传 imageUrl 或 base64Image")


@router.post("/api/user/health-profile/ocr")
async def health_report_ocr(
    body: HealthReportOcrRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    上传体检报告/病例截图，OCR 识别并写入 user_health_documents。
    """
    user_id = user_info["user_id"]
    if not body.base64Image:
        raise HTTPException(status_code=400, detail="base64Image 不能为空")
    try:
        extracted = await _ocr_extract_report_image(body.base64Image)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[health_report_ocr] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    try:
        await insert_health_document(
            user_id=user_id,
            document_type="report",
            image_url=None,
            extracted_content=extracted,
        )
    except Exception as e:
        print(f"[health_report_ocr] 写入文档表失败: {e}")
    return {"extracted": extracted, "message": "识别完成，已保存到健康档案"}


# ---------- 饮食记录（拍照识别后确认记录） ----------


# ---------- 数据统计（周/月摄入、TDEE、连续天数、饮食结构 + AI 洞察） ----------
