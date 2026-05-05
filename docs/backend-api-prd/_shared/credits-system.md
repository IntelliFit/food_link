# Credits System

This document summarizes the current credit system behavior that is otherwise spread across membership, analysis, exercise, and reward routes.

## Scope

- system daily credits for food analysis and exercise
- earned / persistent credits from invite and share-poster rewards
- membership-driven daily quota
- per-route credit consumption and post-success deduction timing

## Primary Code Anchors

- [backend/main.py:1650](/Users/kirigaya/project/food_link/backend/main.py:1650)
- [backend/main.py:1693](/Users/kirigaya/project/food_link/backend/main.py:1693)
- [backend/main.py:1783](/Users/kirigaya/project/food_link/backend/main.py:1783)
- [backend/main.py:1870](/Users/kirigaya/project/food_link/backend/main.py:1870)
- [backend/database.py:3072](/Users/kirigaya/project/food_link/backend/database.py:3072)
- [backend/database.py:3122](/Users/kirigaya/project/food_link/backend/database.py:3122)
- [backend/database.py:3247](/Users/kirigaya/project/food_link/backend/database.py:3247)
- [backend/database.py:3292](/Users/kirigaya/project/food_link/backend/database.py:3292)

## Current Rules In Code

- Standard food analysis costs `2` credits per request.
- Precision food analysis costs `4` credits per request.
- Exercise logging costs `1` credit per request.
- Membership plans materialize a daily system credit cap through `daily_credits`.
- System credits are day-scoped and reset by China local date.
- Earned credits are persistent and are consumed only after available system credits are exhausted.
- Invite and share-poster rewards are written into earned credit balance rather than the daily system bucket.

## Credit Sources

### System Credits

- Membership plan quota from `current_plan_code` and `daily_credits`
- Early-user / paid-early bonus logic can increase effective daily system quota
- Computed through `_resolve_daily_system_credit_cap_for_date(...)` and `_compute_daily_credits_status(...)`

### Earned Credits

- Invite qualification reward
- Invite daily reward materialization
- Share-poster reward materialization
- Stored through earned credit balance helpers in `backend/database.py`

## Credit Spend Flow

1. Route validates business eligibility.
2. Route computes effective membership and daily credit state.
3. Route builds a credit spend plan that splits system credits vs earned credits.
4. Route submits or runs the business flow.
5. Earned credit deduction happens only after successful completion through `_consume_earned_credits_after_success(...)`.

## Routes That Surface Credit State

- [api/membership/me.md](/Users/kirigaya/project/food_link/docs/backend-api-prd/api/membership/me.md)
- [api/membership/rewards-share-poster-claim.md](/Users/kirigaya/project/food_link/docs/backend-api-prd/api/membership/rewards-share-poster-claim.md)
- [api/analyze/submit.md](/Users/kirigaya/project/food_link/docs/backend-api-prd/api/analyze/submit.md)
- [api/analyze-text/submit.md](/Users/kirigaya/project/food_link/docs/backend-api-prd/api/analyze-text/submit.md)
- [api/precision-sessions/[session_id]/continue.md](/Users/kirigaya/project/food_link/docs/backend-api-prd/api/precision-sessions/%5Bsession_id%5D/continue.md)
- [api/exercise-logs/index.md](/Users/kirigaya/project/food_link/docs/backend-api-prd/api/exercise-logs/index.md)
- [api/expiry/recognize.md](/Users/kirigaya/project/food_link/docs/backend-api-prd/api/expiry/recognize.md)

## Migration Notes

- Preserve the distinction between daily-reset system credits and persistent earned credits.
- Preserve post-success deduction timing; do not pre-deduct earned credits before the business operation succeeds.
- Preserve China-date semantics when rebuilding quota/reset logic.
- Membership status, plan tier, and credit availability are tightly coupled; migration should not split them into unrelated flows without compatibility checks.

## Known Branch Drift

- During this documentation pass, no new remote branch change altered the core credit accounting rules themselves.
- The current migration concern is coverage clarity, not a detected algorithm rewrite.
