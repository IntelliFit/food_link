#!/usr/bin/env python3
"""
测试脚本：模拟前端调用 /api/home/dashboard 接口
"""
import os
import asyncio
import httpx
from datetime import datetime

from dotenv import load_dotenv
load_dotenv()

API_BASE_URL = os.environ.get("API_BASE_URL", "http://127.0.0.1:3010")
# 或者使用生产环境
# API_BASE_URL = "https://healthymax.cn"


async def test_dashboard_api():
    # 需要用户的 access_token
    # 方案1: 从数据库获取用户的 token
    # 方案2: 使用测试 token
    
    from supabase import create_client, Client
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    supabase: Client = create_client(supabase_url, supabase_key)
    
    # 找到锦恢的 openid 用于生成 token
    users_result = supabase.table("weapp_user").select("id, openid, nickname").ilike("nickname", "%锦恢%").execute()
    users = users_result.data or []
    
    if not users:
        print("未找到用户'锦恢'")
        return
    
    user = users[0]
    user_id = user["id"]
    openid = user["openid"]
    
    print(f"测试用户: {user.get('nickname', 'N/A')}")
    print(f"user_id: {user_id}")
    print(f"openid: {openid[:30]}...")
    print()
    
    # 创建测试 token (模拟后端生成的 JWT)
    import jwt
    from datetime import timedelta, timezone
    
    # 使用与后端相同的 SECRET_KEY
    secret_key = os.environ.get("JWT_SECRET_KEY", "your-secret-key-change-this-in-production-min-32-chars")
    
    access_token = jwt.encode(
        {
            "openid": openid,
            "user_id": user_id,
            "exp": datetime.now(timezone.utc) + timedelta(hours=24)
        },
        secret_key,
        algorithm="HS256"
    )
    
    print(f"生成的测试 token: {access_token[:50]}...")
    print()
    
    # 解码token查看内容
    import jwt as jwt_lib
    decoded = jwt_lib.decode(access_token, secret_key, algorithms=["HS256"])
    print(f"Token 内容: {decoded}")
    print(f"Token 中的 user_id: {decoded.get('user_id')}")
    print(f"预期的 user_id (锦恢): {user_id}")
    print(f"是否匹配: {decoded.get('user_id') == user_id}")
    print()
    
    # 测试两个接口调用
    async with httpx.AsyncClient() as client:
        headers = {"Authorization": f"Bearer {access_token}"}
        
        # 测试1: 不带 date 参数（默认今天）
        print("=" * 60)
        print("测试1: GET /api/home/dashboard (不带date参数)")
        print("=" * 60)
        
        try:
            response = await client.get(f"{API_BASE_URL}/api/home/dashboard", headers=headers, timeout=10)
            print(f"状态码: {response.status_code}")
            if response.status_code == 200:
                data = response.json()
                intake = data.get("intakeData", {})
                meals = data.get("meals", [])
                print(f"当前热量: {intake.get('current')} kcal")
                print(f"目标热量: {intake.get('target')} kcal")
                print(f"进度: {intake.get('progress')}%")
                print(f"餐食数: {len(meals)}")
                for m in meals:
                    print(f"  - {m.get('name')}: {m.get('calorie')} kcal")
            else:
                print(f"错误: {response.text}")
        except Exception as e:
            print(f"请求失败: {e}")
        
        print()
        
        # 测试2: 带 date=2026-03-30 参数
        print("=" * 60)
        print("测试2: GET /api/home/dashboard?date=2026-03-30")
        print("=" * 60)
        
        try:
            response = await client.get(
                f"{API_BASE_URL}/api/home/dashboard?date=2026-03-30", 
                headers=headers, 
                timeout=10
            )
            print(f"状态码: {response.status_code}")
            if response.status_code == 200:
                data = response.json()
                intake = data.get("intakeData", {})
                meals = data.get("meals", [])
                print(f"当前热量: {intake.get('current')} kcal")
                print(f"目标热量: {intake.get('target')} kcal")
                print(f"进度: {intake.get('progress')}%")
                print(f"蛋白质: {intake.get('macros', {}).get('protein', {}).get('current')} g")
                print(f"碳水: {intake.get('macros', {}).get('carbs', {}).get('current')} g")
                print(f"脂肪: {intake.get('macros', {}).get('fat', {}).get('current')} g")
                print(f"餐食数: {len(meals)}")
                for m in meals:
                    print(f"  - {m.get('name')}: {m.get('calorie')} kcal")
            else:
                print(f"错误: {response.text}")
        except Exception as e:
            print(f"请求失败: {e}")


if __name__ == "__main__":
    asyncio.run(test_dashboard_api())
