#!/usr/bin/env python3
"""
为测试账号（手机号 18870666046）添加好友与食物记录测试数据。
在 backend 目录下执行: python seed_test_data.py
需已配置 .env 中的 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY。
"""
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# 确保 backend 目录在 path 中并加载 .env
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))
os.chdir(backend_dir)

from dotenv import load_dotenv
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("错误: 请设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY（在 backend/.env）")
    sys.exit(1)

from supabase import create_client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

TEST_PHONE = "18870666046"

# 测试好友：openid 唯一，不与真实微信冲突
FRIEND_SEEDS = [
    {"openid": "seed_friend_1", "nickname": "测试好友小明", "avatar": ""},
    {"openid": "seed_friend_2", "nickname": "测试好友小红", "avatar": ""},
    {"openid": "seed_friend_3", "nickname": "测试好友小刚", "avatar": ""},
]

# 示例食物记录：含图片 URL 与食物明细 items（用于 Feed 与详情页）
# 图片使用公网占位图（Unsplash 食物图，HTTPS）
FOOD_RECORDS = [
    {
        "meal_type": "breakfast",
        "description": "燕麦粥配香蕉，营养饱腹",
        "image_path": "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
        "total_calories": 320,
        "total_protein": 12,
        "total_carbs": 52,
        "total_fat": 6,
        "insight": "早餐搭配合理，适合作为一天的能量开端。",
        "items": [
            {"name": "燕麦粥", "weight": 200, "ratio": 100, "intake": 200, "nutrients": {"calories": 140, "protein": 5, "carbs": 25, "fat": 2, "fiber": 4, "sugar": 0}},
            {"name": "香蕉", "weight": 120, "ratio": 100, "intake": 120, "nutrients": {"calories": 107, "protein": 1.3, "carbs": 27, "fat": 0.4, "fiber": 3, "sugar": 14}},
            {"name": "牛奶", "weight": 100, "ratio": 100, "intake": 100, "nutrients": {"calories": 54, "protein": 3.4, "carbs": 5, "fat": 2, "fiber": 0, "sugar": 5}},
        ],
    },
    {
        "meal_type": "lunch",
        "description": "鸡胸肉沙拉+糙米饭，低脂高蛋白",
        "image_path": "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400",
        "total_calories": 480,
        "total_protein": 38,
        "total_carbs": 45,
        "total_fat": 14,
        "insight": "优质蛋白与复合碳水，适合减脂期。",
        "items": [
            {"name": "鸡胸肉", "weight": 150, "ratio": 100, "intake": 150, "nutrients": {"calories": 248, "protein": 46, "carbs": 0, "fat": 5, "fiber": 0, "sugar": 0}},
            {"name": "糙米饭", "weight": 120, "ratio": 100, "intake": 120, "nutrients": {"calories": 140, "protein": 3, "carbs": 30, "fat": 1, "fiber": 2, "sugar": 0}},
            {"name": "蔬菜沙拉", "weight": 100, "ratio": 100, "intake": 100, "nutrients": {"calories": 35, "protein": 2, "carbs": 6, "fat": 0.5, "fiber": 2, "sugar": 2}},
            {"name": "橄榄油醋汁", "weight": 20, "ratio": 100, "intake": 20, "nutrients": {"calories": 57, "protein": 0, "carbs": 1, "fat": 6, "fiber": 0, "sugar": 0}},
        ],
    },
    {
        "meal_type": "dinner",
        "description": "清蒸鱼+西兰花，清淡易消化",
        "image_path": "https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400",
        "total_calories": 350,
        "total_protein": 28,
        "total_carbs": 18,
        "total_fat": 18,
        "insight": "晚餐宜清淡，鱼类提供优质蛋白与不饱和脂肪。",
        "items": [
            {"name": "清蒸鲈鱼", "weight": 180, "ratio": 100, "intake": 180, "nutrients": {"calories": 198, "protein": 28, "carbs": 0, "fat": 9, "fiber": 0, "sugar": 0}},
            {"name": "西兰花", "weight": 150, "ratio": 100, "intake": 150, "nutrients": {"calories": 51, "protein": 4.2, "carbs": 10, "fat": 0.6, "fiber": 3.8, "sugar": 2}},
            {"name": "蒸蛋", "weight": 80, "ratio": 100, "intake": 80, "nutrients": {"calories": 96, "protein": 7, "carbs": 1, "fat": 7, "fiber": 0, "sugar": 0}},
        ],
    },
    {
        "meal_type": "snack",
        "description": "苹果+酸奶，加餐轻负担",
        "image_path": "https://images.unsplash.com/photo-1570197788417-0e29035e5c5d?w=400",
        "total_calories": 150,
        "total_protein": 6,
        "total_carbs": 22,
        "total_fat": 4,
        "insight": "适量加餐有助于稳定血糖与食欲。",
        "items": [
            {"name": "苹果", "weight": 150, "ratio": 100, "intake": 150, "nutrients": {"calories": 78, "protein": 0.4, "carbs": 21, "fat": 0.3, "fiber": 3.6, "sugar": 15}},
            {"name": "无糖酸奶", "weight": 100, "ratio": 100, "intake": 100, "nutrients": {"calories": 72, "protein": 5, "carbs": 8, "fat": 3.5, "fiber": 0, "sugar": 5}},
        ],
    },
]


