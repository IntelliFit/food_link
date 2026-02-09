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
HEALTH_REPORT_WORKER_COUNT = int(os.getenv("HEALTH_REPORT_WORKER_COUNT", "1"))  # 病历提取 Worker


def run_food_worker_process(worker_id: int) -> None:
    """子进程入口：运行食物分析 Worker。"""
    from worker import run_worker
    run_worker(worker_id=worker_id, task_type="food", poll_interval=2.0)


def run_health_report_worker_process(worker_id: int) -> None:
    """子进程入口：运行病历提取 Worker。"""
    from worker import run_worker
    run_worker(worker_id=worker_id, task_type="health_report", poll_interval=2.0)


def main() -> None:
    workers: list[multiprocessing.Process] = []
    for i in range(WORKER_COUNT):
        p = multiprocessing.Process(target=run_food_worker_process, args=(i,), daemon=True)
        p.start()
        workers.append(p)
    for i in range(HEALTH_REPORT_WORKER_COUNT):
        p = multiprocessing.Process(target=run_health_report_worker_process, args=(i,), daemon=True)
        p.start()
        workers.append(p)
    print(f"[run_backend] 已启动 {WORKER_COUNT} 个食物分析 Worker + {HEALTH_REPORT_WORKER_COUNT} 个病历提取 Worker", flush=True)

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
