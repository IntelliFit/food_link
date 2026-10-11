package repo

import (
	"context"
	"errors"
	"time"

	"food_link/backend/internal/productupdate/domain"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrConflict = errors.New("product update status conflict")

type Repository struct{ db *gorm.DB }

func New(db *gorm.DB) *Repository { return &Repository{db: db} }

func (r *Repository) List(ctx context.Context, userID string, admin bool) ([]domain.Update, error) {
	items := make([]domain.Update, 0)
	q := r.db.WithContext(ctx).Model(&domain.Update{})
	if admin {
		q = q.Select("product_updates.*, (SELECT COUNT(*) FROM product_update_acknowledgements a WHERE a.update_id = product_updates.id) AS acknowledged")
	} else {
		q = q.Where("status = ?", "published")
		if userID != "" {
			q = q.Where("NOT EXISTS (SELECT 1 FROM product_update_acknowledgements a WHERE a.update_id = product_updates.id AND a.user_id = ?)", userID)
		}
	}
	// Oldest first: an unacknowledged notice cannot be displaced by new ones.
	err := q.Order("created_at ASC, id ASC").Find(&items).Error
	return items, err
}

func (r *Repository) Create(ctx context.Context, item *domain.Update) error {
	item.ID, item.CreatedAt, item.Status = uuid.NewString(), time.Now(), "draft"
	return r.db.WithContext(ctx).Omit("Acknowledged").Create(item).Error
}

func (r *Repository) Edit(ctx context.Context, id string, patch map[string]any) error {
	result := r.db.WithContext(ctx).Model(&domain.Update{}).Where("id = ? AND status = 'draft'", id).Updates(patch)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrConflict
	}
	return nil
}

func (r *Repository) Transition(ctx context.Context, id, from, to string) error {
	patch := map[string]any{"status": to}
	if to == "published" {
		patch["published_at"] = time.Now()
	}
	result := r.db.WithContext(ctx).Model(&domain.Update{}).Where("id = ? AND status = ?", id, from).Updates(patch)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrConflict
	}
	return nil
}

func (r *Repository) Acknowledge(ctx context.Context, id, userID string, eligible func(domain.Update) bool) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var item domain.Update
		// Serializes acknowledgement with withdrawal; no receipt for a draft.
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&item, "id = ?", id).Error; err != nil {
			return err
		}
		if item.Status != "published" || !eligible(item) {
			return ErrConflict
		}
		return tx.Table("product_update_acknowledgements").Clauses(clause.OnConflict{DoNothing: true}).Create(map[string]any{
			"update_id": id, "user_id": userID, "acknowledged_at": time.Now(),
		}).Error
	})
}
