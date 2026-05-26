package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	authservice "food_link/backend/internal/auth/service"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/testbackend/domain"
	"food_link/backend/internal/testbackend/repo"
	"food_link/backend/pkg/config"
)

// LLMClient is the interface for LLM-based analysis.
type LLMClient interface {
	Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error)
}

type TestBackendService struct {
	promptRepo   *repo.PromptRepo
	batchRepo    *repo.BatchRepo
	datasetRepo  *repo.DatasetRepo
	doubaoClient LLMClient
	ofoxAIClient LLMClient
	userRepo     *authrepo.UserRepo
	jwtSvc       *authservice.JWTService
	cfg          *config.Config
}

func NewTestBackendService(
	promptRepo *repo.PromptRepo,
	batchRepo *repo.BatchRepo,
	datasetRepo *repo.DatasetRepo,
	doubaoClient LLMClient,
	ofoxAIClient LLMClient,
	userRepo *authrepo.UserRepo,
	jwtSvc *authservice.JWTService,
	cfg *config.Config,
) *TestBackendService {
	return &TestBackendService{
		promptRepo:   promptRepo,
		batchRepo:    batchRepo,
		datasetRepo:  datasetRepo,
		doubaoClient: doubaoClient,
		ofoxAIClient: ofoxAIClient,
		userRepo:     userRepo,
		jwtSvc:       jwtSvc,
		cfg:          cfg,
	}
}

type ImpersonateUserOutput struct {
	AccessToken     string  `json:"access_token"`
	RefreshToken    string  `json:"refresh_token"`
	TokenType       string  `json:"token_type"`
	ExpiresIn       int64   `json:"expires_in"`
	UserID          string  `json:"user_id"`
	OpenID          string  `json:"openid"`
	UnionID         string  `json:"unionid,omitempty"`
	PhoneNumber     *string `json:"phoneNumber,omitempty"`
	PurePhoneNumber *string `json:"purePhoneNumber,omitempty"`
	DietGoal        *string `json:"diet_goal,omitempty"`
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
	ImageURL        string           `json:"image_url"`
	ImageURLs       []string         `json:"image_urls"`
	PromptID        string           `json:"prompt_id"`
	PromptIDs       []string         `json:"prompt_ids"`
	ModelName       string           `json:"model_name"`
	Models          []string         `json:"models"`
	Filename        string           `json:"filename"`
	Notes           string           `json:"notes"`
	ExecutionMode   string           `json:"execution_mode"`
	IsMultiView     bool             `json:"is_multi_view"`
	ExpectedItems   []map[string]any `json:"expected_items"`
	ReferenceWeight float64          `json:"reference_weight"`
}

func resolveModelConfig(modelName string) (provider, model string) {
	raw := strings.TrimSpace(modelName)
	normalized := strings.ToLower(raw)
	if raw == "" || normalized == "doubao" {
		return "doubao", "doubao-seed-2-0-lite-260428"
	}
	if normalized == "gemini" || normalized == "gemini-flash" || normalized == "gemini-vision" {
		return "gemini", "gemini-3-flash-preview"
	}
	if strings.HasPrefix(normalized, "gemini") {
		return "gemini", raw
	}
	if strings.HasPrefix(normalized, "doubao") {
		return "doubao", raw
	}
	return "doubao", "doubao-seed-2-0-lite-260428"
}

