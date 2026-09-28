package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	authmw "food_link/backend/internal/auth"
	healthservice "food_link/backend/internal/health/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type capturedMealChat struct {
	PetChatService
	input  healthservice.PetChatInput
	userID string
}

func (s *capturedMealChat) GeneratePetChatStream(ctx context.Context, userID string, input healthservice.PetChatInput) (<-chan healthservice.PetChatStreamChunk, error) {
	s.input = input
	s.userID = userID
	ch := make(chan healthservice.PetChatStreamChunk, 1)
	ch <- healthservice.PetChatStreamChunk{Type: "done"}
	close(ch)
	return ch, nil
}

func TestPetChatStreamPreservesLocationAndHomeMealContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	chat := &capturedMealChat{}
	r := gin.New()
	r.POST("/chat", func(c *gin.Context) { c.Set(authmw.ContextUserIDKey, "user-1"); NewPetHandler(nil, chat).ChatStream(c) })
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/chat", strings.NewReader(`{"question":"附近午餐吃什么","range":"week","entry_context":{"source":"home_next_meal","date":"2026-09-26","meal_type":"lunch"},"location":{"latitude":40,"longitude":116,"coordinate_type":"gcj02","captured_at":123}}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	require.NotNil(t, chat.input.Location)
	require.NotNil(t, chat.input.EntryContext)
	assert.Equal(t, "user-1", chat.userID)
	assert.Equal(t, 40.0, chat.input.Location.Latitude)
	assert.Equal(t, "lunch", chat.input.EntryContext.MealType)
}
