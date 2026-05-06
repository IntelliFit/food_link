package service

import (
	"context"
	"testing"

	"food_link/backend/internal/user/domain"
	"food_link/backend/internal/user/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupAnalysisTaskTestDB(t *testing.T) (*gorm.DB, *repo.AnalysisTaskRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.AnalysisTask{}))
	return db, repo.NewAnalysisTaskRepo(db)
}

func TestAnalysisTaskService_CreateHealthReportTask(t *testing.T) {
	_, taskRepo := setupAnalysisTaskTestDB(t)
	svc := NewAnalysisTaskService(taskRepo)
	ctx := context.Background()

	imageURL := "https://example.com/report.jpg"
	taskID, err := svc.CreateHealthReportTask(ctx, "user-1", CreateHealthReportTaskInput{ImageURL: imageURL})
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
}
