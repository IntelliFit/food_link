package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	"food_link/backend/internal/campuscatalog/domain"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
)

type communityRepository interface {
	ApplyRevision(ctx context.Context, item *domain.CatalogItem, revision *domain.Revision) error
	ListRevisions(ctx context.Context, itemID string, limit, offset int) ([]domain.Revision, int64, error)
	FindRevisionByID(ctx context.Context, itemID, revisionID string) (*domain.Revision, error)
	GetCampusDirectoryRef(ctx context.Context, schoolID, campusID, canteenID, windowID string) (*domain.DirectoryRef, error)
	HasActiveCollectorScope(ctx context.Context, userID, schoolID, campusID, canteenID string, now time.Time) (bool, error)
	LinkCommunityAnalysisTask(ctx context.Context, itemID string, targetVersion int64, taskID string, linkedAt time.Time) (bool, error)
	MarkCommunityAnalysisFailed(ctx context.Context, itemID string, targetVersion int64, message string, failedAt time.Time) error
}

type CorrectionInput struct {
	BaseVersion        int64          `json:"base_version"`
	Patch              map[string]any `json:"patch"`
	EvidenceImagePaths []string       `json:"evidence_image_paths"`
	Reason             string         `json:"reason"`
}

type CorrectionResult struct {
	Item             domain.CatalogItem `json:"item"`
	Revision         domain.Revision    `json:"revision"`
	ReanalysisQueued bool               `json:"reanalysis_queued"`
}

type RevisionListResult struct {
	Items []domain.Revision `json:"items"`
	Page  int               `json:"page"`
	Limit int               `json:"limit"`
	Total int64             `json:"total"`
}

type collectorRepository interface {
	communityRepository
	FindCollectorApplication(ctx context.Context, userID, schoolID, campusID, canteenID string, statuses []string) (*domain.CollectorApplication, error)
	CreateCollectorApplication(ctx context.Context, application *domain.CollectorApplication) error
	ListCollectorApplications(ctx context.Context, userID, status string, limit, offset int) ([]domain.CollectorApplication, int64, error)
	ListCollectorScopes(ctx context.Context, userID string, activeOnly bool) ([]domain.CollectorScope, error)
	ReviewCollectorApplication(ctx context.Context, applicationID, adminID, status, note string, expiresAt *time.Time, reviewedAt time.Time) (*domain.CollectorApplication, *domain.CollectorScope, error)
}

type CollectorApplicationInput struct {
	SchoolID      string  `json:"school_id"`
	CampusID      *string `json:"campus_id"`
	CanteenID     *string `json:"canteen_id"`
	ApplicantNote string  `json:"applicant_note"`
}

type CollectorProfile struct {
	Applications []domain.CollectorApplication `json:"applications"`
	ActiveScopes []domain.CollectorScope       `json:"active_scopes"`
	CanBatch     bool                          `json:"can_batch"`
}

type CollectorApplicationListResult struct {
	Items []domain.CollectorApplication `json:"items"`
	Page  int                           `json:"page"`
	Limit int                           `json:"limit"`
	Total int64                         `json:"total"`
}

type ReviewCollectorApplicationInput struct {
	Status    string     `json:"status"`
	Note      string     `json:"note"`
	ExpiresAt *time.Time `json:"expires_at"`
}

type ReviewCollectorApplicationResult struct {
	Application domain.CollectorApplication `json:"application"`
	Scope       *domain.CollectorScope      `json:"scope,omitempty"`
}

type RollbackInput struct {
	BaseVersion int64  `json:"base_version"`
	Reason      string `json:"reason"`
}

