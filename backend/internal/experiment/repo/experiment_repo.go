package repo

import (
	"context"
	"errors"
	"time"

	"food_link/backend/internal/experiment/domain"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ExperimentRepo struct {
	db *gorm.DB
}

func NewExperimentRepo(db *gorm.DB) *ExperimentRepo {
	return &ExperimentRepo{db: db}
}

// TouchVisitor inserts the visitor on first sight, refreshes last_seen and
// client fields after that, and binds the account the first time a logged-in
// request arrives. first_seen_at and an existing binding are never changed.
func (r *ExperimentRepo) TouchVisitor(ctx context.Context, v domain.Visitor) (domain.Visitor, error) {
	updates := map[string]any{
		"last_seen_at": v.LastSeenAt,
		"platform":     v.Platform,
		"app_version":  v.AppVersion,
	}
	if v.UserID != nil {
		updates["user_id"] = gorm.Expr("COALESCE(app_visitors.user_id, ?)", *v.UserID)
		updates["bound_at"] = gorm.Expr("CASE WHEN app_visitors.user_id IS NULL THEN ? ELSE app_visitors.bound_at END", v.LastSeenAt)
		v.BoundAt = &v.LastSeenAt
	}
	var stored domain.Visitor
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "anon_id"}},
			DoUpdates: clause.Assignments(updates),
		}).Create(&v).Error; err != nil {
			return err
		}
		return tx.Where("anon_id = ?", v.AnonID).First(&stored).Error
	})
	return stored, err
}

func (r *ExperimentRepo) ListServableExperiments(ctx context.Context) ([]domain.Experiment, error) {
	var out []domain.Experiment
	err := r.db.WithContext(ctx).
		Where("status IN ?", []string{domain.StatusRunning, domain.StatusStopped}).
		Order("experiment_key").
		Find(&out).Error
	return out, err
}

func (r *ExperimentRepo) FindAssignmentByUser(ctx context.Context, key, userID string) (*domain.Assignment, error) {
	return r.findAssignment(ctx, "experiment_key = ? AND user_id = ?", key, userID)
}

func (r *ExperimentRepo) FindAssignmentByAnon(ctx context.Context, key, anonID string) (*domain.Assignment, error) {
	return r.findAssignment(ctx, "experiment_key = ? AND anon_id = ?", key, anonID)
}

func (r *ExperimentRepo) findAssignment(ctx context.Context, where string, args ...any) (*domain.Assignment, error) {
	var a domain.Assignment
	err := r.db.WithContext(ctx).Where(where, args...).Order("assigned_at").First(&a).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// CreateAssignment keeps the first row when two requests race, either from
// the same install (anon unique key) or the same account on two phones (user
// partial unique key), and returns whichever row won.
func (r *ExperimentRepo) CreateAssignment(ctx context.Context, a domain.Assignment) (domain.Assignment, error) {
	if err := r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&a).Error; err != nil {
		return domain.Assignment{}, err
	}
	stored, err := r.FindAssignmentByAnon(ctx, a.ExperimentKey, a.AnonID)
	if err == nil && stored == nil && a.UserID != nil {
		stored, err = r.FindAssignmentByUser(ctx, a.ExperimentKey, *a.UserID)
	}
	if err != nil {
		return domain.Assignment{}, err
	}
	if stored == nil {
		return domain.Assignment{}, errors.New("分组记录写入后未找到")
	}
	return *stored, nil
}

// BindAssignment attaches the account to a pre-login row once. It reports
// false when the row was already bound or the account already owns a row in
// this experiment, so the caller can re-read instead of trusting its copy.
func (r *ExperimentRepo) BindAssignment(ctx context.Context, id, key, userID string, excludedReason *string) (bool, error) {
	res := r.db.WithContext(ctx).Exec(`
UPDATE experiment_assignments SET user_id = ?, excluded_reason = ?
WHERE id = ? AND user_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM experiment_assignments o WHERE o.experiment_key = ? AND o.user_id = ?)`,
		userID, excludedReason, id, key, userID)
	if res.Error != nil {
		var pgErr *pgconn.PgError
		if errors.As(res.Error, &pgErr) && pgErr.Code == "23505" {
			return false, nil
		}
		return false, res.Error
	}
	return res.RowsAffected == 1, nil
}

// ExcludeUnboundAnon retires this install's pre-login row once the account
// is known to be enrolled through another row.
func (r *ExperimentRepo) ExcludeUnboundAnon(ctx context.Context, key, anonID, reason string) error {
	return r.db.WithContext(ctx).Model(&domain.Assignment{}).
		Where("experiment_key = ? AND anon_id = ? AND user_id IS NULL AND excluded_reason IS NULL", key, anonID).
		Update("excluded_reason", reason).Error
}

