//go:build ignore

// 诊断会话列表返回内容。
// 用法：cd backend && go run ./scripts/diag_conversations.go
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
		fmt.Fprintf(os.Stderr, "query jinhui: %v\n", err)
		os.Exit(1)
	}
	if realJinhuiID == "" {
		fmt.Println("未找到锦恢用户")
		return
	}
	fmt.Printf("锦恢用户 id=%s\n\n", realJinhuiID)

	// 查询最近 5 条相关消息
	var messages []struct {
		ID         string
		SenderID   string
		ReceiverID string
		Content    string
		IsRead     bool
		CreatedAt  string
	}
	err = db.WithContext(ctx).Raw(
		`SELECT id, sender_id, receiver_id, content, is_read, created_at::text AS created_at FROM private_messages WHERE sender_id = ? OR receiver_id = ? ORDER BY created_at DESC LIMIT 10`,
		realJinhuiID, realJinhuiID,
	).Scan(&messages).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "query messages: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("最近 %d 条相关消息:\n", len(messages))
	for _, m := range messages {
		fmt.Printf("  id=%s sender=%s receiver=%s is_read=%v content=%s\n", m.ID, m.SenderID, m.ReceiverID, m.IsRead, m.Content)
	}

	// 查询对应发送者昵称
	fmt.Println("\n对应用户:")
	for _, m := range messages {
		otherID := m.SenderID
		if otherID == realJinhuiID {
			otherID = m.ReceiverID
		}
		var nickname string
		db.WithContext(ctx).Raw(`SELECT COALESCE(nickname, '') FROM weapp_user WHERE id = ?`, otherID).Scan(&nickname)
		fmt.Printf("  id=%s nickname=%q\n", otherID, nickname)
	}

	// 直接执行会话列表 SQL
	fmt.Println("\n会话列表 SQL 结果:")
	type convRow struct {
		OtherID     string
		Nickname    string
		Avatar      string
		Content     string
		UnreadCount int64
	}
	var convs []convRow
	err = db.WithContext(ctx).Raw(`
SELECT
  CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AS other_id,
  COALESCE(u.nickname, CASE WHEN CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END = ? THEN '系统消息' ELSE '' END) AS nickname,
  COALESCE(u.avatar, '') AS avatar,
  m.content AS last_content,
  COALESCE(uc.unread_count, 0) AS unread_count
FROM (
  SELECT DISTINCT ON (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id))
    id,
    sender_id,
    receiver_id,
    content,
    image_url,
    content_type,
    created_at
  FROM private_messages
  WHERE sender_id = ? OR receiver_id = ?
  ORDER BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC
) m
LEFT JOIN weapp_user u ON u.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS unread_count
  FROM private_messages
  WHERE sender_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AND receiver_id = ? AND is_read = false
) uc ON true
ORDER BY m.created_at DESC
LIMIT 20 OFFSET 0
`, realJinhuiID, realJinhuiID, "00000000-0000-0000-0000-000000000000", realJinhuiID, realJinhuiID, realJinhuiID, realJinhuiID, realJinhuiID).Scan(&convs).Error
	if err != nil {
		fmt.Fprintf(os.Stderr, "query conversations: %v\n", err)
		os.Exit(1)
	}
	for _, c := range convs {
		fmt.Printf("  other_id=%s nickname=%q avatar=%q content=%s unread=%d\n", c.OtherID, c.Nickname, c.Avatar, c.Content, c.UnreadCount)
	}
}
