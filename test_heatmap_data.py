#!/usr/bin/env python3
"""
测试脚本：检查首页热力图数据
验证过去7天的每日卡路里数据是否正确返回
"""

import asyncio
import sys
import os
from datetime import datetime, timedelta

# 添加 backend 到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from backend.database import get_stats_summary

async def test_heatmap_data():
    """测试热力图数据"""
    # 使用用户ID 31 (锦恢)
    user_id = 31
    
    print(f"=== 测试用户 {user_id} 的热力图数据 ===\n")
    
    # 获取周统计数据
    stats = await get_stats_summary(user_id, 'week')
    
    print(f"TDEE: {stats.get('tdee', 'N/A')}")
    print(f"统计周期: {stats.get('start_date')} ~ {stats.get('end_date')}")
    print()
    
    # 打印每日卡路里
    daily_calories = stats.get('daily_calories', [])
    print(f"每日卡路里数据 (共 {len(daily_calories)} 条):")
    print("-" * 50)
    
    for day_data in daily_calories:
        date = day_data.get('date', 'N/A')
        calories = day_data.get('calories', 0)
        bar = "█" * int(calories / 100) if calories > 0 else "░"
        print(f"{date}: {calories:>5} kcal {bar}")
    
    print("-" * 50)
    print()
    
    # 特别检查4月1日
    april_1 = datetime(2026, 4, 1)
    april_1_str = april_1.strftime('%Y-%m-%d')
    
    print(f"=== 特别检查 {april_1_str} ===")
    
    # 查找4月1日的数据
    april_1_data = next((d for d in daily_calories if d.get('date') == april_1_str), None)
    
    if april_1_data:
        calories = april_1_data.get('calories', 0)
        print(f"✅ 找到 {april_1_str} 的数据: {calories} kcal")
        if calories > 0:
            print(f"   热量 > 0，热力图应该显示颜色")
            tdee = stats.get('tdee', 2000)
            ratio = calories / tdee if tdee > 0 else 0
            print(f"   目标热量: {tdee}, 摄入比例: {ratio:.2%}")
            if ratio >= 1.0:
                print(f"   热力图级别: 4 (达到或超过目标)")
            elif ratio >= 0.75:
                print(f"   热力图级别: 3 (75%-100%)")
            elif ratio >= 0.5:
                print(f"   热力图级别: 2 (50%-75%)")
            elif ratio >= 0.25:
                print(f"   热力图级别: 1 (25%-50%)")
            else:
                print(f"   热力图级别: 0 (< 25%)")
        else:
            print(f"   ⚠️ 热量为 0，热力图不会显示颜色")
    else:
        print(f"❌ 未找到 {april_1_str} 的数据")
    
    print()
    
    # 检查今天 (4月6日)
    today = datetime(2026, 4, 6)
    today_str = today.strftime('%Y-%m-%d')
    print(f"=== 检查今天 ({today_str}) ===")
    
    today_data = next((d for d in daily_calories if d.get('date') == today_str), None)
    if today_data:
        calories = today_data.get('calories', 0)
        print(f"今天摄入: {calories} kcal")
    else:
        print("未找到今天的数据")

if __name__ == '__main__':
    asyncio.run(test_heatmap_data())
