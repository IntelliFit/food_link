from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import (
    create_prompt,
    delete_prompt,
    get_active_prompt,
    get_prompt_by_id,
    get_prompt_history,
    list_prompts,
    set_active_prompt,
    update_prompt,
)


class PromptCreate(BaseModel):
    model_type: str = Field(..., description="模型类型: qwen 或 gemini")
    prompt_name: str = Field(..., description="提示词名称")
    prompt_content: str = Field(..., description="提示词内容")
    description: str = Field("", description="描述")
    is_active: bool = Field(False, description="是否设为激活")


class PromptUpdate(BaseModel):
    prompt_name: Optional[str] = Field(None, description="提示词名称")
    prompt_content: Optional[str] = Field(None, description="提示词内容")
    description: Optional[str] = Field(None, description="描述")


def create_prompts_router(require_test_backend_auth) -> APIRouter:
    router = APIRouter()

    @router.get("/api/prompts")
    async def api_list_prompts(
        model_type: Optional[str] = None,
        _auth: None = Depends(require_test_backend_auth),
    ):
        """获取提示词列表（需要登录）"""
        try:
            prompts = await list_prompts(model_type)
            return {"success": True, "data": prompts}
        except Exception as e:
            print(f"[api/prompts] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/prompts/active/{model_type}")
    async def api_get_active_prompt(
        model_type: str,
        _auth: None = Depends(require_test_backend_auth),
    ):
        """获取指定模型的激活提示词（需要登录）"""
        if model_type not in ("qwen", "gemini"):
            raise HTTPException(status_code=400, detail="model_type 必须是 qwen 或 gemini")

        try:
            prompt = await get_active_prompt(model_type)
            return {"success": True, "data": prompt}
        except Exception as e:
            print(f"[api/prompts/active] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/prompts/{prompt_id}")
    async def api_get_prompt(
        prompt_id: int,
        _auth: None = Depends(require_test_backend_auth),
    ):
        """获取单个提示词详情（需要登录）"""
        try:
            prompt = await get_prompt_by_id(prompt_id)
            if not prompt:
                raise HTTPException(status_code=404, detail="提示词不存在")
            return {"success": True, "data": prompt}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[api/prompts/{prompt_id}] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/prompts")
    async def api_create_prompt(
        data: PromptCreate,
        _auth: None = Depends(require_test_backend_auth),
    ):
        """创建新提示词（需要登录）"""
        if data.model_type not in ("qwen", "gemini"):
            raise HTTPException(status_code=400, detail="model_type 必须是 qwen 或 gemini")

        try:
            prompt = await create_prompt(
                model_type=data.model_type,
                prompt_name=data.prompt_name,
                prompt_content=data.prompt_content,
                description=data.description,
                is_active=data.is_active,
            )
            return {"success": True, "data": prompt}
        except Exception as e:
            print(f"[api/prompts create] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.put("/api/prompts/{prompt_id}")
    async def api_update_prompt(
        prompt_id: int,
        data: PromptUpdate,
        _auth: None = Depends(require_test_backend_auth),
    ):
        """更新提示词（需要登录）"""
        try:
            prompt = await update_prompt(
                prompt_id=prompt_id,
                prompt_name=data.prompt_name,
                prompt_content=data.prompt_content,
                description=data.description,
            )
            if not prompt:
                raise HTTPException(status_code=404, detail="提示词不存在")
            return {"success": True, "data": prompt}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[api/prompts update] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/api/prompts/{prompt_id}/activate")
    async def api_activate_prompt(
        prompt_id: int,
        _auth: None = Depends(require_test_backend_auth),
    ):
        """激活指定提示词（需要登录）"""
        try:
            success = await set_active_prompt(prompt_id)
            if not success:
                raise HTTPException(status_code=404, detail="提示词不存在")
            return {"success": True, "message": "已激活"}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[api/prompts activate] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete("/api/prompts/{prompt_id}")
    async def api_delete_prompt(
        prompt_id: int,
        _auth: None = Depends(require_test_backend_auth),
    ):
        """删除提示词（需要登录）"""
        try:
            success = await delete_prompt(prompt_id)
            if not success:
                raise HTTPException(status_code=404, detail="提示词不存在")
            return {"success": True, "message": "已删除"}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except HTTPException:
            raise
        except Exception as e:
            print(f"[api/prompts delete] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/api/prompts/{prompt_id}/history")
    async def api_get_prompt_history(
        prompt_id: int,
        _auth: None = Depends(require_test_backend_auth),
    ):
        """获取提示词修改历史（需要登录）"""
        try:
            history = await get_prompt_history(prompt_id)
            return {"success": True, "data": history}
        except Exception as e:
            print(f"[api/prompts history] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    return router
