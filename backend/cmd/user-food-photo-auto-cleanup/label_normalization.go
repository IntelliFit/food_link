package main

import (
	"context"
	"fmt"
	"slices"
	"time"

	adminrepo "food_link/backend/internal/admin/repo"
	adminservice "food_link/backend/internal/admin/service"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type labelNormalizationStats struct {
	Total               int
	Changed             int
	DessertMerged       int
	PackagedFoodRemoved int
}

type labelNormalizationUpdate struct {
	ID     string
	Labels []string
}

func planPhotoLabelNormalizations(rows []adminrepo.UserFoodPhotoAnnotation) ([]labelNormalizationUpdate, labelNormalizationStats, error) {
	stats := labelNormalizationStats{Total: len(rows)}
	updates := make([]labelNormalizationUpdate, 0)
	for _, row := range rows {
		rawLabels := []string(row.Labels)
		for _, label := range rawLabels {
			switch label {
			case "dessert":
				stats.DessertMerged++
			case "packaged_food":
				stats.PackagedFoodRemoved++
			}
		}
		normalized, valid := adminservice.NormalizeUserFoodPhotoLabels(rawLabels)
		if !valid {
			return nil, stats, fmt.Errorf("标注 %s 包含未知标签", row.ID)
		}
		if slices.Equal(rawLabels, normalized) {
			continue
		}
		updates = append(updates, labelNormalizationUpdate{ID: row.ID, Labels: normalized})
	}
	stats.Changed = len(updates)
	return updates, stats, nil
}

func normalizeStoredPhotoLabels(ctx context.Context, db *gorm.DB, apply bool) (labelNormalizationStats, error) {
	var rows []adminrepo.UserFoodPhotoAnnotation
	if err := db.WithContext(ctx).Select("id", "labels").Order("id").Find(&rows).Error; err != nil {
		return labelNormalizationStats{}, err
	}
	updates, stats, err := planPhotoLabelNormalizations(rows)
	if err != nil || !apply || len(updates) == 0 {
		return stats, err
	}
	now := time.Now()
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, update := range updates {
			result := tx.Model(&adminrepo.UserFoodPhotoAnnotation{}).
				Where("id = ?", update.ID).
				Updates(map[string]any{
					"labels":     datatypes.NewJSONSlice(update.Labels),
					"updated_at": now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf("标注 %s 更新行数异常: %d", update.ID, result.RowsAffected)
			}
		}
		return nil
	})
	return stats, err
}
