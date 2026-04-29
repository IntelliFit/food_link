"""
批量图片分析实时测试
- 测试单张图片能量分析
- 测试多张图片批量分析（结果累加）
- 使用真实 AI 服务（需 DASHSCOPE_API_KEY）
"""
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# 确保 backend 目录在 path 中
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 加载 .env 环境变量
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

import httpx
from httpx import ASGITransport
from main import app
from auth import create_access_token

# 测试时跳过配额检查（避免新用户无积分导致分析失败）
# 同时 mock get_user_by_id，避免查询真实数据库时用户不存在报错
# mock create_analysis_task_sync，避免外键约束导致插入失败
import main as main_module
from database import create_analysis_task_sync as original_create_task, update_analysis_task_result_sync as original_update_task

async def _mock_validate(*args, **kwargs):
    return {"daily_credits_remaining": 999, "daily_credits_max": 999, "daily_credits_used": 0}
main_module._raise_if_food_analysis_credits_insufficient = _mock_validate

async def _mock_get_user(user_id: str):
    return {
        "id": user_id,
        "openid": TEST_OPENID,
        "unionid": "test-unionid-batch",
        "nickname": "测试用户",
        "avatar": "",
        "execution_mode": "standard",
        "created_at": datetime.now().isoformat(),
    }
main_module.get_user_by_id = _mock_get_user

FAKE_TASK_ID = "11111111-1111-1111-1111-111111111111"

def _mock_create_task_sync(*args, **kwargs):
    return {
        "id": FAKE_TASK_ID,
        "user_id": kwargs.get("user_id", TEST_USER_ID),
        "task_type": kwargs.get("task_type", "food"),
        "status": "pending",
        "image_url": kwargs.get("image_url"),
        "image_paths": kwargs.get("image_urls", []),
        "payload": kwargs.get("payload", {}),
        "created_at": datetime.now().isoformat(),
    }

main_module.create_analysis_task_sync = _mock_create_task_sync

def _mock_update_task_sync(*args, **kwargs):
    return True

main_module.update_analysis_task_result_sync = _mock_update_task_sync

# 测试配置（必须使用合法 UUID 格式，否则 Supabase 会报错）
TEST_USER_ID = "a810921a-b831-4ae5-b950-bbd20faaa196"
TEST_OPENID = "test-openid-batch-001"
TEST_IMAGES_DIR = Path(__file__).parent / "test_images"


def generate_test_token() -> str:
    """生成测试用 JWT token"""
    token = create_access_token({
        "user_id": TEST_USER_ID,
        "openid": TEST_OPENID,
        "unionid": "test-unionid-batch",
    })
    return token


async def upload_image_file(client: httpx.AsyncClient, filepath: Path) -> str:
    """上传图片文件到后端，返回公网 URL"""
    with open(filepath, "rb") as f:
        files = {"file": (filepath.name, f, "image/jpeg")}
        resp = await client.post(
            "/api/upload-analyze-image-file",
            files=files,
        )
    assert resp.status_code == 200, f"上传图片失败: {resp.status_code} {resp.text}"
    data = resp.json()
    image_url = data.get("imageUrl") or data.get("image_url")
    assert image_url, f"上传响应缺少 imageUrl: {data}"
    print(f"  ✅ 上传成功: {filepath.name} -> {image_url[:60]}...")
    return image_url


def print_analysis_result(result: dict, label: str):
    """打印分析结果中的能量和营养信息"""
    print(f"\n{'='*60}")
    print(f"📊 {label}")
    print(f"{'='*60}")
    print(f"描述: {result.get('description', 'N/A')[:100]}...")
    print(f"建议: {result.get('insight', 'N/A')[:100]}...")
    
    items = result.get("items", [])
    print(f"\n识别到 {len(items)} 种食物:")
    total_calories = 0
    total_protein = 0
    total_carbs = 0
    total_fat = 0
    
    for i, item in enumerate(items, 1):
        name = item.get("name", "未知")
        weight = item.get("estimatedWeightGrams", 0)
        nutrients = item.get("nutrients", {})
        cal = nutrients.get("calories", 0)
        pro = nutrients.get("protein", 0)
        carb = nutrients.get("carbs", 0)
        fat = nutrients.get("fat", 0)
        total_calories += cal
        total_protein += pro
        total_carbs += carb
        total_fat += fat
        print(f"  {i}. {name} ({weight}g) | 🔥{cal:.0f}kcal | 蛋{pro:.1f}g | 碳{carb:.1f}g | 脂{fat:.1f}g")
    
    print(f"\n💡 营养汇总:")
    print(f"   总热量: {total_calories:.0f} kcal")
    print(f"   蛋白质: {total_protein:.1f} g")
    print(f"   碳水:   {total_carbs:.1f} g")
    print(f"   脂肪:   {total_fat:.1f} g")
    
    pfc = result.get("pfc_ratio_comment")
    if pfc:
        print(f"\n   PFC点评: {pfc[:120]}...")
    
    context = result.get("context_advice")
    if context:
        print(f"   场景建议: {context[:120]}...")
    
    print(f"{'='*60}\n")


