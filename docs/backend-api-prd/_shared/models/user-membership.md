# User Membership

| Model | Fields | Source |
| --- | --- | --- |
| `LoginRequest` | code, phoneCode, inviteCode, testOpenid | `backend/main.py:3147` |
| `LoginResponse` | access_token, refresh_token, token_type, expires_in, user_id, openid, unionid, phoneNumber, purePhoneNumber, countryCode, diet_goal | `backend/main.py:3154` |
| `MembershipPlanResponse` | code, name, amount, duration_months, description, tier, period, daily_credits, original_amount, savings, sort_order | `backend/main.py:3168` |
| `MembershipStatusResponse` | is_pro, status, current_plan_code, first_activated_at, current_period_start, expires_at, last_paid_at, daily_limit, daily_used, daily_remaining, daily_credits_max, daily_credits_used, daily_credits_remaining, daily_credits_base, daily_bonus_credits, invite_bonus_credits, share_bonus_credits, credits_reset_at, trial_active, trial_expires_at, trial_days_total, trial_policy, early_user_rank, early_user_limit, early_paid_user_rank, early_paid_user_limit, early_user_paid_bonus_multiplier, early_user_paid_bonus_eligible, early_user_paid_bonus_source, early_user_paid_bonus_active, system_credits_remaining, earned_credits_balance, earned_credits_consumed_today, total_credits_available | `backend/main.py:3183` |
| `ClaimSharePosterRewardRequest` | record_id | `backend/main.py:3223` |
| `ClaimSharePosterRewardResponse` | claimed, already_claimed, daily_cap_reached, share_poster_claims_today, credits, daily_credits_max, daily_credits_remaining, earned_credits_balance, total_credits_available, message | `backend/main.py:3227` |
| `CreateMembershipPaymentRequest` | plan_code | `backend/main.py:3244` |
| `CreateMembershipPaymentResponse` | order_no, plan_code, amount, pay_params | `backend/main.py:3256` |
| `UpdateUserInfoRequest` | nickname, avatar, telephone, searchable, public_records | `backend/main.py:5956` |
| `BindPhoneRequest` | phoneCode | `backend/main.py:6743` |
| `UploadAvatarRequest` | base64Image | `backend/main.py:6777` |
