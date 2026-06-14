package service

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/community/domain"
	"food_link/backend/internal/community/repo"
	"food_link/backend/internal/foodmedia"
	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var chinaTZ = time.FixedZone("Asia/Shanghai", 8*60*60)

type FeedRepo interface {
	ListPublicFeed(ctx context.Context, contentType, mealType, dietGoal, date, sortBy string, limit int) ([]repo.FeedRecord, error)
	ListFriendFeed(ctx context.Context, authorIDs []string, contentType, mealType, dietGoal, date, sortBy string, limit int) ([]repo.FeedRecord, error)
	GetFeedRecordByID(ctx context.Context, recordID string) (*repo.FeedRecord, error)
	GetFeedTargetByID(ctx context.Context, targetType, targetID string) (*repo.FeedRecord, error)
	HideFeedRecord(ctx context.Context, userID, recordID string) error
	HideFeedTarget(ctx context.Context, userID, targetType, targetID string) error
	AddLike(ctx context.Context, userID, recordID string) error
	AddLikeTarget(ctx context.Context, userID, targetType, targetID string) error
	RemoveLike(ctx context.Context, userID, recordID string) error
	RemoveLikeTarget(ctx context.Context, userID, targetType, targetID string) error
	GetLikesForRecords(ctx context.Context, recordIDs []string, currentUserID string) (map[string]*repo.LikeInfo, error)
	GetLikesForTargets(ctx context.Context, targets []repo.FeedTarget, currentUserID string) (map[string]*repo.LikeInfo, error)
	AddComment(ctx context.Context, comment *domain.FeedComment) error
	ListComments(ctx context.Context, recordID string, limit int) ([]domain.FeedComment, error)
	ListCommentsForTarget(ctx context.Context, targetType, targetID string, limit int) ([]domain.FeedComment, error)
	ListCommentsByRecordIDs(ctx context.Context, recordIDs []string) ([]domain.FeedComment, error)
	ListCommentsByTargets(ctx context.Context, targets []repo.FeedTarget) ([]domain.FeedComment, error)
	GetCommentByID(ctx context.Context, commentID string) (*domain.FeedComment, error)
	FindRecentDuplicate(ctx context.Context, userID, recordID, content string, parentCommentID, replyToUserID *string, window time.Duration) (*domain.FeedComment, error)
	FindRecentDuplicateForTarget(ctx context.Context, userID, targetType, targetID, content string, parentCommentID, replyToUserID *string, window time.Duration) (*domain.FeedComment, error)
	DeleteCommentCascade(ctx context.Context, targetType, targetID, commentID string) (int64, error)
	GetFriendIDs(ctx context.Context, userID string) ([]string, error)
	IsFriend(ctx context.Context, userID, friendID string) (bool, error)
	GetUserProfiles(ctx context.Context, userIDs []string) (map[string]*repo.UserProfile, error)
	GetCheckinCounts(ctx context.Context, userIDs []string, weekStart, weekEnd time.Time) (map[string]int, error)
	CreateCirclePost(ctx context.Context, post *domain.UserCirclePost) error
	GetCirclePostByID(ctx context.Context, postID string) (*domain.UserCirclePost, error)
	UpdateCirclePost(ctx context.Context, userID, postID, content string, imagePaths []string, totalCalories, totalProtein, totalCarbs, totalFat *float64) error
	DeleteCirclePost(ctx context.Context, userID, postID string) error
	DeleteCirclePostInteractions(ctx context.Context, postID string) error
}

type NotificationRepo interface {
	CreateNotification(ctx context.Context, n *domain.FeedInteractionNotification) error
	FindRecentDuplicate(ctx context.Context, recipientUserID, notificationType string, actorUserID, recordID, parentCommentID, commentID, contentPreview *string) (*domain.FeedInteractionNotification, error)
	FindRecentDuplicateForTarget(ctx context.Context, recipientUserID, notificationType string, actorUserID *string, targetType string, targetID *string, parentCommentID, commentID, contentPreview *string) (*domain.FeedInteractionNotification, error)
	ListNotifications(ctx context.Context, userID string, limit int) ([]domain.FeedInteractionNotification, error)
	CountUnread(ctx context.Context, userID string) (int64, error)
	MarkRead(ctx context.Context, userID string, notificationIDs []string) (int64, error)
	ListCommentTasksByUser(ctx context.Context, userID, commentType string, limit int) ([]domain.CommentTask, error)
}

type CommunityService struct {
	feedRepo  FeedRepo
	notifRepo NotificationRepo
	userRepo  UserFinder
	db        *gorm.DB
	storage   *storage.Client
}

type UserFinder interface {
	FindByID(ctx context.Context, userID string) (*authrepo.User, error)
}

func NewCommunityService(feedRepo FeedRepo, notifRepo NotificationRepo, userRepo UserFinder, db *gorm.DB, storageClient ...*storage.Client) *CommunityService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &CommunityService{
		feedRepo:  feedRepo,
		notifRepo: notifRepo,
		userRepo:  userRepo,
		db:        db,
		storage:   client,
	}
}

type FeedParams struct {
	Offset            int
	Limit             int
	IncludeComments   bool
	CommentsLimit     int
	MealType          string
	DietGoal          string
	Date              string
	SortBy            string
	ContentType       string
	PriorityAuthorIDs []string
	AuthorScope       string
	AuthorID          string
}

type FeedItem struct {
	TargetType      string            `json:"target_type"`
	TargetID        string            `json:"target_id"`
	Record          repo.FeedRecord   `json:"record"`
	Author          map[string]string `json:"author"`
	LikeCount       int               `json:"like_count"`
	Liked           bool              `json:"liked"`
	IsMine          bool              `json:"is_mine"`
	RecommendReason string            `json:"recommend_reason"`
	Comments        []CommentItem     `json:"comments,omitempty"`
	CommentCount    int               `json:"comment_count"`
}

type CommentItem struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	RecordID        *string    `json:"record_id,omitempty"`
	TargetType      string     `json:"target_type"`
	TargetID        string     `json:"target_id"`
	ParentCommentID *string    `json:"parent_comment_id,omitempty"`
	ReplyToUserID   *string    `json:"reply_to_user_id,omitempty"`
	ReplyToNickname string     `json:"reply_to_nickname"`
	Content         string     `json:"content"`
	CreatedAt       *time.Time `json:"created_at"`
	Nickname        string     `json:"nickname"`
	Avatar          string     `json:"avatar"`
}

type LeaderboardItem struct {
	UserID       string `json:"user_id"`
	Nickname     string `json:"nickname"`
	Avatar       string `json:"avatar"`
	CheckinCount int    `json:"checkin_count"`
	IsMe         bool   `json:"is_me"`
	Rank         int    `json:"rank"`
}

type LeaderboardResult struct {
	WeekStart string            `json:"week_start"`
	WeekEnd   string            `json:"week_end"`
	List      []LeaderboardItem `json:"list"`
}

