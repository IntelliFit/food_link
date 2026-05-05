package service

import (
	"context"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/community/domain"
	"food_link/backend/internal/community/repo"
)

var chinaTZ = time.FixedZone("Asia/Shanghai", 8*60*60)

type FeedRepo interface {
	ListPublicFeed(ctx context.Context, mealType, dietGoal string, limit int) ([]repo.FeedRecord, error)
	ListFriendFeed(ctx context.Context, authorIDs []string, mealType, dietGoal string, limit int) ([]repo.FeedRecord, error)
	GetFeedRecordByID(ctx context.Context, recordID string) (*repo.FeedRecord, error)
	HideFeedRecord(ctx context.Context, userID, recordID string) error
	AddLike(ctx context.Context, userID, recordID string) error
	RemoveLike(ctx context.Context, userID, recordID string) error
	GetLikesForRecords(ctx context.Context, recordIDs []string, currentUserID string) (map[string]*repo.LikeInfo, error)
	AddComment(ctx context.Context, comment *domain.FeedComment) error
	ListComments(ctx context.Context, recordID string, limit int) ([]domain.FeedComment, error)
	ListCommentsByRecordIDs(ctx context.Context, recordIDs []string) ([]domain.FeedComment, error)
	GetCommentByID(ctx context.Context, commentID string) (*domain.FeedComment, error)
	FindRecentDuplicate(ctx context.Context, userID, recordID, content string, parentCommentID, replyToUserID *string, window time.Duration) (*domain.FeedComment, error)
	GetFriendIDs(ctx context.Context, userID string) ([]string, error)
	IsFriend(ctx context.Context, userID, friendID string) (bool, error)
	GetUserProfiles(ctx context.Context, userIDs []string) (map[string]*repo.UserProfile, error)
	GetCheckinCounts(ctx context.Context, userIDs []string, weekStart, weekEnd time.Time) (map[string]int, error)
}

type NotificationRepo interface {
	CreateNotification(ctx context.Context, n *domain.FeedInteractionNotification) error
	FindRecentDuplicate(ctx context.Context, recipientUserID, notificationType string, actorUserID, recordID, parentCommentID, commentID, contentPreview *string) (*domain.FeedInteractionNotification, error)
	ListNotifications(ctx context.Context, userID string, limit int) ([]domain.FeedInteractionNotification, error)
	CountUnread(ctx context.Context, userID string) (int64, error)
	MarkRead(ctx context.Context, userID string, notificationIDs []string) (int64, error)
	ListCommentTasksByUser(ctx context.Context, userID, commentType string, limit int) ([]domain.CommentTask, error)
}

type CommunityService struct {
	feedRepo  FeedRepo
	notifRepo NotificationRepo
	userRepo  UserFinder
}

type UserFinder interface {
	FindByID(ctx context.Context, userID string) (*authrepo.User, error)
}

func NewCommunityService(feedRepo FeedRepo, notifRepo NotificationRepo, userRepo UserFinder) *CommunityService {
	return &CommunityService{
		feedRepo:  feedRepo,
		notifRepo: notifRepo,
		userRepo:  userRepo,
	}
}

type FeedParams struct {
	Offset            int
	Limit             int
	IncludeComments   bool
	CommentsLimit     int
	MealType          string
	DietGoal          string
	SortBy            string
	PriorityAuthorIDs []string
	AuthorScope       string
	AuthorID          string
}

