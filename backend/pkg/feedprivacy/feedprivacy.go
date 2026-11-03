// Package feedprivacy decides who can see a user's records. Every record insert
// goes through ResolveHidden, so a caller that does not pass a choice (auto-record,
// quick logs) can never publish beyond what the owner's two switches allow.
package feedprivacy

import (
	"context"
	"log/slog"
	"strings"

	"food_link/backend/pkg/logger"

	"gorm.io/gorm"
)

// VisibleToFriends reports whether an account's records reach its friends. Public
// accounts always do, since strangers must not see more than friends. A value that
// was never set means on, matching the column default.
func VisibleToFriends(friendsCanView, public *bool) bool {
	if public != nil && *public {
		return true
	}
	return friendsCanView == nil || *friendsCanView
}

// ResolveHidden returns the hidden_from_feed value for a new record. An explicit
// choice wins, for clients that still send one; otherwise the record joins the feed
// unless the owner has turned off both friends and public. A record saved while
// they are off stays hidden after they are turned back on. Unknown owners and lookup
// failures stay hidden.
func ResolveHidden(ctx context.Context, db *gorm.DB, userID string, shareToFeed *bool) bool {
	if shareToFeed != nil {
		return !*shareToFeed
	}
	userID = strings.TrimSpace(userID)
	if db == nil || userID == "" {
		return true
	}
	var rows []struct {
		PublicRecords         *bool `gorm:"column:public_records"`
		FriendsCanViewRecords *bool `gorm:"column:friends_can_view_records"`
	}
	if err := db.WithContext(ctx).Table("weapp_user").Select("public_records, friends_can_view_records").Where("id = ?", userID).Limit(1).Scan(&rows).Error; err != nil {
		logger.Warn(ctx, "读取用户公开设置失败，记录按不同步圈子保存", slog.String("user_id", userID), logger.Err(err))
		return true
	}
	if len(rows) == 0 {
		return true
	}
	return !VisibleToFriends(rows[0].FriendsCanViewRecords, rows[0].PublicRecords)
}
