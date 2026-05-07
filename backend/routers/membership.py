from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from database import (
    claim_share_poster_bonus,
    create_pro_membership_payment_record,
    get_food_record_by_id,
    get_membership_plan_by_code,
    get_pro_membership_payment_record_by_order_no,
    get_today_food_analysis_count,
    get_user_by_id,
    get_user_pro_membership,
    list_active_membership_plans,
    materialize_daily_share_poster_reward_credits,
    save_user_pro_membership,
    update_pro_membership_payment_record,
)
from middleware import get_current_user_info

router = APIRouter()

CHINA_TZ = None
SHARE_POSTER_DAILY_MAX_EVENTS = 0
_get_effective_membership = None
_format_membership_response = None
_get_food_analysis_daily_limit = None
_compute_daily_credits_status = None
_get_wechat_pay_config = None
_to_decimal_amount = None
_generate_membership_order_no = None
_amount_to_fen = None
_build_wechatpay_authorization = None
_expire_pending_membership_orders_for_user = None
_build_mini_program_pay_params = None
_verify_with_rsa_sha256 = None
_decrypt_wechatpay_resource = None
_parse_datetime = None
_add_months = None
_build_json_datetime = None
_resolve_early_user_membership_meta = None


def create_membership_router(
    *,
    china_tz: Any,
    share_poster_daily_max_events: int,
    get_effective_membership: Callable[..., Any],
    format_membership_response: Callable[..., Dict[str, Any]],
    get_food_analysis_daily_limit: Callable[..., Any],
    compute_daily_credits_status: Callable[..., Any],
    get_wechat_pay_config: Callable[..., Dict[str, str]],
    to_decimal_amount: Callable[..., Any],
    generate_membership_order_no: Callable[[], str],
    amount_to_fen: Callable[..., int],
    build_wechatpay_authorization: Callable[..., str],
    expire_pending_membership_orders_for_user: Callable[..., Any],
    build_mini_program_pay_params: Callable[..., Dict[str, str]],
    verify_with_rsa_sha256: Callable[..., bool],
    decrypt_wechatpay_resource: Callable[..., Dict[str, Any]],
    parse_datetime: Callable[..., Any],
    add_months: Callable[..., Any],
    build_json_datetime: Callable[..., Any],
    resolve_early_user_membership_meta: Callable[..., Any],
) -> APIRouter:
    global CHINA_TZ, SHARE_POSTER_DAILY_MAX_EVENTS
    global _get_effective_membership, _format_membership_response, _get_food_analysis_daily_limit
    global _compute_daily_credits_status, _get_wechat_pay_config, _to_decimal_amount
    global _generate_membership_order_no, _amount_to_fen, _build_wechatpay_authorization
    global _expire_pending_membership_orders_for_user, _build_mini_program_pay_params
    global _verify_with_rsa_sha256, _decrypt_wechatpay_resource, _parse_datetime
    global _add_months, _build_json_datetime, _resolve_early_user_membership_meta
    CHINA_TZ = china_tz
    SHARE_POSTER_DAILY_MAX_EVENTS = share_poster_daily_max_events
    _get_effective_membership = get_effective_membership
    _format_membership_response = format_membership_response
    _get_food_analysis_daily_limit = get_food_analysis_daily_limit
    _compute_daily_credits_status = compute_daily_credits_status
    _get_wechat_pay_config = get_wechat_pay_config
    _to_decimal_amount = to_decimal_amount
    _generate_membership_order_no = generate_membership_order_no
    _amount_to_fen = amount_to_fen
    _build_wechatpay_authorization = build_wechatpay_authorization
    _expire_pending_membership_orders_for_user = expire_pending_membership_orders_for_user
    _build_mini_program_pay_params = build_mini_program_pay_params
    _verify_with_rsa_sha256 = verify_with_rsa_sha256
    _decrypt_wechatpay_resource = decrypt_wechatpay_resource
    _parse_datetime = parse_datetime
    _add_months = add_months
    _build_json_datetime = build_json_datetime
    _resolve_early_user_membership_meta = resolve_early_user_membership_meta
    return router


class MembershipPlanResponse(BaseModel):
    code: str
    name: str
    amount: float
    duration_months: int
    description: Optional[str] = None
    # 新定价体系字段（2026-04-21）
    tier: Optional[str] = None              # light | standard | advanced
    period: Optional[str] = None            # monthly | quarterly | yearly
    daily_credits: int = 0                  # 对应套餐每日积分
    original_amount: Optional[float] = None # 对照价（无则为 null）
    savings: Optional[float] = None         # = original_amount - amount，用于"立省 xx"
    sort_order: int = 0


