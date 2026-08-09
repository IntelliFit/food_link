package service

import (
	"context"
	"fmt"
	"log/slog"
	"mime"
	"path/filepath"
	"sort"
	"strings"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	"food_link/backend/internal/campuscatalog/domain"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
)

const (
	maxBatchItems    = 200
	maxImagesPerItem = 6
)

type CatalogRepository interface {
	FindBatchByClientKey(ctx context.Context, clientBatchKey string) (*domain.CollectionBatch, error)
	CreateBatchWithItems(ctx context.Context, batch *domain.CollectionBatch, items []domain.CatalogItem) error
	ListBatches(ctx context.Context, limit, offset int) ([]domain.CollectionBatch, int64, error)
	ListItemsByBatch(ctx context.Context, batchID string) ([]domain.CatalogItem, error)
	ListItems(ctx context.Context, filter domain.CatalogItemFilter) ([]domain.CatalogItem, int64, error)
	GetAnalysisProgress(ctx context.Context) (*domain.AnalysisProgress, error)
	ListPublishedItemsMissingNutrition(ctx context.Context, limit int) ([]domain.CatalogItem, error)
	HidePublicItemForNutritionBackfill(ctx context.Context, itemID string) error
	FindItemByID(ctx context.Context, itemID string) (*domain.CatalogItem, error)
	UpdateItem(ctx context.Context, item *domain.CatalogItem) error
	MarkAnalysisPending(ctx context.Context, item *domain.CatalogItem, adminID string, startedAt time.Time) error
	LinkAnalysisTask(ctx context.Context, itemID, taskID string) error
	MarkAnalysisFailed(ctx context.Context, itemID, message string, failedAt time.Time) error
	ListCurrentTerminalAnalysisCandidates(ctx context.Context, limit int) ([]domain.CurrentAnalysisCandidate, error)
	MarkCurrentTerminalAnalysisFailed(ctx context.Context, itemID, taskID, message string, failedAt time.Time) (bool, error)
	CountOrphanPendingAnalysisCandidates(ctx context.Context, staleBefore time.Time) (int64, error)
	ListOrphanAnalysisCandidates(ctx context.Context, staleBefore time.Time, limit int) ([]domain.CatalogItem, error)
	ClaimOrphanAnalysis(ctx context.Context, itemID string, expectedTaskID *string, staleBefore time.Time, message string, claimedAt time.Time) (bool, error)
	ListFailedAnalysisRetryCandidates(ctx context.Context, limit int) ([]domain.CatalogItem, error)
	ActivatePreparedAnalysisRetry(ctx context.Context, itemID, sourceTaskID, retryTaskID string, startedAt time.Time) (bool, error)
	ListLegacyTerminalAnalysisCandidates(ctx context.Context, limit int) ([]domain.LegacyAnalysisCandidate, error)
	ClaimLegacyAnalysisRetry(ctx context.Context, itemID, taskID, message string, claimedAt time.Time) (bool, error)
	CompleteAnalyzedItem(ctx context.Context, itemID, taskID string, result map[string]any, completedAt time.Time) error
	TryAnalysisMaintenanceLeadership(ctx context.Context, fn func(context.Context) error) (bool, error)
	SoftDeleteItem(ctx context.Context, itemID string) error
}

type CatalogAnalyzeTaskSubmitter interface {
	SubmitInternalAnalyzeTask(ctx context.Context, userID string, input analyzeservice.SubmitTaskInput) (string, error)
	SubmitInternalTextTask(ctx context.Context, userID string, input analyzeservice.SubmitTaskInput) (string, error)
	PrepareInternalCampusRetryTask(ctx context.Context, taskID, userID, catalogItemID string) (*analyzeservice.RetryTaskResult, error)
	EnqueuePreparedInternalTask(ctx context.Context, taskID, userID string) error
}

type CatalogAnalysisUserResolver interface {
	ResolveInternalAnalysisUserID(ctx context.Context, purpose, actorID string) (string, error)
}

type CatalogService struct {
	repo          CatalogRepository
	storage       *storage.Client
	analyzeTasks  CatalogAnalyzeTaskSubmitter
	analysisUsers CatalogAnalysisUserResolver
}

func (s *CatalogService) ConfigureAnalysis(submitter CatalogAnalyzeTaskSubmitter, users CatalogAnalysisUserResolver) {
	s.analyzeTasks = submitter
	s.analysisUsers = users
}

func NewCatalogService(repo CatalogRepository, storageClient *storage.Client) *CatalogService {
	return &CatalogService{repo: repo, storage: storageClient}
}

type CreateBatchInput struct {
	ClientBatchKey      string                   `json:"client_batch_key"`
	BatchName           string                   `json:"batch_name"`
	VenueType           string                   `json:"venue_type"`
	SchoolID            *string                  `json:"school_id"`
	CampusID            *string                  `json:"campus_id"`
	CanteenID           *string                  `json:"canteen_id"`
	DefaultWindowID     *string                  `json:"default_window_id"`
	OrganizationName    string                   `json:"organization_name"`
	AreaName            string                   `json:"area_name"`
	CanteenName         string                   `json:"canteen_name"`
	DefaultFloor        string                   `json:"default_floor"`
	DefaultWindowName   string                   `json:"default_window_name"`
	DefaultWindowLayout string                   `json:"default_window_layout"`
	DefaultServiceMode  string                   `json:"default_service_mode"`
	DefaultMealPeriods  []string                 `json:"default_meal_periods"`
	CapturedAt          *time.Time               `json:"captured_at"`
	CollectorName       string                   `json:"collector_name"`
	SourceNote          string                   `json:"source_note"`
	Entries             []CreateCatalogItemInput `json:"entries"`
}

