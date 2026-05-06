#!/usr/bin/env python3
"""
Backend Benchmark: Python vs Go
顺序启停两个后端，用 ab 压测相同接口，输出对比报告。
"""
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# ---------------------- 配置 ----------------------
PROJECT_ROOT = Path(__file__).parent.parent.resolve()
PYTHON_BACKEND_DIR = PROJECT_ROOT / "backend_bak"
GO_BACKEND_DIR = PROJECT_ROOT / "backend"
REPORT_PATH = PROJECT_ROOT / "backend-benchmark-report.md"
RAW_DIR_PY = PROJECT_ROOT / "tmp" / "benchmark_python"
RAW_DIR_GO = PROJECT_ROOT / "tmp" / "benchmark_go"
PORT = 3010
BASE_URL = f"http://127.0.0.1:{PORT}"

# 压测参数
AB_REQUESTS = 100
AB_CONCURRENCY = 10
WARMUP_REQUESTS = 3
STARTUP_WAIT = 12  # 后端启动等待秒数

# 测试用户（已知存在）
TEST_USER_ID = "4fe43633-d15b-4e6e-9106-a0083f618d85"
TEST_OPENID = "test-openid-benchmark-001"

# 测试接口列表
ENDPOINTS = [
    {"name": "health", "path": "/api/health", "auth": False},
    {"name": "membership_plans", "path": "/api/membership/plans", "auth": False},
    {"name": "user_profile", "path": "/api/user/profile", "auth": True},
    {"name": "home_dashboard", "path": "/api/home/dashboard", "auth": True},
    {"name": "community_feed", "path": "/api/community/feed?offset=0&limit=10", "auth": True},
    {"name": "food_record_list", "path": "/api/food-record/list", "auth": True},
    {"name": "stats_summary", "path": "/api/stats/summary?range=week", "auth": True},
    {"name": "friend_list", "path": "/api/friend/list", "auth": True},
]


# ---------------------- JWT Token ----------------------
def generate_token() -> str:
    venv_python = str(PYTHON_BACKEND_DIR / ".venv" / "bin" / "python")
    code = f'''
import jwt, datetime
secret = "qRO3zqrg4CzM98rdjG3ifvbqwH9hNuuYdvH+FW+T7aMkis3d9+79jwXIRhbO0uOiaZmZqLUJxdQMf7p6ka6aCw=="
payload = {{
    "user_id": "{TEST_USER_ID}",
    "openid": "{TEST_OPENID}",
    "unionid": "test-unionid-benchmark",
    "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=36525),
    "iat": datetime.datetime.now(datetime.timezone.utc),
}}
token = jwt.encode(payload, secret, algorithm="HS256")
print(token)
'''
    result = subprocess.run(
        [venv_python, "-c", code],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        raise RuntimeError(f"Token generation failed: {result.stderr}")
    return result.stdout.strip()


# ---------------------- 进程管理 ----------------------
def kill_port_processes(port: int):
    """Kill any process listening on the given port."""
    try:
        # macOS: lsof -ti :port | xargs kill -9
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True, text=True, timeout=5
        )
        if result.stdout.strip():
            pids = result.stdout.strip().split("\n")
            for pid in pids:
                if pid.strip():
                    subprocess.run(["kill", "-9", pid.strip()], capture_output=True)
                    print(f"  Killed PID {pid.strip()} on port {port}")
    except Exception as e:
        print(f"  Warning: could not kill processes on port {port}: {e}")


def wait_for_port(port: int, timeout: int = 30) -> bool:
    """Wait until the port is accepting connections."""
    for _ in range(timeout):
        result = subprocess.run(
            ["nc", "-z", "127.0.0.1", str(port)],
            capture_output=True, timeout=2
        )
        if result.returncode == 0:
            return True
        time.sleep(1)
    return False


# ---------------------- AB 压测 ----------------------
@dataclass
class BenchmarkResult:
    name: str
    path: str
    mean_ms: float
    p50_ms: float
    p75_ms: float
    p90_ms: float
    p95_ms: float
    p99_ms: float
    min_ms: float
    max_ms: float
    errors: int
    total_requests: int
    failed: bool = False


