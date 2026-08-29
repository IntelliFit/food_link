package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"food_link/backend/internal/community/domain"
	"food_link/backend/internal/community/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockCommunityService struct {
	publicFeed           []service.FeedItem
	publicFeedParams     *service.FeedParams
	publicFeedErr        error
	friendFeed           []service.FeedItem
	friendFeedErr        error
	leaderboard          *service.LeaderboardResult
	leaderboardErr       error
	healthLeaderboard    *service.HealthLeaderboardResult
	healthLeaderboardErr error
	foodLeaderboard      *service.FoodNutrientLeaderboardResult
	foodLeaderboardErr   error
	likeMsg              string
	likeErr              error
	unlikeMsg            string
	unlikeErr            error
	hideErr              error
	comments             []service.CommentItem
	commentsErr          error
	feedContext          *service.FeedContextResult
	feedContextErr       error
	postComment          *service.CommentItem
	postCommentErr       error
	commentTasks         []domain.CommentTask
	commentTasksErr      error
	notifications        *service.NotificationListResult
	notificationsErr     error
	markRead             *service.MarkReadResult
	markReadErr          error
}

func (m *mockCommunityService) PublicFeed(ctx context.Context, params service.FeedParams) ([]service.FeedItem, error) {
	m.publicFeedParams = &params
	return m.publicFeed, m.publicFeedErr
}
func (m *mockCommunityService) FriendFeed(ctx context.Context, userID string, params service.FeedParams) ([]service.FeedItem, error) {
	return m.friendFeed, m.friendFeedErr
}
func (m *mockCommunityService) CheckinLeaderboard(ctx context.Context, viewerUserID string) (*service.LeaderboardResult, error) {
	return m.leaderboard, m.leaderboardErr
}
func (m *mockCommunityService) HealthLeaderboard(ctx context.Context, viewerUserID string) (*service.HealthLeaderboardResult, error) {
	return m.healthLeaderboard, m.healthLeaderboardErr
}
func (m *mockCommunityService) FoodNutrientLeaderboard(ctx context.Context, nutrient string, limit int) (*service.FoodNutrientLeaderboardResult, error) {
	return m.foodLeaderboard, m.foodLeaderboardErr
}
func (m *mockCommunityService) LikeFeed(ctx context.Context, userID, recordID string) (string, error) {
	return m.likeMsg, m.likeErr
}
func (m *mockCommunityService) LikeFeedTarget(ctx context.Context, userID, targetType, targetID string) (string, error) {
	return m.likeMsg, m.likeErr
}
func (m *mockCommunityService) UnlikeFeed(ctx context.Context, userID, recordID string) (string, error) {
	return m.unlikeMsg, m.unlikeErr
}
func (m *mockCommunityService) UnlikeFeedTarget(ctx context.Context, userID, targetType, targetID string) (string, error) {
	return m.unlikeMsg, m.unlikeErr
}
func (m *mockCommunityService) HideFeed(ctx context.Context, userID, recordID string) error {
	return m.hideErr
}
func (m *mockCommunityService) HideFeedTarget(ctx context.Context, userID, targetType, targetID string) error {
	return m.hideErr
}
func (m *mockCommunityService) ListComments(ctx context.Context, viewerUserID, recordID string, limit int) ([]service.CommentItem, error) {
	return m.comments, m.commentsErr
}
func (m *mockCommunityService) ListTargetComments(ctx context.Context, viewerUserID, targetType, targetID string, limit int) ([]service.CommentItem, error) {
	return m.comments, m.commentsErr
}
func (m *mockCommunityService) FeedContext(ctx context.Context, userID, recordID string) (*service.FeedContextResult, error) {
	return m.feedContext, m.feedContextErr
}
func (m *mockCommunityService) FeedTargetContext(ctx context.Context, userID, targetType, targetID string) (*service.FeedContextResult, error) {
	return m.feedContext, m.feedContextErr
}
func (m *mockCommunityService) PostComment(ctx context.Context, userID, recordID, content string, parentCommentID, replyToUserID *string) (*service.CommentItem, error) {
	return m.postComment, m.postCommentErr
}
func (m *mockCommunityService) PostTargetComment(ctx context.Context, userID, targetType, targetID, content string, parentCommentID, replyToUserID *string) (*service.CommentItem, error) {
	return m.postComment, m.postCommentErr
}
func (m *mockCommunityService) DeleteTargetComment(ctx context.Context, userID, targetType, targetID, commentID string) (int64, error) {
	return 1, nil
}
func (m *mockCommunityService) ListCommentTasks(ctx context.Context, userID string, limit int) ([]domain.CommentTask, error) {
	return m.commentTasks, m.commentTasksErr
}
func (m *mockCommunityService) ListNotifications(ctx context.Context, userID, notificationType string, limit, offset int) (*service.NotificationListResult, error) {
	return m.notifications, m.notificationsErr
}
func (m *mockCommunityService) MarkNotificationsRead(ctx context.Context, userID string, notificationIDs []string) (*service.MarkReadResult, error) {
	return m.markRead, m.markReadErr
}
func (m *mockCommunityService) UploadCirclePostImage(ctx context.Context, userID string, fileBytes []byte, ext, contentType string) (string, error) {
	return "", nil
}
func (m *mockCommunityService) CreateCirclePost(ctx context.Context, userID, title, body string, imageURLs []string, nutrition *domain.CirclePostNutrition) (string, error) {
	return "", nil
}
func (m *mockCommunityService) UpdateCirclePost(ctx context.Context, userID, postID, title, body string, imageURLs []string, nutrition *domain.CirclePostNutrition) error {
	return nil
}
func (m *mockCommunityService) DeleteCirclePost(ctx context.Context, userID, postID string) error {
	return nil
}
func (m *mockCommunityService) ReportFeedTarget(ctx context.Context, reporterUserID, targetType, targetID, reason, extraContent string) (*domain.FeedReport, error) {
	return nil, nil
}

