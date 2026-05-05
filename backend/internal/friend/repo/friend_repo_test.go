package repo

import (
	"context"
	"testing"

	"food_link/backend/internal/friend/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&domain.FriendRequest{}, &domain.UserFriend{}, &User{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestFriendRepo_GetFriendIDs(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	// Empty
	ids, err := r.GetFriendIDs(ctx, "u1")
	assert.NoError(t, err)
	assert.Empty(t, ids)

	// Bidirectional
	db.Create(&domain.UserFriend{ID: "f1", UserID: "u1", FriendID: "u2"})
	db.Create(&domain.UserFriend{ID: "f2", UserID: "u2", FriendID: "u1"})
	ids, err = r.GetFriendIDs(ctx, "u1")
	assert.NoError(t, err)
	assert.Len(t, ids, 1)
	assert.Equal(t, "u2", ids[0])

	// Reverse direction only
	db.Create(&domain.UserFriend{ID: "f3", UserID: "u3", FriendID: "u1"})
	ids, err = r.GetFriendIDs(ctx, "u1")
	assert.NoError(t, err)
	assert.Len(t, ids, 2)
}

func TestFriendRepo_IsFriend(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	ok, _ := r.IsFriend(ctx, "u1", "u2")
	assert.False(t, ok)

	db.Create(&domain.UserFriend{ID: "f1", UserID: "u1", FriendID: "u2"})
	ok, _ = r.IsFriend(ctx, "u1", "u2")
	assert.True(t, ok)
}

func TestFriendRepo_AddFriendPair(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	err := r.AddFriendPair(ctx, "u1", "u2")
	assert.NoError(t, err)

	// Idempotent
	err = r.AddFriendPair(ctx, "u1", "u2")
	assert.NoError(t, err)

	var count int64
	db.Model(&domain.UserFriend{}).Count(&count)
	assert.Equal(t, int64(2), count)
}

func TestFriendRepo_RemoveFriendPair(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	err := r.AddFriendPair(ctx, "u1", "u2")
	assert.NoError(t, err)

	// Create pending request
	fr := &domain.FriendRequest{ID: uuid.New().String(), FromUserID: "u1", ToUserID: "u2", Status: "pending"}
	db.Create(fr)

	err = r.RemoveFriendPair(ctx, "u1", "u2")
	assert.NoError(t, err)

	ok, _ := r.IsFriend(ctx, "u1", "u2")
	assert.False(t, ok)

	var remaining domain.FriendRequest
	err = db.Where("id = ?", fr.ID).First(&remaining).Error
	assert.Error(t, err) // should be deleted
}

func TestFriendRepo_SearchUsers(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	db.Create(&User{ID: "u1", Nickname: "Alice", Telephone: strPtr("13800138000")})
	db.Create(&User{ID: "u2", Nickname: "Bob", Telephone: strPtr("13800138001")})

	users, err := r.SearchUsers(ctx, "u1", "Bo", "", 10)
	assert.NoError(t, err)
	assert.Len(t, users, 1)
	assert.Equal(t, "Bob", users[0].Nickname)

	users, err = r.SearchUsers(ctx, "u1", "", "13800138001", 10)
	assert.NoError(t, err)
	assert.Len(t, users, 1)
	assert.Equal(t, "u2", users[0].ID)

	// Exclude self
	users, err = r.SearchUsers(ctx, "u1", "Ali", "", 10)
	assert.NoError(t, err)
	assert.Len(t, users, 0)
}

func TestFriendRepo_GetPendingToUserIDs(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	ids, _ := r.GetPendingToUserIDs(ctx, "u1")
	assert.Empty(t, ids)

	db.Create(&domain.FriendRequest{ID: uuid.New().String(), FromUserID: "u1", ToUserID: "u2", Status: "pending"})
	ids, _ = r.GetPendingToUserIDs(ctx, "u1")
	assert.Equal(t, []string{"u2"}, ids)
}

