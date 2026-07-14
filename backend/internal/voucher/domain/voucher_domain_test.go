package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestInviteRewardRemainsUsableUntilActivated(t *testing.T) {
	pastDeadline := time.Now().Add(-24 * time.Hour)
	reward := &UserVoucher{
		VoucherType: VoucherTypeInviteLightWeek,
		Status:      VoucherStatusPending,
		ValidEndAt:  &pastDeadline,
	}

	assert.True(t, reward.IsUsable())
}

func TestOtherRewardStillHonorsConfiguredDeadline(t *testing.T) {
	pastDeadline := time.Now().Add(-24 * time.Hour)
	reward := &UserVoucher{
		VoucherType: VoucherTypeRegistrationTrial,
		Status:      VoucherStatusPending,
		ValidEndAt:  &pastDeadline,
	}

	assert.False(t, reward.IsUsable())
}
