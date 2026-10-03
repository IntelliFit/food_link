package repo

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/internal/push/domain"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	gormlogger "gorm.io/gorm/logger"
)

type Repository struct{ db *gorm.DB }

// Disable SQL logging in this module: device tokens must never appear in interpolated SQL.
func New(db *gorm.DB) *Repository {
	return &Repository{db: db.Session(&gorm.Session{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})}
}

type Settings struct {
	UserID      string
	Preferences domain.Preferences
	UpdatedAt   time.Time
}

func preferences(row migrationdo.PushPreferencesDO) Settings {
	p := domain.DefaultPreferences()
	b, _ := json.Marshal(row.Settings)
	_ = json.Unmarshal(b, &p)
	return Settings{UserID: row.UserID, Preferences: p, UpdatedAt: row.UpdatedAt}
}

func (r *Repository) GetPreferences(ctx context.Context, userID string) (Settings, error) {
	row := migrationdo.PushPreferencesDO{UserID: userID}
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return preferences(row), nil
	}
	return preferences(row), err
}

func (r *Repository) SavePreferences(ctx context.Context, userID string, p domain.Preferences) error {
	b, _ := json.Marshal(p)
	settings := map[string]any{}
	_ = json.Unmarshal(b, &settings)
	row := migrationdo.PushPreferencesDO{UserID: userID, Settings: settings, UpdatedAt: time.Now().UTC()}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, DoUpdates: clause.AssignmentColumns([]string{"settings", "updated_at"})}).Create(&row).Error
}

func (r *Repository) ListPreferences(ctx context.Context, after string) ([]Settings, error) {
	var rows []migrationdo.PushPreferencesDO
	err := r.db.WithContext(ctx).Where("user_id::text > ? AND settings->>'enabled' = 'true'", after).
		Where("EXISTS (SELECT 1 FROM push_devices d WHERE d.user_id = push_reminder_preferences.user_id AND d.active AND d.last_seen_at > ?)", time.Now().AddDate(0, 0, -30)).
		Order("user_id").Limit(100).Find(&rows).Error
	out := make([]Settings, 0, len(rows))
	for _, row := range rows {
		out = append(out, preferences(row))
	}
	return out, err
}

func (r *Repository) Register(ctx context.Context, row migrationdo.PushDeviceDO) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Serialize renewals of the same Expo token across app instances.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", row.Token).Error; err != nil {
			return err
		}
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", "push-user:"+row.UserID).Error; err != nil {
			return err
		}
		if err := tx.Model(&migrationdo.PushDeviceDO{}).Where("token = ? AND id <> ?", row.Token, row.ID).Updates(map[string]any{"active": false, "updated_at": row.UpdatedAt}).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.AssignmentColumns([]string{"user_id", "token", "project_id", "platform", "active", "last_seen_at", "updated_at"})}).Create(&row).Error; err != nil {
			return err
		}
		// Keep at most five active installations per account.
		return tx.Exec("UPDATE push_devices SET active = false, updated_at = ? WHERE id IN (SELECT id FROM push_devices WHERE user_id = ? AND active ORDER BY last_seen_at DESC, id OFFSET 5)", row.UpdatedAt, row.UserID).Error
	})
}

func (r *Repository) Revoke(ctx context.Context, userID, id string) error {
	return r.db.WithContext(ctx).Model(&migrationdo.PushDeviceDO{}).Where("id = ? AND user_id = ?", id, userID).Updates(map[string]any{"active": false, "updated_at": time.Now()}).Error
}

func (r *Repository) Devices(ctx context.Context, userID string) ([]migrationdo.PushDeviceDO, error) {
	var rows []migrationdo.PushDeviceDO
	err := r.db.WithContext(ctx).Where("user_id = ? AND active AND last_seen_at > ?", userID, time.Now().AddDate(0, 0, -30)).Find(&rows).Error
	return rows, err
}

