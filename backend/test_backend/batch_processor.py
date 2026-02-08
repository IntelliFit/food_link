"""
批量测试处理器（ZIP文件上传）
"""
import zipfile
import io
import asyncio
from typing import Dict, Any, List, Tuple, Callable
from concurrent.futures import ThreadPoolExecutor

from .utils import parse_labels_file, format_model_result, is_valid_image_file
from .single_processor import SingleProcessor


class BatchProcessor:
    """批量测试处理器"""
    
    def __init__(
        self,
        analyze_with_qwen_func,
        analyze_with_gemini_func,
        build_prompt_func,
        qwen_api_key: str,
        qwen_base_url: str,
        max_concurrent: int = 3  # 控制并发数，避免 API 限流
    ):
        """
        初始化批量处理器
        
        Args:
            analyze_with_qwen_func: 千问模型分析函数
            analyze_with_gemini_func: Gemini模型分析函数
            build_prompt_func: 构建提示词的函数
            qwen_api_key: 千问 API Key
            qwen_base_url: 千问 API Base URL
            max_concurrent: 最大并发数
        """
        self.single_processor = SingleProcessor(
            analyze_with_qwen_func,
            analyze_with_gemini_func,
            build_prompt_func,
            qwen_api_key,
            qwen_base_url
        )
        self.max_concurrent = max_concurrent
    
    async def process_zip(
        self,
        zip_bytes: bytes,
        progress_callback: Callable[[int, int, str], None] = None
    ) -> Dict[str, Any]:
        """
        处理 ZIP 文件
        
        Args:
            zip_bytes: ZIP 文件的字节数据
            progress_callback: 进度回调函数 (current, total, current_file)
        
        Returns:
            包含所有分析结果和汇总信息的字典
        
        Raises:
            ValueError: 当 ZIP 文件格式错误或缺少必要文件时
        """
        # 解析 ZIP 文件
        images, labels = self._extract_zip(zip_bytes)
        
        if not images:
            raise ValueError("ZIP 文件中没有找到有效的图片文件")
        
        if not labels:
            raise ValueError("ZIP 文件中缺少 labels.txt 文件")
        
        # 过滤掉没有标签的图片（跳过而不是报错）
        images_with_labels = {}
        skipped = []
        for img_name, img_bytes in images.items():
            if img_name in labels:
                images_with_labels[img_name] = img_bytes
            else:
                skipped.append(img_name)
        
        if skipped:
            print(f"[batch] 跳过无标签图片: {', '.join(skipped)}")
        
        images = images_with_labels
        
        if not images:
            raise ValueError("没有找到有标签的图片")
        
        # 批量处理图片
        results = []
        total = len(images)
        semaphore = asyncio.Semaphore(self.max_concurrent)
        
        async def process_single(img_name: str, img_bytes: bytes) -> Dict[str, Any]:
            async with semaphore:
                if progress_callback:
                    current = len(results) + 1
                    progress_callback(current, total, img_name)
                
                true_weight = labels[img_name]
                result = await self.single_processor.analyze_image(
                    img_bytes, true_weight, img_name
                )
                return result
        
        # 并发处理所有图片
        tasks = [
            process_single(img_name, img_bytes)
            for img_name, img_bytes in images.items()
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 处理结果，分离成功和失败的
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                img_name = list(images.keys())[i]
                processed_results.append({
                    "imageName": img_name,
                    "trueWeight": labels.get(img_name, 0),
                    "error": str(result)
                })
            else:
                processed_results.append(result)
        
        # 计算汇总统计
        summary = self._calculate_summary(processed_results)
        
        return {
            "success": True,
            "data": processed_results,
            "summary": summary
        }
    
    def _extract_zip(self, zip_bytes: bytes) -> Tuple[Dict[str, bytes], Dict[str, float]]:
        """
        解压 ZIP 文件，提取图片和标签
        
        Args:
            zip_bytes: ZIP 文件的字节数据
        
        Returns:
            (images_dict, labels_dict) 元组
        """
        images = {}
        labels = {}
        
        def decode_filename(file_info) -> str:
            """正确解码 ZIP 文件中的中文文件名"""
            filename = file_info.filename
            # 如果文件名标记为 UTF-8 编码（flag bit 11）
            if file_info.flag_bits & 0x800:
                return filename
            # 否则尝试用不同编码解码原始字节
            try:
                # 获取原始字节
                raw_bytes = filename.encode('cp437')
                # 优先尝试 UTF-8（macOS 常用）
                return raw_bytes.decode('utf-8')
            except (UnicodeDecodeError, UnicodeEncodeError):
                try:
                    # 尝试 GBK（Windows 中文系统常用）
                    raw_bytes = filename.encode('cp437')
                    return raw_bytes.decode('gbk')
                except (UnicodeDecodeError, UnicodeEncodeError):
                    # 保持原样
                    return filename
        
        try:
            with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as zf:
                for file_info in zf.infolist():
                    # 正确解码文件名
                    filename = decode_filename(file_info)
                    
                    # 跳过目录和隐藏文件
                    if file_info.is_dir() or filename.startswith('__MACOSX') or filename.startswith('.'):
                        continue
                    
                    # 获取文件名（去除目录路径）
                    basename = filename.split('/')[-1]
                    if not basename:
                        continue
                    
                    # 读取文件内容
                    content = zf.read(file_info.filename)  # 使用原始文件名读取
                    
                    # 判断文件类型
                    if basename.lower() == 'labels.txt':
                        # 解析标签文件
                        try:
                            labels = parse_labels_file(content.decode('utf-8'))
                        except UnicodeDecodeError:
                            # 尝试其他编码
                            labels = parse_labels_file(content.decode('gbk'))
                    elif is_valid_image_file(basename):
                        images[basename] = content
        
        except zipfile.BadZipFile:
            raise ValueError("无效的 ZIP 文件格式")
        
        return images, labels
    
    def _calculate_summary(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        计算汇总统计信息
        
        Args:
            results: 所有分析结果列表
        
        Returns:
            汇总统计字典
        """
        total_images = len(results)
        successful_count = 0
        qwen_deviations = []
        gemini_deviations = []
        
        for result in results:
            if "error" in result:
                continue
            
            successful_count += 1
            
            qwen_result = result.get("qwenResult")
            if qwen_result and "deviation" in qwen_result:
                qwen_deviations.append(qwen_result["deviation"])
            
            gemini_result = result.get("geminiResult")
            if gemini_result and "deviation" in gemini_result:
                gemini_deviations.append(gemini_result["deviation"])
        
        def calc_avg(deviations):
            if not deviations:
                return None
            return round(sum(deviations) / len(deviations), 2)
        
        def calc_median(deviations):
            if not deviations:
                return None
            sorted_devs = sorted(deviations)
            n = len(sorted_devs)
            mid = n // 2
            if n % 2 == 0:
                return round((sorted_devs[mid - 1] + sorted_devs[mid]) / 2, 2)
            return round(sorted_devs[mid], 2)
        
        return {
            "totalImages": total_images,
            "successfulCount": successful_count,
            "failedCount": total_images - successful_count,
            "qwenStats": {
                "avgDeviation": calc_avg(qwen_deviations),
                "medianDeviation": calc_median(qwen_deviations),
                "minDeviation": round(min(qwen_deviations), 2) if qwen_deviations else None,
                "maxDeviation": round(max(qwen_deviations), 2) if qwen_deviations else None,
                "sampleCount": len(qwen_deviations)
            },
            "geminiStats": {
                "avgDeviation": calc_avg(gemini_deviations),
                "medianDeviation": calc_median(gemini_deviations),
                "minDeviation": round(min(gemini_deviations), 2) if gemini_deviations else None,
                "maxDeviation": round(max(gemini_deviations), 2) if gemini_deviations else None,
                "sampleCount": len(gemini_deviations)
            }
        }