type CreateCatalogItemInput struct {
	EntryType          string         `json:"entry_type"`
	Name               string         `json:"name"`
	Description        string         `json:"description"`
	WindowID           *string        `json:"window_id"`
	Floor              string         `json:"floor"`
	WindowName         string         `json:"window_name"`
	WindowLayout       string         `json:"window_layout"`
	MealPeriods        []string       `json:"meal_periods"`
	AvailableWeekdays  []string       `json:"available_weekdays"`
	AvailabilityNote   string         `json:"availability_note"`
	ServiceMode        string         `json:"service_mode"`
	PriceType          string         `json:"price_type"`
	Price              *float64       `json:"price"`
	PriceMin           *float64       `json:"price_min"`
	PriceMax           *float64       `json:"price_max"`
	PriceUnit          string         `json:"price_unit"`
	PriceText          string         `json:"price_text"`
	PriceOptions       map[string]any `json:"price_options"`
	PortionDescription string         `json:"portion_description"`
	ImagePaths         []string       `json:"image_paths"`
	ImageKind          string         `json:"image_kind"`
	SourceFilename     string         `json:"source_filename"`
	RawText            string         `json:"raw_text"`
	Notes              string         `json:"notes"`
}

// UpdateCatalogItemInput deliberately matches the editable fields used during
// creation. Location ownership and audit fields remain immutable on updates.
type UpdateCatalogItemInput = CreateCatalogItemInput

type CreateBatchResult struct {
	Batch      domain.CollectionBatch `json:"batch"`
	Items      []domain.CatalogItem   `json:"items"`
	Idempotent bool                   `json:"idempotent"`
}

type BatchListResult struct {
	Items []domain.CollectionBatch `json:"items"`
	Page  int                      `json:"page"`
	Limit int                      `json:"limit"`
	Total int64                    `json:"total"`
}

type CatalogItemListInput struct {
	BatchID   string
	SchoolID  string
	CampusID  string
	CanteenID string
	WindowID  string
	Status    string
	Query     string
	Page      int
	Limit     int
}

type CatalogItemListResult struct {
	Items []domain.CatalogItem `json:"items"`
	Page  int                  `json:"page"`
	Limit int                  `json:"limit"`
	Total int64                `json:"total"`
}

func (s *CatalogService) GetAnalysisProgress(ctx context.Context) (*domain.AnalysisProgress, error) {
	return s.repo.GetAnalysisProgress(ctx)
}

func (s *CatalogService) UploadImage(ctx context.Context, adminID, sourceFilename, contentType string, data []byte) (string, error) {
	if s.storage == nil {
		return "", appError("食堂采集图片存储未配置")
	}
	if len(data) == 0 {
		return "", badRequest("图片文件不能为空")
	}
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	ext := imageExtension(contentType, sourceFilename)
	if ext == "" {
		return "", badRequest("仅支持 JPG、PNG、WebP、HEIC 图片")
	}
	key := fmt.Sprintf("campus-food/%s/%s%s", time.Now().Format("2006/01"), uuid.NewString(), ext)
	imageURL, err := s.storage.UploadBytes("food-images", key, data, contentType)
	if err != nil {
		logger.Error(ctx, "上传食堂采集图片失败", err,
			slog.String("admin_id", adminID),
			slog.String("object_key", key),
			slog.Int("bytes", len(data)),
		)
		return "", err
	}
	return imageURL, nil
}

func (s *CatalogService) CreateBatch(ctx context.Context, adminID string, input CreateBatchInput) (*CreateBatchResult, error) {
	clientKey := strings.TrimSpace(input.ClientBatchKey)
	if clientKey == "" {
		return nil, badRequest("采集批次标识不能为空")
	}
	if existing, err := s.repo.FindBatchByClientKey(ctx, clientKey); err != nil {
		return nil, err
	} else if existing != nil {
		items, listErr := s.repo.ListItemsByBatch(ctx, existing.ID)
		if listErr != nil {
			return nil, listErr
		}
		existing.ItemCount = len(items)
		s.resolveItemImages(items)
		return &CreateBatchResult{Batch: *existing, Items: items, Idempotent: true}, nil
	}

	venueType, ok := normalizeEnum(input.VenueType, "university", venueTypes)
	if !ok {
		return nil, badRequest("场所类型不正确")
	}
	organizationName := strings.TrimSpace(input.OrganizationName)
	canteenName := strings.TrimSpace(input.CanteenName)
	if organizationName == "" || canteenName == "" {
		return nil, badRequest("请填写学校或园区名称以及食堂名称")
	}
	if len(input.Entries) == 0 {
		return nil, badRequest("请至少添加一条食堂采集记录")
	}
	if len(input.Entries) > maxBatchItems {
		return nil, badRequest(fmt.Sprintf("单批最多上传 %d 条记录", maxBatchItems))
	}
	defaultServiceMode, ok := normalizeEnum(input.DefaultServiceMode, "unknown", serviceModes)
	if !ok {
		return nil, badRequest("默认售卖形式不正确")
	}
	defaultWindowLayout, ok := normalizeEnum(input.DefaultWindowLayout, "unknown", windowLayouts)
	if !ok {
		return nil, badRequest("窗口形态不正确")
	}
	defaultMealPeriods, err := normalizeStringEnums(input.DefaultMealPeriods, mealPeriods)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	batchID := uuid.NewString()
	adminID = strings.TrimSpace(adminID)
	batchName := strings.TrimSpace(input.BatchName)
	if batchName == "" {
		batchName = strings.Join(nonEmptyStrings(organizationName, canteenName, now.Format("2006-01-02")), "-")
	}
	batch := domain.CollectionBatch{
		ID:                  batchID,
		ClientBatchKey:      clientKey,
		BatchName:           batchName,
		VenueType:           venueType,
		SchoolID:            trimStringPtr(input.SchoolID),
		CampusID:            trimStringPtr(input.CampusID),
		CanteenID:           trimStringPtr(input.CanteenID),
		DefaultWindowID:     trimStringPtr(input.DefaultWindowID),
		OrganizationName:    organizationName,
		AreaName:            strings.TrimSpace(input.AreaName),
		CanteenName:         canteenName,
		DefaultFloor:        strings.TrimSpace(input.DefaultFloor),
		DefaultWindowName:   strings.TrimSpace(input.DefaultWindowName),
		DefaultWindowLayout: defaultWindowLayout,
		DefaultServiceMode:  defaultServiceMode,
		DefaultMealPeriods:  defaultMealPeriods,
		CapturedAt:          input.CapturedAt,
		CollectorName:       strings.TrimSpace(input.CollectorName),
		SourceNote:          strings.TrimSpace(input.SourceNote),
		Status:              "submitted",
		CreatedByAdminID:    trimStringPtr(&adminID),
		CreatedAt:           &now,
		UpdatedAt:           &now,
		ItemCount:           len(input.Entries),
	}

	items := make([]domain.CatalogItem, 0, len(input.Entries))
	for index, entry := range input.Entries {
		item, itemErr := s.buildCatalogItem(batch, entry, index, adminID, now)
		if itemErr != nil {
			return nil, itemErr
		}
		items = append(items, item)
	}
	if err := s.repo.CreateBatchWithItems(ctx, &batch, items); err != nil {
		logger.Error(ctx, "保存食堂采集批次失败", err,
			slog.String("admin_id", adminID),
			slog.String("batch_id", batch.ID),
			slog.Int("item_count", len(items)),
		)
		return nil, err
	}
	resultItems := append([]domain.CatalogItem(nil), items...)
	s.resolveItemImages(resultItems)
	return &CreateBatchResult{Batch: batch, Items: resultItems}, nil
}

