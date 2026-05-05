package service

import (
	"context"
	"testing"

	"food_link/backend/internal/auth/repo"
	"food_link/backend/internal/user/domain"
	userrepo "food_link/backend/internal/user/repo"

	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	// Use raw SQL to create tables compatible with SQLite
	db.Exec(`CREATE TABLE weapp_user (
		id TEXT PRIMARY KEY,
		openid TEXT,
		unionid TEXT,
		nickname TEXT,
		avatar TEXT,
		telephone TEXT,
		diet_goal TEXT,
		health_condition TEXT,
		create_time TIMESTAMP,
		onboarding_completed BOOLEAN,
		height REAL,
		weight REAL,
		birthday TEXT,
		gender TEXT,
		activity_level TEXT,
		bmr REAL,
		tdee REAL,
		execution_mode TEXT,
		mode_set_by TEXT,
		mode_set_at TIMESTAMP,
		mode_reason TEXT,
		mode_commitment_days INTEGER,
		mode_switch_count_30d INTEGER,
		searchable BOOLEAN,
		public_records BOOLEAN,
		last_seen_analyze_history TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE user_health_documents (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		document_type TEXT,
		image_url TEXT,
		extracted_content TEXT,
		create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE user_mode_switch_logs (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		from_mode TEXT,
		to_mode TEXT,
		changed_by TEXT,
		reason_code TEXT,
		create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE analysis_tasks (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		task_type TEXT,
		status TEXT,
		image_url TEXT,
		payload TEXT,
		create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE user_food_records (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		record_time TIMESTAMP,
		total_calories REAL,
		total_protein REAL,
		total_carbs REAL,
		total_fat REAL
	)`)
	return db
}

func TestUserService_GetProfile(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1", Nickname: "Test"}
	_ = userRepo.Create(ctx, user)

	profile, err := svc.GetProfile(ctx, user.ID)
	assert.NoError(t, err)
	assert.Equal(t, "Test", profile["nickname"])
}

func TestUserService_GetProfile_NotFound(t *testing.T) {
	db := setupTestDB(t)
	svc := NewUserService(repo.NewUserRepo(db), userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db))
	ctx := context.Background()

	_, err := svc.GetProfile(ctx, "non-existent")
	assert.Error(t, err)
}

func TestUserService_UpdateProfile(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1", Nickname: "Old"}
	_ = userRepo.Create(ctx, user)

	nickname := "New"
	result, err := svc.UpdateProfile(ctx, user.ID, UpdateProfileInput{Nickname: &nickname})
	assert.NoError(t, err)
	assert.Equal(t, "New", result["nickname"])
}

func TestUserService_GetDashboardTargets(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	targets, err := svc.GetDashboardTargets(ctx, user.ID)
	assert.NoError(t, err)
	assert.Equal(t, 2000.0, targets["calorie_target"])
}

func TestUserService_GetHealthProfile(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo)
	ctx := context.Background()

	weight := 70.0
	user := &repo.User{OpenID: "o1", Weight: &weight}
	_ = userRepo.Create(ctx, user)

	profile, err := svc.GetHealthProfile(ctx, user.ID)
	assert.NoError(t, err)
	assert.Equal(t, &weight, profile["weight"])
}

func TestUserService_GetRecordDays(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	days, err := svc.GetRecordDays(ctx, user.ID)
	assert.NoError(t, err)
	assert.Equal(t, int64(0), days)
}

func TestUserService_UpdateLastSeenAnalyzeHistory(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	err := svc.UpdateLastSeenAnalyzeHistory(ctx, user.ID)
	assert.NoError(t, err)
}

func TestBuildDashboardTargets(t *testing.T) {
	user := &repo.User{OpenID: "o1"}
	targets := buildDashboardTargets(user)
	assert.Equal(t, 2000.0, targets["calorie_target"])
	assert.Equal(t, 120.0, targets["protein_target"])
	assert.Equal(t, 250.0, targets["carbs_target"])
	assert.Equal(t, 65.0, targets["fat_target"])

	tdee := 2200.0
	user.TDEE = &tdee
	targets = buildDashboardTargets(user)
	assert.Equal(t, 2200.0, targets["calorie_target"])
}

func TestNormalizeExecutionMode(t *testing.T) {
	mode := "strict"
	assert.Equal(t, "strict", normalizeExecutionMode(&mode))
	assert.Equal(t, "standard", normalizeExecutionMode(nil))
	invalid := "invalid"
	assert.Equal(t, "standard", normalizeExecutionMode(&invalid))
}

func TestBuildHealthProfileResponse(t *testing.T) {
	weight := 70.0
	user := &repo.User{OpenID: "o1", Weight: &weight}
	resp := buildHealthProfileResponse(user)
	assert.Equal(t, &weight, resp["weight"])
}

func TestBuildProfileResponse(t *testing.T) {
	user := &repo.User{OpenID: "o1", Nickname: "Test"}
	resp := buildProfileResponse(user)
	assert.Equal(t, "Test", resp["nickname"])
}

func TestUserService_CreateHealthReportTask(t *testing.T) {
	db := setupTestDB(t)
	taskRepo := userrepo.NewAnalysisTaskRepo(db)
	svc := NewAnalysisTaskService(taskRepo)
	ctx := context.Background()

	imageURL := "https://example.com/report.jpg"
	taskID, err := svc.CreateHealthReportTask(ctx, "user-1", CreateHealthReportTaskInput{ImageURL: imageURL})
	assert.NoError(t, err)
	assert.NotEmpty(t, taskID)

	var task domain.AnalysisTask
	db.First(&task)
	assert.Equal(t, "health_report", task.TaskType)
	assert.Equal(t, "pending", task.Status)
}
