package handler

import (
	"context"
	"log/slog"

	"food_link/backend/internal/admin/service"
	"food_link/backend/internal/common/response"
	healthdomain "food_link/backend/internal/health/domain"
	healthrepo "food_link/backend/internal/health/repo"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type ExerciseEnergyService interface {
	List(ctx context.Context, input service.ListExerciseEnergyInput) (*healthrepo.ListExerciseEnergyActivitiesResult, error)
	Get(ctx context.Context, id string) (map[string]any, error)
	Update(ctx context.Context, id string, input service.UpdateExerciseEnergyInput) (map[string]any, error)
}

type ExerciseEnergyHandler struct {
	svc ExerciseEnergyService
}

func NewExerciseEnergyHandler(svc ExerciseEnergyService) *ExerciseEnergyHandler {
	return &ExerciseEnergyHandler{svc: svc}
}

func (h *ExerciseEnergyHandler) List(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 40)
	result, err := h.svc.List(c.Request.Context(), service.ListExerciseEnergyInput{
		Query:        c.Query("q"),
		ReviewStatus: c.DefaultQuery("review_status", "all"),
		Active:       c.DefaultQuery("active", "all"),
		Page:         page,
		Limit:        limit,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"items": result.Items,
		"page":  page,
		"limit": limit,
		"total": result.Total,
	})
}

func (h *ExerciseEnergyHandler) Get(c *gin.Context) {
	result, err := h.svc.Get(c.Request.Context(), c.Param("activity_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *ExerciseEnergyHandler) Update(c *gin.Context) {
	var body service.UpdateExerciseEnergyInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.svc.Update(c.Request.Context(), c.Param("activity_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	item, _ := result["item"].(*healthdomain.ExerciseEnergyActivity)
	if item != nil {
		logger.LogAPI(c.Request.Context(), "管理员更新运动能量库", "admin", "update_exercise_energy_activity",
			slog.String("exercise_activity_id", item.ID),
			slog.String("canonical_name", item.CanonicalName),
			slog.String("review_status", item.ReviewStatus),
			slog.Bool("is_active", item.IsActive),
		)
	}
	response.Success(c, result)
}
