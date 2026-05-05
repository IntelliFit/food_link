package service

import (
	"context"
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
	listFriendFeed             []repo.FeedRecord
	listFriendFeedErr          error
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
}

func (m *mockFeedRepo) ListPublicFeed(ctx context.Context, mealType, dietGoal string, limit int) ([]repo.FeedRecord, error) {
	return m.listPublicFeed, m.listPublicFeedErr
}
func (m *mockFeedRepo) ListFriendFeed(ctx context.Context, authorIDs []string, mealType, dietGoal string, limit int) ([]repo.FeedRecord, error) {
	return m.listFriendFeed, m.listFriendFeedErr
}
func (m *mockFeedRepo) GetFeedRecordByID(ctx context.Context, recordID string) (*repo.FeedRecord, error) {
	return m.getFeedRecord, m.getFeedRecordErr
}
func (m *mockFeedRepo) HideFeedRecord(ctx context.Context, userID, recordID string) error {
	return m.hideFeedErr
}
func (m *mockFeedRepo) AddLike(ctx context.Context, userID, recordID string) error {
	return m.addLikeErr
}
func (m *mockFeedRepo) RemoveLike(ctx context.Context, userID, recordID string) error {
	return m.removeLikeErr
}
func (m *mockFeedRepo) GetLikesForRecords(ctx context.Context, recordIDs []string, currentUserID string) (map[string]*repo.LikeInfo, error) {
	return m.likesMap, m.likesMapErr
}
func (m *mockFeedRepo) AddComment(ctx context.Context, comment *domain.FeedComment) error {
	return m.addCommentErr
}
func (m *mockFeedRepo) ListComments(ctx context.Context, recordID string, limit int) ([]domain.FeedComment, error) {
	return m.listComments, m.listCommentsErr
}
func (m *mockFeedRepo) ListCommentsByRecordIDs(ctx context.Context, recordIDs []string) ([]domain.FeedComment, error) {
	return m.listCommentsByRecordIDs, m.listCommentsByRecordIDsErr
}
func (m *mockFeedRepo) GetCommentByID(ctx context.Context, commentID string) (*domain.FeedComment, error) {
	return m.getComment, m.getCommentErr
}
func (m *mockFeedRepo) FindRecentDuplicate(ctx context.Context, userID, recordID, content string, parentCommentID, replyToUserID *string, window time.Duration) (*domain.FeedComment, error) {
	return m.findDuplicate, m.findDuplicateErr
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
func (m *mockFeedRepo) GetCheckinCounts(ctx context.Context, userIDs []string, weekStart, weekEnd time.Time) (map[string]int, error) {
	return m.checkinCounts, m.checkinCountsErr
}

type mockNotificationRepo struct {
	createNotificationErr        error
	findDuplicateNotification    *domain.FeedInteractionNotification
	findDuplicateNotificationErr error
	listNotifications            []domain.FeedInteractionNotification
	listNotificationsErr         error
	countUnread                  int64
	countUnreadErr               error
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
func (m *mockNotificationRepo) ListNotifications(ctx context.Context, userID string, limit int) ([]domain.FeedInteractionNotification, error) {
	return m.listNotifications, m.listNotificationsErr
}
func (m *mockNotificationRepo) CountUnread(ctx context.Context, userID string) (int64, error) {
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

func newTestService(feed FeedRepo, notif NotificationRepo, user UserFinder) *CommunityService {
	return NewCommunityService(feed, notif, user)
}

func TestPublicFeed(t *testing.T) {
	mockFeed := &mockFeedRepo{
		listPublicFeed: []repo.FeedRecord{{ID: "r1", UserID: "u1", MealType: "lunch"}},
		likesMap:       map[string]*repo.LikeInfo{"r1": {Count: 2}},
		profiles:       map[string]*repo.UserProfile{"u1": {ID: "u1", Nickname: "Alice"}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	items, err := svc.PublicFeed(context.Background(), FeedParams{Limit: 10})
	assert.NoError(t, err)
	assert.Len(t, items, 1)
	assert.Equal(t, 2, items[0].LikeCount)
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

func TestCheckinLeaderboard(t *testing.T) {
	mockFeed := &mockFeedRepo{
		friendIDs:     []string{"u2"},
		checkinCounts: map[string]int{"u1": 5, "u2": 3},
		profiles:      map[string]*repo.UserProfile{"u1": {ID: "u1", Nickname: "Alice"}, "u2": {ID: "u2", Nickname: "Bob"}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	result, err := svc.CheckinLeaderboard(context.Background(), "u1")
	assert.NoError(t, err)
	assert.NotNil(t, result)
	assert.Len(t, result.List, 2)
	assert.Equal(t, 1, result.List[0].Rank)
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
		listComments: []domain.FeedComment{{ID: "c1", UserID: "u1", RecordID: "r1", Content: "nice"}},
		profiles:     map[string]*repo.UserProfile{"u1": {ID: "u1", Nickname: "Alice"}},
	}
	svc := newTestService(mockFeed, &mockNotificationRepo{}, &mockUserRepo{})
	items, err := svc.ListComments(context.Background(), "r1", 50)
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
		findDuplicate: &domain.FeedComment{ID: "c1", UserID: "u1", RecordID: "r1", Content: "dup"},
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
		listNotifications: []domain.FeedInteractionNotification{{ID: "n1", NotificationType: "like_received"}},
		countUnread:       3,
	}
	mockFeed := &mockFeedRepo{profiles: map[string]*repo.UserProfile{}}
	svc := newTestService(mockFeed, mockNotif, &mockUserRepo{})
	result, err := svc.ListNotifications(context.Background(), "u1", 50)
	assert.NoError(t, err)
	assert.Len(t, result.List, 1)
	assert.Equal(t, int64(3), result.UnreadCount)
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
