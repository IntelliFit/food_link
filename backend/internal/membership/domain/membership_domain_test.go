package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestMembershipPlan_Struct(t *testing.T) {
	plan := MembershipPlan{
		ID:           "plan-1",
		Name:         "Premium",
		PriceCents:   9900,
		DurationDays: 30,
		Description:  "Premium plan",
		Benefits:     []string{"feature1", "feature2"},
		IsActive:     true,
	}
	assert.Equal(t, "plan-1", plan.ID)
	assert.Equal(t, "membership_plans", plan.TableName())
}

func TestUserMembership_Struct(t *testing.T) {
	now := time.Now()
	membership := UserMembership{
		ID:        "um-1",
		UserID:    "user-1",
		PlanID:    "plan-1",
		Status:    "active",
		StartedAt: &now,
		CreatedAt: &now,
	}
	assert.Equal(t, "um-1", membership.ID)
	assert.Equal(t, "user_memberships", membership.TableName())
}

func TestMembershipPayment_Struct(t *testing.T) {
	now := time.Now()
	payment := MembershipPayment{
		ID:          "pay-1",
		UserID:      "user-1",
		PlanID:      "plan-1",
		AmountCents: 9900,
		Status:      "pending",
		CreatedAt:   &now,
	}
	assert.Equal(t, "pay-1", payment.ID)
	assert.Equal(t, "membership_payments", payment.TableName())
}

func TestMembershipShareReward_Struct(t *testing.T) {
	now := time.Now()
	reward := MembershipShareReward{
		ID:       "sr-1",
		UserID:   "user-1",
		RecordID: "record-1",
		CreatedAt: &now,
	}
	assert.Equal(t, "sr-1", reward.ID)
	assert.Equal(t, "membership_share_rewards", reward.TableName())
}
