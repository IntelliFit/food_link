package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"food_link/backend/internal/membership/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type MembershipRepo struct {
	db *gorm.DB
}

func NewMembershipRepo(db *gorm.DB) *MembershipRepo {
	return &MembershipRepo{db: db}
}

func (r *MembershipRepo) ListActivePlans(ctx context.Context) ([]domain.MembershipPlan, error) {
	var plans []domain.MembershipPlan
	err := r.db.WithContext(ctx).
		Where("is_active = ? AND is_visible = ?", true, true).
		Order("sort_order ASC").
		Order("created_at ASC").
		Find(&plans).Error
	return plans, err
}

func (r *MembershipRepo) GetPlanByID(ctx context.Context, planCode string) (*domain.MembershipPlan, error) {
	return r.GetPlanByCode(ctx, planCode)
}

func (r *MembershipRepo) GetPlanByCode(ctx context.Context, planCode string) (*domain.MembershipPlan, error) {
	var plan domain.MembershipPlan
	err := r.db.WithContext(ctx).Where("code = ?", strings.TrimSpace(planCode)).First(&plan).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &plan, err
}

func (r *MembershipRepo) GetPaymentTestAccess(ctx context.Context, userID string) (*domain.PaymentTestAccess, error) {
	var setting domain.PaymentTestSetting
	err := r.db.WithContext(ctx).Where("id = ?", "default").First(&setting).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &domain.PaymentTestAccess{Enabled: false, UserAllowed: false}, nil
	}
	if err != nil {
		return nil, err
	}
	access := &domain.PaymentTestAccess{Enabled: setting.Enabled}
	if !setting.Enabled || strings.TrimSpace(userID) == "" {
		return access, nil
	}
	var count int64
	err = r.db.WithContext(ctx).
		Model(&domain.PaymentTestUser{}).
		Where("user_id = ?", strings.TrimSpace(userID)).
		Count(&count).Error
	if err != nil {
		return nil, err
	}
	access.UserAllowed = count > 0
	return access, nil
}

func (r *MembershipRepo) GetActiveMembership(ctx context.Context, userID string) (*domain.UserMembership, error) {
	membership, err := r.GetUserProMembership(ctx, userID)
	if err != nil || membership == nil {
		return membership, err
	}
	if membership.Status == "active" && membership.ExpiresAt != nil && !membership.ExpiresAt.After(time.Now()) {
		if err := r.UpdateMembership(ctx, membership.ID, map[string]any{
			"status":     "expired",
			"updated_at": time.Now(),
		}); err != nil {
			return nil, err
		}
		membership.Status = "expired"
	}
	if membership.Status != "active" {
		return nil, nil
	}
	return membership, nil
}

func (r *MembershipRepo) GetUserProMembership(ctx context.Context, userID string) (*domain.UserMembership, error) {
	var row domain.UserMembership
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *MembershipRepo) CreateMembership(ctx context.Context, um *domain.UserMembership) error {
	if um.ID == "" {
		um.ID = uuid.New().String()
	}
	now := time.Now()
	if um.CreatedAt == nil {
		um.CreatedAt = &now
	}
	um.UpdatedAt = &now
	return r.db.WithContext(ctx).Create(um).Error
}

func (r *MembershipRepo) SaveMembership(ctx context.Context, userID string, updates map[string]any) (*domain.UserMembership, error) {
	existing, err := r.GetUserProMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	updates["updated_at"] = now
	if existing == nil {
		row := &domain.UserMembership{
			ID:        uuid.New().String(),
			UserID:    userID,
			CreatedAt: &now,
			UpdatedAt: &now,
		}
		if code, ok := updates["current_plan_code"].(string); ok {
			row.CurrentPlanCode = &code
		}
		if status, ok := updates["status"].(string); ok {
			row.Status = status
		}
		if v, ok := updates["first_activated_at"].(time.Time); ok {
			row.FirstActivatedAt = &v
		}
		if v, ok := updates["current_period_start"].(time.Time); ok {
			row.CurrentPeriodStart = &v
		}
		if v, ok := updates["expires_at"].(time.Time); ok {
			row.ExpiresAt = &v
		}
		if v, ok := updates["last_paid_at"].(time.Time); ok {
			row.LastPaidAt = &v
		}
		if v, ok := updates["daily_credits"].(int); ok {
			row.DailyCredits = v
		}
		if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
			return nil, err
		}
		return row, nil
	}
	if err := r.UpdateMembership(ctx, existing.ID, updates); err != nil {
		return nil, err
	}
	return r.GetUserProMembership(ctx, userID)
}

