package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	"food_link/backend/internal/analyze/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type TaskRepo struct {
	db *gorm.DB
}

func NewTaskRepo(db *gorm.DB) *TaskRepo {
	return &TaskRepo{db: db}
}

const defaultTaskLeaseDuration = 5 * time.Minute

type ClaimOutcome string

const (
	ClaimOutcomeClaimed     ClaimOutcome = "claimed"
	ClaimOutcomeNotFound    ClaimOutcome = "not_found"
	ClaimOutcomeNotAllowed  ClaimOutcome = "not_allowed"
	ClaimOutcomeLeaseActive ClaimOutcome = "lease_active"
	ClaimOutcomeTerminal    ClaimOutcome = "terminal"
)

type ClaimTaskOptions struct {
	TaskID        string
	TaskTypes     []string
	WorkerID      string
	LeaseDuration time.Duration
	Now           time.Time
}

type ClaimTaskResult struct {
	Task    *domain.AnalysisTask
	Outcome ClaimOutcome
}

func (r *TaskRepo) CreateTask(ctx context.Context, task *domain.AnalysisTask) error {
	if task.ID == "" {
		task.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(task).Error
}

func (r *TaskRepo) UpsertFeedbackSample(ctx context.Context, sample *domain.AnalysisFeedbackSample) error {
	if sample == nil {
		return nil
	}
	if sample.ID == "" {
		sample.ID = uuid.New().String()
	}
	now := time.Now()
	if sample.CreatedAt == nil {
		sample.CreatedAt = &now
	}
	sample.UpdatedAt = &now

	// 数据库 JSONB 字段有 NOT NULL 约束，GORM 在 nil map/slice 时会写入 NULL 而非默认值，
	// 因此入持久化前统一归一化为空容器。
	if sample.BeforeResult == nil {
		sample.BeforeResult = map[string]any{}
	}
	if sample.AfterResult == nil {
		sample.AfterResult = map[string]any{}
	}
	if sample.PayloadSnapshot == nil {
		sample.PayloadSnapshot = map[string]any{}
	}
	if sample.UserCorrectionItems == nil {
		sample.UserCorrectionItems = []map[string]any{}
	}

	// 旧的 correction/failed 类型仍按 correction_task_id 做唯一冲突键；
	// 新埋点类型按 (source_task_id, source_record_id, feedback_type) 软去重。
	if domain.IsLegacyCorrectionFeedback(sample.FeedbackType) {
		return r.db.WithContext(ctx).Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "correction_task_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"feedback_type",
				"resolution_state",
				"source_task_id",
				"source_record_id",
				"root_task_id",
				"task_type",
				"model_name",
				"analysis_engine",
				"before_result",
				"user_correction_items",
				"after_result",
				"payload_snapshot",
				"error_message",
				"updated_at",
			}),
		}).Create(sample).Error
	}

	var existing domain.AnalysisFeedbackSample
	sourceTaskIDValue := ""
	if sample.SourceTaskID != nil {
		sourceTaskIDValue = *sample.SourceTaskID
	}
	sourceRecordIDValue := ""
	if sample.SourceRecordID != nil {
		sourceRecordIDValue = *sample.SourceRecordID
	}

	query := r.db.WithContext(ctx).
		Where("feedback_type = ?", sample.FeedbackType)
	if sourceTaskIDValue == "" {
		query = query.Where("source_task_id IS NULL")
	} else {
		query = query.Where("source_task_id = ?", sourceTaskIDValue)
	}
	if sourceRecordIDValue == "" {
		query = query.Where("source_record_id IS NULL")
	} else {
		query = query.Where("source_record_id = ?", sourceRecordIDValue)
	}
	err := query.Order("created_at DESC").Limit(1).First(&existing).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if err == nil && existing.ID != "" {
		updateSample := &domain.AnalysisFeedbackSample{
			ResolutionState:     sample.ResolutionState,
			SourceTaskID:        sample.SourceTaskID,
			SourceRecordID:      sample.SourceRecordID,
			RootTaskID:          sample.RootTaskID,
			TaskType:            sample.TaskType,
			ModelName:           sample.ModelName,
			AnalysisEngine:      sample.AnalysisEngine,
			BeforeResult:        sample.BeforeResult,
			UserCorrectionItems: sample.UserCorrectionItems,
			AfterResult:         sample.AfterResult,
			PayloadSnapshot:     sample.PayloadSnapshot,
			ErrorMessage:        sample.ErrorMessage,
			UpdatedAt:           &now,
		}
		return r.db.WithContext(ctx).Model(&domain.AnalysisFeedbackSample{}).
			Select(
				"resolution_state",
				"source_task_id",
				"source_record_id",
				"root_task_id",
				"task_type",
				"model_name",
				"analysis_engine",
				"before_result",
				"user_correction_items",
				"after_result",
				"payload_snapshot",
				"error_message",
				"updated_at",
			).
			Where("id = ?", existing.ID).
			Updates(updateSample).Error
	}
	return r.db.WithContext(ctx).Create(sample).Error
}

