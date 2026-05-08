package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestMembershipPlan_Struct(t *testing.T) {
	desc := "Premium plan"
	original := 129.0
	plan := MembershipPlan{
		Code:           "standard_monthly",
		Name:           "标准版月卡",
		Description:    &desc,
		Amount:         99,
		DurationMonths: 1,
		DailyCredits:   40,
		OriginalAmount: &original,
		IsActive:       true,
	}
	assert.Equal(t, "standard_monthly", plan.Code)
	assert.Equal(t, "membership_plan_config", plan.TableName())
}

func TestUserMembership_Struct(t *testing.T) {
	now := time.Now()
	planCode := "standard_monthly"
	membership := UserMembership{
		ID:                 "um-1",
		UserID:             "user-1",
		CurrentPlanCode:    &planCode,
		Status:             "active",
		CurrentPeriodStart: &now,
		ExpiresAt:          &now,
		CreatedAt:          &now,
	}
	assert.Equal(t, "um-1", membership.ID)
	assert.Equal(t, "user_pro_memberships", membership.TableName())
}

func TestMembershipPayment_Struct(t *testing.T) {
	now := time.Now()
	payment := MembershipPayment{
		ID:             "pay-1",
		UserID:         "user-1",
		PlanCode:       "standard_monthly",
		OrderNo:        "PM202605080001",
		Amount:         99,
		Currency:       "CNY",
		DurationMonths: 1,
		Status:         "pending",
		CreatedAt:      &now,
	}
	assert.Equal(t, "pay-1", payment.ID)
	assert.Equal(t, "pro_membership_payment_records", payment.TableName())
}

func TestMembershipShareReward_Struct(t *testing.T) {
	now := time.Now()
	reward := MembershipShareReward{
		ID:        "sr-1",
		UserID:    "user-1",
		RecordID:  "record-1",
		CreatedAt: &now,
	}
	assert.Equal(t, "sr-1", reward.ID)
	assert.Equal(t, "membership_share_rewards", reward.TableName())
}
