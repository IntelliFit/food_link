"""
代谢计算引擎：根据用户生理指标计算 BMR 与 TDEE。
当前 BMR 采用更贴近中国成人样本的毛德倩公式，再结合活动系数得到 TDEE。
"""
from typing import Literal, Optional

# 活动水平 PAL (Physical Activity Level) 系数
ACTIVITY_MULTIPLIERS = {
    "sedentary": 1.2,       # 久坐、几乎不运动
    "light": 1.375,         # 轻度活动（每周 1-3 天）
    "moderate": 1.55,       # 中度活动（每周 3-5 天）
    "active": 1.725,        # 高度活动（每周 6-7 天）
    "very_active": 1.9,     # 极高活动（体力劳动或每天训练）
}


def calculate_bmr(
    gender: Literal["male", "female"],
    weight_kg: float,
    height_cm: float,
    age_years: int,
) -> float:
    """
    使用毛德倩公式计算基础代谢率 (BMR)，单位 kcal/天。

    - 男性: BMR = (48.5 * weight(kg) + 2954.7) / 4.184
    - 女性: BMR = (41.9 * weight(kg) + 2869.1) / 4.184

    说明：
    - 当前函数保留 `height_cm` 与 `age_years` 参数是为了兼容既有调用点；
      毛德倩公式本身只使用性别与体重。
    """
    if gender == "male":
        bmr = (48.5 * weight_kg + 2954.7) / 4.184
    else:
        bmr = (41.9 * weight_kg + 2869.1) / 4.184
    return round(max(0, bmr), 1)


def calculate_tdee(bmr: float, activity_level: str) -> float:
    """
    根据 BMR 和活动水平计算每日总能量消耗 (TDEE)，单位 kcal/天。
    """
    multiplier = ACTIVITY_MULTIPLIERS.get(
        activity_level or "sedentary", ACTIVITY_MULTIPLIERS["sedentary"]
    )
    return round(bmr * multiplier, 1)


def get_age_from_birthday(birthday_str: str) -> Optional[int]:
    """
    从生日字符串 (YYYY-MM-DD) 计算当前年龄（周岁）。
    若解析失败返回 None。
    """
    from datetime import date

    if not birthday_str:
        return None
    try:
        parts = birthday_str.split("-")
        if len(parts) != 3:
            return None
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
        birth = date(y, m, d)
        today = date.today()
        age = today.year - birth.year
        if (today.month, today.day) < (birth.month, birth.day):
            age -= 1
        return max(0, age)
    except (ValueError, IndexError):
        return None
