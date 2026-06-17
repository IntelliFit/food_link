package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	admindomain "food_link/backend/internal/admin/domain"
	commonerrors "food_link/backend/internal/common/errors"
	communityrepo "food_link/backend/internal/community/repo"
	membershipdomain "food_link/backend/internal/membership/domain"
	membershiprepo "food_link/backend/internal/membership/repo"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
	Items []admindomain.FeedReportItem `json:"items"`
	Total int64                        `json:"total"`
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

func (r *FeedReportRepo) UpdateStatus(ctx context.Context, id, status, resolutionNote, handledBy string, rewardCredits *int, reporterUserID string) (*admindomain.FeedReportItem, error) {
	updates := map[string]any{
		"status":          strings.TrimSpace(status),
		"resolution_note": strings.TrimSpace(resolutionNote),
		"handled_at":      time.Now(),
	}
	if handledBy != "" {
		updates["handled_by"] = handledBy
	}
	if rewardCredits != nil {
		updates["reward_credits"] = *rewardCredits
		if *rewardCredits == 0 {
			updates["reward_ledger_id"] = nil
		}
	}
	if err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if rewardCredits != nil && *rewardCredits > 0 {
			ledger, err := createFeedReportRewardLedger(ctx, tx, reporterUserID, id, *rewardCredits, handledBy)
			if err != nil {
				return err
			}
			if ledger != nil {
				updates["reward_ledger_id"] = ledger.ID
			}
		}
		return tx.Table("feed_reports").Where("id = ?", id).Updates(updates).Error
	}); err != nil {
		return nil, err
	}
	return r.GetByID(ctx, id)
}

func createFeedReportRewardLedger(ctx context.Context, tx *gorm.DB, userID, reportID string, credits int, handledBy string) (*membershipdomain.UserEarnedCreditLedger, error) {
	userID = strings.TrimSpace(userID)
	reportID = strings.TrimSpace(reportID)
	if userID == "" || reportID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "举报奖励缺少用户或举报 ID", HTTPStatus: 400}
	}
	sourceKey := "feed_report:" + reportID
	var existing membershipdomain.UserEarnedCreditLedger
	err := tx.WithContext(ctx).
		Where("user_id = ? AND reason = ? AND source_key = ?", userID, "feed_report_reward", sourceKey).
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
		"report_id":      reportID,
		"reward_source":  "admin_feed_report_resolution",
		"handled_by":     strings.TrimSpace(handledBy),
		"reward_credits": credits,
	}
	row := &membershipdomain.UserEarnedCreditLedger{
		ID:           uuid.New().String(),
		UserID:       userID,
		Delta:        credits,
		BalanceAfter: next,
		Reason:       "feed_report_reward",
		SourceKey:    &sourceKey,
		RelatedDate:  &relatedDate,
		Meta:         meta,
		CreatedAt:    &now,
		UpdatedAt:    &now,
	}
	if err := tx.WithContext(ctx).Create(row).Error; err != nil {
		return nil, fmt.Errorf("create feed report reward ledger: %w", err)
	}
	return row, nil
}

func (r *FeedReportRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).
		Table("feed_reports").
		Where("id = ?", id).
		Delete(nil).Error
}

func (r *FeedReportRepo) DeleteCirclePostTarget(ctx context.Context, postID string) error {
	post, err := r.feedRepo.GetCirclePostByID(ctx, postID)
	if err != nil {
		return err
	}
	if post == nil {
		return &commonerrors.AppError{Code: 10001, Message: "被举报的圈子内容不存在或已删除", HTTPStatus: 404}
	}
	if err := r.feedRepo.DeleteCirclePostInteractions(ctx, postID); err != nil {
		return err
	}
	return r.feedRepo.DeleteCirclePost(ctx, post.UserID, postID)
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

func (r *FeedReportRepo) CountByStatus(ctx context.Context) (map[string]int64, error) {
	rows := []struct {
		Status string
		Count  int64
	}{}
	if err := r.db.WithContext(ctx).
		Table("feed_reports").
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
