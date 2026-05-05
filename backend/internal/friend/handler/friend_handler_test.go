package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type mockFriendService struct {
	searchUsersResult           []map[string]any
	searchUsersErr              error
	sendFriendRequestResult     map[string]any
	sendFriendRequestErr        error
	getFriendRequestsResult     []map[string]any
	getFriendRequestsErr        error
	respondFriendRequestErr     error
	cancelSentFriendRequestErr  error
	getFriendListResult         []map[string]any
	getFriendListErr            error
	countFriendsResult          int64
	countFriendsErr             error
	deleteFriendErr             error
	getFriendRequestsOverviewResult map[string]any
	getFriendRequestsOverviewErr    error
	cleanupDuplicateFriendsResult   map[string]any
	cleanupDuplicateFriendsErr      error
	getInviteProfileResult          map[string]any
	getInviteProfileErr             error
	resolveUserByInviteCodeResult   map[string]any
	resolveUserByInviteCodeErr      error
	resolveInviteWithRelationResult map[string]any
	resolveInviteWithRelationErr    error
	acceptInviteResult              map[string]any
	acceptInviteErr                 error
}

func (m *mockFriendService) SearchUsers(ctx context.Context, currentUserID, nickname, telephone string) ([]map[string]any, error) {
	return m.searchUsersResult, m.searchUsersErr
}
func (m *mockFriendService) SendFriendRequest(ctx context.Context, fromUserID, toUserID string) (map[string]any, error) {
	return m.sendFriendRequestResult, m.sendFriendRequestErr
}
func (m *mockFriendService) GetFriendRequestsReceived(ctx context.Context, toUserID string) ([]map[string]any, error) {
	return m.getFriendRequestsResult, m.getFriendRequestsErr
}
func (m *mockFriendService) RespondFriendRequest(ctx context.Context, requestID, toUserID, action string) error {
	return m.respondFriendRequestErr
}
func (m *mockFriendService) CancelSentFriendRequest(ctx context.Context, requestID, fromUserID string) error {
	return m.cancelSentFriendRequestErr
}
func (m *mockFriendService) GetFriendList(ctx context.Context, userID string) ([]map[string]any, error) {
	return m.getFriendListResult, m.getFriendListErr
}
func (m *mockFriendService) CountFriends(ctx context.Context, userID string) (int64, error) {
	return m.countFriendsResult, m.countFriendsErr
}
func (m *mockFriendService) DeleteFriend(ctx context.Context, userID, friendID string) error {
	return m.deleteFriendErr
}
func (m *mockFriendService) GetFriendRequestsOverview(ctx context.Context, userID string) (map[string]any, error) {
	return m.getFriendRequestsOverviewResult, m.getFriendRequestsOverviewErr
}
func (m *mockFriendService) CleanupDuplicateFriends(ctx context.Context, userID string) (map[string]any, error) {
	return m.cleanupDuplicateFriendsResult, m.cleanupDuplicateFriendsErr
}
func (m *mockFriendService) GetInviteProfile(ctx context.Context, userID string) (map[string]any, error) {
	return m.getInviteProfileResult, m.getInviteProfileErr
}
func (m *mockFriendService) ResolveUserByInviteCode(ctx context.Context, code string) (map[string]any, error) {
	return m.resolveUserByInviteCodeResult, m.resolveUserByInviteCodeErr
}
func (m *mockFriendService) ResolveInviteWithRelation(ctx context.Context, userID, code string) (map[string]any, error) {
	return m.resolveInviteWithRelationResult, m.resolveInviteWithRelationErr
}
func (m *mockFriendService) AcceptInvite(ctx context.Context, userID, code string) (map[string]any, error) {
	return m.acceptInviteResult, m.acceptInviteErr
}

func setupRouter(h *FriendHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "test-user-id")
		c.Next()
	})
	r.GET("/api/friend/search", h.Search)
	r.POST("/api/friend/request", h.SendRequest)
	r.GET("/api/friend/requests", h.GetRequests)
	r.POST("/api/friend/request/:request_id/respond", h.RespondRequest)
	r.DELETE("/api/friend/request/:request_id", h.CancelRequest)
	r.GET("/api/friend/list", h.List)
	r.GET("/api/friend/count", h.Count)
	r.DELETE("/api/friend/:friend_id", h.DeleteFriend)
	r.GET("/api/friend/requests/all", h.RequestsOverview)
	r.POST("/api/friend/cleanup-duplicates", h.CleanupDuplicates)
	r.GET("/api/friend/invite/profile/:user_id", h.InviteProfile)
	r.GET("/api/friend/invite/profile-by-code", h.InviteProfileByCode)
	r.GET("/api/friend/invite/resolve", h.InviteResolve)
	r.POST("/api/friend/invite/accept", h.InviteAccept)
	return r
}

