---
route_path: "/api/payment/wechat/notify/membership"
methods: ["POST"]
auth_type: ["public"]
frontend_usage: ["backend-only"]
handler_refs: ["backend/main.py:6584"]
request_models: []
response_models: []
db_dependencies: ["get_membership_plan_by_code", "get_pro_membership_payment_record_by_order_no", "get_user_by_id", "get_user_pro_membership", "save_user_pro_membership", "update_pro_membership_payment_record"]
worker_dependencies: []
external_dependencies: ["Supabase", "WeChat"]
source_refs: ["backend/main.py:6584"]
---

# Wechat Notify Membership

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/payment/wechat/notify/membership` | `wechat_membership_notify` | `public` | `implicit` | `backend/main.py:6584` |

## Request Contract

- `POST /api/payment/wechat/notify/membership`: None

## Response Contract

- `POST /api/payment/wechat/notify/membership`: Implicit JSON/dict response

## Main Flow

- `POST /api/payment/wechat/notify/membership`: reads/writes via `get_membership_plan_by_code, get_pro_membership_payment_record_by_order_no, get_user_by_id, get_user_pro_membership, save_user_pro_membership, update_pro_membership_payment_record`; local helper chain includes `_add_months, _amount_to_fen, _build_json_datetime, _decrypt_wechatpay_resource, _expire_pending_membership_orders_for_user, _get_wechat_pay_config, _parse_datetime, _resolve_early_user_membership_meta`

## Dependencies & Side Effects

- Database dependencies: get_membership_plan_by_code, get_pro_membership_payment_record_by_order_no, get_user_by_id, get_user_pro_membership, save_user_pro_membership, update_pro_membership_payment_record
- Worker dependencies: None
- External dependencies: Supabase, WeChat
- Local helper chain: _add_months, _amount_to_fen, _build_json_datetime, _decrypt_wechatpay_resource, _expire_pending_membership_orders_for_user, _get_wechat_pay_config, _parse_datetime, _resolve_early_user_membership_meta, _verify_with_rsa_sha256

## Data Reads/Writes

- This document touches database helpers: get_membership_plan_by_code, get_pro_membership_payment_record_by_order_no, get_user_by_id, get_user_pro_membership, save_user_pro_membership, update_pro_membership_payment_record
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/payment/wechat/notify/membership`: 400, 401, 404, 500

## Frontend Usage

- `POST /api/payment/wechat/notify/membership`: `backend-only`; callers: No mini program caller found in current scan.

## Migration Notes

- `POST /api/payment/wechat/notify/membership`: WeChat callback shape and signature validation are externally constrained

## Open Questions / Drift

- Current scan found no mini program caller for at least one route in this document; verify real operator/test caller before rewrite.