func (s *TestBackendService) Analyze(ctx context.Context, input AnalyzeInput) (map[string]any, error) {
	imageURLs := append([]string{}, input.ImageURLs...)
	if input.ImageURL != "" {
		imageURLs = append([]string{input.ImageURL}, imageURLs...)
	}
	if len(imageURLs) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "image_url 不能为空", HTTPStatus: 400}
	}
	if len(imageURLs) > 1 && !input.IsMultiView {
		return nil, &commonerrors.AppError{Code: 10002, Message: "多张图片分析请开启多视角辅助模式", HTTPStatus: 400}
	}

	models := normalizeModelList(input.Models, input.ModelName)
	promptIDs := normalizePromptIDs(input.PromptIDs, input.PromptID)
	if len(promptIDs) == 0 {
		promptIDs = []string{""}
	}
	expectedItems := normalizeAnalyzeExpectedItems(input.ExpectedItems, input.ReferenceWeight)

	modelResults := make([]map[string]any, 0, len(models)*len(promptIDs))
	var firstSuccess map[string]any
	var firstMeta map[string]any
	for _, modelName := range models {
		for _, promptID := range promptIDs {
			started := time.Now()
			promptContent := ""
			promptName := ""
			if promptID != "" {
				p, err := s.promptRepo.GetPromptByID(ctx, promptID)
				if err != nil {
					modelResults = append(modelResults, map[string]any{
						"success": false,
						"model":   modelName,
						"error":   err.Error(),
					})
					continue
				}
				if p != nil {
					promptContent = p.Content
					promptName = p.Name
				}
			}
			if promptContent == "" {
				promptContent = `识别图片中的食物，估算重量和营养，仅返回 JSON。输出要求：简体中文，只返回 JSON。`
			}
			if strings.TrimSpace(input.Notes) != "" {
				promptContent += "\n\n补充说明：" + strings.TrimSpace(input.Notes)
			}

			provider, resolvedModel := resolveModelConfig(modelName)
			var client LLMClient
			if provider == "gemini" {
				client = s.ofoxAIClient
			} else {
				client = s.doubaoClient
			}

			rawResult, err := client.Analyze(ctx, promptContent, imageURLs[0])
			durationMs := time.Since(started).Milliseconds()
			meta := map[string]any{
				"image_count":          len(imageURLs),
				"filename":             input.Filename,
				"model":                resolvedModel,
				"provider":             provider,
				"prompt_id":            promptID,
				"prompt_name":          promptName,
				"prompt_source":        promptSourceName(promptID, promptName),
				"execution_mode":       defaultString(input.ExecutionMode, "standard"),
				"is_multi_view":        input.IsMultiView,
				"notes":                input.Notes,
				"response_duration_ms": durationMs,
			}
			if err != nil {
				modelResults = append(modelResults, map[string]any{
					"success":  false,
					"model":    resolvedModel,
					"provider": provider,
					"error":    err.Error(),
					"meta":     meta,
				})
				continue
			}
			estimatedWeight := extractEstimatedWeight(rawResult)
			meta["estimated_weight"] = estimatedWeight
			evaluation := buildAnalyzeEvaluation(rawResult, expectedItems, input.ReferenceWeight)
			row := map[string]any{
				"success":    true,
				"model":      resolvedModel,
				"provider":   provider,
				"data":       rawResult,
				"evaluation": evaluation,
				"meta":       meta,
			}
			modelResults = append(modelResults, row)
			if firstSuccess == nil {
				firstSuccess = rawResult
				firstMeta = meta
			}
		}
	}

	if firstSuccess == nil {
		return map[string]any{
			"success":       false,
			"message":       "所有模型均分析失败",
			"models":        modelResults,
			"labelMode":     inferLabelMode(expectedItems),
			"expectedItems": expectedItems,
		}, nil
	}

	out := map[string]any{
		"success":       true,
		"data":          firstSuccess,
		"meta":          firstMeta,
		"models":        modelResults,
		"labelMode":     inferLabelMode(expectedItems),
		"expectedItems": expectedItems,
		"result":        firstSuccess,
		"model_name":    input.ModelName,
		"provider":      firstMeta["provider"],
		"image_url":     imageURLs[0],
		"prompt_id":     input.PromptID,
		"analyzed_at":   time.Now().Format(time.RFC3339),
	}
	return out, nil
}

// ---------- Batches ----------

type PrepareBatchInput struct {
	DatasetID string         `json:"dataset_id"`
	ZipBytes  []byte         `json:"-"`
	Filename  string         `json:"filename"`
	Config    map[string]any `json:"config"`
}

