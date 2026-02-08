"""
测试后台工具函数
"""
import re
from typing import Dict, List, Tuple, Any


def calculate_deviation(estimated_weight: float, true_weight: float) -> float:
    """
    计算偏差百分比
    
    Args:
        estimated_weight: 模型估算的重量（克）
        true_weight: 真实重量（克）
    
    Returns:
        偏差百分比（0-100之间的浮点数，保留2位小数）
    """
    if true_weight == 0:
        return 0.0 if estimated_weight == 0 else 100.0
    deviation = abs(estimated_weight - true_weight) / true_weight * 100
    return round(deviation, 2)


def parse_labels_file(content: str) -> Dict[str, float]:
    """
    解析标签文件内容
    
    标签文件格式：
        apple.jpg 50g
        banana.jpg 120g
        rice.jpg 200g
    
    Args:
        content: 标签文件的文本内容
    
    Returns:
        字典，键为图片文件名，值为真实重量（克）
    
    Raises:
        ValueError: 当标签格式无效时
    """
    labels = {}
    lines = content.strip().split('\n')
    
    for line_num, line in enumerate(lines, 1):
        line = line.strip()
        if not line:
            continue
        
        # 支持多种分隔符：空格、制表符
        parts = re.split(r'\s+', line)
        
        if len(parts) < 2:
            raise ValueError(f"第 {line_num} 行格式错误：'{line}'，应为 '文件名 重量g'")
        
        # 从最后一个部分取重量（处理文件名包含空格的情况）
        weight_str = parts[-1]
        # 文件名是除最后一个部分外的所有部分重新拼接
        filename = ' '.join(parts[:-1])
        
        # 解析重量，支持多种格式：50g, 50G, 50, 50.5g
        weight_match = re.match(r'^(\d+(?:\.\d+)?)\s*[gG]?$', weight_str)
        if not weight_match:
            raise ValueError(f"第 {line_num} 行重量格式错误：'{weight_str}'，应为数字或数字g")
        
        weight = float(weight_match.group(1))
        labels[filename] = weight
    
    return labels


def extract_total_weight(items: List[Dict[str, Any]]) -> float:
    """
    从模型分析结果中提取总重量
    
    Args:
        items: 模型返回的食物列表
    
    Returns:
        所有食物的总重量（克）
    """
    total = 0.0
    if isinstance(items, list):
        for item in items:
            weight = item.get("estimatedWeightGrams", 0) or 0
            total += float(weight)
    return round(total, 1)


def format_model_result(parsed: Dict[str, Any], true_weight: float) -> Dict[str, Any]:
    """
    格式化模型分析结果
    
    Args:
        parsed: 模型返回的原始解析结果
        true_weight: 真实重量
    
    Returns:
        格式化后的结果字典
    """
    items = parsed.get("items", [])
    estimated_weight = extract_total_weight(items)
    deviation = calculate_deviation(estimated_weight, true_weight)
    
    # 格式化 items，提取关键信息
    formatted_items = []
    for item in items:
        formatted_items.append({
            "name": item.get("name", "未知食物"),
            "estimatedWeightGrams": float(item.get("estimatedWeightGrams", 0) or 0),
            "nutrients": item.get("nutrients", {})
        })
    
    return {
        "estimatedWeight": estimated_weight,
        "deviation": deviation,
        "items": formatted_items,
        "description": parsed.get("description", ""),
        "insight": parsed.get("insight", ""),
        "pfc_ratio_comment": parsed.get("pfc_ratio_comment", ""),
        "absorption_notes": parsed.get("absorption_notes", ""),
        "context_advice": parsed.get("context_advice", "")
    }


def is_valid_image_file(filename: str) -> bool:
    """
    检查文件是否为有效的图片文件
    
    Args:
        filename: 文件名
    
    Returns:
        是否为有效图片文件
    """
    valid_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
    ext = filename.lower().split('.')[-1] if '.' in filename else ''
    return f'.{ext}' in valid_extensions
