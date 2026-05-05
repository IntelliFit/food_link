package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/analyze/domain"

	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&domain.AnalysisTask{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestTaskRepo_CreateAndGet(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()

	task := &domain.AnalysisTask{
		UserID:   "u1",
		TaskType: "food",
		Status:   "pending",
		Payload:  map[string]any{"key": "value"},
	}
	assert.NoError(t, r.CreateTask(ctx, task))
	assert.NotEmpty(t, task.ID)

	got, err := r.GetTaskByID(ctx, task.ID)
	assert.NoError(t, err)
	assert.NotNil(t, got)
	assert.Equal(t, "u1", got.UserID)
	assert.Equal(t, "pending", got.Status)
}

func TestTaskRepo_GetNotFound(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()

	got, err := r.GetTaskByID(ctx, "non-existent")
	assert.NoError(t, err)
	assert.Nil(t, got)
}

func TestTaskRepo_ListTasksByUser(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()

	_ = r.CreateTask(ctx, &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "pending"})
	_ = r.CreateTask(ctx, &domain.AnalysisTask{UserID: "u1", TaskType: "food_text", Status: "done"})
	_ = r.CreateTask(ctx, &domain.AnalysisTask{UserID: "u2", TaskType: "food", Status: "pending"})

	tasks, err := r.ListTasksByUser(ctx, "u1", "", "", 10)
	assert.NoError(t, err)
	assert.Len(t, tasks, 2)

	tasks, err = r.ListTasksByUser(ctx, "u1", "food", "", 10)
	assert.NoError(t, err)
	assert.Len(t, tasks, 1)
}

func TestTaskRepo_CountTasksByUser(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()

	_ = r.CreateTask(ctx, &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "pending"})
	_ = r.CreateTask(ctx, &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "done"})

	count, err := r.CountTasksByUser(ctx, "u1")
	assert.NoError(t, err)
	assert.Equal(t, int64(2), count)
}

func TestTaskRepo_CountTasksByStatus(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()

	_ = r.CreateTask(ctx, &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "pending"})
	_ = r.CreateTask(ctx, &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "done"})
	_ = r.CreateTask(ctx, &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "done"})

	counts, err := r.CountTasksByStatus(ctx, "u1")
	assert.NoError(t, err)
	assert.Equal(t, int64(1), counts["pending"])
	assert.Equal(t, int64(2), counts["done"])
}

func TestTaskRepo_UpdateTaskResult(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()

	task := &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "pending"}
	_ = r.CreateTask(ctx, task)

	result := map[string]any{"description": "test"}
	assert.NoError(t, r.UpdateTaskResult(ctx, task.ID, result))

	got, _ := r.GetTaskByID(ctx, task.ID)
	assert.NotNil(t, got.Result)
}

func TestTaskRepo_UpdateTaskStatus(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()

	task := &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "pending"}
	_ = r.CreateTask(ctx, task)

	msg := "error"
	assert.NoError(t, r.UpdateTaskStatus(ctx, task.ID, "failed", &msg))

	got, _ := r.GetTaskByID(ctx, task.ID)
	assert.Equal(t, "failed", got.Status)
	assert.NotNil(t, got.ErrorMessage)
	assert.Equal(t, "error", *got.ErrorMessage)
}

func TestTaskRepo_DeleteTask(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()

	task := &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "pending"}
	_ = r.CreateTask(ctx, task)

	assert.NoError(t, r.DeleteTask(ctx, task.ID, "u1"))
	got, _ := r.GetTaskByID(ctx, task.ID)
	assert.Nil(t, got)
}

func TestTaskRepo_MarkTimedOutTasks(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()

	oldTime := time.Now().Add(-10 * time.Minute)
	db.Exec("INSERT INTO analysis_tasks (id, user_id, task_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		"t1", "u1", "food", "pending", oldTime, oldTime)

	affected, err := r.MarkTimedOutTasks(ctx, 5)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), affected)

	got, _ := r.GetTaskByID(ctx, "t1")
	assert.Equal(t, "timed_out", got.Status)
}
