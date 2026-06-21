package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	admindomain "food_link/backend/internal/admin/domain"
	commonerrors "food_link/backend/internal/common/errors"
	membershipdomain "food_link/backend/internal/membership/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type PaymentTestRepo struct {
	db *gorm.DB
}

func NewPaymentTestRepo(db *gorm.DB) *PaymentTestRepo {
	return &PaymentTestRepo{db: db}
}

func (r *PaymentTestRepo) GetSummary(ctx context.Context) (*admindomain.PaymentTestSummary, error) {
	settings, err := r.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	plan, err := r.GetPlan(ctx)
	if err != nil {
		return nil, err
	}
	users, err := r.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	return &admindomain.PaymentTestSummary{
		Settings: *settings,
		Plan:     plan,
		Users:    users,
	}, nil
}

func (r *PaymentTestRepo) GetSettings(ctx context.Context) (*admindomain.PaymentTestSettings, error) {
	var row membershipdomain.PaymentTestSetting
	err := r.db.WithContext(ctx).Where("id = ?", "default").First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &admindomain.PaymentTestSettings{Enabled: false}, nil
	}
	if err != nil {
		return nil, err
	}
	return &admindomain.PaymentTestSettings{
		Enabled:   row.Enabled,
		UpdatedBy: row.UpdatedBy,
		UpdatedAt: row.UpdatedAt,
	}, nil
}

func (r *PaymentTestRepo) UpdateSettings(ctx context.Context, enabled bool, updatedBy string) (*admindomain.PaymentTestSettings, error) {
	updatedBy = strings.TrimSpace(updatedBy)
	var updatedByPtr *string
	if updatedBy != "" {
		updatedByPtr = &updatedBy
	}
	now := time.Now()
	row := membershipdomain.PaymentTestSetting{
		ID:        "default",
		Enabled:   enabled,
		UpdatedBy: updatedByPtr,
		CreatedAt: &now,
		UpdatedAt: &now,
	}
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"enabled":    enabled,
			"updated_by": updatedByPtr,
			"updated_at": now,
		}),
	}).Create(&row).Error
	if err != nil {
		return nil, err
	}
	return r.GetSettings(ctx)
}

func (r *PaymentTestRepo) GetPlan(ctx context.Context) (*admindomain.PaymentTestPlan, error) {
	var row membershipdomain.MembershipPlan
	err := r.db.WithContext(ctx).Where("code = ?", membershipdomain.PaymentTestPlanCode).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return mapPaymentTestPlan(row), nil
}

func (r *PaymentTestRepo) ListUsers(ctx context.Context) ([]admindomain.PaymentTestUser, error) {
	var rows []admindomain.PaymentTestUser
	err := r.db.WithContext(ctx).
		Table("membership_payment_test_users AS t").
		Joins("LEFT JOIN weapp_user AS u ON u.id = t.user_id").
		Select(`
			t.id AS id,
			t.user_id AS user_id,
			COALESCE(u.nickname, '') AS nickname,
			COALESCE(u.avatar, '') AS avatar,
			COALESCE(u.telephone, '') AS telephone,
			COALESCE(u.openid, '') AS open_id,
			COALESCE(u.app_openid, '') AS app_open_id,
			COALESCE(t.note, '') AS note,
			COALESCE(t.created_by, '') AS created_by,
			t.created_at AS created_at,
			t.updated_at AS updated_at
		`).
		Order("t.created_at DESC").
		Scan(&rows).Error
	return rows, err
}

