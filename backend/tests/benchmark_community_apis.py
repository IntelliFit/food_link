"""
社区（圈子）API 基准测试：对比优化前后的接口耗时。

测试口径：
- 每个函数 warm-up 1 次，正式跑 N 次取平均
- 使用生产数据库真实数据
- 统计单位为毫秒 (ms)
"""
import asyncio
import os
import sys
import time
from typing import Callable, Any, Awaitable

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 从 backend/.env 读取真实的 Supabase 配置，避免 shell export 截断
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_env_path = os.path.join(_backend_dir, ".env")
if os.path.exists(_env_path):
    with open(_env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "JWT_SECRET_KEY"):
                    os.environ.setdefault(k, v)

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only-min-32-chars")
os.environ.setdefault("SUPABASE_URL", "https://ocijuywmkalfmfxquzzf.supabase.co")
os.environ.setdefault(
    "SUPABASE_SERVICE_ROLE_KEY",
    "",
)

from database import (
    get_supabase_client,
    check_supabase_configured,
    get_friend_ids,
    _get_friend_circle_week_checkin_leaderboard_original,
    get_friend_circle_week_checkin_leaderboard,
    _get_feed_likes_for_records_original,
    get_feed_likes_for_records,
    _list_feed_interaction_notifications_original,
    list_feed_interaction_notifications,
    _count_unread_feed_interaction_notifications_original,
    count_unread_feed_interaction_notifications,
    _checkin_leaderboard_cache,
    _friend_ids_cache,
)


check_supabase_configured()
supabase = get_supabase_client()

# ---- 测试用户 ----
# 好友最多的用户（好友排名测试）—— 有 220 个好友，能充分暴露分页循环瓶颈
RANK_USER_ID = "4a141645-10ac-4801-9371-c269fb872dcd"
# 通知最多的用户（互动消息测试）
NOTIF_USER_ID = "6f0b67e5-f3b1-4b38-b3fc-081d931d8ef1"

WARMUP = 2
RUNS = 10


async def _measure(func: Callable[..., Awaitable[Any]], *args, **kwargs) -> tuple[Any, float]:
    """执行异步函数并返回（结果, 耗时_ms）。"""
    t0 = time.perf_counter()
    result = await func(*args, **kwargs)
    t1 = time.perf_counter()
    return result, (t1 - t0) * 1000


async def _run_bench(name: str, original_func, optimized_func, *args, **kwargs):
    """对比单个函数的优化前后耗时。每次测试前清除缓存，确保公平对比。"""

    def _clear_caches():
        _checkin_leaderboard_cache.clear()
        _friend_ids_cache.clear()

    # warm-up（不统计）
    for _ in range(WARMUP):
        _clear_caches()
        await original_func(*args, **kwargs)
        _clear_caches()
        await optimized_func(*args, **kwargs)

    original_times = []
    optimized_times = []

    for _ in range(RUNS):
        _clear_caches()
        _, t_orig = await _measure(original_func, *args, **kwargs)
        original_times.append(t_orig)

        _clear_caches()
        _, t_opt = await _measure(optimized_func, *args, **kwargs)
        optimized_times.append(t_opt)

    orig_avg = sum(original_times) / len(original_times)
    opt_avg = sum(optimized_times) / len(optimized_times)
    improvement = ((orig_avg - opt_avg) / orig_avg * 100) if orig_avg > 0 else 0

    return {
        "name": name,
        "original_avg_ms": round(orig_avg, 2),
        "optimized_avg_ms": round(opt_avg, 2),
        "improvement_pct": round(improvement, 1),
        "saved_ms": round(orig_avg - opt_avg, 2),
    }


