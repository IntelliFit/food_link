#!/usr/bin/env python3
"""
调试脚本：查看用户30号的饮食记录数据
"""
import os
import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# 加载环境变量
from dotenv import load_dotenv
load_dotenv()

# 设置 Supabase
from supabase import create_client, Client

CHINA_TZ = ZoneInfo("Asia/Shanghai")

supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")

if not supabase_url or not supabase_key:
    print("错误：未配置 SUPABASE_URL 或 SUPABASE_KEY")
    exit(1)

supabase: Client = create_client(supabase_url, supabase_key)


async def debug_user_data():
    # 1. 查找所有用户并检查谁有3月30日的记录
    print("=" * 60)
    print("1. 查找所有用户及3月30日记录情况")
    print("=" * 60)
    
    users_result = supabase.table("weapp_user").select("id, nickname, openid").limit(20).execute()
    users = users_result.data or []
    
    if not users:
        print("未找到任何用户")
        return
    
    # 3月30日的时间范围
    target_date = "2026-03-30"
    start_local = datetime.strptime(target_date, "%Y-%m-%d").replace(tzinfo=CHINA_TZ)
    end_local = (datetime.strptime(target_date, "%Y-%m-%d") + timedelta(days=1)).replace(tzinfo=CHINA_TZ)
    start_ts = start_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
    end_ts = end_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
    
    users_with_30th_data = []
    
    for u in users:
        user_id = u['id']
        day_records_result = supabase.table("user_food_records").select("*").eq("user_id", user_id).gte("record_time", start_ts).lt("record_time", end_ts).execute()
        day_records = day_records_result.data or []
        total_cal = sum(float(r.get("total_calories") or 0) for r in day_records)
        print(f"  用户: {u.get('nickname', 'N/A')[:12]:<12} | 3/30记录数: {len(day_records):>2} | 总热量: {total_cal:>6.0f} kcal")
        if len(day_records) > 0:
            users_with_30th_data.append((u, day_records))
    
    # 使用有30号数据的第一个用户进行详细调试，如果没有则使用第一个用户
    if users_with_30th_data:
        user, _ = users_with_30th_data[0]
        user_id = user["id"]
        print(f"\n找到有3/30数据的用户: {user.get('nickname', 'N/A')}")
    else:
        user = users[0]
        user_id = user["id"]
        print(f"\n没有用户有3/30数据，使用第一个用户: {user.get('nickname', 'N/A')}")
    
    print(f"用户ID: {user_id}")
    
    # 2. 查看用户最近的饮食记录（不限制日期）
    print("\n" + "=" * 60)
    print("2. 用户最近的饮食记录（不限日期）")
    print("=" * 60)
    
    records_result = supabase.table("user_food_records").select("*").eq("user_id", user_id).order("record_time", desc=True).limit(10).execute()
    records = records_result.data or []
    
    if not records:
        print("  该用户没有任何饮食记录")
    else:
        for r in records:
            record_time = r.get("record_time", "N/A")
            calories = r.get("total_calories", 0)
            meal_type = r.get("meal_type", "N/A")
            print(f"  {record_time} | {meal_type} | {calories} kcal")
    
    # 3. 专门查询3月30日的记录
    print("\n" + "=" * 60)
    print("3. 查询 2026-03-30 的饮食记录")
    print("=" * 60)
    
    target_date = "2026-03-30"
    start_local = datetime.strptime(target_date, "%Y-%m-%d").replace(tzinfo=CHINA_TZ)
    end_local = (datetime.strptime(target_date, "%Y-%m-%d") + timedelta(days=1)).replace(tzinfo=CHINA_TZ)
    start_ts = start_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
    end_ts = end_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
    
    print(f"  查询时间范围:")
    print(f"    开始: {start_ts}")
    print(f"    结束: {end_ts}")
    
    day_records_result = supabase.table("user_food_records").select("*").eq("user_id", user_id).gte("record_time", start_ts).lt("record_time", end_ts).execute()
    day_records = day_records_result.data or []
    
    print(f"\n  找到 {len(day_records)} 条记录:")
    
    total_cal = 0
    total_protein = 0
    total_carbs = 0
    total_fat = 0
    
    for r in day_records:
        record_time = r.get("record_time", "N/A")
        calories = r.get("total_calories", 0)
        protein = r.get("total_protein", 0)
        carbs = r.get("total_carbs", 0)
        fat = r.get("total_fat", 0)
        meal_type = r.get("meal_type", "N/A")
        
        total_cal += float(calories or 0)
        total_protein += float(protein or 0)
        total_carbs += float(carbs or 0)
        total_fat += float(fat or 0)
        
        print(f"  - {record_time} | {meal_type} | {calories} kcal | 蛋白质:{protein}g 碳水:{carbs}g 脂肪:{fat}g")
    
    print(f"\n  3月30日总计:")
    print(f"    热量: {total_cal:.1f} kcal")
    print(f"    蛋白质: {total_protein:.1f} g")
    print(f"    碳水: {total_carbs:.1f} g")
    print(f"    脂肪: {total_fat:.1f} g")
    
    # 4. 也检查一下31号（今天）的数据
    print("\n" + "=" * 60)
    print("4. 查询 2026-03-31 (今天) 的饮食记录")
    print("=" * 60)
    
    today_date = "2026-03-31"
    start_local_today = datetime.strptime(today_date, "%Y-%m-%d").replace(tzinfo=CHINA_TZ)
    end_local_today = (datetime.strptime(today_date, "%Y-%m-%d") + timedelta(days=1)).replace(tzinfo=CHINA_TZ)
    start_ts_today = start_local_today.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
    end_ts_today = end_local_today.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
    
    today_records_result = supabase.table("user_food_records").select("*").eq("user_id", user_id).gte("record_time", start_ts_today).lt("record_time", end_ts_today).execute()
    today_records = today_records_result.data or []
    
    print(f"  找到 {len(today_records)} 条记录")
    
    # 5. 检查 hidden_from_feed 字段
    print("\n" + "=" * 60)
    print("5. 检查记录的 hidden_from_feed 字段")
    print("=" * 60)
    
    all_user_records = supabase.table("user_food_records").select("id, record_time, hidden_from_feed").eq("user_id", user_id).limit(5).execute()
    all_records = all_user_records.data or []
    
    for r in all_records:
        hidden = r.get("hidden_from_feed", False)
        print(f"  {r['id'][:8]}... | {r.get('record_time', 'N/A')} | hidden={hidden}")


if __name__ == "__main__":
    asyncio.run(debug_user_data())