func (r *MembershipRepo) UpdateMembership(ctx context.Context, id string, updates map[string]any) error {
	return r.db.WithContext(ctx).Model(&domain.UserMembership{}).Where("id = ?", id).Updates(updates).Error
}

func (r *MembershipRepo) CreatePayment(ctx context.Context, p *domain.MembershipPayment) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	if p.NotifyPayload == nil {
		p.NotifyPayload = map[string]any{}
	}
	if p.Extra == nil {
		p.Extra = map[string]any{}
	}
	now := time.Now()
	if p.CreatedAt == nil {
		p.CreatedAt = &now
	}
	p.UpdatedAt = &now
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *MembershipRepo) GetPaymentByID(ctx context.Context, idOrOrderNo string) (*domain.MembershipPayment, error) {
	var p domain.MembershipPayment
	err := r.db.WithContext(ctx).
		Where("id = ? OR order_no = ?", idOrOrderNo, idOrOrderNo).
		First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &p, err
}

func (r *MembershipRepo) GetPaymentByOrderNo(ctx context.Context, orderNo string) (*domain.MembershipPayment, error) {
	var p domain.MembershipPayment
	err := r.db.WithContext(ctx).Where("order_no = ?", orderNo).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &p, err
}

func (r *MembershipRepo) GetLatestPaidMembershipPayment(ctx context.Context, userID string) (*domain.MembershipPayment, error) {
	var rows []domain.MembershipPayment
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND status = ?", userID, "paid").
		Order("paid_at DESC NULLS LAST").
		Order("created_at DESC").
		Limit(20).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if isMembershipPlanCode(row.PlanCode) && !isPaymentTestPlanCode(row.PlanCode) {
			return &row, nil
		}
	}
	return nil, nil
}

func (r *MembershipRepo) GetFirstMembershipTrialBatchRank(ctx context.Context, userID string, limit int) (int, error) {
	if limit <= 0 {
		return 0, nil
	}
	var rows []struct {
		ID string `gorm:"column:id"`
	}
	err := r.db.WithContext(ctx).
		Table("weapp_user").
		Select("id").
		Order("create_time IS NULL ASC").
		Order("create_time ASC").
		Order("id ASC").
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return 0, err
	}
	for index, row := range rows {
		if row.ID == userID {
			return index + 1, nil
		}
	}
	return 0, nil
}

