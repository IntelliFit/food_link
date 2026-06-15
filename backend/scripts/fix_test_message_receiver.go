//go:build ignore

// 将测试私信从测试用户「锦恢」迁移到真实用户「锦恢」。
// 用法：cd backend && go run ./scripts/fix_test_message_receiver.go
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

	// 找到真实锦恢用户：排除测试 openid，取最新一个
	var realJinhuiID string
	err = db.WithContext(ctx).Raw(
		`SELECT id FROM weapp_user WHERE nickname = '锦恢' AND (openid IS NULL OR openid != 'test_jinhui_openid') ORDER BY create_time DESC LIMIT 1`,
	).Scan(&realJinhuiID).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "query real jinhui: %v\n", err)
		os.Exit(1)
	}
	if realJinhuiID == "" {
		fmt.Println("未找到真实锦恢用户")
		return
	}
	fmt.Printf("真实锦恢用户 id=%s\n", realJinhuiID)

	// 将小马哥发送的测试消息迁移到真实锦恢
	result := db.WithContext(ctx).Exec(
		`UPDATE private_messages SET receiver_id = ? WHERE content = '你好，很高兴认识你！' AND sender_id IN (SELECT id FROM weapp_user WHERE openid = 'test_xiaomage_openid')`,
		realJinhuiID,
	)
	if result.Error != nil {
		fmt.Fprintf(os.Stderr, "update message: %v\n", result.Error)
		os.Exit(1)
	}
	fmt.Printf("已更新 %d 条测试消息的 receiver_id 为真实锦恢用户\n", result.RowsAffected)

	// 验证未读数
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
