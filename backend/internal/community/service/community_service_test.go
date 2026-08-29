package service

import (
	"context"
	"sync"
	"testing"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/community/domain"
	"food_link/backend/internal/community/repo"

	"github.com/stretchr/testify/assert"
)

type mockFeedRepo struct {
	listPublicFeed             []repo.FeedRecord
	listPublicFeedErr          error
	listPublicFeedLimit        int
	listPublicFeedCalled       bool
	listPublicFeedContentType  string
	listPublicFeedAuthorIDs    []string
	listFriendFeed             []repo.FeedRecord
	listFriendFeedErr          error
	listFriendFeedLimit        int
	listFriendFeedCalled       bool
	getFeedRecord              *repo.FeedRecord
	getFeedRecordErr           error
	hideFeedErr                error
	addLikeErr                 error
	removeLikeErr              error
	likesMap                   map[string]*repo.LikeInfo
	likesMapErr                error
	addCommentErr              error
	listComments               []domain.FeedComment
	listCommentsErr            error
	listCommentsByRecordIDs    []domain.FeedComment
	listCommentsByRecordIDsErr error
	getComment                 *domain.FeedComment
	getCommentErr              error
	findDuplicate              *domain.FeedComment
	findDuplicateErr           error
	friendIDs                  []string
	friendIDsErr               error
	isFriend                   bool
	isFriendErr                error
	profiles                   map[string]*repo.UserProfile
	profilesErr                error
	checkinCounts              map[string]int
	checkinCountsErr           error
	nutrientFoods              []repo.NutrientFoodRow
	nutrientFoodsErr           error
	createdFeedReport          *domain.FeedReport
	existingFeedReport         *domain.FeedReport
}