async def main():
    print("=" * 70)
    print("社区（圈子）API 基准测试")
    print(f"测试运行次数: {RUNS} 次（warm-up {WARMUP} 次）")
    print("=" * 70)

    results = []

    # ---- 1. 好友排名 ----
    print("\n[1/4] 好友排名 get_friend_circle_week_checkin_leaderboard")
    print(f"      测试用户: {RANK_USER_ID}")
    friend_ids = await get_friend_ids(RANK_USER_ID)
    print(f"      好友数: {len(friend_ids)}")
    r = await _run_bench(
        "好友排名",
        _get_friend_circle_week_checkin_leaderboard_original,
        get_friend_circle_week_checkin_leaderboard,
        RANK_USER_ID,
    )
    results.append(r)
    print(f"      原始平均: {r['original_avg_ms']} ms | 优化后: {r['optimized_avg_ms']} ms | 提升: {r['improvement_pct']}%")

    # ---- 2. 点赞查询 ----
    print("\n[2/4] 点赞查询 get_feed_likes_for_records")
    # 找一批有点赞的 record_ids
    record_rows = (
        supabase.table("user_food_records")
        .select("id")
        .eq("user_id", RANK_USER_ID)
        .limit(20)
        .execute()
    )
    record_ids = [r["id"] for r in (record_rows.data or [])]
    print(f"      测试记录数: {len(record_ids)}")
    if record_ids:
        r = await _run_bench(
            "点赞查询",
            _get_feed_likes_for_records_original,
            get_feed_likes_for_records,
            record_ids,
            RANK_USER_ID,
        )
        results.append(r)
        print(f"      原始平均: {r['original_avg_ms']} ms | 优化后: {r['optimized_avg_ms']} ms | 提升: {r['improvement_pct']}%")
    else:
        print("      ⚠️ 该用户无记录，跳过点赞查询测试")

    # ---- 3. 互动消息列表 ----
    print("\n[3/4] 互动消息列表 list_feed_interaction_notifications")
    print(f"      测试用户: {NOTIF_USER_ID}")
    notif_rows = (
        supabase.table("feed_interaction_notifications")
        .select("id")
        .eq("recipient_user_id", NOTIF_USER_ID)
        .execute()
    )
    print(f"      通知总数: {len(notif_rows.data or [])}")
    r = await _run_bench(
        "互动消息列表",
        _list_feed_interaction_notifications_original,
        list_feed_interaction_notifications,
        NOTIF_USER_ID,
        50,
    )
    results.append(r)
    print(f"      原始平均: {r['original_avg_ms']} ms | 优化后: {r['optimized_avg_ms']} ms | 提升: {r['improvement_pct']}%")

    # ---- 4. 未读通知计数 ----
    print("\n[4/4] 未读通知计数 count_unread_feed_interaction_notifications")
    print(f"      测试用户: {NOTIF_USER_ID}")
    r = await _run_bench(
        "未读通知计数",
        _count_unread_feed_interaction_notifications_original,
        count_unread_feed_interaction_notifications,
        NOTIF_USER_ID,
    )
    results.append(r)
    print(f"      原始平均: {r['original_avg_ms']} ms | 优化后: {r['optimized_avg_ms']} ms | 提升: {r['improvement_pct']}%")

    # ---- 汇总表格 ----
    print("\n" + "=" * 70)
    print("优化前后速度差异汇总")
    print("=" * 70)
    print(f"{'接口':<18} {'优化前(ms)':<14} {'优化后(ms)':<14} {'节省(ms)':<12} {'提升幅度':<10}")
    print("-" * 70)
    for r in results:
        print(
            f"{r['name']:<18} {r['original_avg_ms']:<14} {r['optimized_avg_ms']:<14} "
            f"{r['saved_ms']:<12} {r['improvement_pct']:<10}%"
        )
    print("-" * 70)
    total_orig = sum(r["original_avg_ms"] for r in results)
    total_opt = sum(r["optimized_avg_ms"] for r in results)
    total_saved = total_orig - total_opt
    total_imp = (total_saved / total_orig * 100) if total_orig > 0 else 0
    print(
        f"{'合计':<18} {round(total_orig, 2):<14} {round(total_opt, 2):<14} "
        f"{round(total_saved, 2):<12} {round(total_imp, 1):<10}%"
    )
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
