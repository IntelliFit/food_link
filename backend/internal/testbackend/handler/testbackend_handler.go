package handler

import (
	"context"

	"food_link/backend/internal/common/response"
	"food_link/backend/internal/testbackend/domain"
	"food_link/backend/internal/testbackend/service"

	"github.com/gin-gonic/gin"
)

type TestBackendService interface {
	ListPrompts(ctx context.Context) ([]domain.Prompt, error)
	CreatePrompt(ctx context.Context, input service.CreatePromptInput) (*domain.Prompt, error)
	GetPrompt(ctx context.Context, id string) (*domain.Prompt, error)
	GetActivePrompt(ctx context.Context, modelType string) (*domain.Prompt, error)
	UpdatePrompt(ctx context.Context, id string, input service.UpdatePromptInput) (*domain.Prompt, error)
	DeletePrompt(ctx context.Context, id string) error
	ActivatePrompt(ctx context.Context, id string) (*domain.Prompt, error)
	GetPromptHistory(ctx context.Context, id string) ([]domain.PromptHistory, error)
	Analyze(ctx context.Context, input service.AnalyzeInput) (map[string]any, error)
	PrepareBatch(ctx context.Context, input service.PrepareBatchInput) (*domain.TestBatch, error)
	StartBatch(ctx context.Context, input service.StartBatchInput) (*domain.TestBatch, error)
	GetBatch(ctx context.Context, batchID string) (*domain.TestBatch, error)
	ListDatasets(ctx context.Context) ([]domain.TestDataset, error)
	ImportLocalDataset(ctx context.Context, input service.ImportDatasetInput) (*domain.TestDataset, error)
	PrepareDataset(ctx context.Context, datasetID string) (*domain.TestDataset, error)
	Login(ctx context.Context, password string) error
	Logout(ctx context.Context) error
	LegacyBatchUpload(ctx context.Context, input service.LegacyBatchUploadInput) (map[string]any, error)
	LegacySingleImage(ctx context.Context, input service.LegacySingleImageInput) (map[string]any, error)
}

type TestBackendHandler struct {
	svc TestBackendService
}

func NewTestBackendHandler(svc TestBackendService) *TestBackendHandler {
	return &TestBackendHandler{svc: svc}
}

// ---------- Prompts ----------

// GET /api/prompts
func (h *TestBackendHandler) ListPrompts(c *gin.Context) {
	items, err := h.svc.ListPrompts(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"prompts": items})
}

// POST /api/prompts
func (h *TestBackendHandler) CreatePrompt(c *gin.Context) {
	var body struct {
		Name      string  `json:"name"`
		Content   string  `json:"content"`
		ModelType string  `json:"model_type"`
		IsActive  bool    `json:"is_active"`
		CreatedBy *string `json:"created_by"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	p, err := h.svc.CreatePrompt(c.Request.Context(), service.CreatePromptInput{
		Name:      body.Name,
		Content:   body.Content,
		ModelType: body.ModelType,
		IsActive:  body.IsActive,
		CreatedBy: body.CreatedBy,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "创建成功", "prompt": p})
}

// GET /api/prompts/active/:model_type
func (h *TestBackendHandler) GetActivePrompt(c *gin.Context) {
	modelType := c.Param("model_type")
	p, err := h.svc.GetActivePrompt(c.Request.Context(), modelType)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"prompt": p})
}

// DELETE /api/prompts/:prompt_id
func (h *TestBackendHandler) DeletePrompt(c *gin.Context) {
	id := c.Param("prompt_id")
	if err := h.svc.DeletePrompt(c.Request.Context(), id); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "删除成功"})
}

// GET /api/prompts/:prompt_id
func (h *TestBackendHandler) GetPrompt(c *gin.Context) {
	id := c.Param("prompt_id")
	p, err := h.svc.GetPrompt(c.Request.Context(), id)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"prompt": p})
}

// PUT /api/prompts/:prompt_id
func (h *TestBackendHandler) UpdatePrompt(c *gin.Context) {
	var body struct {
		Name      *string `json:"name"`
		Content   *string `json:"content"`
		ModelType *string `json:"model_type"`
		IsActive  *bool   `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	id := c.Param("prompt_id")
	p, err := h.svc.UpdatePrompt(c.Request.Context(), id, service.UpdatePromptInput{
		Name:      body.Name,
		Content:   body.Content,
		ModelType: body.ModelType,
		IsActive:  body.IsActive,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "更新成功", "prompt": p})
}

// POST /api/prompts/:prompt_id/activate
func (h *TestBackendHandler) ActivatePrompt(c *gin.Context) {
	id := c.Param("prompt_id")
	p, err := h.svc.ActivatePrompt(c.Request.Context(), id)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "激活成功", "prompt": p})
}

