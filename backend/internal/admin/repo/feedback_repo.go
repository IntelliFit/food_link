package repo

import (
	"context"
	"strings"

	feedbackdomain "food_link/backend/internal/feedback/domain"

	"gorm.io/gorm"
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

func (r *FeedbackRepo) UpdateStatus(ctx context.Context, id, status string) (*FeedbackItem, error) {
	if err := r.db.WithContext(ctx).
		Table("user_feedback").
		Where("id = ?", id).
		Updates(map[string]any{"status": strings.TrimSpace(status)}).Error; err != nil {
		return nil, err
	}
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
	return &item, nil
}

func applyFeedbackFilters(q *gorm.DB, input ListFeedbackInput) *gorm.DB {
	if query := strings.TrimSpace(input.Query); query != "" {
		like := "%" + query + "%"
		q = q.Where(
			`f.content ILIKE ? OR f.contact ILIKE ? OR f.submit_trace_id ILIKE ? OR f.submit_request_id ILIKE ? OR f.user_id::text ILIKE ?`,
			like, like, like, like, like,
		)
	}
	switch strings.TrimSpace(input.Category) {
	case "", "all":
	default:
		q = q.Where("f.category = ?", strings.TrimSpace(input.Category))
	}
	switch strings.TrimSpace(input.Status) {
	case "", "all":
	default:
		q = q.Where("f.status = ?", strings.TrimSpace(input.Status))
	}
	return q
}
