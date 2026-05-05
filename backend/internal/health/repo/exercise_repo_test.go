package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupExerciseTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&domain.ExerciseLog{},
		&domain.AnalysisTask{},
	))
	return db
}

func TestExerciseRepo_CRUD(t *testing.T) {
	db := setupExerciseTestDB(t)
	r := NewExerciseRepo(db)
	ctx := context.Background()

	now := time.Now().UTC()
	recordedOn := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	calories := 300.0
	log := &domain.ExerciseLog{
		UserID:         "user-1",
		ExerciseDesc:   "跑步30分钟",
		CaloriesBurned: &calories,
		RecordedOn:     &recordedOn,
		CreatedAt:      &now,
	}

	err := r.CreateExerciseLog(ctx, log)
	require.NoError(t, err)
	assert.NotEmpty(t, log.ID)

	logs, err := r.ListExerciseLogsByDate(ctx, "user-1", "2024-06-15", "2024-06-15")
	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.Equal(t, "跑步30分钟", logs[0].ExerciseDesc)

	total, err := r.GetDailyCaloriesBurned(ctx, "user-1", "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, int64(300), total)

	deleted, err := r.DeleteExerciseLog(ctx, "user-1", log.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), deleted)
}

func TestExerciseRepo_CreateAnalysisTask(t *testing.T) {
	db := setupExerciseTestDB(t)
	r := NewExerciseRepo(db)
	ctx := context.Background()

	now := time.Now().UTC()
	textInput := "跑步30分钟"
	task := &domain.AnalysisTask{
		UserID:    "user-1",
		TaskType:  "exercise",
		Status:    "pending",
		TextInput: &textInput,
		CreatedAt: &now,
	}

	err := r.CreateAnalysisTask(ctx, task)
	require.NoError(t, err)
	assert.NotEmpty(t, task.ID)
}
