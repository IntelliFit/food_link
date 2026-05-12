---
route_path: "/api/body-metrics/summary"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7640"]
request_models: []
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: []
source_refs: ["backend/main.py:7640"]
---

# Summary

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/body-metrics/summary` | `get_body_metrics_summary` | `jwt_required` | `implicit` | `backend/main.py:7640` |

## Request Contract

- `GET /api/body-metrics/summary`: None

## Response Contract

- `GET /api/body-metrics/summary`: Implicit JSON/dict response

## Main Flow

- `GET /api/body-metrics/summary`: local helper chain includes `_build_body_metrics_summary, _empty_body_metrics_summary, _resolve_stats_range_dates`

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: None
- Local helper chain: _build_body_metrics_summary, _empty_body_metrics_summary, _resolve_stats_range_dates

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/body-metrics/summary`: 500

## Frontend Usage

- `GET /api/body-metrics/summary`: `miniapp-used`; callers: src/utils/api.ts:getBodyMetricsSummary

## Migration Notes

- `GET /api/body-metrics/summary`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