func (m *mockFeedRepo) ListPublicFeed(ctx context.Context, authorIDs []string, contentType, mealType, dietGoal, date, sortBy string, limit int, cursor *repo.FeedCursor) ([]repo.FeedRecord, error) {
	m.listPublicFeedLimit = limit
	m.listPublicFeedCalled = true
	m.listPublicFeedContentType = contentType
	m.listPublicFeedAuthorIDs = authorIDs
	return m.listPublicFeed, m.listPublicFeedErr
}
func (m *mockFeedRepo) ListFriendFeed(ctx context.Context, authorIDs []string, contentType, mealType, dietGoal, date, sortBy string, limit int, cursor *repo.FeedCursor) ([]repo.FeedRecord, error) {
	m.listFriendFeedLimit = limit
	m.listFriendFeedCalled = true
	return m.listFriendFeed, m.listFriendFeedErr
}
func (m *mockFeedRepo) GetFeedRecordByID(ctx context.Context, recordID string) (*repo.FeedRecord, error) {
	return m.getFeedRecord, m.getFeedRecordErr
}
func (m *mockFeedRepo) GetFeedTargetByID(ctx context.Context, targetType, targetID string) (*repo.FeedRecord, error) {
	return m.getFeedRecord, m.getFeedRecordErr
}
func (m *mockFeedRepo) HideFeedRecord(ctx context.Context, userID, recordID string) error {
	return m.hideFeedErr
}
func (m *mockFeedRepo) HideFeedTarget(ctx context.Context, userID, targetType, targetID string) error {
	return m.hideFeedErr
}
func (m *mockFeedRepo) AddLike(ctx context.Context, userID, recordID string) error {
	return m.addLikeErr
}
func (m *mockFeedRepo) AddLikeTarget(ctx context.Context, userID, targetType, targetID string) error {
	return m.addLikeErr
}
func (m *mockFeedRepo) RemoveLike(ctx context.Context, userID, recordID string) error {
	return m.removeLikeErr
}
func (m *mockFeedRepo) RemoveLikeTarget(ctx context.Context, userID, targetType, targetID string) error {
	return m.removeLikeErr
}
func (m *mockFeedRepo) GetLikesForRecords(ctx context.Context, recordIDs []string, currentUserID string) (map[string]*repo.LikeInfo, error) {
	return m.likesMap, m.likesMapErr
}
func (m *mockFeedRepo) GetLikesForTargets(ctx context.Context, targets []repo.FeedTarget, currentUserID string) (map[string]*repo.LikeInfo, error) {
	if m.likesMap == nil {
		return m.likesMap, m.likesMapErr
	}
	result := make(map[string]*repo.LikeInfo, len(targets))
	for _, target := range targets {
		key := repo.FeedTargetKey(target.TargetType, target.TargetID)
		if info := m.likesMap[key]; info != nil {
			result[key] = info
			continue
		}
		result[key] = m.likesMap[target.TargetID]
	}
	if len(result) > 0 {
		return result, m.likesMapErr
	}
	return m.likesMap, m.likesMapErr
}
func (m *mockFeedRepo) AddComment(ctx context.Context, comment *domain.FeedComment) error {
	return m.addCommentErr
}
func (m *mockFeedRepo) ListComments(ctx context.Context, recordID string, limit int) ([]domain.FeedComment, error) {
	return m.listComments, m.listCommentsErr
}
func (m *mockFeedRepo) ListCommentsForTarget(ctx context.Context, targetType, targetID string, limit int) ([]domain.FeedComment, error) {
	return m.listComments, m.listCommentsErr
}
func (m *mockFeedRepo) ListCommentsByRecordIDs(ctx context.Context, recordIDs []string) ([]domain.FeedComment, error) {
	return m.listCommentsByRecordIDs, m.listCommentsByRecordIDsErr
}
func (m *mockFeedRepo) ListCommentsByTargets(ctx context.Context, targets []repo.FeedTarget) ([]domain.FeedComment, error) {
	return m.listCommentsByRecordIDs, m.listCommentsByRecordIDsErr
}
func (m *mockFeedRepo) ListCommentPreviewsByTargets(ctx context.Context, targets []repo.FeedTarget, perTargetLimit int, excludedUserIDs []string) ([]domain.FeedComment, map[string]int, error) {
	counts := make(map[string]int)
	for _, comment := range m.listCommentsByRecordIDs {
		targetType := comment.TargetType
		targetID := comment.TargetID
		if targetID == "" && comment.RecordID != nil {
			targetType = repo.FeedTargetFoodRecord
			targetID = *comment.RecordID
		}
		counts[repo.FeedTargetKey(targetType, targetID)]++
	}
	return m.listCommentsByRecordIDs, counts, m.listCommentsByRecordIDsErr
}
func (m *mockFeedRepo) GetCommentByID(ctx context.Context, commentID string) (*domain.FeedComment, error) {
	return m.getComment, m.getCommentErr
}
func (m *mockFeedRepo) FindRecentDuplicate(ctx context.Context, userID, recordID, content string, parentCommentID, replyToUserID *string, window time.Duration) (*domain.FeedComment, error) {
	return m.findDuplicate, m.findDuplicateErr
}
func (m *mockFeedRepo) FindRecentDuplicateForTarget(ctx context.Context, userID, targetType, targetID, content string, parentCommentID, replyToUserID *string, window time.Duration) (*domain.FeedComment, error) {
	return m.findDuplicate, m.findDuplicateErr
}
func (m *mockFeedRepo) DeleteCommentCascade(ctx context.Context, targetType, targetID, commentID string) (int64, error) {
	return 1, nil
}
func (m *mockFeedRepo) GetFriendIDs(ctx context.Context, userID string) ([]string, error) {
	return m.friendIDs, m.friendIDsErr
}
func (m *mockFeedRepo) IsFriend(ctx context.Context, userID, friendID string) (bool, error) {
	return m.isFriend, m.isFriendErr
}
func (m *mockFeedRepo) GetUserProfiles(ctx context.Context, userIDs []string) (map[string]*repo.UserProfile, error) {
	return m.profiles, m.profilesErr
}
func (m *mockFeedRepo) GetWeeklyCheckinCounts(ctx context.Context, weekStart, weekEnd time.Time) (map[string]int, error) {
	return m.checkinCounts, m.checkinCountsErr
}
func (m *mockFeedRepo) GetFoodNutrientRanking(ctx context.Context, nutrient string, limit int) ([]repo.NutrientFoodRow, error) {
	return m.nutrientFoods, m.nutrientFoodsErr
}
func (m *mockFeedRepo) CreateCirclePost(ctx context.Context, post *domain.UserCirclePost) error {
	return nil
}
func (m *mockFeedRepo) GetCirclePostByID(ctx context.Context, postID string) (*domain.UserCirclePost, error) {
	return nil, nil
}
func (m *mockFeedRepo) UpdateCirclePost(ctx context.Context, userID, postID, title, body string, imagePaths []string, nutrition *domain.CirclePostNutrition) error {
	return nil
}
func (m *mockFeedRepo) DeleteCirclePost(ctx context.Context, userID, postID string) error {
	return nil
}
func (m *mockFeedRepo) DeleteCirclePostInteractions(ctx context.Context, postID string) error {
	return nil
}
func (m *mockFeedRepo) CreateFeedReport(ctx context.Context, report *domain.FeedReport) error {
	m.createdFeedReport = report
	return nil
}
func (m *mockFeedRepo) FindFeedReport(ctx context.Context, reporterUserID, targetType, targetID string) (*domain.FeedReport, error) {
	return m.existingFeedReport, nil
}

type mockNotificationRepo struct {
	createNotificationErr        error
	findDuplicateNotification    *domain.FeedInteractionNotification
	findDuplicateNotificationErr error
	listNotifications            []domain.FeedInteractionNotification
	listNotificationsErr         error
	listNotificationsLimit       int
	listNotificationsOffset      int
	notificationCounts           repo.NotificationCounts
	notificationCountsErr        error
	countNotificationsCalls      int
	countUnread                  int64
	countUnreadErr               error
	countUnreadCalls             int
	markReadRows                 int64
	markReadErr                  error
	listCommentTasks             []domain.CommentTask
	listCommentTasksErr          error
}

