package handler

import (
	"food_link/backend/internal/admin/domain"
	"food_link/backend/internal/admin/service"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
	"log/slog"
)

type BenchmarkHandler struct {
	svc *service.BenchmarkService
}

func NewBenchmarkHandler(svc *service.BenchmarkService) *BenchmarkHandler {
	return &BenchmarkHandler{svc: svc}
}

func (h *BenchmarkHandler) ListBatches(c *gin.Context) {
	items, err := h.svc.ListBatches(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

func (h *BenchmarkHandler) ListSamples(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 30)
	result, err := h.svc.ListSamples(c.Request.Context(), domain.ListSamplesInput{
		BatchName: c.Query("batch_name"),
		LabelType: c.Query("label_type"),
		Status:    c.Query("status"),
		Query:     c.Query("q"),
		Page:      page,
		Limit:     limit,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"items": result.Items,
		"page":  result.Page,
		"limit": result.Limit,
		"total": result.Total,
	})
}

func (h *BenchmarkHandler) GetSample(c *gin.Context) {
	item, err := h.svc.GetSample(c.Request.Context(), c.Param("sample_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, item)
}

func (h *BenchmarkHandler) CreateSample(c *gin.Context) {
	var input domain.CreateSampleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.CreateSample(c.Request.Context(), input)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员创建 benchmark 样本", slog.String("sample_id", item.ID))
	response.Success(c, gin.H{"item": item})
}

func (h *BenchmarkHandler) UpdateSample(c *gin.Context) {
	var input domain.UpdateSampleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.UpdateSample(c.Request.Context(), c.Param("sample_id"), input)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员更新 benchmark 样本", slog.String("sample_id", item.ID))
	response.Success(c, gin.H{"item": item})
}

func (h *BenchmarkHandler) DeleteSample(c *gin.Context) {
	if err := h.svc.DeleteSample(c.Request.Context(), c.Param("sample_id")); err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员删除 benchmark 样本", slog.String("sample_id", c.Param("sample_id")))
	response.Success(c, gin.H{"message": "已删除"})
}

func (h *BenchmarkHandler) CreateRun(c *gin.Context) {
	var input domain.CreateRunInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	adminID := c.GetString("admin_account_id")
	run, err := h.svc.CreateRun(c.Request.Context(), adminID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员创建 benchmark run",
		slog.String("run_id", run.ID),
		slog.String("execution_mode", run.ExecutionMode),
		slog.Int("sample_count", run.SampleCount),
	)
	response.Success(c, gin.H{"run": run})
}

func (h *BenchmarkHandler) ListRuns(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 30)
	result, err := h.svc.ListRuns(c.Request.Context(), page, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"items": result.Items,
		"page":  result.Page,
		"limit": result.Limit,
		"total": result.Total,
	})
}

func (h *BenchmarkHandler) GetRun(c *gin.Context) {
	run, err := h.svc.GetRun(c.Request.Context(), c.Param("run_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"run": run})
}

func (h *BenchmarkHandler) DeleteRun(c *gin.Context) {
	if err := h.svc.DeleteRun(c.Request.Context(), c.Param("run_id")); err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员删除 benchmark run", slog.String("run_id", c.Param("run_id")))
	response.Success(c, gin.H{"message": "已删除"})
}

func (h *BenchmarkHandler) CancelRun(c *gin.Context) {
	run, err := h.svc.CancelRun(c.Request.Context(), c.Param("run_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"run": run})
}

func (h *BenchmarkHandler) ListRunSamples(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 30)
	result, err := h.svc.ListRunSamples(c.Request.Context(), c.Param("run_id"), page, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"items": result.Items,
		"page":  result.Page,
		"limit": result.Limit,
		"total": result.Total,
	})
}


