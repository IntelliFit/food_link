package service

import (
	"context"
	"testing"

	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/friend/domain"
	"food_link/backend/internal/friend/repo"

	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&domain.FriendRequest{}, &domain.UserFriend{}, &authrepo.User{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestBuildInviteCode(t *testing.T) {
	assert.Equal(t, "550e8400", buildInviteCode("550e8400-e29b-41d4-a716-446655440000"))
	assert.Equal(t, "abc", buildInviteCode("abc"))
	assert.Equal(t, "", buildInviteCode(""))
}

func TestFriendService_SearchUsers(t *testing.T) {
	db := setupTestDB(t)
	// seed users
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})
	db.Create(&authrepo.User{ID: "u3", Nickname: "Carol", OpenID: "o3"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	// Make u1 and u2 friends
	_ = friendRepo.AddFriendPair(ctx, "u1", "u2")
	// Send pending request from u1 to u3
	_, _ = friendRepo.SendFriendRequest(ctx, "u1", "u3")

	results, err := svc.SearchUsers(ctx, "u1", "Bo", "")
	assert.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Equal(t, "u2", results[0]["id"])
	assert.Equal(t, true, results[0]["is_friend"])
	assert.Equal(t, false, results[0]["is_pending"])

	results, err = svc.SearchUsers(ctx, "u1", "Ca", "")
	assert.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Equal(t, false, results[0]["is_friend"])
	assert.Equal(t, true, results[0]["is_pending"])
}

func TestFriendService_SendFriendRequest(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})
	db.Create(&authrepo.User{ID: "u3", Nickname: "Carol", OpenID: "o3"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	// cannot add self
	_, err := svc.SendFriendRequest(ctx, "u1", "u1")
	assert.Error(t, err)

	// success
	res, err := svc.SendFriendRequest(ctx, "u1", "u2")
	assert.NoError(t, err)
	assert.Equal(t, "pending", res["status"])

	// duplicate pending returns existing
	res2, err := svc.SendFriendRequest(ctx, "u1", "u2")
	assert.NoError(t, err)
	assert.Equal(t, res["id"], res2["id"])

	// already friend
	_ = friendRepo.AddFriendPair(ctx, "u1", "u3")
	_, err = svc.SendFriendRequest(ctx, "u1", "u3")
	assert.Error(t, err)
}

func TestFriendService_GetFriendRequestsReceived(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	_, _ = friendRepo.SendFriendRequest(ctx, "u2", "u1")
	results, err := svc.GetFriendRequestsReceived(ctx, "u1")
	assert.NoError(t, err)
	assert.Len(t, results, 1)
	assert.Equal(t, "Bob", results[0]["from_nickname"])
}

func TestFriendService_RespondFriendRequest(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	fr, _ := friendRepo.SendFriendRequest(ctx, "u2", "u1")

	err := svc.RespondFriendRequest(ctx, fr.ID, "u1", "reject")
	assert.NoError(t, err)

	// re-open request for accept test
	fr2, _ := friendRepo.SendFriendRequest(ctx, "u2", "u1")
	err = svc.RespondFriendRequest(ctx, fr2.ID, "u1", "accept")
	assert.NoError(t, err)

	isFriend, _ := friendRepo.IsFriend(ctx, "u1", "u2")
	assert.True(t, isFriend)

	// invalid action
	err = svc.RespondFriendRequest(ctx, "x", "u1", "invalid")
	assert.Error(t, err)
}

func TestFriendService_CancelSentFriendRequest(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	fr, _ := friendRepo.SendFriendRequest(ctx, "u1", "u2")
	err := svc.CancelSentFriendRequest(ctx, fr.ID, "u1")
	assert.NoError(t, err)

	// already cancelled
	err = svc.CancelSentFriendRequest(ctx, fr.ID, "u1")
	assert.Error(t, err)
}

func TestFriendService_GetFriendList(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	_ = friendRepo.AddFriendPair(ctx, "u1", "u2")
	list, err := svc.GetFriendList(ctx, "u1")
	assert.NoError(t, err)
	assert.Len(t, list, 1)
	assert.Equal(t, "Bob", list[0]["nickname"])
}

func TestFriendService_CountFriends(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	count, _ := svc.CountFriends(ctx, "u1")
	assert.Equal(t, int64(0), count)

	_ = friendRepo.AddFriendPair(ctx, "u1", "u2")
	count, _ = svc.CountFriends(ctx, "u1")
	assert.Equal(t, int64(1), count)
}

func TestFriendService_DeleteFriend(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	// cannot delete self
	err := svc.DeleteFriend(ctx, "u1", "u1")
	assert.Error(t, err)

	// not friend
	err = svc.DeleteFriend(ctx, "u1", "u2")
	assert.Error(t, err)

	_ = friendRepo.AddFriendPair(ctx, "u1", "u2")
	_, _ = friendRepo.SendFriendRequest(ctx, "u1", "u2")
	err = svc.DeleteFriend(ctx, "u1", "u2")
	assert.NoError(t, err)

	isFriend, _ := friendRepo.IsFriend(ctx, "u1", "u2")
	assert.False(t, isFriend)
}

func TestFriendService_GetFriendRequestsOverview(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	_, _ = friendRepo.SendFriendRequest(ctx, "u2", "u1")
	_, _ = friendRepo.SendFriendRequest(ctx, "u1", "u2")

	data, err := svc.GetFriendRequestsOverview(ctx, "u1")
	assert.NoError(t, err)
	recv := data["received"].([]map[string]any)
	sent := data["sent"].([]map[string]any)
	assert.Len(t, recv, 1)
	assert.Len(t, sent, 1)
}

func TestFriendService_CleanupDuplicateFriends(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	// Insert duplicate
	db.Create(&domain.UserFriend{ID: "f1", UserID: "u1", FriendID: "u2"})
	db.Create(&domain.UserFriend{ID: "f2", UserID: "u1", FriendID: "u2"})

	data, err := svc.CleanupDuplicateFriends(ctx, "u1")
	assert.NoError(t, err)
	assert.Equal(t, int64(1), data["cleaned"])
}

func TestFriendService_GetInviteProfile(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	profile, err := svc.GetInviteProfile(ctx, "u1")
	assert.NoError(t, err)
	assert.Equal(t, "Alice", profile["nickname"])
	assert.NotEmpty(t, profile["invite_code"])

	_, err = svc.GetInviteProfile(ctx, "nonexistent")
	assert.Equal(t, commonerrors.ErrNotFound, err)
}

func TestFriendService_ResolveUserByInviteCode(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "550e8400-e29b-41d4-a716-446655440001", Nickname: "Alice"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	profile, err := svc.ResolveUserByInviteCode(ctx, "550e8400")
	assert.NoError(t, err)
	assert.Equal(t, "Alice", profile["nickname"])

	_, err = svc.ResolveUserByInviteCode(ctx, "zzzz")
	assert.Equal(t, commonerrors.ErrNotFound, err)
}

func TestFriendService_ResolveInviteWithRelation(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "550e8400-e29b-41d4-a716-446655440001", Nickname: "Alice"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	profile, err := svc.ResolveInviteWithRelation(ctx, "550e8400-e29b-41d4-a716-446655440001", "550e8400")
	assert.NoError(t, err)
	assert.Equal(t, true, profile["is_self"])
	assert.Equal(t, false, profile["is_friend"])
}

func TestFriendService_AcceptInvite(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "550e8400-e29b-41d4-a716-446655440001", Nickname: "Alice"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	res, err := svc.AcceptInvite(ctx, "u2", "550e8400")
	assert.NoError(t, err)
	assert.Equal(t, "pending", res["status"])

	// self
	_, err = svc.AcceptInvite(ctx, "550e8400-e29b-41d4-a716-446655440001", "550e8400")
	assert.Error(t, err)
}

func TestFriendService_Cache(t *testing.T) {
	db := setupTestDB(t)
	db.Create(&authrepo.User{ID: "u1", Nickname: "Alice", OpenID: "o1"})
	db.Create(&authrepo.User{ID: "u2", Nickname: "Bob", OpenID: "o2"})

	friendRepo := repo.NewFriendRepo(db)
	userRepo := authrepo.NewUserRepo(db)
	svc := NewFriendService(friendRepo, userRepo)
	ctx := context.Background()

	_ = friendRepo.AddFriendPair(ctx, "u1", "u2")

	ids1, _ := svc.GetFriendIDs(ctx, "u1")
	assert.Len(t, ids1, 1)

	// Delete friend, but cache should still return stale data
	_ = friendRepo.RemoveFriendPair(ctx, "u1", "u2")
	ids2, _ := svc.GetFriendIDs(ctx, "u1")
	assert.Len(t, ids2, 1) // cached

	// Invalidate and refetch
	svc.invalidateFriendCache("u1")
	ids3, _ := svc.GetFriendIDs(ctx, "u1")
	assert.Len(t, ids3, 0)
}