func (s *CatalogService) ListBatches(ctx context.Context, page, limit int) (*BatchListResult, error) {
	if page <= 0 {
		page = 1
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	items, total, err := s.repo.ListBatches(ctx, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &BatchListResult{Items: items, Page: page, Limit: limit, Total: total}, nil
}

func (s *CatalogService) ListItemsByBatch(ctx context.Context, batchID string) ([]domain.CatalogItem, error) {
	batchID = strings.TrimSpace(batchID)
	if batchID == "" {
		return nil, badRequest("采集批次 ID 不能为空")
	}
	items, err := s.repo.ListItemsByBatch(ctx, batchID)
	if err != nil {
		return nil, err
	}
	s.resolveItemImages(items)
	return items, nil
}

func (s *CatalogService) ListItems(ctx context.Context, input CatalogItemListInput) (*CatalogItemListResult, error) {
	input.BatchID = strings.TrimSpace(input.BatchID)
	input.SchoolID = strings.TrimSpace(input.SchoolID)
	input.CampusID = strings.TrimSpace(input.CampusID)
	input.CanteenID = strings.TrimSpace(input.CanteenID)
	input.WindowID = strings.TrimSpace(input.WindowID)
	input.Status = strings.TrimSpace(input.Status)
	input.Query = strings.TrimSpace(input.Query)
	if input.BatchID == "" && input.SchoolID == "" && input.CampusID == "" && input.CanteenID == "" && input.WindowID == "" {
		return nil, badRequest("至少选择采集批次、学校、校区、食堂或窗口之一")
	}
	if input.Page <= 0 {
		input.Page = 1
	}
	if input.Limit <= 0 {
		input.Limit = 50
	}
	if input.Limit > 200 {
		input.Limit = 200
	}
	items, total, err := s.repo.ListItems(ctx, domain.CatalogItemFilter{
		BatchID: input.BatchID, SchoolID: input.SchoolID, CampusID: input.CampusID,
		CanteenID: input.CanteenID, WindowID: input.WindowID, Status: input.Status,
		Query: input.Query, Limit: input.Limit, Offset: (input.Page - 1) * input.Limit,
	})
	if err != nil {
		return nil, err
	}
	s.resolveItemImages(items)
	return &CatalogItemListResult{Items: items, Page: input.Page, Limit: input.Limit, Total: total}, nil
}

func (s *CatalogService) DeleteItem(ctx context.Context, adminID, itemID string) error {
	itemID = strings.TrimSpace(itemID)
	adminID = strings.TrimSpace(adminID)
	if itemID == "" {
		return badRequest("采集条目 ID 不能为空")
	}
	item, err := s.repo.FindItemByID(ctx, itemID)
	if err != nil {
		return err
	}
	if item == nil {
		return notFound("食堂采集条目不存在")
	}
	if item.Status == "analysis_pending" {
		return badRequest("AI 分析进行中，暂不能删除")
	}
	if err := s.repo.SoftDeleteItem(ctx, itemID); err != nil {
		logger.Error(ctx, "管理员删除校园菜品失败", err,
			slog.String("admin_id", adminID), slog.String("item_id", itemID))
		return err
	}
	logger.Info(ctx, "管理员删除校园菜品成功",
		slog.String("admin_id", adminID), slog.String("item_id", itemID))
	return nil
}

func (s *CatalogService) UpdateItem(ctx context.Context, adminID, itemID string, input UpdateCatalogItemInput) (*domain.CatalogItem, error) {
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return nil, badRequest("采集条目 ID 不能为空")
	}
	current, err := s.repo.FindItemByID(ctx, itemID)
	if err != nil {
		logger.Error(ctx, "读取待更新食堂采集条目失败", err,
			slog.String("admin_id", strings.TrimSpace(adminID)),
			slog.String("item_id", itemID),
		)
		return nil, err
	}
	if current == nil {
		return nil, notFound("食堂采集条目不存在")
	}
	if current.Status == "analysis_pending" {
		return nil, badRequest("AI 分析进行中，完成或失败后再编辑")
	}

	now := time.Now()
	batch := domain.CollectionBatch{
		ID:                  current.BatchID,
		SchoolID:            current.SchoolID,
		CampusID:            current.CampusID,
		CanteenID:           current.CanteenID,
		OrganizationName:    current.OrganizationName,
		AreaName:            current.AreaName,
		CanteenName:         current.CanteenName,
		DefaultWindowLayout: "unknown",
		DefaultServiceMode:  "unknown",
		CapturedAt:          current.CapturedAt,
	}
	updated, err := s.buildCatalogItem(batch, CreateCatalogItemInput(input), 0, strings.TrimSpace(adminID), now)
	if err != nil {
		return nil, err
	}
	updated.ID = current.ID
	updated.BatchID = current.BatchID
	switch current.Status {
	case "published", "changes_pending":
		updated.Status = "changes_pending"
	default:
		updated.Status = "draft"
	}
	updated.PublishedAt = current.PublishedAt
	updated.PublishedByAdminID = current.PublishedByAdminID
	updated.ContributorUserID = current.ContributorUserID
	updated.CreatedByAdminID = current.CreatedByAdminID
	updated.CreatedAt = current.CreatedAt
	updated.UpdatedAt = &now
	if updated.SourceFilename == "" {
		updated.SourceFilename = current.SourceFilename
	}

	if err := s.repo.UpdateItem(ctx, &updated); err != nil {
		logger.Error(ctx, "更新食堂采集条目失败", err,
			slog.String("admin_id", strings.TrimSpace(adminID)),
			slog.String("item_id", itemID),
			slog.String("batch_id", current.BatchID),
		)
		return nil, err
	}
	logger.Info(ctx, "食堂采集条目字段更新完成",
		slog.String("admin_id", strings.TrimSpace(adminID)),
		slog.String("item_id", itemID),
		slog.String("batch_id", current.BatchID),
		slog.Int("image_count", len(updated.ImagePaths)),
		slog.Int("missing_field_count", len(updated.MissingFields)),
	)
	result := updated
	items := []domain.CatalogItem{result}
	s.resolveItemImages(items)
	return &items[0], nil
}

func (s *CatalogService) PublishItem(ctx context.Context, adminID, itemID string) (*domain.CatalogItem, error) {
	itemID = strings.TrimSpace(itemID)
	adminID = strings.TrimSpace(adminID)
	if itemID == "" {
		return nil, badRequest("采集条目 ID 不能为空")
	}
	item, err := s.repo.FindItemByID(ctx, itemID)
	if err != nil {
		logger.Error(ctx, "读取待上线食堂采集条目失败", err,
			slog.String("admin_id", adminID), slog.String("item_id", itemID))
		return nil, err
	}
	if item == nil {
		return nil, notFound("食堂采集条目不存在")
	}
	if item.Status == "analysis_pending" {
		items := []domain.CatalogItem{*item}
		s.resolveItemImages(items)
		return &items[0], nil
	}
	if blockers := catalogPublishBlockingFields(item); len(blockers) > 0 {
		return nil, badRequest("请先补齐名称和价格后再提交上线")
	}
	if s.analyzeTasks == nil || s.analysisUsers == nil {
		return nil, fmt.Errorf("校园菜品 AI 分析服务未配置")
	}
	analysisUserID, err := s.analysisUsers.ResolveInternalAnalysisUserID(ctx, "campus_catalog", adminID)
	if err != nil {
		logger.Error(ctx, "解析校园菜品内部分析用户失败", err,
			slog.String("admin_id", adminID), slog.String("item_id", itemID))
		return nil, err
	}
	startedAt := time.Now()
	if err := s.repo.MarkAnalysisPending(ctx, item, adminID, startedAt); err != nil {
		logger.Error(ctx, "标记食堂采集条目等待 AI 分析失败", err,
			slog.String("admin_id", adminID), slog.String("item_id", itemID), slog.String("batch_id", item.BatchID))
		return nil, err
	}
	imageURLs := append([]string(nil), item.ImagePaths...)
	if s.storage != nil {
		imageURLs = s.storage.ResolveReferenceURLs("food-images", imageURLs)
	}
	// Campus dishes use the normal single-task analysis path. The worker keeps
	// the precise micronutrient publication gate below, so we avoid the former
	// plan -> item estimates -> aggregate fan-out without weakening nutrition.
	mode := "standard"
	extraPayload := map[string]any{
		"public_food_source_type":         "campus_public_food",
		"public_food_item_id":             item.ID,
		"campus_catalog_item_id":          item.ID,
		"micronutrient_analysis_required": true,
		"published_by_admin_id":           adminID,
		"food_name":                       item.Name,
		"school_name":                     item.OrganizationName,
		"campus_name":                     item.AreaName,
		"canteen_name":                    item.CanteenName,
		"floor":                           item.Floor,
		"window_name":                     item.WindowName,
	}
	contextText := catalogAnalysisContext(item)
	input := analyzeservice.SubmitTaskInput{
		ExecutionMode: &mode, SuggestRatioEnabled: true,
		AdditionalContext: contextText, ExtraPayload: extraPayload,
	}
	var taskID string
	var submitErr error
	if len(imageURLs) > 0 {
		input.ImageURLs = imageURLs
		input.SourceType = "image"
		input.ImageURL = imageURLs[0]
		taskID, submitErr = s.analyzeTasks.SubmitInternalAnalyzeTask(ctx, analysisUserID, input)
	} else {
		input.TextInput = contextText
		input.SourceType = "text"
		taskID, submitErr = s.analyzeTasks.SubmitInternalTextTask(ctx, analysisUserID, input)
	}
	if submitErr != nil {
		_ = s.repo.MarkAnalysisFailed(ctx, item.ID, submitErr.Error(), time.Now())
		logger.Error(ctx, "提交校园菜品 AI 分析任务失败", submitErr,
			slog.String("admin_id", adminID), slog.String("item_id", itemID), slog.String("batch_id", item.BatchID))
		return nil, submitErr
	}
	if err := s.repo.LinkAnalysisTask(ctx, item.ID, taskID); err != nil {
		_ = s.repo.MarkAnalysisFailed(ctx, item.ID, err.Error(), time.Now())
		return nil, err
	}
	item.Status = "analysis_pending"
	item.AnalysisTaskID = trimStringPtr(&taskID)
	item.AnalysisError = ""
	item.AnalysisStartedAt = &startedAt
	logger.Info(ctx, "食堂采集条目已提交 AI 分析",
		slog.String("admin_id", adminID), slog.String("item_id", itemID), slog.String("batch_id", item.BatchID),
		slog.String("analysis_task_id", taskID), slog.String("analysis_source_type", input.SourceType))
	items := []domain.CatalogItem{*item}
	s.resolveItemImages(items)
	return &items[0], nil
}

// SubmitPublishedNutritionBackfill reuses the normal catalog publish path so
// historical public items never bypass precise micronutrient analysis. Pending
// rows are excluded by the repository query, making startup retries idempotent.
func (s *CatalogService) SubmitPublishedNutritionBackfill(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		limit = 100
	}
	items, err := s.repo.ListPublishedItemsMissingNutrition(ctx, limit)
	if err != nil {
		return 0, err
	}
	logger.Info(ctx, "历史校园菜品营养补分析扫描完成", slog.Int("candidate_count", len(items)))
	queued := 0
	for index := range items {
		item := &items[index]
		if hideErr := s.repo.HidePublicItemForNutritionBackfill(ctx, item.ID); hideErr != nil {
			logger.Warn(ctx, "隐藏无有效营养的历史校园菜品失败",
				slog.String("item_id", item.ID), slog.String("food_name", item.Name), logger.Err(hideErr))
			continue
		}
		adminID := ""
		if item.PublishedByAdminID != nil {
			adminID = strings.TrimSpace(*item.PublishedByAdminID)
		}
		if _, submitErr := s.PublishItem(ctx, adminID, item.ID); submitErr != nil {
			_ = s.repo.MarkAnalysisFailed(ctx, item.ID, submitErr.Error(), time.Now())
			logger.Warn(ctx, "历史校园菜品营养补分析提交失败",
				slog.String("item_id", item.ID), slog.String("food_name", item.Name), logger.Err(submitErr))
			continue
		}
		queued++
	}
	return queued, nil
}