type FeedItem struct {
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
	RecordID        string     `json:"record_id"`
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
	customRank := params.SortBy == "recommended" || params.SortBy == "hot" || params.SortBy == "balanced"
	candidateLimit := params.Limit
	if customRank {
		candidateLimit = max(max(params.Offset+params.Limit+40, params.Limit*3), 60)
	}

	records, err := s.feedRepo.ListPublicFeed(ctx, params.MealType, params.DietGoal, candidateLimit)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}

	recordIDs := make([]string, len(records))
	for i, r := range records {
		recordIDs[i] = r.ID
	}

	likesMap, err := s.feedRepo.GetLikesForRecords(ctx, recordIDs, "")
	if err != nil {
		return nil, err
	}

	var commentCountMap map[string]int
	if customRank {
		commentCountMap = s.getCommentCounts(ctx, recordIDs)
	}

	if customRank {
		records = s.sortAndSlice(records, params, likesMap, commentCountMap, nil)
	} else {
		records = sliceRecords(records, params.Offset, params.Limit)
	}

	if len(records) == 0 {
		return nil, nil
	}

	recordIDs = make([]string, len(records))
	for i, r := range records {
		recordIDs[i] = r.ID
	}
	likesMap, _ = s.feedRepo.GetLikesForRecords(ctx, recordIDs, "")

	var commentsMap map[string][]CommentItem
	if params.IncludeComments {
		commentsMap = s.getCommentsMap(ctx, recordIDs, params.CommentsLimit)
	}
	if commentCountMap == nil {
		commentCountMap = s.getCommentCounts(ctx, recordIDs)
	}

	userIDs := make([]string, 0, len(records))
	for _, r := range records {
		userIDs = append(userIDs, r.UserID)
	}
	profiles, _ := s.feedRepo.GetUserProfiles(ctx, userIDs)

	items := make([]FeedItem, 0, len(records))
	for _, rec := range records {
		profile := profiles[rec.UserID]
		author := map[string]string{"id": rec.UserID, "nickname": "用户", "avatar": ""}
		if profile != nil {
			author["nickname"] = profile.Nickname
			author["avatar"] = profile.Avatar
		}
		likeInfo := likesMap[rec.ID]
		if likeInfo == nil {
			likeInfo = &repo.LikeInfo{}
		}
		item := FeedItem{
			Record:          rec,
			Author:          author,
			LikeCount:       likeInfo.Count,
			Liked:           false,
			IsMine:          false,
			RecommendReason: s.buildRecommendReason(&rec, params.SortBy, params.MealType, params.DietGoal, nil, likeInfo.Count, commentCountMap[rec.ID]),
			CommentCount:    commentCountMap[rec.ID],
		}
		if params.IncludeComments {
			item.Comments = commentsMap[rec.ID]
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *CommunityService) FriendFeed(ctx context.Context, userID string, params FeedParams) ([]FeedItem, error) {
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
	candidateLimit := params.Limit
	if customRank {
		candidateLimit = max(max(params.Offset+params.Limit+40, params.Limit*3), 60)
	}

	records, err := s.feedRepo.ListFriendFeed(ctx, authorIDs, params.MealType, params.DietGoal, candidateLimit)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}

	recordIDs := make([]string, len(records))
	for i, r := range records {
		recordIDs[i] = r.ID
	}

	likesMap, err := s.feedRepo.GetLikesForRecords(ctx, recordIDs, userID)
	if err != nil {
		return nil, err
	}

	var commentCountMap map[string]int
	if customRank {
		commentCountMap = s.getCommentCounts(ctx, recordIDs)
	}

	if customRank {
		records = s.sortAndSlice(records, params, likesMap, commentCountMap, nil)
	} else {
		records = sliceRecords(records, params.Offset, params.Limit)
	}

	if len(records) == 0 {
		return nil, nil
	}

	recordIDs = make([]string, len(records))
	for i, r := range records {
		recordIDs[i] = r.ID
	}
	likesMap, _ = s.feedRepo.GetLikesForRecords(ctx, recordIDs, userID)

	var commentsMap map[string][]CommentItem
	if params.IncludeComments {
		commentsMap = s.getCommentsMap(ctx, recordIDs, params.CommentsLimit)
	}
	if commentCountMap == nil {
		commentCountMap = s.getCommentCounts(ctx, recordIDs)
	}

	userIDs := make([]string, 0, len(records))
	for _, r := range records {
		userIDs = append(userIDs, r.UserID)
	}
	profiles, _ := s.feedRepo.GetUserProfiles(ctx, userIDs)

	items := make([]FeedItem, 0, len(records))
	for _, rec := range records {
		profile := profiles[rec.UserID]
		author := map[string]string{"id": rec.UserID, "nickname": "用户", "avatar": ""}
		if profile != nil {
			author["nickname"] = profile.Nickname
			author["avatar"] = profile.Avatar
		}
		likeInfo := likesMap[rec.ID]
		if likeInfo == nil {
			likeInfo = &repo.LikeInfo{}
		}
		item := FeedItem{
			Record:          rec,
			Author:          author,
			LikeCount:       likeInfo.Count,
			Liked:           likeInfo.Liked,
			IsMine:          rec.UserID == userID,
			RecommendReason: s.buildRecommendReason(&rec, params.SortBy, params.MealType, params.DietGoal, params.PriorityAuthorIDs, likeInfo.Count, commentCountMap[rec.ID]),
			CommentCount:    commentCountMap[rec.ID],
		}
		if params.IncludeComments {
			item.Comments = commentsMap[rec.ID]
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
		if likesMap[records[i].ID] != nil {
			li = likesMap[records[i].ID].Count
		}
		lj := 0
		if likesMap[records[j].ID] != nil {
			lj = likesMap[records[j].ID].Count
		}
		si := scoreFeedRecord(&records[i], params.SortBy, li, commentCountMap[records[i].ID], params.MealType, params.DietGoal, priorityAuthorIDs)
		sj := scoreFeedRecord(&records[j], params.SortBy, lj, commentCountMap[records[j].ID], params.MealType, params.DietGoal, priorityAuthorIDs)
		if si != sj {
			return si > sj
		}
		return ti > tj
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
	if len(recordIDs) == 0 {
		return map[string]int{}
	}
	comments, err := s.feedRepo.ListCommentsByRecordIDs(ctx, recordIDs)
	if err != nil {
		return map[string]int{}
	}
	counts := make(map[string]int)
	for _, c := range comments {
		counts[c.RecordID]++
	}
	return counts
}

func (s *CommunityService) getCommentsMap(ctx context.Context, recordIDs []string, commentsLimit int) map[string][]CommentItem {
	if len(recordIDs) == 0 {
		return map[string][]CommentItem{}
	}
	comments, err := s.feedRepo.ListCommentsByRecordIDs(ctx, recordIDs)
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
		recordComments[c.RecordID] = append(recordComments[c.RecordID], c)
	}

	result := make(map[string][]CommentItem)
	for rid, list := range recordComments {
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
				ParentCommentID: c.ParentCommentID,
				ReplyToUserID:   c.ReplyToUserID,
				ReplyToNickname: strOr(replyUser, ""),
				Content:         c.Content,
				CreatedAt:       c.CreatedAt,
				Nickname:        strOr(author, "用户"),
				Avatar:          strOrAvatar(author),
			})
		}
		result[rid] = items
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

