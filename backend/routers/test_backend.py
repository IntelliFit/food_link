from __future__ import annotations

import asyncio
import base64
import mimetypes
import os
import secrets
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Cookie, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

from database import (
    create_test_backend_dataset,
    get_active_prompt,
    get_prompt_by_id,
    get_test_backend_dataset,
    insert_test_backend_dataset_items,
    list_test_backend_dataset_items,
    list_test_backend_datasets,
    upload_food_analyze_image,
    upload_food_analyze_image_bytes,
)
from test_backend import BatchProcessor, SingleProcessor
from test_backend.utils import (
    calculate_deviation,
    calculate_item_weight_evaluation,
    calculate_item_weight_evaluation_with_deepseek,
    is_valid_image_file,
    normalize_expected_items,
    parse_labels_file,
)

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
router = APIRouter()

_analyze_with_qwen = None
_analyze_with_gemini = None
_build_gemini_prompt = None
_parse_execution_mode_or_raise = None
_parse_analysis_engine_or_raise = None


def create_test_backend_router(
    *,
    analyze_with_qwen,
    analyze_with_gemini,
    build_gemini_prompt,
    parse_execution_mode_or_raise,
    parse_analysis_engine_or_raise,
) -> APIRouter:
    global _analyze_with_qwen
    global _analyze_with_gemini
    global _build_gemini_prompt
    global _parse_execution_mode_or_raise
    global _parse_analysis_engine_or_raise

    _analyze_with_qwen = analyze_with_qwen
    _analyze_with_gemini = analyze_with_gemini
    _build_gemini_prompt = build_gemini_prompt
    _parse_execution_mode_or_raise = parse_execution_mode_or_raise
    _parse_analysis_engine_or_raise = parse_analysis_engine_or_raise
    return router


# ========== 测试后台 API ==========

# 测试后台登录凭证（简单认证）
TEST_BACKEND_USERNAME = "好人松松"
TEST_BACKEND_PASSWORD = "123456"

# 有效的会话 token 集合（内存存储，重启后失效）
_valid_session_tokens = set()
TEST_BACKEND_MODEL_FLASH = "gemini-3-flash-preview"
TEST_BACKEND_MODEL_FLASH_LITE = "gemini-3.1-flash-lite-preview"
TEST_BACKEND_SUPPORTED_MODELS = {
    TEST_BACKEND_MODEL_FLASH,
    TEST_BACKEND_MODEL_FLASH_LITE,
}


def _generate_session_token() -> str:
    """生成会话 token"""
    return secrets.token_urlsafe(32)


def _verify_test_backend_auth(test_backend_token: str = Cookie(None)) -> bool:
    """验证测试后台登录状态"""
    if not test_backend_token:
        return False
    return test_backend_token in _valid_session_tokens


async def require_test_backend_auth(test_backend_token: str = Cookie(None)):
    """依赖项：要求测试后台登录"""
    if not _verify_test_backend_auth(test_backend_token):
        raise HTTPException(status_code=401, detail="请先登录测试后台")


class TestBackendLoginRequest(BaseModel):
    username: str
    password: str


class TestBackendLocalDatasetImportRequest(BaseModel):
    name: str
    source_dir: str
    description: Optional[str] = ""


@router.post("/api/test-backend/login")
async def test_backend_login(data: TestBackendLoginRequest):
    """测试后台登录"""
    if data.username == TEST_BACKEND_USERNAME and data.password == TEST_BACKEND_PASSWORD:
        token = _generate_session_token()
        _valid_session_tokens.add(token)
        
        response = JSONResponse(content={"success": True, "message": "登录成功"})
        # 设置 cookie，有效期 24 小时
        response.set_cookie(
            key="test_backend_token",
            value=token,
            max_age=86400,
            httponly=True,
            samesite="lax"
        )
        return response
    else:
        return JSONResponse(
            status_code=401,
            content={"success": False, "message": "账号或密码错误"}
        )


@router.post("/api/test-backend/logout")
async def test_backend_logout(test_backend_token: str = Cookie(None)):
    """测试后台登出"""
    if test_backend_token and test_backend_token in _valid_session_tokens:
        _valid_session_tokens.discard(test_backend_token)
    
    response = JSONResponse(content={"success": True, "message": "已登出"})
    response.delete_cookie("test_backend_token")
    return response


def _get_test_processors():
    """获取测试处理器实例"""
    qwen_api_key = os.getenv("DASHSCOPE_API_KEY")
    qwen_base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    
    return BatchProcessor(
        analyze_with_qwen_func=_analyze_with_qwen,
        analyze_with_gemini_func=_analyze_with_gemini,
        build_prompt_func=_build_gemini_prompt,
        qwen_api_key=qwen_api_key,
        qwen_base_url=qwen_base_url,
        max_concurrent=2
    ), SingleProcessor(
        analyze_with_qwen_func=_analyze_with_qwen,
        analyze_with_gemini_func=_analyze_with_gemini,
        build_prompt_func=_build_gemini_prompt,
        qwen_api_key=qwen_api_key,
        qwen_base_url=qwen_base_url
    )


def _serialize_test_backend_dataset(dataset: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": dataset.get("id"),
        "name": dataset.get("name"),
        "description": dataset.get("description") or "",
        "sourceType": dataset.get("source_type") or "local_import",
        "sourceRef": dataset.get("source_ref") or "",
        "coverImageUrl": dataset.get("cover_image_url"),
        "itemCount": int(dataset.get("item_count") or 0),
        "labeledCount": int(dataset.get("labeled_count") or 0),
        "unlabeledCount": int(dataset.get("unlabeled_count") or 0),
        "metadata": dataset.get("metadata") or {},
        "createdAt": dataset.get("created_at"),
        "updatedAt": dataset.get("updated_at"),
    }


