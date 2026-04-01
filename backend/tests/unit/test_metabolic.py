"""
代谢计算引擎单元测试
测试 BMR、TDEE 计算和年龄计算功能
"""
import pytest
from datetime import date
from metabolic import (
    calculate_bmr,
    calculate_tdee,
    get_age_from_birthday,
    ACTIVITY_MULTIPLIERS,
)


class TestBMRCalculation:
    """基础代谢率 (BMR) 计算测试"""
    
    def test_calculate_bmr_male(self):
        """测试男性 BMR 计算（毛德倩公式）"""
        # 男性: BMR = (48.5 * weight + 2954.7) / 4.184
        # 70kg 男性: (48.5 * 70 + 2954.7) / 4.184 = (3395 + 2954.7) / 4.184 ≈ 1520.0
        bmr = calculate_bmr(gender="male", weight_kg=70, height_cm=175, age_years=30)
        
        assert bmr > 0
        # 验证公式计算结果
        expected = round((48.5 * 70 + 2954.7) / 4.184, 1)
        assert bmr == expected
    
    def test_calculate_bmr_female(self):
        """测试女性 BMR 计算（毛德倩公式）"""
        # 女性: BMR = (41.9 * weight + 2869.1) / 4.184
        # 55kg 女性: (41.9 * 55 + 2869.1) / 4.184 = (2304.5 + 2869.1) / 4.184 ≈ 1236.5
        bmr = calculate_bmr(gender="female", weight_kg=55, height_cm=160, age_years=25)
        
        assert bmr > 0
        # 验证公式计算结果
        expected = round((41.9 * 55 + 2869.1) / 4.184, 1)
        assert bmr == expected
    
    def test_calculate_bmr_different_weights(self):
        """测试不同体重的 BMR 计算"""
        test_cases = [
            ("male", 50, 1285.8),   # 轻体重男性: (48.5 * 50 + 2954.7) / 4.184
            ("male", 70, 1517.6),   # 标准体重男性: (48.5 * 70 + 2954.7) / 4.184
            ("male", 100, 1865.4),  # 重体重男性: (48.5 * 100 + 2954.7) / 4.184
            ("female", 45, 1136.4), # 轻体重女性: (41.9 * 45 + 2869.1) / 4.184
            ("female", 55, 1236.5), # 标准体重女性: (41.9 * 55 + 2869.1) / 4.184
            ("female", 70, 1386.7), # 重体重女性: (41.9 * 70 + 2869.1) / 4.184
        ]
        
        for gender, weight, expected in test_cases:
            bmr = calculate_bmr(gender=gender, weight_kg=weight, height_cm=170, age_years=30)
            assert abs(bmr - expected) < 1.0, f"{gender} {weight}kg 的 BMR 计算错误，实际 {bmr}"
    
    def test_calculate_bmr_zero_weight(self):
        """测试体重为 0 的 BMR 计算"""
        bmr = calculate_bmr(gender="male", weight_kg=0, height_cm=170, age_years=30)
        
        # BMR = (48.5 * 0 + 2954.7) / 4.184 = 706.2，为正数
        expected = round((48.5 * 0 + 2954.7) / 4.184, 1)
        assert bmr == expected
    
    def test_calculate_bmr_negative_weight(self):
        """测试负体重的 BMR 计算"""
        bmr = calculate_bmr(gender="male", weight_kg=-10, height_cm=170, age_years=30)
        
        # BMR = (48.5 * -10 + 2954.7) / 4.184 = 590.3，为正数
        expected = round((48.5 * -10 + 2954.7) / 4.184, 1)
        assert bmr == expected
    
    def test_calculate_bmr_height_and_age_ignored(self):
        """测试身高和年龄参数被忽略（毛德倩公式不使用这些参数）"""
        # 相同的体重和性别，不同的身高和年龄，BMR 应该相同
        bmr1 = calculate_bmr(gender="male", weight_kg=70, height_cm=150, age_years=20)
        bmr2 = calculate_bmr(gender="male", weight_kg=70, height_cm=190, age_years=60)
        
        assert bmr1 == bmr2


class TestTDEECalculation:
    """每日总能量消耗 (TDEE) 计算测试"""
    
    def test_calculate_tdee_sedentary(self):
        """测试久坐活动水平的 TDEE"""
        bmr = 1500
        tdee = calculate_tdee(bmr, "sedentary")
        
        expected = round(bmr * 1.2, 1)
        assert tdee == expected
    
    def test_calculate_tdee_light(self):
        """测试轻度活动的 TDEE"""
        bmr = 1500
        tdee = calculate_tdee(bmr, "light")
        
        expected = round(bmr * 1.375, 1)
        assert tdee == expected
    
    def test_calculate_tdee_moderate(self):
        """测试中度活动的 TDEE"""
        bmr = 1500
        tdee = calculate_tdee(bmr, "moderate")
        
        expected = round(bmr * 1.55, 1)
        assert tdee == expected
    
    def test_calculate_tdee_active(self):
        """测试高度活动的 TDEE"""
        bmr = 1500
        tdee = calculate_tdee(bmr, "active")
        
        expected = round(bmr * 1.725, 1)
        assert tdee == expected
    
    def test_calculate_tdee_very_active(self):
        """测试极高活动的 TDEE"""
        bmr = 1500
        tdee = calculate_tdee(bmr, "very_active")
        
        expected = round(bmr * 1.9, 1)
        assert tdee == expected
    
    def test_calculate_tdee_invalid_activity_level(self):
        """测试无效活动水平的 TDEE（应使用默认值 sedentary）"""
        bmr = 1500
        tdee = calculate_tdee(bmr, "invalid_level")
        
        # 应该使用默认值 1.2
        expected = round(bmr * 1.2, 1)
        assert tdee == expected
    
    def test_calculate_tdee_none_activity_level(self):
        """测试 None 活动水平的 TDEE"""
        bmr = 1500
        tdee = calculate_tdee(bmr, None)
        
        # 应该使用默认值 1.2
        expected = round(bmr * 1.2, 1)
        assert tdee == expected
    
    def test_calculate_tdee_zero_bmr(self):
        """测试 BMR 为 0 的 TDEE"""
        tdee = calculate_tdee(0, "moderate")
        
        assert tdee == 0


