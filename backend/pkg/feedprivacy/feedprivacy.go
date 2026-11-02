// Package feedprivacy decides whether a newly written record joins the circle
// feed. Every record insert goes through it, so a caller that does not pass a
// choice (old clients, auto-record, quick logs) can never publish by accident.
package feedprivacy

import (
	"context"
	"log/slog"
	"strings"

	"food_link/backend/pkg/logger"

	"gorm.io/gorm"
)

// ResolveHidden returns the hidden_from_feed value for a new record. An explicit
// choice wins; otherwise the record joins the feed only when the owner has turned
// on public records. Unknown owners and lookup failures stay hidden.
func ResolveHidden(ctx context.Context, db *gorm.DB, userID string, shareToFeed *bool) bool {
	if shareToFeed != nil {
		return !*shareToFeed
	}
	userID = strings.TrimSpace(userID)
	if db == nil || userID == "" {
		return true
	}
	var rows []struct {
		PublicRecords *bool `gorm:"column:public_records"`
	}
	if err := db.WithContext(ctx).Table("weapp_user").Select("public_records").Where("id = ?", userID).Limit(1).Scan(&rows).Error; err != nil {
		logger.Warn(ctx, "读取用户公开设置失败，记录按不同步圈子保存", slog.String("user_id", userID), logger.Err(err))
		return true
	}
	if len(rows) == 0 || rows[0].PublicRecords == nil {
		return true
	}
	return !*rows[0].PublicRecords
}
