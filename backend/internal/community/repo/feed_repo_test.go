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