func (s *CatalogService) ApplyCollector(ctx context.Context, userID string, input CollectorApplicationInput) (*domain.CollectorApplication, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	repo, ok := s.repo.(collectorRepository)
	if !ok {
		return nil, appError("校园采集员申请服务未配置")
	}
	schoolID, campusID, canteenID := strings.TrimSpace(input.SchoolID), pointerValue(input.CampusID), pointerValue(input.CanteenID)
	if schoolID == "" {
		return nil, badRequest("请选择申请采集的学校")
	}
	if _, err := uuid.Parse(schoolID); err != nil {
		return nil, badRequest("学校 ID 格式不正确")
	}
	ref, err := repo.GetCampusDirectoryRef(ctx, schoolID, campusID, canteenID, "")
	if err != nil {
		return nil, err
	}
	if ref == nil || ref.SchoolID == "" || (campusID != "" && ref.CampusID == "") || (canteenID != "" && ref.CanteenID == "") {
		return nil, badRequest("申请范围必须来自已启用的校园目录")
	}
	// Only a pending application suppresses another submission. An old approved
	// application may have an expired scope, in which case the user must be able
	// to apply for a fresh authorization without deleting audit history.
	if existing, findErr := repo.FindCollectorApplication(ctx, userID, ref.SchoolID, ref.CampusID, ref.CanteenID, []string{"pending"}); findErr != nil {
		return nil, findErr
	} else if existing != nil {
		return existing, nil
	}
	note := strings.TrimSpace(input.ApplicantNote)
	if len([]rune(note)) > 500 {
		return nil, badRequest("申请说明最多 500 个字")
	}
	now := time.Now()
	application := &domain.CollectorApplication{
		ID: uuid.NewString(), UserID: userID, SchoolID: ref.SchoolID,
		CampusID: stringPointer(ref.CampusID), CanteenID: stringPointer(ref.CanteenID),
		ApplicantNote: note, Status: "pending", CreatedAt: &now, UpdatedAt: &now,
	}
	if err := repo.CreateCollectorApplication(ctx, application); err != nil {
		logger.Error(ctx, "提交校园采集员申请失败", err,
			slog.String("user_id", userID), slog.String("school_id", ref.SchoolID))
		return nil, err
	}
	logger.Info(ctx, "校园采集员申请已提交", slog.String("user_id", userID), slog.String("application_id", application.ID), slog.String("school_id", ref.SchoolID))
	return application, nil
}

func (s *CatalogService) GetCollectorProfile(ctx context.Context, userID string) (*CollectorProfile, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	repo, ok := s.repo.(collectorRepository)
	if !ok {
		return nil, appError("校园采集员服务未配置")
	}
	applications, _, err := repo.ListCollectorApplications(ctx, userID, "all", 100, 0)
	if err != nil {
		return nil, err
	}
	scopes, err := repo.ListCollectorScopes(ctx, userID, true)
	if err != nil {
		return nil, err
	}
	return &CollectorProfile{Applications: applications, ActiveScopes: scopes, CanBatch: len(scopes) > 0}, nil
}

func (s *CatalogService) ListCollectorApplications(ctx context.Context, status string, page, limit int) (*CollectorApplicationListResult, error) {
	repo, ok := s.repo.(collectorRepository)
	if !ok {
		return nil, appError("校园采集员审核服务未配置")
	}
	status = strings.TrimSpace(status)
	if status != "" && status != "all" {
		if _, ok := collectorApplicationStatuses[status]; !ok {
			return nil, badRequest("申请状态不正确")
		}
	}
	if page <= 0 {
		page = 1
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	items, total, err := repo.ListCollectorApplications(ctx, "", status, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &CollectorApplicationListResult{Items: items, Page: page, Limit: limit, Total: total}, nil
}

func (s *CatalogService) ReviewCollectorApplication(ctx context.Context, adminID, applicationID string, input ReviewCollectorApplicationInput) (*ReviewCollectorApplicationResult, error) {
	adminID, applicationID = strings.TrimSpace(adminID), strings.TrimSpace(applicationID)
	if adminID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	if applicationID == "" {
		return nil, badRequest("申请 ID 不能为空")
	}
	status := strings.TrimSpace(input.Status)
	if status != "approved" && status != "rejected" {
		return nil, badRequest("审核结果只能是 approved 或 rejected")
	}
	if input.ExpiresAt != nil && !input.ExpiresAt.After(time.Now()) {
		return nil, badRequest("授权到期时间必须晚于当前时间")
	}
	note := strings.TrimSpace(input.Note)
	if len([]rune(note)) > 500 {
		return nil, badRequest("审核说明最多 500 个字")
	}
	repo, ok := s.repo.(collectorRepository)
	if !ok {
		return nil, appError("校园采集员审核服务未配置")
	}
	application, scope, err := repo.ReviewCollectorApplication(ctx, applicationID, adminID, status, note, input.ExpiresAt, time.Now())
	if errors.Is(err, domain.ErrCollectorApplicationAbsent) {
		return nil, notFound("校园采集员申请不存在")
	}
	if errors.Is(err, domain.ErrVersionConflict) {
		return nil, &commonerrors.AppError{Code: 10003, Message: "该申请已完成审核，请刷新后查看", HTTPStatus: http.StatusConflict}
	}
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "管理员完成校园采集员申请审核",
		slog.String("admin_id", adminID), slog.String("application_id", applicationID), slog.String("status", status))
	return &ReviewCollectorApplicationResult{Application: *application, Scope: scope}, nil
}

// ApplyLatestUserCorrection is only for compatibility endpoints that predate
// base_version. New clients must call ApplyUserCorrection directly so a stale
// form never overwrites a newer community edit.
func (s *CatalogService) ApplyLatestUserCorrection(ctx context.Context, userID, itemID string, patch map[string]any, reason string) (*CorrectionResult, error) {
	item, err := s.repo.FindItemByID(ctx, strings.TrimSpace(itemID))
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, notFound("校园菜品不存在")
	}
	return s.ApplyUserCorrection(ctx, userID, itemID, CorrectionInput{
		BaseVersion: item.Version,
		Patch:       patch,
		Reason:      reason,
	})
}

