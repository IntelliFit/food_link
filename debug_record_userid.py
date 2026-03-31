#!/usr/bin/env python3
"""
检查30号记录的user_id是否匹配
"""
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
load_dotenv()

from supabase import create_client, Client

CHINA_TZ = ZoneInfo("Asia/Shanghai")

supabase_url = os.environ.get("SUPABASE_URL")
supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key)

# 1. 找到锦恢的user_id
users_result = supabase.table("weapp_user").select("id, nickname").ilike("nickname", "%锦恢%").execute()
users = users_result.data or []
if not users:
    print("未找到用户'锦恢'")
    exit(1)

jinhui_user_id = users[0]["id"]
print(f"锦恢的 user_id: {jinhui_user_id}")
print()

# 2. 查询30号的所有记录
target_date = "2026-03-30"
start_local = datetime.strptime(target_date, "%Y-%m-%d").replace(tzinfo=CHINA_TZ)
end_local = (datetime.strptime(target_date, "%Y-%m-%d") + timedelta(days=1)).replace(tzinfo=CHINA_TZ)
start_ts = start_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
end_ts = end_local.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")

print(f"查询时间范围: {start_ts} ~ {end_ts}")
print()

all_records_result = supabase.table("user_food_records").select("*").gte("record_time", start_ts).lt("record_time", end_ts).execute()
all_records = all_records_result.data or []

print(f"30号所有记录 ({len(all_records)} 条):")
print("-" * 80)

# 分组统计
from collections import Counter
user_counts = Counter()
user_calories = {}

for r in all_records:
    uid = r.get("user_id", "unknown")
    user_counts[uid] += 1
    if uid not in user_calories:
        user_calories[uid] = 0
    user_calories[uid] += float(r.get("total_calories") or 0)

# 检查锦恢的记录
jinhui_records = [r for r in all_records if r.get("user_id") == jinhui_user_id]
print(f"\n锦恢的记录 ({len(jinhui_records)} 条):")
for r in jinhui_records:
    print(f"  ID: {r['id']}")
    print(f"  user_id: {r['user_id']}")
    print(f"  时间: {r['record_time']}")
    print(f"  热量: {r['total_calories']} kcal")
    print()

# 对比user_id是否匹配
print("-" * 80)
print("\nuser_id 对比:")
print(f"  用户表中的锦恢ID: {jinhui_user_id}")
if jinhui_records:
    print(f"  记录中的user_id:  {jinhui_records[0]['user_id']}")
    print(f"  是否匹配: {jinhui_user_id == jinhui_records[0]['user_id']}")
else:
    print("  没有找到锦恢的30号记录！")
    
# 看看哪个用户有最多的30号记录
print("\n30号记录最多的用户:")
for uid, count in user_counts.most_common(5):
    # 查找昵称
    user_result = supabase.table("weapp_user").select("nickname").eq("id", uid).execute()
    user_data = user_result.data or []
    nickname = user_data[0].get("nickname", "N/A") if user_data else "N/A"
    calories = user_calories.get(uid, 0)
    print(f"  {nickname[:15]:<15} | {count} 条 | {calories:.0f} kcal")
