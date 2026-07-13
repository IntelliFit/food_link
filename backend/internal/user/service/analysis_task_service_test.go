package service

import (
	"context"
	"testing"

	"food_link/backend/internal/taskqueue"
	"food_link/backend/internal/user/domain"
	"food_link/backend/internal/user/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupAnalysisTaskTestDB(t *testing.T) (*gorm.DB, *repo.AnalysisTaskRepo) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&domain.AnalysisTask{}))
	require.NoError(t, db.Exec(`
		ALTER TABLE analysis_tasks
			ALTER COLUMN image_paths TYPE jsonb USING image_paths::jsonb,
			ALTER COLUMN payload TYPE jsonb USING payload::jsonb
	`).Error)
	return db, repo.NewAnalysisTaskRepo(db)
}

type recordingTaskPublisher struct {
	messages []taskqueue.TaskMessage
}

func (p *recordingTaskPublisher) PublishTask(ctx context.Context, msg taskqueue.TaskMessage) error {
	p.messages = append(p.messages, msg)
	return nil
}

func TestAnalysisTaskService_CreateHealthReportTask(t *testing.T) {
	db, taskRepo := setupAnalysisTaskTestDB(t)
	svc := NewAnalysisTaskService(taskRepo, nil)
	publisher := &recordingTaskPublisher{}
	svc.ConfigureTaskPublisher(publisher)
	ctx := context.Background()

	imageURL := "https://example.com/report.jpg"
	taskID, err := svc.CreateHealthReportTask(ctx, "user-1", CreateHealthReportTaskInput{ImageURL: imageURL})
	require.NoError(t, err)
	assert.NotEmpty(t, taskID)
	require.Len(t, publisher.messages, 1)
	assert.Equal(t, taskID, publisher.messages[0].TaskID)
	assert.Equal(t, "health_report", publisher.messages[0].TaskType)

	var task domain.AnalysisTask
	require.NoError(t, db.First(&task, "id = ?", taskID).Error)
	require.NotNil(t, task.ImageURL)
	assert.Equal(t, imageURL, *task.ImageURL)
	assert.Equal(t, []string{imageURL}, task.ImagePaths)
}

func TestAnalysisTaskService_CreateHealthReportTaskNormalizesLegacyURL(t *testing.T) {
	db, taskRepo := setupAnalysisTaskTestDB(t)
	storageClient := storage.New(config.StorageConfig{
		CDNHealthReportsBaseURL: "https://cdn.example.com/health",
		COSHealthReportsBucket:  "health-reports-1370036754",
		COSRegion:               "ap-shanghai",
	})
	svc := NewAnalysisTaskService(taskRepo, nil, storageClient)
	ctx := context.Background()

	legacyURL := "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/health-reports/u1/report.jpg"
	taskID, err := svc.CreateHealthReportTask(ctx, "user-1", CreateHealthReportTaskInput{ImageURL: legacyURL})
	require.NoError(t, err)

	var task domain.AnalysisTask
	require.NoError(t, db.First(&task, "id = ?", taskID).Error)
	require.NotNil(t, task.ImageURL)
	assert.Equal(t, "https://cdn.example.com/health/u1/report.jpg", *task.ImageURL)
	assert.Equal(t, []string{"https://cdn.example.com/health/u1/report.jpg"}, task.ImagePaths)
}

func TestAnalysisTaskService_CreateHealthReportTaskWithImageURLs(t *testing.T) {
	db, taskRepo := setupAnalysisTaskTestDB(t)
	svc := NewAnalysisTaskService(taskRepo, nil)
	ctx := context.Background()

	taskID, err := svc.CreateHealthReportTask(ctx, "user-1", CreateHealthReportTaskInput{
		ImageURLs: []string{
			"https://example.com/report-1.jpg",
			"https://example.com/report-2.jpg",
			"https://example.com/report-1.jpg",
		},
	})
	require.NoError(t, err)

	var task domain.AnalysisTask
	require.NoError(t, db.First(&task, "id = ?", taskID).Error)
	require.NotNil(t, task.ImageURL)
	assert.Equal(t, "https://example.com/report-1.jpg", *task.ImageURL)
	assert.Equal(t, []string{
		"https://example.com/report-1.jpg",
		"https://example.com/report-2.jpg",
	}, task.ImagePaths)
	assert.Equal(t, "https://example.com/report-1.jpg", task.Payload["image_url"])
	assert.ElementsMatch(t, []string{
		"https://example.com/report-1.jpg",
		"https://example.com/report-2.jpg",
	}, task.Payload["image_urls"])
}