func (s *CatalogService) applyAdminCatalogUpdate(ctx context.Context, repo communityRepository, adminID string, current, updated *domain.CatalogItem) error {
	if current == nil || updated == nil {
		return badRequest("校园菜品更新内容不完整")
	}
	before, after := catalogEditableSnapshot(*current), catalogEditableSnapshot(*updated)
	changedFields := changedSnapshotFields(before, after)
	if len(changedFields) == 0 {
		return nil
	}
	now := time.Now()
	updated.Version, updated.UpdatedAt, updated.LastVerifiedAt = current.Version+1, &now, &now
	nutritionChanged := containsAny(changedFields, "name", "image_paths", "portion_description")
	if nutritionChanged {
		updated.AnalysisTaskID, updated.AnalysisError = nil, ""
		if updated.NutritionVersion > 0 {
			updated.NutritionStatus = "stale"
		} else {
			updated.NutritionStatus = "pending"
		}
	}
	actorType := "system"
	var actorAdminID *string
	if adminID != "" {
		actorType, actorAdminID = "admin", &adminID
	}
	revision := &domain.Revision{
		ID: uuid.NewString(), CatalogItemID: updated.ID, BaseVersion: current.Version, ResultVersion: updated.Version,
		ActorType: actorType, ActorAdminID: actorAdminID, ActionType: "update",
		BeforeSnapshot: before, ProposedPatch: snapshotPatch(before, after, changedFields), AfterSnapshot: after,
		ChangedFields: changedFields, CreatedAt: &now,
	}
	if err := repo.ApplyRevision(ctx, updated, revision); err != nil {
		if errors.Is(err, domain.ErrVersionConflict) {
			return campusVersionConflict()
		}
		return err
	}
	if nutritionChanged {
		s.queueCommunityNutritionRefresh(ctx, repo, adminID, updated)
	}
	return nil
}

func (s *CatalogService) ApplyUserCorrection(ctx context.Context, userID, itemID string, input CorrectionInput) (*CorrectionResult, error) {
	userID = strings.TrimSpace(userID)
	itemID = strings.TrimSpace(itemID)
	if userID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	if itemID == "" || input.BaseVersion < 1 {
		return nil, badRequest("菜品 ID 和当前版本不能为空")
	}
	communityRepo, ok := s.repo.(communityRepository)
	if !ok {
		return nil, appError("校园菜品纠错服务未配置")
	}
	current, err := s.repo.FindItemByID(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, notFound("校园菜品不存在")
	}
	if current.Version != input.BaseVersion {
		return nil, campusVersionConflict()
	}

	updated := cloneCatalogItem(*current)
	proposedPatch, _, err := s.applyCorrectionPatch(ctx, communityRepo, &updated, input.Patch)
	if err != nil {
		return nil, err
	}
	before := catalogEditableSnapshot(*current)
	after := catalogEditableSnapshot(updated)
	changedFields := changedSnapshotFields(before, after)
	if len(changedFields) == 0 {
		return nil, badRequest("没有可保存的菜品变更")
	}
	nutritionChanged := containsAny(changedFields, "name", "image_paths", "portion_description")

	now := time.Now()
	updated.Version = current.Version + 1
	updated.LastContributorID = &userID
	updated.LastVerifiedAt = &now
	updated.UpdatedAt = &now
	if updated.AvailabilityStatus == "" {
		updated.AvailabilityStatus = "available"
	}
	if nutritionChanged {
		updated.AnalysisTaskID = nil
		updated.AnalysisError = ""
		if updated.NutritionVersion > 0 {
			updated.NutritionStatus = "stale"
		} else {
			updated.NutritionStatus = "pending"
		}
	}
	evidence, err := s.normalizeImageKeys(input.EvidenceImagePaths)
	if err != nil {
		return nil, badRequest("佐证图片地址不正确")
	}
	reason := strings.TrimSpace(input.Reason)
	if len([]rune(reason)) > 500 {
		return nil, badRequest("纠错说明最多 500 个字")
	}
	revision := domain.Revision{
		ID: uuid.NewString(), CatalogItemID: itemID,
		BaseVersion: current.Version, ResultVersion: updated.Version,
		ActorType: "user", ActorUserID: &userID, ActionType: "update",
		BeforeSnapshot: before, ProposedPatch: proposedPatch, AfterSnapshot: after,
		ChangedFields: changedFields, EvidenceImagePaths: evidence, Reason: reason, CreatedAt: &now,
	}
	if err := communityRepo.ApplyRevision(ctx, &updated, &revision); err != nil {
		if errors.Is(err, domain.ErrVersionConflict) {
			return nil, campusVersionConflict()
		}
		logger.Error(ctx, "保存校园菜品纠错版本失败", err,
			slog.String("user_id", userID), slog.String("item_id", itemID),
			slog.Int64("base_version", input.BaseVersion))
		return nil, err
	}
	queued := false
	if nutritionChanged {
		queued = s.queueCommunityNutritionRefresh(ctx, communityRepo, userID, &updated)
	}
	logger.Info(ctx, "校园菜品纠错已即时生效",
		slog.String("user_id", userID), slog.String("item_id", itemID),
		slog.Int64("result_version", updated.Version), slog.Int("changed_field_count", len(changedFields)),
		slog.Bool("nutrition_reanalysis_queued", queued))
	items := []domain.CatalogItem{updated}
	s.resolveItemImages(items)
	return &CorrectionResult{Item: items[0], Revision: revision, ReanalysisQueued: queued}, nil
}

