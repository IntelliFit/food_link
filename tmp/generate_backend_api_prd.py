from __future__ import annotations

import ast
import re
import textwrap
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


ROOT = Path("/Users/kirigaya/project/food_link")
BACKEND_MAIN = ROOT / "backend/main.py"
BACKEND_MIDDLEWARE = ROOT / "backend/middleware.py"
BACKEND_AUTH = ROOT / "backend/auth.py"
BACKEND_RUN = ROOT / "backend/run_backend.py"
FRONTEND_ROOT = ROOT / "src"
DOCS_ROOT = ROOT / "docs/backend-api-prd"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write(path: Path, content: str) -> None:
    ensure_dir(path.parent)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def slug(text: str) -> str:
    return text.strip("/").replace("/", "-").replace("_", "-")


def normalize_backend_path(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "{}", path)


def normalize_front_path(path: str) -> str:
    value = path.strip()
    value = value.replace("${API_BASE_URL}", "")
    value = re.sub(r"\$\{[^}]+\}", "{}", value)
    value = re.sub(r"/\$\{[^}]+\}", "/{}", value)
    value = value.replace("`", "")
    value = value.replace("'", "")
    value = value.replace('"', "")
    value = value.split("?")[0]
    if value.endswith("{}") and "/{}" not in value:
        value = value[:-2]
    value = value.replace("{}/", "{}/")
    return value


