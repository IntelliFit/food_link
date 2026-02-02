#!/usr/bin/env python3
"""
仅插入：模拟用户「小马哥」请求添加测试账号（手机号 18870666046）为好友。
在 backend 目录下执行: python seed_xiaomage_request.py
"""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))
os.chdir(backend_dir)

from dotenv import load_dotenv
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("错误: 请设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY（backend/.env）")
    sys.exit(1)

from supabase import create_client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

TEST_PHONE = "18870666046"
XIAOMAGE_OPENID = "seed_xiaomage"


def main():
    print("1. 查找测试账号 (telephone=18870666046)...")
    r = supabase.table("weapp_user").select("id, nickname").eq("telephone", TEST_PHONE).execute()
    if not r.data or len(r.data) == 0:
        print("   未找到该手机号用户，请先用该手机号登录一次小程序后再运行。")
        sys.exit(1)
    test_user_id = r.data[0]["id"]
    print(f"   找到: id={test_user_id}")

    print("2. 查找或创建用户「小马哥」...")
    x = supabase.table("weapp_user").select("id").eq("openid", XIAOMAGE_OPENID).execute()
    if x.data and len(x.data) > 0:
        xiaomage_id = x.data[0]["id"]
        print(f"   已存在小马哥 id={xiaomage_id}")
    else:
        ins = supabase.table("weapp_user").insert({
            "openid": XIAOMAGE_OPENID,
            "nickname": "小马哥",
            "avatar": "",
        }).execute()
        if ins.data and len(ins.data) > 0:
            xiaomage_id = ins.data[0]["id"]
            print(f"   已创建小马哥 id={xiaomage_id}")
        else:
            print("   创建小马哥失败")
            sys.exit(1)

    print("3. 插入好友请求：小马哥 -> 我 (pending)...")
    existing = supabase.table("friend_requests").select("id, status").eq("from_user_id", xiaomage_id).eq("to_user_id", test_user_id).execute()
    if existing.data and len(existing.data) > 0:
        row = existing.data[0]
        if row.get("status") == "pending":
            print("   已存在一条待处理请求，无需重复插入")
        else:
            supabase.table("friend_requests").update({
                "status": "pending",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", row["id"]).execute()
            print("   已将该条请求重置为 pending")
    else:
        supabase.table("friend_requests").insert({
            "from_user_id": xiaomage_id,
            "to_user_id": test_user_id,
            "status": "pending",
        }).execute()
        print("   已插入：小马哥 请求添加 我，status=pending")

    print("完成。用测试账号登录小程序，在圈子页「好友请求」中可看到小马哥的申请并接受。")


if __name__ == "__main__":
    main()
