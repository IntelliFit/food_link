package repo

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	admindomain "food_link/backend/internal/admin/domain"
	commonerrors "food_link/backend/internal/common/errors"
	membershipdomain "food_link/backend/internal/membership/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type PaymentTestRepo struct {
	db *gorm.DB
}

func NewPaymentTestRepo(db *gorm.DB) *PaymentTestRepo {
	return &PaymentTestRepo{db: db}
}

type paymentTestUserRow struct {
	ID                        string            `gorm:"column:id"`
	UserID                    string            `gorm:"column:user_id"`
	Nickname                  string            `gorm:"column:nickname"`
	Avatar                    string            `gorm:"column:avatar"`
	Telephone                 string            `gorm:"column:telephone"`
	OpenID                    string            `gorm:"column:open_id"`
	AppOpenID                 string            `gorm:"column:app_open_id"`
	Note                      string            `gorm:"column:note"`
	CreatedBy                 string            `gorm:"column:created_by"`
	CurrentMembershipStatus   string            `gorm:"column:current_membership_status"`
	CurrentPlanCode           string            `gorm:"column:current_plan_code"`
	CurrentExpiresAt          *time.Time        `gorm:"column:current_expires_at"`
	CurrentDailyCredits       int               `gorm:"column:current_daily_credits"`
	MembershipSnapshot        datatypes.JSONMap `gorm:"column:membership_snapshot"`
	MembershipSnapshotTakenAt *time.Time        `gorm:"column:membership_snapshot_taken_at"`
	MembershipCancelledAt     *time.Time        `gorm:"column:membership_cancelled_at"`
	MembershipCancelledBy     string            `gorm:"column:membership_cancelled_by"`
	MembershipRestoredAt      *time.Time        `gorm:"column:membership_restored_at"`
	MembershipRestoredBy      string            `gorm:"column:membership_restored_by"`
	CreatedAt                 *time.Time        `gorm:"column:created_at"`
	UpdatedAt                 *time.Time        `gorm:"column:updated_at"`
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
	var rows []paymentTestUserRow
	err := r.db.WithContext(ctx).
		Table("membership_payment_test_users AS t").
		Joins("LEFT JOIN weapp_user AS u ON u.id = t.user_id").
		Joins("LEFT JOIN user_pro_memberships AS m ON m.user_id = t.user_id").
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
			COALESCE(m.status, '') AS current_membership_status,
			COALESCE(m.current_plan_code, '') AS current_plan_code,
			m.expires_at AS current_expires_at,
			COALESCE(m.daily_credits, 0) AS current_daily_credits,
			COALESCE(t.membership_snapshot, '{}'::jsonb) AS membership_snapshot,
			t.membership_snapshot_taken_at AS membership_snapshot_taken_at,
			t.membership_cancelled_at AS membership_cancelled_at,
			COALESCE(t.membership_cancelled_by, '') AS membership_cancelled_by,
			t.membership_restored_at AS membership_restored_at,
			COALESCE(t.membership_restored_by, '') AS membership_restored_by,
			t.created_at AS created_at,
			t.updated_at AS updated_at
		`).
		Order("t.created_at DESC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	return mapPaymentTestUserRows(rows), nil
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
		ID:                 uuid.New().String(),
		UserID:             userID,
		Note:               notePtr,
		CreatedBy:          createdByPtr,
		MembershipSnapshot: map[string]any{},
		CreatedAt:          &now,
		UpdatedAt:          &now,
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
	var rows []paymentTestUserRow
	err := r.db.WithContext(ctx).
		Table("membership_payment_test_users AS t").
		Joins("LEFT JOIN weapp_user AS u ON u.id = t.user_id").
		Joins("LEFT JOIN user_pro_memberships AS m ON m.user_id = t.user_id").
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
			COALESCE(m.status, '') AS current_membership_status,
			COALESCE(m.current_plan_code, '') AS current_plan_code,
			m.expires_at AS current_expires_at,
			COALESCE(m.daily_credits, 0) AS current_daily_credits,
			COALESCE(t.membership_snapshot, '{}'::jsonb) AS membership_snapshot,
			t.membership_snapshot_taken_at AS membership_snapshot_taken_at,
			t.membership_cancelled_at AS membership_cancelled_at,
			COALESCE(t.membership_cancelled_by, '') AS membership_cancelled_by,
			t.membership_restored_at AS membership_restored_at,
			COALESCE(t.membership_restored_by, '') AS membership_restored_by,
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
	mapped := mapPaymentTestUserRow(rows[0])
	return &mapped, nil
}

func (r *PaymentTestRepo) CancelUserMembership(ctx context.Context, userID, cancelledBy string) (*admindomain.PaymentTestUser, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "用户 ID 不能为空", HTTPStatus: 400}
	}
	cancelledBy = strings.TrimSpace(cancelledBy)
	var cancelledByPtr *string
	if cancelledBy != "" {
		cancelledByPtr = &cancelledBy
	}
	now := time.Now()
	if err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var testUser membershipdomain.PaymentTestUser
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ?", userID).
			First(&testUser).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return commonerrors.ErrNotFound
			}
			return err
		}
		if snapshotHasMembership(testUser.MembershipSnapshot) {
			return &commonerrors.AppError{Code: 10002, Message: "当前测试用户已有待恢复的会员备份，请先恢复后再取消", HTTPStatus: 400}
		}

		var membership membershipdomain.UserMembership
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ?", userID).
			First(&membership).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return &commonerrors.AppError{Code: 10002, Message: "当前测试用户没有可取消的有效会员", HTTPStatus: 400}
			}
			return err
		}
		if !isCancellableMembership(&membership, now) {
			return &commonerrors.AppError{Code: 10002, Message: "当前测试用户没有可取消的有效会员", HTTPStatus: 400}
		}

		snapshot := membershipSnapshotFromRow(&membership)
		if err := tx.Model(&membershipdomain.PaymentTestUser{}).
			Where("user_id = ?", userID).
			Updates(map[string]any{
				"membership_snapshot":          datatypes.JSONMap(snapshot),
				"membership_snapshot_taken_at": now,
				"membership_cancelled_at":      now,
				"membership_cancelled_by":      cancelledByPtr,
				"membership_restored_at":       nil,
				"membership_restored_by":       nil,
				"updated_at":                   now,
			}).Error; err != nil {
			return err
		}
		return tx.Model(&membershipdomain.UserMembership{}).
			Where("id = ?", membership.ID).
			Updates(map[string]any{
				"current_plan_code":    nil,
				"status":               "inactive",
				"first_activated_at":   nil,
				"current_period_start": nil,
				"expires_at":           nil,
				"last_paid_at":         nil,
				"auto_renew":           false,
				"daily_credits":        0,
				"updated_at":           now,
			}).Error
	}); err != nil {
		return nil, err
	}
	return r.GetUser(ctx, userID)
}

func (r *PaymentTestRepo) RestoreUserMembership(ctx context.Context, userID, restoredBy string) (*admindomain.PaymentTestUser, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "用户 ID 不能为空", HTTPStatus: 400}
	}
	restoredBy = strings.TrimSpace(restoredBy)
	var restoredByPtr *string
	if restoredBy != "" {
		restoredByPtr = &restoredBy
	}
	now := time.Now()
	if err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var testUser membershipdomain.PaymentTestUser
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ?", userID).
			First(&testUser).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return commonerrors.ErrNotFound
			}
			return err
		}
		if !snapshotHasMembership(testUser.MembershipSnapshot) {
			return &commonerrors.AppError{Code: 10002, Message: "当前测试用户没有可恢复的会员备份", HTTPStatus: 400}
		}

		restored := membershipFromSnapshot(testUser.MembershipSnapshot, userID, now)
		createRow := membershipdomain.UserMembership{
			ID:                 restored.ID,
			UserID:             restored.UserID,
			CurrentPlanCode:    restored.CurrentPlanCode,
			Status:             restored.Status,
			FirstActivatedAt:   restored.FirstActivatedAt,
			CurrentPeriodStart: restored.CurrentPeriodStart,
			ExpiresAt:          restored.ExpiresAt,
			LastPaidAt:         restored.LastPaidAt,
			AutoRenew:          restored.AutoRenew,
			DailyCredits:       restored.DailyCredits,
			CreatedAt:          restored.CreatedAt,
			UpdatedAt:          restored.UpdatedAt,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "user_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"current_plan_code":    restored.CurrentPlanCode,
				"status":               restored.Status,
				"first_activated_at":   restored.FirstActivatedAt,
				"current_period_start": restored.CurrentPeriodStart,
				"expires_at":           restored.ExpiresAt,
				"last_paid_at":         restored.LastPaidAt,
				"auto_renew":           restored.AutoRenew,
				"daily_credits":        restored.DailyCredits,
				"updated_at":           now,
			}),
		}).Create(&createRow).Error; err != nil {
			return err
		}

		return tx.Model(&membershipdomain.PaymentTestUser{}).
			Where("user_id = ?", userID).
			Updates(map[string]any{
				"membership_snapshot":          datatypes.JSONMap{},
				"membership_snapshot_taken_at": nil,
				"membership_restored_at":       now,
				"membership_restored_by":       restoredByPtr,
				"updated_at":                   now,
			}).Error
	}); err != nil {
		return nil, err
	}
	return r.GetUser(ctx, userID)
}

func (r *PaymentTestRepo) RemoveUser(ctx context.Context, userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return &commonerrors.AppError{Code: 10002, Message: "用户 ID 不能为空", HTTPStatus: 400}
	}
	var testUser membershipdomain.PaymentTestUser
	if err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&testUser).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return commonerrors.ErrNotFound
		}
		return err
	}
	if snapshotHasMembership(testUser.MembershipSnapshot) {
		return &commonerrors.AppError{Code: 10002, Message: "当前测试用户还有待恢复的会员备份，请先恢复后再移除", HTTPStatus: 400}
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

func mapPaymentTestUserRows(rows []paymentTestUserRow) []admindomain.PaymentTestUser {
	items := make([]admindomain.PaymentTestUser, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapPaymentTestUserRow(row))
	}
	return items
}

func mapPaymentTestUserRow(row paymentTestUserRow) admindomain.PaymentTestUser {
	status := normalizeMembershipStatus(row.CurrentMembershipStatus, row.CurrentExpiresAt)
	snapshot := map[string]any(row.MembershipSnapshot)
	return admindomain.PaymentTestUser{
		ID:                        row.ID,
		UserID:                    row.UserID,
		Nickname:                  row.Nickname,
		Avatar:                    row.Avatar,
		Telephone:                 row.Telephone,
		OpenID:                    row.OpenID,
		AppOpenID:                 row.AppOpenID,
		Note:                      row.Note,
		CreatedBy:                 row.CreatedBy,
		CurrentMembershipStatus:   status,
		CurrentPlanCode:           row.CurrentPlanCode,
		CurrentExpiresAt:          row.CurrentExpiresAt,
		CurrentDailyCredits:       row.CurrentDailyCredits,
		MembershipBackupAvailable: snapshotHasMembership(snapshot),
		BackupPlanCode:            snapshotString(snapshot, "current_plan_code"),
		BackupStatus:              snapshotString(snapshot, "status"),
		BackupExpiresAt:           snapshotTime(snapshot, "expires_at"),
		BackupDailyCredits:        snapshotInt(snapshot, "daily_credits"),
		MembershipSnapshotTakenAt: row.MembershipSnapshotTakenAt,
		MembershipCancelledAt:     row.MembershipCancelledAt,
		MembershipCancelledBy:     row.MembershipCancelledBy,
		MembershipRestoredAt:      row.MembershipRestoredAt,
		MembershipRestoredBy:      row.MembershipRestoredBy,
		CreatedAt:                 row.CreatedAt,
		UpdatedAt:                 row.UpdatedAt,
	}
}

func isCancellableMembership(membership *membershipdomain.UserMembership, now time.Time) bool {
	if membership == nil || strings.TrimSpace(membership.Status) != "active" {
		return false
	}
	return membership.ExpiresAt == nil || membership.ExpiresAt.After(now)
}

func membershipSnapshotFromRow(membership *membershipdomain.UserMembership) map[string]any {
	if membership == nil {
		return map[string]any{}
	}
	return map[string]any{
		"id":                   membership.ID,
		"user_id":              membership.UserID,
		"current_plan_code":    stringPtrValue(membership.CurrentPlanCode),
		"status":               membership.Status,
		"first_activated_at":   timePtrSnapshotValue(membership.FirstActivatedAt),
		"current_period_start": timePtrSnapshotValue(membership.CurrentPeriodStart),
		"expires_at":           timePtrSnapshotValue(membership.ExpiresAt),
		"last_paid_at":         timePtrSnapshotValue(membership.LastPaidAt),
		"auto_renew":           membership.AutoRenew,
		"daily_credits":        membership.DailyCredits,
		"created_at":           timePtrSnapshotValue(membership.CreatedAt),
		"updated_at":           timePtrSnapshotValue(membership.UpdatedAt),
	}
}

func membershipFromSnapshot(snapshot map[string]any, userID string, now time.Time) membershipdomain.UserMembership {
	createdAt := snapshotTime(snapshot, "created_at")
	if createdAt == nil {
		createdAt = &now
	}
	updatedAt := now
	id := snapshotString(snapshot, "id")
	if id == "" {
		id = uuid.New().String()
	}
	status := snapshotString(snapshot, "status")
	if status == "" {
		status = "inactive"
	}
	return membershipdomain.UserMembership{
		ID:                 id,
		UserID:             userID,
		CurrentPlanCode:    snapshotStringPtr(snapshot, "current_plan_code"),
		Status:             status,
		FirstActivatedAt:   snapshotTime(snapshot, "first_activated_at"),
		CurrentPeriodStart: snapshotTime(snapshot, "current_period_start"),
		ExpiresAt:          snapshotTime(snapshot, "expires_at"),
		LastPaidAt:         snapshotTime(snapshot, "last_paid_at"),
		AutoRenew:          snapshotBool(snapshot, "auto_renew"),
		DailyCredits:       snapshotInt(snapshot, "daily_credits"),
		CreatedAt:          createdAt,
		UpdatedAt:          &updatedAt,
	}
}

func snapshotHasMembership(snapshot map[string]any) bool {
	return snapshotString(snapshot, "id") != "" || snapshotString(snapshot, "current_plan_code") != "" || snapshotString(snapshot, "status") != ""
}

func normalizeMembershipStatus(status string, expiresAt *time.Time) string {
	status = strings.TrimSpace(status)
	if status == "" {
		return "inactive"
	}
	if status == "active" && expiresAt != nil && !expiresAt.After(time.Now()) {
		return "expired"
	}
	return status
}

func stringPtrValue(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func timePtrSnapshotValue(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func snapshotStringPtr(snapshot map[string]any, key string) *string {
	value := snapshotString(snapshot, key)
	if value == "" {
		return nil
	}
	return &value
}

func snapshotString(snapshot map[string]any, key string) string {
	if snapshot == nil {
		return ""
	}
	value, ok := snapshot[key]
	if !ok || value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case fmt.Stringer:
		return strings.TrimSpace(v.String())
	default:
		text := strings.TrimSpace(fmt.Sprintf("%v", v))
		if text == "<nil>" {
			return ""
		}
		return text
	}
}

func snapshotInt(snapshot map[string]any, key string) int {
	if snapshot == nil {
		return 0
	}
	switch v := snapshot[key].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(v))
		return n
	default:
		return 0
	}
}

func snapshotBool(snapshot map[string]any, key string) bool {
	if snapshot == nil {
		return false
	}
	switch v := snapshot[key].(type) {
	case bool:
		return v
	case string:
		parsed, _ := strconv.ParseBool(strings.TrimSpace(v))
		return parsed
	default:
		return false
	}
}

func snapshotTime(snapshot map[string]any, key string) *time.Time {
	if snapshot == nil {
		return nil
	}
	value := snapshot[key]
	switch v := value.(type) {
	case time.Time:
		return &v
	case string:
		text := strings.TrimSpace(v)
		if text == "" {
			return nil
		}
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
			parsed, err := time.Parse(layout, text)
			if err == nil {
				return &parsed
			}
		}
		return nil
	default:
		return nil
	}
}