func (m *mockNotificationRepo) CreateNotification(ctx context.Context, n *domain.FeedInteractionNotification) error {
	return m.createNotificationErr
}
func (m *mockNotificationRepo) FindRecentDuplicate(ctx context.Context, recipientUserID, notificationType string, actorUserID, recordID, parentCommentID, commentID, contentPreview *string) (*domain.FeedInteractionNotification, error) {
	return m.findDuplicateNotification, m.findDuplicateNotificationErr
}
func (m *mockNotificationRepo) FindRecentDuplicateForTarget(ctx context.Context, recipientUserID, notificationType string, actorUserID *string, targetType string, targetID *string, parentCommentID, commentID, contentPreview *string) (*domain.FeedInteractionNotification, error) {
	return m.findDuplicateNotification, m.findDuplicateNotificationErr
}
func (m *mockNotificationRepo) ListNotifications(ctx context.Context, userID, notificationType string, limit, offset int) ([]domain.FeedInteractionNotification, error) {
	m.listNotificationsLimit = limit
	m.listNotificationsOffset = offset
	return m.listNotifications, m.listNotificationsErr
}
func (m *mockNotificationRepo) CountNotifications(ctx context.Context, userID string) (repo.NotificationCounts, error) {
	m.countNotificationsCalls++
	return m.notificationCounts, m.notificationCountsErr
}
func (m *mockNotificationRepo) CountUnread(ctx context.Context, userID string) (int64, error) {
	m.countUnreadCalls++
	return m.countUnread, m.countUnreadErr
}
func (m *mockNotificationRepo) MarkRead(ctx context.Context, userID string, notificationIDs []string) (int64, error) {
	return m.markReadRows, m.markReadErr
}
func (m *mockNotificationRepo) ListCommentTasksByUser(ctx context.Context, userID, commentType string, limit int) ([]domain.CommentTask, error) {
	return m.listCommentTasks, m.listCommentTasksErr
}

type mockUserRepo struct {
	findByIDUser *authrepo.User
	findByIDErr  error
}

func (m *mockUserRepo) FindByOpenID(ctx context.Context, openID string) (*authrepo.User, error) {
	return nil, nil
}
func (m *mockUserRepo) FindByID(ctx context.Context, userID string) (*authrepo.User, error) {
	return m.findByIDUser, m.findByIDErr
}
func (m *mockUserRepo) Create(ctx context.Context, user *authrepo.User) error { return nil }
func (m *mockUserRepo) UpdateFields(ctx context.Context, userID string, updates map[string]any) (*authrepo.User, error) {
	return nil, nil
}
func (m *mockUserRepo) ExchangeCode(ctx context.Context, appID, secret, code string) (string, string, error) {
	return "", "", nil
}
func (m *mockUserRepo) UpdateLastSeenAnalyzeHistory(ctx context.Context, userID string) error {
	return nil
}
func (m *mockUserRepo) CountFoodRecordDays(ctx context.Context, userID string) (int64, error) {
	return 0, nil
}

type mockSystemMessageSender struct {
	messages []sentSystemMessage
}

type sentSystemMessage struct {
	receiverID string
	content    string
}

func (m *mockSystemMessageSender) SendSystemMessage(ctx context.Context, receiverID, content string) error {
	m.messages = append(m.messages, sentSystemMessage{receiverID: receiverID, content: content})
	return nil
}

func newTestService(feed FeedRepo, notif NotificationRepo, user UserFinder) *CommunityService {
	return NewCommunityService(feed, notif, user, nil, nil, nil, nil)
}

type mockHealthScore struct {
	score             float64
	recordedDays      int
	dietQualityPoints float64
	continuityPoints  float64
	stabilityPoints   float64
	eligible          bool
}

type mockHealthScoreProvider struct {
	scores           map[string]mockHealthScore
	mu               sync.Mutex
	requestedUserIDs []string
}

func (m *mockHealthScoreProvider) GetWeeklyHealthLeaderboardScore(_ context.Context, userID string) (float64, int, float64, float64, float64, bool, error) {
	m.mu.Lock()
	m.requestedUserIDs = append(m.requestedUserIDs, userID)
	m.mu.Unlock()
	value := m.scores[userID]
	return value.score, value.recordedDays, value.dietQualityPoints, value.continuityPoints, value.stabilityPoints, value.eligible, nil
}

