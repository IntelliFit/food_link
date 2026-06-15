//go:build ignore

// 诊断脚本：查询名为「锦恢」的用户及其未读私信。
// 用法：cd backend && go run ./scripts/diag_private_message.go
package main

import (
	"context"
	"fmt"
	"os"

	"food_link/backend/pkg/config"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type userRow struct {
	ID       string
	OpenID   string
	Nickname string
}

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

	var users []userRow
	err = db.WithContext(ctx).Raw(`SELECT id, openid, COALESCE(nickname, '') AS nickname FROM weapp_user WHERE nickname = '锦恢' ORDER BY create_time DESC`).Scan(&users).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "query users: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("找到 %d 个昵称为「锦恢」的用户\n", len(users))
	for _, u := range users {
		fmt.Printf("  id=%s openid=%s nickname=%s\n", u.ID, u.OpenID, u.Nickname)
	}

	if len(users) == 0 {
		fmt.Println("没有名为锦恢的用户")
		return
	}

	for _, u := range users {
		var unreadCount int64
		err = db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM private_messages WHERE receiver_id = ? AND is_read = false`, u.ID).Scan(&unreadCount).Error
		if err != nil {
			fmt.Fprintf(os.Stderr, "count unread for %s: %v\n", u.ID, err)
			continue
		}
		fmt.Printf("用户 %s 的未读消息数: %d\n", u.ID, unreadCount)

		var messages []struct {
			ID         string
			SenderID   string
			ReceiverID string
			Content    string
			IsRead     bool
			CreatedAt  string
		}
		err = db.WithContext(ctx).Raw(`SELECT id, sender_id, receiver_id, content, is_read, created_at::text AS created_at FROM private_messages WHERE receiver_id = ? ORDER BY created_at DESC LIMIT 5`, u.ID).Scan(&messages).Error
		if err != nil {
			fmt.Fprintf(os.Stderr, "query messages for %s: %v\n", u.ID, err)
			continue
		}
		for _, m := range messages {
			fmt.Printf("  msg id=%s sender=%s receiver=%s is_read=%v content=%s\n", m.ID, m.SenderID, m.ReceiverID, m.IsRead, m.Content)
		}
	}
}