func (s *CatalogService) ListRevisions(ctx context.Context, itemID string, page, limit int) (*RevisionListResult, error) {
	communityRepo, ok := s.repo.(communityRepository)
	if !ok {
		return nil, appError("校园菜品版本记录服务未配置")
	}
	if strings.TrimSpace(itemID) == "" {
		return nil, badRequest("菜品 ID 不能为空")
	}
	if page <= 0 {
		page = 1
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	items, total, err := communityRepo.ListRevisions(ctx, strings.TrimSpace(itemID), limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	if total == 0 {
		if item, findErr := s.repo.FindItemByID(ctx, strings.TrimSpace(itemID)); findErr != nil {
			return nil, findErr
		} else if item == nil {
			return nil, notFound("校园菜品不存在")
		}
	}
	return &RevisionListResult{Items: items, Page: page, Limit: limit, Total: total}, nil
}

func (s *CatalogService) RollbackRevision(ctx context.Context, adminID, itemID, revisionID string, input RollbackInput) (*CorrectionResult, error) {
	adminID, itemID, revisionID = strings.TrimSpace(adminID), strings.TrimSpace(itemID), strings.TrimSpace(revisionID)
	if adminID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	if itemID == "" || revisionID == "" || input.BaseVersion < 1 {
		return nil, badRequest("菜品、修订记录和当前版本不能为空")
	}
	repo, ok := s.repo.(communityRepository)
	if !ok {
		return nil, appError("校园菜品回滚服务未配置")
	}
	current, err := s.repo.FindItemByID(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, notFound("校园菜品不存在")
	}
	if current.Version != input.BaseVersion {
		return nil, campusVersionConflict()
	}
	target, err := repo.FindRevisionByID(ctx, itemID, revisionID)
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, notFound("菜品更新记录不存在")
	}
	rollbackPatch := make(map[string]any)
	for field, value := range target.BeforeSnapshot {
		if _, editable := correctionEditableFields[field]; editable {
			rollbackPatch[field] = value
		}
	}
	updated := cloneCatalogItem(*current)
	proposedPatch, _, err := s.applyCorrectionPatch(ctx, repo, &updated, rollbackPatch)
	if err != nil {
		return nil, err
	}
	before, after := catalogEditableSnapshot(*current), catalogEditableSnapshot(updated)
	changedFields := changedSnapshotFields(before, after)
	if len(changedFields) == 0 {
		return nil, badRequest("当前菜品已经与该历史版本一致")
	}
	nutritionChanged := containsAny(changedFields, "name", "image_paths", "portion_description")
	now := time.Now()
	updated.Version, updated.UpdatedAt, updated.LastVerifiedAt = current.Version+1, &now, &now
	if nutritionChanged {
		updated.AnalysisTaskID, updated.AnalysisError = nil, ""
		if updated.NutritionVersion > 0 {
			updated.NutritionStatus = "stale"
		} else {
			updated.NutritionStatus = "pending"
		}
	}
	reason := strings.TrimSpace(input.Reason)
	if reason == "" {
		reason = "管理员回滚错误更新"
	}
	if len([]rune(reason)) > 500 {
		return nil, badRequest("回滚说明最多 500 个字")
	}
	revision := domain.Revision{
		ID: uuid.NewString(), CatalogItemID: itemID, BaseVersion: current.Version, ResultVersion: updated.Version,
		ActorType: "admin", ActorAdminID: &adminID, ActionType: "rollback",
		BeforeSnapshot: before, ProposedPatch: proposedPatch, AfterSnapshot: after, ChangedFields: changedFields,
		Reason: reason, RevertsRevisionID: &target.ID, CreatedAt: &now,
	}
	if err := repo.ApplyRevision(ctx, &updated, &revision); err != nil {
		if errors.Is(err, domain.ErrVersionConflict) {
			return nil, campusVersionConflict()
		}
		return nil, err
	}
	queued := false
	if nutritionChanged {
		queued = s.queueCommunityNutritionRefresh(ctx, repo, adminID, &updated)
	}
	logger.Info(ctx, "管理员已回滚校园菜品错误版本",
		slog.String("admin_id", adminID), slog.String("item_id", itemID), slog.String("reverted_revision_id", target.ID), slog.Int64("result_version", updated.Version))
	items := []domain.CatalogItem{updated}
	s.resolveItemImages(items)
	return &CorrectionResult{Item: items[0], Revision: revision, ReanalysisQueued: queued}, nil
}

func (s *CatalogService) applyCorrectionPatch(ctx context.Context, repo communityRepository, item *domain.CatalogItem, patch map[string]any) (map[string]any, bool, error) {
	if len(patch) == 0 {
		return nil, false, badRequest("请至少修改一项菜品信息")
	}
	for field := range patch {
		if _, ok := correctionEditableFields[field]; !ok {
			return nil, false, badRequest("不支持修改字段：" + field)
		}
	}
	normalized := make(map[string]any, len(patch))
	nutritionChanged := false
	directoryChanged := false
	for field, value := range patch {
		switch field {
		case "name":
			text, err := correctionString(value, 100, false)
			if err != nil {
				return nil, false, err
			}
			item.Name, normalized[field], nutritionChanged = text, text, true
		case "description":
			text, err := correctionString(value, 1000, true)
			if err != nil {
				return nil, false, err
			}
			item.Description, normalized[field] = text, text
		case "floor":
			text, err := correctionString(value, 50, true)
			if err != nil {
				return nil, false, err
			}
			item.Floor, normalized[field] = text, text
		case "window_name":
			text, err := correctionString(value, 100, true)
			if err != nil {
				return nil, false, err
			}
			item.WindowName, normalized[field] = text, text
		case "availability_note":
			text, err := correctionString(value, 300, true)
			if err != nil {
				return nil, false, err
			}
			item.AvailabilityNote, normalized[field] = text, text
		case "price_unit":
			text, err := correctionString(value, 50, true)
			if err != nil {
				return nil, false, err
			}
			item.PriceUnit, normalized[field] = normalizeStoredPriceUnit(text), normalizeStoredPriceUnit(text)
		case "portion_description":
			text, err := correctionString(value, 200, true)
			if err != nil {
				return nil, false, err
			}
			item.PortionDescription, normalized[field], nutritionChanged = text, text, true
		case "school_id", "campus_id", "canteen_id", "window_id":
			pointer, err := correctionStringPointer(value)
			if err != nil {
				return nil, false, err
			}
			switch field {
			case "school_id":
				item.SchoolID = pointer
			case "campus_id":
				item.CampusID = pointer
			case "canteen_id":
				item.CanteenID = pointer
			case "window_id":
				item.WindowID = pointer
			}
			normalized[field], directoryChanged = pointerValue(pointer), true
		case "meal_periods":
			values, err := correctionStringSlice(value)
			if err != nil {
				return nil, false, err
			}
			values, err = normalizeStringEnums(values, mealPeriods)
			if err != nil {
				return nil, false, badRequest("供应餐时不正确")
			}
			item.MealPeriods, normalized[field] = values, values
		case "available_weekdays":
			values, err := correctionStringSlice(value)
			if err != nil {
				return nil, false, err
			}
			values, err = normalizeStringEnums(values, weekdayValues)
			if err != nil {
				return nil, false, badRequest("供应日期不正确")
			}
			item.AvailableWeekdays, normalized[field] = values, values
		case "service_mode":
			text, err := correctionString(value, 50, false)
			if err != nil {
				return nil, false, err
			}
			mode, ok := normalizeEnum(text, "unknown", serviceModes)
			if !ok {
				return nil, false, badRequest("售卖形式不正确")
			}
			item.ServiceMode, normalized[field] = mode, mode
		case "price_type":
			text, err := correctionString(value, 50, false)
			if err != nil {
				return nil, false, err
			}
			if text == "weight" {
				text = "by_weight"
			}
			priceType, ok := normalizeEnum(text, "unknown", priceTypes)
			if !ok {
				return nil, false, badRequest("计价方式不正确")
			}
			item.PriceType, normalized[field] = priceType, priceType
		case "price", "price_min", "price_max":
			number, err := correctionNumberPointer(value)
			if err != nil {
				return nil, false, err
			}
			if number != nil && (*number < 0 || *number > 10000) {
				return nil, false, badRequest("价格必须在 0 到 10000 元之间")
			}
			switch field {
			case "price":
				item.Price = number
			case "price_min":
				item.PriceMin = number
			case "price_max":
				item.PriceMax = number
			}
			normalized[field] = numberValue(number)
		case "image_paths", "append_image_paths":
			values, err := correctionStringSlice(value)
			if err != nil {
				return nil, false, err
			}
			if field == "append_image_paths" {
				values = append(append([]string{}, item.ImagePaths...), values...)
			}
			values, err = s.normalizeImageKeys(values)
			if err != nil {
				return nil, false, badRequest("菜品图片地址不正确")
			}
			if len(values) > maxImagesPerItem {
				return nil, false, badRequest(fmt.Sprintf("菜品最多保留 %d 张图片", maxImagesPerItem))
			}
			item.ImagePaths, normalized["image_paths"], nutritionChanged = values, values, true
			delete(normalized, "append_image_paths")
		case "price_collected_at":
			value, err := correctionTimePointer(value)
			if err != nil {
				return nil, false, err
			}
			item.CapturedAt, normalized[field] = value, timePointerValue(value)
		case "availability_status":
			text, err := correctionString(value, 50, false)
			if err != nil {
				return nil, false, err
			}
			if _, ok := availabilityStatuses[text]; !ok {
				return nil, false, badRequest("供应状态不正确")
			}
			item.AvailabilityStatus, normalized[field] = text, text
		}
	}
	if directoryChanged {
		if item.SchoolID == nil || item.CampusID == nil || item.CanteenID == nil {
			return nil, false, badRequest("学校、校区和食堂是必要信息，不能清空")
		}
		ref, err := repo.GetCampusDirectoryRef(ctx, pointerValue(item.SchoolID), pointerValue(item.CampusID), pointerValue(item.CanteenID), pointerValue(item.WindowID))
		if err != nil {
			return nil, false, err
		}
		if ref == nil || ref.SchoolID == "" || ref.CampusID == "" || ref.CanteenID == "" {
			return nil, false, badRequest("请选择同一学校下已启用的校区和食堂")
		}
		item.SchoolID, item.CampusID, item.CanteenID = stringPointer(ref.SchoolID), stringPointer(ref.CampusID), stringPointer(ref.CanteenID)
		item.OrganizationName, item.AreaName, item.CanteenName = ref.SchoolName, ref.CampusName, ref.CanteenName
		if ref.WindowID != "" {
			item.WindowID, item.WindowName = stringPointer(ref.WindowID), ref.WindowName
		}
		if _, floorExplicit := patch["floor"]; !floorExplicit && ref.Floor != "" {
			item.Floor = ref.Floor
		}
	}
	if strings.TrimSpace(item.Name) == "" {
		return nil, false, badRequest("菜品名称不能为空")
	}
	if item.PriceType == "range" && (item.PriceMin == nil || item.PriceMax == nil || *item.PriceMax < *item.PriceMin) {
		return nil, false, badRequest("请填写正确的价格区间")
	}
	item.MissingFields = missingFields(item.Name, item.ImagePaths, item.PriceType, CreateCatalogItemInput{
		Price: item.Price, PriceMin: item.PriceMin, PriceMax: item.PriceMax, PriceText: item.PriceText, PriceOptions: item.PriceOptions,
	})
	item.CompletenessStatus = "complete"
	if len(item.MissingFields) > 0 {
		item.CompletenessStatus = "incomplete"
	}
	return normalized, nutritionChanged, nil
}

func (s *CatalogService) queueCommunityNutritionRefresh(ctx context.Context, repo communityRepository, actorID string, item *domain.CatalogItem) bool {
	if s.analyzeTasks == nil || s.analysisUsers == nil || item == nil {
		return false
	}
	analysisUserID, err := s.analysisUsers.ResolveInternalAnalysisUserID(ctx, "campus_community", actorID)
	if err != nil {
		logger.Warn(ctx, "校园菜品纠错已生效但解析内部分析用户失败", slog.String("item_id", item.ID), logger.Err(err))
		_ = repo.MarkCommunityAnalysisFailed(ctx, item.ID, item.Version, err.Error(), time.Now())
		return false
	}
	imageURLs := append([]string{}, item.ImagePaths...)
	if s.storage != nil {
		imageURLs = s.storage.ResolveReferenceURLs("food-images", imageURLs)
	}
	mode := "standard"
	input := analyzeservice.SubmitTaskInput{
		ExecutionMode: &mode, SuggestRatioEnabled: true, AdditionalContext: catalogAnalysisContext(item),
		ExtraPayload: map[string]any{
			"public_food_source_type": "campus_public_food", "public_food_item_id": item.ID,
			"campus_catalog_item_id": item.ID, "campus_content_version": item.Version,
			"micronutrient_analysis_required": true, "food_name": item.Name,
			"school_name": item.OrganizationName, "campus_name": item.AreaName, "canteen_name": item.CanteenName,
			"floor": item.Floor, "window_name": item.WindowName,
		},
	}
	var taskID string
	if len(imageURLs) > 0 {
		input.ImageURLs, input.ImageURL, input.SourceType = imageURLs, imageURLs[0], "image"
		taskID, err = s.analyzeTasks.SubmitInternalAnalyzeTask(ctx, analysisUserID, input)
	} else {
		input.TextInput, input.SourceType = catalogAnalysisContext(item), "text"
		taskID, err = s.analyzeTasks.SubmitInternalTextTask(ctx, analysisUserID, input)
	}
	if err == nil {
		var linked bool
		linked, err = repo.LinkCommunityAnalysisTask(ctx, item.ID, item.Version, taskID, time.Now())
		if err == nil && linked {
			item.AnalysisTaskID = stringPointer(taskID)
			return true
		}
		if err == nil {
			err = domain.ErrVersionConflict
		}
	}
	logger.Warn(ctx, "校园菜品纠错已生效但营养重算任务提交失败",
		slog.String("item_id", item.ID), slog.Int64("target_version", item.Version), logger.Err(err))
	_ = repo.MarkCommunityAnalysisFailed(ctx, item.ID, item.Version, err.Error(), time.Now())
	return false
}

func cloneCatalogItem(item domain.CatalogItem) domain.CatalogItem {
	item.ImagePaths = append([]string{}, item.ImagePaths...)
	item.MealPeriods = append([]string{}, item.MealPeriods...)
	item.AvailableWeekdays = append([]string{}, item.AvailableWeekdays...)
	item.MissingFields = append([]string{}, item.MissingFields...)
	if item.PriceOptions != nil {
		item.PriceOptions = cloneMap(item.PriceOptions)
	}
	return item
}

func catalogEditableSnapshot(item domain.CatalogItem) map[string]any {
	return map[string]any{
		"entry_type": item.EntryType, "name": item.Name, "description": item.Description,
		"school_id": pointerValue(item.SchoolID), "campus_id": pointerValue(item.CampusID), "canteen_id": pointerValue(item.CanteenID), "window_id": pointerValue(item.WindowID),
		"school_name": item.OrganizationName, "campus_name": item.AreaName, "canteen_name": item.CanteenName,
		"floor": item.Floor, "window_name": item.WindowName, "window_layout": item.WindowLayout, "meal_periods": append([]string{}, item.MealPeriods...),
		"available_weekdays": append([]string{}, item.AvailableWeekdays...), "availability_note": item.AvailabilityNote,
		"service_mode": item.ServiceMode, "price_type": item.PriceType, "price": numberValue(item.Price), "price_min": numberValue(item.PriceMin), "price_max": numberValue(item.PriceMax),
		"price_unit": item.PriceUnit, "price_text": item.PriceText, "price_options": cloneMap(item.PriceOptions),
		"portion_description": item.PortionDescription, "image_paths": append([]string{}, item.ImagePaths...), "image_kind": item.ImageKind,
		"source_filename": item.SourceFilename, "raw_text": item.RawText, "notes": item.Notes,
		"price_collected_at": timePointerValue(item.CapturedAt), "availability_status": item.AvailabilityStatus,
	}
}

func snapshotPatch(before, after map[string]any, fields []string) map[string]any {
	patch := make(map[string]any, len(fields))
	for _, field := range fields {
		patch[field] = after[field]
	}
	return patch
}

func changedSnapshotFields(before, after map[string]any) []string {
	allFields := make(map[string]struct{}, len(before)+len(after))
	for field := range before {
		allFields[field] = struct{}{}
	}
	for field := range after {
		allFields[field] = struct{}{}
	}
	fields := make([]string, 0, len(allFields))
	for field := range allFields {
		if !reflect.DeepEqual(before[field], after[field]) {
			fields = append(fields, field)
		}
	}
	sort.Strings(fields)
	return fields
}

func containsAny(values []string, candidates ...string) bool {
	wanted := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		wanted[candidate] = struct{}{}
	}
	for _, value := range values {
		if _, ok := wanted[value]; ok {
			return true
		}
	}
	return false
}

