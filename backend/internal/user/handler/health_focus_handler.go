package handler

import (
	"context"
	"log/slog"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"

	"github.com/gin-gonic/gin"
)

type HealthFocusService interface {
	GetHealthFocusKeys(ctx context.Context, userID string) ([]string, error)
	UpdateHealthFocusKeys(ctx context.Context, userID string, keys []string) ([]string, error)
}

// HealthFocusHandler serves the user's focus ("我在意的", up to three), which steers the
// daily nutrition state, the pet's task and the meal Agent.
type HealthFocusHandler struct {
	focus HealthFocusService
}

func NewHealthFocusHandler(focus HealthFocusService) *HealthFocusHandler {
	return &HealthFocusHandler{focus: focus}
}

// GET /api/health/focus
func (h *HealthFocusHandler) Get(c *gin.Context) {
	keys, err := h.focus.GetHealthFocusKeys(c.Request.Context(), c.GetString(authmw.ContextUserIDKey))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"keys": keys})
}

// PUT /api/health/focus {"keys": ["hypertension", "custom:<id>"]}
func (h *HealthFocusHandler) Update(c *gin.Context) {
	var body struct {
		Keys []string `json:"keys"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	keys, err := h.focus.UpdateHealthFocusKeys(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), body.Keys)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "health_focus_keys_update_ok", slog.Int("focus_count", len(keys)))
	response.Success(c, gin.H{"keys": keys})
}
