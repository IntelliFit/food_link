from __future__ import annotations

import calendar
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from supabase import create_client


CHINA_TZ = timezone(timedelta(hours=8))
PRESERVE_USER_IDS = {
    "8826bc8d-81ad-40a4-bc42-6cc30506b8c3",  # 锦恢
    "4a141645-10ac-4801-9371-c269fb872dcd",  # 小马哥
}
LEGACY_MEMBERSHIP_PLAN_CODES = {"pro_monthly"}
MEMBERSHIP_PLAN_PREFIXES = ("light_", "standard_", "advanced_")
EARLY_USER_TOP_500_LIMIT = 500
EARLY_USER_TRIAL_LIMIT = 1000
EARLY_PAID_USER_LIMIT = 100
EARLY_USER_TOP_500_TRIAL_DAYS = 60
EARLY_USER_TRIAL_DAYS = 30
REGULAR_USER_TRIAL_DAYS = 3
EARLY_USER_PAID_CREDITS_MULTIPLIER = 2


def parse_dt(value: Any) -> Optional[datetime]:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def add_months(dt: datetime, months: int) -> datetime:
    total_month = dt.month - 1 + months
    year = dt.year + total_month // 12
    month = total_month % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def is_membership_subscription_plan_code(plan_code: Optional[str]) -> bool:
    code = str(plan_code or "").strip().lower()
    if not code:
        return False
    if code in LEGACY_MEMBERSHIP_PLAN_CODES:
        return True
    return code.startswith(MEMBERSHIP_PLAN_PREFIXES)


def trial_days_for_rank(rank: Optional[int]) -> int:
    if rank is None:
        return REGULAR_USER_TRIAL_DAYS
    if rank <= EARLY_USER_TOP_500_LIMIT:
        return EARLY_USER_TOP_500_TRIAL_DAYS
    if rank <= EARLY_USER_TRIAL_LIMIT:
        return EARLY_USER_TRIAL_DAYS
    return REGULAR_USER_TRIAL_DAYS