// leaderboard cache
type leaderboardCacheEntry struct {
	result    *LeaderboardResult
	expiresAt time.Time
}

var leaderboardCache sync.Map

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

	nowCN := time.Now().In(chinaTZ)
	weekday := nowCN.Weekday()
	if weekday == 0 {
		weekday = 7
	}
	weekStartCN := nowCN.AddDate(0, 0, -int(weekday-1)).Truncate(24 * time.Hour)
	weekEndCN := weekStartCN.AddDate(0, 0, 7)
	weekStartStr := weekStartCN.Format("2006-01-02")
	weekEndStr := weekStartCN.AddDate(0, 0, 6).Format("2006-01-02")

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
			avatar = p.Avatar
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
	record, err := s.feedRepo.GetFeedRecordByID(ctx, recordID)
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

	if err := s.feedRepo.AddLike(ctx, userID, recordID); err != nil {
		return "", err
	}

	// Create notification for record owner
	if record.UserID != "" && record.UserID != userID {
		duplicate, _ := s.notifRepo.FindRecentDuplicate(ctx, record.UserID, "like_received", &userID, &recordID, nil, nil, nil)
		if duplicate == nil {
			_ = s.notifRepo.CreateNotification(ctx, &domain.FeedInteractionNotification{
				RecipientUserID:  record.UserID,
				ActorUserID:      &userID,
				RecordID:         &recordID,
				NotificationType: "like_received",
			})
		}
	}
	return "已点赞", nil
}

func (s *CommunityService) UnlikeFeed(ctx context.Context, userID, recordID string) (string, error) {
	if err := s.feedRepo.RemoveLike(ctx, userID, recordID); err != nil {
		return "", err
	}
	return "已取消", nil
}

func (s *CommunityService) HideFeed(ctx context.Context, userID, recordID string) error {
	record, err := s.feedRepo.GetFeedRecordByID(ctx, recordID)
	if err != nil {
		return err
	}
	if record == nil {
		return commonerrors.ErrNotFound
	}
	if record.UserID != userID {
		return commonerrors.ErrForbidden
	}
	return s.feedRepo.HideFeedRecord(ctx, userID, recordID)
}

