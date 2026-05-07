import mimetypes
import os
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from database import upload_food_analyze_image, upload_food_analyze_image_bytes

router = APIRouter()


class UploadAnalyzeImageRequest(BaseModel):
    """食物分析前上传图片，返回 Supabase 公网 URL"""
    base64Image: str = Field(..., description="Base64 编码的图片数据")


def _guess_upload_image_suffix(filename: Optional[str], content_type: Optional[str]) -> str:
    ext = os.path.splitext((filename or "").strip())[1].lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}:
        return ext

    guessed = mimetypes.guess_extension((content_type or "").strip()) or ""
    guessed = guessed.lower()
    if guessed in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}:
        return guessed
    return ".jpg"


@router.post("/api/upload-analyze-image")
async def upload_analyze_image(body: UploadAnalyzeImageRequest):
    """
    食物分析前先上传图片到 Supabase，返回公网 URL。
    前端拿到 URL 后传给 /api/analyze 的 image_url，分析及标记样本时均使用该 URL。
    """
    if not body.base64Image:
        raise HTTPException(status_code=400, detail="base64Image 不能为空")
    try:
        image_url = upload_food_analyze_image(body.base64Image)
        return {"imageUrl": image_url}
    except ValueError as e:
        print(f"[upload_analyze_image] 参数错误: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except ConnectionError as e:
        error_msg = str(e) or "网络连接失败"
        print(f"[upload_analyze_image] 网络错误: {error_msg}")
        raise HTTPException(
            status_code=500,
            detail="上传图片时网络连接失败，请检查网络后重试",
        )
    except Exception as e:
        error_msg = str(e) or f"未知错误: {type(e).__name__}"
        if "SSL" in error_msg or "EOF" in error_msg or "connection" in error_msg.lower():
            print(f"[upload_analyze_image] 网络错误: {error_msg}")
            raise HTTPException(
                status_code=500,
                detail="上传图片时网络连接失败，请检查网络后重试",
            )
        print(f"[upload_analyze_image] 错误: {error_msg}")
        raise HTTPException(status_code=500, detail=f"上传图片失败: {error_msg}")


@router.post("/api/upload-analyze-image-file")
async def upload_analyze_image_file(file: UploadFile = File(...)):
    """
    食物分析前上传单张图片文件，返回 Supabase 公网 URL。
    相比 base64 JSON 上传更省请求体，优先给小程序端使用。
    """
    if file is None:
        raise HTTPException(status_code=400, detail="图片文件不能为空")
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="仅支持图片文件上传")

    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="图片文件为空")

        image_url = upload_food_analyze_image_bytes(
            file_bytes=file_bytes,
            extension=_guess_upload_image_suffix(file.filename, file.content_type),
            content_type=file.content_type or "image/jpeg",
        )
        return {"imageUrl": image_url}
    except HTTPException:
        raise
    except ValueError as e:
        print(f"[upload_analyze_image_file] 参数错误: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except ConnectionError as e:
        error_msg = str(e) or "网络连接失败"
        print(f"[upload_analyze_image_file] 网络错误: {error_msg}")
        raise HTTPException(
            status_code=500,
            detail="上传图片时网络连接失败，请检查网络后重试",
        )
    except Exception as e:
        error_msg = str(e) or f"未知错误: {type(e).__name__}"
        if "SSL" in error_msg or "EOF" in error_msg or "connection" in error_msg.lower():
            print(f"[upload_analyze_image_file] 网络错误: {error_msg}")
            raise HTTPException(
                status_code=500,
                detail="上传图片时网络连接失败，请检查网络后重试",
            )
        print(f"[upload_analyze_image_file] 错误: {error_msg}")
        raise HTTPException(status_code=500, detail=f"上传图片失败: {error_msg}")
    finally:
        await file.close()
