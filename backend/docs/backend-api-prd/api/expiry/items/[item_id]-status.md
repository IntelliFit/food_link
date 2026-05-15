---
route_path: "/api/expiry/items/{item_id}/status"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:8125"]
request_models: ["FoodExpiryStatusUpdateRequest"]
response_models: []
db_dependencies: ["update_food_expiry_item_v2"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:8125"]
---

# Item_Id Status

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/expiry/items/{item_id}/status` | `update_food_expiry_item_status_endpoint` | `jwt_required` | `implicit` | `backend/main.py:8125` |

## Request Contract

- `POST /api/expiry/items/{item_id}/status`: `FoodExpiryStatusUpdateRequest` (status)

## Response Contract

- `POST /api/expiry/items/{item_id}/status`: Implicit JSON/dict response

## Main Flow

- `POST /api/expiry/items/{item_id}/status`: reads/writes via `update_food_expiry_item_v2`; local helper chain includes `_normalize_expiry_status, _normalize_food_expiry_item, _reconcile_food_expiry_notification_job`

## Dependencies & Side Effects

- Database dependencies: update_food_expiry_item_v2
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _normalize_expiry_status, _normalize_food_expiry_item, _reconcile_food_expiry_notification_job

## Data Reads/Writes

- This document touches database helpers: update_food_expiry_item_v2
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/expiry/items/{item_id}/status`: 404, 500

## Frontend Usage

- `POST /api/expiry/items/{item_id}/status`: `miniapp-used`; callers: src/utils/api.ts:updateManagedFoodExpiryStatus

## Migration Notes

- `POST /api/expiry/items/{item_id}/status`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