class MembershipStatusResponse(BaseModel):
    is_pro: bool
    status: str
    current_plan_code: Optional[str] = None
    first_activated_at: Optional[str] = None
    current_period_start: Optional[str] = None
    expires_at: Optional[str] = None
    last_paid_at: Optional[str] = None
    # 兼容旧的拍照日限（当前关闭，保留字段避免前端崩）
    daily_limit: Optional[int] = None
    daily_used: Optional[int] = None
    daily_remaining: Optional[int] = None
    # 新积分体系字段（2026-04-21）
    daily_credits_max: int = 0              # 每日可用积分上限
    daily_credits_used: int = 0             # 今日已消耗积分
    daily_credits_remaining: int = 0        # 今日剩余积分
    daily_credits_base: int = 0             # 基础积分（套餐/试用）
    daily_bonus_credits: int = 0            # 今日额外奖励积分总和
    invite_bonus_credits: int = 0           # 今日邀请奖励积分
    share_bonus_credits: int = 0            # 今日海报奖励积分
    credits_reset_at: Optional[str] = None  # 次日 00:00+08:00
    trial_active: bool = False              # 是否在免费试用期
    trial_expires_at: Optional[str] = None  # 试用截止（UTC）
    trial_days_total: int = 0              # 当前试用总天数：60 / 30 / 3 / 0
    trial_policy: Optional[str] = None     # founding_top_500_bonus_month / early_first_1000 / regular_new_user
    early_user_rank: Optional[int] = None  # 若属于前 1000 名注册用户，则返回其注册名次（1-based）
    early_user_limit: int = 0              # 前 1000 注册用户活动总名额
    early_paid_user_rank: Optional[int] = None  # 若属于前 100 名付费用户，则返回其付费名次（1-based）
    early_paid_user_limit: int = 0         # 前 100 付费用户活动总名额
    early_user_paid_bonus_multiplier: int = 1  # 创始会员积分倍数
    early_user_paid_bonus_eligible: bool = False # 是否属于创始翻倍活动（前1000注册或前100付费）
    early_user_paid_bonus_source: Optional[str] = None # registration_top_1000 / paid_top_100 / both
    early_user_paid_bonus_active: bool = False   # 当前付费权益是否已按创始翻倍生效

    system_credits_remaining: int = 0
    earned_credits_balance: int = 0
    earned_credits_consumed_today: int = 0
    total_credits_available: int = 0


class ClaimSharePosterRewardRequest(BaseModel):
    record_id: Optional[str] = Field(default=None, description="来源饮食记录 ID（必填），仅允许给自己的记录领取")


class ClaimSharePosterRewardResponse(BaseModel):
    claimed: bool
    already_claimed: bool = False
    daily_cap_reached: bool = False
    share_poster_claims_today: int = 0
    credits: int = 0
    daily_credits_max: Optional[int] = None
    daily_credits_remaining: Optional[int] = None
    earned_credits_balance: Optional[int] = None
    total_credits_available: Optional[int] = None
    message: str


class MembershipPlansListResponse(BaseModel):
    list: List[MembershipPlanResponse]


class CreateMembershipPaymentRequest(BaseModel):
    plan_code: str = Field(..., description="会员套餐编码，如 standard_monthly")


class PaymentParamsResponse(BaseModel):
    timeStamp: str
    nonceStr: str
    package: str
    signType: str
    paySign: str


class CreateMembershipPaymentResponse(BaseModel):
    order_no: str
    plan_code: str
    amount: float
    pay_params: PaymentParamsResponse


# 活动水平中文映射（用于健康档案摘要）

