---
route_path: "/api/membership/pay/create"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:6450"]
request_models: ["CreateMembershipPaymentRequest"]
response_models: ["CreateMembershipPaymentResponse"]
db_dependencies: ["create_pro_membership_payment_record", "get_membership_plan_by_code", "get_user_by_id"]
worker_dependencies: []
external_dependencies: ["Supabase", "WeChat"]
source_refs: ["backend/main.py:6450"]
---

# Pay Create

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/membership/pay/create` | `create_membership_payment` | `jwt_required` | `CreateMembershipPaymentResponse` | `backend/main.py:6450` |

## Request Contract

- `POST /api/membership/pay/create`: `CreateMembershipPaymentRequest` (plan_code)

## Response Contract

- `POST /api/membership/pay/create`: CreateMembershipPaymentResponse

## Main Flow

- `POST /api/membership/pay/create`: reads/writes via `create_pro_membership_payment_record, get_membership_plan_by_code, get_user_by_id`; local helper chain includes `_amount_to_fen, _build_mini_program_pay_params, _build_wechatpay_authorization, _expire_pending_membership_orders_for_user, _generate_membership_order_no, _get_wechat_pay_config, _to_decimal_amount`

## Dependencies & Side Effects

- Database dependencies: create_pro_membership_payment_record, get_membership_plan_by_code, get_user_by_id
- Worker dependencies: None
- External dependencies: Supabase, WeChat
- Local helper chain: _amount_to_fen, _build_mini_program_pay_params, _build_wechatpay_authorization, _expire_pending_membership_orders_for_user, _generate_membership_order_no, _get_wechat_pay_config, _to_decimal_amount

## Data Reads/Writes

- This document touches database helpers: create_pro_membership_payment_record, get_membership_plan_by_code, get_user_by_id
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/membership/pay/create`: 400, 403, 404, 500, 502

## Frontend Usage

- `POST /api/membership/pay/create`: `miniapp-used`; callers: src/utils/api.ts:createMembershipPayment

## Migration Notes

- `POST /api/membership/pay/create`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