func TestFriendHandler_Search(t *testing.T) {
	mockSvc := &mockFriendService{searchUsersResult: []map[string]any{{"id": "u2", "nickname": "Alice"}}}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/friend/search?nickname=Ali", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
	data := resp["data"].([]any)
	assert.Len(t, data, 1)
}

func TestFriendHandler_SearchMissingKeyword(t *testing.T) {
	mockSvc := &mockFriendService{}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/friend/search", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestFriendHandler_SendRequest(t *testing.T) {
	mockSvc := &mockFriendService{sendFriendRequestResult: map[string]any{"id": "req-1", "status": "pending"}}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"to_user_id": "u2"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/friend/request", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "pending", data["status"])
}

func TestFriendHandler_GetRequests(t *testing.T) {
	mockSvc := &mockFriendService{getFriendRequestsResult: []map[string]any{{"id": "req-1", "from_nickname": "Alice"}}}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/friend/requests", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].([]any)
	assert.Len(t, data, 1)
}

func TestFriendHandler_RespondRequest(t *testing.T) {
	mockSvc := &mockFriendService{}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"action": "accept"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/friend/request/req-1/respond", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, true, resp["data"].(map[string]any)["success"])
}

func TestFriendHandler_CancelRequest(t *testing.T) {
	mockSvc := &mockFriendService{}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/friend/request/req-1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestFriendHandler_List(t *testing.T) {
	mockSvc := &mockFriendService{getFriendListResult: []map[string]any{{"id": "u2", "nickname": "Alice"}}}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/friend/list", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].([]any)
	assert.Len(t, data, 1)
}

func TestFriendHandler_Count(t *testing.T) {
	mockSvc := &mockFriendService{countFriendsResult: 5}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/friend/count", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(5), resp["data"].(map[string]any)["count"])
}

func TestFriendHandler_DeleteFriend(t *testing.T) {
	mockSvc := &mockFriendService{}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/friend/u2", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestFriendHandler_RequestsOverview(t *testing.T) {
	mockSvc := &mockFriendService{getFriendRequestsOverviewResult: map[string]any{"received": []map[string]any{}, "sent": []map[string]any{}}}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/friend/requests/all", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestFriendHandler_CleanupDuplicates(t *testing.T) {
	mockSvc := &mockFriendService{cleanupDuplicateFriendsResult: map[string]any{"cleaned": int64(2), "user_id": "test-user-id"}}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/friend/cleanup-duplicates", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, float64(2), data["cleaned"])
}

func TestFriendHandler_InviteProfile(t *testing.T) {
	mockSvc := &mockFriendService{getInviteProfileResult: map[string]any{"id": "u1", "nickname": "Bob", "invite_code": "abcd1234"}}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/friend/invite/profile/u1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "abcd1234", data["invite_code"])
}

func TestFriendHandler_InviteProfileByCode(t *testing.T) {
	mockSvc := &mockFriendService{resolveUserByInviteCodeResult: map[string]any{"id": "u1", "nickname": "Bob"}}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/friend/invite/profile-by-code?code=abcd1234", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestFriendHandler_InviteResolve(t *testing.T) {
	mockSvc := &mockFriendService{resolveInviteWithRelationResult: map[string]any{"id": "u1", "is_self": false, "is_friend": false}}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/friend/invite/resolve?code=abcd1234", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, false, data["is_self"])
}

func TestFriendHandler_InviteAccept(t *testing.T) {
	mockSvc := &mockFriendService{acceptInviteResult: map[string]any{"request_id": "req-1", "status": "pending"}}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"code": "abcd1234"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/friend/invite/accept", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "req-1", data["request_id"])
}

func TestFriendHandler_InviteAcceptMissingCode(t *testing.T) {
	mockSvc := &mockFriendService{}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/friend/invite/accept", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestFriendHandler_Error(t *testing.T) {
	mockSvc := &mockFriendService{getFriendListErr: errors.New("db error")}
	h := NewFriendHandler(mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/friend/list", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
