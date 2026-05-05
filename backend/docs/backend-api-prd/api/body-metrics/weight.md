---
route_path: "/api/body-metrics/weight"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7668"]
request_models: ["BodyWeightUpsertRequest"]
response_models: []
db_dependencies: ["upsert_user_weight_record"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:7668"]
---

# Weight

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/body-metrics/weight` | `save_body_weight_record` | `jwt_required` | `implicit` | `backend/main.py:7668` |

## Request Contract

- `POST /api/body-metrics/weight`: `BodyWeightUpsertRequest` (value, date, client_id, source_type)

## Response Contract

- `POST /api/body-metrics/weight`: Implicit JSON/dict response

## Main Flow

- `POST /api/body-metrics/weight`: reads/writes via `upsert_user_weight_record`; local helper chain includes `_normalize_body_metric_source_type, _normalize_weight_entry, _parse_date_string, _sync_profile_weight_from_latest`

## Dependencies & Side Effects

- Database dependencies: upsert_user_weight_record
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _normalize_body_metric_source_type, _normalize_weight_entry, _parse_date_string, _sync_profile_weight_from_latest

## Data Reads/Writes

- This document touches database helpers: upsert_user_weight_record
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/body-metrics/weight`: 500

## Frontend Usage

- `POST /api/body-metrics/weight`: `miniapp-used`; callers: src/utils/api.ts:saveBodyWeightRecord

## Migration Notes

- `POST /api/body-metrics/weight`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
