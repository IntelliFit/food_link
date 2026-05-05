---
route_path: "/api/membership/plans"
methods: ["GET"]
auth_type: ["public"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:6314"]
request_models: []
response_models: ["MembershipPlansListResponse"]
db_dependencies: ["list_active_membership_plans"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:6314"]
---

# Plans

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/membership/plans` | `get_membership_plans` | `public` | `MembershipPlansListResponse` | `backend/main.py:6314` |

## Request Contract

- `GET /api/membership/plans`: None

## Response Contract

- `GET /api/membership/plans`: MembershipPlansListResponse

## Main Flow

- `GET /api/membership/plans`: reads/writes via `list_active_membership_plans`

## Dependencies & Side Effects

- Database dependencies: list_active_membership_plans
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: list_active_membership_plans
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/membership/plans`: 500

## Frontend Usage

- `GET /api/membership/plans`: `miniapp-used`; callers: src/utils/api.ts:getMembershipPlans

## Migration Notes

- `GET /api/membership/plans`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