type LegacyAnalysisRepairSummary struct {
	Scanned   int
	Published int
	Retried   int
	Skipped   int
	Failed    int
}

type CurrentAnalysisRepairSummary struct {
	Scanned       int
	Published     int
	MarkedFailed  int
	OrphanRetried int
	Skipped       int
	Failed        int
}

type FailedAnalysisRetrySummary struct {
	Scanned  int
	Retried  int
	Skipped  int
	Failed   int
	Deferred bool
}

// RepairCurrentAnalysisTasks reconciles catalog rows whose current-pipeline
// task is already terminal, plus pending rows that no longer have a task. A
// valid done result is published directly; every other terminal result becomes
// a retryable failure. Orphans are resubmitted through the existing publish
// path so the queue can make progress again.
func (s *CatalogService) RepairCurrentAnalysisTasks(ctx context.Context, limit int) (CurrentAnalysisRepairSummary, error) {
	if limit <= 0 {
		limit = 100
	}
	candidates, err := s.repo.ListCurrentTerminalAnalysisCandidates(ctx, limit)
	if err != nil {
		return CurrentAnalysisRepairSummary{}, err
	}
	summary := CurrentAnalysisRepairSummary{Scanned: len(candidates)}
	for index := range candidates {
		candidate := &candidates[index]
		if candidate.TaskStatus == "done" {
			if completeErr := s.repo.CompleteAnalyzedItem(ctx, candidate.Item.ID, candidate.TaskID, candidate.TaskResult, time.Now()); completeErr == nil {
				summary.Published++
				continue
			}
		}

		reason := strings.TrimSpace(candidate.TaskError)
		if reason == "" {
			if candidate.TaskStatus == "done" {
				reason = "分析任务已完成，但营养结果未通过当前上线校验，准备重新分析"
			} else {
				reason = "分析任务已结束但未产出可上线结果，准备重新分析"
			}
		}
		claimed, claimErr := s.repo.MarkCurrentTerminalAnalysisFailed(ctx, candidate.Item.ID, candidate.TaskID, reason, time.Now())
		if claimErr != nil {
			summary.Failed++
			logger.Warn(ctx, "收敛校园菜品终态分析任务失败",
				slog.String("item_id", candidate.Item.ID), slog.String("analysis_task_id", candidate.TaskID), logger.Err(claimErr))
			continue
		}
		if !claimed {
			summary.Skipped++
			continue
		}
		summary.MarkedFailed++
	}

	staleBefore := time.Now().Add(-10 * time.Minute)
	orphanPendingCount, err := s.repo.CountOrphanPendingAnalysisCandidates(ctx, staleBefore)
	if err != nil {
		return summary, err
	}
	progress, err := s.repo.GetAnalysisProgress(ctx)
	if err != nil {
		return summary, err
	}
	if progress != nil && progress.StatusCounts["analysis_pending"] > orphanPendingCount {
		return summary, nil
	}
	orphanLimit := limit
	if orphanLimit > 20 {
		orphanLimit = 20
	}
	orphans, err := s.repo.ListOrphanAnalysisCandidates(ctx, staleBefore, orphanLimit)
	if err != nil {
		return summary, err
	}
	if len(orphans) == 0 {
		return summary, nil
	}
	if s.analyzeTasks == nil || s.analysisUsers == nil {
		return summary, fmt.Errorf("校园菜品 AI 分析服务未配置")
	}
	for index := range orphans {
		item := &orphans[index]
		claimed, claimErr := s.repo.ClaimOrphanAnalysis(ctx, item.ID, item.AnalysisTaskID, staleBefore, "分析任务缺失，已重新提交", time.Now())
		if claimErr != nil {
			summary.Failed++
			logger.Warn(ctx, "抢占无任务的校园菜品分析状态失败", slog.String("item_id", item.ID), logger.Err(claimErr))
			continue
		}
		if !claimed {
			summary.Skipped++
			continue
		}
		adminID := ""
		if item.PublishedByAdminID != nil {
			adminID = strings.TrimSpace(*item.PublishedByAdminID)
		}
		if _, publishErr := s.PublishItem(ctx, adminID, item.ID); publishErr != nil {
			summary.Failed++
			logger.Warn(ctx, "无任务的校园菜品重新提交失败", slog.String("item_id", item.ID), logger.Err(publishErr))
			continue
		}
		summary.OrphanRetried++
	}
	return summary, nil
}