func (s *CommunityService) ListComments(ctx context.Context, recordID string, limit int) ([]CommentItem, error) {
	comments, err := s.feedRepo.ListComments(ctx, recordID, limit)
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
			ParentCommentID: c.ParentCommentID,
			ReplyToUserID:   c.ReplyToUserID,
			ReplyToNickname: strOr(replyUser, ""),
			Content:         c.Content,
			CreatedAt:       c.CreatedAt,
			Nickname:        strOr(author, "用户"),
			Avatar:          strOrAvatar(author),
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
	record, err := s.feedRepo.GetFeedRecordByID(ctx, recordID)
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

	profiles, _ := s.feedRepo.GetUserProfiles(ctx, []string{record.UserID})
	profile := profiles[record.UserID]
	author := map[string]string{"id": record.UserID, "nickname": "用户", "avatar": ""}
	if profile != nil {
		author["nickname"] = profile.Nickname
		author["avatar"] = profile.Avatar
	}

	likesMap, _ := s.feedRepo.GetLikesForRecords(ctx, []string{recordID}, userID)
	likeInfo := likesMap[recordID]
	if likeInfo == nil {
		likeInfo = &repo.LikeInfo{}
	}

	comments, _ := s.ListComments(ctx, recordID, 5)
	countMap := s.getCommentCounts(ctx, []string{recordID})

	return &FeedContextResult{
		Allowed:      true,
		Reason:       ctxCheck.Reason,
		Record:       record,
		Author:       author,
		LikeCount:    likeInfo.Count,
		Liked:        likeInfo.Liked,
		Comments:     comments,
		CommentCount: countMap[recordID],
	}, nil
}

func (s *CommunityService) getFeedRecordInteractionContext(ctx context.Context, userID string, record *repo.FeedRecord) (*FeedContextResult, error) {
	if record == nil {
		return &FeedContextResult{Allowed: false, Reason: "not_found"}, nil
	}
	if userID != "" && record.UserID == userID {
		return &FeedContextResult{Allowed: true, Reason: "owner"}, nil
	}
	owner, err := s.userRepo.FindByID(ctx, record.UserID)
	if err != nil {
		return nil, err
	}
	if owner != nil && owner.PublicRecords != nil && *owner.PublicRecords {
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
	if len(strings.TrimSpace(content)) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "评论内容不能为空", HTTPStatus: 400}
	}
	if len(strings.TrimSpace(content)) > 500 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "评论内容不能超过500字", HTTPStatus: 400}
	}

	record, err := s.feedRepo.GetFeedRecordByID(ctx, recordID)
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
	duplicate, err := s.feedRepo.FindRecentDuplicate(ctx, userID, recordID, normalizedContent, parentCommentID, replyToUserID, 8*time.Second)
	if err != nil {
		return nil, err
	}
	if duplicate != nil {
		return s.commentToItem(ctx, duplicate)
	}

	comment := &domain.FeedComment{
		UserID:          userID,
		RecordID:        recordID,
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
		duplicateNotif, _ := s.notifRepo.FindRecentDuplicate(ctx, record.UserID, notifType, &userID, &recordID, parentCommentID, &comment.ID, &normalizedContent)
		if duplicateNotif == nil {
			_ = s.notifRepo.CreateNotification(ctx, &domain.FeedInteractionNotification{
				RecipientUserID:  record.UserID,
				ActorUserID:      &userID,
				RecordID:         &recordID,
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
		duplicateNotif, _ := s.notifRepo.FindRecentDuplicate(ctx, *replyToUserID, notifType, &userID, &recordID, parentCommentID, &comment.ID, &normalizedContent)
		if duplicateNotif == nil {
			_ = s.notifRepo.CreateNotification(ctx, &domain.FeedInteractionNotification{
				RecipientUserID:  *replyToUserID,
				ActorUserID:      &userID,
				RecordID:         &recordID,
				CommentID:        &comment.ID,
				ParentCommentID:  parentCommentID,
				NotificationType: notifType,
				ContentPreview:   &normalizedContent,
			})
		}
	}

	return s.commentToItem(ctx, comment)
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
		ParentCommentID: comment.ParentCommentID,
		ReplyToUserID:   comment.ReplyToUserID,
		ReplyToNickname: strOr(replyUser, ""),
		Content:         comment.Content,
		CreatedAt:       comment.CreatedAt,
		Nickname:        strOr(author, "用户"),
		Avatar:          strOrAvatar(author),
	}, nil
}

func (s *CommunityService) ListCommentTasks(ctx context.Context, userID string, limit int) ([]domain.CommentTask, error) {
	return s.notifRepo.ListCommentTasksByUser(ctx, userID, "feed", limit)
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
			avatar = actor.Avatar
		}
		items = append(items, NotificationItem{
			ID:               n.ID,
			NotificationType: n.NotificationType,
			RecordID:         n.RecordID,
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
	balanceScore := computeMacroBalanceScore(record.TotalProtein, record.TotalCarbs, record.TotalFat) / 100.0
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