func (s *TestBackendService) PrepareBatch(ctx context.Context, input PrepareBatchInput) (*domain.TestBatch, error) {
	if len(input.ZipBytes) > 0 {
		items, err := extractLegacyZipItems(input.ZipBytes)
		if err != nil {
			return nil, err
		}
		batchItems := make([]map[string]any, 0, len(items))
		for _, item := range items {
			batchItems = append(batchItems, map[string]any{
				"filename":        item.Filename,
				"trueWeight":      item.TrueWeight,
				"labelMode":       "total",
				"expectedItems":   normalizeExpectedItems(item.TrueWeight),
				"status":          "pending",
				"imageBytesB64":   base64.StdEncoding.EncodeToString(item.ImageBytes),
				"estimatedWeight": nil,
				"deviation":       nil,
				"modelResults":    []map[string]any{},
				"description":     nil,
				"items":           nil,
				"error":           nil,
			})
		}
		results := map[string]any{
			"status":         "pending",
			"notes":          "",
			"is_multi_view":  false,
			"models":         []string{"gemini-3-flash-preview"},
			"analysisModes":  []string{"legacy_direct", "db_first"},
			"executionMode":  "standard",
			"items":          batchItems,
			"summary":        buildBatchSummary(batchItems, nil),
			"sourceFilename": input.Filename,
		}
		b := &domain.TestBatch{
			Name:     defaultString(input.Filename, fmt.Sprintf("batch-%s", time.Now().Format("20060102-150405"))),
			Status:   "pending",
			Config:   input.Config,
			Progress: 0,
			Results:  results,
		}
		if err := s.batchRepo.CreateBatch(ctx, b); err != nil {
			return nil, err
		}
		b.Results["batch_id"] = b.ID
		if err := s.updateBatchResults(ctx, b, "pending"); err != nil {
			return nil, err
		}
		return s.batchRepo.GetBatchByID(ctx, b.ID)
	}

	if input.DatasetID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "dataset_id 不能为空", HTTPStatus: 400}
	}
	b := &domain.TestBatch{
		Name:      fmt.Sprintf("batch-%s", time.Now().Format("20060102-150405")),
		DatasetID: input.DatasetID,
		Status:    "pending",
		Config:    input.Config,
		Progress:  0,
		Results: map[string]any{
			"batch_id": input.DatasetID,
			"status":   "pending",
			"summary":  buildBatchSummary(nil, nil),
			"items":    []map[string]any{},
		},
	}
	if err := s.batchRepo.CreateBatch(ctx, b); err != nil {
		return nil, err
	}
	b.Results["batch_id"] = b.ID
	if err := s.updateBatchResults(ctx, b, "pending"); err != nil {
		return nil, err
	}
	return b, nil
}

type StartBatchInput struct {
	BatchID       string   `json:"batch_id"`
	Notes         string   `json:"notes"`
	Models        []string `json:"models"`
	ExecutionMode string   `json:"execution_mode"`
	PromptID      string   `json:"prompt_id"`
	PromptIDs     []string `json:"prompt_ids"`
	IsMultiView   bool     `json:"is_multi_view"`
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
	if b.Status != "pending" && b.Status != "running" {
		return b, nil
	}
	results := copyAnyMap(b.Results)
	items := batchItemsFromResults(results)
	if len(items) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "批次中没有可处理样本", HTTPStatus: 400}
	}
	results["status"] = "running"
	results["notes"] = input.Notes
	results["is_multi_view"] = input.IsMultiView
	results["models"] = normalizeModelList(input.Models, "")
	results["executionMode"] = defaultString(input.ExecutionMode, "standard")
	results["promptIds"] = normalizePromptIDs(input.PromptIDs, input.PromptID)
	b.Results = results
	if err := s.updateBatchResults(ctx, b, "running"); err != nil {
		return nil, err
	}

	completed := 0
	failed := 0
	for index, item := range items {
		item["status"] = "processing"
		results["items"] = items
		results["progress"] = buildBatchProgress(items, itemString(item, "filename"))
		b.Results = results
		_ = s.updateBatchResults(ctx, b, "running")

		imageURL := itemString(item, "imageUrl")
		if imageURL == "" {
			imageBytes, _ := base64.StdEncoding.DecodeString(itemString(item, "imageBytesB64"))
			if len(imageBytes) > 0 {
				imageURL = "data:" + normalizeImageContentType("", itemString(item, "filename")) + ";base64," + base64.StdEncoding.EncodeToString(imageBytes)
			}
		}
		expectedItems := expectedItemsFromAny(item["expectedItems"], itemFloat(item, "trueWeight"))
		result, err := s.Analyze(ctx, AnalyzeInput{
			ImageURL:        imageURL,
			ModelName:       "",
			Models:          input.Models,
			Filename:        itemString(item, "filename"),
			Notes:           input.Notes,
			ExecutionMode:   input.ExecutionMode,
			PromptID:        input.PromptID,
			PromptIDs:       input.PromptIDs,
			IsMultiView:     input.IsMultiView,
			ExpectedItems:   expectedItems,
			ReferenceWeight: itemFloat(item, "trueWeight"),
		})
		if err != nil || result["success"] == false {
			failed++
			item["status"] = "failed"
			if err != nil {
				item["error"] = err.Error()
			} else {
				item["error"] = stringFromMap(result, "message")
			}
			items[index] = item
			continue
		}
		completed++
		data, _ := result["data"].(map[string]any)
		meta, _ := result["meta"].(map[string]any)
		evaluation := evaluationFromResult(result)
		item["status"] = "done"
		item["estimatedWeight"] = numberFromAny(meta["estimated_weight"])
		item["deviation"] = numberFromAny(evaluation["totalWeightRelativeErrorPercent"])
		item["modelResults"] = result["models"]
		item["description"] = data["description"]
		item["items"] = data["items"]
		item["error"] = nil
		items[index] = item
	}

	status := "completed"
	if failed > 0 {
		status = "failed"
	}
	results["status"] = status
	results["items"] = items
	results["summary"] = buildBatchSummary(items, nil)
	results["progress"] = buildBatchProgress(items, "")
	results["completed"] = completed
	results["failed"] = failed
	b.Results = results
	return s.batchRepo.UpdateBatch(ctx, input.BatchID, map[string]any{
		"status":   status,
		"progress": int(numberFromAny(buildBatchProgress(items, "")["percent"])),
		"results":  results,
	})
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
	Name        string   `json:"name"`
	SourceDir   string   `json:"source_dir"`
	Description string   `json:"description"`
	ImagePaths  []string `json:"image_paths"`
}

