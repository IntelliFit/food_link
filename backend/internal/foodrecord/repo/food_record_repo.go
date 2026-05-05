package repo

import (
	"context"

	"food_link/backend/internal/foodrecord/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type FoodRecordRepo struct {
	db *gorm.DB
}

func NewFoodRecordRepo(db *gorm.DB) *FoodRecordRepo {
	return &FoodRecordRepo{db: db}
}

func (r *FoodRecordRepo) Create(ctx context.Context, record *domain.FoodRecord) error {
	if record.ID == "" {
		record.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(record).Error
}

func (r *FoodRecordRepo) ListByUser(ctx context.Context, userID, date string, limit int) ([]domain.FoodRecord, error) {
	var rows []domain.FoodRecord
	q := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if date != "" {
		start, end, err := chinaDateWindow(date)
		if err != nil {
			return nil, err
		}
		q = q.Where("record_time >= ? AND record_time < ?", start, end)
	}
	if limit > 0 {
		q = q.Limit(limit)
	}
	err := q.Order("record_time desc").Find(&rows).Error
	return rows, err
}

func (r *FoodRecordRepo) GetByID(ctx context.Context, recordID string) (*domain.FoodRecord, error) {
	var row domain.FoodRecord
	if err := r.db.WithContext(ctx).Where("id = ?", recordID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *FoodRecordRepo) Update(ctx context.Context, userID, recordID string, updates map[string]any) (*domain.FoodRecord, error) {
	result := r.db.WithContext(ctx).Model(&domain.FoodRecord{}).Where("id = ? AND user_id = ?", recordID, userID).Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	return r.GetByID(ctx, recordID)
}

func (r *FoodRecordRepo) Delete(ctx context.Context, userID, recordID string) error {
	result := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", recordID, userID).Delete(&domain.FoodRecord{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *FoodRecordRepo) InsertCriticalSamples(ctx context.Context, userID string, items []domain.CriticalSample) error {
	if len(items) == 0 {
		return nil
	}
	rows := make([]domain.CriticalSample, len(items))
	for i, it := range items {
		rows[i] = it
		rows[i].UserID = userID
		if rows[i].ID == "" {
			rows[i].ID = uuid.New().String()
		}
	}
	return r.db.WithContext(ctx).Create(&rows).Error
}