func (r *MembershipRepo) GetTrialEntitlementByUserID(ctx context.Context, userID string) (*domain.UserTrialEntitlement, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, nil
	}
	var row domain.UserTrialEntitlement
	err := r.db.WithContext(ctx).Where("first_user_id = ?", userID).First(&row).Error
	if err == nil {
		return &row, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	var user User
	err = r.db.WithContext(ctx).Where("id = ?", userID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if user.UnionID != nil && strings.TrimSpace(*user.UnionID) != "" {
		err = r.db.WithContext(ctx).Where("unionid = ?", strings.TrimSpace(*user.UnionID)).First(&row).Error
		if err == nil {
			return &row, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	if strings.TrimSpace(user.OpenID) == "" {
		return nil, nil
	}
	err = r.db.WithContext(ctx).Where("openid = ?", strings.TrimSpace(user.OpenID)).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *MembershipRepo) GetFirstPaidMembershipUserRank(ctx context.Context, userID string, limit int) (int, error) {
	if limit <= 0 {
		return 0, nil
	}
	var rows []domain.MembershipPayment
	err := r.db.WithContext(ctx).
		Where("status = ?", "paid").
		Order("COALESCE(paid_at, created_at) IS NULL ASC").
		Order("COALESCE(paid_at, created_at) ASC").
		Order("COALESCE(created_at, paid_at) IS NULL ASC").
		Order("COALESCE(created_at, paid_at) ASC").
		Order("id ASC").
		Limit(5000).
		Find(&rows).Error
	if err != nil {
		return 0, err
	}
	seen := map[string]struct{}{}
	rank := 0
	for _, row := range rows {
		if !isMembershipPlanCode(row.PlanCode) || isPaymentTestPlanCode(row.PlanCode) || row.UserID == "" {
			continue
		}
		if _, ok := seen[row.UserID]; ok {
			continue
		}
		seen[row.UserID] = struct{}{}
		rank++
		if row.UserID == userID {
			if rank <= limit {
				return rank, nil
			}
			return 0, nil
		}
		if rank >= limit {
			break
		}
	}
	return 0, nil
}

func (r *MembershipRepo) CountDailyMembershipBonusCredits(ctx context.Context, userID, chinaDate string) (int, int, error) {
	var rows []struct {
		Reason string `gorm:"column:reason"`
		Delta  int    `gorm:"column:delta"`
	}
	err := r.db.WithContext(ctx).
		Table("user_earned_credit_ledger").
		Select("reason, delta").
		Where("user_id = ? AND related_date = ? AND delta > 0", userID, chinaDate).
		Find(&rows).Error
	if err != nil {
		return 0, 0, err
	}
	inviteBonus := 0
	shareBonus := 0
	for _, row := range rows {
		switch strings.TrimSpace(row.Reason) {
		case "invite_daily_reward", "invite_qualified_reward":
			inviteBonus += row.Delta
		case "share_poster_reward":
			shareBonus += row.Delta
		}
	}
	return inviteBonus, shareBonus, nil
}

func (r *MembershipRepo) GetInviteReferralByInvitee(ctx context.Context, inviteeUserID string) (*domain.UserInviteReferral, error) {
	var row domain.UserInviteReferral
	err := r.db.WithContext(ctx).
		Where("invitee_user_id = ?", inviteeUserID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *MembershipRepo) UpdateInviteReferral(ctx context.Context, id string, updates map[string]any) (*domain.UserInviteReferral, error) {
	if len(updates) > 0 {
		if _, ok := updates["updated_at"]; !ok {
			updates["updated_at"] = time.Now()
		}
		if err := r.db.WithContext(ctx).Model(&domain.UserInviteReferral{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			return nil, err
		}
	}
	var row domain.UserInviteReferral
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *MembershipRepo) CountCompletedInviteRewardsForInviterInMonth(ctx context.Context, inviterUserID, monthStart, nextMonthStart string) (int, error) {
	start, err := time.ParseInLocation("2006-01-02", monthStart, chinaLocation())
	if err != nil {
		return 0, nil
	}
	end, err := time.ParseInLocation("2006-01-02", nextMonthStart, chinaLocation())
	if err != nil {
		return 0, nil
	}
	var count int64
	err = r.db.WithContext(ctx).Model(&domain.UserInviteReferral{}).
		Where("inviter_user_id = ? AND status = ? AND reward_start_date >= ? AND reward_start_date < ?", inviterUserID, "reward_completed", start, end).
		Count(&count).Error
	return int(count), err
}

func (r *MembershipRepo) ListActiveInviteRewards(ctx context.Context, userID, chinaDate string) ([]domain.UserInviteReferral, error) {
	if _, err := time.ParseInLocation("2006-01-02", chinaDate, chinaLocation()); err != nil {
		return nil, nil
	}
	var rows []domain.UserInviteReferral
	err := r.db.WithContext(ctx).
		Where("(inviter_user_id = ? OR invitee_user_id = ?) AND status = ? AND reward_start_date <= ? AND reward_end_date >= ?", userID, userID, "reward_active", chinaDate, chinaDate).
		Find(&rows).Error
	return rows, err
}

func (r *MembershipRepo) ListSharePosterBonusEvents(ctx context.Context, userID, chinaDate string) ([]domain.UserCreditBonusEvent, error) {
	if _, err := time.ParseInLocation("2006-01-02", chinaDate, chinaLocation()); err != nil {
		return nil, nil
	}
	var rows []domain.UserCreditBonusEvent
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND bonus_type = ? AND bonus_date = ?", userID, "share_poster", chinaDate).
		Find(&rows).Error
	return rows, err
}

func (r *MembershipRepo) UpdatePaymentStatus(ctx context.Context, id string, status string) error {
	return r.db.WithContext(ctx).
		Model(&domain.MembershipPayment{}).
		Where("id = ?", id).
		Updates(map[string]any{"status": status, "updated_at": time.Now()}).Error
}

func (r *MembershipRepo) UpdatePaymentByOrderNo(ctx context.Context, orderNo string, updates map[string]any) error {
	updates["updated_at"] = time.Now()
	return r.db.WithContext(ctx).Model(&domain.MembershipPayment{}).Where("order_no = ?", orderNo).Updates(updates).Error
}

func (r *MembershipRepo) ExpirePendingMembershipOrders(ctx context.Context, userID, excludeOrderNo, reason string) (int, error) {
	var rows []domain.MembershipPayment
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND status = ?", userID, "pending").
		Find(&rows).Error; err != nil {
		return 0, err
	}
	count := 0
	for _, row := range rows {
		if excludeOrderNo != "" && row.OrderNo == excludeOrderNo {
			continue
		}
		if !isMembershipPlanCode(row.PlanCode) {
			continue
		}
		extra := row.Extra
		if extra == nil {
			extra = map[string]any{}
		}
		extra["expire_reason"] = reason
		extra["expired_at"] = time.Now().Format(time.RFC3339)
		if excludeOrderNo != "" {
			extra["superseded_by_order_no"] = excludeOrderNo
		}
		if err := r.UpdatePaymentByOrderNo(ctx, row.OrderNo, map[string]any{
			"status": "expired",
			"extra":  extra,
		}); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func isMembershipPlanCode(planCode string) bool {
	code := strings.TrimSpace(strings.ToLower(planCode))
	return code == "pro_monthly" ||
		code == domain.PaymentTestPlanCode ||
		strings.HasPrefix(code, "light_") ||
		strings.HasPrefix(code, "standard_") ||
		strings.HasPrefix(code, "advanced_")
}

func isPaymentTestPlanCode(planCode string) bool {
	return strings.EqualFold(strings.TrimSpace(planCode), domain.PaymentTestPlanCode)
}

func (r *MembershipRepo) CountAnalysisTasksToday(ctx context.Context, userID string) (int64, error) {
	now := time.Now()
	loc := chinaLocation()
	start := time.Date(now.In(loc).Year(), now.In(loc).Month(), now.In(loc).Day(), 0, 0, 0, 0, loc)
	end := start.Add(24 * time.Hour)

	var rows []analysisTask
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, start, end).
		Find(&rows).Error
	if err != nil {
		return 0, err
	}
	var count int64
	for _, row := range rows {
		if isFoodAnalysisTaskTypeForQuota(row.TaskType, row.Payload) {
			count++
		}
	}
	return count, nil
}

func (r *MembershipRepo) CountDailySystemCreditUsage(ctx context.Context, userID, chinaDate string) (int, error) {
	target, err := time.ParseInLocation("2006-01-02", chinaDate, chinaLocation())
	if err != nil {
		return 0, nil
	}
	start := target
	end := target.AddDate(0, 0, 3)
	var rows []analysisTask
	err = r.db.WithContext(ctx).
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, start, end).
		Find(&rows).Error
	if err != nil {
		return 0, err
	}
	groups := map[string]*creditUsageGroup{}
	for _, row := range rows {
		groupID := creditGroupID(row)
		if groupID == "" {
			if row.Status != "done" {
				continue
			}
			total := taskSystemCreditUsageUnits(row, chinaDate)
			if total <= 0 {
				continue
			}
			groupID = "legacy:" + row.ID
		}
		group := groups[groupID]
		if group == nil {
			group = &creditUsageGroup{unitsByDate: map[string]int{}}
			groups[groupID] = group
		}
		if isCreditRefundStatus(row.Status) {
			group.refunded = true
		}
		if !isCreditChargeStatus(row.Status) {
			continue
		}
		if usage := creditUsageFromPayload(row.Payload); len(usage) > 0 {
			if byDate, ok := usage["system_by_date"].(map[string]any); ok {
				group.unitsByDate[chinaDate] = maxInt(group.unitsByDate[chinaDate], intFromAny(byDate[chinaDate]))
				continue
			}
		}
		group.unitsByDate[chinaDate] = maxInt(group.unitsByDate[chinaDate], taskSystemCreditUsageUnits(row, chinaDate))
	}
	total := 0
	for _, group := range groups {
		if group.refunded {
			continue
		}
		total += group.unitsByDate[chinaDate]
	}
	ledgerUsed, err := r.countDailySystemCreditUsageFromLedger(ctx, userID, chinaDate)
	if err != nil {
		return 0, err
	}
	total += ledgerUsed
	return total, nil
}

func (r *MembershipRepo) countDailySystemCreditUsageFromLedger(ctx context.Context, userID, chinaDate string) (int, error) {
	var rows []domain.UserEarnedCreditLedger
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND related_date = ? AND delta = ?", userID, chinaDate, 0).
		Find(&rows).Error
	if err != nil {
		return 0, err
	}
	total := 0
	for _, row := range rows {
		if row.Meta == nil {
			continue
		}
		if stringFromAny(row.Meta["ledger_role"]) != "system_credit_usage" {
			continue
		}
		usage := creditUsageFromPayload(row.Meta)
		if len(usage) == 0 {
			continue
		}
		if byDate, ok := usage["system_by_date"].(map[string]any); ok {
			total += intFromAny(byDate[chinaDate])
		}
	}
	return total, nil
}

func (r *MembershipRepo) GetUser(ctx context.Context, userID string) (*User, error) {
	var user User
	err := r.db.WithContext(ctx).Where("id = ?", userID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *MembershipRepo) GetFoodRecordOwner(ctx context.Context, recordID string) (string, error) {
	var row struct {
		UserID string `gorm:"column:user_id"`
	}
	err := r.db.WithContext(ctx).Table("user_food_records").Select("user_id").Where("id = ?", recordID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	return row.UserID, err
}

func (r *MembershipRepo) CountFoodRecordsByDate(ctx context.Context, userID, chinaDate string) (int, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(chinaDate) == "" {
		return 0, nil
	}
	var count int64
	err := r.db.WithContext(ctx).
		Table("user_food_records").
		Where("user_id = ? AND DATE(COALESCE(record_time, created_at) AT TIME ZONE 'Asia/Shanghai') = ?", userID, chinaDate).
		Count(&count).Error
	return int(count), err
}

func (r *MembershipRepo) UpdateUserEarnedCreditsBalance(ctx context.Context, userID string, nextBalance int) error {
	return r.db.WithContext(ctx).Table("weapp_user").Where("id = ?", userID).Update("earned_credits_balance", nextBalance).Error
}

func (r *MembershipRepo) GetEarnedCreditLedgerBySource(ctx context.Context, userID, reason, sourceKey string) (*domain.UserEarnedCreditLedger, error) {
	if sourceKey == "" {
		return nil, nil
	}
	var row domain.UserEarnedCreditLedger
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND reason = ? AND source_key = ?", userID, reason, sourceKey).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *MembershipRepo) ChangeEarnedCredits(ctx context.Context, userID string, delta int, reason, sourceKey, relatedDate string, meta map[string]any) (*domain.UserEarnedCreditLedger, bool, error) {
	if sourceKey != "" {
		existing, err := r.GetEarnedCreditLedgerBySource(ctx, userID, reason, sourceKey)
		if err != nil || existing != nil {
			return existing, false, err
		}
	}
	var entry *domain.UserEarnedCreditLedger
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}
		next := user.EarnedCreditsBalance + delta
		if next < 0 {
			return errors.New("earned credits balance is insufficient")
		}
		if err := tx.Table("weapp_user").Where("id = ?", userID).Update("earned_credits_balance", next).Error; err != nil {
			return err
		}
		now := time.Now()
		row := &domain.UserEarnedCreditLedger{
			ID:           uuid.New().String(),
			UserID:       userID,
			Delta:        delta,
			BalanceAfter: next,
			Reason:       reason,
			Meta:         meta,
			CreatedAt:    &now,
			UpdatedAt:    &now,
		}
		if sourceKey != "" {
			row.SourceKey = &sourceKey
		}
		if relatedDate != "" {
			row.RelatedDate = &relatedDate
		}
		if err := tx.Create(row).Error; err != nil {
			return err
		}
		entry = row
		return nil
	})
	return entry, entry != nil, err
}

func (r *MembershipRepo) ChangeCreditsWithSystemUsage(ctx context.Context, userID string, earnedDelta int, earnedReason, earnedSourceKey, systemReason, systemSourceKey, relatedDate string, earnedMeta, systemMeta map[string]any) error {
	if earnedDelta == 0 && strings.TrimSpace(systemReason) == "" {
		return nil
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}
		nextBalance := user.EarnedCreditsBalance
		earnedExists := false
		if earnedDelta != 0 && strings.TrimSpace(earnedSourceKey) != "" {
			var existing domain.UserEarnedCreditLedger
			err := tx.Where("user_id = ? AND reason = ? AND source_key = ?", userID, earnedReason, earnedSourceKey).First(&existing).Error
			if err == nil {
				earnedExists = true
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		if earnedDelta != 0 && !earnedExists {
			nextBalance += earnedDelta
			if nextBalance < 0 {
				return errors.New("earned credits balance is insufficient")
			}
			if err := tx.Table("weapp_user").Where("id = ?", userID).Update("earned_credits_balance", nextBalance).Error; err != nil {
				return err
			}
			now := time.Now()
			row := &domain.UserEarnedCreditLedger{
				ID:           uuid.New().String(),
				UserID:       userID,
				Delta:        earnedDelta,
				BalanceAfter: nextBalance,
				Reason:       earnedReason,
				Meta:         earnedMeta,
				CreatedAt:    &now,
				UpdatedAt:    &now,
			}
			if earnedSourceKey != "" {
				row.SourceKey = &earnedSourceKey
			}
			if relatedDate != "" {
				row.RelatedDate = &relatedDate
			}
			if err := tx.Create(row).Error; err != nil {
				return err
			}
		}
		if strings.TrimSpace(systemReason) == "" {
			return nil
		}
		if strings.TrimSpace(systemSourceKey) != "" {
			var existing domain.UserEarnedCreditLedger
			err := tx.Where("user_id = ? AND reason = ? AND source_key = ?", userID, systemReason, systemSourceKey).First(&existing).Error
			if err == nil {
				return nil
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		now := time.Now()
		row := &domain.UserEarnedCreditLedger{
			ID:           uuid.New().String(),
			UserID:       userID,
			Delta:        0,
			BalanceAfter: nextBalance,
			Reason:       systemReason,
			Meta:         systemMeta,
			CreatedAt:    &now,
			UpdatedAt:    &now,
		}
		if systemSourceKey != "" {
			row.SourceKey = &systemSourceKey
		}
		if relatedDate != "" {
			row.RelatedDate = &relatedDate
		}
		return tx.Create(row).Error
	})
}

func (r *MembershipRepo) SumPositiveEarnedCreditsByDate(ctx context.Context, userID, chinaDate string) (int, error) {
	var total int64
	err := r.db.WithContext(ctx).
		Table("user_earned_credit_ledger").
		Select("COALESCE(SUM(delta), 0)").
		Where("user_id = ? AND related_date = ? AND delta > 0", userID, chinaDate).
		Scan(&total).Error
	return int(total), err
}

func (r *MembershipRepo) CountRewardTaskUploads(ctx context.Context, userID, taskType, chinaDate, status string) (int, error) {
	query := r.db.WithContext(ctx).Model(&domain.RewardTaskUpload{}).Where("user_id = ? AND task_type = ? AND bonus_date = ?", userID, taskType, chinaDate)
	if strings.TrimSpace(status) != "" {
		query = query.Where("status = ?", status)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return 0, err
	}
	return int(count), nil
}

func (r *MembershipRepo) GetRewardTaskUploadBySourceKey(ctx context.Context, userID, sourceKey string) (*domain.RewardTaskUpload, error) {
	sourceKey = strings.TrimSpace(sourceKey)
	if sourceKey == "" {
		return nil, nil
	}
	var row domain.RewardTaskUpload
	err := r.db.WithContext(ctx).Where("user_id = ? AND source_key = ?", userID, sourceKey).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *MembershipRepo) CreateRewardTaskUpload(ctx context.Context, row *domain.RewardTaskUpload) error {
	if row.ID == "" {
		row.ID = uuid.New().String()
	}
	now := time.Now()
	if row.CreatedAt == nil {
		row.CreatedAt = &now
	}
	row.UpdatedAt = &now
	if row.Meta == nil {
		row.Meta = map[string]any{}
	}
	return r.db.WithContext(ctx).Create(row).Error
}

func (r *MembershipRepo) UpdateRewardTaskUploadBySourceKey(ctx context.Context, userID, sourceKey string, updates map[string]any) (*domain.RewardTaskUpload, error) {
	if _, ok := updates["updated_at"]; !ok {
		updates["updated_at"] = time.Now()
	}
	if err := r.db.WithContext(ctx).
		Model(&domain.RewardTaskUpload{}).
		Where("user_id = ? AND source_key = ?", userID, sourceKey).
		Updates(updates).Error; err != nil {
		return nil, err
	}
	return r.GetRewardTaskUploadBySourceKey(ctx, userID, sourceKey)
}

func (r *MembershipRepo) CountSharePosterClaims(ctx context.Context, userID, chinaDate string) (int, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.UserCreditBonusEvent{}).
		Where("user_id = ? AND bonus_type = ? AND bonus_date = ?", userID, "share_poster", chinaDate).
		Count(&count).Error
	return int(count), err
}

func (r *MembershipRepo) GetSharePosterClaim(ctx context.Context, userID, recordID, chinaDate string) (*domain.UserCreditBonusEvent, error) {
	var row domain.UserCreditBonusEvent
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND bonus_type = ? AND bonus_date = ? AND source_record_id = ?", userID, "share_poster", chinaDate, recordID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *MembershipRepo) GetSharePosterClaimBySourceKey(ctx context.Context, userID, sourceKey, chinaDate string) (*domain.UserCreditBonusEvent, error) {
	sourceKey = strings.TrimSpace(sourceKey)
	if sourceKey == "" {
		return nil, nil
	}
	var row domain.UserCreditBonusEvent
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND bonus_type = ? AND bonus_date = ? AND source_key = ?", userID, "share_poster", chinaDate, sourceKey).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *MembershipRepo) CreateSharePosterBonusEvent(ctx context.Context, userID, sourceKey, sourceScope, recordID, chinaDate string, credits int, meta map[string]any) (*domain.UserCreditBonusEvent, error) {
	now := time.Now()
	sourceKey = strings.TrimSpace(sourceKey)
	sourceScope = strings.TrimSpace(sourceScope)
	recordID = strings.TrimSpace(recordID)
	if meta == nil {
		meta = map[string]any{}
	}
	if sourceKey != "" {
		meta["source_key"] = sourceKey
	}
	if sourceScope != "" {
		meta["source_scope"] = sourceScope
	}
	row := &domain.UserCreditBonusEvent{
		ID:        uuid.New().String(),
		UserID:    userID,
		BonusType: "share_poster",
		BonusDate: chinaDate,
		Credits:   credits,
		Meta:      meta,
		CreatedAt: &now,
		UpdatedAt: &now,
	}
	if recordID != "" {
		row.SourceRecordID = &recordID
		meta["source_record_id"] = recordID
	}
	if sourceScope != "" {
		row.SourceScope = &sourceScope
	}
	if sourceKey != "" {
		row.SourceKey = &sourceKey
	}
	return row, r.db.WithContext(ctx).Create(row).Error
}

func (r *MembershipRepo) HasShareReward(ctx context.Context, userID, recordID string) (bool, error) {
	row, err := r.GetSharePosterClaim(ctx, userID, recordID, chinaToday())
	return row != nil, err
}

func (r *MembershipRepo) CreateShareReward(ctx context.Context, reward *domain.MembershipShareReward) error {
	sourceKey := "meal_record:" + reward.RecordID
	_, err := r.CreateSharePosterBonusEvent(ctx, reward.UserID, sourceKey, "meal_record", reward.RecordID, chinaToday(), 1, map[string]any{
		"source_record_id": reward.RecordID,
	})
	return err
}

type User struct {
	ID                   string     `gorm:"column:id"`
	OpenID               string     `gorm:"column:openid"`
	UnionID              *string    `gorm:"column:unionid"`
	EarnedCreditsBalance int        `gorm:"column:earned_credits_balance"`
	CreatedAt            *time.Time `gorm:"column:create_time"`
	Birthday             *string    `gorm:"column:birthday"`
}

func (User) TableName() string { return "weapp_user" }

type analysisTask struct {
	ID        string         `gorm:"column:id"`
	UserID    string         `gorm:"column:user_id"`
	TaskType  string         `gorm:"column:task_type"`
	Status    string         `gorm:"column:status"`
	Payload   map[string]any `gorm:"column:payload;serializer:json"`
	CreatedAt *time.Time     `gorm:"column:created_at"`
}

func (analysisTask) TableName() string { return "analysis_tasks" }

func chinaLocation() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err == nil {
		return loc
	}
	return time.FixedZone("CST", 8*3600)
}

func chinaToday() string {
	return time.Now().In(chinaLocation()).Format("2006-01-02")
}

func isFoodAnalysisTaskTypeForQuota(taskType string, payload map[string]any) bool {
	if boolFromAny(payload["exercise"]) {
		return false
	}
	taskType = strings.TrimSpace(taskType)
	return taskType == "food" ||
		taskType == "food_text" ||
		strings.HasPrefix(taskType, "food_debug") ||
		strings.HasPrefix(taskType, "food_text_debug") ||
		strings.HasPrefix(taskType, "precision_plan")
}

type creditUsageGroup struct {
	refunded    bool
	unitsByDate map[string]int
}

func creditUsageFromPayload(payload map[string]any) map[string]any {
	if usage, ok := payload["credit_usage"].(map[string]any); ok {
		return usage
	}
	return nil
}

func creditGroupID(row analysisTask) string {
	if usage := creditUsageFromPayload(row.Payload); len(usage) > 0 {
		if groupID := stringFromAny(usage["credit_group_id"]); groupID != "" {
			return groupID
		}
	}
	return stringFromAny(row.Payload["credit_group_id"])
}

func isCreditChargeStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "pending", "processing", "done":
		return true
	default:
		return false
	}
}

func isCreditRefundStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "failed", "timed_out", "cancelled":
		return true
	default:
		return false
	}
}

