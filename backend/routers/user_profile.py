from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_user_by_id, list_food_records, update_user, upload_user_avatar
from middleware import get_current_user_info


class UpdateUserInfoRequest(BaseModel):
    nickname: Optional[str] = None
    avatar: Optional[str] = None
    telephone: Optional[str] = None
    searchable: Optional[bool] = None
    public_records: Optional[bool] = None


class BindPhoneRequest(BaseModel):
    """绑定手机号请求（用微信 getPhoneNumber 返回的 code 换手机号并写入库）"""
    phoneCode: str = Field(..., description="微信 getPhoneNumber 返回的 code")


class UploadAvatarRequest(BaseModel):
    """上传用户头像请求"""
    base64Image: str = Field(..., description="Base64 编码的头像图片")


def create_user_profile_router(
    *,
    china_tz: Any,
    normalize_execution_mode: Callable[[Any], str],
    get_phone_number: Callable[[str], Any],
) -> APIRouter:
    router = APIRouter()

    @router.get("/api/user/profile")
    async def get_user_profile(
        user_info: dict = Depends(get_current_user_info),
    ):
        """获取当前用户信息（需要认证）"""
        user_id = user_info["user_id"]
        user = await get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")

        health = {
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
            "execution_mode": normalize_execution_mode(user.get("execution_mode")),
            "mode_set_by": user.get("mode_set_by"),
            "mode_set_at": user.get("mode_set_at"),
            "mode_reason": user.get("mode_reason"),
            "mode_commitment_days": user.get("mode_commitment_days"),
            "mode_switch_count_30d": user.get("mode_switch_count_30d"),
            "searchable": user.get("searchable", True),
            "public_records": user.get("public_records", True),
        }
        return {
            "id": user["id"],
            "openid": user["openid"],
            "unionid": user.get("unionid"),
            "nickname": user.get("nickname", ""),
            "avatar": user.get("avatar", ""),
            "telephone": user.get("telephone"),
            "create_time": user.get("create_time"),
            "update_time": user.get("update_time"),
            **health,
        }

    @router.get("/api/user/record-days")
    async def get_user_record_days(
        user_info: dict = Depends(get_current_user_info),
    ):
        """获取用户记录天数（从第一条记录到现在有记录的天数）"""
        user_id = user_info["user_id"]
        try:
            records = await list_food_records(user_id)
            if not records:
                return {"record_days": 0}

            record_dates = set()
            for record in records:
                rt = record.get("record_time")
                if rt:
                    try:
                        dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                        dt_local = dt_utc.astimezone(china_tz)
                        date_str = dt_local.date().isoformat()
                        record_dates.add(date_str)
                    except Exception as e:
                        print(f"[get_user_record_days] Date parse error for {rt}: {e}")
                        continue

            return {"record_days": len(record_dates)}
        except Exception as e:
            print(f"[get_user_record_days] 错误: {e}")
            raise HTTPException(status_code=500, detail=f"获取记录天数失败: {str(e)}")

    @router.put("/api/user/profile")
    async def update_user_profile(
        update_data: UpdateUserInfoRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """更新当前用户信息（需要认证）"""
        user_id = user_info["user_id"]

        update_dict = {}
        if update_data.nickname is not None:
            update_dict["nickname"] = update_data.nickname
        if update_data.avatar is not None:
            update_dict["avatar"] = update_data.avatar
        if update_data.telephone is not None:
            update_dict["telephone"] = update_data.telephone
        if update_data.searchable is not None:
            update_dict["searchable"] = update_data.searchable
        if update_data.public_records is not None:
            update_dict["public_records"] = update_data.public_records

        if not update_dict:
            raise HTTPException(status_code=400, detail="没有要更新的字段")

        try:
            updated_user = await update_user(user_id, update_dict)
            return {
                "id": updated_user["id"],
                "openid": updated_user["openid"],
                "unionid": updated_user.get("unionid"),
                "nickname": updated_user.get("nickname", ""),
                "avatar": updated_user.get("avatar", ""),
                "telephone": updated_user.get("telephone"),
                "create_time": updated_user.get("create_time"),
                "update_time": updated_user.get("update_time"),
                "searchable": updated_user.get("searchable"),
                "public_records": updated_user.get("public_records"),
            }
        except Exception as e:
            print(f"[update_user_profile] 错误: {e}")
            raise HTTPException(status_code=500, detail=f"更新用户信息失败: {str(e)}")

    @router.post("/api/user/bind-phone")
    async def bind_phone(
        body: BindPhoneRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """
        已登录用户用微信手机号 code 绑定手机号并写入 weapp_user.telephone。
        登录后若后端未返回手机号时可调用此接口补录。
        """
        user_id = user_info["user_id"]
        if not body.phoneCode or not body.phoneCode.strip():
            raise HTTPException(status_code=400, detail="phoneCode 不能为空")
        try:
            phone_info = await get_phone_number(body.phoneCode.strip())
            pure_phone_number = phone_info.get("purePhoneNumber")
            if not pure_phone_number:
                raise HTTPException(status_code=400, detail="未能获取到手机号")
            updated_user = await update_user(user_id, {"telephone": pure_phone_number})
            return {
                "telephone": updated_user.get("telephone"),
                "purePhoneNumber": pure_phone_number,
            }
        except HTTPException:
            raise
        except Exception as e:
            print(f"[bind_phone] 错误: {e}")
            raise HTTPException(status_code=500, detail=f"绑定手机号失败: {str(e)}")

    @router.post("/api/user/upload-avatar")
    async def upload_avatar(
        body: UploadAvatarRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """
        上传用户头像到 Supabase Storage，返回公网 URL。
        小程序先调此接口拿 imageUrl，再调 PUT /api/user/profile 更新 avatar 字段。
        """
        user_id = user_info["user_id"]
        if not body.base64Image:
            raise HTTPException(status_code=400, detail="base64Image 不能为空")
        try:
            image_url = upload_user_avatar(user_id, body.base64Image)
            return {"imageUrl": image_url}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            print(f"[upload_avatar] 错误: {e}")
            raise HTTPException(status_code=500, detail="上传失败，请检查 Supabase Storage 是否已创建 bucket「user-avatars」并设为 Public")

    return router