func TestFriendRepo_SendFriendRequest(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	fr, err := r.SendFriendRequest(ctx, "u1", "u2")
	assert.NoError(t, err)
	assert.Equal(t, "pending", fr.Status)

	// Duplicate pending returns existing
	fr2, err := r.SendFriendRequest(ctx, "u1", "u2")
	assert.NoError(t, err)
	assert.Equal(t, fr.ID, fr2.ID)

	// Rejected can be resent
	db.Model(&domain.FriendRequest{}).Where("id = ?", fr.ID).Update("status", "rejected")
	fr3, err := r.SendFriendRequest(ctx, "u1", "u2")
	assert.NoError(t, err)
	assert.Equal(t, fr.ID, fr3.ID)
	assert.Equal(t, "pending", fr3.Status)
}

func TestFriendRepo_GetFriendRequestsReceived(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	rows, _ := r.GetFriendRequestsReceived(ctx, "u1")
	assert.Empty(t, rows)

	db.Create(&domain.FriendRequest{ID: uuid.New().String(), FromUserID: "u2", ToUserID: "u1", Status: "pending"})
	rows, _ = r.GetFriendRequestsReceived(ctx, "u1")
	assert.Len(t, rows, 1)
}

func TestFriendRepo_RespondFriendRequest(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	fr := &domain.FriendRequest{ID: uuid.New().String(), FromUserID: "u2", ToUserID: "u1", Status: "pending"}
	db.Create(fr)

	// Reject
	err := r.RespondFriendRequest(ctx, fr.ID, "u1", false)
	assert.NoError(t, err)
	var updated domain.FriendRequest
	db.First(&updated, "id = ?", fr.ID)
	assert.Equal(t, "rejected", updated.Status)

	// Accept creates friendship
	fr2 := &domain.FriendRequest{ID: uuid.New().String(), FromUserID: "u2", ToUserID: "u1", Status: "pending"}
	db.Create(fr2)
	err = r.RespondFriendRequest(ctx, fr2.ID, "u1", true)
	assert.NoError(t, err)
	ok, _ := r.IsFriend(ctx, "u1", "u2")
	assert.True(t, ok)

	// Not found
	err = r.RespondFriendRequest(ctx, "bad-id", "u1", true)
	assert.Error(t, err)

	// Already handled
	fr3 := &domain.FriendRequest{ID: uuid.New().String(), FromUserID: "u2", ToUserID: "u1", Status: "accepted"}
	db.Create(fr3)
	err = r.RespondFriendRequest(ctx, fr3.ID, "u1", true)
	assert.Error(t, err)
}

func TestFriendRepo_CancelSentFriendRequest(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	fr := &domain.FriendRequest{ID: uuid.New().String(), FromUserID: "u1", ToUserID: "u2", Status: "pending"}
	db.Create(fr)

	err := r.CancelSentFriendRequest(ctx, fr.ID, "u1")
	assert.NoError(t, err)

	// Already deleted
	err = r.CancelSentFriendRequest(ctx, fr.ID, "u1")
	assert.Error(t, err)

	// Wrong user
	fr2 := &domain.FriendRequest{ID: uuid.New().String(), FromUserID: "u1", ToUserID: "u2", Status: "pending"}
	db.Create(fr2)
	err = r.CancelSentFriendRequest(ctx, fr2.ID, "u2")
	assert.Error(t, err)

	// Not pending
	fr3 := &domain.FriendRequest{ID: uuid.New().String(), FromUserID: "u1", ToUserID: "u2", Status: "accepted"}
	db.Create(fr3)
	err = r.CancelSentFriendRequest(ctx, fr3.ID, "u1")
	assert.Error(t, err)
}

func TestFriendRepo_GetFriendsWithProfile(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	db.Create(&User{ID: "u1", Nickname: "Alice"})
	db.Create(&User{ID: "u2", Nickname: "Bob"})
	db.Create(&domain.UserFriend{ID: "f1", UserID: "u1", FriendID: "u2"})

	users, err := r.GetFriendsWithProfile(ctx, "u1")
	assert.NoError(t, err)
	assert.Len(t, users, 1)
	assert.Equal(t, "Bob", users[0].Nickname)
}

