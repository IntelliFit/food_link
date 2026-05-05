package service

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/testbackend/domain"
	"food_link/backend/internal/testbackend/repo"
)

// LLMClient is the interface for LLM-based analysis.
type LLMClient interface {
	Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error)
}

type TestBackendService struct {
	promptRepo      *repo.PromptRepo
	batchRepo       *repo.BatchRepo
	datasetRepo     *repo.DatasetRepo
	dashScopeClient LLMClient
	ofoxAIClient    LLMClient
}

func NewTestBackendService(
	promptRepo *repo.PromptRepo,
	batchRepo *repo.BatchRepo,
	datasetRepo *repo.DatasetRepo,
	dashScopeClient LLMClient,
	ofoxAIClient LLMClient,
) *TestBackendService {
	return &TestBackendService{
		promptRepo:      promptRepo,
		batchRepo:       batchRepo,
		datasetRepo:     datasetRepo,
		dashScopeClient: dashScopeClient,
		ofoxAIClient:    ofoxAIClient,
	}
}

// ---------- Prompts ----------

func (s *TestBackendService) ListPrompts(ctx context.Context) ([]domain.Prompt, error) {
	return s.promptRepo.ListPrompts(ctx)
}

type CreatePromptInput struct {
	Name      string  `json:"name"`
	Content   string  `json:"content"`
	ModelType string  `json:"model_type"`
	IsActive  bool    `json:"is_active"`
	CreatedBy *string `json:"created_by"`
}

func (s *TestBackendService) CreatePrompt(ctx context.Context, input CreatePromptInput) (*domain.Prompt, error) {
	if input.Name == "" || input.Content == "" || input.ModelType == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "name, content, model_type 不能为空", HTTPStatus: 400}
	}
	p := &domain.Prompt{
		Name:      input.Name,
		Content:   input.Content,
		ModelType: input.ModelType,
		IsActive:  input.IsActive,
		CreatedBy: input.CreatedBy,
	}
	if err := s.promptRepo.CreatePrompt(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *TestBackendService) GetPrompt(ctx context.Context, id string) (*domain.Prompt, error) {
	p, err := s.promptRepo.GetPromptByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, commonerrors.ErrNotFound
	}
	return p, nil
}

func (s *TestBackendService) GetActivePrompt(ctx context.Context, modelType string) (*domain.Prompt, error) {
	if modelType == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "model_type 不能为空", HTTPStatus: 400}
	}
	p, err := s.promptRepo.GetActivePromptByModelType(ctx, modelType)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, commonerrors.ErrNotFound
	}
	return p, nil
}

type UpdatePromptInput struct {
	Name      *string `json:"name"`
	Content   *string `json:"content"`
	ModelType *string `json:"model_type"`
	IsActive  *bool   `json:"is_active"`
}

func (s *TestBackendService) UpdatePrompt(ctx context.Context, id string, input UpdatePromptInput) (*domain.Prompt, error) {
	existing, err := s.promptRepo.GetPromptByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, commonerrors.ErrNotFound
	}

	updates := map[string]any{}
	if input.Name != nil {
		if *input.Name == "" {
			return nil, &commonerrors.AppError{Code: 10002, Message: "name 不能为空", HTTPStatus: 400}
		}
		updates["name"] = *input.Name
	}
	if input.Content != nil {
		if *input.Content == "" {
			return nil, &commonerrors.AppError{Code: 10002, Message: "content 不能为空", HTTPStatus: 400}
		}
		updates["content"] = *input.Content
	}
	if input.ModelType != nil {
		if *input.ModelType == "" {
			return nil, &commonerrors.AppError{Code: 10002, Message: "model_type 不能为空", HTTPStatus: 400}
		}
		updates["model_type"] = *input.ModelType
	}
	if input.IsActive != nil {
		updates["is_active"] = *input.IsActive
	}

	if len(updates) == 0 {
		return existing, nil
	}

	// Save history before updating
	history := &domain.PromptHistory{
		PromptID:  existing.ID,
		Name:      existing.Name,
		Content:   existing.Content,
		ModelType: existing.ModelType,
		Version:   existing.Version,
		CreatedBy: existing.CreatedBy,
	}
	if err := s.promptRepo.CreatePromptHistory(ctx, history); err != nil {
		return nil, err
	}

	updates["version"] = existing.Version + 1
	return s.promptRepo.UpdatePrompt(ctx, id, updates)
}