type NotificationItem struct {
	ID               string            `json:"id"`
	NotificationType string            `json:"notification_type"`
	RecordID         *string           `json:"record_id,omitempty"`
	TargetType       string            `json:"target_type"`
	TargetID         string            `json:"target_id"`
	CommentID        *string           `json:"comment_id,omitempty"`
	ParentCommentID  *string           `json:"parent_comment_id,omitempty"`
	ContentPreview   string            `json:"content_preview"`
	IsRead           bool              `json:"is_read"`
	CreatedAt        *time.Time        `json:"created_at"`
	Actor            map[string]string `json:"actor"`
}

type NotificationListResult struct {
	List        []NotificationItem `json:"list"`
	UnreadCount int64              `json:"unread_count"`
}

type MarkReadResult struct {
	Updated     int64 `json:"updated"`
	UnreadCount int64 `json:"unread_count"`
}

func (s *CommunityService) PublicFeed(ctx context.Context, params FeedParams) ([]FeedItem, error) {
	return s.publicFeed(ctx, params, "")
}

func (s *CommunityService) publicFeed(ctx context.Context, params FeedParams, viewerUserID string) ([]FeedItem, error) {
	customRank := params.SortBy == "recommended" || params.SortBy == "hot" || params.SortBy == "balanced"
	candidateLimit := params.Offset + params.Limit
	if customRank {
		candidateLimit = max(max(params.Offset+params.Limit+40, params.Limit*3), 60)
	}

	records, err := s.feedRepo.ListPublicFeed(ctx, params.ContentType, params.MealType, params.DietGoal, params.Date, params.SortBy, candidateLimit)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}

	targets := feedTargetsFromRecords(records)

	likesMap, err := s.feedRepo.GetLikesForTargets(ctx, targets, viewerUserID)
	if err != nil {
		return nil, err
	}

	var commentCountMap map[string]int
	if customRank {
		commentCountMap = s.getCommentCountsForTargets(ctx, targets)
	}

	if customRank {
		records = s.sortAndSlice(records, params, likesMap, commentCountMap, nil)
	} else {
		records = sliceRecords(records, params.Offset, params.Limit)
	}

	if len(records) == 0 {
		return nil, nil
	}

	targets = feedTargetsFromRecords(records)
	likesMap, _ = s.feedRepo.GetLikesForTargets(ctx, targets, viewerUserID)

	var commentsMap map[string][]CommentItem
	if params.IncludeComments {
		commentsMap = s.getCommentsMapForTargets(ctx, targets, params.CommentsLimit)
	}
	if commentCountMap == nil {
		commentCountMap = s.getCommentCountsForTargets(ctx, targets)
	}

	userIDs := make([]string, 0, len(records))
	for _, r := range records {
		userIDs = append(userIDs, r.UserID)
	}
	profiles, _ := s.feedRepo.GetUserProfiles(ctx, userIDs)

	items := make([]FeedItem, 0, len(records))
	for _, rec := range records {
		rec = s.normalizeFeedRecord(ctx, rec)
		profile := profiles[rec.UserID]
		author := map[string]string{"id": rec.UserID, "nickname": "用户", "avatar": ""}
		if profile != nil {
			author["nickname"] = profile.Nickname
			author["avatar"] = s.resolveAvatarURL(profile.Avatar)
		}
		targetType, targetID := feedTargetOfRecord(rec)
		targetKey := repo.FeedTargetKey(targetType, targetID)
		likeInfo := likesMap[targetKey]
		if likeInfo == nil {
			likeInfo = &repo.LikeInfo{}
		}
		likeCount := likeInfo.Count
		commentCount := commentCountMap[targetKey]
		liked := likeInfo.Liked
		// Campus food items use denormalized counts from public_food_library
		if rec.FeedType == "campus_food" {
			likeCount = rec.LikeCount
			commentCount = rec.CommentCount
		}
		item := FeedItem{
			TargetType:      targetType,
			TargetID:        targetID,
			Record:          rec,
			Author:          author,
			LikeCount:       likeCount,
			Liked:           liked,
			IsMine:          viewerUserID != "" && rec.UserID == viewerUserID,
			RecommendReason: s.buildRecommendReason(&rec, params.SortBy, params.MealType, params.DietGoal, nil, likeCount, commentCount),
			CommentCount:    commentCount,
		}
		if params.IncludeComments {
			item.Comments = commentsMap[targetKey]
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *CommunityService) FriendFeed(ctx context.Context, userID string, params FeedParams) ([]FeedItem, error) {
	if params.AuthorID == "" && params.AuthorScope == "public" {
		return s.publicFeed(ctx, params, userID)
	}

	friendIDs, err := s.feedRepo.GetFriendIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	authorIDSet := make(map[string]bool)
	authorIDSet[userID] = true
	for _, fid := range friendIDs {
		authorIDSet[fid] = true
	}

	var authorIDs []string
	if params.AuthorID != "" {
		if !authorIDSet[params.AuthorID] {
			return nil, nil
		}
		authorIDs = []string{params.AuthorID}
	} else {
		for id := range authorIDSet {
			authorIDs = append(authorIDs, id)
		}
		normalizedPriority := make([]string, 0)
		seen := make(map[string]bool)
		for _, pid := range params.PriorityAuthorIDs {
			pid = strings.TrimSpace(pid)
			if pid != "" && !seen[pid] && authorIDSet[pid] {
				seen[pid] = true
				normalizedPriority = append(normalizedPriority, pid)
			}
		}
		if params.AuthorScope == "priority" {
			authorIDs = normalizedPriority
			if len(authorIDs) == 0 {
				return nil, nil
			}
		}
		params.PriorityAuthorIDs = normalizedPriority
	}

	customRank := params.SortBy == "recommended" || params.SortBy == "hot" || params.SortBy == "balanced"
	candidateLimit := params.Offset + params.Limit
	if customRank {
		candidateLimit = max(max(params.Offset+params.Limit+40, params.Limit*3), 60)
	}

	records, err := s.feedRepo.ListFriendFeed(ctx, authorIDs, params.ContentType, params.MealType, params.DietGoal, params.Date, params.SortBy, candidateLimit)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}

	targets := feedTargetsFromRecords(records)

	likesMap, err := s.feedRepo.GetLikesForTargets(ctx, targets, userID)
	if err != nil {
		return nil, err
	}

	var commentCountMap map[string]int
	if customRank {
		commentCountMap = s.getCommentCountsForTargets(ctx, targets)
	}

	if customRank {
		records = s.sortAndSlice(records, params, likesMap, commentCountMap, nil)
	} else {
		records = sliceRecords(records, params.Offset, params.Limit)
	}

	if len(records) == 0 {
		return nil, nil
	}

	targets = feedTargetsFromRecords(records)
	likesMap, _ = s.feedRepo.GetLikesForTargets(ctx, targets, userID)

	var commentsMap map[string][]CommentItem
	if params.IncludeComments {
		commentsMap = s.getCommentsMapForTargets(ctx, targets, params.CommentsLimit)
	}
	if commentCountMap == nil {
		commentCountMap = s.getCommentCountsForTargets(ctx, targets)
	}

	userIDs := make([]string, 0, len(records))
	for _, r := range records {
		userIDs = append(userIDs, r.UserID)
	}
	profiles, _ := s.feedRepo.GetUserProfiles(ctx, userIDs)

	items := make([]FeedItem, 0, len(records))
	for _, rec := range records {
		rec = s.normalizeFeedRecord(ctx, rec)
		profile := profiles[rec.UserID]
		author := map[string]string{"id": rec.UserID, "nickname": "用户", "avatar": ""}
		if profile != nil {
			author["nickname"] = profile.Nickname
			author["avatar"] = s.resolveAvatarURL(profile.Avatar)
		}
		targetType, targetID := feedTargetOfRecord(rec)
		targetKey := repo.FeedTargetKey(targetType, targetID)
		likeInfo := likesMap[targetKey]
		if likeInfo == nil {
			likeInfo = &repo.LikeInfo{}
		}
		item := FeedItem{
			TargetType:      targetType,
			TargetID:        targetID,
			Record:          rec,
			Author:          author,
			LikeCount:       likeInfo.Count,
			Liked:           likeInfo.Liked,
			IsMine:          rec.UserID == userID,
			RecommendReason: s.buildRecommendReason(&rec, params.SortBy, params.MealType, params.DietGoal, params.PriorityAuthorIDs, likeInfo.Count, commentCountMap[targetKey]),
			CommentCount:    commentCountMap[targetKey],
		}
		if params.IncludeComments {
			item.Comments = commentsMap[targetKey]
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *CommunityService) sortAndSlice(records []repo.FeedRecord, params FeedParams, likesMap map[string]*repo.LikeInfo, commentCountMap map[string]int, priorityAuthorIDs []string) []repo.FeedRecord {
	sort.SliceStable(records, func(i, j int) bool {
		ti := recordTimeStamp(records[i].RecordTime)
		tj := recordTimeStamp(records[j].RecordTime)
		li := 0
		iKey := feedTargetKeyOfRecord(records[i])
		jKey := feedTargetKeyOfRecord(records[j])
		if likesMap[iKey] != nil {
			li = likesMap[iKey].Count
		}
		lj := 0
		if likesMap[jKey] != nil {
			lj = likesMap[jKey].Count
		}
		si := scoreFeedRecord(&records[i], params.SortBy, li, commentCountMap[iKey], params.MealType, params.DietGoal, priorityAuthorIDs)
		sj := scoreFeedRecord(&records[j], params.SortBy, lj, commentCountMap[jKey], params.MealType, params.DietGoal, priorityAuthorIDs)
		if si != sj {
			return si > sj
		}
		if ti != tj {
			return ti > tj
		}
		return records[i].ID > records[j].ID
	})
	return sliceRecords(records, params.Offset, params.Limit)
}

func sliceRecords(records []repo.FeedRecord, offset, limit int) []repo.FeedRecord {
	if offset >= len(records) {
		return nil
	}
	end := offset + limit
	if end > len(records) {
		end = len(records)
	}
	return records[offset:end]
}

func (s *CommunityService) getCommentCounts(ctx context.Context, recordIDs []string) map[string]int {
	targets := make([]repo.FeedTarget, 0, len(recordIDs))
	for _, id := range recordIDs {
		targets = append(targets, repo.FeedTarget{TargetType: repo.FeedTargetFoodRecord, TargetID: id})
	}
	targetCounts := s.getCommentCountsForTargets(ctx, targets)
	counts := map[string]int{}
	for _, id := range recordIDs {
		counts[id] = targetCounts[repo.FeedTargetKey(repo.FeedTargetFoodRecord, id)]
	}
	return counts
}

func (s *CommunityService) getCommentCountsForTargets(ctx context.Context, targets []repo.FeedTarget) map[string]int {
	if len(targets) == 0 {
		return map[string]int{}
	}
	comments, err := s.feedRepo.ListCommentsByTargets(ctx, targets)
	if err != nil {
		return map[string]int{}
	}
	counts := make(map[string]int)
	for _, c := range comments {
		counts[commentTargetKey(c)]++
	}
	return counts
}

func (s *CommunityService) getCommentsMap(ctx context.Context, recordIDs []string, commentsLimit int) map[string][]CommentItem {
	targets := make([]repo.FeedTarget, 0, len(recordIDs))
	for _, id := range recordIDs {
		targets = append(targets, repo.FeedTarget{TargetType: repo.FeedTargetFoodRecord, TargetID: id})
	}
	targetMap := s.getCommentsMapForTargets(ctx, targets, commentsLimit)
	result := map[string][]CommentItem{}
	for _, id := range recordIDs {
		result[id] = targetMap[repo.FeedTargetKey(repo.FeedTargetFoodRecord, id)]
	}
	return result
}

func (s *CommunityService) getCommentsMapForTargets(ctx context.Context, targets []repo.FeedTarget, commentsLimit int) map[string][]CommentItem {
	if len(targets) == 0 {
		return map[string][]CommentItem{}
	}
	comments, err := s.feedRepo.ListCommentsByTargets(ctx, targets)
	if err != nil {
		return map[string][]CommentItem{}
	}

	userIDs := make(map[string]bool)
	for _, c := range comments {
		userIDs[c.UserID] = true
		if c.ReplyToUserID != nil {
			userIDs[*c.ReplyToUserID] = true
		}
	}
	ids := make([]string, 0, len(userIDs))
	for id := range userIDs {
		ids = append(ids, id)
	}
	profiles, _ := s.feedRepo.GetUserProfiles(ctx, ids)

	recordComments := make(map[string][]domain.FeedComment)
	for _, c := range comments {
		recordComments[commentTargetKey(c)] = append(recordComments[commentTargetKey(c)], c)
	}

	result := make(map[string][]CommentItem)
	for targetKey, list := range recordComments {
		if commentsLimit > 0 && len(list) > commentsLimit {
			list = list[len(list)-commentsLimit:]
		}
		items := make([]CommentItem, 0, len(list))
		for _, c := range list {
			author := profiles[c.UserID]
			var replyUser *repo.UserProfile
			if c.ReplyToUserID != nil {
				replyUser = profiles[*c.ReplyToUserID]
			}
			items = append(items, CommentItem{
				ID:              c.ID,
				UserID:          c.UserID,
				RecordID:        c.RecordID,
				TargetType:      commentTargetType(c),
				TargetID:        commentTargetID(c),
				ParentCommentID: c.ParentCommentID,
				ReplyToUserID:   c.ReplyToUserID,
				ReplyToNickname: strOr(replyUser, ""),
				Content:         c.Content,
				CreatedAt:       c.CreatedAt,
				Nickname:        strOr(author, "用户"),
				Avatar:          s.resolveAvatarURL(strOrAvatar(author)),
			})
		}
		result[targetKey] = items
	}
	return result
}

func strOr(profile *repo.UserProfile, fallback string) string {
	if profile != nil && profile.Nickname != "" {
		return profile.Nickname
	}
	return fallback
}

func strOrAvatar(profile *repo.UserProfile) string {
	if profile != nil {
		return profile.Avatar
	}
	return ""
}

func (s *CommunityService) normalizeFeedRecord(ctx context.Context, record repo.FeedRecord) repo.FeedRecord {
	if strings.TrimSpace(record.FeedType) == "" {
		record.FeedType = repo.FeedTargetFoodRecord
	}
	if record.RecordTime != nil {
		recordTime := record.RecordTime.In(chinaTZ)
		record.RecordTime = &recordTime
	}
	if record.FeedType == repo.FeedTargetExerciseLog {
		if record.ImagePath != nil {
			resolved := s.resolveFoodImageURL(*record.ImagePath)
			if resolved == "" {
				record.ImagePath = nil
			} else {
				record.ImagePath = &resolved
				record.ImagePaths = []string{resolved}
			}
		}
		return record
	}
	if record.FeedType == repo.FeedTargetCirclePost {
		record.ImagePaths = s.resolveFoodImageURLs(record.ImagePaths)
		if len(record.ImagePaths) > 0 {
			first := record.ImagePaths[0]
			record.ImagePath = &first
		}
		return record
	}
	record.Items = foodmedia.EnrichFoodRecordDisplayFields(
		ctx,
		s.db,
		s.storage,
		&record.ImagePath,
		&record.ImagePaths,
		record.Items,
	)
	record.ImagePaths = s.resolveFoodImageURLs(record.ImagePaths)
	if len(record.ImagePaths) > 0 {
		first := record.ImagePaths[0]
		record.ImagePath = &first
		return record
	}
	if record.ImagePath != nil {
		resolved := s.resolveFoodImageURL(*record.ImagePath)
		if resolved == "" {
			record.ImagePath = nil
		} else {
			record.ImagePath = &resolved
			record.ImagePaths = []string{resolved}
		}
	}
	return record
}

func (s *CommunityService) resolveFoodImageURLs(values []string) []string {
	if s.storage != nil {
		return s.storage.ResolveReferenceURLs("food-images", values)
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (s *CommunityService) resolveFoodImageURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("food-images", value)
	if resolved == "" {
		return value
	}
	return resolved
}

func (s *CommunityService) resolveAvatarURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("user-avatars", value)
	if resolved == "" {
		return value
	}
	return resolved
}

// leaderboard cache
type leaderboardCacheEntry struct {
	result    *LeaderboardResult
	expiresAt time.Time
}

var leaderboardCache sync.Map

func chinaWeekWindow(now time.Time) (time.Time, time.Time, string, string) {
	nowCN := now.In(chinaTZ)
	weekday := nowCN.Weekday()
	if weekday == time.Sunday {
		weekday = 7
	}
	todayStartCN := time.Date(nowCN.Year(), nowCN.Month(), nowCN.Day(), 0, 0, 0, 0, chinaTZ)
	weekStartCN := todayStartCN.AddDate(0, 0, -int(weekday-1))
	weekEndCN := weekStartCN.AddDate(0, 0, 7)
	return weekStartCN, weekEndCN, weekStartCN.Format("2006-01-02"), weekStartCN.AddDate(0, 0, 6).Format("2006-01-02")
}

func (s *CommunityService) CheckinLeaderboard(ctx context.Context, viewerUserID string) (*LeaderboardResult, error) {
	friendIDs, err := s.feedRepo.GetFriendIDs(ctx, viewerUserID)
	if err != nil {
		return nil, err
	}
	authorIDSet := make(map[string]bool)
	authorIDSet[viewerUserID] = true
	for _, fid := range friendIDs {
		authorIDSet[fid] = true
	}
	authorIDs := make([]string, 0, len(authorIDSet))
	for id := range authorIDSet {
		authorIDs = append(authorIDs, id)
	}

	weekStartCN, weekEndCN, weekStartStr, weekEndStr := chinaWeekWindow(time.Now())

	cacheKey := viewerUserID + ":" + weekStartStr
	if cached, ok := leaderboardCache.Load(cacheKey); ok {
		entry := cached.(leaderboardCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.result, nil
		}
		leaderboardCache.Delete(cacheKey)
	}

	counts, err := s.feedRepo.GetCheckinCounts(ctx, authorIDs, weekStartCN.UTC(), weekEndCN.UTC())
	if err != nil {
		return nil, err
	}

	profiles, err := s.feedRepo.GetUserProfiles(ctx, authorIDs)
	if err != nil {
		return nil, err
	}

	items := make([]LeaderboardItem, 0, len(authorIDs))
	for _, uid := range authorIDs {
		p := profiles[uid]
		nickname := "用户"
		avatar := ""
		if p != nil {
			if p.Nickname != "" {
				nickname = p.Nickname
			}
			avatar = s.resolveAvatarURL(p.Avatar)
		}
		items = append(items, LeaderboardItem{
			UserID:       uid,
			Nickname:     nickname,
			Avatar:       avatar,
			CheckinCount: counts[uid],
			IsMe:         uid == viewerUserID,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].CheckinCount != items[j].CheckinCount {
			return items[i].CheckinCount > items[j].CheckinCount
		}
		return items[i].Nickname < items[j].Nickname
	})
	for i := range items {
		items[i].Rank = i + 1
	}

	result := &LeaderboardResult{
		WeekStart: weekStartStr,
		WeekEnd:   weekEndStr,
		List:      items,
	}
	leaderboardCache.Store(cacheKey, leaderboardCacheEntry{
		result:    result,
		expiresAt: time.Now().Add(5 * time.Minute),
	})
	return result, nil
}

func (s *CommunityService) LikeFeed(ctx context.Context, userID, recordID string) (string, error) {
	return s.LikeFeedTarget(ctx, userID, repo.FeedTargetFoodRecord, recordID)
}

func (s *CommunityService) LikeFeedTarget(ctx context.Context, userID, targetType, targetID string) (string, error) {
	targetType = normalizeServiceTargetType(targetType)
	record, err := s.feedRepo.GetFeedTargetByID(ctx, targetType, targetID)
	if err != nil {
		return "", err
	}
	if record == nil {
		return "", commonerrors.ErrNotFound
	}
	ctxCheck, err := s.getFeedRecordInteractionContext(ctx, userID, record)
	if err != nil {
		return "", err
	}
	if !ctxCheck.Allowed {
		if ctxCheck.Reason == "not_found" {
			return "", commonerrors.ErrNotFound
		}
		return "", commonerrors.ErrForbidden
	}

	if err := s.feedRepo.AddLikeTarget(ctx, userID, targetType, targetID); err != nil {
		return "", err
	}

	// Create notification for record owner
	if record.UserID != "" && record.UserID != userID {
		duplicate, _ := s.notifRepo.FindRecentDuplicateForTarget(ctx, record.UserID, "like_received", &userID, targetType, &targetID, nil, nil, nil)
		if duplicate == nil {
			_ = s.notifRepo.CreateNotification(ctx, &domain.FeedInteractionNotification{
				RecipientUserID:  record.UserID,
				ActorUserID:      &userID,
				RecordID:         legacyRecordID(targetType, targetID),
				TargetType:       targetType,
				TargetID:         &targetID,
				NotificationType: "like_received",
			})
		}
	}
	return "已点赞", nil
}

func (s *CommunityService) UnlikeFeed(ctx context.Context, userID, recordID string) (string, error) {
	return s.UnlikeFeedTarget(ctx, userID, repo.FeedTargetFoodRecord, recordID)
}

func (s *CommunityService) UnlikeFeedTarget(ctx context.Context, userID, targetType, targetID string) (string, error) {
	if err := s.feedRepo.RemoveLikeTarget(ctx, userID, normalizeServiceTargetType(targetType), targetID); err != nil {
		return "", err
	}
	return "已取消", nil
}

func (s *CommunityService) HideFeed(ctx context.Context, userID, recordID string) error {
	return s.HideFeedTarget(ctx, userID, repo.FeedTargetFoodRecord, recordID)
}

func (s *CommunityService) HideFeedTarget(ctx context.Context, userID, targetType, targetID string) error {
	targetType = normalizeServiceTargetType(targetType)
	record, err := s.feedRepo.GetFeedTargetByID(ctx, targetType, targetID)
	if err != nil {
		return err
	}
	if record == nil {
		return commonerrors.ErrNotFound
	}
	if record.UserID != userID {
		return commonerrors.ErrForbidden
	}
	return s.feedRepo.HideFeedTarget(ctx, userID, targetType, targetID)
}

func (s *CommunityService) ListComments(ctx context.Context, recordID string, limit int) ([]CommentItem, error) {
	return s.ListTargetComments(ctx, repo.FeedTargetFoodRecord, recordID, limit)
}

func (s *CommunityService) ListTargetComments(ctx context.Context, targetType, targetID string, limit int) ([]CommentItem, error) {
	comments, err := s.feedRepo.ListCommentsForTarget(ctx, normalizeServiceTargetType(targetType), targetID, limit)
	if err != nil {
		return nil, err
	}
	if len(comments) == 0 {
		return []CommentItem{}, nil
	}

	userIDs := make(map[string]bool)
	for _, c := range comments {
		userIDs[c.UserID] = true
		if c.ReplyToUserID != nil {
			userIDs[*c.ReplyToUserID] = true
		}
	}
	ids := make([]string, 0, len(userIDs))
	for id := range userIDs {
		ids = append(ids, id)
	}
	profiles, _ := s.feedRepo.GetUserProfiles(ctx, ids)

	items := make([]CommentItem, 0, len(comments))
	for _, c := range comments {
		author := profiles[c.UserID]
		var replyUser *repo.UserProfile
		if c.ReplyToUserID != nil {
			replyUser = profiles[*c.ReplyToUserID]
		}
		items = append(items, CommentItem{
			ID:              c.ID,
			UserID:          c.UserID,
			RecordID:        c.RecordID,
			TargetType:      commentTargetType(c),
			TargetID:        commentTargetID(c),
			ParentCommentID: c.ParentCommentID,
			ReplyToUserID:   c.ReplyToUserID,
			ReplyToNickname: strOr(replyUser, ""),
			Content:         c.Content,
			CreatedAt:       c.CreatedAt,
			Nickname:        strOr(author, "用户"),
			Avatar:          s.resolveAvatarURL(strOrAvatar(author)),
		})
	}
	return items, nil
}

type FeedContextResult struct {
	Allowed      bool              `json:"allowed"`
	Reason       string            `json:"reason"`
	Record       *repo.FeedRecord  `json:"record,omitempty"`
	Author       map[string]string `json:"author,omitempty"`
	LikeCount    int               `json:"like_count,omitempty"`
	Liked        bool              `json:"liked,omitempty"`
	Comments     []CommentItem     `json:"comments,omitempty"`
	CommentCount int               `json:"comment_count,omitempty"`
}

func (s *CommunityService) FeedContext(ctx context.Context, userID, recordID string) (*FeedContextResult, error) {
	return s.FeedTargetContext(ctx, userID, repo.FeedTargetFoodRecord, recordID)
}

func (s *CommunityService) FeedTargetContext(ctx context.Context, userID, targetType, targetID string) (*FeedContextResult, error) {
	targetType = normalizeServiceTargetType(targetType)
	record, err := s.feedRepo.GetFeedTargetByID(ctx, targetType, targetID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return &FeedContextResult{Allowed: false, Reason: "not_found"}, nil
	}

	ctxCheck, err := s.getFeedRecordInteractionContext(ctx, userID, record)
	if err != nil {
		return nil, err
	}
	if !ctxCheck.Allowed {
		return ctxCheck, nil
	}
	normalizedRecord := s.normalizeFeedRecord(ctx, *record)
	record = &normalizedRecord

	profiles, _ := s.feedRepo.GetUserProfiles(ctx, []string{record.UserID})
	profile := profiles[record.UserID]
	author := map[string]string{"id": record.UserID, "nickname": "用户", "avatar": ""}
	if profile != nil {
		author["nickname"] = profile.Nickname
		author["avatar"] = s.resolveAvatarURL(profile.Avatar)
	}

	targetKey := repo.FeedTargetKey(targetType, targetID)
	likesMap, _ := s.feedRepo.GetLikesForTargets(ctx, []repo.FeedTarget{{TargetType: targetType, TargetID: targetID}}, userID)
	likeInfo := likesMap[targetKey]
	if likeInfo == nil {
		likeInfo = &repo.LikeInfo{}
	}

	comments, _ := s.ListTargetComments(ctx, targetType, targetID, 5)
	countMap := s.getCommentCountsForTargets(ctx, []repo.FeedTarget{{TargetType: targetType, TargetID: targetID}})

	return &FeedContextResult{
		Allowed:      true,
		Reason:       ctxCheck.Reason,
		Record:       record,
		Author:       author,
		LikeCount:    likeInfo.Count,
		Liked:        likeInfo.Liked,
		Comments:     comments,
		CommentCount: countMap[targetKey],
	}, nil
}

func (s *CommunityService) getFeedRecordInteractionContext(ctx context.Context, userID string, record *repo.FeedRecord) (*FeedContextResult, error) {
	if record == nil {
		return &FeedContextResult{Allowed: false, Reason: "not_found"}, nil
	}
	if record.HiddenFromFeed {
		return &FeedContextResult{Allowed: false, Reason: "not_found"}, nil
	}
	if userID != "" && record.UserID == userID {
		return &FeedContextResult{Allowed: true, Reason: "owner"}, nil
	}
	owner, err := s.userRepo.FindByID(ctx, record.UserID)
	if err != nil {
		return nil, err
	}
	if owner != nil && (owner.PublicRecords == nil || *owner.PublicRecords) {
		return &FeedContextResult{Allowed: true, Reason: "public"}, nil
	}
	if userID != "" && record.UserID != "" {
		isFriend, err := s.feedRepo.IsFriend(ctx, userID, record.UserID)
		if err != nil {
			return nil, err
		}
		if isFriend {
			return &FeedContextResult{Allowed: true, Reason: "friend"}, nil
		}
	}
	return &FeedContextResult{Allowed: false, Reason: "forbidden"}, nil
}

func (s *CommunityService) PostComment(ctx context.Context, userID, recordID, content string, parentCommentID, replyToUserID *string) (*CommentItem, error) {
	return s.PostTargetComment(ctx, userID, repo.FeedTargetFoodRecord, recordID, content, parentCommentID, replyToUserID)
}

func (s *CommunityService) PostTargetComment(ctx context.Context, userID, targetType, targetID, content string, parentCommentID, replyToUserID *string) (*CommentItem, error) {
	targetType = normalizeServiceTargetType(targetType)
	if len(strings.TrimSpace(content)) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "评论内容不能为空", HTTPStatus: 400}
	}
	if len(strings.TrimSpace(content)) > 500 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "评论内容不能超过500字", HTTPStatus: 400}
	}

	record, err := s.feedRepo.GetFeedTargetByID(ctx, targetType, targetID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, commonerrors.ErrNotFound
	}
	ctxCheck, err := s.getFeedRecordInteractionContext(ctx, userID, record)
	if err != nil {
		return nil, err
	}
	if !ctxCheck.Allowed {
		if ctxCheck.Reason == "not_found" {
			return nil, commonerrors.ErrNotFound
		}
		return nil, commonerrors.ErrForbidden
	}

	normalizedContent := strings.TrimSpace(content)
	duplicate, err := s.feedRepo.FindRecentDuplicateForTarget(ctx, userID, targetType, targetID, normalizedContent, parentCommentID, replyToUserID, 8*time.Second)
	if err != nil {
		return nil, err
	}
	if duplicate != nil {
		return s.commentToItem(ctx, duplicate)
	}

	comment := &domain.FeedComment{
		UserID:          userID,
		RecordID:        legacyRecordID(targetType, targetID),
		TargetType:      targetType,
		TargetID:        targetID,
		Content:         normalizedContent,
		ParentCommentID: parentCommentID,
		ReplyToUserID:   replyToUserID,
	}
	if err := s.feedRepo.AddComment(ctx, comment); err != nil {
		return nil, err
	}

	// Notify record owner
	if record.UserID != "" && record.UserID != userID {
		notifType := "comment_received"
		if parentCommentID != nil {
			notifType = "reply_received"
		}
		duplicateNotif, _ := s.notifRepo.FindRecentDuplicateForTarget(ctx, record.UserID, notifType, &userID, targetType, &targetID, parentCommentID, &comment.ID, &normalizedContent)
		if duplicateNotif == nil {
			_ = s.notifRepo.CreateNotification(ctx, &domain.FeedInteractionNotification{
				RecipientUserID:  record.UserID,
				ActorUserID:      &userID,
				RecordID:         legacyRecordID(targetType, targetID),
				TargetType:       targetType,
				TargetID:         &targetID,
				CommentID:        &comment.ID,
				ParentCommentID:  parentCommentID,
				NotificationType: notifType,
				ContentPreview:   &normalizedContent,
			})
		}
	}

	// Notify reply target
	if replyToUserID != nil && *replyToUserID != "" && *replyToUserID != userID && *replyToUserID != record.UserID {
		notifType := "reply_received"
		duplicateNotif, _ := s.notifRepo.FindRecentDuplicateForTarget(ctx, *replyToUserID, notifType, &userID, targetType, &targetID, parentCommentID, &comment.ID, &normalizedContent)
		if duplicateNotif == nil {
			_ = s.notifRepo.CreateNotification(ctx, &domain.FeedInteractionNotification{
				RecipientUserID:  *replyToUserID,
				ActorUserID:      &userID,
				RecordID:         legacyRecordID(targetType, targetID),
				TargetType:       targetType,
				TargetID:         &targetID,
				CommentID:        &comment.ID,
				ParentCommentID:  parentCommentID,
				NotificationType: notifType,
				ContentPreview:   &normalizedContent,
			})
		}
	}

	return s.commentToItem(ctx, comment)
}

