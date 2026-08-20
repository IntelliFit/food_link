package service

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/nutrition"
	"food_link/backend/internal/supplement/domain"
	"food_link/backend/internal/supplement/repo"
	"food_link/backend/pkg/logger"

	"gorm.io/gorm"
)

var scheduleTimePattern = regexp.MustCompile(`^(?:[01]\d|2[0-3]):[0-5]\d$`)

type SupplementService struct {
	repo *repo.SupplementRepo
}

func NewSupplementService(repo *repo.SupplementRepo) *SupplementService {
	return &SupplementService{repo: repo}
}

type UpsertInput struct {
	Name            string
	Brand           string
	Barcode         *string
	ImageURL        *string
	DefaultServings float64
	ServingLabel    string
	ScheduleEnabled bool
	ScheduleTime    *string
	ScheduleDays    []int
	Components      []domain.Component
	LabelConfirmed  bool
	Status          string
}

type RecordInput struct {
	Servings       float64
	TakenAt        *time.Time
	Note           *string
	Source         string
	IdempotencyKey string
}

type ComponentTotal struct {
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	Category string  `json:"category"`
	Amount   float64 `json:"amount"`
	Unit     string  `json:"unit"`
	Form     string  `json:"form,omitempty"`
}

type componentAccumulator struct {
	ComponentTotal
	products map[string]bool
}

type DashboardResult struct {
	Date                 string                    `json:"date"`
	PlannedCount         int                       `json:"planned_count"`
	CompletedCount       int                       `json:"completed_count"`
	PendingSupplement    *domain.UserSupplement    `json:"pending_supplement,omitempty"`
	Supplements          []domain.UserSupplement   `json:"supplements"`
	Intakes              []domain.SupplementIntake `json:"intakes"`
	NutrientTotals       map[string]float64        `json:"nutrient_totals"`
	AdditionalNutrients  []ComponentTotal          `json:"additional_nutrients"`
	FunctionalComponents []ComponentTotal          `json:"functional_components"`
	DuplicateComponents  []string                  `json:"duplicate_components"`
}

func (s *SupplementService) List(ctx context.Context, userID, status string) ([]domain.UserSupplement, error) {
	if strings.TrimSpace(status) == "" {
		status = "active"
	}
	return s.repo.List(ctx, userID, status)
}

func (s *SupplementService) ListCatalog(ctx context.Context, query string) ([]domain.SupplementCatalogItem, error) {
	items, err := s.repo.ListCatalog(ctx, query)
	if err != nil {
		logger.Error(ctx, "查询公共补剂库失败", err, slog.String("query", strings.TrimSpace(query)))
		return nil, err
	}
	return items, nil
}

func (s *SupplementService) Create(ctx context.Context, userID string, input UpsertInput) (*domain.UserSupplement, error) {
	item, err := buildSupplement(userID, input)
	if err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, item); err != nil {
		logger.Error(ctx, "创建补剂柜条目失败", err, slog.String("user_id", userID))
		return nil, err
	}
	logger.Info(ctx, "补剂已加入补剂柜", slog.String("user_id", userID), slog.String("supplement_id", item.ID), slog.Int("component_count", len(item.Components)))
	return item, nil
}

func (s *SupplementService) Update(ctx context.Context, userID, itemID string, input UpsertInput) (*domain.UserSupplement, error) {
	current, err := s.repo.Get(ctx, userID, itemID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, commonerrors.ErrNotFound
	}
	item, err := buildSupplement(userID, input)
	if err != nil {
		return nil, err
	}
	updates := map[string]any{
		"name": item.Name, "brand": item.Brand, "barcode": item.Barcode, "image_url": item.ImageURL,
		"default_servings": item.DefaultServings, "serving_label": item.ServingLabel,
		"schedule_enabled": item.ScheduleEnabled, "schedule_time": item.ScheduleTime,
		"schedule_days": item.ScheduleDays, "components": item.Components, "status": item.Status,
	}
	if item.LabelConfirmedAt != nil {
		updates["label_confirmed_at"] = item.LabelConfirmedAt
	}
	updated, err := s.repo.Update(ctx, userID, itemID, updates)
	if err != nil {
		logger.Error(ctx, "更新补剂柜条目失败", err, slog.String("user_id", userID), slog.String("supplement_id", itemID))
		return nil, err
	}
	if updated == nil {
		return nil, commonerrors.ErrNotFound
	}
	logger.Info(ctx, "补剂柜条目已更新", slog.String("user_id", userID), slog.String("supplement_id", itemID), slog.Int("component_count", len(updated.Components)))
	return updated, nil
}

