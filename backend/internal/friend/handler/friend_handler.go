package handler

import (
	"context"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"

	"github.com/gin-gonic/gin"
)

type FriendService interface {
	SearchUsers(ctx context.Context, currentUserID, nickname, telephone string) ([]map[string]any, error)
	SendFriendRequest(ctx context.Context, fromUserID, toUserID string) (map[string]any, error)
	GetFriendRequestsReceived(ctx context.Context, toUserID string) ([]map[string]any, error)
	RespondFriendRequest(ctx context.Context, requestID, toUserID, action string) error
	CancelSentFriendRequest(ctx context.Context, requestID, fromUserID string) error
	GetFriendList(ctx context.Context, userID string) ([]map[string]any, error)
	CountFriends(ctx context.Context, userID string) (int64, error)
	DeleteFriend(ctx context.Context, userID, friendID string) error
	GetFriendRequestsOverview(ctx context.Context, userID string) (map[string]any, error)
	CleanupDuplicateFriends(ctx context.Context, userID string) (map[string]any, error)
	GetInviteProfile(ctx context.Context, userID string) (map[string]any, error)
	ResolveUserByInviteCode(ctx context.Context, code string) (map[string]any, error)
	ResolveInviteWithRelation(ctx context.Context, userID, code string) (map[string]any, error)
	AcceptInvite(ctx context.Context, userID, code string) (map[string]any, error)
}

type FriendHandler struct {
	svc FriendService
}

func NewFriendHandler(svc FriendService) *FriendHandler {
	return &FriendHandler{svc: svc}
}

// GET /api/friend/search
func (h *FriendHandler) Search(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	nickname := c.Query("nickname")
	telephone := c.Query("telephone")
	if nickname == "" && telephone == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "缺少搜索关键词", HTTPStatus: 400})
		return
	}
	data, err := h.svc.SearchUsers(c.Request.Context(), userID, nickname, telephone)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/friend/request
func (h *FriendHandler) SendRequest(c *gin.Context) {
	var body struct {
		ToUserID string `json:"to_user_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if body.ToUserID == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "to_user_id 不能为空", HTTPStatus: 400})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.svc.SendFriendRequest(c.Request.Context(), userID, body.ToUserID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// GET /api/friend/requests
func (h *FriendHandler) GetRequests(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.svc.GetFriendRequestsReceived(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/friend/request/:request_id/respond
func (h *FriendHandler) RespondRequest(c *gin.Context) {
	requestID := c.Param("request_id")
	var body struct {
		Action string `json:"action"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if body.Action == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "action 不能为空", HTTPStatus: 400})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.svc.RespondFriendRequest(c.Request.Context(), requestID, userID, body.Action); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]bool{"success": true})
}

// DELETE /api/friend/request/:request_id
func (h *FriendHandler) CancelRequest(c *gin.Context) {
	requestID := c.Param("request_id")
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.svc.CancelSentFriendRequest(c.Request.Context(), requestID, userID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]bool{"success": true})
}

// GET /api/friend/list
func (h *FriendHandler) List(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.svc.GetFriendList(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// GET /api/friend/count
func (h *FriendHandler) Count(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	count, err := h.svc.CountFriends(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]int64{"count": count})
}

// DELETE /api/friend/:friend_id
func (h *FriendHandler) DeleteFriend(c *gin.Context) {
	friendID := c.Param("friend_id")
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.svc.DeleteFriend(c.Request.Context(), userID, friendID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]bool{"success": true})
}

// GET /api/friend/requests/all
func (h *FriendHandler) RequestsOverview(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.svc.GetFriendRequestsOverview(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/friend/cleanup-duplicates
func (h *FriendHandler) CleanupDuplicates(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.svc.CleanupDuplicateFriends(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// GET /api/friend/invite/profile/:user_id
func (h *FriendHandler) InviteProfile(c *gin.Context) {
	userID := c.Param("user_id")
	data, err := h.svc.GetInviteProfile(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// GET /api/friend/invite/profile-by-code
func (h *FriendHandler) InviteProfileByCode(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "code 不能为空", HTTPStatus: 400})
		return
	}
	data, err := h.svc.ResolveUserByInviteCode(c.Request.Context(), code)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// GET /api/friend/invite/resolve
func (h *FriendHandler) InviteResolve(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "code 不能为空", HTTPStatus: 400})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.svc.ResolveInviteWithRelation(c.Request.Context(), userID, code)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/friend/invite/accept
func (h *FriendHandler) InviteAccept(c *gin.Context) {
	var body struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if body.Code == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "code 不能为空", HTTPStatus: 400})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.svc.AcceptInvite(c.Request.Context(), userID, body.Code)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}
