---
route_path: "/api/membership/rewards/share-poster/claim"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:6384"]
request_models: ["ClaimSharePosterRewardRequest"]
response_models: ["ClaimSharePosterRewardResponse"]
db_dependencies: ["claim_share_poster_bonus", "get_food_record_by_id", "get_user_by_id", "materialize_daily_share_poster_reward_credits"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:6384"]
---

# Rewards Share Poster Claim

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/membership/rewards/share-poster/claim` | `claim_membership_share_poster_reward` | `jwt_required` | `ClaimSharePosterRewardResponse` | `backend/main.py:6384` |

## Request Contract

- `POST /api/membership/rewards/share-poster/claim`: `ClaimSharePosterRewardRequest` (record_id)

## Response Contract

- `POST /api/membership/rewards/share-poster/claim`: ClaimSharePosterRewardResponse

## Main Flow

- `POST /api/membership/rewards/share-poster/claim`: reads/writes via `claim_share_poster_bonus, get_food_record_by_id, get_user_by_id, materialize_daily_share_poster_reward_credits`; local helper chain includes `_compute_daily_credits_status, _format_membership_response, _get_effective_membership`

## Dependencies & Side Effects

- Database dependencies: claim_share_poster_bonus, get_food_record_by_id, get_user_by_id, materialize_daily_share_poster_reward_credits
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _compute_daily_credits_status, _format_membership_response, _get_effective_membership

## Data Reads/Writes

- This document touches database helpers: claim_share_poster_bonus, get_food_record_by_id, get_user_by_id, materialize_daily_share_poster_reward_credits
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/membership/rewards/share-poster/claim`: 400, 403, 404, 500

## Frontend Usage

- `POST /api/membership/rewards/share-poster/claim`: `miniapp-used`; callers: src/utils/api.ts:claimSharePosterReward, src/utils/api.ts:rid

## Migration Notes

- `POST /api/membership/rewards/share-poster/claim`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- This route is part of the earned-credit reward system rather than the daily system-credit bucket; preserve that distinction.

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