@router.get("/api/membership/plans", response_model=MembershipPlansListResponse)
async def get_membership_plans():
    """获取启用中的会员套餐（3 档 × 3 周期 矩阵）。"""
    try:
        plans = await list_active_membership_plans()
        result_list = []
        for plan in plans:
            amount = float(plan.get("amount") or 0)
            original_raw = plan.get("original_amount")
            original = float(original_raw) if original_raw is not None else None
            savings = round(original - amount, 2) if (original is not None and original > amount) else None
            result_list.append({
                "code": plan["code"],
                "name": plan["name"],
                "amount": amount,
                "duration_months": int(plan.get("duration_months") or 1),
                "description": plan.get("description"),
                "tier": plan.get("tier"),
                "period": plan.get("period"),
                "daily_credits": int(plan.get("daily_credits") or 0),
                "original_amount": original,
                "savings": savings,
                "sort_order": int(plan.get("sort_order") or 0),
            })
        return {"list": result_list}
    except Exception as e:
        print(f"[get_membership_plans] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"获取会员套餐失败: {str(e)}")


@router.get("/api/membership/me", response_model=MembershipStatusResponse)
async def get_my_membership(
    user_info: dict = Depends(get_current_user_info)
):
    """获取当前登录用户的 Pro 会员状态（含今日配额与积分）。"""
    try:
        user_id = user_info["user_id"]
        membership = await _get_effective_membership(user_id)
        user_row = await get_user_by_id(user_id)
        result = _format_membership_response(membership)
        is_pro = result["is_pro"]

        # --- 旧拍照日限兼容（当前关闭） ---
        daily_limit = _get_food_analysis_daily_limit(is_pro)
        today_str = datetime.now(CHINA_TZ).strftime("%Y-%m-%d")
        daily_used_count = await get_today_food_analysis_count(user_id, today_str)
        if daily_limit is None:
            result["daily_limit"] = None
            result["daily_used"] = daily_used_count
            result["daily_remaining"] = None
        else:
            daily_used = min(daily_used_count, daily_limit)
            result["daily_limit"] = daily_limit
            result["daily_used"] = daily_used
            result["daily_remaining"] = max(daily_limit - daily_used, 0)

        # --- 新积分体系 ---
        credits_info = await _compute_daily_credits_status(
            user_id=user_id,
            is_pro=is_pro,
            membership=membership,
            user_row=user_row,
        )
        result.update(credits_info)
        return result
    except Exception as e:
        print(f"[get_my_membership] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"获取会员状态失败: {str(e)}")


@router.post("/api/membership/rewards/share-poster/claim", response_model=ClaimSharePosterRewardResponse)
async def claim_membership_share_poster_reward(
    body: ClaimSharePosterRewardRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """领取「生成分享海报」奖励：每条记录每日最多 1 次，每人每日最多 SHARE_POSTER_DAILY_MAX_EVENTS 条记录。"""
    user_id = user_info["user_id"]
    try:
        record_id = str(body.record_id or "").strip()
        if not record_id:
            raise HTTPException(status_code=400, detail="缺少记录 ID，请从饮食详情页生成海报后再领取奖励")
        record = await get_food_record_by_id(record_id)
        if not record:
            raise HTTPException(status_code=404, detail="记录不存在")
        if str(record.get("user_id") or "") != user_id:
            raise HTTPException(status_code=403, detail="只能为自己的记录领取海报奖励")

        today_str = datetime.now(CHINA_TZ).strftime("%Y-%m-%d")
        claim_result = await claim_share_poster_bonus(
            user_id=user_id,
            china_date_str=today_str,
            source_record_id=record_id,
        )
        await materialize_daily_share_poster_reward_credits(user_id, today_str)
        membership = await _get_effective_membership(user_id)
        user_row = await get_user_by_id(user_id)
        credits_info = await _compute_daily_credits_status(
            user_id=user_id,
            is_pro=bool(_format_membership_response(membership).get("is_pro")),
            membership=membership,
            user_row=user_row,
        )

        claimed = bool(claim_result.get("claimed"))
        already_claimed = bool(claim_result.get("already_claimed"))
        daily_cap_reached = bool(claim_result.get("daily_cap_reached"))
        share_poster_claims_today = int(claim_result.get("share_poster_claims_today") or 0)
        credits = int(claim_result.get("credits") or 0)
        cap_n = int(SHARE_POSTER_DAILY_MAX_EVENTS)
        if claimed:
            message = f"本餐海报奖励已到账 +{credits} 积分"
        elif already_claimed:
            message = "本条记录今日海报奖励已领取"
        elif daily_cap_reached:
            message = f"今日海报奖励已达上限（最多 {cap_n} 积分）"
        else:
            message = "海报已生成"
        return {
            "claimed": claimed,
            "already_claimed": already_claimed,
            "daily_cap_reached": daily_cap_reached,
            "share_poster_claims_today": share_poster_claims_today,
            "credits": credits,
            "daily_credits_max": int(credits_info.get("daily_credits_max") or 0),
            "daily_credits_remaining": int(credits_info.get("daily_credits_remaining") or 0),
            "earned_credits_balance": int(credits_info.get("earned_credits_balance") or 0),
            "total_credits_available": int(credits_info.get("total_credits_available") or 0),
            "message": message,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[claim_membership_share_poster_reward] 错误: {e}")
        raise HTTPException(status_code=500, detail="领取海报奖励失败")


@router.post("/api/membership/pay/create", response_model=CreateMembershipPaymentResponse)
async def create_membership_payment(
    body: CreateMembershipPaymentRequest,
    user_info: dict = Depends(get_current_user_info)
):
    """创建 Pro 会员支付订单，并返回小程序调起支付参数。"""
    try:
        config = _get_wechat_pay_config()
        plan = await get_membership_plan_by_code(body.plan_code)
        if not plan or not plan.get("is_active"):
            raise HTTPException(status_code=404, detail="会员套餐不存在或未启用")

        user = await get_user_by_id(user_info["user_id"])
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        openid = (user.get("openid") or "").strip()
        if not openid:
            raise HTTPException(status_code=400, detail="当前用户缺少 openid，无法发起微信支付")

        amount = _to_decimal_amount(plan.get("amount") or "0")
        duration_months = int(plan.get("duration_months") or 1)
        order_no = _generate_membership_order_no()
        canonical_url = "/v3/pay/transactions/jsapi"
        request_payload = {
            "appid": config["appid"],
            "mchid": config["mchid"],
            "description": plan.get("name") or "Pro 月度会员",
            "out_trade_no": order_no,
            "notify_url": config["notify_url"],
            "amount": {
                "total": _amount_to_fen(amount),
                "currency": "CNY",
            },
            "payer": {
                "openid": openid,
            },
        }
        request_body = json.dumps(request_payload, ensure_ascii=False, separators=(",", ":"))
        authorization = _build_wechatpay_authorization(
            mchid=config["mchid"],
            serial_no=config["serial_no"],
            private_key_pem=config["private_key"],
            method="POST",
            canonical_url=canonical_url,
            body=request_body,
        )

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"https://api.mch.weixin.qq.com{canonical_url}",
                content=request_body.encode("utf-8"),
                headers={
                    "Authorization": authorization,
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "User-Agent": "food-link/1.0",
                },
            )

        if response.status_code not in (200, 201):
            try:
                error_data = response.json()
                error_msg = error_data.get("message") or error_data.get("detail") or response.text
            except Exception:
                error_msg = response.text
            raise HTTPException(status_code=502, detail=f"微信下单失败: {error_msg}")

        response_data = response.json()
        prepay_id = (response_data.get("prepay_id") or "").strip()
        if not prepay_id:
            raise HTTPException(status_code=502, detail="微信下单失败：未返回 prepay_id")

        await _expire_pending_membership_orders_for_user(
            user_info["user_id"],
            reason="superseded_by_new_order",
        )

        await create_pro_membership_payment_record(
            {
                "user_id": user_info["user_id"],
                "plan_code": plan["code"],
                "order_no": order_no,
                "amount": float(amount),
                "currency": "CNY",
                "duration_months": duration_months,
                "pay_channel": "wechat_mini_program",
                "trade_type": "JSAPI",
                "status": "pending",
                "wx_openid": openid,
                "wx_prepay_id": prepay_id,
                "extra": {
                    "create_order_payload": request_payload,
                    "wechat_create_order_response": response_data,
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

        pay_params = _build_mini_program_pay_params(
            appid=config["appid"],
            prepay_id=prepay_id,
            private_key_pem=config["private_key"],
        )

        return {
            "order_no": order_no,
            "plan_code": plan["code"],
            "amount": float(amount),
            "pay_params": pay_params,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[create_membership_payment] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"创建会员支付失败: {str(e)}")


@router.post("/api/payment/wechat/notify/membership")
async def wechat_membership_notify(request: Request):
    """处理微信支付 Pro 会员支付回调。"""
    config = _get_wechat_pay_config()
    if not config.get("public_key"):
        raise HTTPException(status_code=500, detail="缺少微信支付公钥配置，无法处理支付回调")
    body_bytes = await request.body()
    body_text = body_bytes.decode("utf-8")

    signature = request.headers.get("Wechatpay-Signature", "")
    timestamp = request.headers.get("Wechatpay-Timestamp", "")
    nonce = request.headers.get("Wechatpay-Nonce", "")
    if not signature or not timestamp or not nonce:
        raise HTTPException(status_code=400, detail="微信支付回调缺少签名头")

    sign_message = f"{timestamp}\n{nonce}\n{body_text}\n"
    if not _verify_with_rsa_sha256(sign_message, signature, config["public_key"]):
        raise HTTPException(status_code=401, detail="微信支付回调验签失败")

    try:
        notify_data = json.loads(body_text or "{}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"微信支付回调报文解析失败: {e}")

    resource = notify_data.get("resource") or {}
    decrypted = _decrypt_wechatpay_resource(resource, config["api_v3_key"])
    order_no = (decrypted.get("out_trade_no") or "").strip()
    if not order_no:
        raise HTTPException(status_code=400, detail="微信支付回调缺少 out_trade_no")

    payment_record = await get_pro_membership_payment_record_by_order_no(order_no)
    if not payment_record:
        raise HTTPException(status_code=404, detail="未找到对应的会员支付记录")

    if payment_record.get("status") == "paid":
        return JSONResponse(content={"code": "SUCCESS", "message": "成功"})

    trade_state = (decrypted.get("trade_state") or "").upper()
    if trade_state != "SUCCESS":
        return JSONResponse(content={"code": "SUCCESS", "message": "已接收"})

    paid_total = int(((decrypted.get("amount") or {}).get("payer_total")) or ((decrypted.get("amount") or {}).get("total")) or 0)
    expected_total = _amount_to_fen(payment_record.get("amount") or 0)
    if paid_total != expected_total:
        raise HTTPException(status_code=400, detail="微信支付金额与订单金额不一致")

    paid_at = _parse_datetime(decrypted.get("success_time")) or datetime.now(timezone.utc)

    await update_pro_membership_payment_record(
        order_no,
        {
            "status": "paid",
            "wx_transaction_id": decrypted.get("transaction_id"),
            "wx_bank_type": decrypted.get("bank_type"),
            "paid_at": paid_at.isoformat(),
            "notify_payload": {
                "headers": {
                    "Wechatpay-Signature": signature,
                    "Wechatpay-Timestamp": timestamp,
                    "Wechatpay-Nonce": nonce,
                },
                "body": notify_data,
                "resource_decrypted": decrypted,
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    membership = await get_user_pro_membership(payment_record["user_id"])
    existing_expires_at = _parse_datetime(membership.get("expires_at")) if membership else None
    existing_first_activated_at = _parse_datetime(membership.get("first_activated_at")) if membership else None
    existing_period_start = _parse_datetime(membership.get("current_period_start")) if membership else None
    duration_months = int(payment_record.get("duration_months") or 1)

    if membership and membership.get("status") == "active" and existing_expires_at and existing_expires_at > paid_at:
        current_period_start = existing_period_start or paid_at
        expires_at = _add_months(existing_expires_at, duration_months)
        first_activated_at = existing_first_activated_at or paid_at
    else:
        current_period_start = paid_at
        expires_at = _add_months(paid_at, duration_months)
        first_activated_at = existing_first_activated_at or paid_at

    # 取新套餐的每日积分，作为 user_pro_memberships.daily_credits 快照
    plan_for_credits = await get_membership_plan_by_code(payment_record.get("plan_code") or "")
    plan_daily_credits = int((plan_for_credits or {}).get("daily_credits") or 0)
    paid_user_row = await get_user_by_id(payment_record["user_id"])
    early_user_meta = await _resolve_early_user_membership_meta(payment_record["user_id"], paid_user_row)
    if bool(early_user_meta.get("early_user_paid_bonus_eligible")) and plan_daily_credits > 0:
        plan_daily_credits *= int(early_user_meta.get("early_user_paid_bonus_multiplier") or 1)

    await save_user_pro_membership(
        payment_record["user_id"],
        {
            "current_plan_code": payment_record.get("plan_code"),
            "status": "active",
            "first_activated_at": _build_json_datetime(first_activated_at),
            "current_period_start": _build_json_datetime(current_period_start),
            "expires_at": _build_json_datetime(expires_at),
            "last_paid_at": paid_at.isoformat(),
            "auto_renew": False,
            "daily_credits": plan_daily_credits,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    await _expire_pending_membership_orders_for_user(
        payment_record["user_id"],
        reason="superseded_by_paid_order",
    )

    return JSONResponse(content={"code": "SUCCESS", "message": "成功"})