func (s *CommunityService) DeleteTargetComment(ctx context.Context, userID, targetType, targetID, commentID string) (int64, error) {
	targetType = normalizeServiceTargetType(targetType)
	record, err := s.feedRepo.GetFeedTargetByID(ctx, targetType, targetID)
	if err != nil {
		return 0, err
	}
	if record == nil {
		return 0, commonerrors.ErrNotFound
	}
	comment, err := s.feedRepo.GetCommentByID(ctx, commentID)
	if err != nil {
		return 0, err
	}
	if comment == nil || commentTargetKey(*comment) != repo.FeedTargetKey(targetType, targetID) {
		return 0, commonerrors.ErrNotFound
	}
	if comment.UserID != userID && record.UserID != userID {
		return 0, commonerrors.ErrForbidden
	}
	return s.feedRepo.DeleteCommentCascade(ctx, targetType, targetID, commentID)
}

func (s *CommunityService) commentToItem(ctx context.Context, comment *domain.FeedComment) (*CommentItem, error) {
	userIDs := make(map[string]bool)
	userIDs[comment.UserID] = true
	if comment.ReplyToUserID != nil {
		userIDs[*comment.ReplyToUserID] = true
	}
	ids := make([]string, 0, len(userIDs))
	for id := range userIDs {
		ids = append(ids, id)
	}
	profiles, _ := s.feedRepo.GetUserProfiles(ctx, ids)
	author := profiles[comment.UserID]
	var replyUser *repo.UserProfile
	if comment.ReplyToUserID != nil {
		replyUser = profiles[*comment.ReplyToUserID]
	}
	return &CommentItem{
		ID:              comment.ID,
		UserID:          comment.UserID,
		RecordID:        comment.RecordID,
		TargetType:      commentTargetType(*comment),
		TargetID:        commentTargetID(*comment),
		ParentCommentID: comment.ParentCommentID,
		ReplyToUserID:   comment.ReplyToUserID,
		ReplyToNickname: strOr(replyUser, ""),
		Content:         comment.Content,
		CreatedAt:       comment.CreatedAt,
		Nickname:        strOr(author, "用户"),
		Avatar:          s.resolveAvatarURL(strOrAvatar(author)),
	}, nil
}