def run_ab(endpoint: dict, token: str, raw_dir: Path) -> BenchmarkResult:
    """Run Apache Bench for a single endpoint."""
    url = BASE_URL + endpoint["path"]
    raw_file = raw_dir / f"{endpoint['name']}.txt"
    cmd = [
        "ab", "-n", str(AB_REQUESTS), "-c", str(AB_CONCURRENCY),
        "-s", "30",  # timeout
    ]
    if endpoint["auth"]:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    cmd.append(url)

    # 预热
    print(f"    Warmup {endpoint['name']} ...")
    for _ in range(WARMUP_REQUESTS):
        subprocess.run(cmd + ["-n", "1", "-c", "1"], capture_output=True)

    print(f"    Benchmarking {endpoint['name']} ({url}) ...")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    raw_file.write_text(result.stdout + "\n---STDERR---\n" + result.stderr)

    if result.returncode != 0 and "Failed requests" not in result.stdout:
        print(f"    ERROR: ab failed for {endpoint['name']}")
        return BenchmarkResult(
            name=endpoint["name"], path=endpoint["path"],
            mean_ms=0, p50_ms=0, p75_ms=0, p90_ms=0, p95_ms=0, p99_ms=0,
            min_ms=0, max_ms=0, errors=AB_REQUESTS, total_requests=AB_REQUESTS,
            failed=True
        )

    return parse_ab_output(endpoint, result.stdout)


def parse_ab_output(endpoint: dict, stdout: str) -> BenchmarkResult:
    """Parse ab stdout into BenchmarkResult."""
    def find(pattern: str) -> Optional[float]:
        m = re.search(pattern, stdout)
        if m:
            val = m.group(1).strip()
            # ab outputs ms with comma in some locales
            val = val.replace(",", "")
            try:
                return float(val)
            except ValueError:
                return None
        return None

    # ab outputs in ms when using -k? No, ab outputs in ms for connection/handle times
    # But Total time and requests/sec need conversion.
    # Let's extract percentiles from "Percentage of the requests served within a certain time"
    percentiles = {}
    for line in stdout.splitlines():
        m = re.match(r"\s*(\d+)%\s+([\d,]+)\s*", line)
        if m:
            percentiles[int(m.group(1))] = float(m.group(2).replace(",", ""))

    # Time per request (mean, across all concurrent requests)
    mean_match = re.search(r"Time per request:\s+([\d.,]+)\s+\[ms\]\s+\(mean\)", stdout)
    mean_ms = float(mean_match.group(1).replace(",", "")) if mean_match else 0.0

    # Total min / max from percentiles section (100% is max)
    min_ms = percentiles.get(0, 0.0)
    max_ms = percentiles.get(100, 0.0)

    # Errors
    err_match = re.search(r"Failed requests:\s+(\d+)", stdout)
    errors = int(err_match.group(1)) if err_match else 0

    # Total requests
    total_match = re.search(r"Complete requests:\s+(\d+)", stdout)
    total_requests = int(total_match.group(1)) if total_match else AB_REQUESTS

    return BenchmarkResult(
        name=endpoint["name"],
        path=endpoint["path"],
        mean_ms=mean_ms,
        p50_ms=percentiles.get(50, 0.0),
        p75_ms=percentiles.get(75, 0.0),
        p90_ms=percentiles.get(90, 0.0),
        p95_ms=percentiles.get(95, 0.0),
        p99_ms=percentiles.get(99, 0.0),
        min_ms=min_ms,
        max_ms=max_ms,
        errors=errors,
        total_requests=total_requests,
        failed=errors >= total_requests
    )