func (s *TestBackendService) DeletePrompt(ctx context.Context, id string) error {
	existing, err := s.promptRepo.GetPromptByID(ctx, id)
	if err != nil {
		return err
	}
	if existing == nil {
		return commonerrors.ErrNotFound
	}
	return s.promptRepo.DeletePrompt(ctx, id)
}

func (s *TestBackendService) ActivatePrompt(ctx context.Context, id string) (*domain.Prompt, error) {
	existing, err := s.promptRepo.GetPromptByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, commonerrors.ErrNotFound
	}

	if err := s.promptRepo.DeactivateByModelType(ctx, existing.ModelType); err != nil {
		return nil, err
	}

	return s.promptRepo.UpdatePrompt(ctx, id, map[string]any{"is_active": true})
}

func (s *TestBackendService) GetPromptHistory(ctx context.Context, id string) ([]domain.PromptHistory, error) {
	existing, err := s.promptRepo.GetPromptByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, commonerrors.ErrNotFound
	}
	return s.promptRepo.ListPromptHistory(ctx, id)
}

// ---------- Analyze ----------

type AnalyzeInput struct {
	ImageURL  string `json:"image_url"`
	PromptID  string `json:"prompt_id"`
	ModelName string `json:"model_name"`
}

func resolveModelConfig(modelName string) (provider, model string) {
	raw := strings.TrimSpace(modelName)
	normalized := strings.ToLower(raw)
	if raw == "" || normalized == "qwen" || normalized == "qwen-vl" || normalized == "qwen-vl-max" {
		return "qwen", "qwen-vl-max"
	}
	if normalized == "gemini" || normalized == "gemini-flash" || normalized == "gemini-vision" {
		return "gemini", "gemini-3-flash-preview"
	}
	if strings.HasPrefix(normalized, "gemini") {
		return "gemini", raw
	}
	return "qwen", raw
}

func (s *TestBackendService) Analyze(ctx context.Context, input AnalyzeInput) (map[string]any, error) {
	if input.ImageURL == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "image_url 不能为空", HTTPStatus: 400}
	}

	promptContent := ""
	if input.PromptID != "" {
		p, err := s.promptRepo.GetPromptByID(ctx, input.PromptID)
		if err != nil {
			return nil, err
		}
		if p != nil {
			promptContent = p.Content
		}
	}
	if promptContent == "" {
		promptContent = `识别图片中的食物，估算重量和营养，仅返回 JSON。输出要求：简体中文，只返回 JSON。`
	}

	provider, _ := resolveModelConfig(input.ModelName)
	var client LLMClient
	if provider == "gemini" {
		client = s.ofoxAIClient
	} else {
		client = s.dashScopeClient
	}

	result, err := client.Analyze(ctx, promptContent, input.ImageURL)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"result":       result,
		"model_name":   input.ModelName,
		"provider":     provider,
		"image_url":    input.ImageURL,
		"prompt_id":    input.PromptID,
		"analyzed_at":  time.Now().Format(time.RFC3339),
	}, nil
}

// ---------- Batches ----------

type PrepareBatchInput struct {
	DatasetID string         `json:"dataset_id"`
	Config    map[string]any `json:"config"`
}

func (s *TestBackendService) PrepareBatch(ctx context.Context, input PrepareBatchInput) (*domain.TestBatch, error) {
	if input.DatasetID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "dataset_id 不能为空", HTTPStatus: 400}
	}
	b := &domain.TestBatch{
		Name:      fmt.Sprintf("batch-%s", time.Now().Format("20060102-150405")),
		DatasetID: input.DatasetID,
		Status:    "pending",
		Config:    input.Config,
		Progress:  0,
		Results:   map[string]any{},
	}
	if err := s.batchRepo.CreateBatch(ctx, b); err != nil {
		return nil, err
	}
	return b, nil
}

