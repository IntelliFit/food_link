---
route_path: "/api/expiry/dashboard"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7856"]
request_models: []
response_models: []
db_dependencies: ["list_food_expiry_items_v2"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:7856"]
---

# Dashboard

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/expiry/dashboard` | `get_food_expiry_dashboard` | `jwt_required` | `implicit` | `backend/main.py:7856` |

## Request Contract

- `GET /api/expiry/dashboard`: None

## Response Contract

- `GET /api/expiry/dashboard`: Implicit JSON/dict response

## Main Flow

- `GET /api/expiry/dashboard`: reads/writes via `list_food_expiry_items_v2`; local helper chain includes `_normalize_food_expiry_item`

## Dependencies & Side Effects

- Database dependencies: list_food_expiry_items_v2
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _normalize_food_expiry_item

## Data Reads/Writes

- This document touches database helpers: list_food_expiry_items_v2
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/expiry/dashboard`: 500

## Frontend Usage

- `GET /api/expiry/dashboard`: `miniapp-used`; callers: src/utils/api.ts:getFoodExpiryDashboard

## Migration Notes

- `GET /api/expiry/dashboard`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