func (s *SupplementService) Record(ctx context.Context, userID, itemID string, input RecordInput) (*domain.SupplementIntake, error) {
	if key := strings.TrimSpace(input.IdempotencyKey); key != "" {
		existing, err := s.repo.FindIntakeByIdempotencyKey(ctx, userID, key)
		if err != nil {
			return nil, err
		}
		if existing != nil {
			return existing, nil
		}
	}
	item, err := s.repo.Get(ctx, userID, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil || item.Status != "active" {
		return nil, commonerrors.ErrNotFound
	}
	servings := input.Servings
	if servings <= 0 {
		servings = item.DefaultServings
	}
	if servings <= 0 || servings > 100 {
		return nil, badRequest("服用份数必须大于 0 且不超过 100")
	}
	takenAt := time.Now()
	if input.TakenAt != nil && !input.TakenAt.IsZero() {
		takenAt = *input.TakenAt
	}
	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = "quick_log"
	}
	var idempotencyKey *string
	if key := strings.TrimSpace(input.IdempotencyKey); key != "" {
		idempotencyKey = &key
	}
	intake := &domain.SupplementIntake{
		UserID: userID, SupplementID: item.ID, SupplementName: item.Name,
		Servings: servings, ServingLabel: item.ServingLabel, ComponentsSnapshot: cloneComponents(item.Components),
		TakenAt: takenAt, Source: source, Note: input.Note, IdempotencyKey: idempotencyKey,
	}
	if err := s.repo.CreateIntake(ctx, intake); err != nil {
		logger.Error(ctx, "记录补剂摄入失败", err, slog.String("user_id", userID), slog.String("supplement_id", itemID))
		return nil, err
	}
	logger.Info(ctx, "补剂摄入已记录", slog.String("user_id", userID), slog.String("supplement_id", itemID), slog.String("intake_id", intake.ID), slog.Float64("servings", servings))
	return intake, nil
}

func (s *SupplementService) DeleteIntake(ctx context.Context, userID, intakeID string) error {
	deleted, err := s.repo.DeleteIntake(ctx, userID, intakeID)
	if err != nil {
		return err
	}
	if !deleted {
		return commonerrors.ErrNotFound
	}
	logger.Info(ctx, "补剂摄入记录已删除", slog.String("user_id", userID), slog.String("intake_id", intakeID))
	return nil
}

func (s *SupplementService) Dashboard(ctx context.Context, userID, date string) (*DashboardResult, error) {
	date, start, end, err := chinaDateWindow(date)
	if err != nil {
		return nil, err
	}
	supplements, err := s.repo.List(ctx, userID, "active")
	if err != nil {
		return nil, err
	}
	intakes, err := s.repo.ListIntakes(ctx, userID, start, end)
	if err != nil {
		return nil, err
	}
	result := buildDashboard(date, start, supplements, intakes)
	return &result, nil
}

// HomeSnapshot is intentionally generic so the home module can consume the
// supplement ledger without creating a package dependency cycle.
func (s *SupplementService) HomeSnapshot(ctx context.Context, userID, date string) (map[string]float64, map[string]any, error) {
	result, err := s.Dashboard(ctx, userID, date)
	if err != nil {
		if isUndefinedTableError(err) {
			return map[string]float64{}, emptyHomeSummary(), nil
		}
		return nil, nil, err
	}
	return result.NutrientTotals, map[string]any{
		"date":                  result.Date,
		"planned_count":         result.PlannedCount,
		"completed_count":       result.CompletedCount,
		"pending_supplement":    result.PendingSupplement,
		"functional_components": result.FunctionalComponents,
		"additional_nutrients":  result.AdditionalNutrients,
		"duplicate_components":  result.DuplicateComponents,
	}, nil
}

