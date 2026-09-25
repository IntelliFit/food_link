package repo

import (
	"context"
	"errors"
	"time"

	"food_link/backend/internal/marketingqr/catalog"
	"food_link/backend/internal/marketingqr/domain"
	publicfooddomain "food_link/backend/internal/publicfood/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type MarketingQRRepo struct {
	db *gorm.DB
}

func NewMarketingQRRepo(db *gorm.DB) *MarketingQRRepo {
	return &MarketingQRRepo{db: db}
}

func (r *MarketingQRRepo) FindPublishedCampaignFood(ctx context.Context, code, merchantName, foodName string) (*publicfooddomain.PublicFoodItem, error) {
	var item publicfooddomain.PublicFoodItem
	q := r.db.WithContext(ctx).
		Table("public_food_library").
		Where("status = ?", "published")
	if itemID, ok := catalog.PublicFoodItemID(code); ok {
		q = q.Where("id = ? OR (merchant_name = ? AND food_name = ?)", itemID, merchantName, foodName).
			Order(gorm.Expr("CASE WHEN id = ? THEN 0 ELSE 1 END", itemID))
	} else {
		q = q.Where("merchant_name = ? AND food_name = ?", merchantName, foodName)
	}
	err := q.Order("updated_at DESC NULLS LAST, created_at DESC NULLS LAST").
		First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *MarketingQRRepo) RecordEvent(ctx context.Context, code, visitorID, userID, eventType string, metadata map[string]any) error {
	now := time.Now()
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		attribution := domain.Attribution{
			ID:           uuid.NewString(),
			CampaignCode: code,
			VisitorID:    visitorID,
			FirstSeenAt:  now,
			LastSeenAt:   now,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "campaign_code"}, {Name: "visitor_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"last_seen_at": now,
				"updated_at":   now,
			}),
		}).Create(&attribution).Error; err != nil {
			return err
		}

		var userIDPtr *string
		if userID != "" {
			userIDPtr = &userID
		}
		return tx.Create(&domain.Event{
			ID:           uuid.NewString(),
			CampaignCode: code,
			VisitorID:    visitorID,
			UserID:       userIDPtr,
			EventType:    eventType,
			Metadata:     metadata,
			CreatedAt:    now,
		}).Error
	})
}

func (r *MarketingQRRepo) BindUser(ctx context.Context, code, visitorID, userID string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Keep one stable first-touch campaign per registered user. A later scan may
		// still be recorded as an event, but it must not overwrite registration and
		// payment attribution from the campaign that originally acquired the user.
		var existing domain.Attribution
		err := tx.Where("user_id = ?", userID).First(&existing).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		attribution := domain.Attribution{
			ID:           uuid.NewString(),
			CampaignCode: code,
			VisitorID:    visitorID,
			UserID:       &userID,
			FirstSeenAt:  now,
			LastSeenAt:   now,
			BoundAt:      &now,
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "campaign_code"}, {Name: "visitor_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"user_id":      userID,
				"bound_at":     now,
				"last_seen_at": now,
				"updated_at":   now,
			}),
		}).Create(&attribution).Error; err != nil {
			return err
		}
		return tx.Create(&domain.Event{
			ID:           uuid.NewString(),
			CampaignCode: code,
			VisitorID:    visitorID,
			UserID:       &userID,
			EventType:    "user_bound",
			Metadata:     map[string]any{},
			CreatedAt:    now,
		}).Error
	})
}

type SummaryCounts struct {
	CampaignCode       string `gorm:"column:campaign_code"`
	LandingViews       int64  `gorm:"column:landing_views"`
	UniqueVisitors     int64  `gorm:"column:unique_visitors"`
	RegistrationClicks int64  `gorm:"column:registration_clicks"`
	RegisteredUsers    int64  `gorm:"column:registered_users"`
	PaidUsers          int64  `gorm:"column:paid_users"`
}

func (r *MarketingQRRepo) Summary(ctx context.Context) ([]SummaryCounts, error) {
	var rows []SummaryCounts
	err := r.db.WithContext(ctx).Raw(`
		WITH event_stats AS (
			SELECT campaign_code,
				COUNT(*) FILTER (WHERE event_type = 'landing_view') AS landing_views,
				COUNT(DISTINCT visitor_id) FILTER (WHERE event_type = 'landing_view') AS unique_visitors,
				COUNT(*) FILTER (WHERE event_type = 'register_click') AS registration_clicks
			FROM marketing_qr_events
			GROUP BY campaign_code
		), attribution_stats AS (
			SELECT a.campaign_code,
				COUNT(DISTINCT a.user_id) FILTER (
					WHERE a.user_id IS NOT NULL AND u.create_time >= a.first_seen_at - INTERVAL '5 minutes'
				) AS registered_users,
				COUNT(DISTINCT a.user_id) FILTER (
					WHERE a.user_id IS NOT NULL AND EXISTS (
						SELECT 1 FROM pro_membership_payment_records p
						WHERE p.user_id = a.user_id AND p.status = 'paid'
						AND COALESCE(p.paid_at, p.created_at) >= a.first_seen_at
					)
				) AS paid_users
			FROM marketing_qr_attributions a
			LEFT JOIN weapp_user u ON u.id = a.user_id
			GROUP BY a.campaign_code
		), codes AS (
			SELECT campaign_code FROM event_stats
			UNION SELECT campaign_code FROM attribution_stats
		)
		SELECT c.campaign_code,
			COALESCE(e.landing_views, 0) AS landing_views,
			COALESCE(e.unique_visitors, 0) AS unique_visitors,
			COALESCE(e.registration_clicks, 0) AS registration_clicks,
			COALESCE(a.registered_users, 0) AS registered_users,
			COALESCE(a.paid_users, 0) AS paid_users
		FROM codes c
		LEFT JOIN event_stats e USING (campaign_code)
		LEFT JOIN attribution_stats a USING (campaign_code)
	`).Scan(&rows).Error
	return rows, err
}
