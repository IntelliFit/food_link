package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/user/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupUserAnalysisTaskTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	db.Exec(`CREATE TABLE analysis_tasks (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		task_type TEXT,
		status TEXT,
		image_url TEXT,
		payload TEXT,
		create_time TIMESTAMP
	)`)
	return db
}

func TestAnalysisTaskRepo_Create(t *testing.T) {
	db := setupUserAnalysisTaskTestDB(t)
	repo := NewAnalysisTaskRepo(db)
	ctx := context.Background()

	now := time.Now()
	task := &domain.AnalysisTask{
		UserID:   "user-1",
		TaskType: "health_report",
		Status:   "pending",
		CreatedAt: &now,
	}
	err := repo.Create(ctx, task)
	require.NoError(t, err)
	assert.NotEmpty(t, task.ID)
}

func TestAnalysisTaskRepo_Create_WithID(t *testing.T) {
	db := setupUserAnalysisTaskTestDB(t)
	repo := NewAnalysisTaskRepo(db)
	ctx := context.Background()

	now := time.Now()
	task := &domain.AnalysisTask{
		ID:       "task-1",
		UserID:   "user-1",
		TaskType: "health_report",
		Status:   "pending",
		CreatedAt: &now,
	}
	err := repo.Create(ctx, task)
	require.NoError(t, err)
	assert.Equal(t, "task-1", task.ID)
}
