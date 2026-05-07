from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import (
    add_feed_comment_sync,
    add_feed_like,
    build_friend_invite_code,
    cancel_sent_friend_request,
    cleanup_duplicate_friends,
    count_friends_sync,
    count_unread_feed_interaction_notifications,
    create_feed_interaction_notification_sync,
    delete_friend_pair,
    get_feed_comment_by_id,
    get_feed_comment_by_id_sync,
    get_feed_likes_for_records,
    get_feed_record_interaction_context,
    get_food_record_by_id_sync,
    get_friend_circle_week_checkin_leaderboard,
    get_friend_requests_overview,
    get_friend_requests_received,
    get_friends_with_profile,
    get_user_by_id,
    hide_food_record_from_feed,
    is_friend,
    list_comment_tasks_by_user_sync,
    list_feed_comments,
    list_feed_interaction_notifications,
    list_friends_feed_records,
    list_public_feed_records,
    mark_feed_interaction_notifications_read,
    remove_feed_like,
    resolve_user_by_friend_invite_code,
    respond_friend_request,
    search_users,
    send_friend_request,
)
from middleware import get_current_user_info

router = APIRouter()


# ---------- 好友与圈子 ----------

@router.get("/api/friend/search")
async def api_friend_search(
    nickname: Optional[str] = None,
    telephone: Optional[str] = None,
    user_info: dict = Depends(get_current_user_info),
):
    """搜索用户（昵称模糊 / 手机号精确），排除自己、已是好友、已发过待处理请求的。返回 id, nickname, avatar。"""
    if not nickname and not telephone:
        return {"list": []}
    try:
        users = await search_users(
            current_user_id=user_info["user_id"],
            nickname=nickname.strip() if nickname else None,
            telephone=telephone.strip() if telephone else None,
            limit=20,
        )
        return {"list": users}
    except Exception as e:
        print(f"[api/friend/search] 错误: {e}")
        raise HTTPException(status_code=500, detail="搜索失败")


@router.post("/api/friend/request")
async def api_friend_request(
    body: dict,
    user_info: dict = Depends(get_current_user_info),
):
    """发送好友请求。body: { "to_user_id": "uuid" }"""
    to_user_id = body.get("to_user_id")
    if not to_user_id:
        raise HTTPException(status_code=400, detail="缺少 to_user_id")
    try:
        await send_friend_request(user_info["user_id"], to_user_id)
        return {"message": "已发送好友请求"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/request] 错误: {e}")
        raise HTTPException(status_code=500, detail="发送失败")


@router.get("/api/friend/requests")
async def api_friend_requests(user_info: dict = Depends(get_current_user_info)):
    """收到的待处理好友请求列表"""
    try:
        rows = await get_friend_requests_received(user_info["user_id"])
        return {"list": rows}
    except Exception as e:
        print(f"[api/friend/requests] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取失败")


@router.post("/api/friend/request/{request_id}/respond")
async def api_friend_respond(
    request_id: str,
    body: dict,
    user_info: dict = Depends(get_current_user_info),
):
    """处理好友请求。body: { "action": "accept" | "reject" }"""
    action = body.get("action")
    if action not in ("accept", "reject"):
        raise HTTPException(status_code=400, detail="action 须为 accept 或 reject")
    try:
        await respond_friend_request(request_id, user_info["user_id"], action == "accept")
        return {"message": "已接受" if action == "accept" else "已拒绝"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/respond] 错误: {e}")
        raise HTTPException(status_code=500, detail="操作失败")


