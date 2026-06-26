package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	feedbackdomain "food_link/backend/internal/feedback/domain"
	membershipdomain "food_link/backend/internal/membership/domain"
	membershiprepo "food_link/backend/internal/membership/repo"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FeedbackRepo struct {
	db *gorm.DB
}

func NewFeedbackRepo(db *gorm.DB) *FeedbackRepo {
	return &FeedbackRepo{db: db}
}

type ListFeedbackInput struct {
	Query    string
	Category string
	Source   string
	Status   string
	Limit    int
	Offset   int
}

type FeedbackItem struct {
	feedbackdomain.UserFeedback
	UserNickname  string `gorm:"column:user_nickname" json:"user_nickname"`
	UserAvatar    string `gorm:"column:user_avatar" json:"user_avatar"`
	UserTelephone string `gorm:"column:user_telephone" json:"user_telephone"`
}

type ListFeedbackResult struct {
	Items []FeedbackItem
	Total int64
}

func (r *FeedbackRepo) List(ctx context.Context, input ListFeedbackInput) (*ListFeedbackResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	offset := input.Offset
	if offset < 0 {
		offset = 0
	}

	q := r.db.WithContext(ctx).
		Table("user_feedback AS f").
		Joins("LEFT JOIN weapp_user AS u ON u.id = f.user_id")
	q = applyFeedbackFilters(q, input)

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}

	var items []FeedbackItem
	if err := q.Select(`
		f.*,
		COALESCE(u.nickname, '') AS user_nickname,
		COALESCE(u.avatar, '') AS user_avatar,
		COALESCE(u.telephone, '') AS user_telephone
	`).
		Order("f.created_at DESC").
		Offset(offset).
		Limit(limit).
		Scan(&items).Error; err != nil {
		return nil, err
	}
	return &ListFeedbackResult{Items: items, Total: total}, nil
}

func (r *FeedbackRepo) UpdateStatus(ctx context.Context, id, status, resolutionMessage string, rewardCredits *int, handledBy string) (*FeedbackItem, error) {
	item, err := r.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	updates := map[string]any{
		"status":             strings.TrimSpace(status),
		"resolution_message": strings.TrimSpace(resolutionMessage),
	}
	if rewardCredits != nil {
		updates["reward_credits"] = *rewardCredits
		if *rewardCredits == 0 {
			updates["reward_ledger_id"] = nil
		}
	}
	if err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if rewardCredits != nil && *rewardCredits > 0 {
			ledger, err := createFeedbackRewardLedger(ctx, tx, item.UserID, id, *rewardCredits, handledBy)
			if err != nil {
				return err
			}
			if ledger != nil {
				updates["reward_ledger_id"] = ledger.ID
			}
		}
		return tx.Table("user_feedback").Where("id = ?", id).Updates(updates).Error
	}); err != nil {
		return nil, err
	}
	return r.GetByID(ctx, id)
}

func (r *FeedbackRepo) GetByID(ctx context.Context, id string) (*FeedbackItem, error) {
	var item FeedbackItem
	if err := r.db.WithContext(ctx).
		Table("user_feedback AS f").
		Joins("LEFT JOIN weapp_user AS u ON u.id = f.user_id").
		Select(`
			f.*,
			COALESCE(u.nickname, '') AS user_nickname,
			COALESCE(u.avatar, '') AS user_avatar,
			COALESCE(u.telephone, '') AS user_telephone
		`).
		Where("f.id = ?", id).
		Scan(&item).Error; err != nil {
		return nil, err
	}
	if item.ID == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return &item, nil
}

func createFeedbackRewardLedger(ctx context.Context, tx *gorm.DB, userID, feedbackID string, credits int, handledBy string) (*membershipdomain.UserEarnedCreditLedger, error) {
	userID = strings.TrimSpace(userID)
	feedbackID = strings.TrimSpace(feedbackID)
	if userID == "" || feedbackID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "反馈奖励缺少用户或反馈 ID", HTTPStatus: 400}
	}
	sourceKey := "feedback:" + feedbackID
	var existing membershipdomain.UserEarnedCreditLedger
	err := tx.WithContext(ctx).
		Where("user_id = ? AND reason = ? AND source_key = ?", userID, "feedback_reward", sourceKey).
		First(&existing).Error
	if err == nil {
		return &existing, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	var user membershiprepo.User
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", userID).First(&user).Error; err != nil {
		return nil, err
	}
	next := user.EarnedCreditsBalance + credits
	if err := tx.WithContext(ctx).Table("weapp_user").Where("id = ?", userID).Update("earned_credits_balance", next).Error; err != nil {
		return nil, err
	}
	now := time.Now()
	relatedDate := now.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
	meta := map[string]any{
		"feedback_id":    feedbackID,
		"reward_source":  "admin_feedback_resolution",
		"handled_by":     strings.TrimSpace(handledBy),
		"reward_credits": credits,
	}
	row := &membershipdomain.UserEarnedCreditLedger{
		ID:           uuid.New().String(),
		UserID:       userID,
		Delta:        credits,
		BalanceAfter: next,
		Reason:       "feedback_reward",
		SourceKey:    &sourceKey,
		RelatedDate:  &relatedDate,
		Meta:         meta,
		CreatedAt:    &now,
		UpdatedAt:    &now,
	}
	if err := tx.WithContext(ctx).Create(row).Error; err != nil {
		return nil, fmt.Errorf("create feedback reward ledger: %w", err)
	}
	return row, nil
}

func (r *FeedbackRepo) CountByStatus(ctx context.Context) (map[string]int64, error) {
	rows := []struct {
		Status string
		Count  int64
	}{}
	if err := r.db.WithContext(ctx).
		Table("user_feedback").
		Select("status, COUNT(*) AS count").
		Group("status").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	result := map[string]int64{}
	for _, row := range rows {
		result[row.Status] = row.Count
	}
	return result, nil
}

func applyFeedbackFilters(q *gorm.DB, input ListFeedbackInput) *gorm.DB {
	if query := strings.TrimSpace(input.Query); query != "" {
		like := "%" + query + "%"
		q = q.Where(
			`f.id::text ILIKE ? OR f.content ILIKE ? OR f.contact ILIKE ? OR f.submit_trace_id ILIKE ? OR f.submit_request_id ILIKE ? OR f.user_id::text ILIKE ?`,
			like, like, like, like, like, like,
		)
	}
	switch strings.TrimSpace(input.Category) {
	case "", "all":
	default:
		q = q.Where("f.category = ?", strings.TrimSpace(input.Category))
	}
	switch strings.TrimSpace(input.Source) {
	case "", "all":
	default:
		q = q.Where("f.source = ?", strings.TrimSpace(input.Source))
	}
	switch strings.TrimSpace(input.Status) {
	case "", "all":
	default:
		q = q.Where("f.status = ?", strings.TrimSpace(input.Status))
	}
	return q
}