def main() -> None:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

    client = create_client(url, key)
    now_utc = datetime.now(timezone.utc)

    users = {
        row["id"]: row
        for row in (client.table("weapp_user").select("id,nickname,create_time").execute().data or [])
    }
    memberships = {
        row["user_id"]: row
        for row in (
            client.table("user_pro_memberships")
            .select("*")
            .execute()
            .data
            or []
        )
    }
    plan_rows = client.table("membership_plan_config").select("code,daily_credits").execute().data or []
    plan_daily_credits = {
        str(row.get("code") or ""): int(row.get("daily_credits") or 0)
        for row in plan_rows
    }
    plan_daily_credits.setdefault("pro_monthly", 20)

    sorted_users = sorted(
        users.values(),
        key=lambda row: (
            parse_dt(row.get("create_time")) or datetime.max.replace(tzinfo=timezone.utc),
            str(row.get("id") or ""),
        ),
    )
    registration_rank = {
        row["id"]: index + 1
        for index, row in enumerate(sorted_users[:EARLY_USER_TRIAL_LIMIT])
    }

    payment_rows = client.table("pro_membership_payment_records").select(
        "id,user_id,plan_code,status,paid_at,created_at,duration_months,amount,order_no"
    ).eq("status", "paid").execute().data or []
    membership_paid_rows = [row for row in payment_rows if is_membership_subscription_plan_code(row.get("plan_code"))]

    first_paid_per_user: Dict[str, Dict[str, Any]] = {}
    latest_paid_per_user: Dict[str, Dict[str, Any]] = {}
    for row in sorted(
        membership_paid_rows,
        key=lambda item: (
            parse_dt(item.get("paid_at")) or datetime.min.replace(tzinfo=timezone.utc),
            parse_dt(item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
            str(item.get("id") or ""),
        ),
    ):
        user_id = str(row.get("user_id") or "")
        if not user_id:
            continue
        first_paid_per_user.setdefault(user_id, row)
        latest_paid_per_user[user_id] = row

    paid_rank = {
        user_id: index + 1
        for index, user_id in enumerate(
            list(first_paid_per_user.keys())[:EARLY_PAID_USER_LIMIT]
        )
    }

    reconciled = []
    expired_fake = []

    for user_id, latest_paid in latest_paid_per_user.items():
        paid_at = parse_dt(latest_paid.get("paid_at"))
        if not paid_at:
            continue
        expected_expires_at = add_months(paid_at, max(int(latest_paid.get("duration_months") or 1), 1))
        expected_status = "active" if expected_expires_at > now_utc else "expired"
        multiplier = EARLY_USER_PAID_CREDITS_MULTIPLIER if (
            user_id in registration_rank or user_id in paid_rank
        ) else 1
        plan_expected_daily_credits = int(plan_daily_credits.get(str(latest_paid.get("plan_code") or ""), 0)) * multiplier
        existing = memberships.get(user_id)
        existing_daily_credits = int((existing or {}).get("daily_credits") or 0)
        expected_daily_credits = max(existing_daily_credits, plan_expected_daily_credits)
        payload = {
            "current_plan_code": latest_paid.get("plan_code"),
            "status": expected_status,
            "first_activated_at": existing.get("first_activated_at") if existing and existing.get("first_activated_at") else paid_at.isoformat(),
            "current_period_start": paid_at.isoformat(),
            "expires_at": expected_expires_at.isoformat(),
            "last_paid_at": paid_at.isoformat(),
            "auto_renew": False,
            "daily_credits": expected_daily_credits,
            "updated_at": now_utc.isoformat(),
        }

        changed = (
            not existing
            or str(existing.get("current_plan_code") or "") != str(payload["current_plan_code"] or "")
            or str(existing.get("status") or "") != payload["status"]
            or str(existing.get("current_period_start") or "") != str(payload["current_period_start"] or "")
            or str(existing.get("expires_at") or "") != str(payload["expires_at"] or "")
            or str(existing.get("last_paid_at") or "") != str(payload["last_paid_at"] or "")
            or int(existing.get("daily_credits") or 0) < int(plan_expected_daily_credits or 0)
        )
        if not changed:
            continue

        if existing:
            client.table("user_pro_memberships").update(payload).eq("user_id", user_id).execute()
        else:
            row = payload.copy()
            row["user_id"] = user_id
            client.table("user_pro_memberships").insert(row).execute()

        reconciled.append({
            "user_id": user_id,
            "nickname": users.get(user_id, {}).get("nickname"),
            "plan_code": payload["current_plan_code"],
            "status": payload["status"],
        })

    for user_id, membership in memberships.items():
        if user_id in PRESERVE_USER_IDS:
            continue
        if user_id in latest_paid_per_user:
            continue
        if str(membership.get("status") or "") != "active":
            continue
        expires_at = parse_dt(membership.get("expires_at"))
        if not expires_at or expires_at <= now_utc:
            continue

        created_at = parse_dt(users.get(user_id, {}).get("create_time"))
        if created_at:
            rank = registration_rank.get(user_id)
            trial_expires_at = created_at + timedelta(days=trial_days_for_rank(rank))
            if trial_expires_at > now_utc:
                continue

        client.table("user_pro_memberships").update({
            "status": "expired",
            "expires_at": (now_utc - timedelta(seconds=1)).isoformat(),
            "daily_credits": 0,
            "updated_at": now_utc.isoformat(),
        }).eq("user_id", user_id).execute()
        expired_fake.append({
            "user_id": user_id,
            "nickname": users.get(user_id, {}).get("nickname"),
            "plan_code": membership.get("current_plan_code"),
        })

    print(f"reconciled_memberships={len(reconciled)}")
    for item in reconciled:
        print("reconciled:", item)
    print(f"expired_fake_memberships={len(expired_fake)}")
    for item in expired_fake:
        print("expired_fake:", item)


if __name__ == "__main__":
    main()