func (s *TestBackendService) ImportLocalDataset(ctx context.Context, input ImportDatasetInput) (*domain.TestDataset, error) {
	if input.Name == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "name 不能为空", HTTPStatus: 400}
	}
	if len(input.ImagePaths) == 0 && strings.TrimSpace(input.SourceDir) != "" {
		paths, err := scanLocalDatasetImages(input.SourceDir)
		if err != nil {
			return nil, err
		}
		input.ImagePaths = paths
	}
	if len(input.ImagePaths) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "image_paths 或 source_dir 不能为空", HTTPStatus: 400}
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
	if password != expected && !(os.Getenv("TEST_BACKEND_PASSWORD") == "" && password == "123456") {
		return commonerrors.ErrUnauthorized
	}
	return nil
}

func (s *TestBackendService) Logout(ctx context.Context) error {
	return nil
}

func (s *TestBackendService) ImpersonateUser(ctx context.Context, userID string) (*ImpersonateUserOutput, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "user_id 不能为空", HTTPStatus: 400}
	}
	if s.cfg == nil || strings.TrimSpace(s.cfg.App.Env) != "development" {
		return nil, &commonerrors.AppError{Code: 20003, Message: "仅开发环境允许代登录", HTTPStatus: 403}
	}
	if s.userRepo == nil || s.jwtSvc == nil {
		return nil, commonerrors.ErrInternal
	}

	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}

	unionID := ""
	if user.UnionID != nil {
		unionID = strings.TrimSpace(*user.UnionID)
	}

	access, err := s.jwtSvc.IssueAccess(user.ID, user.OpenID, unionID)
	if err != nil {
		return nil, err
	}
	refresh, err := s.jwtSvc.IssueRefresh(user.ID, user.OpenID)
	if err != nil {
		return nil, err
	}

	return &ImpersonateUserOutput{
		AccessToken:     access,
		RefreshToken:    refresh,
		TokenType:       "bearer",
		ExpiresIn:       s.cfg.JWT.AccessTokenTTLSeconds,
		UserID:          user.ID,
		OpenID:          user.OpenID,
		UnionID:         unionID,
		PhoneNumber:     user.Telephone,
		PurePhoneNumber: user.Telephone,
		DietGoal:        user.DietGoal,
	}, nil
}

// ---------- Legacy Test API ----------

type LegacyBatchUploadInput struct {
	ImageURLs []string       `json:"image_urls"`
	ZipBytes  []byte         `json:"-"`
	Filename  string         `json:"filename"`
	Config    map[string]any `json:"config"`
}