func (r *TaskRepo) ClaimNextPendingTask(ctx context.Context, taskTypes []string) (*domain.AnalysisTask, error) {
	if len(taskTypes) == 0 {
		return nil, nil
	}
	var claimed *domain.AnalysisTask
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var task domain.AnalysisTask
		err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status = ? AND task_type IN ?", "pending", taskTypes).
			Order("created_at ASC").
			Limit(1).
			First(&task).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		result, err := claimLoadedTask(tx, &task, ClaimTaskOptions{
			TaskTypes:     taskTypes,
			WorkerID:      "legacy-worker",
			LeaseDuration: defaultTaskLeaseDuration,
		})
		if err != nil {
			return err
		}
		if result.Outcome != ClaimOutcomeClaimed {
			return nil
		}
		claimed = result.Task
		return nil
	})
	return claimed, err
}

func (r *TaskRepo) ClaimTaskByID(ctx context.Context, opts ClaimTaskOptions) (ClaimTaskResult, error) {
	if opts.TaskID == "" || len(opts.TaskTypes) == 0 {
		return ClaimTaskResult{Outcome: ClaimOutcomeNotFound}, nil
	}
	result := ClaimTaskResult{Outcome: ClaimOutcomeNotFound}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var task domain.AnalysisTask
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", opts.TaskID).
			Limit(1).
			First(&task).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			result.Outcome = ClaimOutcomeNotFound
			return nil
		}
		if err != nil {
			return err
		}
		claimResult, err := claimLoadedTask(tx, &task, opts)
		result = claimResult
		return err
	})
	return result, err
}

func claimLoadedTask(tx *gorm.DB, task *domain.AnalysisTask, opts ClaimTaskOptions) (ClaimTaskResult, error) {
	if task == nil {
		return ClaimTaskResult{Outcome: ClaimOutcomeNotFound}, nil
	}
	if !taskTypeAllowed(task.TaskType, opts.TaskTypes) {
		return ClaimTaskResult{Task: task, Outcome: ClaimOutcomeNotAllowed}, nil
	}
	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	leaseDuration := opts.LeaseDuration
	if leaseDuration <= 0 {
		leaseDuration = defaultTaskLeaseDuration
	}
	switch task.Status {
	case "pending":
	case "processing":
		if task.LeaseUntil != nil && task.LeaseUntil.After(now) {
			return ClaimTaskResult{Task: task, Outcome: ClaimOutcomeLeaseActive}, nil
		}
	default:
		return ClaimTaskResult{Task: task, Outcome: ClaimOutcomeTerminal}, nil
	}

	workerID := opts.WorkerID
	if workerID == "" {
		workerID = "worker"
	}
	attemptID := uuid.New().String()
	leaseUntil := now.Add(leaseDuration)
	updates := map[string]any{
		"status":                "processing",
		"worker_id":             workerID,
		"attempt_id":            attemptID,
		"attempt_count":         gorm.Expr("COALESCE(attempt_count, 0) + 1"),
		"processing_started_at": now,
		"lease_until":           leaseUntil,
		"error_message":         nil,
		"updated_at":            now,
	}
	res := tx.Model(&domain.AnalysisTask{}).
		Where("id = ?", task.ID).
		Where("status = ? OR (status = ? AND (lease_until IS NULL OR lease_until <= ?))", "pending", "processing", now).
		Updates(updates)
	if res.Error != nil {
		return ClaimTaskResult{}, res.Error
	}
	if res.RowsAffected == 0 {
		return ClaimTaskResult{Task: task, Outcome: ClaimOutcomeLeaseActive}, nil
	}
	task.Status = "processing"
	task.WorkerID = &workerID
	task.AttemptID = &attemptID
	task.AttemptCount++
	task.ProcessingAt = &now
	task.LeaseUntil = &leaseUntil
	task.ErrorMessage = nil
	task.UpdatedAt = &now
	return ClaimTaskResult{Task: task, Outcome: ClaimOutcomeClaimed}, nil
}

func taskTypeAllowed(taskType string, taskTypes []string) bool {
	for _, allowed := range taskTypes {
		if taskType == allowed {
			return true
		}
	}
	return false
}

func (r *TaskRepo) GetTaskByID(ctx context.Context, taskID string) (*domain.AnalysisTask, error) {
	var task domain.AnalysisTask
	err := r.db.WithContext(ctx).Where("id = ?", taskID).First(&task).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &task, err
}

