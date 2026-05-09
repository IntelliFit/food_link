package repo

import (
	"context"
	"encoding/json"
	"errors"
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
		Where("is_active = ?", true).
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
		if isMembershipPlanCode(row.PlanCode) {
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
		if !isMembershipPlanCode(row.PlanCode) || row.UserID == "" {
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
		strings.HasPrefix(code, "light_") ||
		strings.HasPrefix(code, "standard_") ||
		strings.HasPrefix(code, "advanced_")
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
	total := 0
	for _, row := range rows {
		total += taskSystemCreditUsageUnits(row, chinaDate)
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
	if delta == 0 {
		return nil, false, nil
	}
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

func (r *MembershipRepo) CreateSharePosterBonusEvent(ctx context.Context, userID, recordID, chinaDate string, credits int) (*domain.UserCreditBonusEvent, error) {
	now := time.Now()
	row := &domain.UserCreditBonusEvent{
		ID:             uuid.New().String(),
		UserID:         userID,
		BonusType:      "share_poster",
		BonusDate:      chinaDate,
		Credits:        credits,
		SourceRecordID: &recordID,
		Meta:           map[string]any{"source_record_id": recordID},
		CreatedAt:      &now,
		UpdatedAt:      &now,
	}
	return row, r.db.WithContext(ctx).Create(row).Error
}

func (r *MembershipRepo) HasShareReward(ctx context.Context, userID, recordID string) (bool, error) {
	row, err := r.GetSharePosterClaim(ctx, userID, recordID, chinaToday())
	return row != nil, err
}

func (r *MembershipRepo) CreateShareReward(ctx context.Context, reward *domain.MembershipShareReward) error {
	_, err := r.CreateSharePosterBonusEvent(ctx, reward.UserID, reward.RecordID, chinaToday(), 1)
	return err
}

type User struct {
	ID                   string     `gorm:"column:id"`
	OpenID               string     `gorm:"column:openid"`
	EarnedCreditsBalance int        `gorm:"column:earned_credits_balance"`
	CreatedAt            *time.Time `gorm:"column:create_time"`
	Birthday             *string    `gorm:"column:birthday"`
}

func (User) TableName() string { return "weapp_user" }

type analysisTask struct {
	ID        string         `gorm:"column:id"`
	UserID    string         `gorm:"column:user_id"`
	TaskType  string         `gorm:"column:task_type"`
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

func taskSystemCreditUsageUnits(row analysisTask, chinaDate string) int {
	if usage, ok := row.Payload["credit_usage"].(map[string]any); ok {
		if byDate, ok := usage["system_by_date"].(map[string]any); ok {
			return intFromAny(byDate[chinaDate])
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