func (r *PaymentTestRepo) SearchUsers(ctx context.Context, query string, limit int) ([]admindomain.PaymentTestUserSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []admindomain.PaymentTestUserSearchResult{}, nil
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	like := "%" + query + "%"
	var rows []admindomain.PaymentTestUserSearchResult
	err := r.db.WithContext(ctx).
		Table("weapp_user AS u").
		Joins("LEFT JOIN membership_payment_test_users AS t ON t.user_id = u.id").
		Select(`
			u.id AS user_id,
			COALESCE(u.nickname, '') AS nickname,
			COALESCE(u.avatar, '') AS avatar,
			COALESCE(u.telephone, '') AS telephone,
			COALESCE(u.openid, '') AS open_id,
			COALESCE(u.app_openid, '') AS app_open_id,
			u.create_time AS created_at,
			CASE WHEN t.user_id IS NULL THEN false ELSE true END AS is_added
		`).
		Where(`u.id::text ILIKE ? OR u.nickname ILIKE ? OR u.telephone ILIKE ? OR u.openid ILIKE ? OR u.app_openid ILIKE ?`,
			like, like, like, like, like).
		Order("u.create_time DESC NULLS LAST").
		Order("u.id ASC").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

func (r *PaymentTestRepo) AddUser(ctx context.Context, userID, note, createdBy string) (*admindomain.PaymentTestUser, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "用户 ID 不能为空", HTTPStatus: 400}
	}
	var count int64
	if err := r.db.WithContext(ctx).Table("weapp_user").Where("id = ?", userID).Count(&count).Error; err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, commonerrors.ErrNotFound
	}

	note = strings.TrimSpace(note)
	createdBy = strings.TrimSpace(createdBy)
	var notePtr *string
	if note != "" {
		notePtr = &note
	}
	var createdByPtr *string
	if createdBy != "" {
		createdByPtr = &createdBy
	}
	now := time.Now()
	row := membershipdomain.PaymentTestUser{
		ID:        uuid.New().String(),
		UserID:    userID,
		Note:      notePtr,
		CreatedBy: createdByPtr,
		CreatedAt: &now,
		UpdatedAt: &now,
	}
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			"note":       notePtr,
			"created_by": createdByPtr,
			"updated_at": now,
		}),
	}).Create(&row).Error
	if err != nil {
		return nil, err
	}
	return r.GetUser(ctx, userID)
}

func (r *PaymentTestRepo) GetUser(ctx context.Context, userID string) (*admindomain.PaymentTestUser, error) {
	var rows []admindomain.PaymentTestUser
	err := r.db.WithContext(ctx).
		Table("membership_payment_test_users AS t").
		Joins("LEFT JOIN weapp_user AS u ON u.id = t.user_id").
		Select(`
			t.id AS id,
			t.user_id AS user_id,
			COALESCE(u.nickname, '') AS nickname,
			COALESCE(u.avatar, '') AS avatar,
			COALESCE(u.telephone, '') AS telephone,
			COALESCE(u.openid, '') AS open_id,
			COALESCE(u.app_openid, '') AS app_open_id,
			COALESCE(t.note, '') AS note,
			COALESCE(t.created_by, '') AS created_by,
			t.created_at AS created_at,
			t.updated_at AS updated_at
		`).
		Where("t.user_id = ?", strings.TrimSpace(userID)).
		Limit(1).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return &rows[0], nil
}

func (r *PaymentTestRepo) RemoveUser(ctx context.Context, userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return &commonerrors.AppError{Code: 10002, Message: "用户 ID 不能为空", HTTPStatus: 400}
	}
	result := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Delete(&membershipdomain.PaymentTestUser{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return commonerrors.ErrNotFound
	}
	return nil
}

func mapPaymentTestPlan(row membershipdomain.MembershipPlan) *admindomain.PaymentTestPlan {
	return &admindomain.PaymentTestPlan{
		Code:           row.Code,
		Name:           row.Name,
		Description:    row.Description,
		Amount:         row.Amount,
		DurationMonths: row.DurationMonths,
		IsActive:       row.IsActive,
		IsVisible:      row.IsVisible,
		IsTestPlan:     row.IsTestPlan,
		Tier:           row.Tier,
		Period:         row.Period,
		DailyCredits:   row.DailyCredits,
		OriginalAmount: row.OriginalAmount,
		SortOrder:      row.SortOrder,
	}
}
