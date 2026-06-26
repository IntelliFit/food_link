package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/community/domain"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"
)

func setupFeedTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)

	// Create tables
	assert.NoError(t, db.AutoMigrate(&FeedRecord{}, &domain.FeedLike{}, &domain.FeedComment{}, &UserFriend{}, &UserProfile{}))
	assert.NoError(t, db.Exec(`CREATE TABLE IF NOT EXISTS user_exercise_logs (
		id text primary key,
		user_id text,
		exercise_desc text,
		exercise_type text,
		image_url text,
		calories_burned real,
		duration_min integer,
		recorded_on timestamptz,
		recorded_at timestamptz,
		ai_reasoning text,
		exercise_items jsonb default '[]'::jsonb,
		hidden_from_feed boolean default false,
		created_at timestamptz
	)`).Error)
	return db
}

func testStringPtr(value string) *string {
	return &value
}

func TestFeedRepoListPublicFeed(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	// Create public users
	assert.NoError(t, db.Create(&UserProfile{ID: "u1", Nickname: "Alice", Avatar: "a1"}).Error)
	assert.NoError(t, db.Model(&UserProfile{}).Where("id = ?", "u1").Update("public_records", true).Error)
	assert.NoError(t, db.Create(&UserProfile{ID: "u2", Nickname: "Bob", Avatar: "a2"}).Error)
	assert.NoError(t, db.Model(&UserProfile{}).Where("id = ?", "u2").Update("public_records", true).Error)

	// Create record
	assert.NoError(t, db.Create(&FeedRecord{ID: "r1", UserID: "u1", MealType: "lunch", HiddenFromFeed: false}).Error)
	assert.NoError(t, db.Create(&FeedRecord{ID: "r2", UserID: "u1", MealType: "lunch", HiddenFromFeed: true}).Error)
	assert.NoError(t, db.Create(&FeedRecord{ID: "r3", UserID: "u2", MealType: "lunch", HiddenFromFeed: false}).Error)

	records, err := r.ListPublicFeed(ctx, nil, "food_record", "", "", "", "", 10)
	assert.NoError(t, err)
	assert.Len(t, records, 2)

	// 指定 author_id 过滤
	records, err = r.ListPublicFeed(ctx, []string{"u2"}, "food_record", "", "", "", "", 10)
	assert.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Equal(t, "r3", records[0].ID)
}

func TestFeedRepoListFriendFeed(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	assert.NoError(t, db.Create(&FeedRecord{ID: "r1", UserID: "u1", MealType: "lunch", HiddenFromFeed: false}).Error)
	assert.NoError(t, db.Create(&FeedRecord{ID: "r2", UserID: "u1", MealType: "lunch", HiddenFromFeed: true}).Error)

	records, err := r.ListFriendFeed(ctx, []string{"u1"}, "food_record", "", "", "", "", 10)
	assert.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Equal(t, "r1", records[0].ID)
}

func TestFeedRepoGetFeedRecordByID(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	assert.NoError(t, db.Create(&FeedRecord{ID: "r1", UserID: "u1"}).Error)

	record, err := r.GetFeedRecordByID(ctx, "r1")
	assert.NoError(t, err)
	assert.NotNil(t, record)
	assert.Equal(t, "u1", record.UserID)

	record2, err := r.GetFeedRecordByID(ctx, "r999")
	assert.NoError(t, err)
	assert.Nil(t, record2)
}

func TestFeedRepoHideFeedRecord(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	assert.NoError(t, db.Create(&FeedRecord{ID: "r1", UserID: "u1", HiddenFromFeed: false}).Error)
	assert.NoError(t, r.HideFeedRecord(ctx, "u1", "r1"))

	var rec FeedRecord
	db.First(&rec, "id = ?", "r1")
	assert.True(t, rec.HiddenFromFeed)
}

func TestFeedRepoAddLike(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	assert.NoError(t, r.AddLike(ctx, "u1", "r1"))

	var likes []domain.FeedLike
	assert.NoError(t, db.Find(&likes).Error)
	assert.Len(t, likes, 1)
	assert.Equal(t, "u1", likes[0].UserID)

	// Duplicate should be ignored
	assert.NoError(t, r.AddLike(ctx, "u1", "r1"))
}

