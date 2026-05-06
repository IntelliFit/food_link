package repo

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupHomeTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	db.Exec(`CREATE TABLE user_food_records (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		meal_type TEXT,
		record_time TIMESTAMP,
		total_calories REAL,
		total_protein REAL,
		total_carbs REAL,
		total_fat REAL,
		image_path TEXT,
		image_paths TEXT,
		description TEXT,
		items TEXT
	)`)
	db.Exec(`CREATE TABLE feed_comments (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		record_id TEXT,
		parent_comment_id TEXT,
		created_at TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE food_expiry_items (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		status TEXT,
		name TEXT,
		expire_date TIMESTAMP,
		storage_type TEXT
	)`)
	db.Exec(`CREATE TABLE user_exercise_logs (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		calories_burned INTEGER,
		recorded_on TEXT
	)`)
	return db
}

func TestHomeRepo_ListFoodRecordsByDate(t *testing.T) {
	db := setupHomeTestDB(t)
	repo := NewHomeRepo(db)
	ctx := context.Background()

	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	t1 := time.Date(2024, 6, 15, 12, 0, 0, 0, chinaTZ).UTC()

	db.Exec(`INSERT INTO user_food_records (id, user_id, meal_type, record_time, total_calories) VALUES (?, ?, ?, ?, ?)`,
		"r1", "user-1", "lunch", t1, 500)

	records, err := repo.ListFoodRecordsByDate(ctx, "user-1", "2024-06-15")
	require.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Equal(t, "lunch", records[0].MealType)
}

func TestHomeRepo_ListFoodRecordsByDate_InvalidDate(t *testing.T) {
	db := setupHomeTestDB(t)
	repo := NewHomeRepo(db)
	ctx := context.Background()

	_, err := repo.ListFoodRecordsByDate(ctx, "user-1", "invalid")
	require.Error(t, err)
}

func TestHomeRepo_GetFoodRecordByID(t *testing.T) {
	db := setupHomeTestDB(t)
	repo := NewHomeRepo(db)
	ctx := context.Background()

	// Not found
	record, err := repo.GetFoodRecordByID(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, record)

	// Found
	now := time.Now().UTC()
	db.Exec(`INSERT INTO user_food_records (id, user_id, meal_type, record_time, total_calories) VALUES (?, ?, ?, ?, ?)`,
		"r1", "user-1", "lunch", now, 500)

	record, err = repo.GetFoodRecordByID(ctx, "r1")
	require.NoError(t, err)
	require.NotNil(t, record)
	assert.Equal(t, "lunch", record.MealType)
}

func TestHomeRepo_ListExpiryItems(t *testing.T) {
	db := setupHomeTestDB(t)
	repo := NewHomeRepo(db)
	ctx := context.Background()

	now := time.Now()
	db.Exec(`INSERT INTO food_expiry_items (id, user_id, status, name, expire_date) VALUES (?, ?, ?, ?, ?)`,
		"e1", "user-1", "active", "Milk", now)

	items, err := repo.ListExpiryItems(ctx, "user-1")
	require.NoError(t, err)
	assert.Len(t, items, 1)
	assert.Equal(t, "active", items[0].Status)
}

func TestHomeRepo_GetExerciseBurned(t *testing.T) {
	db := setupHomeTestDB(t)
	repo := NewHomeRepo(db)
	ctx := context.Background()

	db.Exec(`INSERT INTO user_exercise_logs (id, user_id, calories_burned, recorded_on) VALUES (?, ?, ?, ?)`,
		"ex1", "user-1", 300, "2024-06-15")
	db.Exec(`INSERT INTO user_exercise_logs (id, user_id, calories_burned, recorded_on) VALUES (?, ?, ?, ?)`,
		"ex2", "user-1", 200, "2024-06-15")

	total, err := repo.GetExerciseBurned(ctx, "user-1", "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, 500, total)
}

func TestHomeRepo_ListRecordComments(t *testing.T) {
	db := setupHomeTestDB(t)
	repo := NewHomeRepo(db)
	ctx := context.Background()

	now := time.Now()
	db.Exec(`INSERT INTO feed_comments (id, user_id, record_id, created_at) VALUES (?, ?, ?, ?)`,
		"c1", "user-1", "r1", now)

	comments, err := repo.ListRecordComments(ctx, "r1")
	require.NoError(t, err)
	assert.Len(t, comments, 1)
}

func TestHomeRepo_DeleteCommentCascade(t *testing.T) {
	db := setupHomeTestDB(t)
	repo := NewHomeRepo(db)
	ctx := context.Background()

	now := time.Now()
	db.Exec(`INSERT INTO feed_comments (id, user_id, record_id, parent_comment_id, created_at) VALUES (?, ?, ?, ?, ?)`,
		"c1", "user-1", "r1", nil, now)
	db.Exec(`INSERT INTO feed_comments (id, user_id, record_id, parent_comment_id, created_at) VALUES (?, ?, ?, ?, ?)`,
		"c2", "user-1", "r1", "c1", now)

	affected, err := repo.DeleteCommentCascade(ctx, "r1", "c1")
	require.NoError(t, err)
	assert.Equal(t, int64(2), affected)
}