class TestActivityMultipliers:
    """活动水平系数测试"""
    
    def test_activity_multipliers_defined(self):
        """测试活动水平系数已定义"""
        expected_levels = ["sedentary", "light", "moderate", "active", "very_active"]
        
        for level in expected_levels:
            assert level in ACTIVITY_MULTIPLIERS
            assert ACTIVITY_MULTIPLIERS[level] > 0
    
    def test_activity_multiplier_values(self):
        """测试活动水平系数值"""
        assert ACTIVITY_MULTIPLIERS["sedentary"] == 1.2
        assert ACTIVITY_MULTIPLIERS["light"] == 1.375
        assert ACTIVITY_MULTIPLIERS["moderate"] == 1.55
        assert ACTIVITY_MULTIPLIERS["active"] == 1.725
        assert ACTIVITY_MULTIPLIERS["very_active"] == 1.9


class TestAgeCalculation:
    """年龄计算测试"""
    
    def test_get_age_from_valid_birthday(self):
        """测试从有效生日计算年龄"""
        today = date.today()
        birth_year = today.year - 25
        birthday = f"{birth_year}-06-15"
        
        age = get_age_from_birthday(birthday)
        
        # 考虑生日是否已过
        if (today.month, today.day) < (6, 15):
            assert age == 24
        else:
            assert age == 25
    
    def test_get_age_from_birthday_end_of_year(self):
        """测试年末生日的年龄计算"""
        today = date.today()
        birth_year = today.year - 30
        birthday = f"{birth_year}-12-31"
        
        age = get_age_from_birthday(birthday)
        
        if (today.month, today.day) < (12, 31):
            assert age == 29
        else:
            assert age == 30
    
    def test_get_age_from_birthday_start_of_year(self):
        """测试年初生日的年龄计算"""
        today = date.today()
        birth_year = today.year - 20
        birthday = f"{birth_year}-01-01"
        
        age = get_age_from_birthday(birthday)
        
        assert age == 20
    
    def test_get_age_from_empty_birthday(self):
        """测试空生日字符串"""
        age = get_age_from_birthday("")
        
        assert age is None
    
    def test_get_age_from_none_birthday(self):
        """测试 None 生日"""
        age = get_age_from_birthday(None)
        
        assert age is None
    
    def test_get_age_from_invalid_format(self):
        """测试无效格式的生日"""
        invalid_formats = [
            "1990/01/01",  # 错误分隔符
            "01-01-1990",  # 错误顺序
            "1990-01",     # 缺少日
            "1990",        # 只有年
            "invalid",     # 完全无效
            "1990-13-01",  # 无效月份
            "1990-01-32",  # 无效日期
        ]
        
        for invalid in invalid_formats:
            age = get_age_from_birthday(invalid)
            assert age is None, f"'{invalid}' 应该返回 None"
    
    def test_get_age_from_future_birthday(self):
        """测试未来生日的年龄计算"""
        today = date.today()
        future_year = today.year + 1
        birthday = f"{future_year}-01-01"
        
        age = get_age_from_birthday(birthday)
        
        # 未来生日应该返回负数年龄，但被 max(0, age) 处理为 0
        assert age is not None
        assert age < 0 or age == 0  # 根据实际情况


class TestIntegrationBMRAndTDEE:
    """BMR 和 TDEE 集成测试"""
    
    def test_full_calculation_workflow(self):
        """测试完整的 BMR -> TDEE 计算流程"""
        # 典型男性用户
        bmr = calculate_bmr(gender="male", weight_kg=70, height_cm=175, age_years=30)
        tdee = calculate_tdee(bmr, "moderate")
        
        assert bmr > 0
        assert tdee > bmr  # TDEE 应该大于 BMR
        assert tdee == round(bmr * 1.55, 1)
    
    def test_different_profiles(self):
        """测试不同用户画像的计算"""
        profiles = [
            # (性别, 体重, 身高, 年龄, 活动水平, 描述)
            ("male", 80, 180, 35, "sedentary", "久坐男性"),
            ("female", 50, 160, 25, "light", "轻度活动女性"),
            ("male", 90, 175, 40, "very_active", "运动员男性"),
            ("female", 60, 165, 30, "moderate", "中度活动女性"),
        ]
        
        for gender, weight, height, age, activity, desc in profiles:
            bmr = calculate_bmr(gender, weight, height, age)
            tdee = calculate_tdee(bmr, activity)
            
            assert bmr > 0, f"{desc} 的 BMR 计算错误"
            assert tdee > 0, f"{desc} 的 TDEE 计算错误"