func (s *TestBackendService) LegacyBatchUpload(ctx context.Context, input LegacyBatchUploadInput) (map[string]any, error) {
	if len(input.ZipBytes) > 0 {
		items, err := extractLegacyZipItems(input.ZipBytes)
		if err != nil {
			return nil, err
		}
		results := make([]map[string]any, 0, len(items))
		completed := 0
		failed := 0
		for _, item := range items {
			result, err := s.LegacySingleImage(ctx, LegacySingleImageInput{
				ImageBytes:  item.ImageBytes,
				Filename:    item.Filename,
				ContentType: item.ContentType,
				TrueWeight:  item.TrueWeight,
			})
			row := map[string]any{
				"filename":    item.Filename,
				"trueWeight":  item.TrueWeight,
				"labelMode":   "single_total_weight",
				"expectedRaw": item.LabelRaw,
			}
			if err != nil {
				failed++
				row["status"] = "failed"
				row["error"] = err.Error()
			} else {
				completed++
				row["status"] = "done"
				if data, ok := result["data"].(map[string]any); ok {
					for key, value := range data {
						row[key] = value
					}
				}
			}
			results = append(results, row)
		}
		return map[string]any{
			"success": true,
			"message": "batch upload processed",
			"summary": map[string]any{
				"total":     len(items),
				"completed": completed,
				"failed":    failed,
			},
			"results": results,
		}, nil
	}
	if len(input.ImageURLs) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请上传 ZIP 文件或提供 image_urls", HTTPStatus: 400}
	}
	results := make([]map[string]any, 0, len(input.ImageURLs))
	completed := 0
	failed := 0
	for _, imageURL := range input.ImageURLs {
		result, err := s.LegacySingleImage(ctx, LegacySingleImageInput{ImageURL: imageURL})
		row := map[string]any{"image_url": imageURL}
		if err != nil {
			failed++
			row["status"] = "failed"
			row["error"] = err.Error()
		} else {
			completed++
			row["status"] = "done"
			if data, ok := result["data"].(map[string]any); ok {
				for key, value := range data {
					row[key] = value
				}
			}
		}
		results = append(results, row)
	}
	return map[string]any{
		"success": true,
		"message": "batch upload processed",
		"summary": map[string]any{
			"total":     len(input.ImageURLs),
			"completed": completed,
			"failed":    failed,
		},
		"results": results,
	}, nil
}

type LegacySingleImageInput struct {
	ImageURL    string  `json:"image_url"`
	ImageBytes  []byte  `json:"-"`
	Filename    string  `json:"filename"`
	ContentType string  `json:"content_type"`
	TrueWeight  float64 `json:"true_weight"`
}

func (s *TestBackendService) LegacySingleImage(ctx context.Context, input LegacySingleImageInput) (map[string]any, error) {
	imageURL := strings.TrimSpace(input.ImageURL)
	if imageURL == "" && len(input.ImageBytes) > 0 {
		contentType := normalizeImageContentType(input.ContentType, input.Filename)
		imageURL = "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(input.ImageBytes)
	}
	if imageURL == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "image_url 或图片文件不能为空", HTTPStatus: 400}
	}
	if input.TrueWeight < 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "真实重量必须大于 0", HTTPStatus: 400}
	}

	result, err := s.Analyze(ctx, AnalyzeInput{ImageURL: imageURL, ModelName: "doubao"})
	if err != nil {
		return nil, err
	}
	rawResult, _ := result["result"].(map[string]any)
	estimatedWeight := extractEstimatedWeight(rawResult)
	var deviation *float64
	if input.TrueWeight > 0 && estimatedWeight > 0 {
		value := estimatedWeight - input.TrueWeight
		deviation = &value
	}
	data := map[string]any{
		"filename":          input.Filename,
		"image_url":         imageURL,
		"trueWeight":        input.TrueWeight,
		"estimatedWeight":   estimatedWeight,
		"deviation":         deviation,
		"result":            rawResult,
		"model_name":        result["model_name"],
		"provider":          result["provider"],
		"analyzed_at":       result["analyzed_at"],
		"labelMode":         "single_total_weight",
		"expectedItems":     normalizeExpectedItems(input.TrueWeight),
		"description":       rawResult["description"],
		"items":             rawResult["items"],
		"pfc_ratio_comment": rawResult["pfc_ratio_comment"],
		"absorption_notes":  rawResult["absorption_notes"],
		"context_advice":    rawResult["context_advice"],
	}
	return map[string]any{
		"success": true,
		"data":    data,
	}, nil
}