type StartBatchInput struct {
	BatchID string `json:"batch_id"`
}

func (s *TestBackendService) StartBatch(ctx context.Context, input StartBatchInput) (*domain.TestBatch, error) {
	if input.BatchID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "batch_id 不能为空", HTTPStatus: 400}
	}
	b, err := s.batchRepo.GetBatchByID(ctx, input.BatchID)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, commonerrors.ErrNotFound
	}
	if b.Status != "pending" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "批次状态不是 pending，无法启动", HTTPStatus: 400}
	}
	return s.batchRepo.UpdateBatch(ctx, input.BatchID, map[string]any{"status": "running"})
}

func (s *TestBackendService) GetBatch(ctx context.Context, batchID string) (*domain.TestBatch, error) {
	b, err := s.batchRepo.GetBatchByID(ctx, batchID)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, commonerrors.ErrNotFound
	}
	return b, nil
}

// ---------- Datasets ----------

func (s *TestBackendService) ListDatasets(ctx context.Context) ([]domain.TestDataset, error) {
	return s.datasetRepo.ListDatasets(ctx)
}

type ImportDatasetInput struct {
	Name       string   `json:"name"`
	ImagePaths []string `json:"image_paths"`
}

func (s *TestBackendService) ImportLocalDataset(ctx context.Context, input ImportDatasetInput) (*domain.TestDataset, error) {
	if input.Name == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "name 不能为空", HTTPStatus: 400}
	}
	if len(input.ImagePaths) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "image_paths 不能为空", HTTPStatus: 400}
	}
	d := &domain.TestDataset{
		Name:       input.Name,
		ImagePaths: input.ImagePaths,
		Status:     "ready",
	}
	if err := s.datasetRepo.CreateDataset(ctx, d); err != nil {
		return nil, err
	}
	return d, nil
}

func (s *TestBackendService) PrepareDataset(ctx context.Context, datasetID string) (*domain.TestDataset, error) {
	d, err := s.datasetRepo.GetDatasetByID(ctx, datasetID)
	if err != nil {
		return nil, err
	}
	if d == nil {
		return nil, commonerrors.ErrNotFound
	}
	return s.datasetRepo.UpdateDataset(ctx, datasetID, map[string]any{"status": "prepared"})
}

// ---------- Auth ----------

func (s *TestBackendService) Login(ctx context.Context, password string) error {
	expected := os.Getenv("TEST_BACKEND_PASSWORD")
	if expected == "" {
		expected = "test-backend-password"
	}
	if password != expected {
		return commonerrors.ErrUnauthorized
	}
	return nil
}

func (s *TestBackendService) Logout(ctx context.Context) error {
	return nil
}

// ---------- Legacy Test API ----------

type LegacyBatchUploadInput struct {
	ImageURLs []string       `json:"image_urls"`
	Config    map[string]any `json:"config"`
}

func (s *TestBackendService) LegacyBatchUpload(ctx context.Context, input LegacyBatchUploadInput) (map[string]any, error) {
	return map[string]any{
		"message":      "legacy batch upload stub",
		"image_count":  len(input.ImageURLs),
		"mock_results": []map[string]any{},
	}, nil
}

type LegacySingleImageInput struct {
	ImageURL string `json:"image_url"`
}

func (s *TestBackendService) LegacySingleImage(ctx context.Context, input LegacySingleImageInput) (map[string]any, error) {
	if input.ImageURL == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "image_url 不能为空", HTTPStatus: 400}
	}
	return map[string]any{
		"message":     "legacy single image stub",
		"image_url":   input.ImageURL,
		"mock_result": map[string]any{"items": []map[string]any{}, "description": "mock analysis"},
	}, nil
}
