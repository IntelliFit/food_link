//go:build ignore

// 本地测试数据：优先使用真实用户「小马哥」「锦恢」，向锦恢发送一条未读私信；不存在时才创建测试用户。
// 用法：cd backend && go run ./scripts/seed_private_message.go
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
	xiaomageID := ensureUser(ctx, db, "test_xiaomage_openid", "小马哥")
	jinhuiID := ensureUser(ctx, db, "test_jinhui_openid", "锦恢")

	// 检查是否已存在该条测试消息，避免重复插入
	var existingCount int64
	err = db.WithContext(ctx).Raw(
		`SELECT COUNT(*) FROM private_messages WHERE sender_id = ? AND receiver_id = ? AND content = '你好，很高兴认识你！'`,
		xiaomageID, jinhuiID,
	).Scan(&existingCount).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "check existing message: %v\n", err)
		os.Exit(1)
	}
	if existingCount > 0 {
		fmt.Println("测试消息已存在，跳过插入")
		fmt.Printf("小马哥 id=%s\n锦恢 id=%s\n", xiaomageID, jinhuiID)
		return
	}

	err = db.WithContext(ctx).Exec(
		`INSERT INTO private_messages (id, sender_id, receiver_id, content, content_type, is_read) VALUES (?, ?, ?, ?, 'text', false)`,
		uuid.New().String(), xiaomageID, jinhuiID, "你好，很高兴认识你！",
	).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "insert message: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("已插入测试私信：小马哥 -> 锦恢")
	fmt.Printf("小马哥 id=%s\n锦恢 id=%s\n", xiaomageID, jinhuiID)
}

// ensureUser 优先查找真实用户（按昵称匹配，优先有头像的），找不到再按 openid 查找/创建测试用户。
func ensureUser(ctx context.Context, db *gorm.DB, testOpenid, nickname string) string {
	var realID string
	err := db.WithContext(ctx).Raw(
		`SELECT id FROM weapp_user WHERE nickname = ? ORDER BY COALESCE(avatar, '') DESC, create_time DESC LIMIT 1`,
		nickname,
	).Scan(&realID).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "query real user %s: %v\n", nickname, err)
		os.Exit(1)
	}
	if realID != "" {
		fmt.Printf("使用真实用户 %s id=%s\n", nickname, realID)
		return realID
	}

	var id string
	err = db.WithContext(ctx).Raw(`SELECT id FROM weapp_user WHERE openid = ?`, testOpenid).Scan(&id).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "query test user %s: %v\n", nickname, err)
		os.Exit(1)
	}
	if id != "" {
		fmt.Printf("已存在测试用户 %s id=%s\n", nickname, id)
		return id
	}

	id = uuid.New().String()
	err = db.WithContext(ctx).Exec(
		`INSERT INTO weapp_user (id, openid, nickname, avatar, create_time, update_time) VALUES (?, ?, ?, '', NOW(), NOW())`,
		id, testOpenid, nickname,
	).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "insert test user %s: %v\n", nickname, err)
		os.Exit(1)
	}
	fmt.Printf("已创建测试用户 %s id=%s\n", nickname, id)
	return id
}