func buildSupplement(userID string, input UpsertInput) (*domain.UserSupplement, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, badRequest("补剂名称不能为空")
	}
	servings := input.DefaultServings
	if servings <= 0 {
		servings = 1
	}
	if servings > 100 {
		return nil, badRequest("默认份数不能超过 100")
	}
	components, err := normalizeComponents(input.Components)
	if err != nil {
		return nil, err
	}
	if len(components) == 0 {
		return nil, badRequest("请至少填写 1 项营养素或功能成分")
	}
	scheduleDays, err := normalizeScheduleDays(input.ScheduleDays)
	if err != nil {
		return nil, err
	}
	var scheduleTime *string
	if input.ScheduleTime != nil && strings.TrimSpace(*input.ScheduleTime) != "" {
		value := strings.TrimSpace(*input.ScheduleTime)
		if !scheduleTimePattern.MatchString(value) {
			return nil, badRequest("计划时间格式应为 HH:mm")
		}
		scheduleTime = &value
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = "active"
	}
	if status != "active" && status != "archived" {
		return nil, badRequest("补剂状态无效")
	}
	servingLabel := strings.TrimSpace(input.ServingLabel)
	if servingLabel == "" {
		servingLabel = fmt.Sprintf("%g份", servings)
	}
	now := time.Now()
	var confirmedAt *time.Time
	if input.LabelConfirmed {
		confirmedAt = &now
	}
	return &domain.UserSupplement{
		UserID: userID, Name: name, Brand: strings.TrimSpace(input.Brand), Barcode: cleanOptional(input.Barcode),
		ImageURL: cleanOptional(input.ImageURL), DefaultServings: servings, ServingLabel: servingLabel,
		ScheduleEnabled: input.ScheduleEnabled, ScheduleTime: scheduleTime, ScheduleDays: scheduleDays,
		Components: components, LabelConfirmedAt: confirmedAt, Status: status,
	}, nil
}

func normalizeComponents(input []domain.Component) ([]domain.Component, error) {
	if len(input) > 80 {
		return nil, badRequest("补剂成分不能超过 80 项")
	}
	knownNutrients := map[string]bool{}
	for _, cfg := range nutrition.MicroNutrientConfigs {
		knownNutrients[cfg.Key] = true
	}
	out := make([]domain.Component, 0, len(input))
	for _, item := range input {
		item.Name = strings.TrimSpace(item.Name)
		item.Code = normalizeCode(item.Code, item.Name)
		item.Category = strings.TrimSpace(item.Category)
		item.Unit = strings.TrimSpace(item.Unit)
		item.Form = strings.TrimSpace(item.Form)
		item.NutrientKey = strings.TrimSpace(item.NutrientKey)
		if item.Name == "" || item.Code == "" || item.Amount <= 0 || item.Unit == "" {
			return nil, badRequest("每项成分都必须填写名称、含量和单位")
		}
		switch item.Category {
		case domain.ComponentCategoryNutrient:
			if item.NutrientKey != "" && !knownNutrients[item.NutrientKey] {
				return nil, badRequest("营养素映射不存在")
			}
		case domain.ComponentCategoryFunctional, domain.ComponentCategoryBlend:
			item.NutrientKey = ""
		default:
			return nil, badRequest("成分类型无效")
		}
		out = append(out, item)
	}
	return out, nil
}

