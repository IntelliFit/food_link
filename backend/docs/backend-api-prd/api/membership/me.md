---
route_path: "/api/membership/me"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:6344"]
request_models: []
response_models: ["MembershipStatusResponse"]
db_dependencies: ["get_today_food_analysis_count", "get_user_by_id"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:6344"]
---

# Me

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/membership/me` | `get_my_membership` | `jwt_required` | `MembershipStatusResponse` | `backend/main.py:6344` |

## Request Contract

- `GET /api/membership/me`: None

## Response Contract

- `GET /api/membership/me`: MembershipStatusResponse

## Main Flow

- `GET /api/membership/me`: reads/writes via `get_today_food_analysis_count, get_user_by_id`; local helper chain includes `_compute_daily_credits_status, _format_membership_response, _get_effective_membership, _get_food_analysis_daily_limit`

## Dependencies & Side Effects

- Database dependencies: get_today_food_analysis_count, get_user_by_id
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _compute_daily_credits_status, _format_membership_response, _get_effective_membership, _get_food_analysis_daily_limit

## Data Reads/Writes

- This document touches database helpers: get_today_food_analysis_count, get_user_by_id
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/membership/me`: 500

## Frontend Usage

- `GET /api/membership/me`: `miniapp-used`; callers: src/utils/api.ts:getMyMembership

## Migration Notes

- `GET /api/membership/me`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- This route is one of the main read models for current credit state; pair it with `_shared/credits-system.md` during migration.

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
