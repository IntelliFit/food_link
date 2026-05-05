---
route_path: "/api/community/checkin-leaderboard"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9551"]
request_models: []
response_models: []
db_dependencies: ["get_friend_circle_week_checkin_leaderboard"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9551"]
---

# Checkin Leaderboard

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/community/checkin-leaderboard` | `api_community_checkin_leaderboard` | `jwt_required` | `implicit` | `backend/main.py:9551` |

## Request Contract

- `GET /api/community/checkin-leaderboard`: None

## Response Contract

- `GET /api/community/checkin-leaderboard`: Implicit JSON/dict response

## Main Flow

- `GET /api/community/checkin-leaderboard`: reads/writes via `get_friend_circle_week_checkin_leaderboard`

## Dependencies & Side Effects

- Database dependencies: get_friend_circle_week_checkin_leaderboard
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: get_friend_circle_week_checkin_leaderboard
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/community/checkin-leaderboard`: 500

## Frontend Usage

- `GET /api/community/checkin-leaderboard`: `miniapp-used`; callers: src/utils/api.ts:communityGetCheckinLeaderboard

## Migration Notes

- `GET /api/community/checkin-leaderboard`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