func buildDashboard(date string, day time.Time, supplements []domain.UserSupplement, intakes []domain.SupplementIntake) DashboardResult {
	result := DashboardResult{
		Date: date, Supplements: supplements, Intakes: intakes,
		NutrientTotals: map[string]float64{}, AdditionalNutrients: []ComponentTotal{},
		FunctionalComponents: []ComponentTotal{}, DuplicateComponents: []string{},
	}
	completed := map[string]bool{}
	for _, intake := range intakes {
		completed[intake.SupplementID] = true
	}
	for i := range supplements {
		item := &supplements[i]
		if !scheduledOn(*item, day) {
			continue
		}
		result.PlannedCount++
		if completed[item.ID] {
			result.CompletedCount++
		} else if result.PendingSupplement == nil {
			copyItem := *item
			result.PendingSupplement = &copyItem
		}
	}

	additional := map[string]*componentAccumulator{}
	functional := map[string]*componentAccumulator{}
	componentProducts := map[string]map[string]bool{}
	componentNames := map[string]string{}
	for _, intake := range intakes {
		for _, component := range intake.ComponentsSnapshot {
			amount := round3(component.Amount * intake.Servings)
			duplicateKey := component.Category + "|" + component.Code
			if component.Category == domain.ComponentCategoryNutrient && component.NutrientKey != "" {
				duplicateKey = component.Category + "|" + component.NutrientKey
			}
			if componentProducts[duplicateKey] == nil {
				componentProducts[duplicateKey] = map[string]bool{}
			}
			componentProducts[duplicateKey][intake.SupplementID] = true
			componentNames[duplicateKey] = component.Name
			if component.Category == domain.ComponentCategoryNutrient && component.NutrientKey != "" {
				result.NutrientTotals[component.NutrientKey] = round3(result.NutrientTotals[component.NutrientKey] + amount)
				continue
			}
			target := functional
			if component.Category == domain.ComponentCategoryNutrient {
				target = additional
			}
			key := component.Category + "|" + component.Code + "|" + strings.ToLower(component.Unit) + "|" + component.Form
			entry := target[key]
			if entry == nil {
				entry = &componentAccumulator{ComponentTotal: ComponentTotal{Code: component.Code, Name: component.Name, Category: component.Category, Unit: component.Unit, Form: component.Form}, products: map[string]bool{}}
				target[key] = entry
			}
			entry.Amount = round3(entry.Amount + amount)
			entry.products[intake.SupplementID] = true
		}
	}
	duplicates := map[string]bool{}
	for key, products := range componentProducts {
		if len(products) > 1 {
			duplicates[componentNames[key]] = true
		}
	}
	result.AdditionalNutrients = sortedTotals(additional)
	result.FunctionalComponents = sortedTotals(functional)
	for name := range duplicates {
		result.DuplicateComponents = append(result.DuplicateComponents, name)
	}
	sort.Strings(result.DuplicateComponents)
	return result
}

func sortedTotals(input map[string]*componentAccumulator) []ComponentTotal {
	result := make([]ComponentTotal, 0, len(input))
	for _, item := range input {
		result = append(result, item.ComponentTotal)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Category != result[j].Category {
			return result[i].Category < result[j].Category
		}
		if result[i].Name != result[j].Name {
			return result[i].Name < result[j].Name
		}
		return result[i].Unit < result[j].Unit
	})
	return result
}

func scheduledOn(item domain.UserSupplement, day time.Time) bool {
	if !item.ScheduleEnabled {
		return false
	}
	if len(item.ScheduleDays) == 0 {
		return true
	}
	weekday := int(day.Weekday())
	for _, value := range item.ScheduleDays {
		if value == weekday {
			return true
		}
	}
	return false
}

func normalizeScheduleDays(values []int) ([]int, error) {
	seen := map[int]bool{}
	out := make([]int, 0, len(values))
	for _, value := range values {
		if value < 0 || value > 6 {
			return nil, badRequest("计划星期必须在 0 到 6 之间")
		}
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Ints(out)
	return out, nil
}

func chinaDateWindow(raw string) (string, time.Time, time.Time, error) {
	location := time.FixedZone("Asia/Shanghai", 8*60*60)
	value := strings.TrimSpace(raw)
	if value == "" {
		value = time.Now().In(location).Format("2006-01-02")
	}
	start, err := time.ParseInLocation("2006-01-02", value, location)
	if err != nil {
		return "", time.Time{}, time.Time{}, badRequest("日期格式应为 YYYY-MM-DD")
	}
	return value, start, start.AddDate(0, 0, 1), nil
}

func cleanOptional(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func cloneComponents(items []domain.Component) []domain.Component {
	out := make([]domain.Component, len(items))
	copy(out, items)
	return out
}

func normalizeCode(code, fallback string) string {
	value := strings.ToLower(strings.TrimSpace(code))
	if value == "" {
		value = strings.ToLower(strings.TrimSpace(fallback))
	}
	value = strings.NewReplacer(" ", "_", "-", "_", "/", "_").Replace(value)
	return value
}

func badRequest(message string) error {
	return &commonerrors.AppError{Code: commonerrors.ErrBadRequest.Code, Message: message, HTTPStatus: http.StatusBadRequest}
}

func round3(value float64) float64 {
	return float64(int64(value*1000+0.5)) / 1000
}

func emptyHomeSummary() map[string]any {
	return map[string]any{"planned_count": 0, "completed_count": 0, "functional_components": []ComponentTotal{}, "additional_nutrients": []ComponentTotal{}, "duplicate_components": []string{}}
}

func isUndefinedTableError(err error) bool {
	if err == nil {
		return false
	}
	if err == gorm.ErrRecordNotFound {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "42p01") || strings.Contains(message, "no such table") || strings.Contains(message, "does not exist")
}
