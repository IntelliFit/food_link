package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/membership/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&domain.MembershipPlan{},
		&domain.UserMembership{},
		&domain.MembershipPayment{},
		&domain.MembershipShareReward{},
		&analysisTask{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func TestMembershipRepo_ListActivePlans(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	plans, err := r.ListActivePlans(ctx)
	assert.NoError(t, err)
	assert.Empty(t, plans)

	db.Create(&domain.MembershipPlan{ID: "p1", Name: "Basic", IsActive: true})
	db.Create(&domain.MembershipPlan{ID: "p2", Name: "Pro", IsActive: false})

	plans, err = r.ListActivePlans(ctx)
	assert.NoError(t, err)
	assert.Len(t, plans, 1)
	assert.Equal(t, "Basic", plans[0].Name)
}

func TestMembershipRepo_GetPlanByID(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	plan, err := r.GetPlanByID(ctx, "p1")
	assert.NoError(t, err)
	assert.Nil(t, plan)

	db.Create(&domain.MembershipPlan{ID: "p1", Name: "Basic"})
	plan, err = r.GetPlanByID(ctx, "p1")
	assert.NoError(t, err)
	assert.NotNil(t, plan)
	assert.Equal(t, "Basic", plan.Name)
}

func TestMembershipRepo_GetActiveMembership(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	um, err := r.GetActiveMembership(ctx, "u1")
	assert.NoError(t, err)
	assert.Nil(t, um)

	now := time.Now()
	future := now.Add(24 * time.Hour)
	db.Create(&domain.UserMembership{ID: "um1", UserID: "u1", PlanID: "p1", Status: "active", ExpiresAt: &future})

	um, err = r.GetActiveMembership(ctx, "u1")
	assert.NoError(t, err)
	assert.NotNil(t, um)
	assert.Equal(t, "um1", um.ID)

	// Expired
	past := now.Add(-24 * time.Hour)
	db.Create(&domain.UserMembership{ID: "um2", UserID: "u2", PlanID: "p1", Status: "active", ExpiresAt: &past})
	um, err = r.GetActiveMembership(ctx, "u2")
	assert.NoError(t, err)
	assert.Nil(t, um)
}

func TestMembershipRepo_CreateMembership(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	now := time.Now()
	um := &domain.UserMembership{UserID: "u1", PlanID: "p1", Status: "active", StartedAt: &now}
	err := r.CreateMembership(ctx, um)
	assert.NoError(t, err)
	assert.NotEmpty(t, um.ID)

	var count int64
	db.Model(&domain.UserMembership{}).Count(&count)
	assert.Equal(t, int64(1), count)
}

func TestMembershipRepo_UpdateMembership(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	now := time.Now()
	future := now.Add(24 * time.Hour)
	db.Create(&domain.UserMembership{ID: "um1", UserID: "u1", PlanID: "p1", Status: "active", ExpiresAt: &now})

	err := r.UpdateMembership(ctx, "um1", map[string]any{"expires_at": future, "status": "cancelled"})
	assert.NoError(t, err)

	var um domain.UserMembership
	db.First(&um, "id = ?", "um1")
	assert.Equal(t, "cancelled", um.Status)
}

func TestMembershipRepo_CreatePayment(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	prepayID := "prep_1"
	p := &domain.MembershipPayment{UserID: "u1", PlanID: "p1", AmountCents: 100, Status: "pending", WechatPrepayID: &prepayID}
	err := r.CreatePayment(ctx, p)
	assert.NoError(t, err)
	assert.NotEmpty(t, p.ID)

	var count int64
	db.Model(&domain.MembershipPayment{}).Count(&count)
	assert.Equal(t, int64(1), count)
}

func TestMembershipRepo_GetPaymentByID(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	p, err := r.GetPaymentByID(ctx, "pay1")
	assert.NoError(t, err)
	assert.Nil(t, p)

	db.Create(&domain.MembershipPayment{ID: "pay1", UserID: "u1", PlanID: "p1", AmountCents: 100, Status: "pending"})
	p, err = r.GetPaymentByID(ctx, "pay1")
	assert.NoError(t, err)
	assert.NotNil(t, p)
	assert.Equal(t, "pending", p.Status)
}

func TestMembershipRepo_UpdatePaymentStatus(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	db.Create(&domain.MembershipPayment{ID: "pay1", UserID: "u1", PlanID: "p1", AmountCents: 100, Status: "pending"})
	err := r.UpdatePaymentStatus(ctx, "pay1", "paid")
	assert.NoError(t, err)

	var p domain.MembershipPayment
	db.First(&p, "id = ?", "pay1")
	assert.Equal(t, "paid", p.Status)
}

func TestMembershipRepo_CountAnalysisTasksToday(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	count, err := r.CountAnalysisTasksToday(ctx, "u1")
	assert.NoError(t, err)
	assert.Equal(t, int64(0), count)

	now := time.Now()
	db.Create(&analysisTask{ID: uuid.New().String(), UserID: "u1", CreatedAt: &now})
	db.Create(&analysisTask{ID: uuid.New().String(), UserID: "u1", CreatedAt: &now})
	db.Create(&analysisTask{ID: uuid.New().String(), UserID: "u2", CreatedAt: &now})

	count, err = r.CountAnalysisTasksToday(ctx, "u1")
	assert.NoError(t, err)
	assert.Equal(t, int64(2), count)
}

func TestMembershipRepo_HasShareReward(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	claimed, err := r.HasShareReward(ctx, "u1", "r1")
	assert.NoError(t, err)
	assert.False(t, claimed)

	now := time.Now()
	db.Create(&domain.MembershipShareReward{ID: "sr1", UserID: "u1", RecordID: "r1", CreatedAt: &now})

	claimed, err = r.HasShareReward(ctx, "u1", "r1")
	assert.NoError(t, err)
	assert.True(t, claimed)
}

func TestMembershipRepo_CreateShareReward(t *testing.T) {
	db := setupTestDB(t)
	r := NewMembershipRepo(db)
	ctx := context.Background()

	reward := &domain.MembershipShareReward{UserID: "u1", RecordID: "r1"}
	err := r.CreateShareReward(ctx, reward)
	assert.NoError(t, err)
	assert.NotEmpty(t, reward.ID)

	var count int64
	db.Model(&domain.MembershipShareReward{}).Count(&count)
	assert.Equal(t, int64(1), count)
}
