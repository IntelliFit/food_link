package repo

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"food_link/backend/internal/community/domain"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupFeedTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)

	// Create tables
	assert.NoError(t, db.AutoMigrate(&FeedRecord{}, &domain.FeedLike{}, &domain.FeedComment{}, &UserFriend{}, &UserProfile{}))
	assert.NoError(t, db.Exec(`CREATE TABLE IF NOT EXISTS user_pets (
		id text primary key,
		user_id text unique,
		level integer not null default 1
	)`).Error)
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

	records, err := r.ListPublicFeed(ctx, nil, "food_record", "", "", "", "", 10, nil)
	assert.NoError(t, err)
	assert.Len(t, records, 2)

	// 指定 author_id 过滤
	records, err = r.ListPublicFeed(ctx, []string{"u2"}, "food_record", "", "", "", "", 10, nil)
	assert.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Equal(t, "r3", records[0].ID)
}

func TestFeedRepoListPublicFeedDoesNotMaterializeEveryPublicUser(t *testing.T) {
	db := setupFeedTestDB(t)
	const userCount = 100
	users := make([]UserProfile, 0, userCount)
	for i := 0; i < userCount; i++ {
		isPublic := true
		users = append(users, UserProfile{
			ID:            fmt.Sprintf("public-user-%03d", i),
			Nickname:      "公开用户",
			PublicRecords: &isPublic,
		})
	}
	require.NoError(t, db.CreateInBatches(users, 100).Error)
	require.NoError(t, db.Create(&FeedRecord{
		ID: "public-record", UserID: users[0].ID, MealType: "lunch", HiddenFromFeed: false,
	}).Error)

	var mu sync.Mutex
	maxRowsRead := int64(0)
	callbackName := "feed-test:capture-row-count"
	require.NoError(t, db.Callback().Query().After("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		mu.Lock()
		defer mu.Unlock()
		if tx.RowsAffected > maxRowsRead {
			maxRowsRead = tx.RowsAffected
		}
	}))
	t.Cleanup(func() { _ = db.Callback().Query().Remove(callbackName) })

	rows, err := NewFeedRepo(db).ListPublicFeed(context.Background(), nil, FeedTargetFoodRecord, "", "", "", "latest", 1, nil)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.LessOrEqual(t, maxRowsRead, int64(10), "请求一条 Feed 时不应读取全部公开用户，单次读取了 %d 行", maxRowsRead)
}

func TestFeedRepoListFriendFeed(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	assert.NoError(t, db.Create(&FeedRecord{ID: "r1", UserID: "u1", MealType: "lunch", HiddenFromFeed: false}).Error)
	assert.NoError(t, db.Create(&FeedRecord{ID: "r2", UserID: "u1", MealType: "lunch", HiddenFromFeed: true}).Error)

	records, err := r.ListFriendFeed(ctx, []string{"u1"}, "food_record", "", "", "", "", 10, nil)
	assert.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Equal(t, "r1", records[0].ID)
}

func TestFeedRepoListPublicFeedSupportsStableLatestCursor(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()
	isPublic := true
	require.NoError(t, db.Create(&UserProfile{ID: "cursor-user", Nickname: "Cursor", PublicRecords: &isPublic}).Error)
	createdAt := time.Date(2026, 8, 22, 8, 0, 0, 0, time.UTC)
	for _, id := range []string{"r3", "r2", "r1"} {
		recordTime := createdAt
		require.NoError(t, db.Create(&FeedRecord{ID: id, UserID: "cursor-user", CreatedAt: &recordTime, RecordTime: &recordTime}).Error)
	}

	rows, err := r.ListPublicFeed(ctx, nil, FeedTargetFoodRecord, "", "", "", "latest", 10, &FeedCursor{
		BeforeTime: createdAt,
		BeforeKey:  FeedTargetKey(FeedTargetFoodRecord, "r2"),
	})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "r1", rows[0].ID)
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

