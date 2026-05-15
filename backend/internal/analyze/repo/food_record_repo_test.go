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

func setupFoodRecordTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	db.Exec(`CREATE TABLE user_food_records (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		source_task_id TEXT,
		record_time TIMESTAMP,
		total_calories REAL
	)`)
	return db
}

func TestFoodRecordRepo_GetSourceTaskIDByRecord(t *testing.T) {
	db := setupFoodRecordTestDB(t)
	repo := NewFoodRecordRepo(db)
	ctx := context.Background()

	// Insert record with source_task_id
	now := time.Now()
	sourceTaskID := "task-123"
	db.Exec(`INSERT INTO user_food_records (id, user_id, source_task_id, record_time) VALUES (?, ?, ?, ?)`,
		"record-1", "user-1", sourceTaskID, now)

	result, err := repo.GetSourceTaskIDByRecord(ctx, "record-1")
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "task-123", *result)

	// Record not found
	result, err = repo.GetSourceTaskIDByRecord(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, result)
}
