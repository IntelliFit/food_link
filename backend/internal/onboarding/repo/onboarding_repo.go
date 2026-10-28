package repo

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"food_link/backend/internal/onboarding/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type OnboardingRepo struct {
	db *gorm.DB
}

func NewOnboardingRepo(db *gorm.DB) *OnboardingRepo {
	return &OnboardingRepo{db: db}
}

// GetConfig returns the stored JSON for a key, or nil when no row exists yet.
func (r *OnboardingRepo) GetConfig(ctx context.Context, key string) (json.RawMessage, error) {
	var row domain.ContentConfig
	err := r.db.WithContext(ctx).Where("config_key = ?", key).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return row.Value, nil
}

func (r *OnboardingRepo) SaveConfig(ctx context.Context, key string, value json.RawMessage, updatedBy string) error {
	row := domain.ContentConfig{Key: key, Value: value, UpdatedAt: time.Now(), UpdatedBy: updatedBy}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "config_key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at", "updated_by"}),
	}).Create(&row).Error
}

// ReserveTry checks the daily caps and records the try in one transaction
// under an advisory lock, so concurrent requests cannot all slip past a cap.
// With nil limits (a logged-in user) the try is only recorded.
func (r *OnboardingRepo) ReserveTry(ctx context.Context, anonID, userID string, props map[string]any, at, since time.Time, limits *domain.TryLimits) (domain.TryVerdict, error) {
	if props == nil {
		props = map[string]any{}
	}
	raw, err := json.Marshal(props)
	if err != nil {
		return "", err
	}
	verdict := domain.TryAllowed
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if limits != nil {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", domain.TryEventName).Error; err != nil {
				return err
			}
			mine, err := countTries(tx, anonID, since)
			if err != nil {
				return err
			}
			if mine >= int64(limits.PerInstall) {
				verdict = domain.TryInstallCapped
				return nil
			}
			all, err := countTries(tx, "", since)
			if err != nil {
				return err
			}
			if all >= int64(limits.Global) {
				verdict = domain.TryGlobalCapped
				return nil
			}
		}
		var user any
		if userID != "" {
			user = userID
		}
		return tx.Exec(
			`INSERT INTO app_events (id, anon_id, user_id, name, props, created_at) VALUES (?, ?, ?, ?, ?::jsonb, ?)`,
			uuid.NewString(), anonID, user, domain.TryEventName, string(raw), at,
		).Error
	})
	return verdict, err
}

// countTries counts tries since a moment; an empty anonID counts all installs.
func countTries(tx *gorm.DB, anonID string, since time.Time) (int64, error) {
	q := tx.Table("app_events").Where("name = ? AND created_at >= ?", domain.TryEventName, since)
	if anonID != "" {
		q = q.Where("anon_id = ?", anonID)
	}
	var n int64
	err := q.Count(&n).Error
	return n, err
}

// FoodSources returns the raw `source` of matched standard foods, keyed by id.
func (r *OnboardingRepo) FoodSources(ctx context.Context, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []struct {
		ID     string `gorm:"column:id"`
		Source string `gorm:"column:source"`
	}
	if err := r.db.WithContext(ctx).Raw(
		`SELECT id::text AS id, COALESCE(source, '') AS source FROM food_nutrition_library WHERE id::text IN ?`, ids,
	).Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.ID] = row.Source
	}
	return out, nil
}

// Stats counts only what is live: active foods, published campus dishes,
// reviewed packaged foods. Drafts and the school directory are left out.
func (r *OnboardingRepo) Stats(ctx context.Context) (domain.Stats, error) {
	var s domain.Stats
	err := r.db.WithContext(ctx).Raw(`
SELECT
  (SELECT count(*) FROM food_nutrition_library WHERE is_active) AS standard_foods,
  (SELECT count(*) FROM food_nutrition_library WHERE is_active AND quality_tier = 'authoritative') AS authoritative_foods,
  (SELECT count(*) FROM campus_food_catalog_items WHERE status = 'published') AS campus_dishes,
  (SELECT count(DISTINCT school_id) FROM campus_food_catalog_items WHERE status = 'published') AS campus_schools,
  (SELECT count(*) FROM packaged_food_library WHERE is_active AND review_status IN ('active', 'web_verified')) AS packaged_foods,
  (SELECT count(*) FROM weapp_user) AS users,
  (SELECT count(*) FROM user_food_records) AS food_records`).Scan(&s).Error
	return s, err
}