func setupCommunityRouter(h *CommunityHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "test-user-id")
		c.Next()
	})
	r.GET("/api/community/public-feed", h.PublicFeed)
	r.GET("/api/community/feed", h.Feed)
	r.GET("/api/community/checkin-leaderboard", h.CheckinLeaderboard)
	r.GET("/api/community/health-leaderboard", h.HealthLeaderboard)
	r.GET("/api/community/food-nutrient-leaderboard", h.FoodNutrientLeaderboard)
	r.POST("/api/community/feed/:record_id/like", h.LikeFeed)
	r.DELETE("/api/community/feed/:record_id/like", h.UnlikeFeed)
	r.POST("/api/community/feed/:record_id/hide", h.HideFeed)
	r.GET("/api/community/feed/:record_id/comments", h.ListComments)
	r.GET("/api/community/feed/:record_id/context", h.FeedContext)
	r.POST("/api/community/feed/:record_id/comments", h.PostComment)
	r.POST("/api/community/feed-targets/:target_type/:target_id/like", h.LikeFeedTarget)
	r.DELETE("/api/community/feed-targets/:target_type/:target_id/like", h.UnlikeFeedTarget)
	r.GET("/api/community/feed-targets/:target_type/:target_id/comments", h.ListTargetComments)
	r.POST("/api/community/feed-targets/:target_type/:target_id/comments", h.PostTargetComment)
	r.DELETE("/api/community/feed-targets/:target_type/:target_id/comments/:comment_id", h.DeleteTargetComment)
	r.GET("/api/community/feed-targets/:target_type/:target_id/context", h.FeedTargetContext)
	r.POST("/api/community/feed-targets/:target_type/:target_id/hide", h.HideFeedTarget)
	r.GET("/api/community/comment-tasks", h.ListCommentTasks)
	r.GET("/api/community/notifications", h.ListNotifications)
	r.POST("/api/community/notifications/read", h.MarkNotificationsRead)
	return r
}