func (r *ExperimentRepo) UserCreatedAt(ctx context.Context, userID string) (time.Time, bool, error) {
	var rows []struct {
		CreateTime *time.Time `gorm:"column:create_time"`
	}
	if err := r.db.WithContext(ctx).Raw("SELECT create_time FROM weapp_user WHERE id = ?", userID).Scan(&rows).Error; err != nil {
		return time.Time{}, false, err
	}
	if len(rows) == 0 || rows[0].CreateTime == nil {
		return time.Time{}, false, nil
	}
	return *rows[0].CreateTime, true, nil
}

func (r *ExperimentRepo) MarkExposed(ctx context.Context, anonID, userID string, keys []string, at time.Time) (int64, error) {
	q := r.db.WithContext(ctx).Model(&domain.Assignment{}).
		Where("experiment_key IN ? AND first_exposed_at IS NULL AND excluded_reason IS NULL", keys)
	if userID != "" {
		q = q.Where("(anon_id = ? OR user_id = ?)", anonID, userID)
	} else {
		q = q.Where("anon_id = ?", anonID)
	}
	res := q.Update("first_exposed_at", at)
	return res.RowsAffected, res.Error
}

func (r *ExperimentRepo) InsertEvents(ctx context.Context, events []domain.Event) error {
	if len(events) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Create(&events).Error
}

func (r *ExperimentRepo) ListExperiments(ctx context.Context) ([]domain.Experiment, error) {
	var out []domain.Experiment
	err := r.db.WithContext(ctx).Order("created_at DESC").Find(&out).Error
	return out, err
}

func (r *ExperimentRepo) GetExperiment(ctx context.Context, key string) (*domain.Experiment, error) {
	var e domain.Experiment
	err := r.db.WithContext(ctx).Where("experiment_key = ?", key).First(&e).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *ExperimentRepo) SaveExperiment(ctx context.Context, e domain.Experiment) error {
	return r.db.WithContext(ctx).Save(&e).Error
}

// Summary counts each arm. Outcome windows start at first exposure, read the
// existing business tables, and only count units whose window has elapsed.
// AI use means food analysis (photo, text, precision), matching the quota rule,
// plus the onboarding guest try ('srv.onboarding_try'), which writes no task.
func (r *ExperimentRepo) Summary(ctx context.Context, key string) ([]domain.VariantSummary, error) {
	const counted = "a.first_exposed_at IS NOT NULL AND a.excluded_reason IS NULL"
	const matured24 = counted + " AND a.first_exposed_at <= now() - interval '24 hours'"
	const matured48 = counted + " AND a.first_exposed_at <= now() - interval '48 hours'"
	query := `
SELECT a.variant,
  COUNT(*) AS assigned,
  COUNT(*) FILTER (WHERE a.excluded_reason IS NOT NULL) AS excluded,
  COUNT(*) FILTER (WHERE ` + counted + `) AS exposed,
  COUNT(*) FILTER (WHERE ` + counted + ` AND a.user_id IS NOT NULL) AS exposed_logged_in,
  COUNT(*) FILTER (WHERE ` + matured24 + `) AS matured_24h,
  COUNT(*) FILTER (WHERE ` + matured48 + `) AS matured_48h,
  COUNT(*) FILTER (WHERE ` + matured24 + ` AND EXISTS (
    SELECT 1 FROM analysis_tasks t WHERE t.user_id = a.user_id
      AND t.created_at >= a.first_exposed_at AND t.created_at < a.first_exposed_at + interval '24 hours'
      AND (t.task_type IN ('food', 'food_text') OR t.task_type LIKE 'food\_debug%' OR t.task_type LIKE 'food\_text\_debug%' OR t.task_type LIKE 'precision\_plan%')
      AND lower(COALESCE(t.payload->>'exercise', 'false')) NOT IN ('true', '1'))
    OR EXISTS (
    SELECT 1 FROM app_events e WHERE e.anon_id = a.anon_id AND e.name = 'srv.onboarding_try'
      AND e.created_at >= a.first_exposed_at AND e.created_at < a.first_exposed_at + interval '24 hours')) AS ai_within_24h,
  COUNT(*) FILTER (WHERE ` + matured24 + ` AND EXISTS (
    SELECT 1 FROM user_food_records f WHERE f.user_id = a.user_id
      AND f.created_at >= a.first_exposed_at AND f.created_at < a.first_exposed_at + interval '24 hours')) AS record_within_24h,
  COUNT(*) FILTER (WHERE ` + matured48 + ` AND EXISTS (
    SELECT 1 FROM user_food_records f WHERE f.user_id = a.user_id
      AND f.created_at >= a.first_exposed_at + interval '24 hours' AND f.created_at < a.first_exposed_at + interval '48 hours')) AS record_on_second_day
FROM experiment_assignments a
WHERE a.experiment_key = ?
GROUP BY a.variant
ORDER BY a.variant`
	var out []domain.VariantSummary
	err := r.db.WithContext(ctx).Raw(query, key).Scan(&out).Error
	return out, err
}