func (r *TaskRepo) ListTasksByUser(ctx context.Context, userID, taskType, status, search string, limit int) ([]domain.AnalysisTask, error) {
	return r.ListTasksByUserPage(ctx, userID, taskType, status, search, limit, 0)
}

func (r *TaskRepo) ListTasksByUserPage(ctx context.Context, userID, taskType, status, search string, limit, offset int) ([]domain.AnalysisTask, error) {
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	q := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC, id DESC").
		Limit(limit).
		Offset(offset)
	if taskType != "" {
		q = q.Where("task_type = ?", taskType)
	} else {
		q = applyAnalyzeHistoryTaskFilter(q)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if strings.TrimSpace(search) != "" {
		q = q.Where("search_text ILIKE ?", "%"+strings.TrimSpace(search)+"%")
	}
	var tasks []domain.AnalysisTask
	err := q.Find(&tasks).Error
	return tasks, err
}

func (r *TaskRepo) CountTasksByUser(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := applyAnalyzeHistoryTaskFilter(
		r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).Where("user_id = ?", userID),
	).Count(&count).Error
	return count, err
}

func (r *TaskRepo) CountTasksByStatus(ctx context.Context, userID string) (map[string]int64, error) {
	var rows []struct {
		Status string
		Count  int64
	}
	err := applyAnalyzeHistoryTaskFilter(
		r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).Where("user_id = ?", userID),
	).Select("status, count(*) as count").Group("status").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := map[string]int64{}
	for _, row := range rows {
		out[row.Status] = row.Count
	}
	return out, nil
}

func (r *TaskRepo) CountUnrecordedDoneTasksSince(ctx context.Context, userID string, since time.Time) (int64, error) {
	var count int64
	q := applyAnalyzeHistoryTaskFilter(
		r.db.WithContext(ctx).
			Model(&domain.AnalysisTask{}).
			Joins("LEFT JOIN user_food_records ON user_food_records.source_task_id = analysis_tasks.id AND user_food_records.user_id = analysis_tasks.user_id").
			Where("analysis_tasks.user_id = ?", userID).
			Where("analysis_tasks.status = ?", "done").
			Where("analysis_tasks.created_at > ?", since).
			Where("user_food_records.id IS NULL"),
	)
	err := q.Count(&count).Error
	return count, err
}

func (r *TaskRepo) RecordedTaskMap(ctx context.Context, userID string, taskIDs []string) (map[string]string, error) {
	out := map[string]string{}
	if len(taskIDs) == 0 {
		return out, nil
	}
	var rows []struct {
		ID           string `gorm:"column:id"`
		SourceTaskID string `gorm:"column:source_task_id"`
	}
	err := r.db.WithContext(ctx).Table("user_food_records").
		Select("id, source_task_id").
		Where("user_id = ?", userID).
		Where("source_task_id IN ?", taskIDs).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row.SourceTaskID != "" {
			out[row.SourceTaskID] = row.ID
		}
	}
	return out, nil
}

func applyAnalyzeHistoryTaskFilter(q *gorm.DB) *gorm.DB {
	return q.Where(
		`task_type IN ? OR task_type LIKE ? OR task_type LIKE ? OR task_type LIKE ? OR task_type LIKE ?`,
		[]string{"food", "food_text", "precision_plan", "precision_aggregate"},
		"food_debug%",
		"food_text_debug%",
		"precision_plan_debug%",
		"precision_aggregate_debug%",
	)
}

func (r *TaskRepo) UpdateTaskResult(ctx context.Context, taskID string, result map[string]any) error {
	var task domain.AnalysisTask
	if err := r.db.WithContext(ctx).Where("id = ?", taskID).First(&task).Error; err != nil {
		return err
	}
	task.Result = result
	now := time.Now()
	task.UpdatedAt = &now
	return r.db.WithContext(ctx).Save(&task).Error
}

func (r *TaskRepo) CompleteTask(ctx context.Context, taskID string, result map[string]any) (bool, error) {
	updates := map[string]any{
		"status":        "done",
		"result":        datatypes.JSONMap(result),
		"error_message": nil,
		"lease_until":   nil,
		"updated_at":    time.Now(),
	}
	res := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Where("id = ? AND status <> ?", taskID, "cancelled").
		Updates(updates)
	return res.RowsAffected > 0, res.Error
}

func (r *TaskRepo) CompleteTaskAttempt(ctx context.Context, taskID, attemptID string, result map[string]any) (bool, error) {
	if taskID == "" || attemptID == "" {
		return false, nil
	}
	updates := map[string]any{
		"status":        "done",
		"result":        datatypes.JSONMap(result),
		"error_message": nil,
		"lease_until":   nil,
		"updated_at":    time.Now(),
	}
	res := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Where("id = ? AND attempt_id = ? AND status = ?", taskID, attemptID, "processing").
		Updates(updates)
	return res.RowsAffected > 0, res.Error
}