func TestPublicFeed(t *testing.T) {
	petLevel := 12
	mockFeed := &mockFeedRepo{
		listPublicFeed: []repo.FeedRecord{{ID: "r1", UserID: "u1", MealType: "lunch"}},
		likesMap:       map[string]*repo.LikeInfo{"r1": {Count: 2}},
		profiles:       map[string]*repo.UserProfile{"u1": {ID: "u1", Nickname: "Alice", PetLevel: &petLevel}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	items, err := svc.PublicFeed(context.Background(), FeedParams{Limit: 10})
	assert.NoError(t, err)
	assert.Len(t, items, 1)
	assert.Equal(t, 2, items[0].LikeCount)
	assert.NotNil(t, items[0].Author.PetLevel)
	assert.Equal(t, 12, *items[0].Author.PetLevel)
}

func TestPublicFeedWithAuthorID(t *testing.T) {
	mockFeed := &mockFeedRepo{
		listPublicFeed: []repo.FeedRecord{{ID: "r1", UserID: "u2", MealType: "lunch"}},
		likesMap:       map[string]*repo.LikeInfo{"r1": {Count: 1}},
		profiles:       map[string]*repo.UserProfile{"u2": {ID: "u2", Nickname: "Bob"}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	items, err := svc.PublicFeed(context.Background(), FeedParams{Limit: 10, AuthorID: "u2"})
	assert.NoError(t, err)
	assert.True(t, mockFeed.listPublicFeedCalled)
	assert.Equal(t, []string{"u2"}, mockFeed.listPublicFeedAuthorIDs)
	assert.Len(t, items, 1)
	assert.Equal(t, "u2", items[0].Record.UserID)
}

func TestFriendFeed(t *testing.T) {
	mockFeed := &mockFeedRepo{
		listFriendFeed: []repo.FeedRecord{{ID: "r1", UserID: "u1", MealType: "lunch"}},
		friendIDs:      []string{"u2"},
		likesMap:       map[string]*repo.LikeInfo{"r1": {Count: 1, Liked: true}},
		profiles:       map[string]*repo.UserProfile{"u1": {ID: "u1", Nickname: "Alice"}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	items, err := svc.FriendFeed(context.Background(), "u1", FeedParams{Limit: 10})
	assert.NoError(t, err)
	assert.Len(t, items, 1)
	assert.True(t, items[0].Liked)
}

func TestFriendFeedPublicScopeUsesPublicFeedWithViewerLikeState(t *testing.T) {
	mockFeed := &mockFeedRepo{
		listPublicFeed: []repo.FeedRecord{{ID: "r1", UserID: "u2", MealType: "lunch"}},
		friendIDs:      []string{"u3"},
		likesMap:       map[string]*repo.LikeInfo{repo.FeedTargetKey(repo.FeedTargetFoodRecord, "r1"): {Count: 4, Liked: true}},
		profiles:       map[string]*repo.UserProfile{"u2": {ID: "u2", Nickname: "Alice"}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})

	items, err := svc.FriendFeed(context.Background(), "viewer", FeedParams{
		Limit:       10,
		AuthorScope: "public",
		ContentType: "all",
	})

	assert.NoError(t, err)
	assert.True(t, mockFeed.listPublicFeedCalled)
	assert.False(t, mockFeed.listFriendFeedCalled)
	assert.Equal(t, "all", mockFeed.listPublicFeedContentType)
	assert.Len(t, items, 1)
	assert.Equal(t, 4, items[0].LikeCount)
	assert.True(t, items[0].Liked)
	assert.False(t, items[0].IsMine)
}

func TestFriendFeedLatestUsesOffsetWindow(t *testing.T) {
	now := time.Now()
	mockFeed := &mockFeedRepo{
		listFriendFeed: []repo.FeedRecord{
			{ID: "r1", UserID: "u1", RecordTime: &now},
			{ID: "r2", UserID: "u1", RecordTime: &now},
			{ID: "r3", UserID: "u1", RecordTime: &now},
			{ID: "r4", UserID: "u1", RecordTime: &now},
			{ID: "r5", UserID: "u1", RecordTime: &now},
			{ID: "r6", UserID: "u1", RecordTime: &now},
			{ID: "r7", UserID: "u1", RecordTime: &now},
			{ID: "r8", UserID: "u1", RecordTime: &now},
			{ID: "r9", UserID: "u1", RecordTime: &now},
			{ID: "r10", UserID: "u1", RecordTime: &now},
			{ID: "r11", UserID: "u1", RecordTime: &now},
			{ID: "r12", UserID: "u1", RecordTime: &now},
		},
		friendIDs: []string{"u1"},
		likesMap:  map[string]*repo.LikeInfo{},
		profiles:  map[string]*repo.UserProfile{"u1": {ID: "u1", Nickname: "Alice"}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})

	items, err := svc.FriendFeed(context.Background(), "viewer", FeedParams{
		Offset: 10,
		Limit:  10,
		SortBy: "latest",
	})

	assert.NoError(t, err)
	assert.Equal(t, 20, mockFeed.listFriendFeedLimit)
	assert.Len(t, items, 2)
	assert.Equal(t, "r11", items[0].Record.ID)
	assert.Equal(t, "r12", items[1].Record.ID)
}

func TestPublicFeedLatestUsesOffsetWindow(t *testing.T) {
	now := time.Now()
	mockFeed := &mockFeedRepo{
		listPublicFeed: []repo.FeedRecord{
			{ID: "r1", UserID: "u1", RecordTime: &now},
			{ID: "r2", UserID: "u1", RecordTime: &now},
			{ID: "r3", UserID: "u1", RecordTime: &now},
			{ID: "r4", UserID: "u1", RecordTime: &now},
			{ID: "r5", UserID: "u1", RecordTime: &now},
			{ID: "r6", UserID: "u1", RecordTime: &now},
			{ID: "r7", UserID: "u1", RecordTime: &now},
			{ID: "r8", UserID: "u1", RecordTime: &now},
			{ID: "r9", UserID: "u1", RecordTime: &now},
			{ID: "r10", UserID: "u1", RecordTime: &now},
			{ID: "r11", UserID: "u1", RecordTime: &now},
		},
		likesMap: map[string]*repo.LikeInfo{},
		profiles: map[string]*repo.UserProfile{"u1": {ID: "u1", Nickname: "Alice"}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})

	items, err := svc.PublicFeed(context.Background(), FeedParams{
		Offset: 10,
		Limit:  10,
		SortBy: "latest",
	})

	assert.NoError(t, err)
	assert.Equal(t, 20, mockFeed.listPublicFeedLimit)
	assert.Len(t, items, 1)
	assert.Equal(t, "r11", items[0].Record.ID)
}

func TestNormalizeFeedRecordUsesChinaTime(t *testing.T) {
	utcTime := time.Date(2026, 5, 11, 12, 30, 0, 0, time.UTC)
	svc := newTestService(&mockFeedRepo{}, &mockNotificationRepo{}, &mockUserRepo{})

	record := svc.normalizeFeedRecord(context.Background(), repo.FeedRecord{ID: "r1", RecordTime: &utcTime})

	assert.NotNil(t, record.RecordTime)
	assert.Equal(t, "2026-05-11T20:30:00+08:00", record.RecordTime.Format(time.RFC3339))
}

func TestNormalizeFeedRecordKeepsOnlyOriginalImages(t *testing.T) {
	svc := newTestService(&mockFeedRepo{}, &mockNotificationRepo{}, &mockUserRepo{})
	userImage := "https://cdn-food-images.coachlink.fit/user.jpg"
	libraryImage := "standard-food/backfill/lib.jpg"

	record := svc.normalizeFeedRecord(context.Background(), repo.FeedRecord{
		ID:         "r1",
		FeedType:   repo.FeedTargetFoodRecord,
		ImagePath:  &userImage,
		ImagePaths: []string{userImage},
		Items: []map[string]any{
			{
				"name":          "水煮蛋",
				"manual_source": "nutrition_library",
				"image_paths":   []string{libraryImage},
			},
		},
	})

	assert.Equal(t, []string{userImage}, record.ImagePaths)
	assert.NotNil(t, record.ImagePath)
	assert.Equal(t, userImage, *record.ImagePath)
}

func TestNormalizeFeedRecordFallsBackToLibraryImages(t *testing.T) {
	svc := newTestService(&mockFeedRepo{}, &mockNotificationRepo{}, &mockUserRepo{})
	libraryImage := "standard-food/backfill/lib.jpg"

	record := svc.normalizeFeedRecord(context.Background(), repo.FeedRecord{
		ID:       "r1",
		FeedType: repo.FeedTargetFoodRecord,
		Items: []map[string]any{
			{
				"name":          "水煮蛋",
				"manual_source": "nutrition_library",
				"image_paths":   []string{libraryImage},
			},
		},
	})

	assert.Equal(t, []string{libraryImage}, record.ImagePaths)
	assert.NotNil(t, record.ImagePath)
	assert.Equal(t, libraryImage, *record.ImagePath)
}

func TestChinaWeekWindowUsesBeijingNaturalWeek(t *testing.T) {
	mondayMorning := time.Date(2026, 5, 11, 9, 30, 0, 0, chinaTZ)

	start, end, startStr, endStr := chinaWeekWindow(mondayMorning)

	assert.Equal(t, "2026-05-11", startStr)
	assert.Equal(t, "2026-05-17", endStr)
	assert.Equal(t, "2026-05-11T00:00:00+08:00", start.Format(time.RFC3339))
	assert.Equal(t, "2026-05-18T00:00:00+08:00", end.Format(time.RFC3339))
}

func TestChinaWeekWindowSundayStaysInSameNaturalWeek(t *testing.T) {
	sundayNight := time.Date(2026, 5, 17, 23, 30, 0, 0, chinaTZ)

	start, end, startStr, endStr := chinaWeekWindow(sundayNight)

	assert.Equal(t, "2026-05-11", startStr)
	assert.Equal(t, "2026-05-17", endStr)
	assert.Equal(t, "2026-05-11T00:00:00+08:00", start.Format(time.RFC3339))
	assert.Equal(t, "2026-05-18T00:00:00+08:00", end.Format(time.RFC3339))
}

func TestCheckinLeaderboardUsesAllWeeklyParticipantsAndKeepsHealthScopeIndependent(t *testing.T) {
	mockFeed := &mockFeedRepo{
		friendIDs:     []string{"u2"},
		checkinCounts: map[string]int{"u1": 5, "u2": 3, "u3": 8},
		profiles: map[string]*repo.UserProfile{
			"u1": {ID: "u1", Nickname: "Alice"},
			"u2": {ID: "u2", Nickname: "Bob"},
			"u3": {ID: "u3", Nickname: "非好友用户"},
		},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	result, err := svc.CheckinLeaderboard(context.Background(), "u1")
	assert.NoError(t, err)
	assert.NotNil(t, result)
	assert.Len(t, result.List, 3)
	assert.Equal(t, 1, result.List[0].Rank)
	assert.Equal(t, "u3", result.List[0].UserID)
}

func TestHealthLeaderboardUsesCalibratedWeeklyScoreAndSkipsInsufficientData(t *testing.T) {
	mockFeed := &mockFeedRepo{
		friendIDs: []string{"u2", "u3"},
		profiles: map[string]*repo.UserProfile{
			"u1": {ID: "u1", Nickname: "我"},
			"u2": {ID: "u2", Nickname: "好友甲"},
			"u3": {ID: "u3", Nickname: "好友乙"},
		},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	provider := &mockHealthScoreProvider{scores: map[string]mockHealthScore{
		"u1": {score: 87.2, recordedDays: 6, dietQualityPoints: 62.2, continuityPoints: 15, stabilityPoints: 10, eligible: true},
		"u2": {score: 88.5, recordedDays: 5, dietQualityPoints: 68.2, continuityPoints: 12.5, stabilityPoints: 7.8, eligible: true},
		"u3": {score: 91, recordedDays: 1, eligible: false},
	}}
	svc.ConfigureHealthScoreProvider(provider)

	result, err := svc.HealthLeaderboard(context.Background(), "u1")

	assert.NoError(t, err)
	assert.Len(t, result.List, 2)
	assert.Equal(t, "u2", result.List[0].UserID)
	assert.InDelta(t, 88.5, result.List[0].HealthIndex, 0.001)
	assert.Nil(t, result.List[0].DietQualityPoints)
	assert.Equal(t, 2, result.List[1].Rank)
	assert.True(t, result.List[1].IsMe)
	assert.InDelta(t, 62.2, *result.List[1].DietQualityPoints, 0.001)
	assert.InDelta(t, 15.0, *result.List[1].ContinuityPoints, 0.001)
	assert.InDelta(t, 10.0, *result.List[1].StabilityPoints, 0.001)
	assert.Equal(t, 4, result.ScoringRule.MinimumRecordedDays)
	assert.Equal(t, 75, result.ScoringRule.DietQualityPoints)
	provider.mu.Lock()
	assert.ElementsMatch(t, []string{"u1", "u2", "u3"}, provider.requestedUserIDs)
	provider.mu.Unlock()
}

func TestFoodNutrientLeaderboardAddsRankAndMetadata(t *testing.T) {
	mockFeed := &mockFeedRepo{nutrientFoods: []repo.NutrientFoodRow{
		{ID: "f1", Name: "鸡胸肉", Value: 31},
		{ID: "f2", Name: "金枪鱼", Value: 29},
	}}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})

	result, err := svc.FoodNutrientLeaderboard(context.Background(), "protein", 10)

	assert.NoError(t, err)
	assert.Equal(t, "蛋白质", result.Label)
	assert.Equal(t, "g", result.Unit)
	assert.Equal(t, "每100g", result.Basis)
	assert.Equal(t, 1, result.List[0].Rank)
	assert.Equal(t, "鸡胸肉", result.List[0].Name)
}

func TestLikeFeedNotFound(t *testing.T) {
	mockFeed := &mockFeedRepo{getFeedRecord: nil}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	_, err := svc.LikeFeed(context.Background(), "u1", "r1")
	assert.ErrorIs(t, err, commonerrors.ErrNotFound)
}

func TestLikeFeedForbidden(t *testing.T) {
	mockFeed := &mockFeedRepo{
		getFeedRecord: &repo.FeedRecord{ID: "r1", UserID: "u2"},
		isFriend:      false,
	}
	mockUser := &mockUserRepo{findByIDUser: &authrepo.User{ID: "u2", PublicRecords: boolPtr(false)}}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, mockUser)
	_, err := svc.LikeFeed(context.Background(), "u1", "r1")
	assert.ErrorIs(t, err, commonerrors.ErrForbidden)
}

func TestUnlikeFeed(t *testing.T) {
	mockFeed := &mockFeedRepo{}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	msg, err := svc.UnlikeFeed(context.Background(), "u1", "r1")
	assert.NoError(t, err)
	assert.Equal(t, "已取消", msg)
}

func TestReportFeedTargetSendsSubmitSystemMessage(t *testing.T) {
	mockFeed := &mockFeedRepo{
		getFeedRecord: &repo.FeedRecord{ID: "post-1", UserID: "reported-user"},
	}
	sender := &mockSystemMessageSender{}
	svc := NewCommunityService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{}, nil, nil, sender, nil)

	report, err := svc.ReportFeedTarget(context.Background(), "reporter-user", "circle_post", "post-1", "spam", "广告")

	assert.NoError(t, err)
	assert.NotNil(t, report)
	assert.NotNil(t, mockFeed.createdFeedReport)
	assert.Len(t, sender.messages, 1)
	assert.Equal(t, "reporter-user", sender.messages[0].receiverID)
	assert.Contains(t, sender.messages[0].content, "举报已提交")
}

func TestReportFeedTargetDuplicateDoesNotSendSubmitSystemMessage(t *testing.T) {
	mockFeed := &mockFeedRepo{
		getFeedRecord: &repo.FeedRecord{ID: "post-1", UserID: "reported-user"},
		existingFeedReport: &domain.FeedReport{
			ID:             "report-1",
			ReporterUserID: "reporter-user",
			ReportedUserID: "reported-user",
			TargetType:     "circle_post",
			TargetID:       "post-1",
			Reason:         "spam",
			Status:         "pending",
		},
	}
	sender := &mockSystemMessageSender{}
	svc := NewCommunityService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{}, nil, nil, sender, nil)

	report, err := svc.ReportFeedTarget(context.Background(), "reporter-user", "circle_post", "post-1", "spam", "广告")

	assert.NoError(t, err)
	assert.Equal(t, "report-1", report.ID)
	assert.Nil(t, mockFeed.createdFeedReport)
	assert.Empty(t, sender.messages)
}

func TestHideFeedNotFound(t *testing.T) {
	mockFeed := &mockFeedRepo{getFeedRecord: nil}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	err := svc.HideFeed(context.Background(), "u1", "r1")
	assert.ErrorIs(t, err, commonerrors.ErrNotFound)
}

func TestHideFeedForbidden(t *testing.T) {
	mockFeed := &mockFeedRepo{getFeedRecord: &repo.FeedRecord{ID: "r1", UserID: "u2"}}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	err := svc.HideFeed(context.Background(), "u1", "r1")
	assert.ErrorIs(t, err, commonerrors.ErrForbidden)
}

func TestListComments(t *testing.T) {
	mockFeed := &mockFeedRepo{
		getFeedRecord: &repo.FeedRecord{ID: "r1", UserID: "u2"},
		listComments:  []domain.FeedComment{{ID: "c1", UserID: "u1", RecordID: boolStringPtr("r1"), Content: "nice"}},
		profiles:      map[string]*repo.UserProfile{"u1": {ID: "u1", Nickname: "Alice"}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	items, err := svc.ListComments(context.Background(), "u2", "r1", 50)
	assert.NoError(t, err)
	assert.Len(t, items, 1)
	assert.Equal(t, "nice", items[0].Content)
}

func TestFeedContextNotFound(t *testing.T) {
	mockFeed := &mockFeedRepo{getFeedRecord: nil}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	result, err := svc.FeedContext(context.Background(), "u1", "r1")
	assert.NoError(t, err)
	assert.False(t, result.Allowed)
	assert.Equal(t, "not_found", result.Reason)
}

func TestFeedContextAllowed(t *testing.T) {
	mockFeed := &mockFeedRepo{
		getFeedRecord: &repo.FeedRecord{ID: "r1", UserID: "u1"},
		likesMap:      map[string]*repo.LikeInfo{"r1": {Count: 1}},
		profiles:      map[string]*repo.UserProfile{"u1": {ID: "u1", Nickname: "Alice"}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	result, err := svc.FeedContext(context.Background(), "u1", "r1")
	assert.NoError(t, err)
	assert.True(t, result.Allowed)
	assert.Equal(t, "owner", result.Reason)
}

func TestFeedContextHiddenFromFeedNotFound(t *testing.T) {
	mockFeed := &mockFeedRepo{
		getFeedRecord: &repo.FeedRecord{ID: "r1", UserID: "u1", HiddenFromFeed: true},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	result, err := svc.FeedContext(context.Background(), "u1", "r1")
	assert.NoError(t, err)
	assert.False(t, result.Allowed)
	assert.Equal(t, "not_found", result.Reason)
}

func TestLikeFeedHiddenFromFeedNotFound(t *testing.T) {
	mockFeed := &mockFeedRepo{
		getFeedRecord: &repo.FeedRecord{ID: "r1", UserID: "u1", HiddenFromFeed: true},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	_, err := svc.LikeFeed(context.Background(), "u1", "r1")
	assert.ErrorIs(t, err, commonerrors.ErrNotFound)
}

func TestPostCommentValidation(t *testing.T) {
	mockFeed := &mockFeedRepo{}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	_, err := svc.PostComment(context.Background(), "u1", "r1", "", nil, nil)
	assert.Error(t, err)
}

func TestPostCommentTooLong(t *testing.T) {
	mockFeed := &mockFeedRepo{}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	_, err := svc.PostComment(context.Background(), "u1", "r1", string(make([]byte, 501)), nil, nil)
	assert.Error(t, err)
}

func TestPostCommentDeduplication(t *testing.T) {
	mockFeed := &mockFeedRepo{
		getFeedRecord: &repo.FeedRecord{ID: "r1", UserID: "u2"},
		isFriend:      true,
		findDuplicate: &domain.FeedComment{ID: "c1", UserID: "u1", RecordID: boolStringPtr("r1"), Content: "dup"},
		profiles:      map[string]*repo.UserProfile{"u1": {ID: "u1", Nickname: "Alice"}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	comment, err := svc.PostComment(context.Background(), "u1", "r1", "dup", nil, nil)
	assert.NoError(t, err)
	assert.Equal(t, "c1", comment.ID)
}

func TestListCommentTasks(t *testing.T) {
	mockNotif := &mockNotificationRepo{listCommentTasks: []domain.CommentTask{{ID: "t1", Status: "pending"}}}
	svc := newTestService(&mockFeedRepo{}, mockNotif, &mockUserRepo{})
	tasks, err := svc.ListCommentTasks(context.Background(), "u1", 50)
	assert.NoError(t, err)
	assert.Len(t, tasks, 1)
}

func TestListNotifications(t *testing.T) {
	mockNotif := &mockNotificationRepo{
		listNotifications:  []domain.FeedInteractionNotification{{ID: "n1", NotificationType: "like_received"}},
		notificationCounts: repo.NotificationCounts{LikeCount: 20, CommentCount: 6, UnreadCount: 3},
	}
	mockFeed := &mockFeedRepo{profiles: map[string]*repo.UserProfile{}}
	svc := newTestService(mockFeed, mockNotif, &mockUserRepo{})
	result, err := svc.ListNotifications(context.Background(), "u1", "", 50, 0)
	assert.NoError(t, err)
	assert.Len(t, result.List, 1)
	assert.Equal(t, int64(3), result.UnreadCount)
	assert.Equal(t, int64(20), result.LikeCount)
	assert.Equal(t, int64(6), result.CommentCount)
	assert.Equal(t, 1, mockNotif.countNotificationsCalls)
	assert.Equal(t, 0, mockNotif.countUnreadCalls)
}

func TestListNotificationsSkipsHistoricalCountsForLaterPages(t *testing.T) {
	mockNotif := &mockNotificationRepo{listNotifications: []domain.FeedInteractionNotification{{ID: "n2"}}}
	svc := newTestService(&mockFeedRepo{profiles: map[string]*repo.UserProfile{}}, mockNotif, &mockUserRepo{})

	result, err := svc.ListNotifications(context.Background(), "u1", "", 20, 20)
	assert.NoError(t, err)
	assert.Len(t, result.List, 1)
	assert.Equal(t, 0, mockNotif.countNotificationsCalls)
	assert.Equal(t, 0, mockNotif.countUnreadCalls)
}

func TestCommunityServiceClampsClientControlledLimits(t *testing.T) {
	mockFeed := &mockFeedRepo{}
	mockNotif := &mockNotificationRepo{}
	svc := newTestService(mockFeed, mockNotif, &mockUserRepo{})

	_, err := svc.PublicFeed(context.Background(), FeedParams{Offset: 999999, Limit: 999999, CommentsLimit: 999999})
	assert.NoError(t, err)
	assert.Equal(t, MaxFeedLegacyOffset+MaxFeedPageSize, mockFeed.listPublicFeedLimit)

	_, err = svc.ListNotifications(context.Background(), "u1", "", 999999, 999999)
	assert.NoError(t, err)
	assert.Equal(t, MaxCommunityListLimit+1, mockNotif.listNotificationsLimit)
	assert.Equal(t, MaxFeedLegacyOffset, mockNotif.listNotificationsOffset)
}

func TestMarkNotificationsRead(t *testing.T) {
	mockNotif := &mockNotificationRepo{markReadRows: 2, countUnread: 1}
	svc := newTestService(&mockFeedRepo{}, mockNotif, &mockUserRepo{})
	result, err := svc.MarkNotificationsRead(context.Background(), "u1", []string{"n1"})
	assert.NoError(t, err)
	assert.Equal(t, int64(2), result.Updated)
	assert.Equal(t, int64(1), result.UnreadCount)
}

func TestScoreFeedRecord(t *testing.T) {
	now := time.Now()
	rec := &repo.FeedRecord{
		MealType:     "lunch",
		RecordTime:   &now,
		TotalProtein: 20,
		TotalCarbs:   50,
		TotalFat:     15,
	}
	score := scoreFeedRecord(rec, "hot", 5, 3, "lunch", "", nil)
	assert.Greater(t, score, 0.0)

	score2 := scoreFeedRecord(rec, "balanced", 5, 3, "", "", nil)
	assert.Greater(t, score2, 0.0)

	score3 := scoreFeedRecord(rec, "recommended", 5, 3, "lunch", "", nil)
	assert.Greater(t, score3, 0.0)
}

func TestComputeMacroBalanceScore(t *testing.T) {
	score := computeMacroBalanceScore(20, 50, 15)
	assert.Greater(t, score, 0.0)
	assert.LessOrEqual(t, score, 100.0)
}

func TestComputeFreshnessScore(t *testing.T) {
	now := time.Now()
	score := computeFreshnessScore(&now)
	assert.Greater(t, score, 0.0)
	assert.LessOrEqual(t, score, 1.0)

	old := now.Add(-100 * time.Hour)
	scoreOld := computeFreshnessScore(&old)
	assert.Equal(t, 0.0, scoreOld)
}

func boolPtr(b bool) *bool {
	return &b
}

func boolStringPtr(value string) *string {
	return &value
}