func (s *CommunityService) ListCommentTasks(ctx context.Context, userID string, limit int) ([]domain.CommentTask, error) {
	return s.notifRepo.ListCommentTasksByUser(ctx, userID, "feed", limit)
}

const (
	circlePostImageBucketAlias = "food-images"
	circlePostMaxImages        = 3
	circlePostMaxContentLength = 2000
)

type CirclePostNutrition struct {
	TotalCalories *float64
	TotalProtein  *float64
	TotalCarbs    *float64
	TotalFat      *float64
}

func (s *CommunityService) CreateCirclePost(ctx context.Context, userID, content string, imageURLs []string, nutrition *CirclePostNutrition) (string, error) {
	content = strings.TrimSpace(content)
	imageKeys, err := s.normalizeCirclePostImageURLs(userID, imageURLs)
	if err != nil {
		return "", err
	}
	if content == "" && len(imageKeys) == 0 {
		return "", commonerrors.ErrBadRequest
	}
	if len(content) > circlePostMaxContentLength {
		return "", commonerrors.ErrBadRequest
	}
	post := &domain.UserCirclePost{
		ID:             uuid.New().String(),
		UserID:         userID,
		Content:        content,
		ImagePaths:     imageKeys,
		HiddenFromFeed: false,
		CreatedAt:      timePtr(time.Now().UTC()),
		UpdatedAt:      timePtr(time.Now().UTC()),
	}
	if nutrition != nil {
		post.TotalCalories = nutrition.TotalCalories
		post.TotalProtein = nutrition.TotalProtein
		post.TotalCarbs = nutrition.TotalCarbs
		post.TotalFat = nutrition.TotalFat
	}
	if err := s.feedRepo.CreateCirclePost(ctx, post); err != nil {
		return "", err
	}
	return post.ID, nil
}

