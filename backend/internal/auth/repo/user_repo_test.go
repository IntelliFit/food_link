package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupUserTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)
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
		last_seen_analyze_history_at TIMESTAMP,
		registration_invite_code TEXT,
		referred_by_user_id TEXT,
		points_balance REAL,
		health_disclaimer_acknowledged_at TIMESTAMP,
		motto TEXT,
		cover_image TEXT
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

func TestUserRepo_DeleteByIDCleansOwnedPublicContent(t *testing.T) {
	db := setupUserTestDB(t)
	repo := NewUserRepo(db)
	ctx := context.Background()
	now := time.Now()
	userID := "user-delete-cascade"
	otherUserID := "other-user"
	require.NoError(t, repo.Create(ctx, &User{ID: userID, OpenID: "openid-delete", Nickname: "DeleteMe", CreatedAt: &now}))
	require.NoError(t, repo.Create(ctx, &User{ID: otherUserID, OpenID: "openid-other", Nickname: "Other", CreatedAt: &now}))

	exec := func(sql string, args ...any) {
		require.NoError(t, db.Exec(sql, args...).Error)
	}
	exec(`CREATE TABLE user_exercise_logs (id TEXT PRIMARY KEY, user_id TEXT)`)
	exec(`CREATE TABLE user_circle_posts (id TEXT PRIMARY KEY, user_id TEXT)`)
	exec(`CREATE TABLE feed_likes (id TEXT PRIMARY KEY, user_id TEXT, target_type TEXT, target_id TEXT)`)
	exec(`CREATE TABLE feed_comments (id TEXT PRIMARY KEY, user_id TEXT, reply_to_user_id TEXT, target_type TEXT, target_id TEXT)`)
	exec(`CREATE TABLE feed_interaction_notifications (id TEXT PRIMARY KEY, recipient_user_id TEXT, actor_user_id TEXT, target_type TEXT, target_id TEXT)`)
	exec(`CREATE TABLE feed_reports (id TEXT PRIMARY KEY, reporter_user_id TEXT, reported_user_id TEXT, target_type TEXT, target_id TEXT)`)
	exec(`CREATE TABLE public_food_library (id TEXT PRIMARY KEY, user_id TEXT)`)
	exec(`CREATE TABLE public_food_library_collections (id TEXT PRIMARY KEY, user_id TEXT, library_item_id TEXT)`)
	exec(`CREATE TABLE user_recipes (id TEXT PRIMARY KEY, user_id TEXT)`)

	exec(`INSERT INTO user_food_records (id, user_id, record_time, total_calories) VALUES (?, ?, ?, ?)`, "food-1", userID, now, 100)
	exec(`INSERT INTO user_exercise_logs (id, user_id) VALUES (?, ?)`, "exercise-1", userID)
	exec(`INSERT INTO user_circle_posts (id, user_id) VALUES (?, ?)`, "post-1", userID)
	exec(`INSERT INTO public_food_library (id, user_id) VALUES (?, ?)`, "public-food-1", userID)
	exec(`INSERT INTO public_food_library_collections (id, user_id, library_item_id) VALUES (?, ?, ?)`, "coll-1", otherUserID, "public-food-1")
	exec(`INSERT INTO user_recipes (id, user_id) VALUES (?, ?)`, "recipe-1", userID)
	exec(`INSERT INTO feed_likes (id, user_id, target_type, target_id) VALUES (?, ?, ?, ?)`, "like-1", otherUserID, "food_record", "food-1")
	exec(`INSERT INTO feed_comments (id, user_id, reply_to_user_id, target_type, target_id) VALUES (?, ?, ?, ?, ?)`, "comment-1", otherUserID, userID, "circle_post", "post-1")
	exec(`INSERT INTO feed_interaction_notifications (id, recipient_user_id, actor_user_id, target_type, target_id) VALUES (?, ?, ?, ?, ?)`, "notice-1", otherUserID, userID, "exercise_log", "exercise-1")
	exec(`INSERT INTO feed_reports (id, reporter_user_id, reported_user_id, target_type, target_id) VALUES (?, ?, ?, ?, ?)`, "report-1", otherUserID, userID, "campus_food", "public-food-1")

	require.NoError(t, repo.DeleteByID(ctx, userID))

	assert.Equal(t, int64(0), countTableRows(t, db, "weapp_user", "id = ?", userID))
	assert.Equal(t, int64(0), countTableRows(t, db, "user_food_records", "user_id = ?", userID))
	assert.Equal(t, int64(0), countTableRows(t, db, "user_exercise_logs", "user_id = ?", userID))
	assert.Equal(t, int64(0), countTableRows(t, db, "user_circle_posts", "user_id = ?", userID))
	assert.Equal(t, int64(0), countTableRows(t, db, "public_food_library", "user_id = ?", userID))
	assert.Equal(t, int64(0), countTableRows(t, db, "public_food_library_collections", "library_item_id = ?", "public-food-1"))
	assert.Equal(t, int64(0), countTableRows(t, db, "user_recipes", "user_id = ?", userID))
	assert.Equal(t, int64(0), countTableRows(t, db, "feed_likes", "target_id = ?", "food-1"))
	assert.Equal(t, int64(0), countTableRows(t, db, "feed_comments", "reply_to_user_id = ? OR target_id = ?", userID, "post-1"))
	assert.Equal(t, int64(0), countTableRows(t, db, "feed_interaction_notifications", "actor_user_id = ? OR target_id = ?", userID, "exercise-1"))
	assert.Equal(t, int64(0), countTableRows(t, db, "feed_reports", "reported_user_id = ? OR target_id = ?", userID, "public-food-1"))
	assert.Equal(t, int64(1), countTableRows(t, db, "weapp_user", "id = ?", otherUserID))
}

func countTableRows(t *testing.T, db *gorm.DB, table, where string, args ...any) int64 {
	t.Helper()
	var count int64
	require.NoError(t, db.Table(table).Where(where, args...).Count(&count).Error)
	return count
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
