---
route_path: "/api/body-metrics/sync-local"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7750"]
request_models: ["BodyMetricsSyncRequest"]
response_models: []
db_dependencies: ["create_user_water_log", "list_user_water_logs", "list_user_weight_records", "upsert_user_body_metric_settings", "upsert_user_weight_record"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:7750"]
---

# Sync Local

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/body-metrics/sync-local` | `sync_local_body_metrics` | `jwt_required` | `implicit` | `backend/main.py:7750` |

## Request Contract

- `POST /api/body-metrics/sync-local`: `BodyMetricsSyncRequest` (weight_entries, water_by_date, water_goal_ml)

## Response Contract

- `POST /api/body-metrics/sync-local`: Implicit JSON/dict response

## Main Flow

- `POST /api/body-metrics/sync-local`: reads/writes via `create_user_water_log, list_user_water_logs, list_user_weight_records, upsert_user_body_metric_settings, upsert_user_weight_record`; local helper chain includes `_build_json_datetime, _build_legacy_weight_client_id, _parse_date_string, _parse_datetime`

## Dependencies & Side Effects

- Database dependencies: create_user_water_log, list_user_water_logs, list_user_weight_records, upsert_user_body_metric_settings, upsert_user_weight_record
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _build_json_datetime, _build_legacy_weight_client_id, _parse_date_string, _parse_datetime

## Data Reads/Writes

- This document touches database helpers: create_user_water_log, list_user_water_logs, list_user_weight_records, upsert_user_body_metric_settings, upsert_user_weight_record
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/body-metrics/sync-local`: 500

## Frontend Usage

- `POST /api/body-metrics/sync-local`: `miniapp-used`; callers: src/utils/api.ts:syncLocalBodyMetrics

## Migration Notes

- `POST /api/body-metrics/sync-local`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
