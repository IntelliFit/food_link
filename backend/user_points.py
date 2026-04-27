"""
用户积分：扣减/充值/邀请码（与旧会员制并行时可逐步切换；主流程以积分为准）。
"""
from __future__ import annotations

import os
import random
import string
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

from database import (
    check_postgresql_configured,
    create_user,
    get_database_client,
    get_user_by_id,
    update_user,
)

INITIAL_POINTS = Decimal(os.getenv("POINTS_INITIAL", "100"))
POINTS_FOOD_STANDARD = Decimal(os.getenv("POINTS_FOOD_STANDARD", "1"))
POINTS_FOOD_STRICT = Decimal(os.getenv("POINTS_FOOD_STRICT", "2"))
POINTS_EXERCISE = Decimal(os.getenv("POINTS_EXERCISE", "0.5"))
REFERRAL_BONUS = Decimal(os.getenv("POINTS_REFERRAL_BONUS", "20"))
YUAN_TO_POINTS = Decimal(os.getenv("POINTS_YUAN_TO_POINTS", "20"))  # 1 元 = 多少积分


def food_dispatch_cost(execution_mode: Optional[str]) -> Decimal:
    return POINTS_FOOD_STRICT if (execution_mode or "").strip().lower() == "strict" else POINTS_FOOD_STANDARD


def _to_decimal(v: Any) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


async def get_user_points_balance(user_id: str) -> Decimal:
    user = await get_user_by_id(user_id)
    if not user:
        return Decimal("0")
    return _to_decimal(user.get("points_balance"))


async def _insert_ledger(
    user_id: str,
    delta: Decimal,
    balance_after: Decimal,
    reason: str,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    check_postgresql_configured()
    db = get_database_client()
    row: Dict[str, Any] = {
        "user_id": user_id,
        "delta": float(delta),
        "balance_after": float(balance_after),
        "reason": reason,
    }
    if meta is not None:
        row["meta"] = meta
    db.table("user_points_ledger").insert(row).execute()


async def add_user_points(
    user_id: str,
    amount: Decimal,
    reason: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Decimal:
    """增加积分，返回新余额。"""
    if amount <= 0:
        return await get_user_points_balance(user_id)
    user = await get_user_by_id(user_id)
    if not user:
        raise ValueError("用户不存在")
    bal = _to_decimal(user.get("points_balance"))
    new_bal = bal + amount
    await update_user(user_id, {"points_balance": float(new_bal)})
    await _insert_ledger(user_id, amount, new_bal, reason, meta)
    return new_bal


async def try_deduct_user_points(
    user_id: str,
    amount: Decimal,
    reason: str,
    meta: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, Decimal]:
    """
    扣减积分。成功返回 (True, new_balance)，余额不足返回 (False, current_balance)。
    """
    if amount <= 0:
        bal = await get_user_points_balance(user_id)
        return True, bal
    user = await get_user_by_id(user_id)
    if not user:
        return False, Decimal("0")
    bal = _to_decimal(user.get("points_balance"))
    if bal < amount:
        return False, bal
    new_bal = bal - amount
    await update_user(user_id, {"points_balance": float(new_bal)})
    await _insert_ledger(user_id, -amount, new_bal, reason, meta)
    return True, new_bal


def _random_invite_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


def _is_retryable_invite_code_error(exc: BaseException) -> bool:
    """
    仅对「邀请码与他人冲突」类错误重试。
    列未迁移、权限、网络等不应连续重试 30 次（否则 /api/membership/me 会长时间卡住前端）。
    """
    msg = str(exc).lower()
    if any(
        s in msg
        for s in (
            "column",
            "does not exist",
            "42703",  # undefined_column
            "schema cache",
            "permission denied",
        )
    ):
        return False
    # 唯一约束 / 重复键 → 换码重试
    if any(s in msg for s in ("unique", "duplicate", "23505", "already exists")):
        return True
    # 其它错误（如瞬时网络）少量重试
    return True


async def ensure_registration_invite_code(user_id: str) -> str:
    """保证用户有唯一注册邀请码，返回该码。"""
    user = await get_user_by_id(user_id)
    if not user:
        raise ValueError("用户不存在")
    existing = (user.get("registration_invite_code") or "").strip()
    if existing:
        return existing
    check_postgresql_configured()
    max_attempts = 8
    for attempt in range(max_attempts):
        code = _random_invite_code()
        try:
            await update_user(user_id, {"registration_invite_code": code})
            return code
        except Exception as e:
            if not _is_retryable_invite_code_error(e):
                print(f"[ensure_registration_invite_code] 非重试错误，中止: {e}")
                raise
            if attempt >= max_attempts - 1:
                raise RuntimeError(f"生成邀请码失败: {e}") from e
            continue
    raise RuntimeError("生成邀请码失败")


async def get_user_by_registration_invite_code(code: str) -> Optional[Dict[str, Any]]:
    c = (code or "").strip().upper()
    if not c:
        return None
    check_postgresql_configured()
    db = get_database_client()
    try:
        r = db.table("weapp_user").select("id, nickname, openid").eq("registration_invite_code", c).limit(1).execute()
        if r.data:
            return r.data[0]
    except Exception as e:
        print(f"[get_user_by_registration_invite_code] {e}")
    return None


async def create_new_user_with_points(
    user_data: Dict[str, Any],
    invite_code_from_client: Optional[str] = None,
) -> Dict[str, Any]:
    """
    创建新用户：初始积分 + 邀请码；若填写有效邀请码则双方 +REFERRAL_BONUS。
    """
    user_data = {**user_data}
    user_data.setdefault("points_balance", float(INITIAL_POINTS))
    # 先插入带积分的用户；邀请码在插入后生成，避免唯一冲突
    user = await create_user(user_data)
    uid = user["id"]
    try:
        await ensure_registration_invite_code(uid)
    except Exception as e:
        print(f"[create_new_user_with_points] ensure invite code: {e}")

    code = (invite_code_from_client or "").strip().upper()
    if code:
        inviter = await get_user_by_registration_invite_code(code)
        if inviter and inviter.get("id") and inviter["id"] != uid:
            try:
                await update_user(uid, {"referred_by_user_id": inviter["id"]})
                await add_user_points(uid, REFERRAL_BONUS, "referral_welcome", {"inviter_id": inviter["id"]})
                await add_user_points(inviter["id"], REFERRAL_BONUS, "referral_reward", {"invitee_id": uid})
            except Exception as e:
                print(f"[create_new_user_with_points] referral bonus failed: {e}")
    return await get_user_by_id(uid) or user
