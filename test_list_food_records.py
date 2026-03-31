#!/usr/bin/env python3
"""
直接测试 list_food_records 函数
"""
import os
import asyncio
import sys

# 添加backend到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
load_dotenv()

CHINA_TZ = ZoneInfo("Asia/Shanghai")

async def test_list_food_records():
    from database import list_food_records, get_user_by_id
    
    # 锦恢的 user_id
    user_id = "8826bc8d-81ad-40a4-bc42-6cc30506b8c3"
    target_date = "2026-03-30"
    
    print(f"测试用户: 锦恢 ({user_id})")
    print(f"查询日期: {target_date}")
    print()
    
    # 测试1: 直接调用 list_food_records
    print("=" * 60)
    print("测试 list_food_records 函数:")
    print("=" * 60)
    
    try:
        records = await list_food_records(user_id=user_id, date=target_date, limit=100)
        print(f"返回记录数: {len(records)}")
        
        for i, r in enumerate(records, 1):
            print(f"\n记录 {i}:")
            print(f"  ID: {r.get('id')}")
            print(f"  user_id: {r.get('user_id')}")
            print(f"  record_time: {r.get('record_time')}")
            print(f"  total_calories: {r.get('total_calories')}")
            print(f"  meal_type: {r.get('meal_type')}")
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()
    
    # 测试2: 检查时间计算
    print("\n" + "=" * 60)
    print("时间计算验证:")
    print("=" * 60)
    
    start_local = datetime.strptime(target_date, "%Y-%m-%d").replace(tzinfo=CHINA_TZ)
    end_local = (datetime.strptime(target_date, "%Y-%m-%d") + timedelta(days=1)).replace(tzinfo=CHINA_TZ)
    start_ts = start_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
    end_ts = end_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
    
    print(f"目标日期 (中国): {target_date}")
    print(f"开始时间 (UTC): {start_ts}")
    print(f"结束时间 (UTC): {end_ts}")
    
    # 测试3: 直接查询Supabase
    print("\n" + "=" * 60)
    print("直接查询Supabase:")
    print("=" * 60)
    
    from supabase import create_client, Client
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    supabase: Client = create_client(supabase_url, supabase_key)
    
    result = supabase.table("user_food_records").select("*").eq("user_id", user_id).gte("record_time", start_ts).lt("record_time", end_ts).execute()
    records = result.data or []
    print(f"直接查询返回: {len(records)} 条记录")
    for r in records:
        print(f"  - {r['record_time']} | {r['meal_type']} | {r['total_calories']} kcal")


if __name__ == "__main__":
    asyncio.run(test_list_food_records())
