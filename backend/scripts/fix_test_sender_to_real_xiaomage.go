//go:build ignore

// 将测试私信的发送者改为真实的「小马哥」用户（带路飞头像），并删除测试用户小马哥。
// 用法：cd backend && go run ./scripts/fix_test_sender_to_real_xiaomage.go
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

	// 找到真实小马哥用户（排除测试 openid，优先选有头像的）
	var realXiaomageID string
	err = db.WithContext(ctx).Raw(
		`SELECT id FROM weapp_user WHERE nickname = '小马哥' AND (openid IS NULL OR openid != 'test_xiaomage_openid') ORDER BY COALESCE(avatar, '') DESC, create_time DESC LIMIT 1`,
	).Scan(&realXiaomageID).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "query real xiaomage: %v\n", err)
		os.Exit(1)
	}
	if realXiaomageID == "" {
		fmt.Println("未找到真实小马哥用户")
		return
	}
	fmt.Printf("真实小马哥用户 id=%s\n", realXiaomageID)

	// 更新测试消息的发送者为真实小马哥
	result := db.WithContext(ctx).Exec(
		`UPDATE private_messages SET sender_id = ? WHERE content = '你好，很高兴认识你！' AND receiver_id = ?`,
		realXiaomageID, realJinhuiID,
	)
	if result.Error != nil {
		fmt.Fprintf(os.Stderr, "update message sender: %v\n", result.Error)
		os.Exit(1)
	}
	fmt.Printf("已更新 %d 条测试消息的发送者为真实小马哥\n", result.RowsAffected)

	// 删除测试用户小马哥
	delResult := db.WithContext(ctx).Exec(`DELETE FROM weapp_user WHERE openid = 'test_xiaomage_openid'`)
	if delResult.Error != nil {
		fmt.Fprintf(os.Stderr, "delete test xiaomage: %v\n", delResult.Error)
		os.Exit(1)
	}
	fmt.Printf("已删除 %d 个测试用户「小马哥」\n", delResult.RowsAffected)

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