func correctionString(value any, maxRunes int, allowEmpty bool) (string, error) {
	if value == nil && allowEmpty {
		return "", nil
	}
	text, ok := value.(string)
	if !ok {
		return "", badRequest("文本字段格式不正确")
	}
	text = strings.TrimSpace(text)
	if text == "" && !allowEmpty {
		return "", badRequest("必填文本不能为空")
	}
	if len([]rune(text)) > maxRunes {
		return "", badRequest(fmt.Sprintf("文本最多 %d 个字", maxRunes))
	}
	return text, nil
}

func correctionStringPointer(value any) (*string, error) {
	if value == nil {
		return nil, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, badRequest("目录 ID 格式不正确")
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	if _, err := uuid.Parse(text); err != nil {
		return nil, badRequest("目录 ID 格式不正确")
	}
	return &text, nil
}

func correctionStringSlice(value any) ([]string, error) {
	if value == nil {
		return []string{}, nil
	}
	switch values := value.(type) {
	case []string:
		return append([]string{}, values...), nil
	case []any:
		out := make([]string, 0, len(values))
		for _, entry := range values {
			text, ok := entry.(string)
			if !ok {
				return nil, badRequest("列表字段格式不正确")
			}
			out = append(out, text)
		}
		return out, nil
	default:
		return nil, badRequest("列表字段格式不正确")
	}
}

func correctionNumberPointer(value any) (*float64, error) {
	if value == nil {
		return nil, nil
	}
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case float32:
		number = float64(typed)
	case int:
		number = float64(typed)
	case int64:
		number = float64(typed)
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil {
			return nil, badRequest("数字字段格式不正确")
		}
		number = parsed
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return nil, badRequest("数字字段格式不正确")
		}
		number = parsed
	default:
		return nil, badRequest("数字字段格式不正确")
	}
	return &number, nil
}

