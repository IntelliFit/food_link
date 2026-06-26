package service

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	. "github.com/agiledragon/gomonkey/v2"
	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"

	"food_link/backend/internal/auth/repo"
	"food_link/backend/internal/user/domain"
	userrepo "food_link/backend/internal/user/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"
	"food_link/backend/pkg/testdb"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)
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
		last_seen_analyze_history_at TIMESTAMP,
		registration_invite_code TEXT,
		referred_by_user_id TEXT,
		points_balance REAL,
		health_disclaimer_acknowledged_at TIMESTAMP,
		motto TEXT,
		cover_image TEXT
	)`)
	db.Exec(`CREATE TABLE user_daily_nutrition_targets (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		target_date TEXT,
		calorie_target REAL,
		protein_target REAL,
		carbs_target REAL,
		fat_target REAL,
		source TEXT,
		created_at TIMESTAMP,
		updated_at TIMESTAMP,
		UNIQUE(user_id, target_date)
	)`)
	db.Exec(`CREATE TABLE user_health_documents (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		document_type TEXT,
		image_url TEXT,
		extracted_content TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE user_mode_switch_logs (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		from_mode TEXT,
		to_mode TEXT,
		changed_by TEXT,
		reason_code TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE analysis_tasks (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		task_type TEXT,
		status TEXT,
		image_url TEXT,
		image_paths TEXT,
		payload TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1", Nickname: "Test"}
	_ = userRepo.Create(ctx, user)

	profile, err := svc.GetProfile(ctx, user.ID)
	assert.NoError(t, err)
	assert.Equal(t, "Test", profile["nickname"])
}

func TestUserService_ProfileAvatarUsesCDNForLegacySupabaseURL(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	storageClient := storage.New(config.StorageConfig{
		CDNUserAvatarsBaseURL: "https://cdn.example.com/avatar",
		COSUserAvatarsBucket:  "user-avatars-1370036754",
		COSRegion:             "ap-shanghai",
	})
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), storageClient)
	ctx := context.Background()

	legacyAvatar := "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/user-avatars/u1/avatar.jpg"
	user := &repo.User{OpenID: "o1", Nickname: "Test", Avatar: legacyAvatar}
	_ = userRepo.Create(ctx, user)

	profile, err := svc.GetProfile(ctx, user.ID)
	assert.NoError(t, err)
	assert.Equal(t, "https://cdn.example.com/avatar/u1/avatar.jpg", profile["avatar"])

	nextLegacyAvatar := "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/user-avatars/u1/next.jpg"
	updated, err := svc.UpdateProfile(ctx, user.ID, UpdateProfileInput{Avatar: &nextLegacyAvatar})
	assert.NoError(t, err)
	assert.Equal(t, "https://cdn.example.com/avatar/u1/next.jpg", updated["avatar"])

	found, err := userRepo.FindByID(ctx, user.ID)
	assert.NoError(t, err)
	assert.Equal(t, "https://cdn.example.com/avatar/u1/next.jpg", found.Avatar)
}

