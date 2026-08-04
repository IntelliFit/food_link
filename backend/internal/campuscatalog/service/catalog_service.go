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
	FindItemByID(ctx context.Context, itemID string) (*domain.CatalogItem, error)
	UpdateItem(ctx context.Context, item *domain.CatalogItem) error
}

type CatalogService struct {
	repo    CatalogRepository
	storage *storage.Client
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
	updated.Status = current.Status
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
		PriceUnit:          strings.TrimSpace(input.PriceUnit),
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
