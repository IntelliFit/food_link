---
route_path: "/api/expiry/recognize"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7892"]
request_models: ["FoodExpiryRecognitionRequest"]
response_models: []
db_dependencies: ["get_user_by_id"]
worker_dependencies: []
external_dependencies: ["Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:7892"]
---

# Recognize

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/expiry/recognize` | `recognize_food_expiry_items` | `jwt_required` | `implicit` | `backend/main.py:7892` |

## Request Contract

- `POST /api/expiry/recognize`: `FoodExpiryRecognitionRequest` (image_urls, additional_context)

## Response Contract

- `POST /api/expiry/recognize`: Implicit JSON/dict response

## Main Flow

- `POST /api/expiry/recognize`: reads/writes via `get_user_by_id`; worker or async pipeline touchpoint: `analysis_tasks / worker queue`; local helper chain includes `_consume_earned_credits_after_success, _format_membership_response, _get_effective_membership, _get_food_task_type, _raise_if_food_analysis_credits_insufficient`

## Dependencies & Side Effects

- Database dependencies: get_user_by_id
- Worker dependencies: None
- External dependencies: Supabase, Supabase Storage
- Local helper chain: _consume_earned_credits_after_success, _format_membership_response, _get_effective_membership, _get_food_task_type, _raise_if_food_analysis_credits_insufficient

## Data Reads/Writes

- This document touches database helpers: get_user_by_id
- Async / worker-sensitive flow: Yes

## Error Cases

- `POST /api/expiry/recognize`: 400, 500

## Frontend Usage

- `POST /api/expiry/recognize`: `miniapp-used`; callers: src/utils/api.ts:recognizeManagedFoodExpiryItems

## Migration Notes

- `POST /api/expiry/recognize`: preserve async task semantics and queue contract

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
