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

func TestFeedRepoExerciseFeedKeepsOriginalTextAndHidesInternalItems(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()
	original := "自重深蹲、俯卧撑、双杠臂屈伸，我一共用了40分钟"

	assert.NoError(t, db.Create(&UserProfile{ID: "u1", Nickname: "Alice", Avatar: "a1"}).Error)
	assert.NoError(t, db.Model(&UserProfile{}).Where("id = ?", "u1").Update("public_records", true).Error)
	assert.NoError(t, db.Exec(`
		INSERT INTO user_exercise_logs (
			id, user_id, exercise_desc, exercise_type, calories_burned, duration_min,
			recorded_on, recorded_at, ai_reasoning, exercise_items, hidden_from_feed, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, false, ?)
	`, "ex1", "u1", original, "综合自重训练", 150, 40, time.Now(), time.Now(), "整次训练整体估算",
		`[{"name":"自重深蹲","duration_min":40,"met":3.5},{"name":"俯卧撑","duration_min":40,"met":4}]`, time.Now()).Error)

	records, err := r.ListPublicFeed(ctx, nil, FeedTargetExerciseLog, "", "", "", "", 10, nil)
	require.NoError(t, err)
	require.Len(t, records, 1)
	assert.Equal(t, original, *records[0].ExerciseDesc)
	assert.Empty(t, records[0].ExerciseItems)
	assert.Nil(t, records[0].AIReasoning)
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

func TestFeedRepoListCommentPreviewsByTargetsLimitsRowsPerTarget(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	for targetIndex, targetID := range []string{"r1", "r2"} {
		for i := 0; i < 12; i++ {
			createdAt := time.Date(2026, 8, 22, 8, targetIndex*20+i, 0, 0, time.UTC)
			require.NoError(t, db.Create(&domain.FeedComment{
				ID:         fmt.Sprintf("comment-%s-%02d", targetID, i),
				UserID:     fmt.Sprintf("user-%02d", i),
				TargetType: FeedTargetFoodRecord,
				TargetID:   targetID,
				Content:    fmt.Sprintf("comment-%02d", i),
				CreatedAt:  &createdAt,
			}).Error)
		}
	}

	comments, counts, err := r.ListCommentPreviewsByTargets(ctx, []FeedTarget{
		{TargetType: FeedTargetFoodRecord, TargetID: "r1"},
		{TargetType: FeedTargetFoodRecord, TargetID: "r2"},
	}, 3, nil)
	require.NoError(t, err)
	require.Len(t, comments, 6)
	require.Equal(t, 12, counts[FeedTargetKey(FeedTargetFoodRecord, "r1")])
	require.Equal(t, 12, counts[FeedTargetKey(FeedTargetFoodRecord, "r2")])
	require.Equal(t, "comment-09", comments[0].Content)
	require.Equal(t, "comment-11", comments[2].Content)
}

func TestFeedRepoListCommentPreviewsByTargetsExcludesBlockedAuthorsAndReplyTargets(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()
	target := FeedTarget{TargetType: FeedTargetFoodRecord, TargetID: "r1"}
	blockedUserID := "blocked-user"

	comments := []domain.FeedComment{
		{ID: "visible", UserID: "visible-user", TargetType: target.TargetType, TargetID: target.TargetID, Content: "visible"},
		{ID: "blocked-author", UserID: blockedUserID, TargetType: target.TargetType, TargetID: target.TargetID, Content: "blocked author"},
		{ID: "blocked-reply", UserID: "visible-user", ReplyToUserID: &blockedUserID, TargetType: target.TargetType, TargetID: target.TargetID, Content: "blocked reply target"},
	}
	for i := range comments {
		require.NoError(t, db.Create(&comments[i]).Error)
	}

	previews, counts, err := r.ListCommentPreviewsByTargets(ctx, []FeedTarget{target}, 5, []string{blockedUserID})
	require.NoError(t, err)
	require.Len(t, previews, 1)
	require.Equal(t, "visible", previews[0].ID)
	require.Equal(t, 1, counts[FeedTargetKey(target.TargetType, target.TargetID)])
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

func TestFeedRepoGetWeeklyCheckinCountsIncludesNonFriendUsers(t *testing.T) {
	db := setupFeedTestDB(t)
	r := NewFeedRepo(db)
	ctx := context.Background()

	now := time.Now().UTC()
	assert.NoError(t, db.Create(&FeedRecord{ID: "r1", UserID: "u1", RecordTime: &now}).Error)
	assert.NoError(t, db.Create(&FeedRecord{ID: "r2", UserID: "u1", RecordTime: &now}).Error)
	assert.NoError(t, db.Create(&FeedRecord{ID: "r3", UserID: "u2", RecordTime: &now}).Error)

	counts, err := r.GetWeeklyCheckinCounts(ctx, now.Add(-time.Hour), now.Add(time.Hour))
	assert.NoError(t, err)
	assert.Equal(t, 2, counts["u1"])
	assert.Equal(t, 1, counts["u2"])
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
		(id, canonical_name, image_path, is_active, quality_tier, kcal_per_100g, protein_per_100g) VALUES
		('f1', '鸡胸肉（熟）', 'chicken-breast.jpg', true, 'authoritative', 165, 28.8),
		('f2', '金枪鱼', 'tuna.jpg', true, 'reviewed_estimate', 132, 29),
		('f3', '停用食物', 'inactive.jpg', false, 'authoritative', 300, 99),
		('f4', '未审核食物', 'unreviewed.jpg', true, 'unreviewed', 260, 88),
		('f5', 'English Food', 'english.jpg', true, 'authoritative', 240, 77),
		('f6', '乳清蛋白粉', 'whey.jpg', true, 'authoritative', 390, 78.4),
		('f7', '鸡蛋（全蛋）', 'egg-unreviewed.jpg', true, 'unreviewed', 144, 12.7),
		('f8', '鸡蛋（煮）', 'egg.jpg', true, 'authoritative', 155, 13.1),
		('f9', '鸡胸肉干', 'dried-chicken.jpg', true, 'authoritative', 280, 46.5),
		('f10', '鸡肉（熟）', 'generic-chicken.jpg', true, 'authoritative', 190, 35.2),
		('f11', '虾', 'generic-shrimp.jpg', true, 'authoritative', 99, 25.1),
		('f12', '虾仁', 'shrimp-meat.jpg', true, 'authoritative', 99, 24),
		('f13', '虾米[海米，虾仁]', 'dried-shrimp.jpg', true, 'authoritative', 201, 43.7),
		('f14', '牛肉水饺', 'beef-dumpling.jpg', true, 'authoritative', 220, 40),
		('f15', '鸡蛋（卤制，市售）', 'processed-egg.jpg', true, 'authoritative', 191, 15.7),
		('f16', '牛肉（熟）', 'generic-beef.jpg', true, 'authoritative', 190, 33.2),
		('f17', '牛腩（熟）', 'beef-brisket.jpg', true, 'authoritative', 205, 24.5),
		('f18', '去皮鸡腿肉', 'chicken-thigh.jpg', true, 'reviewed_estimate', 151, 24.3),
		('f19', '鸡胸肉', NULL, true, 'authoritative', 160, 31.5)`).Error)

	rows, err := NewFeedRepo(db).GetFoodNutrientRanking(context.Background(), "protein", 10)

	assert.NoError(t, err)
	assert.Len(t, rows, 6)
	assert.Equal(t, "金枪鱼", rows[0].Name)
	assert.Equal(t, 29.0, rows[0].Value)
	assert.Equal(t, "鸡胸肉", rows[1].Name)
	assert.Equal(t, 28.8, rows[1].Value)
	assert.Equal(t, "牛腩", rows[2].Name)
	assert.Equal(t, 24.5, rows[2].Value)
	assert.Equal(t, "鸡腿肉", rows[3].Name)
	assert.Equal(t, 24.3, rows[3].Value)
	assert.Equal(t, "虾仁", rows[4].Name)
	assert.Equal(t, 24.0, rows[4].Value)
	assert.Equal(t, "鸡蛋", rows[5].Name)
	assert.Equal(t, 13.1, rows[5].Value)
	for _, row := range rows {
		assert.NotNil(t, row.ImagePath)
		assert.NotEmpty(t, *row.ImagePath)
		assert.NotEqual(t, "鸡肉", row.Name)
		assert.NotEqual(t, "牛肉", row.Name)
		assert.NotEqual(t, "虾", row.Name)
		assert.NotEqual(t, 43.7, row.Value)
		assert.NotEqual(t, 15.7, row.Value)
	}
}

func TestFeedRepoGetFoodNutrientRankingExcludesIncomparableOrUnreviewedValues(t *testing.T) {
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
		(id, canonical_name, image_path, quality_tier, kcal_per_100g, vitamin_e_mg_per_100g) VALUES
		('e1', '白芝麻', 'white-sesame.jpg', 'legacy_curated', 573, 25.4),
		('e2', '黑芝麻', 'black-sesame.jpg', 'legacy_curated', 573, 20),
		('e3', '花生', 'peanut.jpg', 'authoritative', 567, 8.33),
		('e4', '牛油果', 'avocado.jpg', 'authoritative', 160, 2.07),
		('e5', '杏仁', 'almond.jpg', 'unreviewed', 579, 99),
		('e6', '牛肉', 'generic-beef.jpg', 'authoritative', 250, 50),
		('e7', '花生', NULL, 'authoritative', 567, 90)`).Error)

	rows, err := NewFeedRepo(db).GetFoodNutrientRanking(context.Background(), "vitamin_e", 10)

	assert.NoError(t, err)
	assert.Equal(t, []NutrientFoodRow{
		{ID: "e3", Name: "花生", ImagePath: testStringPtr("peanut.jpg"), Value: 8.33},
		{ID: "e4", Name: "牛油果", ImagePath: testStringPtr("avocado.jpg"), Value: 2.07},
	}, rows)
}
