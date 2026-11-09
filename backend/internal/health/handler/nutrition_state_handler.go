package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/health/domain"
	"food_link/backend/internal/health/service"

	"github.com/gin-gonic/gin"
)

type NutritionStateService interface {
	GetDailyNutritionState(ctx context.Context, userID, date string) (*domain.DailyNutritionState, error)
	GetMealImpact(ctx context.Context, userID, recordID string) (*domain.MealImpact, error)
}

// NutritionStateHandler serves the daily nutrition state that the analysis page, the
// pet and the record result page read (docs/algorithms/daily-nutrition-state.md).
type NutritionStateHandler struct {
	state NutritionStateService
}

func NewNutritionStateHandler(state NutritionStateService) *NutritionStateHandler {
	return &NutritionStateHandler{state: state}
}

// GET /api/health/nutrition-state?date=YYYY-MM-DD
func (h *NutritionStateHandler) Get(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	date := strings.TrimSpace(c.Query("date"))
	if date != "" {
		if _, err := time.Parse("2006-01-02", date); err != nil {
			response.Error(c, &commonerrors.AppError{Code: commonerrors.ErrBadRequest.Code, Message: "date 需为 YYYY-MM-DD", HTTPStatus: http.StatusBadRequest})
			return
		}
	}
	state, err := h.state.GetDailyNutritionState(c.Request.Context(), userID, date)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, state)
}

// GET /api/health/nutrition-state/meal-impact?record_id=...
func (h *NutritionStateHandler) MealImpact(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	impact, err := h.state.GetMealImpact(c.Request.Context(), userID, c.Query("record_id"))
	if errors.Is(err, service.ErrNutritionRecordNotFound) {
		response.Error(c, &commonerrors.AppError{Code: commonerrors.ErrNotFound.Code, Message: "没有找到这条记录", HTTPStatus: http.StatusNotFound})
		return
	}
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, impact)
}