type legacyZipItem struct {
	Filename    string
	ImageBytes  []byte
	ContentType string
	TrueWeight  float64
	LabelRaw    string
}

func extractLegacyZipItems(zipBytes []byte) ([]legacyZipItem, error) {
	reader, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, &commonerrors.AppError{Code: 10002, Message: "ZIP 文件解析失败", HTTPStatus: 400}
	}
	images := map[string][]byte{}
	labelsText := ""
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		name := filepath.Base(file.Name)
		lower := strings.ToLower(name)
		if lower == "labels.txt" {
			content, err := readZipFile(file, 1*1024*1024)
			if err != nil {
				return nil, err
			}
			labelsText = string(content)
			continue
		}
		if isLegacyImageFilename(lower) {
			content, err := readZipFile(file, 10*1024*1024)
			if err != nil {
				return nil, err
			}
			images[name] = content
		}
	}
	if len(images) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "ZIP 文件中没有找到有效的图片文件", HTTPStatus: 400}
	}
	labels := parseLegacyLabels(labelsText)
	if len(labels) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "ZIP 文件中缺少 labels.txt 或标签格式无效", HTTPStatus: 400}
	}
	items := []legacyZipItem{}
	for filename, weight := range labels {
		content, ok := images[filename]
		if !ok {
			for imageName, imageBytes := range images {
				if strings.EqualFold(imageName, filename) {
					content = imageBytes
					ok = true
					filename = imageName
					break
				}
			}
		}
		if !ok {
			continue
		}
		items = append(items, legacyZipItem{
			Filename:    filename,
			ImageBytes:  content,
			ContentType: normalizeImageContentType("", filename),
			TrueWeight:  weight,
			LabelRaw:    fmt.Sprintf("%.1fg", weight),
		})
	}
	if len(items) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "没有找到可处理的图片和标签匹配项", HTTPStatus: 400}
	}
	return items, nil
}

func readZipFile(file *zip.File, maxBytes int64) ([]byte, error) {
	if file.FileInfo().Size() > maxBytes {
		return nil, &commonerrors.AppError{Code: 10002, Message: "ZIP 内文件超过大小限制", HTTPStatus: 400}
	}
	rc, err := file.Open()
	if err != nil {
		return nil, &commonerrors.AppError{Code: 10002, Message: "ZIP 内文件读取失败", HTTPStatus: 400}
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, maxBytes+1))
}

func parseLegacyLabels(labelsText string) map[string]float64 {
	labels := map[string]float64{}
	for _, line := range strings.Split(labelsText, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		weightText := strings.TrimSuffix(strings.TrimSuffix(strings.ToLower(parts[1]), "grams"), "g")
		weight, err := strconv.ParseFloat(weightText, 64)
		if err != nil || weight <= 0 {
			continue
		}
		labels[filepath.Base(parts[0])] = weight
	}
	return labels
}

func isLegacyImageFilename(name string) bool {
	return strings.HasSuffix(name, ".jpg") ||
		strings.HasSuffix(name, ".jpeg") ||
		strings.HasSuffix(name, ".png") ||
		strings.HasSuffix(name, ".gif") ||
		strings.HasSuffix(name, ".webp")
}

func normalizeImageContentType(contentType, filename string) string {
	contentType = strings.TrimSpace(contentType)
	if strings.HasPrefix(contentType, "image/") {
		return contentType
	}
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "image/jpeg"
	}
}

func extractEstimatedWeight(result map[string]any) float64 {
	if result == nil {
		return 0
	}
	if value := numberFromAny(result["estimatedWeightGrams"]); value > 0 {
		return value
	}
	if items, ok := result["items"].([]map[string]any); ok && len(items) > 0 {
		total := 0.0
		for _, item := range items {
			if value := numberFromAny(item["estimatedWeightGrams"]); value > 0 {
				total += value
			}
		}
		return total
	}
	if items, ok := result["items"].([]any); ok && len(items) > 0 {
		total := 0.0
		for _, item := range items {
			row, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if value := numberFromAny(row["estimatedWeightGrams"]); value > 0 {
				total += value
			}
		}
		return total
	}
	return 0
}