func TestFeedRepoRemoveLike(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	assert.NoError(t, r.AddLike(ctx, "u1", "r1"))
	assert.NoError(t, r.RemoveLike(ctx, "u1", "r1"))

	var likes []domain.FeedLike
	assert.NoError(t, db.Find(&likes).Error)
	assert.Len(t, likes, 0)
}

func TestFeedRepoGetLikesForRecords(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	assert.NoError(t, r.AddLike(ctx, "u1", "r1"))
	assert.NoError(t, r.AddLike(ctx, "u2", "r1"))

	likesMap, err := r.GetLikesForRecords(ctx, []string{"r1"}, "u1")
	assert.NoError(t, err)
	assert.Equal(t, 2, likesMap["r1"].Count)
	assert.True(t, likesMap["r1"].Liked)
}

func TestFeedRepoAddComment(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	comment := &domain.FeedComment{
		UserID:   "u1",
		RecordID: testStringPtr("r1"),
		Content:  "test",
	}
	assert.NoError(t, r.AddComment(ctx, comment))
	assert.NotEmpty(t, comment.ID)
}

func TestFeedRepoListComments(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	assert.NoError(t, r.AddComment(ctx, &domain.FeedComment{UserID: "u1", RecordID: testStringPtr("r1"), Content: "c1"}))
	assert.NoError(t, r.AddComment(ctx, &domain.FeedComment{UserID: "u2", RecordID: testStringPtr("r1"), Content: "c2"}))

	comments, err := r.ListComments(ctx, "r1", 10)
	assert.NoError(t, err)
	assert.Len(t, comments, 2)
}

func TestFeedRepoFindRecentDuplicate(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	comment := &domain.FeedComment{
		UserID:   "u1",
		RecordID: testStringPtr("r1"),
		Content:  "dup",
	}
	assert.NoError(t, r.AddComment(ctx, comment))

	dup, err := r.FindRecentDuplicate(ctx, "u1", "r1", "dup", nil, nil, 10*time.Second)
	assert.NoError(t, err)
	assert.NotNil(t, dup)

	noDup, err := r.FindRecentDuplicate(ctx, "u1", "r1", "other", nil, nil, 10*time.Second)
	assert.NoError(t, err)
	assert.Nil(t, noDup)
}

func TestFeedRepoGetFriendIDs(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	assert.NoError(t, db.Create(&UserFriend{UserID: "u1", FriendID: "u2"}).Error)
	assert.NoError(t, db.Create(&UserFriend{UserID: "u3", FriendID: "u1"}).Error)

	ids, err := r.GetFriendIDs(ctx, "u1")
	assert.NoError(t, err)
	assert.Len(t, ids, 2)
}

func TestFeedRepoIsFriend(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	assert.NoError(t, db.Create(&UserFriend{UserID: "u1", FriendID: "u2"}).Error)

	isFriend, err := r.IsFriend(ctx, "u1", "u2")
	assert.NoError(t, err)
	assert.True(t, isFriend)

	isNotFriend, err := r.IsFriend(ctx, "u1", "u3")
	assert.NoError(t, err)
	assert.False(t, isNotFriend)
}

func TestFeedRepoGetUserProfiles(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	assert.NoError(t, db.Create(&UserProfile{ID: "u1", Nickname: "Alice"}).Error)

	profiles, err := r.GetUserProfiles(ctx, []string{"u1"})
	assert.NoError(t, err)
	assert.Equal(t, "Alice", profiles["u1"].Nickname)
}

func TestFeedRepoGetCheckinCounts(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	now := time.Now().UTC()
	assert.NoError(t, db.Create(&FeedRecord{ID: "r1", UserID: "u1", RecordTime: &now}).Error)
	assert.NoError(t, db.Create(&FeedRecord{ID: "r2", UserID: "u1", RecordTime: &now}).Error)

	counts, err := r.GetCheckinCounts(ctx, []string{"u1"}, now.Add(-time.Hour), now.Add(time.Hour))
	assert.NoError(t, err)
	assert.Equal(t, 2, counts["u1"])
}
