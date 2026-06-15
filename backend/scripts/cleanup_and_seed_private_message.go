//go:build ignore

// 删除测试用户「锦恢」，并确保测试私信指向真实锦恢用户。
// 用法：cd backend && go run ./scripts/cleanup_and_seed_private_message.go
package main

import (
	"context"
	"fmt"
	"os"

	"food_link/backend/pkg/config"

	"github.com/google/uuid"
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

	// 找到/创建小马哥测试用户
	xiaomageID := ensureTestUser(ctx, db, "test_xiaomage_openid", "小马哥")

	// 删除测试用户「锦恢」
	result := db.WithContext(ctx).Exec(`DELETE FROM weapp_user WHERE openid = 'test_jinhui_openid'`)
	if result.Error != nil {
		fmt.Fprintf(os.Stderr, "delete test jinhui: %v\n", result.Error)
		os.Exit(1)
	}
	fmt.Printf("已删除 %d 个测试用户「锦恢」\n", result.RowsAffected)

	// 确保测试消息存在且指向真实锦恢
	var existingCount int64
	err = db.WithContext(ctx).Raw(
		`SELECT COUNT(*) FROM private_messages WHERE sender_id = ? AND receiver_id = ? AND content = '你好，很高兴认识你！'`,
		xiaomageID, realJinhuiID,
	).Scan(&existingCount).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "check existing message: %v\n", err)
		os.Exit(1)
	}

	if existingCount == 0 {
		err = db.WithContext(ctx).Exec(
			`INSERT INTO private_messages (id, sender_id, receiver_id, content, content_type, is_read) VALUES (?, ?, ?, ?, 'text', false)`,
			uuid.New().String(), xiaomageID, realJinhuiID, "你好，很高兴认识你！",
		).Error
		if err != nil {
			fmt.Fprintf(os.Stderr, "insert message: %v\n", err)
			os.Exit(1)
		}
		fmt.Println("已插入测试私信：小马哥 -> 锦恢（真实用户）")
	} else {
		fmt.Println("测试私信已存在，指向真实锦恢用户")
	}

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

func ensureTestUser(ctx context.Context, db *gorm.DB, openid, nickname string) string {
	var id string
	err := db.WithContext(ctx).Raw(`SELECT id FROM weapp_user WHERE openid = ?`, openid).Scan(&id).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "query user %s: %v\n", nickname, err)
		os.Exit(1)
	}
	if id != "" {
		fmt.Printf("已存在测试用户 %s id=%s\n", nickname, id)
		return id
	}

	id = uuid.New().String()
	err = db.WithContext(ctx).Exec(
		`INSERT INTO weapp_user (id, openid, nickname, avatar, create_time, update_time) VALUES (?, ?, ?, '', NOW(), NOW())`,
		id, openid, nickname,
	).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "insert user %s: %v\n", nickname, err)
		os.Exit(1)
	}
	fmt.Printf("已创建测试用户 %s id=%s\n", nickname, id)
	return id
}
