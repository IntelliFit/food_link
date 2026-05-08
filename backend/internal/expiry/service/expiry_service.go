package service

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/expiry/domain"
	"food_link/backend/internal/expiry/repo"
)

type ExpiryService struct {
	expiryRepo  *repo.ExpiryRepo
	taskRepo    *repo.TaskRepo
	recognizer  *Recognizer
	templateID  string
	creditGuard CreditGuard
}

func NewExpiryService(expiryRepo *repo.ExpiryRepo, taskRepo *repo.TaskRepo, recognizers ...*Recognizer) *ExpiryService {
	var recognizer *Recognizer
	if len(recognizers) > 0 {
		recognizer = recognizers[0]
	}
	return &ExpiryService{expiryRepo: expiryRepo, taskRepo: taskRepo, recognizer: recognizer}
}

type CreditGuard interface {
	ValidateFoodAnalysisCredits(ctx context.Context, userID, executionMode, recordedOn string) (map[string]any, error)
	ConsumeEarnedCreditsAfterSuccess(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error
}

func (s *ExpiryService) ConfigureCreditGuard(guard CreditGuard) {
	s.creditGuard = guard
}

type DashboardResult struct {
	ActiveCount   int                 `json:"active_count"`
	ConsumedCount int                 `json:"consumed_count"`
	ExpiredCount  int                 `json:"expired_count"`
	ExpiringSoon  []domain.ExpiryItem `json:"expiring_soon"`
}

type CreateItemInput struct {
	Name       string
	Category   string
	ExpiryDate *time.Time
	Quantity   *int
	Location   *string
	Notes      *string
	ImageURL   *string
	Status     string
}

type UpdateItemInput struct {
	Name       *string
	Category   *string
	ExpiryDate *time.Time
	Quantity   *int
	Location   *string
	Notes      *string
	ImageURL   *string
	Status     *string
}

type SubscribeResult struct {
	Subscribed      bool    `json:"subscribed"`
	ScheduleCreated bool    `json:"schedule_created"`
	Status          string  `json:"status,omitempty"`
	ScheduledAt     *string `json:"scheduled_at"`
	Message         string  `json:"message"`
}

type RecognizeResult struct {
	TaskID      string           `json:"task_id"`
	CreditsCost int              `json:"credits_cost"`
	Items       []map[string]any `json:"items"`
	Message     string           `json:"message"`
}

func (s *ExpiryService) Dashboard(ctx context.Context, userID string) (*DashboardResult, error) {
	counts, err := s.expiryRepo.CountByStatus(ctx, userID)
	if err != nil {
		return nil, err
	}
	expiringSoon, err := s.expiryRepo.ListExpiringSoon(ctx, userID, 7, 50)
	if err != nil {
		return nil, err
	}
	return &DashboardResult{
		ActiveCount:   counts["active"],
		ConsumedCount: counts["consumed"],
		ExpiredCount:  counts["discarded"],
		ExpiringSoon:  expiringSoon,
	}, nil
}

func (s *ExpiryService) ListItems(ctx context.Context, userID, status string) ([]domain.ExpiryItem, error) {
	return s.expiryRepo.ListByUser(ctx, userID, status, 200)
}

func (s *ExpiryService) CreateItem(ctx context.Context, userID string, input CreateItemInput) (*domain.ExpiryItem, error) {
	if input.Name == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "name 不能为空", HTTPStatus: 400}
	}
	status := input.Status
	if status == "" {
		status = "active"
	}
	storageType := mapLocationToStorageType(input.Location)
	var quantityNote *string
	if input.Quantity != nil {
		s := strconv.Itoa(*input.Quantity)
		quantityNote = &s
	}
	item := &domain.ExpiryItem{
		UserID:       userID,
		FoodName:     input.Name,
		Category:     input.Category,
		StorageType:  storageType,
		QuantityNote: quantityNote,
		ExpireDate:   ptrTimeValue(input.ExpiryDate),
		Note:         input.Notes,
		SourceType:   "manual",
		Status:       status,
	}
	if err := s.expiryRepo.Create(ctx, item); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *ExpiryService) GetItem(ctx context.Context, userID, itemID string) (*domain.ExpiryItem, error) {
	item, err := s.expiryRepo.GetByID(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, commonerrors.ErrNotFound
	}
	if item.UserID != userID {
		return nil, commonerrors.ErrForbidden
	}
	return item, nil
}

func (s *ExpiryService) UpdateItem(ctx context.Context, userID, itemID string, input UpdateItemInput) (*domain.ExpiryItem, error) {
	updates := map[string]any{}
	if input.Name != nil {
		if *input.Name == "" {
			return nil, &commonerrors.AppError{Code: 10002, Message: "name 不能为空", HTTPStatus: 400}
		}
		updates["food_name"] = *input.Name
	}
	if input.Category != nil {
		updates["category"] = *input.Category
	}
	if input.ExpiryDate != nil {
		updates["expire_date"] = *input.ExpiryDate
	}
	if input.Quantity != nil {
		updates["quantity_note"] = strconv.Itoa(*input.Quantity)
	}
	if input.Location != nil {
		updates["storage_type"] = mapLocationToStorageType(input.Location)
	}
	if input.Notes != nil {
		updates["note"] = *input.Notes
	}
	if input.Status != nil {
		updates["status"] = *input.Status
	}
	if len(updates) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "没有需要更新的字段", HTTPStatus: 400}
	}
	item, err := s.expiryRepo.Update(ctx, userID, itemID, updates)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, commonerrors.ErrNotFound
	}
	return item, nil
}

