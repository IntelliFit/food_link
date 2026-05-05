        ---
        route_path: "/api/test-backend/datasets, /api/test-backend/datasets/import-local, /api/test-backend/datasets/{dataset_id}/prepare"
        methods: ["GET", "POST"]
        auth_type: ["test_backend_cookie"]
        frontend_usage: ["internal-only"]
        handler_refs: ["backend/main.py:11716", "backend/main.py:11728", "backend/main.py:11799"]
        request_models: ["TestBackendLocalDatasetImportRequest"]
        response_models: []
        db_dependencies: ["create_test_backend_dataset", "get_test_backend_dataset", "insert_test_backend_dataset_items", "list_test_backend_dataset_items", "list_test_backend_datasets"]
        worker_dependencies: []
        external_dependencies: ["Supabase", "Supabase Storage"]
        source_refs: ["backend/main.py:11716", "backend/main.py:11728", "backend/main.py:11799"]
        ---

        # Datasets

        ## Purpose

        Covers internal test-backend routes used by the backend-only evaluation console.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/test-backend/datasets` | `test_backend_list_datasets` | `test_backend_cookie` | `implicit` | `backend/main.py:11716` |
| `POST` | `/api/test-backend/datasets/import-local` | `test_backend_import_local_dataset` | `test_backend_cookie` | `implicit` | `backend/main.py:11728` |
| `POST` | `/api/test-backend/datasets/{dataset_id}/prepare` | `test_backend_prepare_dataset_batch` | `test_backend_cookie` | `implicit` | `backend/main.py:11799` |

        ## Request Contract

        - `GET /api/test-backend/datasets`: None
- `POST /api/test-backend/datasets/import-local`: `TestBackendLocalDatasetImportRequest` (name, source_dir, description)
- `POST /api/test-backend/datasets/{dataset_id}/prepare`: None

        ## Response Contract

        - `GET /api/test-backend/datasets`: Implicit JSON/dict response
- `POST /api/test-backend/datasets/import-local`: Implicit JSON/dict response
- `POST /api/test-backend/datasets/{dataset_id}/prepare`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/test-backend/datasets`: reads/writes via `list_test_backend_datasets`; local helper chain includes `_serialize_test_backend_dataset`
- `POST /api/test-backend/datasets/import-local`: reads/writes via `create_test_backend_dataset, insert_test_backend_dataset_items`; local helper chain includes `_scan_test_backend_local_dataset_dir, _serialize_test_backend_dataset`
- `POST /api/test-backend/datasets/{dataset_id}/prepare`: reads/writes via `get_test_backend_dataset, list_test_backend_dataset_items`; local helper chain includes `_build_test_backend_batch_from_dataset, _serialize_test_backend_batch`

        ## Dependencies & Side Effects

        - Database dependencies: create_test_backend_dataset, get_test_backend_dataset, insert_test_backend_dataset_items, list_test_backend_dataset_items, list_test_backend_datasets
        - Worker dependencies: None
        - External dependencies: Supabase, Supabase Storage
        - Local helper chain: _build_test_backend_batch_from_dataset, _scan_test_backend_local_dataset_dir, _serialize_test_backend_batch, _serialize_test_backend_dataset

        ## Data Reads/Writes

        - This document touches database helpers: create_test_backend_dataset, get_test_backend_dataset, insert_test_backend_dataset_items, list_test_backend_dataset_items, list_test_backend_datasets
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /api/test-backend/datasets`: 500
- `POST /api/test-backend/datasets/import-local`: 400
- `POST /api/test-backend/datasets/{dataset_id}/prepare`: 400, 404

        ## Frontend Usage

        - `GET /api/test-backend/datasets`: `internal-only`; callers: No mini program caller found in current scan.
- `POST /api/test-backend/datasets/import-local`: `internal-only`; callers: No mini program caller found in current scan.
- `POST /api/test-backend/datasets/{dataset_id}/prepare`: `internal-only`; callers: No mini program caller found in current scan.

        ## Migration Notes

        - `GET /api/test-backend/datasets`: cookie-based test backend auth should not be merged into JWT auth by accident
- `POST /api/test-backend/datasets/import-local`: cookie-based test backend auth should not be merged into JWT auth by accident
- `POST /api/test-backend/datasets/{dataset_id}/prepare`: cookie-based test backend auth should not be merged into JWT auth by accident

        ## Open Questions / Drift

        - Internal/test-backend routes should likely remain isolated from the public business API surface in the rewrite.