func (s *CommunityService) UpdateCirclePost(ctx context.Context, userID, postID, content string, imageURLs []string, nutrition *CirclePostNutrition) error {
	content = strings.TrimSpace(content)
	post, err := s.feedRepo.GetCirclePostByID(ctx, postID)
	if err != nil {
		return err
	}
	if post == nil {
		return commonerrors.ErrNotFound
	}
	if post.UserID != userID {
		return commonerrors.ErrForbidden
	}
	imageKeys, err := s.normalizeCirclePostImageURLs(userID, imageURLs)
	if err != nil {
		return err
	}
	if content == "" && len(imageKeys) == 0 {
		return commonerrors.ErrBadRequest
	}
	if len(content) > circlePostMaxContentLength {
		return commonerrors.ErrBadRequest
	}
	var totalCalories, totalProtein, totalCarbs, totalFat *float64
	if nutrition != nil {
		totalCalories = nutrition.TotalCalories
		totalProtein = nutrition.TotalProtein
		totalCarbs = nutrition.TotalCarbs
		totalFat = nutrition.TotalFat
	}
	return s.feedRepo.UpdateCirclePost(ctx, userID, postID, content, imageKeys, totalCalories, totalProtein, totalCarbs, totalFat)
}

func (s *CommunityService) UploadCirclePostImage(ctx context.Context, userID string, fileBytes []byte, ext, contentType string) (string, error) {
	if userID == "" {
		return "", commonerrors.ErrUnauthorized
	}
	if len(fileBytes) == 0 {
		return "", commonerrors.ErrBadRequest
	}
	const maxBytes = 8 << 20
	if len(fileBytes) > maxBytes {
		return "", commonerrors.ErrBadRequest
	}
	safeExt := normalizeImageExt(ext)
	key := fmt.Sprintf("circle-posts/%s/%s%s", userID, uuid.NewString(), safeExt)
	if s.storage == nil {
		return "", fmt.Errorf("存储客户端未初始化")
	}
	url, err := s.storage.UploadBytes(circlePostImageBucketAlias, key, fileBytes, contentType)
	if err != nil {
		return "", err
	}
	return url, nil
}