def _scan_test_backend_local_dataset_dir(source_dir: str) -> Dict[str, Any]:
    if not source_dir:
        raise HTTPException(status_code=400, detail="source_dir 不能为空")
    if not os.path.isdir(source_dir):
        raise HTTPException(status_code=400, detail="source_dir 不存在或不是目录")

    images: Dict[str, bytes] = {}
    labels: Dict[str, Dict[str, Any]] = {}
    label_path = os.path.join(source_dir, "labels.txt")
    if os.path.exists(label_path):
        try:
            with open(label_path, "r", encoding="utf-8") as f:
                labels = parse_labels_file(f.read())
        except UnicodeDecodeError:
            with open(label_path, "r", encoding="gbk") as f:
                labels = parse_labels_file(f.read())

    for entry in sorted(os.listdir(source_dir)):
        full_path = os.path.join(source_dir, entry)
        if not os.path.isfile(full_path):
            continue
        if entry.lower() == "labels.txt" or entry.lower().endswith(".txt"):
            continue
        if not is_valid_image_file(entry):
            continue
        with open(full_path, "rb") as f:
            images[entry] = f.read()

    items = []
    skipped = []
    for index, filename in enumerate(sorted(images.keys()), 1):
        label = labels.get(filename)
        if not label:
            skipped.append(filename)
            continue
        true_weight = float(label.get("trueWeight") or 0)
        expected_items = label.get("expectedItems") or []
        label_mode = label.get("labelMode") or _infer_test_backend_label_mode(expected_items) or "total"
        items.append({
            "filename": filename,
            "imageBytes": images[filename],
            "trueWeight": true_weight,
            "labelMode": label_mode,
            "expectedItems": expected_items,
            "sortOrder": index,
        })

    return {
        "sourceDir": source_dir,
        "imageCount": len(images),
        "labeledCount": len(items),
        "unlabeledCount": len(skipped),
        "items": items,
        "skipped": skipped,
    }


def _build_test_backend_batch_from_dataset(dataset: Dict[str, Any], dataset_items: List[Dict[str, Any]]) -> Dict[str, Any]:
    items = []
    for row in dataset_items:
        items.append({
            "filename": row.get("filename"),
            "trueWeight": float(row.get("true_weight") or 0),
            "labelMode": row.get("label_mode") or "total",
            "expectedItems": row.get("expected_items") or [],
            "imageUrl": row.get("image_url"),
            "status": "pending",
            "estimatedWeight": None,
            "deviation": None,
            "modelResults": [],
            "description": None,
            "insight": None,
            "pfc_ratio_comment": None,
            "absorption_notes": None,
            "context_advice": None,
            "items": None,
            "error": None,
        })

    batch_id = secrets.token_hex(12)
    return {
        "batch_id": batch_id,
        "status": "pending",
        "notes": "",
        "is_multi_view": False,
        "prompt_id": None,
        "prompt_ids": [],
        "models": [TEST_BACKEND_MODEL_FLASH],
        "analysis_modes": list(DEFAULT_TEST_BACKEND_ANALYSIS_MODES),
        "datasetId": dataset.get("id"),
        "datasetName": dataset.get("name"),
        "items": items,
        "summary": {
            "total": len(items),
            "pending": len(items),
            "skipped": (dataset.get("metadata") or {}).get("skipped") or [],
        },
    }


def _parse_test_backend_models(raw_models: Optional[str]) -> List[str]:
    """Parse comma-separated concrete model names for the test backend."""
    models = [
        item.strip().lower()
        for item in str(raw_models or "").split(",")
        if item.strip()
    ]
    if not models:
        current = (os.getenv("GEMINI_MODEL_NAME") or TEST_BACKEND_MODEL_FLASH).strip().lower()
        models = [current if current in TEST_BACKEND_SUPPORTED_MODELS else TEST_BACKEND_MODEL_FLASH]
    invalid = [item for item in models if item not in TEST_BACKEND_SUPPORTED_MODELS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"不支持的模型: {', '.join(invalid)}")
    deduped: List[str] = []
    for model in models:
        if model not in deduped:
            deduped.append(model)
    return deduped


def _parse_test_backend_execution_mode(raw_mode: Optional[str]) -> str:
    mode = str(raw_mode or "").strip().lower()
    if mode == "custom":
        return "custom"
    return _parse_execution_mode_or_raise(mode) or "standard"


TEST_BACKEND_ANALYSIS_MODE_CONFIG: Dict[str, Dict[str, str]] = {
    "custom": {"execution_mode": "custom", "analysis_engine": "legacy_direct"},
    "legacy_direct": {"execution_mode": "standard", "analysis_engine": "legacy_direct"},
    "db_first": {"execution_mode": "standard", "analysis_engine": "db_first"},
}
DEFAULT_TEST_BACKEND_ANALYSIS_MODES: List[str] = ["custom", "legacy_direct", "db_first"]


def _resolve_test_backend_analysis_mode_config(analysis_mode: str) -> Dict[str, str]:
    normalized_mode = str(analysis_mode or "").strip().lower()
    config = TEST_BACKEND_ANALYSIS_MODE_CONFIG.get(normalized_mode)
    if not config:
        raise HTTPException(status_code=400, detail=f"不支持的识别模式: {analysis_mode}")
    return {
        "analysis_mode": normalized_mode,
        "execution_mode": config["execution_mode"],
        "analysis_engine": config["analysis_engine"],
    }