func (r *Repository) Device(ctx context.Context, id string) (*migrationdo.PushDeviceDO, error) {
	var row migrationdo.PushDeviceDO
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func TokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (r *Repository) HasRecord(ctx context.Context, userID, meal string, start, end time.Time) (bool, error) {
	var n int64
	q := r.db.WithContext(ctx).Table("user_food_records").Where("user_id = ? AND record_time >= ? AND record_time < ?", userID, start, end)
	if meal != "" {
		q = q.Where("meal_type = ?", meal)
	}
	err := q.Count(&n).Error
	return n > 0, err
}

func (r *Repository) HasExpiring(ctx context.Context, userID, date, endDate string) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).Table("food_expiry_items").Where("user_id = ? AND status = 'active' AND expire_date >= ? AND expire_date <= ?", userID, date, endDate).Count(&n).Error
	return n > 0, err
}

func (r *Repository) Enqueue(ctx context.Context, row migrationdo.PushDeliveryDO) error {
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "dedupe_key"}}, DoNothing: true}).Create(&row).Error
}

// A transaction-scoped planner lock avoids each server replica scanning every account.
func (r *Repository) PlanWithLock(ctx context.Context, fn func() error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var locked bool
		if err := tx.Raw("SELECT pg_try_advisory_xact_lock(721036041)").Scan(&locked).Error; err != nil {
			return err
		}
		if !locked {
			return nil
		}
		return fn()
	})
}

func (r *Repository) Claim(ctx context.Context, now time.Time, receipt bool) (*migrationdo.PushDeliveryDO, error) {
	var claimed *migrationdo.PushDeliveryDO
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row migrationdo.PushDeliveryDO
		q := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		status := "processing"
		if receipt {
			q = q.Where("(status = 'accepted' AND receipt_check_at <= ?) OR (status = 'receipt_processing' AND lease_until <= ?)", now, now)
			status = "receipt_processing"
		} else {
			q = q.Where("(status = 'pending' AND not_before <= ?) OR (status = 'processing' AND lease_until <= ?)", now, now)
		}
		err := q.Order("not_before, id").First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		lease := now.Add(2 * time.Minute)
		row.Status = status
		row.LeaseID = uuid.NewString()
		row.LeaseUntil = &lease
		if !receipt {
			row.Attempts++
		}
		if err = tx.Model(&row).Updates(map[string]any{"status": status, "lease_id": row.LeaseID, "lease_until": lease, "attempts": row.Attempts, "updated_at": now}).Error; err != nil {
			return err
		}
		claimed = &row
		return nil
	})
	return claimed, err
}

func (r *Repository) Finish(ctx context.Context, row *migrationdo.PushDeliveryDO, changes map[string]any) error {
	changes["updated_at"] = time.Now()
	changes["lease_until"] = nil
	changes["lease_id"] = ""
	return r.db.WithContext(ctx).Model(&migrationdo.PushDeliveryDO{}).Where("id = ? AND lease_id = ?", row.ID, row.LeaseID).Updates(changes).Error
}

func (r *Repository) DisableToken(ctx context.Context, id, hash string) error {
	row, err := r.Device(ctx, id)
	if err != nil || row == nil {
		return err
	}
	if TokenHash(row.Token) != hash {
		return nil
	}
	return r.db.WithContext(ctx).Model(&migrationdo.PushDeviceDO{}).Where("id = ? AND token = ?", id, row.Token).Updates(map[string]any{"active": false, "updated_at": time.Now()}).Error
}

func (r *Repository) Cleanup(ctx context.Context, now time.Time) error {
	// Keep only 30 days of operational metadata; inactive tokens are no longer needed.
	if err := r.db.WithContext(ctx).Where("created_at < ? AND status NOT IN ('processing','receipt_processing')", now.AddDate(0, 0, -30)).Delete(&migrationdo.PushDeliveryDO{}).Error; err != nil {
		return err
	}
	return r.db.WithContext(ctx).Where("last_seen_at < ?", now.AddDate(0, 0, -30)).Delete(&migrationdo.PushDeviceDO{}).Error
}
