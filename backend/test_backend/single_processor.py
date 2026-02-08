"""
单张图片测试处理器
"""
import base64
import asyncio
from typing import Dict, Any, Optional

from .utils import format_model_result


# 默认提示词（数据库未配置时使用）
DEFAULT_PROMPT = """
请作为专业的营养师分析这张食物图片。
1. 识别图中所有不同的食物单品。
2. 估算每种食物的重量（克）和详细营养成分。
3. description: 提供这顿饭的简短中文描述。
4. insight: 基于该餐营养成分的一句话健康建议。

重要：请务必使用**简体中文**返回所有文本内容。
请严格按照以下 JSON 格式返回，不要包含任何其他文本：

{
  "items": [
    {
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {
        "calories": 热量,
        "protein": 蛋白质,
        "carbs": 碳水,
        "fat": 脂肪,
        "fiber": 纤维,
        "sugar": 糖分
      }
    }
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": ""
}
""".strip()


class SingleProcessor:
    """单张图片测试处理器"""
    
    def __init__(
        self,
        analyze_with_qwen_func,
        analyze_with_gemini_func,
        build_prompt_func,
        qwen_api_key: str,
        qwen_base_url: str
    ):
        """
        初始化处理器
        
        Args:
            analyze_with_qwen_func: 千问模型分析函数
            analyze_with_gemini_func: Gemini模型分析函数
            build_prompt_func: 构建提示词的函数
            qwen_api_key: 千问 API Key
            qwen_base_url: 千问 API Base URL
        """
        self._analyze_with_qwen = analyze_with_qwen_func
        self._analyze_with_gemini = analyze_with_gemini_func
        self._build_prompt = build_prompt_func
        self.qwen_api_key = qwen_api_key
        self.qwen_base_url = qwen_base_url
    
    async def _get_prompt_for_model(self, model_type: str) -> str:
        """
        从数据库获取指定模型的提示词
        
        Args:
            model_type: 'qwen' 或 'gemini'
        
        Returns:
            提示词内容
        """
        try:
            # 延迟导入避免循环依赖
            from database import get_active_prompt
            prompt_data = await get_active_prompt(model_type)
            if prompt_data and prompt_data.get("prompt_content"):
                return prompt_data["prompt_content"]
        except Exception as e:
            print(f"[SingleProcessor] 获取 {model_type} 提示词失败: {e}")
        
        # 返回默认提示词
        return DEFAULT_PROMPT
    
    async def analyze_image(
        self,
        image_bytes: bytes,
        true_weight: float,
        filename: str = "uploaded_image.jpg"
    ) -> Dict[str, Any]:
        """
        分析单张图片
        
        Args:
            image_bytes: 图片的字节数据
            true_weight: 真实重量（克）
            filename: 图片文件名
        
        Returns:
            包含两个模型分析结果的字典
        """
        # 转换为 base64
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
        
        # 从数据库获取各自的提示词
        qwen_prompt = await self._get_prompt_for_model('qwen')
        gemini_prompt = await self._get_prompt_for_model('gemini')
        
        # 并发调用两个模型
        qwen_result = None
        gemini_result = None
        qwen_error = None
        gemini_error = None
        
        # 并发执行两个模型的分析
        async def run_qwen():
            nonlocal qwen_result, qwen_error
            try:
                # 千问需要 base64 格式带 data URI
                image_url = f"data:image/jpeg;base64,{base64_image}"
                qwen_result = await self._call_qwen_api(image_url, qwen_prompt)
            except Exception as e:
                qwen_error = str(e)
        
        async def run_gemini():
            nonlocal gemini_result, gemini_error
            try:
                gemini_result = await self._analyze_with_gemini(
                    base64_image=base64_image,
                    prompt=gemini_prompt
                )
            except Exception as e:
                gemini_error = str(e)
        
        await asyncio.gather(run_qwen(), run_gemini())
        
        # 格式化结果
        result = {
            "imageName": filename,
            "trueWeight": true_weight,
            "qwenResult": None,
            "geminiResult": None
        }
        
        if qwen_result:
            result["qwenResult"] = format_model_result(qwen_result, true_weight)
        elif qwen_error:
            result["qwenResult"] = {"error": qwen_error}
        
        if gemini_result:
            result["geminiResult"] = format_model_result(gemini_result, true_weight)
        elif gemini_error:
            result["geminiResult"] = {"error": gemini_error}
        
        return result
    
    async def _call_qwen_api(self, image_url: str, prompt: str) -> Dict[str, Any]:
        """调用千问 API"""
        import httpx
        import re
        import json
        
        api_url = f"{self.qwen_base_url}/chat/completions"
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {self.qwen_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "qwen-vl-max",
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {"type": "image_url", "image_url": {"url": image_url}}
                            ]
                        }
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.7,
                }
            )
            
            if not response.is_success:
                error_data = response.json() if response.content else {}
                error_message = (
                    error_data.get("error", {}).get("message")
                    or f"DashScope API 错误: {response.status_code}"
                )
                raise Exception(error_message)
            
            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content")
            
            if not content:
                raise Exception("千问返回了空响应")
            
            json_str = re.sub(r"```json", "", content)
            json_str = re.sub(r"```", "", json_str).strip()
            
            return json.loads(json_str)
    