def main():
    print("1. 查找测试账号 (telephone=18870666046)...")
    r = supabase.table("weapp_user").select("id, nickname").eq("telephone", TEST_PHONE).execute()
    if not r.data or len(r.data) == 0:
        print("   未找到该手机号用户，请先用该手机号登录一次小程序后再运行本脚本。")
        sys.exit(1)
    test_user = r.data[0]
    test_user_id = test_user["id"]
    print(f"   找到: id={test_user_id}, nickname={test_user.get('nickname') or '(未设置)'}")

    print("2. 创建/获取测试好友用户...")
    friend_ids = []
    for seed in FRIEND_SEEDS:
        existing = supabase.table("weapp_user").select("id").eq("openid", seed["openid"]).execute()
        if existing.data and len(existing.data) > 0:
            fid = existing.data[0]["id"]
            print(f"   已存在: {seed['nickname']} id={fid}")
        else:
            ins = supabase.table("weapp_user").insert({
                "openid": seed["openid"],
                "nickname": seed["nickname"],
                "avatar": seed.get("avatar") or "",
            }).execute()
            if ins.data and len(ins.data) > 0:
                fid = ins.data[0]["id"]
                print(f"   已创建: {seed['nickname']} id={fid}")
            else:
                print(f"   创建失败: {seed['nickname']}")
                continue
        friend_ids.append(fid)

    if not friend_ids:
        print("   没有可用的好友用户，退出。")
        sys.exit(1)

    print("3. 建立好友关系（双向）...")
    for fid in friend_ids:
        # 避免重复插入
        ex1 = supabase.table("user_friends").select("id").eq("user_id", test_user_id).eq("friend_id", fid).execute()
        if ex1.data and len(ex1.data) > 0:
            print(f"   已是好友: {fid}")
            continue
        supabase.table("user_friends").insert([
            {"user_id": test_user_id, "friend_id": fid},
            {"user_id": fid, "friend_id": test_user_id},
        ]).execute()
        print(f"   已添加好友: {fid}")

    # 今天 UTC 日期，用于插入「今日」记录
    today = datetime.now(timezone.utc)
    today_str = today.strftime("%Y-%m-%d")

    def build_record_row(user_id, rec, record_time, total_weight=350):
        return {
            "user_id": user_id,
            "meal_type": rec["meal_type"],
            "description": rec["description"],
            "image_path": rec.get("image_path"),
            "insight": rec.get("insight") or "均衡饮食，保持健康。",
            "items": rec.get("items") or [],
            "total_calories": rec["total_calories"],
            "total_protein": rec["total_protein"],
            "total_carbs": rec["total_carbs"],
            "total_fat": rec["total_fat"],
            "total_weight_grams": total_weight,
            "record_time": record_time,
        }

    print("4. 为测试账号添加今日食物记录（含图片与食物明细）...")
    for i, rec in enumerate(FOOD_RECORDS):
        record_time = (today - timedelta(hours=len(FOOD_RECORDS) - i)).isoformat().replace("+00:00", "Z")
        row = build_record_row(test_user_id, rec, record_time, 350)
        supabase.table("user_food_records").insert(row).execute()
        print(f"   已插入: {rec['meal_type']} {rec['description'][:20]}... (含图与明细)")

    print("5. 为每位好友添加 2 条今日食物记录（圈子 Feed 用，含图片与明细）...")
    for fid in friend_ids:
        for rec in FOOD_RECORDS[:2]:
            record_time = (today - timedelta(hours=2)).isoformat().replace("+00:00", "Z")
            row = build_record_row(fid, rec, record_time, 300)
            supabase.table("user_food_records").insert(row).execute()
        print(f"   已为好友 {fid} 插入 2 条记录（含图与明细）")

    print("6. 模拟用户「小马哥」请求添加测试账号（我）为好友...")
    xiaomage_openid = "seed_xiaomage"
    xiaomage = supabase.table("weapp_user").select("id").eq("openid", xiaomage_openid).execute()
    if xiaomage.data and len(xiaomage.data) > 0:
        xiaomage_id = xiaomage.data[0]["id"]
        print(f"   已存在用户小马哥 id={xiaomage_id}")
    else:
        ins = supabase.table("weapp_user").insert({
            "openid": xiaomage_openid,
            "nickname": "小马哥",
            "avatar": "",
        }).execute()
        if ins.data and len(ins.data) > 0:
            xiaomage_id = ins.data[0]["id"]
            print(f"   已创建用户小马哥 id={xiaomage_id}")
        else:
            print("   创建小马哥失败，跳过好友请求")
            xiaomage_id = None
    if xiaomage_id:
        existing = supabase.table("friend_requests").select("id, status").eq("from_user_id", xiaomage_id).eq("to_user_id", test_user_id).execute()
        if existing.data and len(existing.data) > 0:
            row = existing.data[0]
            if row.get("status") == "pending":
                print("   小马哥已有一条待处理的好友请求，无需重复插入")
            else:
                supabase.table("friend_requests").update({"status": "pending", "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", row["id"]).execute()
                print("   已将该条请求重置为 pending")
        else:
            supabase.table("friend_requests").insert({
                "from_user_id": xiaomage_id,
                "to_user_id": test_user_id,
                "status": "pending",
            }).execute()
            print("   已插入：小马哥 -> 测试账号(18870666046)，status=pending")

    print("完成。测试账号已拥有好友、今日食物记录；小马哥已发送好友请求，可在圈子页「好友请求」中接受。")

if __name__ == "__main__":
    main()
