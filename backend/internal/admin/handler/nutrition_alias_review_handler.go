package handler

import (
	"context"
	"log/slog"

	"food_link/backend/internal/admin/repo"
	"food_link/backend/internal/admin/service"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type NutritionAliasReviewService interface {
	List(ctx context.Context, input service.ListNutritionAliasCandidatesInput) (*repo.ListNutritionAliasCandidatesResult, error)
	Get(ctx context.Context, id string) (*repo.NutritionAliasCandidate, error)
	Create(ctx context.Context, input service.CreateNutritionAliasCandidateInput) (*repo.NutritionAliasCandidate, error)
	AIReview(ctx context.Context, id string) (*repo.NutritionAliasCandidate, int, error)
	BatchAIReview(ctx context.Context, input service.BatchAIReviewInput) (*service.BatchAIReviewResult, error)
	Review(ctx context.Context, id, reviewerID string, input service.ReviewNutritionAliasCandidateInput) (*repo.NutritionAliasCandidate, error)
}

type NutritionAliasReviewHandler struct {
	svc NutritionAliasReviewService
}

func NewNutritionAliasReviewHandler(svc NutritionAliasReviewService) *NutritionAliasReviewHandler {
	return &NutritionAliasReviewHandler{svc: svc}
}

func (h *NutritionAliasReviewHandler) List(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 40)
	result, err := h.svc.List(c.Request.Context(), service.ListNutritionAliasCandidatesInput{
		Query: c.Query("q"), Status: c.DefaultQuery("status", "pending"),
		Source: c.DefaultQuery("source", "all"), Page: page, Limit: limit,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": result.Items, "page": page, "limit": limit, "total": result.Total})
}

func (h *NutritionAliasReviewHandler) Get(c *gin.Context) {
	item, err := h.svc.Get(c.Request.Context(), c.Param("candidate_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item})
}

func (h *NutritionAliasReviewHandler) Create(c *gin.Context) {
	var body service.CreateNutritionAliasCandidateInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.Create(c.Request.Context(), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员创建营养别名候选",
		slog.String("candidate_id", item.ID), slog.String("alias_name", item.AliasName),
		slog.String("food_id", item.ProposedFoodID))
	response.Success(c, gin.H{"message": "已加入待审核队列", "item": item})
}

func (h *NutritionAliasReviewHandler) AIReview(c *gin.Context) {
	item, generated, err := h.svc.AIReview(c.Request.Context(), c.Param("candidate_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "完成营养别名 AI 预审",
		slog.String("candidate_id", item.ID), slog.String("model", valueOrEmpty(item.Model)),
		slog.String("model_decision", valueOrEmpty(item.ModelDecision)), slog.Int("generated_candidates", generated))
	response.Success(c, gin.H{"message": "AI 预审完成，尚未写入正式别名库", "item": item, "generated_candidates": generated})
}

func (h *NutritionAliasReviewHandler) BatchAIReview(c *gin.Context) {
	var body service.BatchAIReviewInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.svc.BatchAIReview(c.Request.Context(), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "完成营养别名批量 AI 预审",
		slog.Int("requested", result.Requested), slog.Int("succeeded", result.Succeeded), slog.Int("failed", result.Failed))
	response.Success(c, gin.H{"message": "批量预审完成，结果仍需人工审核", "result": result})
}

func (h *NutritionAliasReviewHandler) Review(c *gin.Context) {
	var body service.ReviewNutritionAliasCandidateInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.Review(c.Request.Context(), c.Param("candidate_id"), c.GetString("admin_account_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员审核营养别名候选",
		slog.String("candidate_id", item.ID), slog.String("decision", item.Status),
		slog.String("reviewer_id", c.GetString("admin_account_id")))
	response.Success(c, gin.H{"message": "审核完成", "item": item})
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
