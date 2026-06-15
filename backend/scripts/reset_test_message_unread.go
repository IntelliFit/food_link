//go:build ignore

// 将真实小马哥->真实锦恢的测试消息重置为未读。
// 用法：cd backend && go run ./scripts/reset_test_message_unread.go
package main

import (
	"context"
	"fmt"
	"os"

	"food_link/backend/pkg/config"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	cfg, err := config.Load(".")
	if err != nil {
		fmt.Fprintf(os.Stderr, "load config: %v\n", err)
		os.Exit(1)
	}
	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		cfg.Database.Host, cfg.Database.Port, cfg.Database.User, cfg.Database.Password, cfg.Database.Name, cfg.Database.SSLMode,
	)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		fmt.Fprintf(os.Stderr, "db: %v\n", err)
		os.Exit(1)
	}

	ctx := context.Background()

	// 找到真实锦恢用户
	var realJinhuiID string
	err = db.WithContext(ctx).Raw(
		`SELECT id FROM weapp_user WHERE nickname = '锦恢' ORDER BY create_time DESC LIMIT 1`,
	).Scan(&realJinhuiID).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "query real jinhui: %v\n", err)
		os.Exit(1)
	}
	if realJinhuiID == "" {
		fmt.Println("未找到真实锦恢用户")
		return
	}

	// 找到真实小马哥用户
	var realXiaomageID string
	err = db.WithContext(ctx).Raw(
		`SELECT id FROM weapp_user WHERE nickname = '小马哥' ORDER BY COALESCE(avatar, '') DESC, create_time DESC LIMIT 1`,
	).Scan(&realXiaomageID).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "query real xiaomage: %v\n", err)
		os.Exit(1)
	}
	if realXiaomageID == "" {
		fmt.Println("未找到真实小马哥用户")
		return
	}

	// 重置为未读
	result := db.WithContext(ctx).Exec(
		`UPDATE private_messages SET is_read = false WHERE sender_id = ? AND receiver_id = ? AND content = '你好，很高兴认识你！'`,
		realXiaomageID, realJinhuiID,
	)
	if result.Error != nil {
		fmt.Fprintf(os.Stderr, "reset unread: %v\n", result.Error)
		os.Exit(1)
	}
	fmt.Printf("已重置 %d 条消息为未读\n", result.RowsAffected)

	// 验证
	var unreadCount int64
	err = db.WithContext(ctx).Raw(
		`SELECT COUNT(*) FROM private_messages WHERE receiver_id = ? AND is_read = false`,
		realJinhuiID,
	).Scan(&unreadCount).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "count unread: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("真实锦恢用户当前未读私信数: %d\n", unreadCount)
}
