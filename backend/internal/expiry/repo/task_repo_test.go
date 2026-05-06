package repo

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupExpiryTaskTestDB(t *testing.T) *gorm.DB {
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

func TestTaskRepo_CreateExpiryRecognizeTask(t *testing.T) {
	db := setupExpiryTaskTestDB(t)
	repo := NewTaskRepo(db)
	ctx := context.Background()

	imageURLs := []string{"https://example.com/image.jpg"}
	task, err := repo.CreateExpiryRecognizeTask(ctx, "user-1", imageURLs)
	require.NoError(t, err)
	require.NotNil(t, task)
	assert.NotEmpty(t, task.ID)
	assert.Equal(t, "user-1", task.UserID)
	assert.Equal(t, "expiry_recognize", task.TaskType)
	assert.Equal(t, "pending", task.Status)
	require.NotNil(t, task.ImageURL)
	assert.Equal(t, "https://example.com/image.jpg", *task.ImageURL)
}

func TestTaskRepo_CreateExpiryRecognizeTask_EmptyImages(t *testing.T) {
	db := setupExpiryTaskTestDB(t)
	repo := NewTaskRepo(db)
	ctx := context.Background()

	task, err := repo.CreateExpiryRecognizeTask(ctx, "user-1", []string{})
	require.NoError(t, err)
	require.NotNil(t, task)
	assert.Nil(t, task.ImageURL)
	assert.Empty(t, task.ImagePaths)
}

func TestTaskRepo_CreateExpiryRecognizeTask_MultipleImages(t *testing.T) {
	db := setupExpiryTaskTestDB(t)
	repo := NewTaskRepo(db)
	ctx := context.Background()

	imageURLs := []string{"https://example.com/1.jpg", "https://example.com/2.jpg"}
	task, err := repo.CreateExpiryRecognizeTask(ctx, "user-1", imageURLs)
	require.NoError(t, err)
	require.NotNil(t, task)
	require.NotNil(t, task.ImageURL)
	assert.Equal(t, "https://example.com/1.jpg", *task.ImageURL)
	assert.Len(t, task.ImagePaths, 2)
}
