package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"food_link/backend/pkg/testdb"

	"gorm.io/gorm"
)

func setupExerciseTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`CREATE TABLE user_exercise_logs (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		exercise_desc TEXT,
		exercise_type TEXT,
		image_url TEXT,
		calories_burned REAL,
		duration_min INTEGER,
		recorded_on TIMESTAMP,
		recorded_at TIMESTAMP,
		ai_reasoning TEXT,
		exercise_items TEXT,
		hidden_from_feed BOOLEAN DEFAULT FALSE,
		created_at TIMESTAMP
	)`).Error)
	require.NoError(t, db.AutoMigrate(&domain.AnalysisTask{}))
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

	found, err := r.GetExerciseLogByID(ctx, "user-1", log.ID)
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "跑步30分钟", found.ExerciseDesc)

	deleted, err := r.DeleteExerciseLog(ctx, "user-1", log.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), deleted)
}

func TestExerciseRepo_ListAndDailyCaloriesUseDateColumnSemantics(t *testing.T) {
	db := setupExerciseTestDB(t)
	r := NewExerciseRepo(db)
	ctx := context.Background()

	now := time.Now().UTC()
	require.NoError(t, db.Exec(`INSERT INTO user_exercise_logs
		(id, user_id, exercise_desc, calories_burned, recorded_on, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		"ex-1", "user-1", "跑步30分钟", 300, "2024-06-15", now).Error)
	require.NoError(t, db.Exec(`INSERT INTO user_exercise_logs
		(id, user_id, exercise_desc, calories_burned, recorded_on, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		"ex-2", "user-1", "跳绳20分钟", 285, "2024-06-15", now.Add(time.Second)).Error)
	require.NoError(t, db.Exec(`INSERT INTO user_exercise_logs
		(id, user_id, exercise_desc, calories_burned, recorded_on, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		"ex-old", "user-1", "昨天的运动", 120, "2024-06-14", now).Error)

	logs, err := r.ListExerciseLogsByDate(ctx, "user-1", "2024-06-15", "2024-06-15")
	require.NoError(t, err)
	require.Len(t, logs, 2)
	assert.Equal(t, "跳绳20分钟", logs[0].ExerciseDesc)
	assert.Equal(t, "跑步30分钟", logs[1].ExerciseDesc)

	total, err := r.GetDailyCaloriesBurned(ctx, "user-1", "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, int64(585), total)
}

func TestExerciseRepo_CreateExerciseLog_NormalizesNilItems(t *testing.T) {
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
		// ExerciseItems 故意为 nil，应被归一化为空数组
	}

	err := r.CreateExerciseLog(ctx, log)
	require.NoError(t, err)
	assert.NotNil(t, log.ExerciseItems)
	assert.Empty(t, log.ExerciseItems)

	found, err := r.GetExerciseLogByID(ctx, "user-1", log.ID)
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "跑步30分钟", found.ExerciseDesc)
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