func normalizeImageExt(ext string) string {
	safeExt := strings.ToLower(strings.TrimSpace(ext))
	if safeExt == "" {
		return ".jpg"
	}
	if !strings.HasPrefix(safeExt, ".") {
		safeExt = "." + safeExt
	}
	switch safeExt {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif":
		return safeExt
	default:
		return ".jpg"
	}
}

func (s *CommunityService) DeleteCirclePost(ctx context.Context, userID, postID string) error {
	post, err := s.feedRepo.GetCirclePostByID(ctx, postID)
	if err != nil {
		return err
	}
	if post == nil {
		return commonerrors.ErrNotFound
	}
	if post.UserID != userID {
		return commonerrors.ErrForbidden
	}
	if err := s.feedRepo.DeleteCirclePostInteractions(ctx, postID); err != nil {
		return err
	}
	return s.feedRepo.DeleteCirclePost(ctx, userID, postID)
}

func (s *CommunityService) normalizeCirclePostImageURLs(userID string, imageURLs []string) ([]string, error) {
	if len(imageURLs) > circlePostMaxImages {
		imageURLs = imageURLs[:circlePostMaxImages]
	}
	prefix := fmt.Sprintf("circle-posts/%s/", userID)
	out := make([]string, 0, len(imageURLs))
	seen := make(map[string]struct{}, len(imageURLs))
	for _, raw := range imageURLs {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		var key string
		if s.storage != nil {
			key = s.storage.ResolveObjectKey(circlePostImageBucketAlias, raw)
		}
		if key == "" {
			key = raw
		}
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out, nil
}

func timePtr(t time.Time) *time.Time {
	return &t
}

func (s *CommunityService) ListNotifications(ctx context.Context, userID string, limit int) (*NotificationListResult, error) {
	notifications, err := s.notifRepo.ListNotifications(ctx, userID, limit)
	if err != nil {
		return nil, err
	}
	unread, err := s.notifRepo.CountUnread(ctx, userID)
	if err != nil {
		return nil, err
	}

	actorIDs := make(map[string]bool)
	for _, n := range notifications {
		if n.ActorUserID != nil {
			actorIDs[*n.ActorUserID] = true
		}
	}
	ids := make([]string, 0, len(actorIDs))
	for id := range actorIDs {
		ids = append(ids, id)
	}
	profiles, _ := s.feedRepo.GetUserProfiles(ctx, ids)

	items := make([]NotificationItem, 0, len(notifications))
	for _, n := range notifications {
		var actor *repo.UserProfile
		if n.ActorUserID != nil {
			actor = profiles[*n.ActorUserID]
		}
		nickname := "系统"
		avatar := ""
		actorID := ""
		if actor != nil {
			actorID = actor.ID
			if actor.Nickname != "" {
				nickname = actor.Nickname
			}
			avatar = s.resolveAvatarURL(actor.Avatar)
		}
		items = append(items, NotificationItem{
			ID:               n.ID,
			NotificationType: n.NotificationType,
			RecordID:         n.RecordID,
			TargetType:       notificationTargetType(n),
			TargetID:         notificationTargetID(n),
			CommentID:        n.CommentID,
			ParentCommentID:  n.ParentCommentID,
			ContentPreview:   strOrStringPtr(n.ContentPreview),
			IsRead:           n.IsRead,
			CreatedAt:        n.CreatedAt,
			Actor: map[string]string{
				"id":       actorID,
				"nickname": nickname,
				"avatar":   avatar,
			},
		})
	}

	return &NotificationListResult{
		List:        items,
		UnreadCount: unread,
	}, nil
}

func strOrStringPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (s *CommunityService) MarkNotificationsRead(ctx context.Context, userID string, notificationIDs []string) (*MarkReadResult, error) {
	updated, err := s.notifRepo.MarkRead(ctx, userID, notificationIDs)
	if err != nil {
		return nil, err
	}
	unread, err := s.notifRepo.CountUnread(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &MarkReadResult{
		Updated:     updated,
		UnreadCount: unread,
	}, nil
}

func scoreFeedRecord(record *repo.FeedRecord, sortBy string, likeCount, commentCount int, mealType, dietGoal string, priorityAuthorIDs []string) float64 {
	balanceScore := 0.0
	if record.FeedType != repo.FeedTargetExerciseLog {
		balanceScore = computeMacroBalanceScore(record.TotalProtein, record.TotalCarbs, record.TotalFat) / 100.0
	}
	hotScore := computeFeedHotScore(likeCount, commentCount)
	freshScore := computeFreshnessScore(record.RecordTime)
	mealMatch := 0.0
	if mealType != "" && record.MealType == mealType {
		mealMatch = 1.0
	}
	goalMatch := 0.0
	if dietGoal != "" && record.DietGoal != nil && *record.DietGoal == dietGoal {
		goalMatch = 1.0
	}
	priorityMatch := 0.0
	if len(priorityAuthorIDs) > 0 {
		for _, pid := range priorityAuthorIDs {
			if pid == record.UserID {
				priorityMatch = 1.0
				break
			}
		}
	}

	if sortBy == "hot" {
		return hotScore*100.0 + freshScore*10.0 + balanceScore*8.0
	}
	if sortBy == "balanced" {
		if record.FeedType == repo.FeedTargetExerciseLog {
			return hotScore*12.0 + freshScore*6.0
		}
		return balanceScore*100.0 + hotScore*12.0 + freshScore*6.0
	}
	return priorityMatch*120.0 +
		mealMatch*45.0 +
		goalMatch*36.0 +
		balanceScore*20.0 +
		hotScore*18.0 +
		freshScore*12.0
}

func (s *CommunityService) buildRecommendReason(record *repo.FeedRecord, sortBy, mealType, dietGoal string, priorityAuthorIDs []string, likeCount, commentCount int) string {
	if record.FeedType == repo.FeedTargetExerciseLog {
		if sortBy == "hot" && (likeCount > 0 || commentCount > 0) {
			return "圈子高热度"
		}
		return "运动打卡"
	}
	if len(priorityAuthorIDs) > 0 {
		for _, pid := range priorityAuthorIDs {
			if pid == record.UserID {
				return "特别关注的人"
			}
		}
	}
	if mealType != "" && record.MealType == mealType {
		return "餐次匹配"
	}
	if dietGoal != "" && record.DietGoal != nil && *record.DietGoal == dietGoal {
		return "同目标饮食"
	}
	if sortBy == "hot" && (likeCount > 0 || commentCount > 0) {
		return "圈子高热度"
	}
	if sortBy == "balanced" {
		return "营养更均衡"
	}
	if computeMacroBalanceScore(record.TotalProtein, record.TotalCarbs, record.TotalFat) >= 72 {
		return "营养较均衡"
	}
	if likeCount >= 3 {
		return "点赞较高"
	}
	return "为你推荐"
}

func computeMacroBalanceScore(totalProtein, totalCarbs, totalFat float64) float64 {
	protein := math.Max(totalProtein, 0.0)
	carbs := math.Max(totalCarbs, 0.0)
	fat := math.Max(totalFat, 0.0)

	proteinKcal := protein * 4.0
	carbsKcal := carbs * 4.0
	fatKcal := fat * 9.0
	totalKcal := proteinKcal + carbsKcal + fatKcal
	if totalKcal <= 0 {
		return 0.0
	}

	proteinRatio := proteinKcal / totalKcal
	carbsRatio := carbsKcal / totalKcal
	fatRatio := fatKcal / totalKcal
	penalty := math.Abs(proteinRatio-0.30) + math.Abs(carbsRatio-0.40) + math.Abs(fatRatio-0.30)
	score := math.Max(0.0, 1.0-penalty/0.9)
	return math.Round(score*100.0*100.0) / 100.0
}

func computeFeedHotScore(likeCount, commentCount int) float64 {
	raw := float64(max(likeCount, 0)*2 + max(commentCount, 0)*3)
	return math.Min(raw/30.0, 1.0)
}

func computeFreshnessScore(recordTime *time.Time) float64 {
	if recordTime == nil {
		return 0.0
	}
	windowHours := 72.0
	deltaHours := math.Max(time.Since(*recordTime).Hours(), 0.0)
	return math.Max(0.0, 1.0-math.Min(deltaHours, windowHours)/windowHours)
}

func recordTimeStamp(t *time.Time) float64 {
	if t == nil {
		return 0
	}
	return float64(t.Unix())
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func normalizeServiceTargetType(value string) string {
	value = strings.TrimSpace(value)
	if value == repo.FeedTargetExerciseLog {
		return repo.FeedTargetExerciseLog
	}
	return repo.FeedTargetFoodRecord
}

func legacyRecordID(targetType, targetID string) *string {
	if normalizeServiceTargetType(targetType) != repo.FeedTargetFoodRecord {
		return nil
	}
	return &targetID
}

func feedTargetOfRecord(record repo.FeedRecord) (string, string) {
	targetType := normalizeServiceTargetType(record.FeedType)
	return targetType, record.ID
}

func feedTargetKeyOfRecord(record repo.FeedRecord) string {
	targetType, targetID := feedTargetOfRecord(record)
	return repo.FeedTargetKey(targetType, targetID)
}

func feedTargetsFromRecords(records []repo.FeedRecord) []repo.FeedTarget {
	targets := make([]repo.FeedTarget, 0, len(records))
	for _, record := range records {
		targetType, targetID := feedTargetOfRecord(record)
		targets = append(targets, repo.FeedTarget{TargetType: targetType, TargetID: targetID})
	}
	return targets
}

func commentTargetType(comment domain.FeedComment) string {
	if strings.TrimSpace(comment.TargetType) != "" {
		return normalizeServiceTargetType(comment.TargetType)
	}
	return repo.FeedTargetFoodRecord
}

func commentTargetID(comment domain.FeedComment) string {
	if strings.TrimSpace(comment.TargetID) != "" {
		return comment.TargetID
	}
	if comment.RecordID != nil {
		return *comment.RecordID
	}
	return ""
}

func commentTargetKey(comment domain.FeedComment) string {
	return repo.FeedTargetKey(commentTargetType(comment), commentTargetID(comment))
}

func notificationTargetType(notification domain.FeedInteractionNotification) string {
	if strings.TrimSpace(notification.TargetType) != "" {
		return normalizeServiceTargetType(notification.TargetType)
	}
	return repo.FeedTargetFoodRecord
}

func notificationTargetID(notification domain.FeedInteractionNotification) string {
	if notification.TargetID != nil && strings.TrimSpace(*notification.TargetID) != "" {
		return *notification.TargetID
	}
	if notification.RecordID != nil {
		return *notification.RecordID
	}
	return ""
}