func TestFeedRepoGetLikesForTargetsAggregatesInDatabase(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	likes := make([]domain.FeedLike, 0, 100)
	for i := 0; i < 100; i++ {
		likes = append(likes, domain.FeedLike{
			ID:         fmt.Sprintf("like-%03d", i),
			UserID:     fmt.Sprintf("user-%03d", i),
			TargetType: FeedTargetFoodRecord,
			TargetID:   "r1",
		})
	}
	require.NoError(t, db.CreateInBatches(likes, 100).Error)

	var mu sync.Mutex
	maxRowsRead := int64(0)
	callbackName := "feed-test:capture-like-row-count"
	require.NoError(t, db.Callback().Query().After("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		mu.Lock()
		defer mu.Unlock()
		if tx.RowsAffected > maxRowsRead {
			maxRowsRead = tx.RowsAffected
		}
	}))
	t.Cleanup(func() { _ = db.Callback().Query().Remove(callbackName) })

	result, err := r.GetLikesForTargets(ctx, []FeedTarget{{TargetType: FeedTargetFoodRecord, TargetID: "r1"}}, "user-042")
	require.NoError(t, err)
	require.Equal(t, 100, result[FeedTargetKey(FeedTargetFoodRecord, "r1")].Count)
	require.True(t, result[FeedTargetKey(FeedTargetFoodRecord, "r1")].Liked)
	require.LessOrEqual(t, maxRowsRead, int64(2), "聚合点赞时不应读取全部点赞明细，单次读取了 %d 行", maxRowsRead)
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
	assert.NoError(t, db.Exec("INSERT INTO user_pets (id, user_id, level) VALUES (?, ?, ?)", "pet-1", "u1", 12).Error)

	profiles, err := r.GetUserProfiles(ctx, []string{"u1"})
	assert.NoError(t, err)
	assert.Equal(t, "Alice", profiles["u1"].Nickname)
	assert.NotNil(t, profiles["u1"].PetLevel)
	assert.Equal(t, 12, *profiles["u1"].PetLevel)
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

func TestFeedRepoGetFoodNutrientRanking(t *testing.T) {
	db := setupFeedTestDB(t)
	assert.NoError(t, db.Exec(`CREATE TABLE food_nutrition_library (
		id text primary key, canonical_name text not null, image_path text,
		is_active boolean not null default true, quality_tier text not null default 'authoritative',
		kcal_per_100g numeric not null default 0, protein_per_100g numeric not null default 0,
		fiber_per_100g numeric not null default 0, calcium_mg_per_100g numeric not null default 0,
		iron_mg_per_100g numeric not null default 0, potassium_mg_per_100g numeric not null default 0,
		magnesium_mg_per_100g numeric not null default 0, zinc_mg_per_100g numeric not null default 0,
		vitamin_a_rae_mcg_per_100g numeric not null default 0, vitamin_c_mg_per_100g numeric not null default 0,
		vitamin_d_mcg_per_100g numeric not null default 0, vitamin_e_mg_per_100g numeric not null default 0,
		vitamin_k_mcg_per_100g numeric not null default 0, vitamin_b12_mcg_per_100g numeric not null default 0,
		folate_mcg_per_100g numeric not null default 0
	)`).Error)
	assert.NoError(t, db.Exec(`INSERT INTO food_nutrition_library
		(id, canonical_name, is_active, quality_tier, kcal_per_100g, protein_per_100g) VALUES
		('f1', '鸡胸肉（熟）', true, 'authoritative', 165, 28.8),
		('f2', '金枪鱼', true, 'reviewed_estimate', 132, 29),
		('f3', '停用食物', false, 'authoritative', 300, 99),
		('f4', '未审核食物', true, 'unreviewed', 260, 88),
		('f5', 'English Food', true, 'authoritative', 240, 77),
		('f6', '乳清蛋白粉', true, 'authoritative', 390, 78.4),
		('f7', '鸡蛋（全蛋）', true, 'unreviewed', 144, 12.7),
		('f8', '鸡蛋（煮）', true, 'authoritative', 155, 13.1),
		('f9', '鸡胸肉干', true, 'authoritative', 280, 46.5),
		('f10', '鸡肉（熟）', true, 'authoritative', 190, 15.2),
		('f11', '虾', true, 'authoritative', 99, 20.1),
		('f12', '虾仁', true, 'authoritative', 120, 43.7)`).Error)

	rows, err := NewFeedRepo(db).GetFoodNutrientRanking(context.Background(), "protein", 10)

	assert.NoError(t, err)
	assert.Len(t, rows, 4)
	assert.Equal(t, "虾仁", rows[0].Name)
	assert.Equal(t, 43.7, rows[0].Value)
	assert.Equal(t, "金枪鱼", rows[1].Name)
	assert.Equal(t, 29.0, rows[1].Value)
	assert.Equal(t, "鸡胸肉", rows[2].Name)
	assert.Equal(t, 28.8, rows[2].Value)
	assert.Equal(t, "鸡蛋", rows[3].Name)
	assert.Equal(t, 13.1, rows[3].Value)
	for _, row := range rows {
		assert.NotEqual(t, "鸡肉", row.Name)
		assert.NotEqual(t, "虾", row.Name)
	}
}
