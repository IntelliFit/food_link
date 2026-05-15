package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"food_link/backend/internal/home/repo"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupCommentTestDB(t *testing.T) (*gorm.DB, *repo.HomeRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&repo.FoodRecord{}, &repo.FeedComment{}))
	return db, repo.NewHomeRepo(db)
}

func setupCommentRouter(h *CommentHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "test-user-id")
		c.Next()
	})
	r.DELETE("/api/community/feed/:record_id/comments/:comment_id", h.DeleteComment)
	return r
}

func TestCommentHandler_DeleteComment(t *testing.T) {
	db, homeRepo := setupCommentTestDB(t)
	recordID := uuid.New().String()
	commentID := uuid.New().String()
	now := time.Now()

	db.Create(&repo.FoodRecord{ID: recordID, UserID: "test-user-id", MealType: "lunch"})
	db.Create(&repo.FeedComment{ID: commentID, UserID: "test-user-id", RecordID: recordID, CreatedAt: &now})

	h := NewCommentHandler(homeRepo, nil)
	r := setupCommentRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/community/feed/"+recordID+"/comments/"+commentID, nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(1), resp["deleted"])
}

func TestCommentHandler_DeleteCommentRecordNotFound(t *testing.T) {
	_, homeRepo := setupCommentTestDB(t)
	h := NewCommentHandler(homeRepo, nil)
	r := setupCommentRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/community/feed/nonexistent/comments/c1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "动态不存在", resp["detail"])
}

func TestCommentHandler_DeleteCommentNotFound(t *testing.T) {
	db, homeRepo := setupCommentTestDB(t)
	recordID := uuid.New().String()
	db.Create(&repo.FoodRecord{ID: recordID, UserID: "test-user-id", MealType: "lunch"})

	h := NewCommentHandler(homeRepo, nil)
	r := setupCommentRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/community/feed/"+recordID+"/comments/nonexistent", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "评论不存在", resp["detail"])
}

func TestCommentHandler_DeleteCommentForbidden(t *testing.T) {
	db, homeRepo := setupCommentTestDB(t)
	recordID := uuid.New().String()
	commentID := uuid.New().String()
	now := time.Now()

	db.Create(&repo.FoodRecord{ID: recordID, UserID: "other-user-id", MealType: "lunch"})
	db.Create(&repo.FeedComment{ID: commentID, UserID: "another-user-id", RecordID: recordID, CreatedAt: &now})

	h := NewCommentHandler(homeRepo, nil)
	r := setupCommentRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/community/feed/"+recordID+"/comments/"+commentID, nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "无权删除该评论", resp["detail"])
}

func TestCommentHandler_DeleteCommentByRecordOwner(t *testing.T) {
	db, homeRepo := setupCommentTestDB(t)
	recordID := uuid.New().String()
	commentID := uuid.New().String()
	now := time.Now()

	db.Create(&repo.FoodRecord{ID: recordID, UserID: "test-user-id", MealType: "lunch"})
	db.Create(&repo.FeedComment{ID: commentID, UserID: "other-user-id", RecordID: recordID, CreatedAt: &now})

	h := NewCommentHandler(homeRepo, nil)
	r := setupCommentRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/community/feed/"+recordID+"/comments/"+commentID, nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}