def _parse_test_backend_analysis_modes(raw_modes: Optional[str]) -> List[str]:
    modes = [
        item.strip().lower()
        for item in str(raw_modes or "").split(",")
        if item.strip()
    ]
    if not modes:
        return list(DEFAULT_TEST_BACKEND_ANALYSIS_MODES)
    parsed: List[str] = []
    for mode in modes:
        normalized_mode = _resolve_test_backend_analysis_mode_config(mode)["analysis_mode"]
        if normalized_mode not in parsed:
            parsed.append(normalized_mode)
    return parsed or list(DEFAULT_TEST_BACKEND_ANALYSIS_MODES)


def _parse_test_backend_analysis_engines(raw_engines: Optional[str], execution_mode: str) -> List[str]:
    engines = [
        item.strip().lower()
        for item in str(raw_engines or "").split(",")
        if item.strip()
    ]
    if execution_mode == "strict":
        return ["legacy_direct"]
    if not engines:
        return ["legacy_direct", "db_first"] if execution_mode == "standard" else ["legacy_direct"]
    parsed: List[str] = []
    for engine in engines:
        parsed_engine = _parse_analysis_engine_or_raise(engine)
        if parsed_engine and parsed_engine not in parsed:
            parsed.append(parsed_engine)
    return parsed or ["legacy_direct"]


def _resolve_test_backend_analysis_modes(
    raw_modes: Optional[str],
    raw_execution_mode: Optional[str],
    raw_analysis_engines: Optional[str],
) -> List[str]:
    if str(raw_modes or "").strip():
        return _parse_test_backend_analysis_modes(raw_modes)
    mode = _parse_test_backend_execution_mode(raw_execution_mode)
    if mode == "custom":
        return ["custom"]
    return _parse_test_backend_analysis_engines(raw_analysis_engines, mode)


def _parse_test_backend_prompt_ids(
    raw_prompt_ids: Optional[str],
    raw_prompt_id: Optional[int] = None,
) -> List[int]:
    parsed_ids: List[int] = []
    for item in str(raw_prompt_ids or "").split(","):
        text = item.strip()
        if not text:
            continue
        try:
            prompt_id = int(text)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"非法 prompt_id: {text}")
        if prompt_id <= 0:
            raise HTTPException(status_code=400, detail=f"非法 prompt_id: {text}")
        if prompt_id not in parsed_ids:
            parsed_ids.append(prompt_id)
    if raw_prompt_id is not None:
        prompt_id = int(raw_prompt_id)
        if prompt_id <= 0:
            raise HTTPException(status_code=400, detail=f"非法 prompt_id: {prompt_id}")
        if prompt_id not in parsed_ids:
            parsed_ids.append(prompt_id)
    return parsed_ids


def _parse_expected_items_input(raw_value: Optional[str], reference_weight: Optional[float] = None) -> List[Dict[str, Any]]:
    """Parse single-image per-food labels from JSON or inline text."""
    text = (raw_value or "").strip()
    if not text:
        return normalize_expected_items(None, fallback_total=reference_weight)
    try:
        if text[0] in "[{":
            payload = json.loads(text)
            if isinstance(payload, dict):
                if isinstance(payload.get("items"), list):
                    return normalize_expected_items(payload.get("items"), fallback_total=reference_weight)
                return normalize_expected_items(payload, fallback_total=reference_weight)
            return normalize_expected_items(payload, fallback_total=reference_weight)
        from test_backend.utils import _parse_items_inline
        return normalize_expected_items(_parse_items_inline(text), fallback_total=reference_weight)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"标准标签格式错误: {e}")


def _infer_test_backend_label_mode(expected_items: Optional[List[Dict[str, Any]]]) -> Optional[str]:
    if not expected_items:
        return None
    return calculate_item_weight_evaluation([], expected_items).get("mode") or "items"


async def _upload_test_backend_images(images: List[UploadFile]) -> tuple[List[str], List[bytes], str]:
    valid_types = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    image_urls: List[str] = []
    image_bytes_list: List[bytes] = []
    first_name = images[0].filename or "uploaded_image.jpg"

    for image in images:
        if image.content_type not in valid_types:
            raise HTTPException(status_code=400, detail="请上传有效的图片文件（jpg, png, gif, webp）")
        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="存在空图片文件，请重新上传")
        if len(image_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="单张图片大小超过限制（最大 10MB）")
        image_bytes_list.append(image_bytes)
        mime_type = mimetypes.guess_type(image.filename or first_name)[0] or image.content_type or "image/jpeg"
        image_base64 = base64.b64encode(image_bytes).decode("utf-8")
        data_uri = f"data:{mime_type};base64,{image_base64}"
        try:
            image_urls.append(await asyncio.to_thread(upload_food_analyze_image, data_uri))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"上传图片失败: {str(e)}")

    return image_urls, image_bytes_list, first_name