func TestPublicFeed(t *testing.T) {
	mockSvc := &mockCommunityService{publicFeed: []service.FeedItem{{LikeCount: 5}}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/public-feed?author_id=u2", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	list := data["list"].([]any)
	assert.Len(t, list, 1)
	assert.NotNil(t, mockSvc.publicFeedParams)
	assert.Equal(t, "u2", mockSvc.publicFeedParams.AuthorID)
}

func TestFeed(t *testing.T) {
	mockSvc := &mockCommunityService{friendFeed: []service.FeedItem{{LikeCount: 3}}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/feed", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestCheckinLeaderboard(t *testing.T) {
	mockSvc := &mockCommunityService{leaderboard: &service.LeaderboardResult{WeekStart: "2024-01-01", List: []service.LeaderboardItem{}}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/checkin-leaderboard", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestHealthLeaderboard(t *testing.T) {
	mockSvc := &mockCommunityService{healthLeaderboard: &service.HealthLeaderboardResult{
		WeekStart: "2024-01-01",
		ScoringRule: service.HealthLeaderboardScoringRule{
			Label: "本周健康饮食分", TotalPoints: 100, MinimumRecordedDays: 4,
		},
		List: []service.HealthLeaderboardItem{{Rank: 1, HealthIndex: 88}},
	}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/health-leaderboard", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"scoring_rule"`)
	assert.Contains(t, w.Body.String(), `"minimum_recorded_days":4`)
	var payload struct {
		Data struct {
			List []map[string]any `json:"list"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &payload))
	_, exposesPrivateBreakdown := payload.Data.List[0]["diet_quality_points"]
	assert.False(t, exposesPrivateBreakdown)
}

func TestFoodNutrientLeaderboard(t *testing.T) {
	mockSvc := &mockCommunityService{foodLeaderboard: &service.FoodNutrientLeaderboardResult{
		Nutrient: "protein",
		Unit:     "g",
		List:     []service.FoodNutrientLeaderboardItem{{Rank: 1, Name: "黄豆", Value: 36}},
	}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/food-nutrient-leaderboard?nutrient=protein&limit=2", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestLikeFeed(t *testing.T) {
	mockSvc := &mockCommunityService{likeMsg: "已点赞"}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/community/feed/r1/like", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "已点赞", data["message"])
}

func TestUnlikeFeed(t *testing.T) {
	mockSvc := &mockCommunityService{unlikeMsg: "已取消"}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/community/feed/r1/like", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "已取消", data["message"])
}

func TestHideFeed(t *testing.T) {
	mockSvc := &mockCommunityService{}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/community/feed/r1/hide", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestListComments(t *testing.T) {
	mockSvc := &mockCommunityService{comments: []service.CommentItem{{ID: "c1", Content: "nice"}}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/feed/r1/comments", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestFeedContextAllowed(t *testing.T) {
	mockSvc := &mockCommunityService{feedContext: &service.FeedContextResult{Allowed: true, Reason: "owner"}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/feed/r1/context", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestFeedContextNotFound(t *testing.T) {
	mockSvc := &mockCommunityService{feedContext: &service.FeedContextResult{Allowed: false, Reason: "not_found"}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/feed/r1/context", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestFeedContextForbidden(t *testing.T) {
	mockSvc := &mockCommunityService{feedContext: &service.FeedContextResult{Allowed: false, Reason: "forbidden"}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/feed/r1/context", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestPostComment(t *testing.T) {
	now := time.Now()
	mockSvc := &mockCommunityService{postComment: &service.CommentItem{ID: "c1", Content: "test", CreatedAt: &now}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	body, _ := json.Marshal(map[string]string{"content": "test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/community/feed/r1/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestListCommentTasks(t *testing.T) {
	mockSvc := &mockCommunityService{commentTasks: []domain.CommentTask{{ID: "t1", Status: "pending"}}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/comment-tasks", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestListNotifications(t *testing.T) {
	mockSvc := &mockCommunityService{notifications: &service.NotificationListResult{UnreadCount: 2, List: []service.NotificationItem{}}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/notifications", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestMarkNotificationsRead(t *testing.T) {
	mockSvc := &mockCommunityService{markRead: &service.MarkReadResult{Updated: 3, UnreadCount: 0}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	body, _ := json.Marshal(map[string][]string{"notification_ids": {"n1", "n2"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/community/notifications/read", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestPostCommentBadRequest(t *testing.T) {
	mockSvc := &mockCommunityService{postCommentErr: errors.New("bad request")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	body, _ := json.Marshal(map[string]string{"content": ""})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/community/feed/r1/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestPublicFeedError(t *testing.T) {
	mockSvc := &mockCommunityService{publicFeedErr: errors.New("db error")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/public-feed", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestFeedError(t *testing.T) {
	mockSvc := &mockCommunityService{friendFeedErr: errors.New("db error")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/feed", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestFeedWithParams(t *testing.T) {
	mockSvc := &mockCommunityService{friendFeed: []service.FeedItem{{LikeCount: 3}}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/feed?offset=10&limit=5&sort_by=hot&meal_type=lunch", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestParseFeedParamsClampsClientControlledLimits(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/community/public-feed?offset=999999&limit=999999&comments_limit=999999", nil)

	params := parseFeedParams(ctx)

	assert.Equal(t, service.MaxFeedLegacyOffset, params.Offset)
	assert.Equal(t, service.MaxFeedPageSize, params.Limit)
	assert.Equal(t, service.MaxFeedCommentsPreview, params.CommentsLimit)
}

func TestParseFeedParamsAcceptsStableLatestCursor(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/community/public-feed?sort_by=latest&offset=100&before_time=2026-08-22T08%3A00%3A00Z&before_key=food_record%3Ar2", nil)

	params := parseFeedParams(ctx)

	require.NotNil(t, params.BeforeTime)
	assert.Equal(t, "2026-08-22T08:00:00Z", params.BeforeTime.Format(time.RFC3339))
	assert.Equal(t, "food_record:r2", params.BeforeKey)
	assert.Equal(t, 0, params.Offset)
}

func TestCheckinLeaderboardError(t *testing.T) {
	mockSvc := &mockCommunityService{leaderboardErr: errors.New("db error")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/checkin-leaderboard", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestLikeFeedError(t *testing.T) {
	mockSvc := &mockCommunityService{likeErr: errors.New("db error")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/community/feed/r1/like", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestUnlikeFeedError(t *testing.T) {
	mockSvc := &mockCommunityService{unlikeErr: errors.New("db error")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/community/feed/r1/like", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestHideFeedError(t *testing.T) {
	mockSvc := &mockCommunityService{hideErr: errors.New("db error")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/community/feed/r1/hide", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestListCommentsError(t *testing.T) {
	mockSvc := &mockCommunityService{commentsErr: errors.New("db error")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/feed/r1/comments", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestListCommentsWithLimit(t *testing.T) {
	mockSvc := &mockCommunityService{comments: []service.CommentItem{{ID: "c1", Content: "nice"}}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/feed/r1/comments?limit=10", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestPostCommentError(t *testing.T) {
	mockSvc := &mockCommunityService{postCommentErr: errors.New("db error")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	body, _ := json.Marshal(map[string]string{"content": "test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/community/feed/r1/comments", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestListCommentTasksError(t *testing.T) {
	mockSvc := &mockCommunityService{commentTasksErr: errors.New("db error")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/comment-tasks", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestListCommentTasksWithLimit(t *testing.T) {
	mockSvc := &mockCommunityService{commentTasks: []domain.CommentTask{{ID: "t1", Status: "pending"}}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/comment-tasks?limit=10", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestListNotificationsError(t *testing.T) {
	mockSvc := &mockCommunityService{notificationsErr: errors.New("db error")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/notifications", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestListNotificationsWithLimit(t *testing.T) {
	mockSvc := &mockCommunityService{notifications: &service.NotificationListResult{UnreadCount: 2, List: []service.NotificationItem{}}}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/community/notifications?limit=10", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestMarkNotificationsReadBindError(t *testing.T) {
	mockSvc := &mockCommunityService{}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/community/notifications/read", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestMarkNotificationsReadError(t *testing.T) {
	mockSvc := &mockCommunityService{markReadErr: errors.New("db error")}
	h := NewCommunityHandler(mockSvc)
	r := setupCommunityRouter(h)

	body, _ := json.Marshal(map[string][]string{"notification_ids": {"n1", "n2"}})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/community/notifications/read", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