func (s *ExpiryService) UpdateStatus(ctx context.Context, userID, itemID, status string) (*domain.ExpiryItem, error) {
	if status == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "status 不能为空", HTTPStatus: 400}
	}
	item, err := s.expiryRepo.Update(ctx, userID, itemID, map[string]any{"status": status})
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, commonerrors.ErrNotFound
	}
	return item, nil
}

func (s *ExpiryService) Subscribe(ctx context.Context, userID, itemID string) (*SubscribeResult, error) {
	return s.SubscribeWithContext(ctx, userID, itemID, "", "accept", "")
}

func (s *ExpiryService) ConfigureNotificationTemplate(templateID string) {
	s.templateID = strings.TrimSpace(templateID)
}

func (s *ExpiryService) SubscribeWithContext(ctx context.Context, userID, itemID, openID, subscribeStatus, errMsg string) (*SubscribeResult, error) {
	_ = errMsg
	item, err := s.expiryRepo.GetByID(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, commonerrors.ErrNotFound
	}
	if item.UserID != userID {
		return nil, commonerrors.ErrForbidden
	}
	status := strings.TrimSpace(subscribeStatus)
	normalizedStatus := strings.ToLower(status)
	if item.Status != "active" {
		_, _ = s.expiryRepo.CancelNotificationJobsByItem(ctx, itemID)
		return &SubscribeResult{
			Subscribed:      false,
			ScheduleCreated: false,
			Status:          status,
			ScheduledAt:     nil,
			Message:         "当前条目不是保鲜中状态，未登记提醒",
		}, nil
	}
	if normalizedStatus != "accept" && normalizedStatus != "acceptwithalert" && normalizedStatus != "acceptwithaudio" {
		return &SubscribeResult{
			Subscribed:      false,
			ScheduleCreated: false,
			Status:          status,
			ScheduledAt:     nil,
			Message:         "用户未接受订阅提醒",
		}, nil
	}
	if strings.TrimSpace(openID) == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "当前用户缺少 openid，无法登记提醒", HTTPStatus: 400}
	}
	if s.templateID == "" {
		return nil, &commonerrors.AppError{Code: 10000, Message: "后端未配置保质期提醒模板 ID", HTTPStatus: 500}
	}
	job, err := s.reconcileNotificationJob(ctx, userID, openID, item, true)
	if err != nil {
		return nil, err
	}
	var scheduledAt *string
	if job != nil {
		value := job.ScheduledAt.UTC().Format(time.RFC3339)
		scheduledAt = &value
	}
	return &SubscribeResult{
		Subscribed:      true,
		ScheduleCreated: job != nil,
		Status:          status,
		ScheduledAt:     scheduledAt,
		Message:         map[bool]string{true: "提醒任务已登记", false: "当前不满足提醒条件，未登记任务"}[job != nil],
	}, nil
}

func (s *ExpiryService) reconcileNotificationJob(ctx context.Context, userID, openID string, item *domain.ExpiryItem, allowCreate bool) (*domain.ExpiryNotificationJob, error) {
	if item == nil || item.ID == "" {
		return nil, nil
	}
	existingJobs, err := s.expiryRepo.ListNotificationJobsByItem(ctx, item.ID)
	if err != nil {
		return nil, err
	}
	if s.templateID == "" || item.Status != "active" {
		_, err := s.expiryRepo.CancelNotificationJobsByItem(ctx, item.ID)
		return nil, err
	}
	if !allowCreate && len(existingJobs) == 0 {
		return nil, nil
	}
	scheduledLocal := buildNotificationSchedule(item)
	if scheduledLocal == nil {
		_, err := s.expiryRepo.CancelNotificationJobsByItem(ctx, item.ID)
		return nil, err
	}
	payloadSnapshot := map[string]any{
		"page":        "/pages/expiry/index",
		"data":        buildNotificationPayload(item),
		"food_name":   item.FoodName,
		"expire_date": item.ExpireDate.Format("2006-01-02"),
		"status":      item.Status,
	}
	return s.expiryRepo.UpsertNotificationJob(ctx, &domain.ExpiryNotificationJob{
		UserID:          userID,
		ExpiryItemID:    item.ID,
		TemplateID:      s.templateID,
		OpenID:          openID,
		ScheduledAt:     scheduledLocal.UTC(),
		MaxRetryCount:   3,
		PayloadSnapshot: payloadSnapshot,
	})
}