async def _run_test_backend_provider_analysis(
    image_urls: List[str],
    filename: str,
    provider: str,
    notes: str = "",
    is_multi_view: bool = False,
    analysis_mode: str = "legacy_direct",
    prompt_id: Optional[int] = None,
    expected_items: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Run one selected Gemini model for the test backend."""
    provider = provider.strip().lower()
    if provider not in TEST_BACKEND_SUPPORTED_MODELS:
        raise RuntimeError(f"不支持的模型: {provider}")
    mode_config = _resolve_test_backend_analysis_mode_config(analysis_mode)
    execution_mode = mode_config["execution_mode"]
    analysis_engine = mode_config["analysis_engine"]
    task = {
        "task_type": "food",
        "image_url": image_urls[0] if image_urls else None,
        "image_paths": image_urls,
        "payload": {
            "additionalContext": (notes or "").strip(),
            "is_multi_view": is_multi_view,
            "execution_mode": _normalize_execution_mode(execution_mode) if execution_mode != "custom" else "standard",
            "analysis_engine": analysis_engine,
        },
    }

    try:
        from worker import (
            _build_food_prompt as worker_build_food_prompt,
            _build_food_prompt_db_first as worker_build_food_prompt_db_first,
            _build_result_items_with_lookup as worker_build_result_items_with_lookup,
            _derive_recognition_fields as worker_derive_recognition_fields,
            _normalize_analysis_response_payload as worker_normalize_analysis_response_payload,
            _parse_analysis_result_items as worker_parse_analysis_result_items,
            _strip_standard_mode_extra_fields as worker_strip_standard_mode_extra_fields,
            _summarize_db_first_items as worker_summarize_db_first_items,
            OFOX_BASE_URL as WORKER_OFOX_BASE_URL,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"加载主链路分析模块失败: {str(e)}")

    async def _resolve_test_backend_prompt(
        mode: str,
        selected_prompt_id: Optional[int] = None,
    ) -> Tuple[str, str, Optional[Dict[str, Any]]]:
        prompt_builder = worker_build_food_prompt_db_first if analysis_engine == "db_first" else worker_build_food_prompt
        builder_name = "_build_food_prompt_db_first" if analysis_engine == "db_first" else "_build_food_prompt"
        if mode != "custom":
            prompt_content = prompt_builder(task, "")
            return prompt_content, f"backend/worker.py::{builder_name}({mode})", None

        selected_prompt: Optional[Dict[str, Any]] = None
        if selected_prompt_id:
            selected_prompt = await get_prompt_by_id(selected_prompt_id)
            if not selected_prompt:
                raise HTTPException(status_code=404, detail="所选提示词不存在")
            if str(selected_prompt.get("model_type") or "").strip().lower() != "gemini":
                raise HTTPException(status_code=400, detail="测试后台当前只支持选择 Gemini 提示词")

        active_prompt = selected_prompt or await get_active_prompt("gemini")
        prompt_content = str((active_prompt or {}).get("prompt_content") or "").strip()
        if prompt_content:
            context_lines: List[str] = []
            if is_multi_view:
                context_lines.append("补充说明：提供的是同一份食物的不同视角，请综合所有图片判断，不要当成多份食物。")
            if (notes or "").strip():
                context_lines.append(f"补充说明：{(notes or '').strip()}")
            if context_lines:
                prompt_content = prompt_content + "\n\n" + "\n".join(context_lines)
            if selected_prompt:
                return prompt_content, f"model_prompts.id({selected_prompt.get('id')})", active_prompt
            return prompt_content, "model_prompts.active(gemini)", active_prompt

        prompt_content = prompt_builder(task, "")
        return prompt_content, f"backend/worker.py::{builder_name}(custom-fallback)", None

    api_key = os.getenv("OFOXAI_API_KEY") or os.getenv("ofox_ai_apikey")
    if not api_key:
        raise RuntimeError("缺少 OFOXAI_API_KEY 环境变量")
    api_url = f"{WORKER_OFOX_BASE_URL}/chat/completions"
    model_name = provider

    normalized_mode = execution_mode if execution_mode == "custom" else _normalize_execution_mode(execution_mode)
    prompt, prompt_source, active_prompt = await _resolve_test_backend_prompt(normalized_mode, prompt_id)
    content_parts = [{"type": "text", "text": prompt}]
    for url in image_urls:
        content_parts.append({"type": "image_url", "image_url": {"url": url}})

    parsed = None
    api_duration_ms = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                api_started_at = time.perf_counter()
                response = await client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model_name,
                        "messages": [{"role": "user", "content": content_parts}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.7,
                    },
                )
                api_duration_ms = round((time.perf_counter() - api_started_at) * 1000, 1)
            if not response.is_success:
                err = response.json() if response.content else {}
                msg = err.get("error", {}).get("message") or f"API 错误: {response.status_code}"
                if attempt < 2:
                    await asyncio.sleep(1)
                    continue
                raise RuntimeError(msg)
            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content")
            if not content:
                if attempt < 2:
                    await asyncio.sleep(1)
                    continue
                raise RuntimeError("AI 返回了空响应")
            json_str = re.sub(r"```json", "", content)
            json_str = re.sub(r"```", "", json_str).strip()
            parsed = worker_normalize_analysis_response_payload(json.loads(json_str))
            break
        except Exception:
            if attempt >= 2:
                raise
            await asyncio.sleep(1)

    if parsed is None:
        raise RuntimeError("AI 返回解析失败")

    def _optional_text(value: Any) -> Optional[str]:
        text = str(value or "").strip()
        return text or None

    if analysis_engine == "db_first":
        parsed_items = worker_build_result_items_with_lookup(task, parsed.get("items") or [])
        resolved_summary = worker_summarize_db_first_items(parsed_items)
    else:
        parsed_items = worker_parse_analysis_result_items(parsed)
        resolved_summary = {}
    result = {
        "description": _optional_text(parsed.get("description")),
        "insight": _optional_text(parsed.get("insight")),
        "items": parsed_items,
        "pfc_ratio_comment": _optional_text(parsed.get("pfc_ratio_comment")),
        "absorption_notes": _optional_text(parsed.get("absorption_notes")),
        "context_advice": _optional_text(parsed.get("context_advice")),
        "analysis_engine": analysis_engine,
        "resolved_count": resolved_summary.get("resolved_count"),
        "unresolved_count": resolved_summary.get("unresolved_count"),
    }
    if normalized_mode != "custom":
        result = worker_strip_standard_mode_extra_fields(result, _normalize_execution_mode(execution_mode))
    if normalized_mode == "strict":
        result.update(worker_derive_recognition_fields(parsed or {}, parsed_items, "strict"))

    evaluation = await calculate_item_weight_evaluation_with_deepseek(result.get("items") or [], expected_items or [])
    return {
        "success": True,
        "provider": "gemini",
        "model": model_name,
        "analysis_mode": mode_config["analysis_mode"],
        "analysis_engine": analysis_engine,
        "data": result,
        "meta": {
            "provider": "gemini",
            "model": model_name,
            "analysis_mode": mode_config["analysis_mode"],
            "analysis_engine": analysis_engine,
            "image_count": len(image_urls),
            "image_urls": image_urls,
            "is_multi_view": is_multi_view,
            "execution_mode": normalized_mode,
            "notes": (notes or "").strip(),
            "estimated_weight": evaluation.get("estimatedTotalWeight"),
            "reference_weight": evaluation.get("trueTotalWeight") or None,
            "deviation": evaluation.get("totalDeviation"),
            "prompt_source": prompt_source,
            "prompt_id": (active_prompt or {}).get("id"),
            "prompt_name": (active_prompt or {}).get("prompt_name"),
            "resolved_count": resolved_summary.get("resolved_count"),
            "unresolved_count": resolved_summary.get("unresolved_count"),
            "api_duration_ms": api_duration_ms,
        },
        "evaluation": evaluation,
    }


async def _run_test_backend_multi_model_analysis(
    image_urls: List[str],
    filename: str,
    models: List[str],
    notes: str = "",
    is_multi_view: bool = False,
    analysis_modes: Optional[List[str]] = None,
    prompt_id: Optional[int] = None,
    prompt_ids: Optional[List[int]] = None,
    expected_items: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    custom_prompt_ids = [int(item) for item in (prompt_ids or []) if int(item) > 0]
    if prompt_id and prompt_id not in custom_prompt_ids:
        custom_prompt_ids.append(int(prompt_id))
    run_analysis_modes = analysis_modes or list(DEFAULT_TEST_BACKEND_ANALYSIS_MODES)

    async def _resolve_failure_prompt_meta(analysis_mode: str, selected_prompt_id: Optional[int]) -> Dict[str, Any]:
        if analysis_mode != "custom":
            return {}
        if selected_prompt_id:
            prompt_row = await get_prompt_by_id(selected_prompt_id)
            return {
                "prompt_id": selected_prompt_id,
                "prompt_name": (prompt_row or {}).get("prompt_name"),
            }
        active_prompt = await get_active_prompt("gemini")
        return {
            "prompt_id": (active_prompt or {}).get("id"),
            "prompt_name": (active_prompt or {}).get("prompt_name"),
        }

    async def run_one(provider: str, analysis_mode: str, selected_prompt_id: Optional[int]) -> Dict[str, Any]:
        started_at = time.perf_counter()
        mode_config = _resolve_test_backend_analysis_mode_config(analysis_mode)
        try:
            result = await _run_test_backend_provider_analysis(
                image_urls=image_urls,
                filename=filename,
                provider=provider,
                notes=notes,
                is_multi_view=is_multi_view,
                analysis_mode=analysis_mode,
                prompt_id=selected_prompt_id,
                expected_items=expected_items,
            )
            duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
            result.setdefault("meta", {})["response_duration_ms"] = duration_ms
            return result
        except Exception as e:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
            prompt_meta = await _resolve_failure_prompt_meta(analysis_mode, selected_prompt_id)
            return {
                "success": False,
                "provider": "gemini",
                "model": provider,
                "analysis_mode": analysis_mode,
                "analysis_engine": mode_config["analysis_engine"],
                "data": None,
                "meta": {
                    "provider": "gemini",
                    "model": provider,
                    "analysis_mode": analysis_mode,
                    "analysis_engine": mode_config["analysis_engine"],
                    "image_count": len(image_urls),
                    "is_multi_view": is_multi_view,
                    "execution_mode": (
                        mode_config["execution_mode"]
                        if mode_config["execution_mode"] == "custom"
                        else _normalize_execution_mode(mode_config["execution_mode"])
                    ),
                    "notes": (notes or "").strip(),
                    "prompt_source": (
                        "model_prompts.active(gemini)"
                        if analysis_mode == "custom"
                        else (
                            f"backend/worker.py::_build_food_prompt_db_first({_normalize_execution_mode(mode_config['execution_mode'])})"
                            if mode_config["analysis_engine"] == "db_first"
                            else f"backend/worker.py::_build_food_prompt({_normalize_execution_mode(mode_config['execution_mode'])})"
                        )
                    ),
                    "response_duration_ms": duration_ms,
                    **prompt_meta,
                },
                "evaluation": calculate_item_weight_evaluation([], expected_items or []),
                "error": str(e),
            }

    return await asyncio.gather(*(
        run_one(model, analysis_mode, selected_prompt_id)
        for model in models
        for analysis_mode in run_analysis_modes
        for selected_prompt_id in (
            custom_prompt_ids if analysis_mode == "custom" and custom_prompt_ids else [None]
        )
    ))


def _build_test_backend_batch_progress(batch: Dict[str, Any]) -> Dict[str, Any]:
    total = len(batch["items"])
    completed = sum(1 for item in batch["items"] if item["status"] == "done")
    failed = sum(1 for item in batch["items"] if item["status"] == "failed")
    processed = completed + failed
    current_item = next((item for item in batch["items"] if item["status"] == "processing"), None)
    percent = round((processed / total) * 100, 1) if total else 0.0
    return {
        "total": total,
        "processed": processed,
        "completed": completed,
        "failed": failed,
        "percent": percent,
        "current_file": current_item["filename"] if current_item else None,
    }


def _serialize_test_backend_batch(batch: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "success": True,
        "batch_id": batch["batch_id"],
        "status": batch["status"],
        "datasetId": batch.get("datasetId"),
        "datasetName": batch.get("datasetName"),
        "models": batch.get("models") or [],
        "analysisModes": batch.get("analysis_modes") or [],
        "promptId": batch.get("prompt_id"),
        "promptIds": batch.get("prompt_ids") or ([] if batch.get("prompt_id") is None else [batch.get("prompt_id")]),
        "promptNames": list(dict.fromkeys(
            str((meta.get("prompt_name") or "")).strip()
            for item in batch.get("items") or []
            for result in (item.get("modelResults") or [])
            for meta in [result.get("meta") or {}]
            if str((meta.get("prompt_name") or "")).strip()
        )),
        "summary": batch["summary"],
        "progress": _build_test_backend_batch_progress(batch),
        "items": [
            {
                "filename": item["filename"],
                "trueWeight": item["trueWeight"],
                "labelMode": item.get("labelMode") or _infer_test_backend_label_mode(item.get("expectedItems")),
                "expectedItems": item.get("expectedItems") or [],
                "status": item["status"],
                "estimatedWeight": item.get("estimatedWeight"),
                "deviation": item.get("deviation"),
                "modelResults": item.get("modelResults") or [],
                "description": item.get("description"),
                "insight": item.get("insight"),
                "pfc_ratio_comment": item.get("pfc_ratio_comment"),
                "absorption_notes": item.get("absorption_notes"),
                "context_advice": item.get("context_advice"),
                "items": item.get("items"),
                "error": item.get("error"),
            }
            for item in batch["items"]
        ],
    }


async def _process_test_backend_batch(batch_id: str) -> None:
    batch = _test_backend_batches.get(batch_id)
    if not batch:
        return

    batch["status"] = "running"
    for item in batch["items"]:
        item["status"] = "processing"
        try:
            image_url = item.get("imageUrl")
            if not image_url:
                image_bytes = base64.b64decode(item.pop("imageBytesB64"))
                mime_type = mimetypes.guess_type(item["filename"])[0] or "image/jpeg"
                data_uri = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('utf-8')}"
                image_url = await asyncio.to_thread(upload_food_analyze_image, data_uri)
            model_results = await _run_test_backend_multi_model_analysis(
                image_urls=[image_url],
                filename=item["filename"],
                models=batch.get("models") or ["qwen"],
                notes=batch.get("notes", ""),
                is_multi_view=batch.get("is_multi_view", False),
                analysis_modes=batch.get("analysis_modes") or list(DEFAULT_TEST_BACKEND_ANALYSIS_MODES),
                prompt_id=batch.get("prompt_id"),
                prompt_ids=batch.get("prompt_ids") or [],
                expected_items=item.get("expectedItems") or [],
            )
            first_success = next((result for result in model_results if result.get("success")), None)
            result = (first_success or {}).get("data") or {}
            meta = (first_success or {}).get("meta") or {}
            item.update({
                "status": "done" if first_success else "failed",
                "estimatedWeight": meta.get("estimated_weight"),
                "deviation": meta.get("deviation"),
                "modelResults": model_results,
                "description": result.get("description"),
                "insight": result.get("insight"),
                "pfc_ratio_comment": result.get("pfc_ratio_comment"),
                "absorption_notes": result.get("absorption_notes"),
                "context_advice": result.get("context_advice"),
                "items": result.get("items"),
                "error": None if first_success else "所有模型均分析失败",
            })
        except Exception as e:
            error_message = e.detail if isinstance(e, HTTPException) else str(e)
            item.update({
                "status": "failed",
                "error": error_message,
            })

    batch["status"] = "completed" if all(item["status"] == "done" for item in batch["items"]) else "failed"


@router.post("/api/test-backend/analyze")
async def test_backend_analyze(
    images: List[UploadFile] = File(...),
    notes: Optional[str] = Form(default=""),
    reference_weight: Optional[float] = Form(default=None),
    expected_items_json: Optional[str] = Form(default=""),
    models: Optional[str] = Form(default=""),
    analysis_modes: Optional[str] = Form(default=""),
    execution_mode: Optional[str] = Form(default="standard"),
    analysis_engines: Optional[str] = Form(default=""),
    prompt_id: Optional[int] = Form(default=None),
    prompt_ids: Optional[str] = Form(default=""),
    is_multi_view: bool = Form(default=False),
    _auth: None = Depends(require_test_backend_auth),
):
    """
    测试后台专用食物分析接口。
    行为尽量与小程序拍照分析一致，但走独立接口，不复用小程序提交任务接口。
    """
    if not images:
        raise HTTPException(status_code=400, detail="请至少上传 1 张图片")
    if len(images) > 3:
        raise HTTPException(status_code=400, detail="最多上传 3 张图片")

    if len(images) > 1 and not is_multi_view:
        raise HTTPException(status_code=400, detail="多张图片分析请开启多视角辅助模式")

    selected_models = _parse_test_backend_models(models)
    selected_analysis_modes = _resolve_test_backend_analysis_modes(
        analysis_modes,
        execution_mode,
        analysis_engines,
    )
    selected_prompt_ids = _parse_test_backend_prompt_ids(prompt_ids, prompt_id)
    expected_items = _parse_expected_items_input(expected_items_json, reference_weight=reference_weight)
    image_urls, _image_bytes, first_name = await _upload_test_backend_images(images)

    try:
        model_results = await _run_test_backend_multi_model_analysis(
            image_urls=image_urls,
            filename=first_name,
            models=selected_models,
            notes=notes or "",
            is_multi_view=is_multi_view,
            analysis_modes=selected_analysis_modes,
            prompt_id=prompt_id,
            prompt_ids=selected_prompt_ids,
            expected_items=expected_items,
        )
        first_success = next((item for item in model_results if item.get("success")), None)
        return {
            "success": True,
            "data": (first_success or {}).get("data"),
            "meta": (first_success or {}).get("meta") or {
                "image_count": len(images),
                "analysis_mode": selected_analysis_modes[0] if selected_analysis_modes else "legacy_direct",
                "prompt_source": "model_prompts.active(gemini)",
            },
            "models": model_results,
            "analysisModes": selected_analysis_modes,
            "promptIds": selected_prompt_ids,
            "labelMode": _infer_test_backend_label_mode(expected_items),
            "expectedItems": expected_items,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[test-backend/analyze] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


@router.get("/api/test-backend/datasets")
async def test_backend_list_datasets(
    _auth: None = Depends(require_test_backend_auth),
):
    """列出可复用测试集。"""
    try:
        rows = await list_test_backend_datasets()
        return {"success": True, "data": [_serialize_test_backend_dataset(row) for row in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取测试集失败: {str(e)}")


@router.post("/api/test-backend/datasets/import-local")
async def test_backend_import_local_dataset(
    body: TestBackendLocalDatasetImportRequest,
    _auth: None = Depends(require_test_backend_auth),
):
    """从服务器本机目录导入一个可复用测试集并持久化到云端。"""
    dataset_name = (body.name or "").strip()
    if not dataset_name:
        raise HTTPException(status_code=400, detail="测试集名称不能为空")

    scan_result = _scan_test_backend_local_dataset_dir((body.source_dir or "").strip())
    items = scan_result["items"]
    if not items:
        raise HTTPException(status_code=400, detail="该目录下没有可导入的已标注样本")

    uploaded_items = []
    for item in items:
        extension = os.path.splitext(item["filename"])[1] or ".jpg"
        mime_type = mimetypes.guess_type(item["filename"])[0] or "image/jpeg"
        image_url = await asyncio.to_thread(
            upload_food_analyze_image_bytes,
            item["imageBytes"],
            extension,
            mime_type,
        )
        uploaded_items.append({
            "filename": item["filename"],
            "imageUrl": image_url,
            "trueWeight": item["trueWeight"],
            "labelMode": item["labelMode"],
            "expectedItems": item["expectedItems"],
            "sortOrder": item["sortOrder"],
        })

    dataset = await create_test_backend_dataset({
        "name": dataset_name,
        "description": (body.description or "").strip(),
        "source_type": "local_import",
        "source_ref": scan_result["sourceDir"],
        "cover_image_url": uploaded_items[0]["imageUrl"] if uploaded_items else None,
        "item_count": scan_result["labeledCount"],
        "labeled_count": scan_result["labeledCount"],
        "unlabeled_count": 0,
        "metadata": {
            "skipped": scan_result["skipped"],
        },
    })

    await insert_test_backend_dataset_items([
        {
            "dataset_id": dataset["id"],
            "filename": item["filename"],
            "image_url": item["imageUrl"],
            "label_mode": item["labelMode"],
            "true_weight": item["trueWeight"],
            "expected_items": item["expectedItems"],
            "sort_order": item["sortOrder"],
        }
        for item in uploaded_items
    ])

    return {
        "success": True,
        "dataset": _serialize_test_backend_dataset(dataset),
        "summary": {
            "imported": len(uploaded_items),
            "skipped": scan_result["skipped"],
        },
    }


@router.post("/api/test-backend/datasets/{dataset_id}/prepare")
async def test_backend_prepare_dataset_batch(
    dataset_id: str,
    _auth: None = Depends(require_test_backend_auth),
):
    """从已保存测试集创建一个新的批次。"""
    dataset = await get_test_backend_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="测试集不存在")
    dataset_items = await list_test_backend_dataset_items(dataset_id)
    if not dataset_items:
        raise HTTPException(status_code=400, detail="测试集内没有可处理样本")

    batch = _build_test_backend_batch_from_dataset(dataset, dataset_items)
    _test_backend_batches[batch["batch_id"]] = batch
    return _serialize_test_backend_batch(batch)


@router.post("/api/test-backend/batch/prepare")
async def test_backend_batch_prepare(
    file: UploadFile = File(...),
    _auth: None = Depends(require_test_backend_auth),
):
    """准备测试后台批量任务：解析 ZIP 和 labels.txt，返回待处理清单。"""
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传 ZIP 文件")

    zip_bytes = await file.read()
    if len(zip_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小超过限制（最大 50MB）")

    batch_processor, _ = _get_test_processors()
    try:
        images, labels = batch_processor._extract_zip(zip_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not images:
        raise HTTPException(status_code=400, detail="ZIP 文件中没有找到有效的图片文件")
    if not labels:
        raise HTTPException(status_code=400, detail="ZIP 文件中缺少 labels.txt 文件")

    items = []
    skipped = []
    for filename, label in labels.items():
        image_bytes = images.get(filename)
        if not image_bytes:
            skipped.append(filename)
            continue
        true_weight = float(label.get("trueWeight") or 0) if isinstance(label, dict) else float(label or 0)
        expected_items = label.get("expectedItems") if isinstance(label, dict) else normalize_expected_items(None, true_weight)
        label_mode = label.get("labelMode") if isinstance(label, dict) else _infer_test_backend_label_mode(expected_items)
        items.append({
            "filename": filename,
            "trueWeight": true_weight,
            "labelMode": label_mode,
            "expectedItems": expected_items,
            "status": "pending",
            "imageBytesB64": base64.b64encode(image_bytes).decode("utf-8"),
            "estimatedWeight": None,
            "deviation": None,
            "modelResults": [],
            "description": None,
            "insight": None,
            "pfc_ratio_comment": None,
            "absorption_notes": None,
            "context_advice": None,
            "items": None,
            "error": None,
        })

    unlabeled_images = [filename for filename in images.keys() if filename not in labels]
    skipped.extend(unlabeled_images)

    if not items:
        raise HTTPException(status_code=400, detail="没有找到可处理的图片和标签匹配项")

    batch_id = secrets.token_hex(12)
    batch = {
        "batch_id": batch_id,
        "status": "pending",
        "notes": "",
        "is_multi_view": False,
        "prompt_id": None,
        "prompt_ids": [],
        "models": [TEST_BACKEND_MODEL_FLASH],
        "analysis_modes": list(DEFAULT_TEST_BACKEND_ANALYSIS_MODES),
        "items": items,
        "summary": {
            "total": len(items),
            "pending": len(items),
            "skipped": skipped,
        },
    }
    _test_backend_batches[batch_id] = batch
    return _serialize_test_backend_batch(batch)


@router.post("/api/test-backend/batch/start")
async def test_backend_batch_start(
    batch_id: str = Form(...),
    notes: Optional[str] = Form(default=""),
    is_multi_view: bool = Form(default=False),
    models: Optional[str] = Form(default=""),
    analysis_modes: Optional[str] = Form(default=""),
    execution_mode: Optional[str] = Form(default="standard"),
    analysis_engines: Optional[str] = Form(default=""),
    prompt_id: Optional[int] = Form(default=None),
    prompt_ids: Optional[str] = Form(default=""),
    _auth: None = Depends(require_test_backend_auth),
):
    """启动测试后台批量任务。"""
    batch = _test_backend_batches.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批量任务不存在")
    if batch["status"] == "running":
        return _serialize_test_backend_batch(batch)
    if batch["status"] in {"completed", "failed"}:
        return _serialize_test_backend_batch(batch)

    batch["notes"] = (notes or "").strip()
    batch["is_multi_view"] = is_multi_view
    batch["models"] = _parse_test_backend_models(models)
    batch["analysis_modes"] = _resolve_test_backend_analysis_modes(
        analysis_modes,
        execution_mode,
        analysis_engines,
    )
    batch["prompt_id"] = prompt_id
    batch["prompt_ids"] = _parse_test_backend_prompt_ids(prompt_ids, prompt_id)
    batch["status"] = "running"
    asyncio.create_task(_process_test_backend_batch(batch_id))
    return _serialize_test_backend_batch(batch)


@router.get("/api/test-backend/batch/{batch_id}")
async def test_backend_batch_status(
    batch_id: str,
    _auth: None = Depends(require_test_backend_auth),
):
    """获取测试后台批量任务状态。"""
    batch = _test_backend_batches.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批量任务不存在")
    return _serialize_test_backend_batch(batch)


@router.post("/api/test/batch-upload")
async def test_batch_upload(
    file: UploadFile = File(...),
    _auth: None = Depends(require_test_backend_auth)
):
    """
    批量测试：上传 ZIP 文件进行食物分析对比（需要登录）
    
    ZIP 文件应包含：
    - 多张食物图片（jpg, jpeg, png）
    - labels.txt 标签文件，格式：文件名 重量g（每行一条）
    """
    # 验证文件类型
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="请上传 ZIP 文件")
    
    # 读取文件内容
    try:
        zip_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"文件读取失败: {str(e)}")
    
    # 文件大小限制（50MB）
    if len(zip_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小超过限制（最大 50MB）")
    
    # 处理批量分析
    batch_processor, _ = _get_test_processors()
    
    try:
        result = await batch_processor.process_zip(zip_bytes)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[test/batch-upload] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


@router.post("/api/test/single-image")
async def test_single_image(
    image: UploadFile = File(...),
    trueWeight: float = Form(...),
    _auth: None = Depends(require_test_backend_auth)
):
    """
    单张图片测试：上传图片和真实重量进行食物分析对比（需要登录）
    """
    # 验证文件类型
    valid_types = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    if image.content_type not in valid_types:
        raise HTTPException(status_code=400, detail="请上传有效的图片文件（jpg, png, gif, webp）")
    
    # 验证重量
    if trueWeight <= 0:
        raise HTTPException(status_code=400, detail="真实重量必须大于 0")
    
    # 读取图片内容
    try:
        image_bytes = await image.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"图片读取失败: {str(e)}")
    
    # 文件大小限制（10MB）
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片大小超过限制（最大 10MB）")
    
    # 处理单张图片分析
    _, single_processor = _get_test_processors()
    
    try:
        result = await single_processor.analyze_image(
            image_bytes=image_bytes,
            true_weight=trueWeight,
            filename=image.filename or "uploaded_image.jpg"
        )
        return {"success": True, "data": result}
    except Exception as e:
        print(f"[test/single-image] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


# 测试后台页面路由
@router.get("/test-backend/login", response_class=HTMLResponse)
async def test_backend_login_page():
    """测试后台登录页面"""
    html_path = os.path.join(BACKEND_DIR, "static", "test_backend", "login.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    raise HTTPException(status_code=404, detail="登录页面不存在")


@router.get("/test-backend", response_class=HTMLResponse)
async def test_backend_page(test_backend_token: str = Cookie(None)):
    """测试后台页面（需要登录）"""
    # 检查登录状态
    if not _verify_test_backend_auth(test_backend_token):
        return RedirectResponse(url="/test-backend/login", status_code=302)
    
    html_path = os.path.join(BACKEND_DIR, "static", "test_backend", "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    raise HTTPException(status_code=404, detail="测试后台页面不存在")


