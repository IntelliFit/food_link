package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"strconv"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
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
		Name          string  `json:"name"`
		PromptName    string  `json:"prompt_name"`
		Content       string  `json:"content"`
		PromptContent string  `json:"prompt_content"`
		ModelType     string  `json:"model_type"`
		IsActive      bool    `json:"is_active"`
		CreatedBy     *string `json:"created_by"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	name := firstNonEmpty(body.Name, body.PromptName)
	content := firstNonEmpty(body.Content, body.PromptContent)
	p, err := h.svc.CreatePrompt(c.Request.Context(), service.CreatePromptInput{
		Name:      name,
		Content:   content,
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
		Name          *string `json:"name"`
		PromptName    *string `json:"prompt_name"`
		Content       *string `json:"content"`
		PromptContent *string `json:"prompt_content"`
		ModelType     *string `json:"model_type"`
		IsActive      *bool   `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	id := c.Param("prompt_id")
	name := firstNonNil(body.Name, body.PromptName)
	content := firstNonNil(body.Content, body.PromptContent)
	p, err := h.svc.UpdatePrompt(c.Request.Context(), id, service.UpdatePromptInput{
		Name:      name,
		Content:   content,
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
	if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		form, err := c.MultipartForm()
		if err != nil {
			response.Error(c, err)
			return
		}
		files := form.File["images"]
		if len(files) == 0 {
			if file, err := c.FormFile("image"); err == nil {
				files = []*multipart.FileHeader{file}
			}
		}
		if len(files) == 0 {
			response.Error(c, badRequest("请至少上传 1 张图片"))
			return
		}
		if len(files) > 3 {
			response.Error(c, badRequest("最多上传 3 张图片"))
			return
		}
		imageURLs := make([]string, 0, len(files))
		filename := files[0].Filename
		for _, file := range files {
			contentType := file.Header.Get("Content-Type")
			if !strings.HasPrefix(contentType, "image/") {
				response.Error(c, badRequest("请上传有效的图片文件（jpg, png, gif, webp）"))
				return
			}
			content, err := readUploadedFile(file, 10*1024*1024)
			if err != nil {
				response.Error(c, err)
				return
			}
			contentType = normalizeUploadImageContentType(contentType, file.Filename)
			imageURLs = append(imageURLs, "data:"+contentType+";base64,"+base64.StdEncoding.EncodeToString(content))
		}
		referenceWeight, _ := strconv.ParseFloat(c.PostForm("reference_weight"), 64)
		expectedItems, err := parseExpectedItems(c.PostForm("expected_items_json"), referenceWeight)
		if err != nil {
			response.Error(c, err)
			return
		}
		result, err := h.svc.Analyze(c.Request.Context(), service.AnalyzeInput{
			ImageURLs:       imageURLs,
			Filename:        filename,
			Notes:           c.PostForm("notes"),
			Models:          splitCSV(c.PostForm("models")),
			ExecutionMode:   c.PostForm("execution_mode"),
			PromptID:        c.PostForm("prompt_id"),
			PromptIDs:       splitCSV(c.PostForm("prompt_ids")),
			IsMultiView:     parseBool(c.PostForm("is_multi_view")),
			ExpectedItems:   expectedItems,
			ReferenceWeight: referenceWeight,
		})
		if err != nil {
			response.Error(c, err)
			return
		}
		response.Success(c, result)
		return
	}
	var body struct {
		ImageURL        string           `json:"image_url"`
		ImageURLs       []string         `json:"image_urls"`
		PromptID        string           `json:"prompt_id"`
		PromptIDs       []string         `json:"prompt_ids"`
		ModelName       string           `json:"model_name"`
		Models          []string         `json:"models"`
		Notes           string           `json:"notes"`
		ExecutionMode   string           `json:"execution_mode"`
		IsMultiView     bool             `json:"is_multi_view"`
		ExpectedItems   []map[string]any `json:"expected_items"`
		ReferenceWeight float64          `json:"reference_weight"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.svc.Analyze(c.Request.Context(), service.AnalyzeInput{
		ImageURL:        body.ImageURL,
		ImageURLs:       body.ImageURLs,
		PromptID:        body.PromptID,
		PromptIDs:       body.PromptIDs,
		ModelName:       body.ModelName,
		Models:          body.Models,
		Notes:           body.Notes,
		ExecutionMode:   body.ExecutionMode,
		IsMultiView:     body.IsMultiView,
		ExpectedItems:   body.ExpectedItems,
		ReferenceWeight: body.ReferenceWeight,
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
	if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		file, err := c.FormFile("file")
		if err != nil {
			response.Error(c, err)
			return
		}
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".zip") {
			response.Error(c, badRequest("请上传 ZIP 文件"))
			return
		}
		content, err := readUploadedFile(file, 50*1024*1024)
		if err != nil {
			response.Error(c, err)
			return
		}
		b, err := h.svc.PrepareBatch(c.Request.Context(), service.PrepareBatchInput{
			ZipBytes: content,
			Filename: file.Filename,
		})
		if err != nil {
			response.Error(c, err)
			return
		}
		response.Success(c, serializeBatch(b))
		return
	}
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
	response.Success(c, serializeBatch(b))
}

// POST /api/test-backend/batch/start
func (h *TestBackendHandler) StartBatch(c *gin.Context) {
	if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		b, err := h.svc.StartBatch(c.Request.Context(), service.StartBatchInput{
			BatchID:       c.PostForm("batch_id"),
			Notes:         c.PostForm("notes"),
			Models:        splitCSV(c.PostForm("models")),
			ExecutionMode: c.PostForm("execution_mode"),
			PromptID:      c.PostForm("prompt_id"),
			PromptIDs:     splitCSV(c.PostForm("prompt_ids")),
			IsMultiView:   parseBool(c.PostForm("is_multi_view")),
		})
		if err != nil {
			response.Error(c, err)
			return
		}
		response.Success(c, serializeBatch(b))
		return
	}
	var body struct {
		BatchID       string   `json:"batch_id"`
		Notes         string   `json:"notes"`
		Models        []string `json:"models"`
		ExecutionMode string   `json:"execution_mode"`
		PromptID      string   `json:"prompt_id"`
		PromptIDs     []string `json:"prompt_ids"`
		IsMultiView   bool     `json:"is_multi_view"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	b, err := h.svc.StartBatch(c.Request.Context(), service.StartBatchInput{
		BatchID:       body.BatchID,
		Notes:         body.Notes,
		Models:        body.Models,
		ExecutionMode: body.ExecutionMode,
		PromptID:      body.PromptID,
		PromptIDs:     body.PromptIDs,
		IsMultiView:   body.IsMultiView,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, serializeBatch(b))
}

// GET /api/test-backend/batch/:batch_id
func (h *TestBackendHandler) GetBatch(c *gin.Context) {
	batchID := c.Param("batch_id")
	b, err := h.svc.GetBatch(c.Request.Context(), batchID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, serializeBatch(b))
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
		Name        string   `json:"name"`
		SourceDir   string   `json:"source_dir"`
		Description string   `json:"description"`
		ImagePaths  []string `json:"image_paths"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	d, err := h.svc.ImportLocalDataset(c.Request.Context(), service.ImportDatasetInput{
		Name:        body.Name,
		SourceDir:   body.SourceDir,
		Description: body.Description,
		ImagePaths:  body.ImagePaths,
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
	if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		file, err := c.FormFile("file")
		if err != nil {
			response.Error(c, err)
			return
		}
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".zip") {
			response.Error(c, badRequest("请上传 ZIP 文件"))
			return
		}
		content, err := readUploadedFile(file, 50*1024*1024)
		if err != nil {
			response.Error(c, err)
			return
		}
		result, err := h.svc.LegacyBatchUpload(c.Request.Context(), service.LegacyBatchUploadInput{
			ZipBytes: content,
			Filename: file.Filename,
		})
		if err != nil {
			response.Error(c, err)
			return
		}
		response.Success(c, result)
		return
	}
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
	if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		file, err := c.FormFile("image")
		if err != nil {
			file, err = c.FormFile("file")
		}
		if err != nil {
			response.Error(c, err)
			return
		}
		trueWeight, err := strconv.ParseFloat(c.PostForm("trueWeight"), 64)
		if err != nil || trueWeight <= 0 {
			response.Error(c, badRequest("真实重量必须大于 0"))
			return
		}
		contentType := file.Header.Get("Content-Type")
		if !strings.HasPrefix(contentType, "image/") {
			response.Error(c, badRequest("请上传有效的图片文件（jpg, png, gif, webp）"))
			return
		}
		content, err := readUploadedFile(file, 10*1024*1024)
		if err != nil {
			response.Error(c, err)
			return
		}
		result, err := h.svc.LegacySingleImage(c.Request.Context(), service.LegacySingleImageInput{
			ImageBytes:  content,
			Filename:    file.Filename,
			ContentType: contentType,
			TrueWeight:  trueWeight,
		})
		if err != nil {
			response.Error(c, err)
			return
		}
		response.Success(c, result)
		return
	}
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

func readUploadedFile(file *multipart.FileHeader, maxBytes int64) ([]byte, error) {
	if file.Size > maxBytes {
		return nil, badRequest("文件大小超过限制")
	}
	src, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer src.Close()
	content, err := io.ReadAll(io.LimitReader(src, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(content)) > maxBytes {
		return nil, badRequest("文件大小超过限制")
	}
	return content, nil
}

func badRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: 400}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstNonNil(values ...*string) *string {
	for _, value := range values {
		if value != nil {
			trimmed := strings.TrimSpace(*value)
			return &trimmed
		}
	}
	return nil
}

func splitCSV(value string) []string {
	out := []string{}
	for _, part := range strings.Split(value, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func parseBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func normalizeUploadImageContentType(contentType, filename string) string {
	contentType = strings.TrimSpace(contentType)
	if strings.HasPrefix(contentType, "image/") {
		return contentType
	}
	lower := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".gif"):
		return "image/gif"
	case strings.HasSuffix(lower, ".webp"):
		return "image/webp"
	default:
		return "image/jpeg"
	}
}

func parseExpectedItems(raw string, referenceWeight float64) ([]map[string]any, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		if referenceWeight <= 0 {
			return []map[string]any{}, nil
		}
		return []map[string]any{{
			"name":            "总重量",
			"trueWeightGrams": referenceWeight,
		}}, nil
	}
	var decoded any
	if err := json.Unmarshal([]byte(raw), &decoded); err == nil {
		return expectedItemsFromDecoded(decoded, referenceWeight), nil
	}
	items := []map[string]any{}
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == '\n' || r == ';' || r == '；' || r == ',' || r == '，'
	}) {
		fields := strings.Fields(strings.TrimSpace(part))
		if len(fields) < 2 {
			continue
		}
		weight, err := strconv.ParseFloat(strings.TrimSuffix(strings.ToLower(fields[len(fields)-1]), "g"), 64)
		if err != nil || weight <= 0 {
			continue
		}
		items = append(items, map[string]any{
			"name":            strings.Join(fields[:len(fields)-1], " "),
			"trueWeightGrams": weight,
		})
	}
	if len(items) == 0 {
		return nil, badRequest("标准标签格式错误")
	}
	return items, nil
}

func expectedItemsFromDecoded(decoded any, referenceWeight float64) []map[string]any {
	switch value := decoded.(type) {
	case []any:
		out := make([]map[string]any, 0, len(value))
		for _, item := range value {
			if row, ok := item.(map[string]any); ok {
				out = append(out, normalizeExpectedItem(row))
			}
		}
		return out
	case map[string]any:
		if rawItems, ok := value["items"].([]any); ok {
			return expectedItemsFromDecoded(rawItems, referenceWeight)
		}
		return []map[string]any{normalizeExpectedItem(value)}
	default:
		if referenceWeight > 0 {
			return []map[string]any{{"name": "总重量", "trueWeightGrams": referenceWeight}}
		}
		return []map[string]any{}
	}
}

func normalizeExpectedItem(row map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range row {
		out[key] = value
	}
	if _, ok := out["trueWeightGrams"]; !ok {
		if value, ok := out["trueWeight"]; ok {
			out["trueWeightGrams"] = value
		}
	}
	if _, ok := out["name"]; !ok {
		out["name"] = ""
	}
	return out
}

func serializeBatch(batch *domain.TestBatch) gin.H {
	if batch == nil {
		return gin.H{}
	}
	payload := gin.H{}
	for key, value := range batch.Results {
		payload[key] = value
	}
	payload["batch_id"] = batch.ID
	payload["id"] = batch.ID
	payload["status"] = firstNonEmpty(stringFromAny(payload["status"]), batch.Status)
	if _, ok := payload["summary"]; !ok {
		payload["summary"] = gin.H{"total": 0, "pending": 0, "skipped": []string{}}
	}
	if _, ok := payload["progress"]; !ok {
		payload["progress"] = gin.H{"total": 0, "completed": batch.Progress, "failed": 0, "percent": batch.Progress}
	}
	if _, ok := payload["items"]; !ok {
		payload["items"] = []any{}
	}
	return payload
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(strings.Trim(fmt.Sprint(value), "\""))
	if text == "<nil>" {
		return ""
	}
	return text
}
