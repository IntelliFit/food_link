package repo

import (
	"context"
	"strings"
	"time"

	admindomain "food_link/backend/internal/admin/domain"
	commonerrors "food_link/backend/internal/common/errors"
	communityrepo "food_link/backend/internal/community/repo"

	"gorm.io/gorm"
)

type FeedReportRepo struct {
	db       *gorm.DB
	feedRepo *communityrepo.FeedRepo
}

func NewFeedReportRepo(db *gorm.DB, feedRepo *communityrepo.FeedRepo) *FeedReportRepo {
	return &FeedReportRepo{db: db, feedRepo: feedRepo}
}

type ListFeedReportInput struct {
	Query      string
	Status     string
	TargetType string
	Limit      int
	Offset     int
}

type ListFeedReportResult struct {
	Items []admindomain.FeedReportItem
	Total int64
}

var reasonNames = map[string]string{
	"spam":    "垃圾广告",
	"porn":    "色情低俗",
	"illegal": "违法违规",
	"abuse":   "人身攻击",
	"other":   "其他",
}

func (r *FeedReportRepo) List(ctx context.Context, input ListFeedReportInput) (*ListFeedReportResult, error) {
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
		Table("feed_reports AS r").
		Joins("LEFT JOIN weapp_user AS ru ON ru.id = r.reporter_user_id").
		Joins("LEFT JOIN weapp_user AS rd ON rd.id = r.reported_user_id")
	q = applyFeedReportFilters(q, input)

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}

	var items []admindomain.FeedReportItem
	if err := q.Select(`
		r.*,
		COALESCE(ru.nickname, '') AS reporter_nickname,
		COALESCE(ru.avatar, '') AS reporter_avatar,
		COALESCE(rd.nickname, '') AS reported_nickname,
		COALESCE(rd.avatar, '') AS reported_avatar
	`).
		Order("r.created_at DESC").
		Offset(offset).
		Limit(limit).
		Scan(&items).Error; err != nil {
		return nil, err
	}
	for i := range items {
		items[i].ReasonName = reasonNames[items[i].Reason]
		if items[i].ReasonName == "" {
			items[i].ReasonName = items[i].Reason
		}
	}
	return &ListFeedReportResult{Items: items, Total: total}, nil
}

func (r *FeedReportRepo) GetByID(ctx context.Context, id string) (*admindomain.FeedReportItem, error) {
	var item admindomain.FeedReportItem
	if err := r.db.WithContext(ctx).
		Table("feed_reports AS r").
		Joins("LEFT JOIN weapp_user AS ru ON ru.id = r.reporter_user_id").
		Joins("LEFT JOIN weapp_user AS rd ON rd.id = r.reported_user_id").
		Select(`
			r.*,
			COALESCE(ru.nickname, '') AS reporter_nickname,
			COALESCE(ru.avatar, '') AS reporter_avatar,
			COALESCE(rd.nickname, '') AS reported_nickname,
			COALESCE(rd.avatar, '') AS reported_avatar
		`).
		Where("r.id = ?", id).
		Scan(&item).Error; err != nil {
		return nil, err
	}
	if item.ID == "" {
		return nil, &commonerrors.AppError{Code: 10001, Message: "举报记录不存在", HTTPStatus: 404}
	}
	item.ReasonName = reasonNames[item.Reason]
	if item.ReasonName == "" {
		item.ReasonName = item.Reason
	}
	return &item, nil
}

func (r *FeedReportRepo) UpdateStatus(ctx context.Context, id, status, resolutionNote, handledBy string) (*admindomain.FeedReportItem, error) {
	updates := map[string]any{
		"status":          strings.TrimSpace(status),
		"resolution_note": strings.TrimSpace(resolutionNote),
		"handled_at":      time.Now(),
	}
	if handledBy != "" {
		updates["handled_by"] = handledBy
	}
	if err := r.db.WithContext(ctx).
		Table("feed_reports").
		Where("id = ?", id).
		Updates(updates).Error; err != nil {
		return nil, err
	}
	return r.GetByID(ctx, id)
}

func (r *FeedReportRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).
		Table("feed_reports").
		Where("id = ?", id).
		Delete(nil).Error
}

func (r *FeedReportRepo) GetTargetSnapshot(ctx context.Context, targetType, targetID string) (*admindomain.FeedReportTargetSnapshot, error) {
	target, err := r.feedRepo.GetFeedTargetByID(ctx, targetType, targetID)
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, nil
	}
	snap := &admindomain.FeedReportTargetSnapshot{
		AuthorID:  target.UserID,
		CreatedAt: target.CreatedAt,
		ImageURLs: target.ImagePaths,
	}
	if target.Title != nil {
		snap.Title = *target.Title
	}
	if target.Body != nil {
		snap.Body = *target.Body
	}
	if target.Description != nil {
		snap.Description = *target.Description
	}
	if snap.ImageURLs == nil && target.ImagePath != nil && *target.ImagePath != "" {
		snap.ImageURLs = []string{*target.ImagePath}
	}
	return snap, nil
}

func applyFeedReportFilters(q *gorm.DB, input ListFeedReportInput) *gorm.DB {
	if query := strings.TrimSpace(input.Query); query != "" {
		like := "%" + query + "%"
		q = q.Where(
			`r.id::text ILIKE ? OR r.reason ILIKE ? OR r.extra_content ILIKE ? OR ru.nickname ILIKE ? OR rd.nickname ILIKE ?`,
			like, like, like, like, like,
		)
	}
	if status := strings.TrimSpace(input.Status); status != "" && status != "all" {
		q = q.Where("r.status = ?", status)
	}
	if targetType := strings.TrimSpace(input.TargetType); targetType != "" && targetType != "all" {
		q = q.Where("r.target_type = ?", targetType)
	}
	return q
}