# ---------------------- 后端启停 ----------------------
def benchmark_backend(backend_name: str, backend_dir: Path, token: str, raw_dir: Path, start_cmd: list, env_extra: dict = None) -> list:
    """Start a backend, run benchmarks, stop it. Returns list of BenchmarkResult."""
    print(f"\n{'='*60}")
    print(f"Starting {backend_name} backend ...")
    print(f"{'='*60}")

    kill_port_processes(PORT)
    time.sleep(1)

    env = os.environ.copy()
    env["PORT"] = str(PORT)
    env["JWT_SECRET_KEY"] = "qRO3zqrg4CzM98rdjG3ifvbqwH9hNuuYdvH+FW+T7aMkis3d9+79jwXIRhbO0uOiaZmZqLUJxdQMf7p6ka6aCw=="
    if env_extra:
        env.update(env_extra)

    proc = subprocess.Popen(
        start_cmd,
        cwd=str(backend_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )

    print(f"  Waiting {STARTUP_WAIT}s for startup ...")
    time.sleep(STARTUP_WAIT)

    if not wait_for_port(PORT, timeout=10):
        print(f"  ERROR: {backend_name} did not start on port {PORT}")
        proc.terminate()
        proc.wait(timeout=5)
        return []

    print(f"  {backend_name} is ready. Running benchmarks ...")
    results = []
    for ep in ENDPOINTS:
        res = run_ab(ep, token, raw_dir)
        results.append(res)
        if res.failed:
            print(f"    -> FAILED (errors={res.errors}/{res.total_requests})")
        else:
            print(f"    -> mean={res.mean_ms:.1f}ms, p95={res.p95_ms:.1f}ms, errors={res.errors}")
        time.sleep(1)  # brief cooldown between endpoints

    print(f"  Stopping {backend_name} ...")
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    kill_port_processes(PORT)
    time.sleep(2)
    return results


# ---------------------- 报告生成 ----------------------
def generate_report(py_results: list, go_results: list):
    lines = [
        "# 后端性能对比报告：Python vs Go",
        "",
        f"- 测试时间: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 压测工具: Apache Bench (ab)",
        f"- 压测参数: -n {AB_REQUESTS} -c {AB_CONCURRENCY}",
        f"- 测试用户: {TEST_USER_ID}",
        "",
        "## 接口响应时间对比",
        "",
        "| 接口 | Python 平均(ms) | Go 平均(ms) | 提升幅度 | Python P95 | Go P95 |",
        "|------|----------------|-------------|----------|------------|--------|",
    ]

    total_py_mean = 0.0
    total_go_mean = 0.0
    valid_count = 0

    for py, go in zip(py_results, go_results):
        if py.failed or go.failed:
            lines.append(
                f"| {py.name} | {'N/A' if py.failed else f'{py.mean_ms:.1f}'} | "
                f"{'N/A' if go.failed else f'{go.mean_ms:.1f}'} | N/A | "
                f"{'N/A' if py.failed else f'{py.p95_ms:.1f}'} | "
                f"{'N/A' if go.failed else f'{go.p95_ms:.1f}'} |"
            )
            continue

        improvement = ((py.mean_ms - go.mean_ms) / py.mean_ms * 100) if py.mean_ms > 0 else 0
        total_py_mean += py.mean_ms
        total_go_mean += go.mean_ms
        valid_count += 1

        lines.append(
            f"| {py.name} | {py.mean_ms:.1f} | {go.mean_ms:.1f} | "
            f"{improvement:+.1f}% | {py.p95_ms:.1f} | {go.p95_ms:.1f} |"
        )

    # 汇总行
    if valid_count > 0:
        avg_py = total_py_mean / valid_count
        avg_go = total_go_mean / valid_count
        avg_improvement = ((avg_py - avg_go) / avg_py * 100) if avg_py > 0 else 0
        lines.append(
            f"| **平均** | **{avg_py:.1f}** | **{avg_go:.1f}** | **{avg_improvement:+.1f}%** | - | - |"
        )

    lines += [
        "",
        "## 详细数据",
        "",
        "### Python 后端",
        "",
        "| 接口 | Mean | P50 | P75 | P90 | P95 | P99 | Min | Max | Errors |",
        "|------|------|-----|-----|-----|-----|-----|-----|-----|--------|",
    ]
    for r in py_results:
        if r.failed:
            lines.append(f"| {r.name} | FAILED | - | - | - | - | - | - | - | {r.errors} |")
        else:
            lines.append(
                f"| {r.name} | {r.mean_ms:.1f} | {r.p50_ms:.1f} | {r.p75_ms:.1f} | "
                f"{r.p90_ms:.1f} | {r.p95_ms:.1f} | {r.p99_ms:.1f} | {r.min_ms:.1f} | {r.max_ms:.1f} | {r.errors} |"
            )

    lines += [
        "",
        "### Go 后端",
        "",
        "| 接口 | Mean | P50 | P75 | P90 | P95 | P99 | Min | Max | Errors |",
        "|------|------|-----|-----|-----|-----|-----|-----|-----|--------|",
    ]
    for r in go_results:
        if r.failed:
            lines.append(f"| {r.name} | FAILED | - | - | - | - | - | - | - | {r.errors} |")
        else:
            lines.append(
                f"| {r.name} | {r.mean_ms:.1f} | {r.p50_ms:.1f} | {r.p75_ms:.1f} | "
                f"{r.p90_ms:.1f} | {r.p95_ms:.1f} | {r.p99_ms:.1f} | {r.min_ms:.1f} | {r.max_ms:.1f} | {r.errors} |"
            )

    lines += [
        "",
        "## 结论",
        "",
    ]
    if valid_count > 0:
        avg_py = total_py_mean / valid_count
        avg_go = total_go_mean / valid_count
        avg_improvement = ((avg_py - avg_go) / avg_py * 100) if avg_py > 0 else 0
        lines.append(
            f"在本次测试的 {valid_count} 个接口中，Go 后端平均响应时间为 **{avg_go:.1f} ms**，"
            f"Python 后端平均响应时间为 **{avg_py:.1f} ms**。"
        )
        if avg_improvement > 0:
            lines.append(
                f"相比 Python 后端，Go 后端平均响应速度提升了 **{avg_improvement:.1f}%**。"
            )
        else:
            lines.append(
                f"本次测试未观察到 Go 后端明显优于 Python 后端（差异 {avg_improvement:+.1f}%）。"
                f"可能受远程数据库网络延迟主导。"
            )
    else:
        lines.append("本次测试未获得有效数据，请检查后端启动日志。")

    lines.append("")
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nReport saved to: {REPORT_PATH}")


# ---------------------- 主流程 ----------------------
def main():
    RAW_DIR_PY.mkdir(parents=True, exist_ok=True)
    RAW_DIR_GO.mkdir(parents=True, exist_ok=True)

    print("Generating JWT token ...")
    token = generate_token()
    print(f"  Token generated (len={len(token)})")

    # 1. Python 后端
    py_cmd = [str(PYTHON_BACKEND_DIR / ".venv" / "bin" / "python"), "run_backend.py"]
    py_results = benchmark_backend("Python", PYTHON_BACKEND_DIR, token, RAW_DIR_PY, py_cmd)

    # 2. Go 后端
    # 先编译
    print("\nBuilding Go backend ...")
    build_result = subprocess.run(
        ["go", "build", "-o", "/tmp/foodlink_go_server", "./cmd/server"],
        cwd=str(GO_BACKEND_DIR),
        capture_output=True, text=True
    )
    if build_result.returncode != 0:
        print("Go build failed:", build_result.stderr)
        sys.exit(1)
    print("  Build OK")

    go_cmd = ["/tmp/foodlink_go_server"]
    go_env_extra = {
        "DATABASE_HOST": "154.8.205.78",
        "DATABASE_PORT": "5432",
        "DATABASE_NAME": "food-link",
        "DATABASE_USER": "app_user",
        "DATABASE_PASSWORD": "ffa2053eddc5b7564be7c20437086f67",
        "DATABASE_SSLMODE": "disable",
    }
    go_results = benchmark_backend("Go", GO_BACKEND_DIR, token, RAW_DIR_GO, go_cmd, go_env_extra)

    # 3. 生成报告
    generate_report(py_results, go_results)

    # 打印摘要
    print("\n" + "=" * 60)
    print("BENCHMARK SUMMARY")
    print("=" * 60)
    for py, go in zip(py_results, go_results):
        if py.failed or go.failed:
            print(f"  {py.name}: Python={'FAIL' if py.failed else f'{py.mean_ms:.1f}ms'} Go={'FAIL' if go.failed else f'{go.mean_ms:.1f}ms'}")
        else:
            imp = ((py.mean_ms - go.mean_ms) / py.mean_ms * 100) if py.mean_ms > 0 else 0
            print(f"  {py.name}: Python={py.mean_ms:.1f}ms Go={go.mean_ms:.1f}ms ({imp:+.1f}%)")
    print("=" * 60)


if __name__ == "__main__":
    main()