func taskSystemCreditUsageUnits(row analysisTask, chinaDate string) int {
	if usage, ok := row.Payload["credit_usage"].(map[string]any); ok {
		if byDate, ok := usage["system_by_date"].(map[string]any); ok {
			if isBillableCompletedCreditTaskType(row.TaskType, row.Payload) {
				return intFromAny(byDate[chinaDate])
			}
			return 0
		}
	}
	if row.CreatedAt == nil || row.CreatedAt.In(chinaLocation()).Format("2006-01-02") != chinaDate {
		return 0
	}
	if row.TaskType == "exercise" || boolFromAny(row.Payload["exercise"]) {
		return 1
	}
	if strings.HasPrefix(row.TaskType, "precision_plan") {
		return 4
	}
	if isFoodAnalysisTaskTypeForQuota(row.TaskType, row.Payload) {
		return 2
	}
	return 0
}

func isBillableCompletedCreditTaskType(taskType string, payload map[string]any) bool {
	taskType = strings.TrimSpace(taskType)
	if taskType == "exercise" || taskType == "expiry_recognize" {
		return true
	}
	if taskType == "food" || taskType == "food_text" {
		return true
	}
	if strings.HasPrefix(taskType, "food_debug") || strings.HasPrefix(taskType, "food_text_debug") {
		return true
	}
	if taskType == "precision_aggregate" || strings.HasPrefix(taskType, "precision_aggregate_debug") {
		return true
	}
	return false
}

func intFromAny(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case int32:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		i, _ := v.Int64()
		return int(i)
	default:
		return 0
	}
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case fmt.Stringer:
		return strings.TrimSpace(v.String())
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", value))
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func boolFromAny(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(v, "true") || v == "1"
	default:
		return false
	}
}