// GET /api/prompts/:prompt_id/history
func (h *TestBackendHandler) GetPromptHistory(c *gin.Context) {
	id := c.Param("prompt_id")
	history, err := h.svc.GetPromptHistory(c.Request.Context(), id)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"history": history})
}

// ---------- Test Backend Analyze ----------

// POST /api/test-backend/analyze
func (h *TestBackendHandler) Analyze(c *gin.Context) {
	var body struct {
		ImageURL  string `json:"image_url"`
		PromptID  string `json:"prompt_id"`
		ModelName string `json:"model_name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.svc.Analyze(c.Request.Context(), service.AnalyzeInput{
		ImageURL:  body.ImageURL,
		PromptID:  body.PromptID,
		ModelName: body.ModelName,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// ---------- Batches ----------

// POST /api/test-backend/batch/prepare
func (h *TestBackendHandler) PrepareBatch(c *gin.Context) {
	var body struct {
		DatasetID string         `json:"dataset_id"`
		Config    map[string]any `json:"config"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	b, err := h.svc.PrepareBatch(c.Request.Context(), service.PrepareBatchInput{
		DatasetID: body.DatasetID,
		Config:    body.Config,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "批次已创建", "batch": b})
}

// POST /api/test-backend/batch/start
func (h *TestBackendHandler) StartBatch(c *gin.Context) {
	var body struct {
		BatchID string `json:"batch_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	b, err := h.svc.StartBatch(c.Request.Context(), service.StartBatchInput{
		BatchID: body.BatchID,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "批次已启动", "batch": b})
}

// GET /api/test-backend/batch/:batch_id
func (h *TestBackendHandler) GetBatch(c *gin.Context) {
	batchID := c.Param("batch_id")
	b, err := h.svc.GetBatch(c.Request.Context(), batchID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"batch": b})
}

// ---------- Datasets ----------

// GET /api/test-backend/datasets
func (h *TestBackendHandler) ListDatasets(c *gin.Context) {
	items, err := h.svc.ListDatasets(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"datasets": items})
}

// POST /api/test-backend/datasets/import-local
func (h *TestBackendHandler) ImportLocalDataset(c *gin.Context) {
	var body struct {
		Name       string   `json:"name"`
		ImagePaths []string `json:"image_paths"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	d, err := h.svc.ImportLocalDataset(c.Request.Context(), service.ImportDatasetInput{
		Name:       body.Name,
		ImagePaths: body.ImagePaths,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "数据集导入成功", "dataset": d})
}

// POST /api/test-backend/datasets/:dataset_id/prepare
func (h *TestBackendHandler) PrepareDataset(c *gin.Context) {
	datasetID := c.Param("dataset_id")
	d, err := h.svc.PrepareDataset(c.Request.Context(), datasetID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "数据集已准备", "dataset": d})
}

// ---------- Auth ----------

// POST /api/test-backend/login
func (h *TestBackendHandler) Login(c *gin.Context) {
	var body struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if err := h.svc.Login(c.Request.Context(), body.Password); err != nil {
		response.Error(c, err)
		return
	}
	c.SetCookie("test_backend_token", "test-backend-session", 86400, "/", "", false, true)
	response.Success(c, gin.H{"message": "登录成功"})
}

// POST /api/test-backend/logout
func (h *TestBackendHandler) Logout(c *gin.Context) {
	_ = h.svc.Logout(c.Request.Context())
	c.SetCookie("test_backend_token", "", -1, "/", "", false, true)
	response.Success(c, gin.H{"message": "退出成功"})
}

// ---------- Legacy Test API ----------

// POST /api/test/batch-upload
func (h *TestBackendHandler) LegacyBatchUpload(c *gin.Context) {
	var body struct {
		ImageURLs []string       `json:"image_urls"`
		Config    map[string]any `json:"config"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.svc.LegacyBatchUpload(c.Request.Context(), service.LegacyBatchUploadInput{
		ImageURLs: body.ImageURLs,
		Config:    body.Config,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// POST /api/test/single-image
func (h *TestBackendHandler) LegacySingleImage(c *gin.Context) {
	var body struct {
		ImageURL string `json:"image_url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.svc.LegacySingleImage(c.Request.Context(), service.LegacySingleImageInput{
		ImageURL: body.ImageURL,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}