async def cleanup_test_data(client: httpx.AsyncClient, task_ids: list):
    """清理测试产生的任务数据"""
    print("\n🧹 清理测试数据...")
    for tid in task_ids:
        try:
            resp = await client.delete(f"/api/analyze/tasks/{tid}")
            if resp.status_code == 200:
                print(f"  ✅ 已删除任务: {tid}")
            else:
                print(f"  ⚠️ 删除任务失败 {tid}: {resp.status_code}")
        except Exception as e:
            print(f"  ⚠️ 删除任务异常 {tid}: {e}")
    print("清理完成")


async def test_single_image_analysis(client: httpx.AsyncClient, image_url: str) -> str:
    """测试单张图片分析"""
    print("\n🍽️  [测试1] 单张图片分析")
    print("-" * 60)
    
    payload = {
        "image_url": image_url,
        "meal_type": "lunch",
        "modelName": "qwen-vl-max",
        "execution_mode": "standard",
    }
    
    resp = await client.post("/api/analyze", json=payload)
    assert resp.status_code == 200, f"单张分析失败: {resp.status_code} {resp.text}"
    
    result = resp.json()
    print_analysis_result(result, "单张图片分析结果")
    return result


async def test_batch_image_analysis(client: httpx.AsyncClient, image_urls: list) -> tuple:
    """测试批量图片分析"""
    print(f"\n🍽️🍽️  [测试2] 批量图片分析 ({len(image_urls)} 张)")
    print("-" * 60)
    
    payload = {
        "image_urls": image_urls,
        "meal_type": "lunch",
        "modelName": "qwen-vl-max",
        "execution_mode": "standard",
    }
    
    resp = await client.post("/api/analyze/batch", json=payload)
    assert resp.status_code == 200, f"批量分析失败: {resp.status_code} {resp.text}"
    
    data = resp.json()
    result = data.get("result", {})
    task_id = data.get("task_id")
    image_count = data.get("image_count", 0)
    
    print(f"返回 task_id: {task_id}")
    print(f"图片数量: {image_count}")
    print_analysis_result(result, f"批量分析结果 ({len(image_urls)} 张图累加)")
    
    return result, task_id


async def run_tests():
    """运行全部测试"""
    print("="*70)
    print("🚀 食物图片分析实时测试")
    print("="*70)
    print(f"测试用户: {TEST_USER_ID}")
    print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # 检查 API key
    dashscope_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not dashscope_key:
        print("\n❌ 错误: 缺少 DASHSCOPE_API_KEY 环境变量")
        print("请在 backend/.env 中配置")
        return
    print(f"\n✅ DASHSCOPE_API_KEY 已配置")
    
    # 生成 token
    token = generate_test_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    # 准备图片
    image_files = sorted(TEST_IMAGES_DIR.glob("food*.jpg"))
    if len(image_files) < 2:
        print(f"\n❌ 错误: 测试图片不足，需要至少 2 张，当前: {len(image_files)}")
        return
    
    print(f"\n📸 发现 {len(image_files)} 张测试图片:")
    for f in image_files:
        print(f"   - {f.name} ({f.stat().st_size/1024:.0f} KB)")
    
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers=headers,
        timeout=120.0,
    ) as client:
        
        # 上传所有图片
        print("\n☁️  上传图片到 Supabase...")
        uploaded_urls = []
        for img_path in image_files:
            url = await upload_image_file(client, img_path)
            uploaded_urls.append(url)
        
        task_ids_to_cleanup = []
        
        try:
            # 测试1: 单张图片分析
            single_result = await test_single_image_analysis(client, uploaded_urls[0])
            
            # 测试2: 批量图片分析（使用全部图片）
            batch_result, task_id = await test_batch_image_analysis(client, uploaded_urls)
            if task_id:
                task_ids_to_cleanup.append(task_id)
            
            # 对比结果
            print("\n📈 单张 vs 批量对比")
            print("-" * 60)
            single_items = single_result.get("items", [])
            batch_items = batch_result.get("items", [])
            single_cal = sum(i.get("nutrients", {}).get("calories", 0) for i in single_items)
            batch_cal = sum(i.get("nutrients", {}).get("calories", 0) for i in batch_items)
            print(f"单张图识别食物数: {len(single_items)}")
            print(f"批量图识别食物数: {len(batch_items)}")
            print(f"单张图总热量:     {single_cal:.0f} kcal")
            print(f"批量图总热量:     {batch_cal:.0f} kcal")
            print(f"差异:             {batch_cal - single_cal:+.0f} kcal")
            print("-" * 60)
            
            print("\n✅ 全部测试通过!")
            
        finally:
            # 清理测试数据
            if task_ids_to_cleanup:
                await cleanup_test_data(client, task_ids_to_cleanup)


if __name__ == "__main__":
    asyncio.run(run_tests())
