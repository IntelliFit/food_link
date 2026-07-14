package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestInviteRewardVoucherCopyUsesRoleSpecificMembershipDays(t *testing.T) {
	inviterDays, inviterTitle, inviterDescription := inviteRewardVoucherCopy("inviter")
	assert.Equal(t, 7, inviterDays)
	assert.Equal(t, "7 天轻度版会员", inviterTitle)
	assert.Contains(t, inviterDescription, "邀请好友达标")

	inviteeDays, inviteeTitle, inviteeDescription := inviteRewardVoucherCopy("invitee")
	assert.Equal(t, 3, inviteeDays)
	assert.Equal(t, "3 天轻度版会员", inviteeTitle)
	assert.Contains(t, inviteeDescription, "完成受邀任务")
}