func normalizeExpectedItems(trueWeight float64) []map[string]any {
	if trueWeight <= 0 {
		return []map[string]any{}
	}
	return []map[string]any{{
		"name":                "",
		"trueWeight":          trueWeight,
		"trueWeightGrams":     trueWeight,
		"estimatedWeightUnit": "g",
	}}
}

func numberFromAny(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case int32:
		return float64(v)
	case uint:
		return float64(v)
	case uint64:
		return float64(v)
	case json.Number:
		n, _ := v.Float64()
		return n
	case string:
		n, _ := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(strings.ToLower(v), "g")), 64)
		return n
	default:
		return 0
	}
}

func normalizeModelList(models []string, fallback string) []string {
	out := []string{}
	for _, model := range models {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		exists := false
		for _, item := range out {
			if strings.EqualFold(item, model) {
				exists = true
				break
			}
		}
		if !exists {
			out = append(out, model)
		}
	}
	if len(out) == 0 && strings.TrimSpace(fallback) != "" {
		out = append(out, strings.TrimSpace(fallback))
	}
	if len(out) == 0 {
		out = append(out, "gemini-3-flash-preview")
	}
	return out
}

func normalizePromptIDs(promptIDs []string, promptID string) []string {
	out := []string{}
	for _, item := range append(promptIDs, promptID) {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		seen := false
		for _, existing := range out {
			if existing == item {
				seen = true
				break
			}
		}
		if !seen {
			out = append(out, item)
		}
	}
	return out
}

func normalizeAnalyzeExpectedItems(items []map[string]any, referenceWeight float64) []map[string]any {
	if len(items) == 0 {
		return normalizeExpectedItems(referenceWeight)
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		row := copyAnyMap(item)
		if _, ok := row["trueWeightGrams"]; !ok {
			if value := numberFromAny(row["trueWeight"]); value > 0 {
				row["trueWeightGrams"] = value
			}
		}
		if row["name"] == nil {
			row["name"] = ""
		}
		out = append(out, row)
	}
	return out
}

func promptSourceName(promptID, promptName string) string {
	if strings.TrimSpace(promptID) == "" {
		return "default"
	}
	if strings.TrimSpace(promptName) != "" {
		return "test_prompts:" + strings.TrimSpace(promptName)
	}
	return "test_prompts:" + strings.TrimSpace(promptID)
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func buildAnalyzeEvaluation(result map[string]any, expectedItems []map[string]any, referenceWeight float64) map[string]any {
	estimatedWeight := extractEstimatedWeight(result)
	expectedTotal := referenceWeight
	if expectedTotal <= 0 {
		for _, item := range expectedItems {
			expectedTotal += numberFromAny(item["trueWeightGrams"])
			if numberFromAny(item["trueWeightGrams"]) <= 0 {
				expectedTotal += numberFromAny(item["trueWeight"])
			}
		}
	}
	absoluteError := 0.0
	relativeErrorPercent := 0.0
	if expectedTotal > 0 && estimatedWeight > 0 {
		absoluteError = math.Abs(estimatedWeight - expectedTotal)
		relativeErrorPercent = absoluteError / expectedTotal * 100
	}
	mode := inferLabelMode(expectedItems)
	score := 0.0
	if relativeErrorPercent > 0 {
		score = math.Max(0, 1-relativeErrorPercent/100)
	} else if expectedTotal > 0 && estimatedWeight > 0 {
		score = 1
	}
	return map[string]any{
		"mode":                            mode,
		"estimatedTotalWeight":            estimatedWeight,
		"expectedTotalWeight":             expectedTotal,
		"absoluteErrorGrams":              absoluteError,
		"totalWeightRelativeError":        relativeErrorPercent / 100,
		"totalWeightRelativeErrorPercent": relativeErrorPercent,
		"totalDeviation":                  relativeErrorPercent,
		"finalCompositeScore":             score,
		"finalCompositeScorePercent":      score * 100,
		"foodF1":                          0,
	}
}

func inferLabelMode(expectedItems []map[string]any) string {
	if len(expectedItems) == 0 {
		return ""
	}
	if len(expectedItems) == 1 {
		name := strings.ToLower(strings.ReplaceAll(fmt.Sprintf("%v", expectedItems[0]["name"]), " ", ""))
		if name == "" || name == "总重量" || name == "总重" || name == "total" || name == "totalweight" || name == "total_weight" {
			return "total"
		}
	}
	return "items"
}

func (s *TestBackendService) updateBatchResults(ctx context.Context, b *domain.TestBatch, status string) error {
	_, err := s.batchRepo.UpdateBatch(ctx, b.ID, map[string]any{
		"status":   status,
		"progress": int(numberFromAny(buildBatchProgress(batchItemsFromResults(b.Results), "")["percent"])),
		"results":  b.Results,
	})
	return err
}

func copyAnyMap(in map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range in {
		out[key] = value
	}
	return out
}

func batchItemsFromResults(results map[string]any) []map[string]any {
	raw := results["items"]
	switch items := raw.(type) {
	case []map[string]any:
		out := make([]map[string]any, len(items))
		for i, item := range items {
			out[i] = copyAnyMap(item)
		}
		return out
	case []any:
		out := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if row, ok := item.(map[string]any); ok {
				out = append(out, copyAnyMap(row))
			}
		}
		return out
	default:
		return []map[string]any{}
	}
}