func (r *TaskRepo) FailTask(ctx context.Context, taskID string, errorMsg string) (bool, error) {
	updates := map[string]any{
		"status":        "failed",
		"error_message": errorMsg,
		"lease_until":   nil,
		"updated_at":    time.Now(),
	}
	res := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Where("id = ? AND status <> ?", taskID, "cancelled").
		Updates(updates)
	return res.RowsAffected > 0, res.Error
}

func (r *TaskRepo) FailTaskAttempt(ctx context.Context, taskID, attemptID string, errorMsg string) (bool, error) {
	if taskID == "" || attemptID == "" {
		return false, nil
	}
	updates := map[string]any{
		"status":        "failed",
		"error_message": errorMsg,
		"lease_until":   nil,
		"updated_at":    time.Now(),
	}
	res := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Where("id = ? AND attempt_id = ? AND status = ?", taskID, attemptID, "processing").
		Updates(updates)
	return res.RowsAffected > 0, res.Error
}

func (r *TaskRepo) ExtendTaskLease(ctx context.Context, taskID, attemptID, workerID string, leaseUntil time.Time) (bool, error) {
	if taskID == "" || attemptID == "" || leaseUntil.IsZero() {
		return false, nil
	}
	updates := map[string]any{
		"lease_until": leaseUntil,
		"updated_at":  time.Now(),
	}
	if workerID != "" {
		updates["worker_id"] = workerID
	}
	res := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Where("id = ? AND attempt_id = ? AND status = ?", taskID, attemptID, "processing").
		Updates(updates)
	return res.RowsAffected > 0, res.Error
}

func (r *TaskRepo) UpdateTaskStatus(ctx context.Context, taskID string, status string, errorMsg *string) error {
	updates := map[string]any{"status": status, "updated_at": time.Now()}
	if errorMsg != nil {
		updates["error_message"] = *errorMsg
	}
	return r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).Where("id = ?", taskID).Updates(updates).Error
}

func (r *TaskRepo) DeleteTask(ctx context.Context, taskID, userID string) error {
	return r.db.WithContext(ctx).Where("id = ? AND user_id = ?", taskID, userID).Delete(&domain.AnalysisTask{}).Error
}

func (r *TaskRepo) MarkTimedOutTasks(ctx context.Context, timeoutMinutes int) (int64, error) {
	if timeoutMinutes <= 0 {
		timeoutMinutes = 5
	}
	cutoff := time.Now().Add(-time.Duration(timeoutMinutes) * time.Minute)
	res := r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Where("(status = ? AND created_at < ?) OR (status = ? AND (lease_until IS NULL OR lease_until < ?))", "pending", cutoff, "processing", cutoff).
		Updates(map[string]any{"status": "timed_out", "updated_at": time.Now()})
	return res.RowsAffected, res.Error
}

func (r *TaskRepo) ListRecoverableTasks(ctx context.Context, taskTypes []string, limit int, now time.Time) ([]domain.AnalysisTask, error) {
	if len(taskTypes) == 0 {
		return nil, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if now.IsZero() {
		now = time.Now()
	}
	var tasks []domain.AnalysisTask
	err := r.db.WithContext(ctx).
		Select("id", "task_type", "status", "lease_until").
		Where("task_type IN ?", taskTypes).
		Where("status = ? OR (status = ? AND (lease_until IS NULL OR lease_until <= ?))", "pending", "processing", now).
		Order("created_at ASC").
		Limit(limit).
		Find(&tasks).Error
	return tasks, err
}

// TryTaskRecoveryLeadership elects one recovery loop per queue by holding a
// PostgreSQL session advisory lock for the lifetime of fn. Recovery queries and
// queue publishes deliberately run outside a database transaction.
func (r *TaskRepo) TryTaskRecoveryLeadership(ctx context.Context, lockKey string, fn func(context.Context) error) (bool, error) {
	lockKey = strings.TrimSpace(lockKey)
	if lockKey == "" {
		return false, errors.New("task recovery lock key is required")
	}
	if fn == nil {
		return false, errors.New("task recovery leader function is required")
	}

	acquired := false
	err := r.db.WithContext(ctx).Connection(func(connection *gorm.DB) error {
		if err := connection.Raw(
			"SELECT pg_try_advisory_lock(hashtextextended(?, 0))",
			lockKey,
		).Scan(&acquired).Error; err != nil {
			return err
		}
		if !acquired {
			return nil
		}

		defer func() {
			unlockDB := connection.Session(&gorm.Session{NewDB: true}).WithContext(context.Background())
			_ = unlockDB.Exec(
				"SELECT pg_advisory_unlock(hashtextextended(?, 0))",
				lockKey,
			).Error
		}()

		return fn(ctx)
	})
	return acquired, err
}