func buildNotificationSchedule(item *domain.ExpiryItem) *time.Time {
	if item == nil || item.ExpireDate.IsZero() {
		return nil
	}
	china := time.FixedZone("Asia/Shanghai", 8*60*60)
	nowLocal := time.Now().In(china)
	expireDate := item.ExpireDate.In(china)
	expireDay := time.Date(expireDate.Year(), expireDate.Month(), expireDate.Day(), 0, 0, 0, 0, china)
	today := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, china)
	if expireDay.Before(today) {
		return nil
	}
	scheduled := time.Date(expireDate.Year(), expireDate.Month(), expireDate.Day(), 9, 0, 0, 0, china)
	if expireDay.Equal(today) && !scheduled.After(nowLocal) {
		scheduled = nowLocal.Add(time.Minute)
	}
	return &scheduled
}

func buildNotificationPayload(item *domain.ExpiryItem) map[string]any {
	expireDate := ""
	if !item.ExpireDate.IsZero() {
		expireDate = item.ExpireDate.Format("2006-01-02")
	}
	timeValue := "未填写"
	if expireDate != "" {
		timeValue = expireDate + " 09:00"
	}
	return map[string]any{
		"thing1":            map[string]any{"value": nonEmpty(item.FoodName, "未命名食物")},
		"time2":             map[string]any{"value": timeValue},
		"thing3":            map[string]any{"value": "今天到期，请优先处理"},
		"thing4":            map[string]any{"value": nonEmpty(storageTypeLabel(item.StorageType), "未填写")},
		"character_string5": map[string]any{"value": normalizeCharacterString(ptrStringValue(item.QuantityNote), "NA")},
	}
}

var characterStringRe = regexp.MustCompile(`[^A-Za-z0-9\s\-_.,:/+#()xX]`)

func normalizeCharacterString(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	value = characterStringRe.ReplaceAllString(value, "")
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) > 32 {
		value = string(runes[:32])
	}
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func storageTypeLabel(value string) string {
	switch value {
	case "room_temp":
		return "常温"
	case "frozen":
		return "冷冻"
	case "refrigerated":
		return "冷藏"
	default:
		return value
	}
}

func ptrStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func nonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func (s *ExpiryService) Recognize(ctx context.Context, userID string, imageURLs []string) (*RecognizeResult, error) {
	return s.RecognizeWithContext(ctx, userID, imageURLs, "")
}

func (s *ExpiryService) RecognizeWithContext(ctx context.Context, userID string, imageURLs []string, additionalContext string) (*RecognizeResult, error) {
	if len(imageURLs) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请至少提供 1 张图片", HTTPStatus: 400}
	}
	if s.recognizer == nil {
		return nil, &commonerrors.AppError{Code: 10000, Message: "保质期识别服务未初始化", HTTPStatus: 500}
	}
	var creditsInfo map[string]any
	if s.creditGuard != nil && userID != "" {
		var err error
		creditsInfo, err = s.creditGuard.ValidateFoodAnalysisCredits(ctx, userID, "standard", "")
		if err != nil {
			return nil, err
		}
	}
	extraPayload := map[string]any{}
	if creditsInfo != nil {
		if spendPlan, ok := creditsInfo["credit_spend_plan"]; ok {
			extraPayload["credit_usage"] = spendPlan
		}
	}
	task, err := s.taskRepo.CreateExpiryRecognizeTaskWithPayload(ctx, userID, imageURLs, additionalContext, extraPayload)
	if err != nil {
		return nil, err
	}
	_ = s.taskRepo.UpdateTaskStatus(ctx, task.ID, "processing", nil)
	recognized, err := s.recognizer.Recognize(ctx, RecognizeInput{
		ImageURLs:         imageURLs,
		AdditionalContext: additionalContext,
	})
	if err != nil {
		_, _ = s.taskRepo.FailTask(ctx, task.ID, err.Error())
		return nil, err
	}
	result := map[string]any{
		"recognize_mode": "food_expiry",
		"items":          recognized.Items,
	}
	_, err = s.taskRepo.CompleteTask(ctx, task.ID, result)
	if err != nil {
		return nil, err
	}
	if s.creditGuard != nil && creditsInfo != nil {
		_ = s.creditGuard.ConsumeEarnedCreditsAfterSuccess(ctx, userID, creditsInfo, expiryCreditCost, "food_analysis_reward_spend", "food_analysis:"+task.ID, map[string]any{
			"task_id":        task.ID,
			"task_type":      task.TaskType,
			"recognize_mode": "food_expiry",
		})
	}
	return &RecognizeResult{
		TaskID:      task.ID,
		CreditsCost: expiryCreditCost,
		Items:       recognized.Items,
		Message:     "已识别 " + strconv.Itoa(len(recognized.Items)) + " 项食物，可继续补充后保存",
	}, nil
}

func mapLocationToStorageType(location *string) string {
	if location == nil || *location == "" {
		return "refrigerated"
	}
	l := strings.ToLower(*location)
	if strings.Contains(l, "冷冻") || strings.Contains(l, "freez") {
		return "frozen"
	}
	if strings.Contains(l, "常温") || strings.Contains(l, "room") {
		return "room_temp"
	}
	return "refrigerated"
}

func ptrTimeValue(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}