def rel_from_root(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


@dataclass
class RouteInfo:
    method: str
    path: str
    handler: str
    lineno: int
    auth_type: str
    request_models: List[str] = field(default_factory=list)
    response_model: Optional[str] = None
    db_dependencies: List[str] = field(default_factory=list)
    worker_dependencies: List[str] = field(default_factory=list)
    local_dependencies: List[str] = field(default_factory=list)
    error_statuses: List[int] = field(default_factory=list)
    external_dependencies: List[str] = field(default_factory=list)
    frontend_usage: str = "backend-only"
    frontend_callers: List[str] = field(default_factory=list)
    async_task: bool = False
    internal_only: bool = False
    doc_path: Optional[str] = None
    surface_exists: str = "yes"
    source_refs: List[str] = field(default_factory=list)


@dataclass
class FrontendCall:
    method: str
    path: str
    normalized_path: str
    caller: str
    file_ref: str


def parse_main() -> Tuple[List[RouteInfo], Dict[str, List[str]], Dict[str, Tuple[int, int]]]:
    source = read(BACKEND_MAIN)
    module = ast.parse(source)
    lines = source.splitlines()

    imported_db = set()
    imported_worker = set()
    local_defs = set()
    model_fields: Dict[str, List[str]] = {}
    model_lines: Dict[str, Tuple[int, int]] = {}

    for node in module.body:
        if isinstance(node, ast.ImportFrom):
            if node.module == "database":
                for alias in node.names:
                    imported_db.add(alias.asname or alias.name)
            elif node.module == "worker":
                for alias in node.names:
                    imported_worker.add(alias.asname or alias.name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            local_defs.add(node.name)
            if isinstance(node, ast.ClassDef):
                bases = {ast.unparse(base) for base in node.bases}
                if "BaseModel" in bases:
                    fields = []
                    for stmt in node.body:
                        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                            fields.append(stmt.target.id)
                    model_fields[node.name] = fields
                    end_lineno = getattr(node, "end_lineno", node.lineno)
                    model_lines[node.name] = (node.lineno, end_lineno)

    class CallCollector(ast.NodeVisitor):
        def __init__(self) -> None:
            self.calls: List[str] = []
            self.errors: List[int] = []

        def visit_Call(self, node: ast.Call) -> None:
            name = None
            if isinstance(node.func, ast.Name):
                name = node.func.id
            elif isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                name = f"{node.func.value.id}.{node.func.attr}"
            if name:
                self.calls.append(name)
                if name == "HTTPException":
                    for kw in node.keywords:
                        if kw.arg == "status_code" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, int):
                            self.errors.append(kw.value.value)
            self.generic_visit(node)

    routes: List[RouteInfo] = []
    for node in module.body:
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        route_decs = []
        response_model = None
        for dec in node.decorator_list:
            if (
                isinstance(dec, ast.Call)
                and isinstance(dec.func, ast.Attribute)
                and isinstance(dec.func.value, ast.Name)
                and dec.func.value.id == "app"
                and dec.args
                and isinstance(dec.args[0], ast.Constant)
                and isinstance(dec.args[0].value, str)
            ):
                method = dec.func.attr.upper()
                path = dec.args[0].value
                if method == "MIDDLEWARE":
                    continue
                for kw in dec.keywords:
                    if kw.arg == "response_model":
                        response_model = ast.unparse(kw.value)
                route_decs.append((method, path))
        if not route_decs:
            continue

        request_models: List[str] = []
        auth_type = "public"
        defaults_offset = len(node.args.args) - len(node.args.defaults)
        for index, arg in enumerate(node.args.args):
            if arg.arg == "self":
                continue
            ann = ast.unparse(arg.annotation) if arg.annotation else None
            default = None
            if index >= defaults_offset and node.args.defaults:
                default = node.args.defaults[index - defaults_offset]
            if ann and ann not in {"Request", "WebSocket", "UploadFile", "str", "int", "float", "bool", "dict", "Optional[dict]", "Optional[str]", "List[str]", "Cookie", "Form", "File"}:
                if ann in model_fields and ann not in request_models:
                    request_models.append(ann)
            if isinstance(default, ast.Call) and getattr(default.func, "id", None) == "Depends":
                dep = ast.unparse(default.args[0]) if default.args else ""
                if dep == "get_current_user_info":
                    auth_type = "jwt_required"
                elif dep == "get_optional_user_info" and auth_type == "public":
                    auth_type = "jwt_optional"
                elif dep == "require_test_backend_auth":
                    auth_type = "test_backend_cookie"

        if any(method == "WEBSOCKET" for method, _ in route_decs):
            auth_type = "public"

        collector = CallCollector()
        collector.visit(node)
        db_dependencies = sorted({name for name in collector.calls if name in imported_db})
        worker_dependencies = sorted({name for name in collector.calls if name in imported_worker})
        local_dependencies = sorted({name for name in collector.calls if name in local_defs and name != node.name})
        body_source = "\n".join(lines[node.lineno - 1:getattr(node, "end_lineno", node.lineno)])

        external_dependencies = []
        if any(token in body_source for token in ["get_access_token", "wechat", "mini_program_pay", "phone_code", "get_phone_number"]):
            external_dependencies.append("WeChat")
        if any(token in body_source for token in ["location_search", "location_reverse", "map_picker", "TIANDITU", "tianditu"]):
            external_dependencies.append("Tianditu")
        if any(token in body_source for token in ["_analyze_with_gemini", "_analyze_with_qwen", "_generate_nutrition_insight", "_ocr_extract_", "_estimate_exercise_calories_llm"]):
            external_dependencies.append("LLM Provider")
        if any(token in body_source for token in ["upload_", "storage", "image_url", "StaticFiles"]):
            external_dependencies.append("Supabase Storage")
        if db_dependencies and "Supabase" not in external_dependencies:
            external_dependencies.append("Supabase")

        async_task = any(
            token in body_source
            for token in [
                "create_analysis_task_sync",
                "_get_food_task_type",
                "_create_precision_plan_task_payload",
                "analysis_tasks",
                "submit_report_extraction_task",
                "exercise_fallback_task_type",
            ]
        )

        for method, path in route_decs:
            internal_only = path.startswith("/api/test-backend") or path.startswith("/api/test/") or path.startswith("/api/prompts")
            routes.append(
                RouteInfo(
                    method=method,
                    path=path,
                    handler=node.name,
                    lineno=node.lineno,
                    auth_type=auth_type,
                    request_models=request_models[:],
                    response_model=response_model,
                    db_dependencies=db_dependencies[:],
                    worker_dependencies=worker_dependencies[:],
                    local_dependencies=local_dependencies[:],
                    error_statuses=sorted(set(collector.errors)),
                    external_dependencies=external_dependencies[:],
                    async_task=async_task,
                    internal_only=internal_only,
                    source_refs=[f"backend/main.py:{node.lineno}"],
                )
            )
    return routes, model_fields, model_lines


def detect_frontend_calls() -> List[FrontendCall]:
    files = list(FRONTEND_ROOT.rglob("*.ts")) + list(FRONTEND_ROOT.rglob("*.tsx"))
    calls: List[FrontendCall] = []

    def nearest_symbol(lines: List[str], idx: int) -> str:
        window = range(max(0, idx - 20), idx + 1)
        for i in reversed(list(window)):
            line = lines[i]
            patterns = [
                r"export\s+async\s+function\s+(\w+)",
                r"async\s+function\s+(\w+)",
                r"function\s+(\w+)",
                r"const\s+(\w+)\s*=\s*async\b",
                r"const\s+(\w+)\s*=\s*\(",
            ]
            for pattern in patterns:
                match = re.search(pattern, line)
                if match:
                    return match.group(1)
        return "anonymous"

    for file in files:
        text = read(file)
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if "authenticatedRequest(" in line:
                snippet = "\n".join(lines[i:i + 8])
                path_match = re.search(r"authenticatedRequest\((`([^`]+)`|'([^']+)'|\"([^\"]+)\")", snippet)
                if not path_match:
                    continue
                raw_path = next(group for group in path_match.groups()[1:] if group is not None)
                method_match = re.search(r"method:\s*['\"]([A-Z]+)['\"]", snippet)
                method = method_match.group(1) if method_match else "GET"
                caller = nearest_symbol(lines, i)
                calls.append(
                    FrontendCall(
                        method=method,
                        path=raw_path,
                        normalized_path=normalize_front_path(raw_path),
                        caller=f"{rel_from_root(file)}:{caller}",
                        file_ref=f"{rel_from_root(file)}:{i + 1}",
                    )
                )
            elif "Taro.request({" in line or "wx.request({" in line:
                snippet = "\n".join(lines[i:i + 12])
                path_match = re.search(r"url:\s*`?\$\{API_BASE_URL\}(/api/[^`'\"]+)", snippet)
                if not path_match:
                    continue
                raw_path = path_match.group(1)
                method_match = re.search(r"method:\s*['\"]([A-Z]+)['\"]", snippet)
                method = method_match.group(1) if method_match else "GET"
                caller = nearest_symbol(lines, i)
                calls.append(
                    FrontendCall(
                        method=method,
                        path=raw_path,
                        normalized_path=normalize_front_path(raw_path),
                        caller=f"{rel_from_root(file)}:{caller}",
                        file_ref=f"{rel_from_root(file)}:{i + 1}",
                    )
                )
        if rel_from_root(file) == "src/utils/api.ts":
            for match in re.finditer(r"export\s+async\s+function\s+(\w+)\(", text):
                name = match.group(1)
                start = match.end()
                next_match = re.search(r"\nexport\s+(?:async\s+)?function\s+\w+\(", text[start:])
                end = start + next_match.start() if next_match else len(text)
                body = text[start:end]
                body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
                body = re.sub(r"//.*", "", body)
                body = re.sub(r"\$\{[^}]+\}", "{}", body)
                route_literals = list(dict.fromkeys(re.findall(r"/api/[A-Za-z0-9_/\-{}]+", body)))
                if not route_literals:
                    continue
                methods = re.findall(r"method:\s*['\"]([A-Z]+)['\"]", body)
                normalized_methods = methods[:] if methods else []
                if "uploadFile({" in body and "POST" not in normalized_methods:
                    normalized_methods.append("POST")
                if not normalized_methods:
                    normalized_methods = ["GET"] * len(route_literals)
                if len(normalized_methods) == 1:
                    normalized_methods = normalized_methods * len(route_literals)
                if len(normalized_methods) < len(route_literals):
                    normalized_methods.extend([normalized_methods[-1]] * (len(route_literals) - len(normalized_methods)))
                for route_literal, method in zip(route_literals, normalized_methods):
                    if not route_literal.startswith("/api/"):
                        continue
                    line_no = text[:match.start()].count("\n") + 1
                    calls.append(
                        FrontendCall(
                            method=method,
                            path=route_literal,
                            normalized_path=normalize_front_path(route_literal),
                            caller=f"{rel_from_root(file)}:{name}",
                            file_ref=f"{rel_from_root(file)}:{line_no}",
                        )
                    )
    return calls


def match_frontend_usage(routes: List[RouteInfo], frontend_calls: List[FrontendCall]) -> List[FrontendCall]:
    route_map = defaultdict(list)
    for route in routes:
        route_map[(route.method, normalize_backend_path(route.path))].append(route)

    unmatched: List[FrontendCall] = []
    for call in frontend_calls:
        normalized = call.normalized_path
        key = (call.method, normalized)
        candidates = route_map.get(key)
        if not candidates:
            # fallback: strip synthetic trailing {}
            alt = normalized[:-2] if normalized.endswith("{}") else normalized
            candidates = route_map.get((call.method, alt))
        if not candidates:
            unmatched.append(call)
            continue
        for route in candidates:
            if route.internal_only:
                route.frontend_usage = "internal-only"
            else:
                route.frontend_usage = "miniapp-used"
            route.frontend_callers.append(call.caller)
    for route in routes:
        if route.internal_only and route.frontend_usage == "backend-only":
            route.frontend_usage = "internal-only"
    return unmatched


def route_doc_path(route: RouteInfo) -> str:
    path = route.path
    if path == "/api/analyze":
        return "api/analyze/index.md"
    if path == "/api/analyze/batch":
        return "api/analyze/batch.md"
    if path == "/api/analyze/submit":
        return "api/analyze/submit.md"
    if path == "/api/analyze-compare":
        return "api/analyze/compare.md"
    if path == "/api/analyze-compare-engines":
        return "api/analyze/compare-engines.md"
    if path == "/api/analyze/tasks":
        return "api/analyze/tasks/index.md"
    if path == "/api/analyze/tasks/count":
        return "api/analyze/tasks/count.md"
    if path == "/api/analyze/tasks/status-count":
        return "api/analyze/tasks/status-count.md"
    if path == "/api/analyze/tasks/cleanup-timeout":
        return "api/analyze/tasks/cleanup-timeout.md"
    if path == "/api/analyze/tasks/{task_id}":
        return "api/analyze/tasks/[task_id]/index.md"
    if path == "/api/analyze/tasks/{task_id}/result":
        return "api/analyze/tasks/[task_id]/result.md"
    if path == "/api/analyze-text":
        return "api/analyze-text/index.md"
    if path == "/api/analyze-text/submit":
        return "api/analyze-text/submit.md"
    if path == "/api/precision-sessions/{session_id}/continue":
        return "api/precision-sessions/[session_id]/continue.md"
    if path == "/api/upload-analyze-image":
        return "api/upload-analyze-image/index.md"
    if path == "/api/upload-analyze-image-file":
        return "api/upload-analyze-image-file/index.md"
    if path == "/api/food-nutrition/search":
        return "api/food-nutrition/search.md"
    if path == "/api/food-nutrition/unresolved/top":
        return "api/food-nutrition/unresolved-top.md"
    if path.startswith("/api/location/"):
        return f"api/location/{path.split('/')[-1]}.md"
    if path == "/api/user/profile":
        return "api/user/profile.md"
    if path == "/api/user/record-days":
        return "api/user/record-days.md"
    if path == "/api/user/last-seen-analyze-history":
        return "api/user/last-seen-analyze-history.md"
    if path == "/api/user/bind-phone":
        return "api/user/bind-phone.md"
    if path == "/api/user/upload-avatar":
        return "api/user/upload-avatar.md"
    if path == "/api/user/dashboard-targets":
        return "api/user/dashboard-targets.md"
    if path == "/api/user/health-profile":
        return "api/user/health-profile/index.md"
    if path.startswith("/api/user/health-profile/"):
        leaf = path.split("/")[-1]
        return f"api/user/health-profile/{leaf}.md"
    if path == "/api/membership/plans":
        return "api/membership/plans.md"
    if path == "/api/membership/me":
        return "api/membership/me.md"
    if path == "/api/membership/rewards/share-poster/claim":
        return "api/membership/rewards-share-poster-claim.md"
    if path == "/api/membership/pay/create":
        return "api/membership/pay-create.md"
    if path == "/api/payment/wechat/notify/membership":
        return "api/payment/wechat-notify-membership.md"
    if path == "/api/manual-food/search":
        return "api/manual-food/search.md"
    if path == "/api/manual-food/browse":
        return "api/manual-food/browse.md"
    if path == "/api/critical-samples":
        return "api/food-record/critical-samples.md"
    if path == "/api/food-record/save":
        return "api/food-record/save.md"
    if path == "/api/food-record/list":
        return "api/food-record/list.md"
    if path == "/api/food-record/share/{record_id}":
        return "api/food-record/share/[record_id].md"
    if path == "/api/food-record/{record_id}":
        return "api/food-record/[record_id].md"
    if path.startswith("/api/body-metrics/"):
        leaf = path.split("/")[-1].replace("/", "-")
        if path.endswith("/water/reset"):
            return "api/body-metrics/water-reset.md"
        return f"api/body-metrics/{leaf}.md"
    if path == "/api/expiry/dashboard":
        return "api/expiry/dashboard.md"
    if path == "/api/expiry/recognize":
        return "api/expiry/recognize.md"
    if path == "/api/expiry/items":
        return "api/expiry/items/index.md"
    if path == "/api/expiry/items/{item_id}":
        return "api/expiry/items/[item_id].md"
    if path == "/api/expiry/items/{item_id}/status":
        return "api/expiry/items/[item_id]-status.md"
    if path == "/api/expiry/items/{item_id}/subscribe":
        return "api/expiry/items/[item_id]-subscribe.md"
    if path == "/api/home/dashboard":
        return "api/home/dashboard.md"
    if path == "/api/stats/summary":
        return "api/stats/summary.md"
    if path == "/api/stats/insight/generate":
        return "api/stats/insight-generate.md"
    if path == "/api/stats/insight/save":
        return "api/stats/insight-save.md"
    if path.startswith("/api/friend/invite/profile/{"):
        return "api/friend/invite/profile-[user_id].md"
    if path == "/api/friend/invite/profile-by-code":
        return "api/friend/invite/profile-by-code.md"
    if path == "/api/friend/invite/resolve":
        return "api/friend/invite/resolve.md"
    if path == "/api/friend/invite/accept":
        return "api/friend/invite/accept.md"
    if path == "/api/friend/search":
        return "api/friend/search.md"
    if path == "/api/friend/request":
        return "api/friend/request.md"
    if path == "/api/friend/requests":
        return "api/friend/requests.md"
    if path == "/api/friend/requests/all":
        return "api/friend/requests-all.md"
    if path == "/api/friend/request/{request_id}":
        return "api/friend/request/[request_id].md"
    if path == "/api/friend/request/{request_id}/respond":
        return "api/friend/request/[request_id]-respond.md"
    if path == "/api/friend/list":
        return "api/friend/list.md"
    if path == "/api/friend/count":
        return "api/friend/count.md"
    if path == "/api/friend/cleanup-duplicates":
        return "api/friend/cleanup-duplicates.md"
    if path == "/api/friend/{friend_id}":
        return "api/friend/[friend_id].md"
    if path == "/api/community/public-feed":
        return "api/community/public-feed.md"
    if path == "/api/community/feed":
        return "api/community/feed.md"
    if path == "/api/community/checkin-leaderboard":
        return "api/community/checkin-leaderboard.md"
    if path == "/api/community/comment-tasks":
        return "api/community/comment-tasks.md"
    if path == "/api/community/notifications":
        return "api/community/notifications.md"
    if path == "/api/community/notifications/read":
        return "api/community/notifications.md"
    if path == "/api/community/feed/{record_id}/like":
        return "api/community/feed/[record_id]-like.md"
    if path == "/api/community/feed/{record_id}/hide":
        return "api/community/feed/[record_id]-hide.md"
    if path == "/api/community/feed/{record_id}/comments":
        return "api/community/feed/[record_id]-comments.md"
    if path == "/api/community/feed/{record_id}/context":
        return "api/community/feed/[record_id]-context.md"
    if path == "/api/public-food-library":
        return "api/public-food-library/index.md"
    if path == "/api/public-food-library/mine":
        return "api/public-food-library/mine.md"
    if path == "/api/public-food-library/collections":
        return "api/public-food-library/collections.md"
    if path == "/api/public-food-library/feedback":
        return "api/public-food-library/feedback.md"
    if path == "/api/public-food-library/{item_id}":
        return "api/public-food-library/[item_id].md"
    if path == "/api/public-food-library/{item_id}/like":
        return "api/public-food-library/[item_id]-like.md"
    if path == "/api/public-food-library/{item_id}/collect":
        return "api/public-food-library/[item_id]-collect.md"
    if path == "/api/public-food-library/{item_id}/comments":
        return "api/public-food-library/[item_id]-comments.md"
    if path == "/api/qrcode":
        return "api/qrcode/index.md"
    if path == "/api/login":
        return "api/login/index.md"
    if path == "/api/recipes":
        return "api/recipes/index.md"
    if path == "/api/recipes/count":
        return "api/recipes/count.md"
    if path == "/api/recipes/{recipe_id}":
        return "api/recipes/[recipe_id].md"
    if path == "/api/recipes/{recipe_id}/use":
        return "api/recipes/[recipe_id]-use.md"
    if path == "/api/exercise-calories/daily":
        return "api/exercise-calories/daily.md"
    if path == "/api/exercise-logs":
        return "api/exercise-logs/index.md"
    if path == "/api/exercise-logs/estimate-calories":
        return "api/exercise-logs/estimate-calories.md"
    if path == "/api/exercise-logs/{log_id}":
        return "api/exercise-logs/[log_id].md"
    if path.startswith("/api/test-backend/login") or path.startswith("/api/test-backend/logout"):
        return "internal/test-backend/auth.md"
    if path == "/api/test-backend/analyze":
        return "internal/test-backend/analyze.md"
    if path.startswith("/api/test-backend/datasets"):
        return "internal/test-backend/datasets.md"
    if path.startswith("/api/test-backend/batch"):
        return "internal/test-backend/batches.md"
    if path.startswith("/api/test/"):
        return "internal/test-backend/legacy-test-api.md"
    if path.startswith("/api/prompts"):
        return "internal/test-backend/prompts.md"
    if path == "/api":
        return "non-api/api-root.md"
    if path == "/api/health":
        return "non-api/health.md"
    if path == "/map-picker":
        return "non-api/map-picker.md"
    if path in {"/test-backend", "/test-backend/login"}:
        return "internal/test-backend/html-pages.md"
    if path == "/ws/stats/insight":
        return "api/stats/websocket-insight.md"
    raise ValueError(f"Unhandled route path: {path}")


def build_route_title(doc_rel: str) -> str:
    name = Path(doc_rel).stem
    return name.replace("-", " ").replace("[", "").replace("]", "").title()


def group_routes(routes: List[RouteInfo]) -> Dict[str, List[RouteInfo]]:
    docs: Dict[str, List[RouteInfo]] = defaultdict(list)
    for route in routes:
        route.doc_path = route_doc_path(route)
        docs[route.doc_path].append(route)
    return docs


def markdown_list(values: Iterable[str], default: str = "None") -> str:
    vals = [value for value in values if value]
    if not vals:
        return default
    return ", ".join(sorted(dict.fromkeys(vals)))


def build_purpose(routes: List[RouteInfo]) -> str:
    surface = routes[0].path
    if surface.startswith("/api/analyze"):
        return "Covers food analysis submission, task lookup, and result mutation behavior used by the mini program and worker pipeline."
    if surface.startswith("/api/user/health-profile"):
        return "Covers health profile read/write and OCR-related subflows that enrich analysis and onboarding."
    if surface.startswith("/api/test-backend"):
        return "Covers internal test-backend routes used by the backend-only evaluation console."
    if surface.startswith("/api/prompts"):
        return "Covers internal prompt management routes used by the test backend and prompt experiments."
    if surface.startswith("/ws/"):
        return "Documents the backend-exposed WebSocket surface and its server-side generation flow."
    if surface.startswith("/map-picker") or surface.startswith("/test-backend"):
        return "Documents non-API pages served directly by the backend process."
    return "Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior."


def build_route_doc(doc_rel: str, routes: List[RouteInfo], model_fields: Dict[str, List[str]]) -> str:
    routes = sorted(routes, key=lambda item: (item.path, item.method))
    primary = routes[0]
    route_path = primary.path if len({route.path for route in routes}) == 1 else ", ".join(sorted({route.path for route in routes}))
    methods = sorted({route.method for route in routes})
    auth_types = sorted({route.auth_type for route in routes})
    frontend_usage = sorted({route.frontend_usage for route in routes})
    request_models = sorted({model for route in routes for model in route.request_models})
    response_models = sorted({route.response_model for route in routes if route.response_model})
    db_dependencies = sorted({dep for route in routes for dep in route.db_dependencies})
    worker_dependencies = sorted({dep for route in routes for dep in route.worker_dependencies})
    external_dependencies = sorted({dep for route in routes for dep in route.external_dependencies})
    source_refs = sorted({ref for route in routes for ref in route.source_refs})
    title = build_route_title(doc_rel)

    matrix_rows = []
    for route in routes:
        matrix_rows.append(
            f"| `{route.method}` | `{route.path}` | `{route.handler}` | `{route.auth_type}` | `{route.response_model or 'implicit'}` | `{route.source_refs[0]}` |"
        )
    request_blocks = []
    for route in routes:
        model_detail = "None"
        if route.request_models:
            parts = []
            for model in route.request_models:
                fields = model_fields.get(model, [])
                parts.append(f"`{model}` ({', '.join(fields[:12]) or 'no direct fields found'})")
            model_detail = "; ".join(parts)
        request_blocks.append(f"- `{route.method} {route.path}`: {model_detail}")

    response_blocks = []
    for route in routes:
        resp = route.response_model or "Implicit JSON/dict response"
        response_blocks.append(f"- `{route.method} {route.path}`: {resp}")

    flow_blocks = []
    for route in routes:
        bullets = []
        if route.db_dependencies:
            bullets.append(f"reads/writes via `{', '.join(route.db_dependencies[:8])}`")
        if route.worker_dependencies or route.async_task:
            worker_text = ", ".join(route.worker_dependencies[:8]) if route.worker_dependencies else "analysis_tasks / worker queue"
            bullets.append(f"worker or async pipeline touchpoint: `{worker_text}`")
        if route.local_dependencies:
            bullets.append(f"local helper chain includes `{', '.join(route.local_dependencies[:8])}`")
        if not bullets:
            bullets.append("mostly self-contained in the handler body")
        flow_blocks.append(f"- `{route.method} {route.path}`: " + "; ".join(bullets))

    error_blocks = []
    for route in routes:
        statuses = route.error_statuses or []
        detail = ", ".join(str(code) for code in statuses) if statuses else "No static `HTTPException(...)` status found; inspect handler branches manually."
        error_blocks.append(f"- `{route.method} {route.path}`: {detail}")

    frontend_blocks = []
    for route in routes:
        callers = ", ".join(sorted(set(route.frontend_callers))) if route.frontend_callers else "No mini program caller found in current scan."
        frontend_blocks.append(f"- `{route.method} {route.path}`: `{route.frontend_usage}`; callers: {callers}")

    migration_blocks = []
    for route in routes:
        notes = []
        if route.async_task:
            notes.append("preserve async task semantics and queue contract")
        if route.auth_type == "test_backend_cookie":
            notes.append("cookie-based test backend auth should not be merged into JWT auth by accident")
        if route.path == "/api/payment/wechat/notify/membership":
            notes.append("WeChat callback shape and signature validation are externally constrained")
        if route.path.startswith("/ws/"):
            notes.append("current implementation uses query params instead of the shared JWT dependency")
        if not notes:
            notes.append("check implicit response shape before reimplementation because many handlers do not declare `response_model`")
        migration_blocks.append(f"- `{route.method} {route.path}`: " + "; ".join(notes))

    open_questions = []
    if any(route.frontend_usage == "backend-only" for route in routes):
        open_questions.append("- Current scan found no mini program caller for at least one route in this document; verify real operator/test caller before rewrite.")
    if any(route.frontend_usage == "internal-only" for route in routes):
        open_questions.append("- Internal/test-backend routes should likely remain isolated from the public business API surface in the rewrite.")
    if not open_questions:
        open_questions.append("- No additional drift was detected for this route document beyond normal implicit-response ambiguity.")

    return textwrap.dedent(
        f"""\
        ---
        route_path: "{route_path}"
        methods: [{", ".join(f'"{method}"' for method in methods)}]
        auth_type: [{", ".join(f'"{auth}"' for auth in auth_types)}]
        frontend_usage: [{", ".join(f'"{usage}"' for usage in frontend_usage)}]
        handler_refs: [{", ".join(f'"backend/main.py:{route.lineno}"' for route in routes)}]
        request_models: [{", ".join(f'"{model}"' for model in request_models)}]
        response_models: [{", ".join(f'"{model}"' for model in response_models)}]
        db_dependencies: [{", ".join(f'"{dep}"' for dep in db_dependencies)}]
        worker_dependencies: [{", ".join(f'"{dep}"' for dep in worker_dependencies)}]
        external_dependencies: [{", ".join(f'"{dep}"' for dep in external_dependencies)}]
        source_refs: [{", ".join(f'"{ref}"' for ref in source_refs)}]
        ---

        # {title}

        ## Purpose

        {build_purpose(routes)}

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        {"\n".join(matrix_rows)}

        ## Request Contract

        {"\n".join(request_blocks)}

        ## Response Contract

        {"\n".join(response_blocks)}

        ## Main Flow

        {"\n".join(flow_blocks)}

        ## Dependencies & Side Effects

        - Database dependencies: {markdown_list(db_dependencies)}
        - Worker dependencies: {markdown_list(worker_dependencies)}
        - External dependencies: {markdown_list(external_dependencies)}
        - Local helper chain: {markdown_list([dep for route in routes for dep in route.local_dependencies])}

        ## Data Reads/Writes

        - This document touches database helpers: {markdown_list(db_dependencies)}
        - Async / worker-sensitive flow: {"Yes" if any(route.async_task for route in routes) else "No direct async task creation detected"}

        ## Error Cases

        {"\n".join(error_blocks)}

        ## Frontend Usage

        {"\n".join(frontend_blocks)}

        ## Migration Notes

        {"\n".join(migration_blocks)}

        ## Open Questions / Drift

        {"\n".join(open_questions)}
        """
    )


def build_route_map(routes: List[RouteInfo]) -> str:
    rows = []
    for route in sorted(routes, key=lambda item: (item.path, item.method)):
        rows.append(
            f"| `{route.method}` | `{route.path}` | `{route.handler}` | `{route.auth_type}` | `{route.frontend_usage}` | [{route.doc_path}]({route.doc_path}) |"
        )
    return textwrap.dedent(
        f"""\
        # Route Map

        This index lists every backend surface discovered in `backend/main.py`, including `/api/*`, the WebSocket surface, and backend-served non-API pages.

        - API routes discovered: `{sum(1 for route in routes if route.path.startswith('/api/'))}`
        - WebSocket routes discovered: `{sum(1 for route in routes if route.path.startswith('/ws/'))}`
        - Non-API page routes discovered: `{sum(1 for route in routes if not route.path.startswith('/api/') and not route.path.startswith('/ws/'))}`

        | Method | Path | Handler | Auth | Frontend Usage | Doc |
        | --- | --- | --- | --- | --- | --- |
        {"\n".join(rows)}
        """
    )


def build_coverage_matrix(routes: List[RouteInfo], unmatched: List[FrontendCall]) -> str:
    rows = []
    for route in sorted(routes, key=lambda item: (item.frontend_usage, item.path, item.method)):
        callers = "<br>".join(sorted(set(route.frontend_callers))) if route.frontend_callers else "-"
        rows.append(
            f"| `{route.method}` | `{route.path}` | yes | `{route.frontend_usage}` | {callers} | `{route.auth_type}` | {'yes' if route.async_task else 'no'} | {'yes' if route.internal_only else 'no'} | [{route.doc_path}]({route.doc_path}) |"
        )

    gap_rows = []
    seen_gaps = set()
    for call in unmatched:
        pretty_path = call.normalized_path
        if pretty_path == "/api/food-record/{}/poster-calorie-compare":
            pretty_path = "/api/food-record/{record_id}/poster-calorie-compare"
        elif pretty_path == "/api/community/feed/{}/comments/{}":
            pretty_path = "/api/community/feed/{record_id}/comments/{comment_id}"
        gap_key = (call.method, pretty_path, call.caller)
        if gap_key in seen_gaps:
            continue
        seen_gaps.add(gap_key)
        gap_rows.append(
            f"| `{call.method}` | `{pretty_path}` | no | `frontend-missing-backend` | `{call.caller}` | n/a | n/a | no | gap |"
        )

    return textwrap.dedent(
        f"""\
        # Coverage Matrix

        This matrix cross-checks the backend surface against the mini program request surface gathered from `src/utils/api.ts` and direct `Taro.request(...)` callers.

        ## Backend Surfaces

        | Method | Path | Backend Exists | Frontend Usage | Mini Program Callers | Auth | Async Task | Internal Only | Doc |
        | --- | --- | --- | --- | --- | --- | --- | --- | --- |
        {"\n".join(rows)}

        ## Frontend Calls Without Matching Backend Route

        | Method | Path | Backend Exists | Frontend Usage | Mini Program Caller | Auth | Async Task | Internal Only | Doc |
        | --- | --- | --- | --- | --- | --- | --- | --- | --- |
        {"\n".join(gap_rows) if gap_rows else "| - | - | - | - | - | - | - | - | - |"}
        """
    )


def build_shared_docs(routes: List[RouteInfo], model_fields: Dict[str, List[str]], model_lines: Dict[str, Tuple[int, int]]) -> Dict[str, str]:
    shared: Dict[str, str] = {}
    shared["README.md"] = textwrap.dedent(
        """\
        # Backend API PRD Collection

        This directory is a migration-oriented documentation set for the current backend implementation.

        It is organized around:

        - route-mirrored documents under `api/`, `internal/`, and `non-api/`
        - shared facts under `_shared/`
        - cross-check control files: `ROUTE_MAP.md` and `COVERAGE_MATRIX.md`

        Reading order:

        1. `ROUTE_MAP.md`
        2. `COVERAGE_MATRIX.md`
        3. `_shared/*`
        4. route documents for the domain being rewritten
        """
    )
    shared["_shared/auth.md"] = textwrap.dedent(
        """\
        # Auth

        Current auth entry points:

        - `jwt_required`: `get_current_user_info(...)` in `backend/middleware.py`
        - `jwt_optional`: `get_optional_user_info(...)` in `backend/middleware.py`
        - `test_backend_cookie`: `require_test_backend_auth(...)` in `backend/main.py`
        - `public`: no shared auth dependency found on the handler

        Supporting source:

        - `backend/middleware.py`
        - `backend/auth.py`

        Notes:

        - Business APIs mostly use Bearer JWT in `Authorization`.
        - Test backend routes use `test_backend_token` cookie and in-memory sessions.
        - WebSocket `/ws/stats/insight` currently does not use the JWT dependency path.
        """
    )
    shared["_shared/dependency-patterns.md"] = textwrap.dedent(
        """\
        # Dependency Patterns

        Shared implementation patterns seen in the current backend:

        - Route handlers live in `backend/main.py`
        - Database and storage operations are centralized in `backend/database.py`
        - Background task execution is centralized in `backend/worker.py`
        - `run_backend.py` is the full runtime entry because it starts workers before Uvicorn
        - Several handlers mix validation, orchestration, and response shaping inline

        Practical migration implication:

        - Preserve route contracts first
        - Preserve async task semantics second
        - Refactor internal layering only after endpoint behavior is frozen
        """
    )
    shared["_shared/async-pipeline.md"] = textwrap.dedent(
        """\
        # Async Pipeline

        The current backend runtime is not HTTP-only.

        Worker-sensitive flows include:

        - food analysis submit / task polling
        - text food analysis submit / task polling
        - precision planning / item estimate / aggregate
        - health report extraction tasks
        - comment moderation tasks
        - expiry notification jobs
        - exercise async fallback tasks

        Primary runtime source:

        - `backend/run_backend.py`
        - `backend/worker.py`
        - task helpers in `backend/database.py`
        """
    )
    shared["_shared/errors.md"] = textwrap.dedent(
        """\
        # Errors

        Current error behavior is partially explicit and partially implicit.

        Common patterns:

        - `401` for missing/invalid auth
        - `404` for missing records/resources
        - `400` for validation and business rule failures
        - schema-readiness guards for precision / analysis task related tables
        - many handlers return implicit JSON dicts without declared `response_model`

        Migration note:

        - Treat current successful payload shape as a compatibility surface even when it is not formally declared.
        """
    )
    shared["_shared/external-services.md"] = textwrap.dedent(
        """\
        # External Services

        Current external integrations visible from the code:

        - Supabase database
        - Supabase storage / uploaded asset URLs
        - WeChat login / phone / QR / payment callback surfaces
        - Tianditu search and reverse geocoding
        - LLM-backed analysis and OCR flows
        - Optional OpenTelemetry instrumentation
        """
    )
    shared["_shared/extraction-rules.md"] = textwrap.dedent(
        """\
        # Extraction Rules

        This document set was generated from code facts plus lightweight heuristics.

        Auto-derived facts:

        - path, method, handler name, source line
        - auth dependency type
        - request model names
        - declared `response_model`
        - direct database helper calls
        - direct worker helper calls
        - detected `HTTPException(status_code=...)`
        - mini program caller matches

        Manual interpretation still required for:

        - implicit response field shapes
        - deep business rules
        - hidden coupling through local helpers
        - operational callers for backend-only routes
        """
    )

    model_groups = {
        "_shared/models/analyze.md": ["AnalyzeRequest", "AnalyzeResponse", "AnalyzeBatchRequest", "AnalyzeBatchResponse", "AnalyzeTextRequest", "AnalyzeTextSubmitRequest", "AnalyzeSubmitRequest", "ContinuePrecisionSessionRequest"],
        "_shared/models/user-membership.md": ["LoginRequest", "LoginResponse", "MembershipPlanResponse", "MembershipStatusResponse", "ClaimSharePosterRewardRequest", "ClaimSharePosterRewardResponse", "CreateMembershipPaymentRequest", "CreateMembershipPaymentResponse", "UpdateUserInfoRequest", "BindPhoneRequest", "UploadAvatarRequest"],
        "_shared/models/health-expiry.md": ["HealthProfileUpdateRequest", "DashboardTargetsUpdateRequest", "UploadReportImageRequest", "SubmitReportExtractionTaskRequest", "HealthReportOcrRequest", "FoodExpiryItemUpsertRequest", "FoodExpiryRecognitionRequest", "FoodExpiryStatusUpdateRequest", "FoodExpirySubscribeRequest"],
        "_shared/models/social-public-food.md": ["FriendInviteAcceptRequest", "CommunityCommentCreateRequest", "MarkFeedNotificationsReadRequest", "PublicFoodLibraryCreateRequest"],
        "_shared/models/recipes-exercise.md": ["CreateRecipeRequest", "UpdateRecipeRequest", "UseRecipeRequest", "ExerciseCaloriesEstimateRequest", "ExerciseLogResponse"],
        "_shared/models/internal-test-backend.md": ["PromptCreate", "PromptUpdate", "TestBackendLoginRequest", "TestBackendLocalDatasetImportRequest"],
    }
    for rel, names in model_groups.items():
        lines = ["# " + Path(rel).stem.replace("-", " ").title(), "", "| Model | Fields | Source |", "| --- | --- | --- |"]
        for name in names:
            fields = ", ".join(model_fields.get(name, [])) or "Not found in current scan"
            source = "Not found"
            if name in model_lines:
                start, _ = model_lines[name]
                source = f"`backend/main.py:{start}`"
            lines.append(f"| `{name}` | {fields} | {source} |")
        shared[rel] = "\n".join(lines) + "\n"

    shared["_shared/tables/analysis_tasks.md"] = textwrap.dedent(
        """\
        # analysis_tasks

        This table family underpins async analysis and several worker-driven flows.

        Reference materials:

        - `backend/database/analysis_tasks.sql`
        - `docs/数据库实库Schema分析报告.md`
        """
    )
    shared["_shared/tables/weapp_user.md"] = textwrap.dedent(
        """\
        # weapp_user

        Primary user/account profile data referenced by login, profile, friendship, and membership flows.

        Reference materials:

        - `backend/database/weapp_data.sql`
        - `docs/public-schema-字段明细版-2026-04-27.md`
        """
    )
    shared["_shared/tables/user_food_records.md"] = textwrap.dedent(
        """\
        # user_food_records

        Primary record table for saved food records, feed projection, and several stats/home computations.

        Reference materials:

        - `backend/database/user_food_records.sql`
        - `backend/database/user_food_records_source_task.sql`
        """
    )
    shared["_shared/tables/public_food_library.md"] = textwrap.dedent(
        """\
        # public_food_library

        Shared public food library and related social interaction tables.

        Reference materials:

        - `backend/database/public_food_library.sql`
        - `backend/database/public_food_library_comments.sql`
        - `backend/database/public_food_library_feedback.sql`
        """
    )
    shared["_shared/tables/memberships.md"] = textwrap.dedent(
        """\
        # memberships

        Membership-related data spans plan config, payment records, and user membership materialization.

        Reference materials:

        - `backend/database/membership_plan_config_seed.sql`
        - membership-related SQL files under `backend/sql/`
        """
    )
    return shared


def build_gap_docs(unmatched: List[FrontendCall]) -> Dict[str, str]:
    docs = {}
    poster = next((call for call in unmatched if "poster-calorie-compare" in call.normalized_path), None)
    if poster:
        docs["api/food-record/poster-calorie-compare-gap.md"] = textwrap.dedent(
            f"""\
            ---
            route_path: "/api/food-record/{{record_id}}/poster-calorie-compare"
            methods: ["GET"]
            auth_type: ["unknown-from-frontend", "likely-jwt_required"]
            frontend_usage: ["frontend-missing-backend"]
            handler_refs: []
            request_models: []
            response_models: []
            db_dependencies: []
            worker_dependencies: []
            external_dependencies: []
            source_refs: ["{poster.file_ref}"]
            ---

            # Poster Calorie Compare Gap

            ## Purpose

            Records the current drift where the mini program calls a poster calorie compare endpoint, but no matching FastAPI route was found in `backend/main.py`.

            ## Route Matrix

            | Method | Path | Backend Exists | Frontend Caller |
            | --- | --- | --- | --- |
            | `GET` | `/api/food-record/{{record_id}}/poster-calorie-compare` | no | `{poster.caller}` |

            ## Request Contract

            - Frontend builds the path dynamically from `recordId`.
            - Frontend includes Bearer auth when a token exists.

            ## Response Contract

            - Frontend expects either a structured compare payload or `null` on non-200.
            - Exact backend contract is currently missing from the live codebase.

            ## Main Flow

            - Current state is a route drift rather than an implemented flow.

            ## Dependencies & Side Effects

            - Expected to depend on record data plus dashboard target logic.

            ## Data Reads/Writes

            - No current backend implementation found to confirm read/write behavior.

            ## Error Cases

            - Current practical failure mode is “route missing / unmatched implementation”.

            ## Frontend Usage

            - Caller: `{poster.caller}`
            - Status: `frontend-missing-backend`

            ## Migration Notes

            - Decide during rewrite whether to implement this endpoint or remove the frontend feature path.

            ## Open Questions / Drift

            - Was this endpoint removed from the backend and left in the client, or is it expected but never implemented?
            """
        )
    comment_delete = next((call for call in unmatched if "/api/community/feed/{}/comments/{}" in call.normalized_path), None)
    if comment_delete:
        docs["api/community/feed/[record_id]-comment-[comment_id]-gap.md"] = textwrap.dedent(
            f"""\
            ---
            route_path: "/api/community/feed/{{record_id}}/comments/{{comment_id}}"
            methods: ["DELETE"]
            auth_type: ["unknown-from-frontend", "likely-jwt_required"]
            frontend_usage: ["frontend-missing-backend"]
            handler_refs: []
            request_models: []
            response_models: []
            db_dependencies: []
            worker_dependencies: []
            external_dependencies: []
            source_refs: ["{comment_delete.file_ref}"]
            ---

            # Community Comment Delete Gap

            ## Purpose

            Records the current drift where the mini program has a delete-comment request path, but no matching FastAPI delete route was found.

            ## Route Matrix

            | Method | Path | Backend Exists | Frontend Caller |
            | --- | --- | --- | --- |
            | `DELETE` | `/api/community/feed/{{record_id}}/comments/{{comment_id}}` | no | `{comment_delete.caller}` |

            ## Request Contract

            - Frontend builds the path dynamically from `recordId` and `commentId`.
            - Frontend expects auth and a delete result payload.

            ## Response Contract

            - Frontend expects `{{ deleted: number }}` on success.

            ## Main Flow

            - Current state is a route drift rather than an implemented backend flow.

            ## Dependencies & Side Effects

            - Expected future implementation would touch feed comment ownership / cascading delete logic.

            ## Data Reads/Writes

            - No current backend implementation found to confirm delete semantics.

            ## Error Cases

            - Current practical failure mode is “route missing / unmatched implementation”.

            ## Frontend Usage

            - Caller: `{comment_delete.caller}`
            - Status: `frontend-missing-backend`

            ## Migration Notes

            - Decide during rewrite whether to add the delete endpoint or remove/hide the client action.

            ## Open Questions / Drift

            - The client still exposes delete-comment behavior, but the current backend route set does not.
            """
        )
    return docs


def build_non_api_summary(routes: List[RouteInfo]) -> str:
    rows = []
    for route in sorted([route for route in routes if route.path in {"/api", "/api/health", "/map-picker", "/test-backend", "/test-backend/login"}], key=lambda item: item.path):
        rows.append(f"| `{route.method}` | `{route.path}` | `{route.handler}` | `{route.frontend_usage}` |")
    return textwrap.dedent(
        f"""\
        ---
        route_path: "non-api-summary"
        methods: ["GET"]
        auth_type: ["mixed"]
        frontend_usage: ["backend-only", "internal-only"]
        handler_refs: []
        request_models: []
        response_models: []
        db_dependencies: []
        worker_dependencies: []
        external_dependencies: []
        source_refs: ["backend/main.py", "backend/run_backend.py"]
        ---

        # Non API Summary

        ## Purpose

        Summarizes backend-served pages and health-style non-business endpoints outside the main `/api/*` business tree.

        ## Route Matrix

        | Method | Path | Handler | Frontend Usage |
        | --- | --- | --- | --- |
        {"\n".join(rows)}

        ## Frontend Usage

        - `/map-picker` is intended for web-view embedding.
        - `/test-backend*` belongs to the internal test console.
        - `/api` and `/api/health` are backend-only operational surfaces.
        """
    )


def main() -> None:
    routes, model_fields, model_lines = parse_main()
    frontend_calls = detect_frontend_calls()
    unmatched = match_frontend_usage(routes, frontend_calls)
    grouped = group_routes(routes)

    if DOCS_ROOT.exists():
        # Keep non-generated manual docs only if they already live outside target tree.
        pass
    ensure_dir(DOCS_ROOT)

    for rel, content in build_shared_docs(routes, model_fields, model_lines).items():
        write(DOCS_ROOT / rel, content)

    write(DOCS_ROOT / "ROUTE_MAP.md", build_route_map(routes))
    write(DOCS_ROOT / "COVERAGE_MATRIX.md", build_coverage_matrix(routes, unmatched))

    for doc_rel, doc_routes in grouped.items():
        write(DOCS_ROOT / doc_rel, build_route_doc(doc_rel, doc_routes, model_fields))

    for rel, content in build_gap_docs(unmatched).items():
        write(DOCS_ROOT / rel, content)

    # Non-API summary companion requested by the plan.
    write(DOCS_ROOT / "non-api/test-backend-ui.md", build_non_api_summary(routes))


if __name__ == "__main__":
    main()