func TestFriendRepo_CountFriends(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	count, _ := r.CountFriends(ctx, "u1")
	assert.Equal(t, int64(0), count)

	db.Create(&domain.UserFriend{ID: "f1", UserID: "u1", FriendID: "u2"})
	count, _ = r.CountFriends(ctx, "u1")
	assert.Equal(t, int64(1), count)
}

func TestFriendRepo_DeleteFriendPair(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	db.Create(&domain.UserFriend{ID: "f1", UserID: "u1", FriendID: "u2"})
	db.Create(&domain.UserFriend{ID: "f2", UserID: "u2", FriendID: "u1"})

	deleted, err := r.DeleteFriendPair(ctx, "u1", "u2")
	assert.NoError(t, err)
	assert.Equal(t, int64(2), deleted)
}

func TestFriendRepo_GetFriendRequestsOverview(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	db.Create(&User{ID: "u1", Nickname: "Alice"})
	db.Create(&User{ID: "u2", Nickname: "Bob"})

	fr1 := &domain.FriendRequest{ID: uuid.New().String(), FromUserID: "u2", ToUserID: "u1", Status: "pending"}
	fr2 := &domain.FriendRequest{ID: uuid.New().String(), FromUserID: "u1", ToUserID: "u2", Status: "pending"}
	db.Create(fr1)
	db.Create(fr2)

	received, sent, err := r.GetFriendRequestsOverview(ctx, "u1")
	assert.NoError(t, err)
	assert.Len(t, received, 1)
	assert.Len(t, sent, 1)
	assert.Equal(t, "Bob", received[0].CounterpartNickname)
	assert.Equal(t, "Bob", sent[0].CounterpartNickname)
}

func TestFriendRepo_CleanupDuplicateFriends(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	db.Create(&domain.UserFriend{ID: "f1", UserID: "u1", FriendID: "u2"})
	db.Create(&domain.UserFriend{ID: "f2", UserID: "u1", FriendID: "u2"})
	db.Create(&domain.UserFriend{ID: "f3", UserID: "u1", FriendID: "u3"})

	deleted, err := r.CleanupDuplicateFriends(ctx, "u1")
	assert.NoError(t, err)
	assert.Equal(t, int64(1), deleted)

	var count int64
	db.Model(&domain.UserFriend{}).Where("user_id = ?", "u1").Count(&count)
	assert.Equal(t, int64(2), count)
}

func TestFriendRepo_ResolveUserByInviteCode(t *testing.T) {
	db := setupTestDB(t)
	r := NewFriendRepo(db)
	ctx := context.Background()

	db.Create(&User{ID: "550e8400-e29b-41d4-a716-446655440001", Nickname: "Alice"})
	db.Create(&User{ID: "550e8401-e29b-41d4-a716-446655440002", Nickname: "Bob"})

	// Exact match
	user, err := r.ResolveUserByInviteCode(ctx, "550e8400")
	assert.NoError(t, err)
	assert.Equal(t, "Alice", user.Nickname)

	// Longer code to disambiguate (raw id: 550e8400e29b41d4a716446655440001)
	user, err = r.ResolveUserByInviteCode(ctx, "550e8400e")
	assert.NoError(t, err)
	assert.Equal(t, "Alice", user.Nickname)

	// Ambiguous short code matching both
	_, err = r.ResolveUserByInviteCode(ctx, "550e840")
	assert.Error(t, err)

	// Not found
	user, err = r.ResolveUserByInviteCode(ctx, "ffffffff")
	assert.NoError(t, err)
	assert.Nil(t, user)

	// Invalid length
	user, err = r.ResolveUserByInviteCode(ctx, "abc")
	assert.NoError(t, err)
	assert.Nil(t, user)
}

func strPtr(s string) *string {
	return &s
}