// RetryFailedAnalysisTasks waits for the normal analysis queue to drain, then
// retries each failed current-pipeline task at most once through TaskService's
// existing internal retry path. The task is prepared as non-runnable, then the
// catalog link and task pending state are committed together before enqueue.
// retry_source_task_id keeps automatic retries to one round.
func (s *CatalogService) RetryFailedAnalysisTasks(ctx context.Context, limit int) (FailedAnalysisRetrySummary, error) {
	if limit <= 0 {
		limit = 20
	}
	progress, err := s.repo.GetAnalysisProgress(ctx)
	if err != nil {
		return FailedAnalysisRetrySummary{}, err
	}
	if progress != nil && progress.StatusCounts["analysis_pending"] > 0 {
		return FailedAnalysisRetrySummary{Deferred: true}, nil
	}
	if s.analyzeTasks == nil || s.analysisUsers == nil {
		return FailedAnalysisRetrySummary{}, fmt.Errorf("校园菜品 AI 分析服务未配置")
	}
	candidates, err := s.repo.ListFailedAnalysisRetryCandidates(ctx, limit)
	if err != nil {
		return FailedAnalysisRetrySummary{}, err
	}
	summary := FailedAnalysisRetrySummary{Scanned: len(candidates)}
	if len(candidates) == 0 {
		return summary, nil
	}
	analysisUserID, err := s.analysisUsers.ResolveInternalAnalysisUserID(ctx, "campus_catalog", "")
	if err != nil {
		return summary, err
	}
	for index := range candidates {
		item := &candidates[index]
		if item.AnalysisTaskID == nil || strings.TrimSpace(*item.AnalysisTaskID) == "" {
			summary.Skipped++
			continue
		}
		sourceTaskID := strings.TrimSpace(*item.AnalysisTaskID)
		retryResult, retryErr := s.analyzeTasks.PrepareInternalCampusRetryTask(ctx, sourceTaskID, analysisUserID, item.ID)
		if retryErr != nil {
			summary.Failed++
			logger.Warn(ctx, "校园菜品失败任务自动重试提交失败",
				slog.String("item_id", item.ID), slog.String("analysis_task_id", sourceTaskID), logger.Err(retryErr))
			continue
		}
		activated, activateErr := s.repo.ActivatePreparedAnalysisRetry(ctx, item.ID, sourceTaskID, retryResult.TaskID, time.Now())
		if activateErr != nil {
			summary.Failed++
			logger.Warn(ctx, "激活校园菜品自动重试任务失败",
				slog.String("item_id", item.ID), slog.String("analysis_task_id", retryResult.TaskID), logger.Err(activateErr))
			continue
		}
		if !activated {
			summary.Skipped++
			continue
		}
		if enqueueErr := s.analyzeTasks.EnqueuePreparedInternalTask(ctx, retryResult.TaskID, analysisUserID); enqueueErr != nil {
			// The task and catalog link are already durable and consistent. The
			// existing pending-task recovery loop will republish it.
			logger.Warn(ctx, "校园菜品自动重试任务等待队列恢复补发",
				slog.String("item_id", item.ID), slog.String("analysis_task_id", retryResult.TaskID), logger.Err(enqueueErr))
		}
		summary.Retried++
		logger.Info(ctx, "校园菜品失败任务已延后自动重试",
			slog.String("item_id", item.ID), slog.String("source_task_id", sourceTaskID), slog.String("analysis_task_id", retryResult.TaskID))
	}
	return summary, nil
}

