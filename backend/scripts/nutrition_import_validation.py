"""Validation for normalized incoming library rows; never updates meal history."""
import math


def validate_per100g_values(values: dict) -> None:
    for key, value in values.items():
        if key.endswith("_per_100g") and (not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0):
            raise ValueError(f"{key}必须有限且非负")
    if sum(values.get(key, 0) for key in ["protein_per_100g", "carbs_per_100g", "fat_per_100g"]) > 102:
        raise ValueError("每100g三大营养素合计超过102g")
    if values.get("sugar_per_100g", 0) > values.get("carbs_per_100g", 0) + .2:
        raise ValueError("糖超过碳水化合物")
    if values.get("saturated_fat_per_100g", 0) > values.get("fat_per_100g", 0) + .2:
        raise ValueError("饱和脂肪超过总脂肪")
    if values.get("kcal_per_100g", 0) > 918:
        raise ValueError("每100g热量超过质量上限")
