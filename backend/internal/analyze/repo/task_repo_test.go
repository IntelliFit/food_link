package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/analyze/domain"

	"github.com/stretchr/testify/assert"
	gormsqlite "gorm.io/driver/sqlite"
	"gorm.io/gorm"

	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(gormsqlite.New(gormsqlite.Config{
		DriverName: "sqlite",
		DSN:        ":memory:",
	}), &gorm.Config{})
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

func TestTaskRepo_ClaimTaskByIDCreatesAttemptLease(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()
	now := time.Now()
	task := &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "pending", CreatedAt: &now, UpdatedAt: &now}
	assert.NoError(t, r.CreateTask(ctx, task))

	claim, err := r.ClaimTaskByID(ctx, ClaimTaskOptions{
		TaskID:        task.ID,
		TaskTypes:     []string{"food"},
		WorkerID:      "worker-a",
		LeaseDuration: time.Minute,
		Now:           now,
	})

	assert.NoError(t, err)
	assert.Equal(t, ClaimOutcomeClaimed, claim.Outcome)
	assert.NotNil(t, claim.Task)
	assert.Equal(t, "processing", claim.Task.Status)
	assert.NotNil(t, claim.Task.WorkerID)
	assert.Equal(t, "worker-a", *claim.Task.WorkerID)
	assert.NotNil(t, claim.Task.AttemptID)
	assert.Equal(t, 1, claim.Task.AttemptCount)
	assert.NotNil(t, claim.Task.LeaseUntil)
	assert.True(t, claim.Task.LeaseUntil.After(now))
}

func TestTaskRepo_ClaimTaskByIDSkipsActiveLeaseAndReclaimsExpired(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()
	now := time.Now()
	activeLease := now.Add(time.Minute)
	task := &domain.AnalysisTask{
		UserID:       "u1",
		TaskType:     "food",
		Status:       "processing",
		WorkerID:     strPtr("worker-a"),
		AttemptID:    strPtr("attempt-a"),
		AttemptCount: 1,
		LeaseUntil:   &activeLease,
		CreatedAt:    &now,
		UpdatedAt:    &now,
	}
	assert.NoError(t, r.CreateTask(ctx, task))

	active, err := r.ClaimTaskByID(ctx, ClaimTaskOptions{
		TaskID:        task.ID,
		TaskTypes:     []string{"food"},
		WorkerID:      "worker-b",
		LeaseDuration: time.Minute,
		Now:           now,
	})
	assert.NoError(t, err)
	assert.Equal(t, ClaimOutcomeLeaseActive, active.Outcome)

	expiredNow := activeLease.Add(time.Second)
	reclaimed, err := r.ClaimTaskByID(ctx, ClaimTaskOptions{
		TaskID:        task.ID,
		TaskTypes:     []string{"food"},
		WorkerID:      "worker-b",
		LeaseDuration: time.Minute,
		Now:           expiredNow,
	})
	assert.NoError(t, err)
	assert.Equal(t, ClaimOutcomeClaimed, reclaimed.Outcome)
	assert.NotNil(t, reclaimed.Task)
	assert.NotNil(t, reclaimed.Task.WorkerID)
	assert.Equal(t, "worker-b", *reclaimed.Task.WorkerID)
	assert.NotNil(t, reclaimed.Task.AttemptID)
	assert.NotEqual(t, "attempt-a", *reclaimed.Task.AttemptID)
	assert.Equal(t, 2, reclaimed.Task.AttemptCount)
}

func TestTaskRepo_CompleteTaskAttemptRequiresCurrentAttempt(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()
	now := time.Now()
	task := &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "pending", CreatedAt: &now, UpdatedAt: &now}
	assert.NoError(t, r.CreateTask(ctx, task))
	claim, err := r.ClaimTaskByID(ctx, ClaimTaskOptions{
		TaskID:        task.ID,
		TaskTypes:     []string{"food"},
		WorkerID:      "worker-a",
		LeaseDuration: time.Minute,
		Now:           now,
	})
	assert.NoError(t, err)
	assert.Equal(t, ClaimOutcomeClaimed, claim.Outcome)
	assert.NotNil(t, claim.Task.AttemptID)

	ok, err := r.CompleteTaskAttempt(ctx, task.ID, "wrong-attempt", map[string]any{"ok": false})
	assert.NoError(t, err)
	assert.False(t, ok)
	got, err := r.GetTaskByID(ctx, task.ID)
	assert.NoError(t, err)
	assert.Equal(t, "processing", got.Status)

	ok, err = r.CompleteTaskAttempt(ctx, task.ID, *claim.Task.AttemptID, map[string]any{"ok": true})
	assert.NoError(t, err)
	assert.True(t, ok)
	got, err = r.GetTaskByID(ctx, task.ID)
	assert.NoError(t, err)
	assert.Equal(t, "done", got.Status)
}

func TestTaskRepo_ListTasksByUser(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()

	_ = r.CreateTask(ctx, &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "pending"})
	_ = r.CreateTask(ctx, &domain.AnalysisTask{UserID: "u1", TaskType: "food_text", Status: "done"})
	_ = r.CreateTask(ctx, &domain.AnalysisTask{UserID: "u2", TaskType: "food", Status: "pending"})

	tasks, err := r.ListTasksByUser(ctx, "u1", "", "", "", 10)
	assert.NoError(t, err)
	assert.Len(t, tasks, 2)

	tasks, err = r.ListTasksByUser(ctx, "u1", "food", "", "", 10)
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

func TestTaskRepo_CountUnrecordedDoneTasksSince(t *testing.T) {
	db := setupTestDB(t)
	r := NewTaskRepo(db)
	ctx := context.Background()
	requireNoError := func(err error) {
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	requireNoError(db.Exec(`CREATE TABLE user_food_records (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		source_task_id TEXT
	)`).Error)
	now := time.Now()
	recentCreatedAt := now.Add(-2 * time.Hour)
	oldCreatedAt := now.Add(-25 * time.Hour)

	recentWaiting := &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "done", CreatedAt: &recentCreatedAt}
	oldWaiting := &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "done", CreatedAt: &oldCreatedAt}
	recentRecorded := &domain.AnalysisTask{UserID: "u1", TaskType: "food_text", Status: "done", CreatedAt: &recentCreatedAt}
	recentPending := &domain.AnalysisTask{UserID: "u1", TaskType: "food", Status: "pending", CreatedAt: &recentCreatedAt}
	otherUser := &domain.AnalysisTask{UserID: "u2", TaskType: "food", Status: "done", CreatedAt: &recentCreatedAt}
	requireNoError(r.CreateTask(ctx, recentWaiting))
	requireNoError(r.CreateTask(ctx, oldWaiting))
	requireNoError(r.CreateTask(ctx, recentRecorded))
	requireNoError(r.CreateTask(ctx, recentPending))
	requireNoError(r.CreateTask(ctx, otherUser))
	requireNoError(db.Exec(`INSERT INTO user_food_records (id, user_id, source_task_id) VALUES (?, ?, ?)`, "record1", "u1", recentRecorded.ID).Error)

	count, err := r.CountUnrecordedDoneTasksSince(ctx, "u1", now.Add(-24*time.Hour))
	assert.NoError(t, err)
	assert.Equal(t, int64(1), count)
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

func strPtr(value string) *string {
	return &value
}