func (s *CatalogService) TryAnalysisMaintenanceLeadership(ctx context.Context, fn func(context.Context) error) (bool, error) {
	return s.repo.TryAnalysisMaintenanceLeadership(ctx, fn)
}

// RepairLegacyAnalysisTasks converges catalog rows left behind by the retired
// precision plan/item/aggregate graph. A terminal aggregate result is first
// offered to the normal atomic publisher; anything incomplete or failed is
// claimed exactly once and resubmitted through PublishItem's current standard
// single-task path.
func (s *CatalogService) RepairLegacyAnalysisTasks(ctx context.Context, limit int) (LegacyAnalysisRepairSummary, error) {
	if limit <= 0 {
		limit = 20
	}
	progress, err := s.repo.GetAnalysisProgress(ctx)
	if err != nil {
		return LegacyAnalysisRepairSummary{}, err
	}
	deferFailed := progress != nil && progress.StatusCounts["analysis_pending"] > 0
	candidates, err := s.repo.ListLegacyTerminalAnalysisCandidates(ctx, limit)
	if err != nil {
		return LegacyAnalysisRepairSummary{}, err
	}
	summary := LegacyAnalysisRepairSummary{Scanned: len(candidates)}
	for index := range candidates {
		candidate := &candidates[index]
		if deferFailed && candidate.Item.Status == "analysis_failed" {
			summary.Skipped++
			continue
		}
		if candidate.TaskStatus == "done" && candidate.TaskType == "precision_aggregate" {
			if completeErr := s.repo.CompleteAnalyzedItem(ctx, candidate.Item.ID, candidate.TaskID, candidate.TaskResult, time.Now()); completeErr == nil {
				summary.Published++
				continue
			}
		}

		reason := strings.TrimSpace(candidate.TaskError)
		if reason == "" {
			reason = "旧版精准分析任务未产出可上线的完整营养结果，切换到普通分析路径重试"
		}
		claimed, claimErr := s.repo.ClaimLegacyAnalysisRetry(ctx, candidate.Item.ID, candidate.TaskID, reason, time.Now())
		if claimErr != nil {
			summary.Failed++
			logger.Warn(ctx, "抢占旧版校园菜品分析重试失败",
				slog.String("item_id", candidate.Item.ID), slog.String("analysis_task_id", candidate.TaskID), logger.Err(claimErr))
			continue
		}
		if !claimed {
			summary.Skipped++
			continue
		}
		adminID := ""
		if candidate.Item.PublishedByAdminID != nil {
			adminID = strings.TrimSpace(*candidate.Item.PublishedByAdminID)
		}
		if _, publishErr := s.PublishItem(ctx, adminID, candidate.Item.ID); publishErr != nil {
			summary.Failed++
			logger.Warn(ctx, "旧版校园菜品切换普通分析路径失败",
				slog.String("item_id", candidate.Item.ID), slog.String("legacy_task_id", candidate.TaskID), logger.Err(publishErr))
			continue
		}
		summary.Retried++
	}
	return summary, nil
}