func correctionTimePointer(value any) (*time.Time, error) {
	if value == nil {
		return nil, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, badRequest("采集时间格式不正确")
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return nil, badRequest("采集时间须为 RFC3339 格式")
	}
	return &parsed, nil
}

func pointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
func stringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
func numberValue(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}
func timePointerValue(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.UTC().Format(time.RFC3339Nano)
}
func cloneMap(value map[string]any) map[string]any {
	out := make(map[string]any, len(value))
	for key, entry := range value {
		out[key] = entry
	}
	return out
}

func campusVersionConflict() error {
	return &commonerrors.AppError{Code: 10003, Message: "菜品信息已被其他人更新，请刷新后再提交", HTTPStatus: http.StatusConflict}
}

var availabilityStatuses = enumSet("available", "temporarily_unavailable", "discontinued", "unknown")

var correctionEditableFields = map[string]struct{}{
	"name": {}, "description": {}, "school_id": {}, "campus_id": {}, "canteen_id": {}, "window_id": {},
	"floor": {}, "window_name": {}, "meal_periods": {}, "available_weekdays": {}, "availability_note": {},
	"service_mode": {}, "price_type": {}, "price": {}, "price_min": {}, "price_max": {}, "price_unit": {},
	"portion_description": {}, "image_paths": {}, "append_image_paths": {}, "price_collected_at": {}, "availability_status": {},
}
var collectorApplicationStatuses = enumSet("pending", "approved", "rejected", "withdrawn")
