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

func setupAnalysisTaskTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	db.Exec(`CREATE TABLE analysis_tasks (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		task_type TEXT,
		status TEXT,
		image_url TEXT,
		image_paths TEXT,
		text_input TEXT,
		payload TEXT,
		result TEXT,
		error_message TEXT,
		created_at TIMESTAMP,
		updated_at TIMESTAMP
	)`)
	return db
}

func TestAnalysisTaskRepo_GetImagePathsByID(t *testing.T) {
	db := setupAnalysisTaskTestDB(t)
	repo := NewAnalysisTaskRepo(db)
	ctx := context.Background()

	// Not found
	paths, err := repo.GetImagePathsByID(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, paths)

	// With image_paths
	now := time.Now()
	imagePaths := `["https://example.com/1.jpg", "https://example.com/2.jpg"]`
	db.Exec(`INSERT INTO analysis_tasks (id, user_id, task_type, status, image_paths, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"task-1", "user-1", "food", "done", imagePaths, now)

	paths, err = repo.GetImagePathsByID(ctx, "task-1")
	require.NoError(t, err)
	assert.Len(t, paths, 2)

	// With image_url only
	imageURL := "https://example.com/single.jpg"
	db.Exec(`INSERT INTO analysis_tasks (id, user_id, task_type, status, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"task-2", "user-1", "food", "done", imageURL, now)

	paths, err = repo.GetImagePathsByID(ctx, "task-2")
	require.NoError(t, err)
	assert.Len(t, paths, 1)
	assert.Equal(t, "https://example.com/single.jpg", paths[0])
}

func TestAnalysisTaskRepo_GetImagePathsByIDs(t *testing.T) {
	db := setupAnalysisTaskTestDB(t)
	repo := NewAnalysisTaskRepo(db)
	ctx := context.Background()

	// Empty input
	paths, err := repo.GetImagePathsByIDs(ctx, []string{})
	require.NoError(t, err)
	assert.Nil(t, paths)

	// With tasks
	now := time.Now()
	imagePaths := `["https://example.com/1.jpg"]`
	db.Exec(`INSERT INTO analysis_tasks (id, user_id, task_type, status, image_paths, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		"task-1", "user-1", "food", "done", imagePaths, now)

	paths, err = repo.GetImagePathsByIDs(ctx, []string{"task-1"})
	require.NoError(t, err)
	assert.Len(t, paths, 1)
	assert.Len(t, paths["task-1"], 1)
}

func TestAnalysisTaskRepo_GetByID(t *testing.T) {
	db := setupAnalysisTaskTestDB(t)
	repo := NewAnalysisTaskRepo(db)
	ctx := context.Background()

	// Not found
	task, err := repo.GetByID(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, task)

	// Found
	now := time.Now()
	db.Exec(`INSERT INTO analysis_tasks (id, user_id, task_type, status, created_at) VALUES (?, ?, ?, ?, ?)`,
		"task-1", "user-1", "food", "done", now)

	task, err = repo.GetByID(ctx, "task-1")
	require.NoError(t, err)
	require.NotNil(t, task)
	assert.Equal(t, "food", task.TaskType)
}