func catalogAnalysisContext(item *domain.CatalogItem) string {
	if item == nil {
		return ""
	}
	parts := []string{
		"请重点分析这一个校园食堂菜品，不要把同一张菜单或照片中的其他菜品合并进来。",
		"菜品名称：" + strings.TrimSpace(item.Name),
		"学校：" + strings.TrimSpace(item.OrganizationName),
		"食堂：" + strings.TrimSpace(item.CanteenName),
		"窗口：" + strings.TrimSpace(item.WindowName),
		"价格原文：" + strings.TrimSpace(item.PriceText),
		"分量：" + strings.TrimSpace(item.PortionDescription),
		"采集原文：" + strings.TrimSpace(item.RawText),
	}
	return strings.Join(nonEmptyStrings(parts...), "；")
}

func catalogPublishBlockingFields(item *domain.CatalogItem) []string {
	if item == nil {
		return []string{"name", "price"}
	}
	seen := map[string]struct{}{}
	blocking := make([]string, 0, len(item.MissingFields)+2)
	add := func(field string) {
		if _, exists := seen[field]; exists {
			return
		}
		seen[field] = struct{}{}
		blocking = append(blocking, field)
	}
	for _, field := range item.MissingFields {
		if strings.TrimSpace(field) == "" || field == "image" {
			continue
		}
		add(field)
	}
	if strings.TrimSpace(item.Name) == "" {
		add("name")
	}
	hasPrice := item.Price != nil || item.PriceMin != nil || item.PriceMax != nil || strings.TrimSpace(item.PriceText) != "" || len(item.PriceOptions) > 0
	if item.PriceType == "unknown" || !hasPrice {
		add("price")
	}
	sort.Strings(blocking)
	return blocking
}

func (s *CatalogService) buildCatalogItem(batch domain.CollectionBatch, input CreateCatalogItemInput, index int, adminID string, now time.Time) (domain.CatalogItem, error) {
	entryType, ok := normalizeEnum(input.EntryType, "dish", entryTypes)
	if !ok {
		return domain.CatalogItem{}, badRequest(fmt.Sprintf("第 %d 条记录类型不正确", index+1))
	}
	serviceMode, ok := normalizeEnum(input.ServiceMode, batch.DefaultServiceMode, serviceModes)
	if !ok {
		return domain.CatalogItem{}, badRequest(fmt.Sprintf("第 %d 条售卖形式不正确", index+1))
	}
	windowLayout, ok := normalizeEnum(input.WindowLayout, batch.DefaultWindowLayout, windowLayouts)
	if !ok {
		return domain.CatalogItem{}, badRequest(fmt.Sprintf("第 %d 条窗口形态不正确", index+1))
	}
	imageKind, ok := normalizeEnum(input.ImageKind, "dish", imageKinds)
	if !ok {
		return domain.CatalogItem{}, badRequest(fmt.Sprintf("第 %d 条图片证据类型不正确", index+1))
	}
	priceType, ok := normalizeEnum(input.PriceType, "unknown", priceTypes)
	if !ok {
		return domain.CatalogItem{}, badRequest(fmt.Sprintf("第 %d 条计价方式不正确", index+1))
	}
	if priceType == "range" {
		if input.PriceMin == nil || input.PriceMax == nil || *input.PriceMin < 0 || *input.PriceMax < *input.PriceMin {
			return domain.CatalogItem{}, badRequest(fmt.Sprintf("第 %d 条价格区间不正确", index+1))
		}
	}
	if input.Price != nil && *input.Price < 0 {
		return domain.CatalogItem{}, badRequest(fmt.Sprintf("第 %d 条价格不能为负数", index+1))
	}
	mealValues := input.MealPeriods
	if len(mealValues) == 0 {
		mealValues = batch.DefaultMealPeriods
	}
	mealValues, err := normalizeStringEnums(mealValues, mealPeriods)
	if err != nil {
		return domain.CatalogItem{}, badRequest(fmt.Sprintf("第 %d 条餐时不正确", index+1))
	}
	weekdays, err := normalizeStringEnums(input.AvailableWeekdays, weekdayValues)
	if err != nil {
		return domain.CatalogItem{}, badRequest(fmt.Sprintf("第 %d 条营业日期不正确", index+1))
	}
	imagePaths, err := s.normalizeImageKeys(input.ImagePaths)
	if err != nil {
		return domain.CatalogItem{}, badRequest(fmt.Sprintf("第 %d 条图片地址不属于食堂采集图库", index+1))
	}
	if len(imagePaths) > maxImagesPerItem {
		return domain.CatalogItem{}, badRequest(fmt.Sprintf("第 %d 条最多关联 %d 张图片", index+1, maxImagesPerItem))
	}
	name := strings.TrimSpace(input.Name)
	floor := firstNonEmpty(strings.TrimSpace(input.Floor), batch.DefaultFloor)
	windowName := firstNonEmpty(strings.TrimSpace(input.WindowName), batch.DefaultWindowName)
	windowID := trimStringPtr(input.WindowID)
	if windowID == nil {
		windowID = batch.DefaultWindowID
	}
	if entryType == "stall_overview" && name == "" {
		name = firstNonEmpty(windowName, batch.CanteenName+"窗口概览")
	}
	missing := missingFields(name, imagePaths, priceType, input)
	completeness := "complete"
	if len(missing) > 0 {
		completeness = "incomplete"
	}
	priceOptions := input.PriceOptions
	if priceOptions == nil {
		priceOptions = map[string]any{}
	}
	return domain.CatalogItem{
		ID:                 uuid.NewString(),
		BatchID:            batch.ID,
		EntryType:          entryType,
		Name:               name,
		Description:        strings.TrimSpace(input.Description),
		SchoolID:           batch.SchoolID,
		CampusID:           batch.CampusID,
		CanteenID:          batch.CanteenID,
		WindowID:           windowID,
		OrganizationName:   batch.OrganizationName,
		AreaName:           batch.AreaName,
		CanteenName:        batch.CanteenName,
		Floor:              floor,
		WindowName:         windowName,
		WindowLayout:       windowLayout,
		MealPeriods:        mealValues,
		AvailableWeekdays:  weekdays,
		AvailabilityNote:   strings.TrimSpace(input.AvailabilityNote),
		ServiceMode:        serviceMode,
		PriceType:          priceType,
		Price:              input.Price,
		PriceMin:           input.PriceMin,
		PriceMax:           input.PriceMax,
		PriceUnit:          normalizeStoredPriceUnit(input.PriceUnit),
		PriceText:          strings.TrimSpace(input.PriceText),
		PriceOptions:       priceOptions,
		PortionDescription: strings.TrimSpace(input.PortionDescription),
		ImagePaths:         imagePaths,
		ImageKind:          imageKind,
		SourceFilename:     strings.TrimSpace(input.SourceFilename),
		RawText:            strings.TrimSpace(input.RawText),
		Notes:              strings.TrimSpace(input.Notes),
		MissingFields:      missing,
		CompletenessStatus: completeness,
		Status:             "draft",
		CapturedAt:         batch.CapturedAt,
		CreatedByAdminID:   trimStringPtr(&adminID),
		CreatedAt:          &now,
		UpdatedAt:          &now,
	}, nil
}