@router.delete("/api/friend/request/{request_id}")
async def api_friend_request_cancel(
    request_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """撤销本人发出的、对方尚未处理的待处理好友请求。"""
    try:
        await cancel_sent_friend_request(request_id, user_info["user_id"])
        return {"message": "已撤销好友请求"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/request/cancel] 错误: {e}")
        raise HTTPException(status_code=500, detail="撤销失败")


@router.get("/api/friend/list")
async def api_friend_list(user_info: dict = Depends(get_current_user_info)):
    """好友列表"""
    try:
        friends = await get_friends_with_profile(user_info["user_id"])
        return {"list": friends}
    except Exception as e:
        print(f"[api/friend/list] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取失败")


@router.get("/api/friend/count")
async def api_friend_count(user_info: dict = Depends(get_current_user_info)):
    """获取当前用户的好友数量"""
    try:
        count = await count_friends_sync(user_info["user_id"])
        return {"count": count}
    except Exception as e:
        print(f"[api/friend/count] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取好友数量失败")


@router.delete("/api/friend/{friend_id}")
async def api_friend_delete(
    friend_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """删除好友（双向删除）。"""
    try:
        current_user_id = user_info["user_id"]
        if friend_id == current_user_id:
            raise HTTPException(status_code=400, detail="不能删除自己")
        result = await delete_friend_pair(current_user_id, friend_id)
        if result.get("deleted", 0) <= 0:
            raise HTTPException(status_code=404, detail="好友关系不存在")
        return {"message": "已删除好友", **result}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/friend/delete] 错误: {e}")
        raise HTTPException(status_code=500, detail="删除好友失败")


@router.get("/api/friend/requests/all")
async def api_friend_requests_overview(user_info: dict = Depends(get_current_user_info)):
    """好友请求总览（收到 + 发出，含 pending/accepted/rejected）。"""
    try:
        return await get_friend_requests_overview(user_info["user_id"])
    except Exception as e:
        print(f"[api/friend/requests/all] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取失败")


@router.post("/api/friend/cleanup-duplicates")
async def api_friend_cleanup_duplicates(user_info: dict = Depends(get_current_user_info)):
    """清理当前用户的重复好友记录"""
    try:
        result = await cleanup_duplicate_friends(user_info["user_id"])
        return result
    except Exception as e:
        print(f"[api/friend/cleanup-duplicates] 错误: {e}")
        raise HTTPException(status_code=500, detail="清理失败")


@router.get("/api/friend/invite/profile/{user_id}")
async def api_friend_invite_profile(user_id: str):
    """公开获取邀请资料（昵称、头像、邀请码），用于分享页和海报展示。"""
    try:
        user = await get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        return {
            "user_id": user["id"],
            "nickname": user.get("nickname") or "用户",
            "avatar": user.get("avatar") or "",
            "invite_code": build_friend_invite_code(user["id"]),
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/friend/invite/profile] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取邀请信息失败")


@router.get("/api/friend/invite/profile-by-code")
async def api_friend_invite_profile_by_code(code: str):
    """公开按邀请码获取邀请资料，用于邀请落地页展示。"""
    try:
        inviter = await resolve_user_by_friend_invite_code(code)
        if not inviter:
            raise HTTPException(status_code=404, detail="邀请码无效")
        return {
            "user_id": inviter["id"],
            "nickname": inviter.get("nickname") or "用户",
            "avatar": inviter.get("avatar") or "",
            "invite_code": build_friend_invite_code(inviter["id"]),
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/friend/invite/profile-by-code] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取邀请信息失败")


@router.get("/api/friend/invite/resolve")
async def api_friend_invite_resolve(
    code: str,
    user_info: dict = Depends(get_current_user_info),
):
    """登录后解析邀请码，返回邀请人资料与当前好友状态。"""
    try:
        inviter = await resolve_user_by_friend_invite_code(code)
        if not inviter:
            raise HTTPException(status_code=404, detail="邀请码无效")
        current_user_id = user_info["user_id"]
        inviter_id = inviter["id"]
        if inviter_id == current_user_id:
            return {
                "user_id": inviter_id,
                "nickname": inviter.get("nickname") or "用户",
                "avatar": inviter.get("avatar") or "",
                "already_friend": False,
                "is_self": True,
            }
        already_friend = await is_friend(current_user_id, inviter_id)
        return {
            "user_id": inviter_id,
            "nickname": inviter.get("nickname") or "用户",
            "avatar": inviter.get("avatar") or "",
            "already_friend": already_friend,
            "is_self": False,
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/invite/resolve] 错误: {e}")
        raise HTTPException(status_code=500, detail="解析邀请码失败")


class FriendInviteAcceptRequest(BaseModel):
    code: str = Field(..., description="短邀请码（通常 8 位）")


@router.post("/api/friend/invite/accept")
async def api_friend_invite_accept(
    body: FriendInviteAcceptRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """通过邀请码发起好友申请（需对方同意后才会成为好友）。"""
    try:
        inviter = await resolve_user_by_friend_invite_code(body.code)
        if not inviter:
            raise HTTPException(status_code=404, detail="邀请码无效")
        current_user_id = user_info["user_id"]
        inviter_id = inviter["id"]
        if inviter_id == current_user_id:
            raise HTTPException(status_code=400, detail="不能添加自己为好友")

        if await is_friend(current_user_id, inviter_id):
            return {
                "status": "already_friend",
                "user_id": inviter_id,
                "nickname": inviter.get("nickname") or "用户",
                "avatar": inviter.get("avatar") or "",
            }

        # 仅发起申请，不直接建立好友关系，必须由分享者在请求列表中同意。
        await send_friend_request(current_user_id, inviter_id)
        return {
            "status": "request_sent",
            "user_id": inviter_id,
            "nickname": inviter.get("nickname") or "用户",
            "avatar": inviter.get("avatar") or "",
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/invite/accept] 错误: {e}")
        raise HTTPException(status_code=500, detail="添加好友失败")

class CommunityCommentCreateRequest(BaseModel):
    content: str = Field(..., description="评论内容")
    parent_comment_id: Optional[str] = Field(default=None, description="被回复的父评论 ID")
    reply_to_user_id: Optional[str] = Field(default=None, description="被回复用户 ID")


class MarkFeedNotificationsReadRequest(BaseModel):
    notification_ids: Optional[List[str]] = Field(default=None, description="可选，指定要标记已读的通知 ID 列表")


async def _ensure_feed_record_interactable(user_id: str, record_id: str) -> Dict[str, Any]:
    context = await get_feed_record_interaction_context(user_id, record_id)
    if not context.get("record"):
        raise HTTPException(status_code=404, detail="动态不存在")
    if not context.get("allowed"):
        raise HTTPException(status_code=403, detail="无权操作该动态")
    return context["record"]


@router.get("/api/community/public-feed")
async def api_community_public_feed(
    offset: int = 0,
    limit: int = 20,
    include_comments: bool = True,
    comments_limit: int = 5,
    meal_type: Optional[str] = None,
    diet_goal: Optional[str] = None,
    sort_by: str = "recommended",
):
    """
    公共 Feed：无需登录，返回 public_records=true 的用户的饮食记录。
    带点赞数和评论列表（不含 liked / is_mine）。
    """
    try:
        items = await list_public_feed_records(
            offset=offset,
            limit=limit,
            include_comments=include_comments,
            comments_limit=comments_limit,
            meal_type=meal_type,
            diet_goal=diet_goal,
            sort_by=sort_by,
        )

        out = []
        for item in items:
            rec = item["record"]
            feed_item: dict = {
                "record": rec,
                "author": item["author"],
                "like_count": item.get("like_count", 0),
                "liked": False,
                "is_mine": False,
                "recommend_reason": item.get("recommend_reason"),
            }
            if include_comments:
                comments = item.get("comments", [])
                feed_item["comments"] = comments
                feed_item["comment_count"] = item.get("comment_count", len(comments))
            else:
                feed_item["comment_count"] = item.get("comment_count", 0)
            out.append(feed_item)

        has_more = len(items) >= limit
        return {"list": out, "has_more": has_more}
    except Exception as e:
        import traceback
        print(f"[api/community/public-feed] 错误: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="获取动态失败")


@router.get("/api/community/feed")
async def api_community_feed(
    date: Optional[str] = None,
    offset: int = 0,
    limit: int = 20,
    include_comments: bool = True,
    comments_limit: int = 5,
    meal_type: Optional[str] = None,
    diet_goal: Optional[str] = None,
    sort_by: str = "recommended",
    priority_author_ids: Optional[str] = None,
    author_scope: str = "all",
    author_id: Optional[str] = None,
    user_info: dict = Depends(get_current_user_info),
):
    """
    圈子 Feed：好友 + 自己的饮食记录（支持分页），带点赞数、是否已点赞、评论列表。
    
    Args:
        date: 可选日期筛选（YYYY-MM-DD）
        offset: 分页偏移量
        limit: 每页记录数
        include_comments: 是否包含评论（默认 True）
        comments_limit: 每条记录返回的评论数（默认 5）
    
    Returns:
        { "list": [{ record, author, like_count, liked, is_mine, comments, comment_count }], "has_more": bool }
    """
    try:
        current_user_id = user_info["user_id"]
        items = await list_friends_feed_records(
            current_user_id, 
            date=date, 
            offset=offset, 
            limit=limit,
            include_comments=include_comments,
            comments_limit=comments_limit,
            meal_type=meal_type,
            diet_goal=diet_goal,
            sort_by=sort_by,
            priority_author_ids=[x.strip() for x in (priority_author_ids or "").split(",") if x.strip()],
            author_scope=author_scope,
            author_id=author_id,
        )
        
        out = []
        for item in items:
            rec = item["record"]
            
            feed_item = {
                "record": rec,
                "author": item["author"],
                "like_count": item.get("like_count", 0),
                "liked": item.get("liked", False),
                "is_mine": item.get("is_mine", rec.get("user_id") == current_user_id),
                "recommend_reason": item.get("recommend_reason"),
            }
            
            if include_comments:
                comments = item.get("comments", [])
                feed_item["comments"] = comments
                feed_item["comment_count"] = item.get("comment_count", len(comments))
            else:
                feed_item["comment_count"] = item.get("comment_count", 0)
            
            out.append(feed_item)
        
        # 返回是否还有更多数据
        has_more = len(items) >= limit
        return {"list": out, "has_more": has_more}
    except Exception as e:
        import traceback
        print(f"[api/community/feed] 错误: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="获取动态失败")


@router.get("/api/community/checkin-leaderboard")
async def api_community_checkin_leaderboard(
    user_info: dict = Depends(get_current_user_info),
):
    """本周打卡排行榜：自己 + 好友按饮食记录条数排名（北京时间自然周）。"""
    try:
        data = await get_friend_circle_week_checkin_leaderboard(user_info["user_id"])
        return data
    except Exception as e:
        print(f"[api/community/checkin-leaderboard] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取排行榜失败")


@router.post("/api/community/feed/{record_id}/like")
async def api_community_like(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """对某条动态点赞"""
    try:
        record = await _ensure_feed_record_interactable(user_info["user_id"], record_id)
        inserted = await add_feed_like(user_info["user_id"], record_id)
        record_owner_id = str(record.get("user_id") or "").strip()
        if inserted and record_owner_id and record_owner_id != user_info["user_id"]:
            content_preview = (str(record.get("description") or "").strip() or "赞了你的动态")[:120]
            try:
                await asyncio.to_thread(
                    create_feed_interaction_notification_sync,
                    recipient_user_id=record_owner_id,
                    actor_user_id=user_info["user_id"],
                    record_id=record_id,
                    notification_type="like_received",
                    content_preview=content_preview,
                )
            except Exception as notify_err:
                print(f"[api/community/feed/like] 创建点赞通知失败: {notify_err}")
        return {"message": "已点赞"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/like] 错误: {e}")
        raise HTTPException(status_code=500, detail="点赞失败")


@router.delete("/api/community/feed/{record_id}/like")
async def api_community_unlike(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """取消点赞"""
    try:
        await _ensure_feed_record_interactable(user_info["user_id"], record_id)
        await remove_feed_like(user_info["user_id"], record_id)
        return {"message": "已取消"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/unlike] 错误: {e}")
        raise HTTPException(status_code=500, detail="取消失败")


@router.post("/api/community/feed/{record_id}/hide")
async def api_community_hide_feed(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """将自己的动态从圈子中隐藏（不删除饮食记录本身）。"""
    user_id = user_info["user_id"]
    try:
        hidden = await hide_food_record_from_feed(user_id=user_id, record_id=record_id)
        if not hidden:
            raise HTTPException(status_code=404, detail="记录不存在或无权操作")
        return {"message": "已从圈子中移除"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/hide] 错误: {e}")
        raise HTTPException(status_code=500, detail="操作失败")


@router.get("/api/community/feed/{record_id}/comments")
async def api_community_comments(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """某条动态的评论列表"""
    try:
        await _ensure_feed_record_interactable(user_info["user_id"], record_id)
        comments = await list_feed_comments(record_id, limit=50)
        return {"list": comments}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/comments] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取评论失败")


@router.get("/api/community/feed/{record_id}/context")
async def api_community_feed_record_context(
    record_id: str,
    comments_limit: int = 5,
    user_info: dict = Depends(get_current_user_info),
):
    """按记录 ID 获取单条圈子动态的互动上下文，用于通知跳转定位。"""
    try:
        current_user_id = user_info["user_id"]
        record = await _ensure_feed_record_interactable(current_user_id, record_id)
        author = await get_user_by_id(record.get("user_id")) if record.get("user_id") else None
        likes_map = await get_feed_likes_for_records([record_id], current_user_id)
        preview_limit = max(0, min(comments_limit, 20))
        comments = await list_feed_comments(record_id, limit=preview_limit) if preview_limit > 0 else []
        like_info = likes_map.get(record_id, {"count": 0, "liked": False})

        item = {
            "record": record,
            "author": {
                "id": (author or {}).get("id"),
                "nickname": (author or {}).get("nickname") or "用户",
                "avatar": (author or {}).get("avatar") or "",
            },
            "like_count": like_info.get("count", 0),
            "liked": like_info.get("liked", False),
            "is_mine": record.get("user_id") == current_user_id,
            "comments": comments,
            "comment_count": len(comments),
        }
        return {"item": item}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/context] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取动态上下文失败")


@router.post("/api/community/feed/{record_id}/comments")
async def api_community_comment_post(
    record_id: str,
    body: CommunityCommentCreateRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    发表评论（直接发布版本）。
    body: { "content": "评论内容" }
    """
    await _ensure_feed_record_interactable(user_info["user_id"], record_id)

    content = (body.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    if len(content) > 500:
        raise HTTPException(status_code=400, detail="评论内容不能超过 500 字")
    try:
        parent_comment_id = body.parent_comment_id
        reply_to_user_id = body.reply_to_user_id
        if reply_to_user_id and not parent_comment_id:
            raise HTTPException(status_code=400, detail="回复评论时必须提供 parent_comment_id")

        if parent_comment_id:
            parent_comment = await get_feed_comment_by_id(parent_comment_id)
            if not parent_comment or parent_comment.get("record_id") != record_id:
                raise HTTPException(status_code=400, detail="被回复评论不存在或不属于当前动态")
            if not reply_to_user_id:
                reply_to_user_id = parent_comment.get("user_id")

        profile = await get_user_by_id(user_info["user_id"])
        nickname = (
            user_info.get("nickname")
            or (profile or {}).get("nickname")
            or "用户"
        )
        avatar = (
            user_info.get("avatar")
            or (profile or {}).get("avatar")
            or ""
        )
        comment = add_feed_comment_sync(
            user_id=user_info["user_id"],
            record_id=record_id,
            content=content,
            parent_comment_id=parent_comment_id,
            reply_to_user_id=reply_to_user_id,
        )
        is_deduped = bool(comment.get("_deduped"))

        try:
            record = get_food_record_by_id_sync(record_id)
            record_owner_id = (record or {}).get("user_id")
            if (not is_deduped) and record_owner_id and record_owner_id != user_info["user_id"]:
                create_feed_interaction_notification_sync(
                    recipient_user_id=record_owner_id,
                    actor_user_id=user_info["user_id"],
                    record_id=record_id,
                    comment_id=comment.get("id"),
                    parent_comment_id=parent_comment_id,
                    notification_type="comment_received",
                    content_preview=(content or "")[:120],
                )

            if (not is_deduped) and reply_to_user_id and reply_to_user_id != user_info["user_id"]:
                create_feed_interaction_notification_sync(
                    recipient_user_id=reply_to_user_id,
                    actor_user_id=user_info["user_id"],
                    record_id=record_id,
                    comment_id=comment.get("id"),
                    parent_comment_id=parent_comment_id,
                    notification_type="reply_received",
                    content_preview=(content or "")[:120],
                )
            elif (not is_deduped) and parent_comment_id:
                parent_comment_sync = get_feed_comment_by_id_sync(parent_comment_id)
                parent_owner_id = (parent_comment_sync or {}).get("user_id")
                if parent_owner_id and parent_owner_id != user_info["user_id"]:
                    create_feed_interaction_notification_sync(
                        recipient_user_id=parent_owner_id,
                        actor_user_id=user_info["user_id"],
                        record_id=record_id,
                        comment_id=comment.get("id"),
                        parent_comment_id=parent_comment_id,
                        notification_type="reply_received",
                        content_preview=(content or "")[:120],
                    )
        except Exception as notify_err:
            print(f"[api/community/feed/comment] 创建圈子互动通知失败: {notify_err}")

        return {
            "comment": {
                "id": comment["id"],
                "user_id": user_info["user_id"],
                "record_id": record_id,
                "parent_comment_id": parent_comment_id,
                "reply_to_user_id": reply_to_user_id,
                "reply_to_nickname": "",
                "content": content,
                "created_at": comment["created_at"],
                "nickname": nickname,
                "avatar": avatar,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/comment] 错误: {e}")
        raise HTTPException(status_code=500, detail="发表失败")


@router.get("/api/community/comment-tasks")
async def api_community_comment_tasks(
    limit: int = 50,
    user_info: dict = Depends(get_current_user_info),
):
    """查询当前用户最近的圈子评论审核任务状态。"""
    try:
        tasks = list_comment_tasks_by_user_sync(
            user_info["user_id"],
            comment_type="feed",
            limit=max(1, min(limit, 100)),
        )
        out = []
        for task in tasks:
            extra = task.get("extra") or {}
            out.append({
                "id": task.get("id"),
                "target_id": task.get("target_id"),
                "content": task.get("content") or "",
                "status": task.get("status"),
                "created_at": task.get("created_at"),
                "updated_at": task.get("updated_at"),
                "violation_reason": task.get("violation_reason"),
                "error_message": task.get("error_message"),
                "result": task.get("result"),
                "extra": {
                    "parent_comment_id": extra.get("parent_comment_id"),
                    "reply_to_user_id": extra.get("reply_to_user_id"),
                }
            })
        return {"list": out}
    except Exception as e:
        print(f"[api/community/comment-tasks] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取评论状态失败")


@router.get("/api/community/notifications")
async def api_community_notifications(
    limit: int = 50,
    user_info: dict = Depends(get_current_user_info),
):
    """查询圈子互动通知。"""
    try:
        size = max(1, min(limit, 100))
        items = await list_feed_interaction_notifications(user_info["user_id"], limit=size)
        unread_count = await count_unread_feed_interaction_notifications(user_info["user_id"])
        return {"list": items, "unread_count": unread_count}
    except Exception as e:
        print(f"[api/community/notifications] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取互动消息失败")


@router.post("/api/community/notifications/read")
async def api_community_notifications_read(
    body: MarkFeedNotificationsReadRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """标记圈子互动通知为已读。"""
    try:
        updated = await mark_feed_interaction_notifications_read(
            user_info["user_id"],
            notification_ids=body.notification_ids,
        )
        unread_count = await count_unread_feed_interaction_notifications(user_info["user_id"])
        return {"updated": updated, "unread_count": unread_count}
    except Exception as e:
        print(f"[api/community/notifications/read] 错误: {e}")
        raise HTTPException(status_code=500, detail="更新互动消息失败")


