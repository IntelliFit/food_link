---
route_path: "/api/expiry/items/{item_id}/subscribe"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:8152"]
request_models: ["FoodExpirySubscribeRequest"]
response_models: []
db_dependencies: ["cancel_food_expiry_notification_jobs_by_item", "get_food_expiry_item_v2"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:8152"]
---

# Item_Id Subscribe

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/expiry/items/{item_id}/subscribe` | `subscribe_food_expiry_item_endpoint` | `jwt_required` | `implicit` | `backend/main.py:8152` |

## Request Contract

- `POST /api/expiry/items/{item_id}/subscribe`: `FoodExpirySubscribeRequest` (subscribe_status, err_msg)

## Response Contract

- `POST /api/expiry/items/{item_id}/subscribe`: Implicit JSON/dict response

## Main Flow

- `POST /api/expiry/items/{item_id}/subscribe`: reads/writes via `cancel_food_expiry_notification_jobs_by_item, get_food_expiry_item_v2`; local helper chain includes `_normalize_food_expiry_item, _normalize_subscribe_status, _reconcile_food_expiry_notification_job`

## Dependencies & Side Effects

- Database dependencies: cancel_food_expiry_notification_jobs_by_item, get_food_expiry_item_v2
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _normalize_food_expiry_item, _normalize_subscribe_status, _reconcile_food_expiry_notification_job

## Data Reads/Writes

- This document touches database helpers: cancel_food_expiry_notification_jobs_by_item, get_food_expiry_item_v2
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/expiry/items/{item_id}/subscribe`: 400, 404, 500

## Frontend Usage

- `POST /api/expiry/items/{item_id}/subscribe`: `miniapp-used`; callers: src/utils/api.ts:subscribeManagedFoodExpiryItem

## Migration Notes

- `POST /api/expiry/items/{item_id}/subscribe`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
