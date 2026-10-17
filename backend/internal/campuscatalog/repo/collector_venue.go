package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	"gorm.io/gorm"
)

func (r *CatalogRepo) FindVenueCollectorApplication(ctx context.Context, userID, venueType, organization, canteen string) (*domain.CollectorApplication, error) {
	var application domain.CollectorApplication
	err := r.db.WithContext(ctx).Where("user_id = ? AND school_id IS NULL AND venue_type = ? AND LOWER(BTRIM(organization_name)) = ? AND LOWER(BTRIM(scope_canteen_name)) = ? AND status = ?",
		strings.TrimSpace(userID), venueType, domain.CollectorPlaceKey(organization), domain.CollectorPlaceKey(canteen), "pending").
		Order("created_at DESC").First(&application).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &application, err
}

func (r *CatalogRepo) HasActiveVenueCollectorScope(ctx context.Context, userID, venueType, organization, canteen string, now time.Time) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.CollectorScope{}).
		Where("user_id = ? AND school_id IS NULL AND venue_type = ? AND LOWER(BTRIM(organization_name)) = ? AND status = ?",
			strings.TrimSpace(userID), venueType, domain.CollectorPlaceKey(organization), "active").
		Where("expires_at IS NULL OR expires_at > ?", now).
		Where("scope_canteen_name = '' OR LOWER(BTRIM(scope_canteen_name)) = ?", domain.CollectorPlaceKey(canteen)).Count(&count).Error
	return count > 0, err
}
