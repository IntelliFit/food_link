package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/membership/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&domain.MembershipPlan{},
		&domain.UserMembership{},
		&domain.MembershipPayment{},
		&domain.UserCreditBonusEvent{},
		&domain.UserEarnedCreditLedger{},
		&analysisTask{},
		&User{},
	))
	return db
}

func TestMembershipRepo_ListActivePlans(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.MembershipPlan{Code: "standard_monthly", Name: "标准版", IsActive: true, SortOrder: 1}).Error)
	require.NoError(t, db.Create(&domain.MembershipPlan{Code: "advanced_monthly", Name: "进阶版", IsActive: false, SortOrder: 2}).Error)

	plans, err := r.ListActivePlans(ctx)
	require.NoError(t, err)
	require.Len(t, plans, 1)
	assert.Equal(t, "standard_monthly", plans[0].Code)
}

func TestMembershipRepo_GetActiveMembershipExpiresStaleRow(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	past := time.Now().Add(-24 * time.Hour)
	code := "standard_monthly"
	require.NoError(t, db.Create(&domain.UserMembership{
		ID:              "um1",
		UserID:          "u1",
		CurrentPlanCode: &code,
		Status:          "active",
		ExpiresAt:       &past,
	}).Error)

	um, err := r.GetActiveMembership(ctx, "u1")
	require.NoError(t, err)
	assert.Nil(t, um)
	var row domain.UserMembership
	require.NoError(t, db.First(&row, "id = ?", "um1").Error)
	assert.Equal(t, "expired", row.Status)
}

func TestMembershipRepo_CreatePaymentAndLookupByOrderNo(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	p := &domain.MembershipPayment{
		UserID:         "u1",
		PlanCode:       "standard_monthly",
		OrderNo:        "PM202605080001",
		Amount:         99,
		Currency:       "CNY",
		DurationMonths: 1,
		Status:         "pending",
	}
	require.NoError(t, r.CreatePayment(ctx, p))
	assert.NotEmpty(t, p.ID)

	found, err := r.GetPaymentByOrderNo(ctx, "PM202605080001")
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "pending", found.Status)
}

func TestMembershipRepo_CountDailySystemCreditUsage(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()
	today := time.Now().In(chinaLocation()).Format("2006-01-02")
	now := time.Now()

	require.NoError(t, db.Create(&analysisTask{
		ID:       uuid.New().String(),
		UserID:   "u1",
		TaskType: "food",
		Payload: map[string]any{
			"credit_usage": map[string]any{"system_by_date": map[string]any{today: 2}},
		},
		CreatedAt: &now,
	}).Error)
	require.NoError(t, db.Create(&analysisTask{
		ID:        uuid.New().String(),
		UserID:    "u1",
		TaskType:  "exercise",
		Payload:   map[string]any{"credit_usage": map[string]any{"system_by_date": map[string]any{today: 1}}},
		CreatedAt: &now,
	}).Error)

	used, err := r.CountDailySystemCreditUsage(ctx, "u1", today)
	require.NoError(t, err)
	assert.Equal(t, 3, used)
}

func TestMembershipRepo_ChangeEarnedCredits(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()
	require.NoError(t, db.Create(&User{ID: "u1", EarnedCreditsBalance: 5}).Error)

	entry, applied, err := r.ChangeEarnedCredits(ctx, "u1", -2, "food_analysis_reward_spend", "food_analysis:t1", chinaToday(), nil)
	require.NoError(t, err)
	assert.True(t, applied)
	assert.Equal(t, -2, entry.Delta)

	var user User
	require.NoError(t, db.First(&user, "id = ?", "u1").Error)
	assert.Equal(t, 3, user.EarnedCreditsBalance)
}