func TestUserService_GetProfile_NotFound(t *testing.T) {
	db := setupTestDB(t)
	svc := NewUserService(repo.NewUserRepo(db), userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	_, err := svc.GetProfile(ctx, "non-existent")
	assert.Error(t, err)
}

func TestUserService_GetProfile_Error(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(userRepo), "FindByID", func(_ *repo.UserRepo, _ context.Context, _ string) (*repo.User, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.GetProfile(ctx, "user-1")
	assert.Error(t, err)
}

func TestUserService_UpdateProfile(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo, nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1", Nickname: "Old"}
	_ = userRepo.Create(ctx, user)

	nickname := "New"
	result, err := svc.UpdateProfile(ctx, user.ID, UpdateProfileInput{Nickname: &nickname})
	assert.NoError(t, err)
	assert.Equal(t, "New", result["nickname"])
}

func TestUserService_UpdateProfile_NotFound(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(userRepo), "UpdateFields", func(_ *repo.UserRepo, _ context.Context, _ string, _ map[string]any) (*repo.User, error) {
		return nil, errors.New("not found")
	})
	defer patches.Reset()

	nickname := "New"
	_, err := svc.UpdateProfile(ctx, "nonexistent", UpdateProfileInput{Nickname: &nickname})
	assert.Error(t, err)
}

func TestUserService_UpdateProfile_EmptyUpdates(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1", Nickname: "Old"}
	_ = userRepo.Create(ctx, user)

	_, err := svc.UpdateProfile(ctx, user.ID, UpdateProfileInput{})
	assert.Error(t, err)
}

func TestUserService_UpdateProfile_UpdateFieldsError(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(userRepo), "UpdateFields", func(_ *repo.UserRepo, _ context.Context, _ string, _ map[string]any) (*repo.User, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	nickname := "New"
	_, err := svc.UpdateProfile(ctx, "user-1", UpdateProfileInput{Nickname: &nickname})
	assert.Error(t, err)
}

func TestUserService_GetDashboardTargets(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo, nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	targets, err := svc.GetDashboardTargets(ctx, user.ID)
	assert.NoError(t, err)
	assert.Equal(t, 2000.0, targets["calorie_target"])
}

func TestUserService_GetDashboardTargets_NotFound(t *testing.T) {
	db := setupTestDB(t)
	svc := NewUserService(repo.NewUserRepo(db), userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	_, err := svc.GetDashboardTargets(ctx, "nonexistent")
	assert.Error(t, err)
}

func TestUserService_GetDashboardTargets_Error(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(userRepo), "FindByID", func(_ *repo.UserRepo, _ context.Context, _ string) (*repo.User, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.GetDashboardTargets(ctx, "user-1")
	assert.Error(t, err)
}

func TestUserService_UpdateDashboardTargets(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	targets := map[string]any{
		"calorie_target": 1800.0,
		"protein_target": 100.0,
		"carbs_target":   200.0,
		"fat_target":     60.0,
	}
	patches := ApplyMethod(reflect.TypeOf(userRepo), "UpdateFields", func(_ *repo.UserRepo, _ context.Context, _ string, _ map[string]any) (*repo.User, error) {
		user.HealthCondition = map[string]any{"dashboard_targets": targets}
		return user, nil
	})
	defer patches.Reset()

	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo, nil)

	result, err := svc.UpdateDashboardTargets(ctx, user.ID, UpdateDashboardTargetsInput{CalorieTarget: 1800, ProteinTarget: 100, CarbsTarget: 200, FatTarget: 60})
	assert.NoError(t, err)
	assert.Equal(t, 1800.0, result["calorie_target"])
}

func TestUserService_UpdateDashboardTargets_WithTargetDateStillStoresLongTermTarget(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	result, err := svc.UpdateDashboardTargets(ctx, user.ID, UpdateDashboardTargetsInput{
		TargetDate:    "2026-05-19",
		CalorieTarget: 1800,
		ProteinTarget: 100,
		CarbsTarget:   200,
		FatTarget:     60,
	})
	assert.NoError(t, err)
	assert.Equal(t, 1800.0, result["calorie_target"])

	var count int64
	err = db.Table("user_daily_nutrition_targets").
		Where("user_id = ? AND target_date = ?", user.ID, "2026-05-19").
		Count(&count).Error
	assert.NoError(t, err)
	assert.Equal(t, int64(0), count)

	found, err := userRepo.FindByID(ctx, user.ID)
	assert.NoError(t, err)
	assert.Equal(t, "manual", found.HealthCondition["dashboard_targets_mode"])
	assert.NotEmpty(t, found.HealthCondition["dashboard_targets_updated_at"])
}

func TestUserService_UpdateDashboardTargets_NotFound(t *testing.T) {
	db := setupTestDB(t)
	svc := NewUserService(repo.NewUserRepo(db), userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	_, err := svc.UpdateDashboardTargets(ctx, "nonexistent", UpdateDashboardTargetsInput{CalorieTarget: 1800})
	assert.Error(t, err)
}

func TestUserService_UpdateDashboardTargets_UpdateError(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	patches := ApplyMethod(reflect.TypeOf(userRepo), "UpdateFields", func(_ *repo.UserRepo, _ context.Context, _ string, _ map[string]any) (*repo.User, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.UpdateDashboardTargets(ctx, user.ID, UpdateDashboardTargetsInput{CalorieTarget: 2200})
	assert.Error(t, err)
}

func TestUserService_GetHealthProfile(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo, nil)
	ctx := context.Background()

	weight := 70.0
	user := &repo.User{OpenID: "o1", Weight: &weight}
	_ = userRepo.Create(ctx, user)

	profile, err := svc.GetHealthProfile(ctx, user.ID)
	assert.NoError(t, err)
	assert.Equal(t, &weight, profile["weight"])
}

func TestUserService_GetHealthProfile_NotFound(t *testing.T) {
	db := setupTestDB(t)
	svc := NewUserService(repo.NewUserRepo(db), userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	_, err := svc.GetHealthProfile(ctx, "nonexistent")
	assert.Error(t, err)
}

func TestUserService_GetHealthProfile_Error(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(userRepo), "FindByID", func(_ *repo.UserRepo, _ context.Context, _ string) (*repo.User, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.GetHealthProfile(ctx, "user-1")
	assert.Error(t, err)
}

func TestUserService_UpdateHealthProfile(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo, nil)
	ctx := context.Background()

	gender := "male"
	user := &repo.User{OpenID: "o1", Gender: &gender}
	_ = userRepo.Create(ctx, user)

	height := 175.0
	weight := 70.0
	activity := "moderate"
	birthday := "1994-01-01"
	patches := ApplyMethod(reflect.TypeOf(userRepo), "UpdateFields", func(_ *repo.UserRepo, _ context.Context, _ string, updates map[string]any) (*repo.User, error) {
		if h, ok := updates["height"].(float64); ok {
			user.Height = &h
		}
		if w, ok := updates["weight"].(float64); ok {
			user.Weight = &w
		}
		if al, ok := updates["activity_level"].(string); ok {
			user.ActivityLevel = &al
		}
		if bmr, ok := updates["bmr"].(float64); ok {
			user.BMR = &bmr
		}
		if tdee, ok := updates["tdee"].(float64); ok {
			user.TDEE = &tdee
		}
		if hc, ok := updates["health_condition"].(map[string]any); ok {
			user.HealthCondition = hc
		}
		return user, nil
	})
	defer patches.Reset()

	result, err := svc.UpdateHealthProfile(ctx, user.ID, UpdateHealthProfileInput{
		Height:        &height,
		Weight:        &weight,
		ActivityLevel: &activity,
		Gender:        strPtr("male"),
		Birthday:      &birthday,
	})
	assert.NoError(t, err)
	assert.NotNil(t, result["bmr"])
	assert.NotNil(t, result["tdee"])
	hc := result["health_condition"].(map[string]any)
	assert.Equal(t, "system_initial", hc["dashboard_targets_mode"])
	targets := hc["dashboard_targets"].(map[string]float64)
	assert.Greater(t, targets["calorie_target"], 0.0)
}

func TestUserService_UpdateHealthProfile_ModeChange(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo, nil)
	ctx := context.Background()

	mode := "standard"
	user := &repo.User{OpenID: "o1", ExecutionMode: &mode}
	_ = userRepo.Create(ctx, user)

	newMode := "strict"
	patches := ApplyMethod(reflect.TypeOf(userRepo), "UpdateFields", func(_ *repo.UserRepo, _ context.Context, _ string, updates map[string]any) (*repo.User, error) {
		if m, ok := updates["execution_mode"].(string); ok {
			user.ExecutionMode = &m
		}
		return user, nil
	})
	defer patches.Reset()

	result, err := svc.UpdateHealthProfile(ctx, user.ID, UpdateHealthProfileInput{
		ExecutionMode: &newMode,
		ModeSetBy:     strPtr("user_manual"),
	})
	assert.NoError(t, err)
	assert.Equal(t, "strict", result["execution_mode"])
}

func TestUserService_UpdateHealthProfile_InvalidModeSetBy(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	mode := "standard"
	user := &repo.User{OpenID: "o1", ExecutionMode: &mode}
	_ = userRepo.Create(ctx, user)

	newMode := "strict"
	_, err := svc.UpdateHealthProfile(ctx, user.ID, UpdateHealthProfileInput{
		ExecutionMode: &newMode,
		ModeSetBy:     strPtr("invalid"),
	})
	assert.Error(t, err)
}

func TestUserService_UpdateHealthProfile_NotFound(t *testing.T) {
	db := setupTestDB(t)
	svc := NewUserService(repo.NewUserRepo(db), userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	_, err := svc.UpdateHealthProfile(ctx, "nonexistent", UpdateHealthProfileInput{})
	assert.Error(t, err)
}

func TestUserService_UpdateHealthProfile_EmptyUpdates(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	result, err := svc.UpdateHealthProfile(ctx, user.ID, UpdateHealthProfileInput{})
	assert.NoError(t, err)
	assert.NotNil(t, result)
	if v, ok := result["onboarding_completed"].(*bool); ok {
		assert.True(t, *v)
	} else {
		assert.True(t, result["onboarding_completed"].(bool))
	}
}

func TestUserService_UpdateHealthProfile_WithDashboardTargets(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	patches := ApplyMethod(reflect.TypeOf(userRepo), "UpdateFields", func(_ *repo.UserRepo, _ context.Context, _ string, updates map[string]any) (*repo.User, error) {
		user.HealthCondition = map[string]any{"dashboard_targets": map[string]any{"calorie_target": 1900.0}}
		return user, nil
	})
	defer patches.Reset()

	result, err := svc.UpdateHealthProfile(ctx, user.ID, UpdateHealthProfileInput{
		DashboardTargets: &UpdateDashboardTargetsInput{CalorieTarget: 1900, ProteinTarget: 110, CarbsTarget: 220, FatTarget: 55},
	})
	assert.NoError(t, err)
	assert.NotNil(t, result["health_condition"])
}

func TestUserService_UpdateHealthProfile_WithRoutineType(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	patches := ApplyMethod(reflect.TypeOf(userRepo), "UpdateFields", func(_ *repo.UserRepo, _ context.Context, _ string, updates map[string]any) (*repo.User, error) {
		user.HealthCondition = updates["health_condition"].(map[string]any)
		return user, nil
	})
	defer patches.Reset()

	routineType := "night_owl"
	result, err := svc.UpdateHealthProfile(ctx, user.ID, UpdateHealthProfileInput{
		RoutineType: &routineType,
	})
	assert.NoError(t, err)
	hc := result["health_condition"].(map[string]any)
	assert.Equal(t, "night_owl", hc["routine_type"])
}

func TestUserService_UpdateHealthProfile_WithReportExtract(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo, nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	patches := ApplyMethod(reflect.TypeOf(userRepo), "UpdateFields", func(_ *repo.UserRepo, _ context.Context, _ string, updates map[string]any) (*repo.User, error) {
		user.HealthCondition = map[string]any{"report_extract": map[string]any{"indicators": []any{}}}
		return user, nil
	})
	defer patches.Reset()

	result, err := svc.UpdateHealthProfile(ctx, user.ID, UpdateHealthProfileInput{
		ReportExtract: map[string]any{"indicators": []any{}},
	})
	assert.NoError(t, err)
	assert.NotNil(t, result["health_condition"])
}

func TestUserService_UpdateHealthProfile_UpdateFieldsError(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	patches := ApplyMethod(reflect.TypeOf(userRepo), "UpdateFields", func(_ *repo.UserRepo, _ context.Context, _ string, _ map[string]any) (*repo.User, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	gender := "male"
	_, err := svc.UpdateHealthProfile(ctx, user.ID, UpdateHealthProfileInput{Gender: &gender})
	assert.Error(t, err)
}

func TestUserService_UpdateHealthProfile_FindError(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(userRepo), "FindByID", func(_ *repo.UserRepo, _ context.Context, _ string) (*repo.User, error) {
		return nil, errors.New("db error")
	})
	defer patches.Reset()

	_, err := svc.UpdateHealthProfile(ctx, "user-1", UpdateHealthProfileInput{})
	assert.Error(t, err)
}

func TestUserService_UpdateHealthProfile_SameMode(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	mode := "strict"
	user := &repo.User{OpenID: "o1", ExecutionMode: &mode}
	_ = userRepo.Create(ctx, user)

	patches := ApplyMethod(reflect.TypeOf(userRepo), "UpdateFields", func(_ *repo.UserRepo, _ context.Context, _ string, updates map[string]any) (*repo.User, error) {
		if m, ok := updates["execution_mode"].(string); ok {
			user.ExecutionMode = &m
		}
		return user, nil
	})
	defer patches.Reset()

	newMode := "strict"
	_, err := svc.UpdateHealthProfile(ctx, user.ID, UpdateHealthProfileInput{ExecutionMode: &newMode})
	assert.NoError(t, err)
}

func TestUserService_GetRecordDays(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	healthDocRepo := userrepo.NewHealthDocumentRepo(db)
	modeSwitchRepo := userrepo.NewModeSwitchLogRepo(db)
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo, nil)
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
	svc := NewUserService(userRepo, healthDocRepo, modeSwitchRepo, nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	_ = userRepo.Create(ctx, user)

	err := svc.UpdateLastSeenAnalyzeHistory(ctx, user.ID)
	assert.NoError(t, err)
}

func TestUserService_DeleteAccount(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1", Nickname: "DeleteMe"}
	_ = userRepo.Create(ctx, user)

	err := svc.DeleteAccount(ctx, user.ID)
	assert.NoError(t, err)

	found, err := userRepo.FindByID(ctx, user.ID)
	assert.NoError(t, err)
	assert.Nil(t, found)
}

func TestUserService_DeleteAccount_NotFound(t *testing.T) {
	db := setupTestDB(t)
	userRepo := repo.NewUserRepo(db)
	svc := NewUserService(userRepo, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()

	err := svc.DeleteAccount(ctx, "missing-user")
	assert.Error(t, err)
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

func TestBuildDashboardTargets_WithDashboardTargets(t *testing.T) {
	healthCondition := map[string]any{
		"dashboard_targets": map[string]any{
			"calorie_target": 2100.0,
			"protein_target": 130.0,
			"carbs_target":   250.0,
			"fat_target":     65.0,
		},
	}
	user := &repo.User{OpenID: "o1", HealthCondition: healthCondition}
	targets := buildDashboardTargets(user)
	assert.Equal(t, 2100.0, targets["calorie_target"])
	assert.Equal(t, 130.0, targets["protein_target"])
	assert.Equal(t, 250.0, targets["carbs_target"])
	assert.Equal(t, 65.0, targets["fat_target"])
}

func TestCalculateStableNutritionTargets_HybridBMR(t *testing.T) {
	result := CalculateStableNutritionTargets(StableNutritionTargetInput{
		Gender:        "male",
		WeightKg:      70,
		HeightCm:      175,
		Birthday:      "1994-01-01",
		ActivityLevel: "moderate",
		DietGoal:      "fat_loss",
		Now:           time.Date(2026, 5, 23, 0, 0, 0, 0, time.UTC),
	})
	assert.Equal(t, 1578.2, result.BMR)
	assert.Equal(t, 2209.5, result.TDEE)
	assert.Equal(t, 1860.0, result.Targets["calorie_target"])
	assert.Greater(t, result.Targets["protein_target"], 0.0)
}

func TestNormalizeExecutionMode(t *testing.T) {
	mode := "strict"
	assert.Equal(t, "strict", normalizeExecutionMode(&mode))
	gemini35 := "gemini35_flash"
	assert.Equal(t, "gemini35_flash", normalizeExecutionMode(&gemini35))
	grouped := "gemini35_flash_grouped"
	assert.Equal(t, "gemini35_flash_grouped", normalizeExecutionMode(&grouped))
	fast := "fast"
	assert.Equal(t, "fast", normalizeExecutionMode(&fast))
	fastWeb := "fast_web_search"
	assert.Equal(t, "fast_web_search", normalizeExecutionMode(&fastWeb))
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
	svc := &UserService{}
	resp := svc.buildProfileResponse(user)
	assert.Equal(t, "Test", resp["nickname"])
}

func TestUserService_CreateHealthReportTask(t *testing.T) {
	db := setupTestDB(t)
	taskRepo := userrepo.NewAnalysisTaskRepo(db)
	svc := NewAnalysisTaskService(taskRepo, nil)
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

func TestUserService_CreateHealthReportTask_Error(t *testing.T) {
	db := setupTestDB(t)
	taskRepo := userrepo.NewAnalysisTaskRepo(db)
	svc := NewAnalysisTaskService(taskRepo, nil)
	ctx := context.Background()

	patches := ApplyMethod(reflect.TypeOf(taskRepo), "Create", func(_ *userrepo.AnalysisTaskRepo, _ context.Context, _ *domain.AnalysisTask) error {
		return errors.New("db error")
	})
	defer patches.Reset()

	imageURL := "https://example.com/report.jpg"
	_, err := svc.CreateHealthReportTask(ctx, "user-1", CreateHealthReportTaskInput{ImageURL: imageURL})
	assert.Error(t, err)
}

func strPtr(s string) *string {
	return &s
}
