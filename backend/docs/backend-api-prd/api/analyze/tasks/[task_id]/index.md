        ---
        route_path: "/api/analyze/tasks/{task_id}"
        methods: ["DELETE", "GET"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:4737", "backend/main.py:4642"]
        request_models: []
        response_models: []
        db_dependencies: []
        worker_dependencies: []
        external_dependencies: []
        source_refs: ["backend/main.py:4642", "backend/main.py:4737"]
        ---

        # Index

        ## Purpose

        Covers food analysis submission, task lookup, and result mutation behavior used by the mini program and worker pipeline.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `DELETE` | `/api/analyze/tasks/{task_id}` | `delete_analyze_task` | `jwt_required` | `implicit` | `backend/main.py:4737` |
| `GET` | `/api/analyze/tasks/{task_id}` | `get_analyze_task` | `jwt_required` | `implicit` | `backend/main.py:4642` |

        ## Request Contract

        - `DELETE /api/analyze/tasks/{task_id}`: None
- `GET /api/analyze/tasks/{task_id}`: None

        ## Response Contract

        - `DELETE /api/analyze/tasks/{task_id}`: Implicit JSON/dict response
- `GET /api/analyze/tasks/{task_id}`: Implicit JSON/dict response

        ## Main Flow

        - `DELETE /api/analyze/tasks/{task_id}`: mostly self-contained in the handler body
- `GET /api/analyze/tasks/{task_id}`: local helper chain includes `_trace_add_event, _trace_record_error`

        ## Dependencies & Side Effects

        - Database dependencies: None
        - Worker dependencies: None
        - External dependencies: None
        - Local helper chain: _trace_add_event, _trace_record_error

        ## Data Reads/Writes

        - This document touches database helpers: None
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `DELETE /api/analyze/tasks/{task_id}`: 404, 500
- `GET /api/analyze/tasks/{task_id}`: 403, 404, 500

        ## Frontend Usage

        - `DELETE /api/analyze/tasks/{task_id}`: `miniapp-used`; callers: src/utils/api.ts:deleteAnalysisTask
- `GET /api/analyze/tasks/{task_id}`: `miniapp-used`; callers: src/utils/api.ts:getAnalyzeTask

        ## Migration Notes

        - `DELETE /api/analyze/tasks/{task_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `GET /api/analyze/tasks/{task_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
