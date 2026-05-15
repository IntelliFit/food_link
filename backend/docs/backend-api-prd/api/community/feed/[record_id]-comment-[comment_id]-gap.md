---
route_path: "/api/community/feed/{record_id}/comments/{comment_id}"
methods: ["DELETE"]
auth_type: ["unknown-from-frontend", "likely-jwt_required"]
frontend_usage: ["frontend-missing-backend"]
handler_refs: []
request_models: []
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: []
source_refs: ["src/utils/api.ts:3752"]
---

# Community Comment Delete Gap

## Purpose

Records the current drift where the mini program has a delete-comment request path, but no matching FastAPI delete route was found.

## Route Matrix

| Method | Path | Backend Exists | Frontend Caller |
| --- | --- | --- | --- |
| `DELETE` | `/api/community/feed/{record_id}/comments/{comment_id}` | no | `src/utils/api.ts:communityDeleteComment` |

## Request Contract

- Frontend builds the path dynamically from `recordId` and `commentId`.
- Frontend expects auth and a delete result payload.

## Response Contract

- Frontend expects `{ deleted: number }` on success.

## Main Flow

- Current state is a route drift rather than an implemented backend flow.

## Dependencies & Side Effects

- Expected future implementation would touch feed comment ownership / cascading delete logic.

## Data Reads/Writes

- No current backend implementation found to confirm delete semantics.

## Error Cases

- Current practical failure mode is “route missing / unmatched implementation”.

## Frontend Usage

- Caller: `src/utils/api.ts:communityDeleteComment`
- Status: `frontend-missing-backend`

## Migration Notes

- Decide during rewrite whether to add the delete endpoint or remove/hide the client action.

## Open Questions / Drift

- The client still exposes delete-comment behavior, but the current backend route set does not.
