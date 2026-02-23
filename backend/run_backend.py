"""
启动后端：先启动多个 Worker 子进程处理异步分析任务，再启动 FastAPI（uvicorn）。
用法：python run_backend.py
环境变量：WORKER_COUNT 控制 Worker 数量，默认 2。
"""
import os
import sys
import multiprocessing

# 确保 backend 目录在 path 中
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 必须在 import worker 前加载 .env，worker 内部也会 load_dotenv
from dotenv import load_dotenv
load_dotenv()

WORKER_COUNT = int(os.getenv("WORKER_COUNT", "2"))
WORKER_COUNT = max(1, min(WORKER_COUNT, 8))  # 1~8
TEXT_WORKER_COUNT = int(os.getenv("TEXT_WORKER_COUNT", "1"))  # 文字分析 Worker
HEALTH_REPORT_WORKER_COUNT = int(os.getenv("HEALTH_REPORT_WORKER_COUNT", "1"))  # 病历提取 Worker
COMMENT_WORKER_COUNT = int(os.getenv("COMMENT_WORKER_COUNT", "1"))  # 评论审核 Worker
PUBLIC_LIBRARY_MODERATION_WORKER_COUNT = int(os.getenv("PUBLIC_LIBRARY_MODERATION_WORKER_COUNT", "1"))  # 食物库审核


def run_food_worker_process(worker_id: int) -> None:
    """子进程入口：运行食物分析 Worker。"""
    from worker import run_worker
    run_worker(worker_id=worker_id, task_type="food", poll_interval=2.0)


def run_text_food_worker_process(worker_id: int) -> None:
    """子进程入口：运行文字分析 Worker。"""
    from worker import run_worker
    run_worker(worker_id=worker_id, task_type="food_text", poll_interval=2.0)


def run_health_report_worker_process(worker_id: int) -> None:
    """子进程入口：运行病历提取 Worker。"""
    from worker import run_worker
    run_worker(worker_id=worker_id, task_type="health_report", poll_interval=2.0)

def run_public_library_moderation_worker_process(worker_id: int) -> None:
    """子进程入口：运行食物库文本审核 Worker。"""
    from worker import run_worker
    run_worker(worker_id=worker_id, task_type="public_food_library_text", poll_interval=2.0)


def run_comment_worker_process(worker_id: int) -> None:
    """子进程入口：运行评论审核 Worker。"""
    from worker import run_comment_worker
    run_comment_worker(worker_id=worker_id, poll_interval=2.0)


def main() -> None:
    workers: list[multiprocessing.Process] = []
    
    # 启动图片食物分析 Worker
    for i in range(WORKER_COUNT):
        p = multiprocessing.Process(target=run_food_worker_process, args=(i,), daemon=True)
        p.start()
        workers.append(p)
    
    # 启动文字食物分析 Worker
    for i in range(TEXT_WORKER_COUNT):
        p = multiprocessing.Process(target=run_text_food_worker_process, args=(i,), daemon=True)
        p.start()
        workers.append(p)
    
    # 启动病历提取 Worker
    for i in range(HEALTH_REPORT_WORKER_COUNT):
        p = multiprocessing.Process(target=run_health_report_worker_process, args=(i,), daemon=True)
        p.start()
        workers.append(p)
    
    # 启动评论审核 Worker
    for i in range(COMMENT_WORKER_COUNT):
        p = multiprocessing.Process(target=run_comment_worker_process, args=(i,), daemon=True)
        p.start()
        workers.append(p)

    # 启动食物库审核 Worker
    for i in range(PUBLIC_LIBRARY_MODERATION_WORKER_COUNT):
        p = multiprocessing.Process(target=run_public_library_moderation_worker_process, args=(i,), daemon=True)
        p.start()
        workers.append(p)
    
    print(
        f"[run_backend] 已启动 {WORKER_COUNT} 个图片分析 Worker + "
        f"{TEXT_WORKER_COUNT} 个文字分析 Worker + "
        f"{HEALTH_REPORT_WORKER_COUNT} 个病历提取 Worker + "
        f"{COMMENT_WORKER_COUNT} 个评论审核 Worker + "
        f"{PUBLIC_LIBRARY_MODERATION_WORKER_COUNT} 个食物库审核 Worker",
        flush=True
    )

    import uvicorn
    # 不使用 --reload，避免主进程重启后 Worker 成为孤儿进程
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "3010")),
        log_level="info",
    )


if __name__ == "__main__":
    main()
