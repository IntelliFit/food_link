#!/usr/bin/env python3
"""
调试脚本：查看用户"锦恢"的数据，排查30号显示全0的问题
"""
import os
import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
load_dotenv()

from supabase import create_client, Client

CHINA_TZ = ZoneInfo("Asia/Shanghai")

supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key)


async def debug_jinhui_data():
    # 1. 找到锦恢的用户信息
    print("=" * 60)
    print("1. 查找用户'锦恢'的信息")
    print("=" * 60)
    
    users_result = supabase.table("weapp_user").select("*").ilike("nickname", "%锦恢%").execute()
    users = users_result.data or []
    
    if not users:
        print("未找到用户'锦恢'")
        return
    
    user = users[0]
    user_id = user["id"]
    print(f"用户ID: {user_id}")
    print(f"昵称: {user.get('nickname', 'N/A')}")
    print(f"openid: {user.get('openid', 'N/A')[:30]}...")
    print(f"创建时间: {user.get('create_time', 'N/A')}")
    
    # 2. 查看锦恢的3月30日记录
    print("\n" + "=" * 60)
    print("2. 查询锦恢 2026-03-30 的饮食记录详情")
    print("=" * 60)
    
    target_date = "2026-03-30"
    start_local = datetime.strptime(target_date, "%Y-%m-%d").replace(tzinfo=CHINA_TZ)
    end_local = (datetime.strptime(target_date, "%Y-%m-%d") + timedelta(days=1)).replace(tzinfo=CHINA_TZ)
    start_ts = start_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
    end_ts = end_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
    
    print(f"查询时间范围 (UTC): {start_ts} ~ {end_ts}")
    print(f"查询时间范围 (中国时间): 2026-03-30 00:00:00 ~ 2026-03-30 23:59:59")
    
    day_records_result = supabase.table("user_food_records").select("*").eq("user_id", user_id).gte("record_time", start_ts).lt("record_time", end_ts).execute()
    day_records = day_records_result.data or []
    
    # 同时查询所有30号的记录（不限制user_id），用于排查
    all_30th_result = supabase.table("user_food_records").select("*").gte("record_time", start_ts).lt("record_time", end_ts).execute()
    all_30th_records = all_30th_result.data or []
    print(f"\n[调试] 所有用户3月30日记录数: {len(all_30th_records)}")
    for r in all_30th_records[:5]:
        print(f"  user_id: {r.get('user_id')[:8]}... | {r.get('meal_type')} | {r.get('total_calories')} kcal")
    
    print(f"\n找到 {len(day_records)} 条记录:\n")
    
    total_cal = 0
    total_protein = 0
    total_carbs = 0
    total_fat = 0
    
    for i, r in enumerate(day_records, 1):
        record_time = r.get("record_time", "N/A")
        calories = r.get("total_calories", 0)
        protein = r.get("total_protein", 0)
        carbs = r.get("total_carbs", 0)
        fat = r.get("total_fat", 0)
        meal_type = r.get("meal_type", "N/A")
        name = r.get("name", "N/A")
        hidden = r.get("hidden_from_feed", False)
        
        total_cal += float(calories or 0)
        total_protein += float(protein or 0)
        total_carbs += float(carbs or 0)
        total_fat += float(fat or 0)
        
        print(f"记录 {i}:")
        print(f"  ID: {r['id']}")
        print(f"  时间: {record_time}")
        print(f"  餐次: {meal_type}")
        print(f"  名称: {name}")
        print(f"  热量: {calories} kcal")
        print(f"  蛋白质: {protein} g")
        print(f"  碳水: {carbs} g")
        print(f"  脂肪: {fat} g")
        print(f"  hidden_from_feed: {hidden}")
        print()
    
    print(f"3月30日总计:")
    print(f"  记录数: {len(day_records)}")
    print(f"  热量: {total_cal:.1f} kcal")
    print(f"  蛋白质: {total_protein:.1f} g")
    print(f"  碳水: {total_carbs:.1f} g")
    print(f"  脂肪: {total_fat:.1f} g")
    
    # 3. 检查近7天的记录分布
    print("\n" + "=" * 60)
    print("3. 锦恢近7天记录分布")
    print("=" * 60)
    
    for offset in range(-3, 4):
        date = datetime(2026, 3, 31) + timedelta(days=offset)
        date_str = date.strftime("%Y-%m-%d")
        
        start_local = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=CHINA_TZ)
        end_local = (datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)).replace(tzinfo=CHINA_TZ)
        start_ts = start_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
        end_ts = end_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
        
        day_result = supabase.table("user_food_records").select("total_calories").eq("user_id", user_id).gte("record_time", start_ts).lt("record_time", end_ts).execute()
        day_data = day_result.data or []
        day_total = sum(float(r.get("total_calories") or 0) for r in day_data)
        
        marker = " <-- 今天" if offset == 0 else ""
        marker = " <-- 30号" if date_str == "2026-03-30" else marker
        print(f"  {date_str}: {len(day_data)} 条记录, {day_total:.0f} kcal{marker}")
    
    # 4. 检查是否有access_token记录
    print("\n" + "=" * 60)
    print("4. 检查 weapp_access_tokens 表")
    print("=" * 60)
    
    tokens_result = supabase.table("weapp_access_tokens").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(3).execute()
    tokens = tokens_result.data or []
    
    if tokens:
        print(f"找到 {len(tokens)} 个token记录:")
        for t in tokens:
            print(f"  Token: {t['token'][:20]}... | 创建时间: {t.get('created_at', 'N/A')}")
    else:
        print("没有找到token记录（可能使用其他登录方式）")
    
    # 5. 模拟后端接口返回
    print("\n" + "=" * 60)
    print("5. 模拟 /api/home/dashboard?date=2026-03-30 接口返回")
    print("=" * 60)
    
    # 获取用户目标热量
    tdee = user.get("tdee", 2000)
    targets = {
        "calorie_target": tdee or 2000,
        "protein_target": 120,
        "carbs_target": 250,
        "fat_target": 65,
    }
    
    # 计算进度
    progress = (total_cal / targets["calorie_target"] * 100) if targets["calorie_target"] else 0
    progress = min(100.0, round(progress, 1))
    
    intake_data = {
        "current": round(total_cal, 1),
        "target": round(targets["calorie_target"], 1),
        "progress": progress,
        "macros": {
            "protein": {"current": round(total_protein, 1), "target": targets["protein_target"]},
            "carbs": {"current": round(total_carbs, 1), "target": targets["carbs_target"]},
            "fat": {"current": round(total_fat, 1), "target": targets["fat_target"]},
        },
    }
    
    print("接口应返回:")
    print(f"  intakeData: {intake_data}")
    print(f"  meals: {len(day_records)} 条记录")


if __name__ == "__main__":
    asyncio.run(debug_jinhui_data())
