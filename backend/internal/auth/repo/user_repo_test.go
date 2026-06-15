package repo

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupUserTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	db.Exec(`CREATE TABLE weapp_user (
		id TEXT PRIMARY KEY,
		openid TEXT,
		unionid TEXT,
		app_openid TEXT,
		app_unionid TEXT,
		username TEXT,
		password_hash TEXT,
		password_set_at TIMESTAMP,
		last_login_method TEXT,
		last_login_at TIMESTAMP,
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
		last_seen_analyze_history_at TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE user_trial_entitlements (
		id TEXT PRIMARY KEY,
		first_user_id TEXT,
		openid TEXT,
		unionid TEXT,
		first_registered_at TIMESTAMP,
		early_user_rank INTEGER,
		trial_days_total INTEGER,
		trial_policy TEXT,
		created_at TIMESTAMP,
		updated_at TIMESTAMP
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

func TestUserRepo_FindByOpenID(t *testing.T) {
	db := setupUserTestDB(t)
	repo := NewUserRepo(db)
	ctx := context.Background()

	// Not found
	user, err := repo.FindByOpenID(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, user)

	// Create user
	now := time.Now()
	openID := "openid-test"
	err = repo.Create(ctx, &User{OpenID: openID, Nickname: "test", CreatedAt: &now})
	require.NoError(t, err)

	// Found
	user, err = repo.FindByOpenID(ctx, openID)
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "test", user.Nickname)
}

func TestUserRepo_FindByAppOpenIDAndUsername(t *testing.T) {
	db := setupUserTestDB(t)
	repo := NewUserRepo(db)
	ctx := context.Background()

	appOpenID := "app-openid-1"
	appUnionID := "app-unionid-1"
	username := "mobile.user"
	err := repo.Create(ctx, &User{
		OpenID:     "app-wx:" + appOpenID,
		AppOpenID:  &appOpenID,
		AppUnionID: &appUnionID,
		UnionID:    &appUnionID,
		Username:   &username,
		Nickname:   "App User",
	})
	require.NoError(t, err)

	byAppOpenID, err := repo.FindByAppOpenID(ctx, appOpenID)
	require.NoError(t, err)
	require.NotNil(t, byAppOpenID)
	assert.Equal(t, "App User", byAppOpenID.Nickname)

	byUnionID, err := repo.FindByUnionID(ctx, appUnionID)
	require.NoError(t, err)
	require.NotNil(t, byUnionID)
	assert.Equal(t, byAppOpenID.ID, byUnionID.ID)

	byUsername, err := repo.FindByUsername(ctx, "MOBILE.USER")
	require.NoError(t, err)
	require.NotNil(t, byUsername)
	assert.Equal(t, byAppOpenID.ID, byUsername.ID)
}

func TestUserRepo_FindByID(t *testing.T) {
	db := setupUserTestDB(t)
	repo := NewUserRepo(db)
	ctx := context.Background()

	// Not found
	user, err := repo.FindByID(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, user)

	// Create user
	now := time.Now()
	userID := "user-id-1"
	err = repo.Create(ctx, &User{ID: userID, OpenID: "openid-1", Nickname: "test", CreatedAt: &now})
	require.NoError(t, err)

	// Found
	user, err = repo.FindByID(ctx, userID)
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "test", user.Nickname)
}

func TestUserRepo_Create_AutoID(t *testing.T) {
	db := setupUserTestDB(t)
	repo := NewUserRepo(db)
	ctx := context.Background()

	user := &User{OpenID: "openid-auto", Nickname: "auto"}
	err := repo.Create(ctx, user)
	require.NoError(t, err)
	assert.NotEmpty(t, user.ID)
}

func TestUserRepo_UpdateFields(t *testing.T) {
	db := setupUserTestDB(t)
	repo := NewUserRepo(db)
	ctx := context.Background()

	now := time.Now()
	userID := "user-update"
	err := repo.Create(ctx, &User{ID: userID, OpenID: "openid", Nickname: "old", CreatedAt: &now})
	require.NoError(t, err)

	updated, err := repo.UpdateFields(ctx, userID, map[string]any{"nickname": "new"})
	require.NoError(t, err)
	require.NotNil(t, updated)
	assert.Equal(t, "new", updated.Nickname)
}

func TestUserRepo_ExchangeCode_EmptyCode(t *testing.T) {
	db := setupUserTestDB(t)
	repo := NewUserRepo(db)
	ctx := context.Background()

	_, _, err := repo.ExchangeCode(ctx, "appid", "secret", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "code 不能为空")
}

func TestUserRepo_UpdateLastSeenAnalyzeHistory(t *testing.T) {
	db := setupUserTestDB(t)
	repo := NewUserRepo(db)
	ctx := context.Background()

	now := time.Now()
	userID := "user-history"
	err := repo.Create(ctx, &User{ID: userID, OpenID: "openid", CreatedAt: &now})
	require.NoError(t, err)

	err = repo.UpdateLastSeenAnalyzeHistory(ctx, userID)
	require.NoError(t, err)
}

func TestUserRepo_CountFoodRecordDays(t *testing.T) {
	db := setupUserTestDB(t)
	repo := NewUserRepo(db)
	ctx := context.Background()

	userID := "user-count"
	now := time.Now()
	err := repo.Create(ctx, &User{ID: userID, OpenID: "openid", CreatedAt: &now})
	require.NoError(t, err)

	// Insert food records
	db.Exec(`INSERT INTO user_food_records (id, user_id, record_time, total_calories) VALUES (?, ?, ?, ?)`,
		"r1", userID, now, 100)

	count, err := repo.CountFoodRecordDays(ctx, userID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)
}

func TestUserRepo_TrialEntitlementCRUD(t *testing.T) {
	db := setupUserTestDB(t)
	repo := NewUserRepo(db)
	ctx := context.Background()
	now := time.Now()
	firstUserID := "user-trial-1"
	unionID := "union-trial-1"

	ent := &UserTrialEntitlement{
		FirstUserID:       &firstUserID,
		OpenID:            "openid-trial-1",
		UnionID:           &unionID,
		FirstRegisteredAt: &now,
		TrialDaysTotal:    30,
		TrialPolicy:       "early_first_1000",
	}
	err := repo.CreateTrialEntitlement(ctx, ent)
	require.NoError(t, err)
	require.NotEmpty(t, ent.ID)

	found, err := repo.FindTrialEntitlementByIdentity(ctx, "openid-trial-1", "")
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "early_first_1000", found.TrialPolicy)

	foundByUnion, err := repo.FindTrialEntitlementByIdentity(ctx, "other-openid", unionID)
	require.NoError(t, err)
	require.NotNil(t, foundByUnion)
	assert.Equal(t, ent.ID, foundByUnion.ID)

	updated, err := repo.UpdateTrialEntitlement(ctx, ent.ID, map[string]any{"first_user_id": "user-trial-2"})
	require.NoError(t, err)
	require.NotNil(t, updated)
	require.NotNil(t, updated.FirstUserID)
	assert.Equal(t, "user-trial-2", *updated.FirstUserID)
}
