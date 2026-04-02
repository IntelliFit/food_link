#!/usr/bin/env python3
"""
测试脚本：直接调用后端 API 检查热力图数据
"""

import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 设置环境变量
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), 'backend', '.env'))

from datetime import datetime, timedelta
from backend.database import list_food_records_by_range, get_user_by_id

async def test_heatmap_data():
    """测试热力图数据"""
    user_id = 31  # 锦恢
    
    # 计算日期范围（过去7天）
    today = datetime.now()
    start_date = (today - timedelta(days=6)).strftime('%Y-%m-%d')
    end_date = today.strftime('%Y-%m-%d')
    
    print(f"=== 测试用户 {user_id} 的热力图数据 ===")
    print(f"日期范围: {start_date} ~ {end_date}\n")
    
    try:
        # 获取用户信息
        user = await get_user_by_id(user_id)
        tdee = (user.get("tdee") and float(user["tdee"])) or 2000
        print(f"用户 TDEE: {tdee}")
        print()
        
        # 获取记录
        records = await list_food_records_by_range(user_id, start_date, end_date)
        print(f"找到 {len(records)} 条记录\n")
        
        if records:
            print("记录详情:")
            print("-" * 80)
            for r in records:
                rt = r.get("record_time")
                cal = float(r.get("total_calories") or 0)
                print(f"  时间: {rt}, 热量: {cal}")
            print("-" * 80)
            print()
        
        # 按日期分组计算每日热量
        from backend.main import CHINA_TZ
        daily_cal = {}
        for r in records:
            rt = r.get("record_time")
            if rt:
                try:
                    from datetime import datetime as dt
                    dt_utc = dt.fromisoformat(str(rt).replace("Z", "+00:00"))
                    dt_local = dt_utc.astimezone(CHINA_TZ)
                    dt_str = dt_local.date().isoformat()
                    daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
                except Exception as e:
                    print(f"日期解析错误: {e}")
        
        # 生成完整的每日列表
        from datetime import date
        start_d = datetime.strptime(start_date, '%Y-%m-%d').date()
        end_d = datetime.strptime(end_date, '%Y-%m-%d').date()
        
        print("每日卡路里汇总:")
        print("-" * 80)
        cursor = start_d
        while cursor <= end_d:
            date_key = cursor.isoformat()
            calories = round(daily_cal.get(date_key, 0.0), 1)
            ratio = calories / tdee if tdee > 0 else 0
            
            # 计算热力图级别
            if calories > 0:
                if ratio >= 1.0:
                    level = 4
                    level_desc = "达到或超过目标"
                elif ratio >= 0.75:
                    level = 3
                    level_desc = "75%-100%"
                elif ratio >= 0.5:
                    level = 2
                    level_desc = "50%-75%"
                elif ratio >= 0.25:
                    level = 1
                    level_desc = "25%-50%"
                else:
                    level = 0
                    level_desc = "<25%"
            else:
                level = 0
                level_desc = "无记录"
            
            bar = "█" * int(calories / 100) if calories > 0 else "░"
            print(f"{date_key}: {calories:>6.1f} kcal | 比例: {ratio:>5.1%} | 级别: {level} ({level_desc}) {bar}")
            cursor += timedelta(days=1)
        
        print("-" * 80)
        
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    asyncio.run(test_heatmap_data())
