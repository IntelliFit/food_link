package service

import (
	"context"
	"testing"

	"food_link/backend/internal/user/domain"
	"food_link/backend/internal/user/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

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

func TestAnalysisTaskService_CreateHealthReportTaskNormalizesLegacyURL(t *testing.T) {
	db, taskRepo := setupAnalysisTaskTestDB(t)
	storageClient := storage.New(config.StorageConfig{
		CDNHealthReportsBaseURL: "https://cdn.example.com/health",
		COSHealthReportsBucket:  "health-reports-1370036754",
		COSRegion:               "ap-shanghai",
	})
	svc := NewAnalysisTaskService(taskRepo, storageClient)
	ctx := context.Background()

	legacyURL := "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/health-reports/u1/report.jpg"
	taskID, err := svc.CreateHealthReportTask(ctx, "user-1", CreateHealthReportTaskInput{ImageURL: legacyURL})
	require.NoError(t, err)

	var task domain.AnalysisTask
	require.NoError(t, db.First(&task, "id = ?", taskID).Error)
	require.NotNil(t, task.ImageURL)
	assert.Equal(t, "https://cdn.example.com/health/u1/report.jpg", *task.ImageURL)
}
