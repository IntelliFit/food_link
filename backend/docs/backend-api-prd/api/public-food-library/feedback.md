---
route_path: "/api/public-food-library/feedback"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:10252"]
request_models: []
response_models: []
db_dependencies: ["add_public_food_library_feedback_sync"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:10252"]
---

# Feedback

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/public-food-library/feedback` | `api_public_food_library_feedback` | `jwt_required` | `implicit` | `backend/main.py:10252` |

## Request Contract

- `POST /api/public-food-library/feedback`: None

## Response Contract

- `POST /api/public-food-library/feedback`: Implicit JSON/dict response

## Main Flow

- `POST /api/public-food-library/feedback`: reads/writes via `add_public_food_library_feedback_sync`

## Dependencies & Side Effects

- Database dependencies: add_public_food_library_feedback_sync
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: add_public_food_library_feedback_sync
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/public-food-library/feedback`: 400, 500

## Frontend Usage

- `POST /api/public-food-library/feedback`: `miniapp-used`; callers: src/utils/api.ts:submitPublicFoodLibraryFeedback

## Migration Notes

- `POST /api/public-food-library/feedback`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