func buildBatchSummary(items []map[string]any, skipped []string) map[string]any {
	summary := map[string]any{
		"total":     len(items),
		"pending":   0,
		"completed": 0,
		"failed":    0,
		"skipped":   skipped,
	}
	for _, item := range items {
		switch itemString(item, "status") {
		case "done", "completed":
			summary["completed"] = summary["completed"].(int) + 1
		case "failed":
			summary["failed"] = summary["failed"].(int) + 1
		default:
			summary["pending"] = summary["pending"].(int) + 1
		}
	}
	return summary
}

func buildBatchProgress(items []map[string]any, currentFile string) map[string]any {
	total := len(items)
	completed := 0
	failed := 0
	for _, item := range items {
		switch itemString(item, "status") {
		case "done", "completed":
			completed++
		case "failed":
			failed++
		}
	}
	percent := 0.0
	if total > 0 {
		percent = float64(completed+failed) / float64(total) * 100
	}
	return map[string]any{
		"total":        total,
		"completed":    completed,
		"failed":       failed,
		"percent":      percent,
		"current_file": currentFile,
	}
}

func itemString(item map[string]any, key string) string {
	return stringFromMap(item, key)
}

func itemFloat(item map[string]any, key string) float64 {
	return numberFromAny(item[key])
}

func stringFromMap(values map[string]any, key string) string {
	if values == nil || values[key] == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprintf("%v", values[key]))
	if text == "<nil>" {
		return ""
	}
	return text
}

func evaluationFromResult(result map[string]any) map[string]any {
	modelResults, ok := result["models"].([]map[string]any)
	if ok {
		for _, row := range modelResults {
			if row["success"] == true {
				if evaluation, ok := row["evaluation"].(map[string]any); ok {
					return evaluation
				}
			}
		}
	}
	if rawRows, ok := result["models"].([]any); ok {
		for _, raw := range rawRows {
			row, ok := raw.(map[string]any)
			if !ok || row["success"] != true {
				continue
			}
			if evaluation, ok := row["evaluation"].(map[string]any); ok {
				return evaluation
			}
		}
	}
	return map[string]any{}
}

func expectedItemsFromAny(value any, fallbackWeight float64) []map[string]any {
	switch items := value.(type) {
	case []map[string]any:
		return normalizeAnalyzeExpectedItems(items, fallbackWeight)
	case []any:
		out := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if row, ok := item.(map[string]any); ok {
				out = append(out, row)
			}
		}
		return normalizeAnalyzeExpectedItems(out, fallbackWeight)
	default:
		return normalizeExpectedItems(fallbackWeight)
	}
}

func scanLocalDatasetImages(sourceDir string) ([]string, error) {
	sourceDir = strings.TrimSpace(sourceDir)
	if sourceDir == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "source_dir 不能为空", HTTPStatus: 400}
	}
	info, err := os.Stat(sourceDir)
	if err != nil || !info.IsDir() {
		return nil, &commonerrors.AppError{Code: 10002, Message: "source_dir 不存在或不是目录", HTTPStatus: 400}
	}
	entries, err := os.ReadDir(sourceDir)
	if err != nil {
		return nil, err
	}
	paths := []string{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.EqualFold(name, "labels.txt") || !isLegacyImageFilename(strings.ToLower(name)) {
			continue
		}
		paths = append(paths, filepath.Join(sourceDir, name))
	}
	return paths, nil
}