func normalizeStoredPriceUnit(value string) string {
	unit := strings.TrimSpace(value)
	unit = strings.ReplaceAll(unit, "￥", "元")
	unit = strings.ReplaceAll(unit, "¥", "元")
	if unit == "" || unit == "元" || strings.HasPrefix(unit, "元/") {
		return unit
	}
	if strings.HasPrefix(unit, "元") {
		unit = strings.TrimSpace(strings.TrimPrefix(unit, "元"))
		unit = strings.TrimPrefix(unit, "/")
	}
	if unit == "" {
		return "元"
	}
	return "元/" + unit
}

func (s *CatalogService) normalizeImageKeys(values []string) ([]string, error) {
	seen := map[string]struct{}{}
	keys := make([]string, 0, len(values))
	for _, value := range values {
		raw := strings.TrimSpace(value)
		if raw == "" {
			continue
		}
		key := raw
		if s.storage != nil {
			key = s.storage.ResolveObjectKey("food-images", raw)
			if key == "" && strings.Contains(raw, "://") {
				return nil, fmt.Errorf("untrusted image url")
			}
		}
		key = strings.TrimLeft(strings.TrimSpace(key), "/")
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		keys = append(keys, key)
	}
	return keys, nil
}

func (s *CatalogService) resolveItemImages(items []domain.CatalogItem) {
	if s.storage == nil {
		return
	}
	for i := range items {
		items[i].ImagePaths = s.storage.ResolveReferenceURLs("food-images", items[i].ImagePaths)
	}
}

func missingFields(name string, imagePaths []string, priceType string, input CreateCatalogItemInput) []string {
	missing := make([]string, 0, 3)
	if name == "" {
		missing = append(missing, "name")
	}
	if len(imagePaths) == 0 {
		missing = append(missing, "image")
	}
	hasPrice := input.Price != nil || input.PriceMin != nil || input.PriceMax != nil || strings.TrimSpace(input.PriceText) != "" || len(input.PriceOptions) > 0
	if priceType == "unknown" || !hasPrice {
		missing = append(missing, "price")
	}
	sort.Strings(missing)
	return missing
}

func imageExtension(contentType, filename string) string {
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/heic", "image/heif":
		return ".heic"
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == ".jpg" || ext == ".jpeg" || ext == ".png" || ext == ".webp" || ext == ".heic" || ext == ".heif" {
		if detected := mime.TypeByExtension(ext); strings.HasPrefix(detected, "image/") {
			return ext
		}
	}
	return ""
}

func normalizeEnum(value, fallback string, allowed map[string]struct{}) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		normalized = fallback
	}
	_, ok := allowed[normalized]
	return normalized, ok
}

func normalizeStringEnums(values []string, allowed map[string]struct{}) ([]string, error) {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized == "" {
			continue
		}
		if _, ok := allowed[normalized]; !ok {
			return nil, badRequest("枚举值不正确")
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	return out, nil
}

func trimStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func nonEmptyStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func badRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: 400}
}

func appError(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: 503}
}

func notFound(message string) error {
	return &commonerrors.AppError{Code: 10001, Message: message, HTTPStatus: 404}
}

var venueTypes = enumSet("university", "office_park", "corporate", "community", "other")
var entryTypes = enumSet("dish", "menu_item", "stall_overview", "combo", "ingredient")
var serviceModes = enumSet("fixed_portion", "self_select", "combo", "by_weight", "malatang", "buffet", "made_to_order", "retail", "mixed", "unknown")
var windowLayouts = enumSet("small", "standard", "large", "continuous_counter", "unknown")
var mealPeriods = enumSet("breakfast", "lunch", "afternoon", "dinner", "late_night", "all_day", "unknown")
var weekdayValues = enumSet("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
var priceTypes = enumSet("fixed", "range", "by_weight", "combo", "market", "freeform", "unknown")
var imageKinds = enumSet("dish", "menu_board", "stall_front", "price_tag", "ingredient_display", "receipt", "other")

func enumSet(values ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}
