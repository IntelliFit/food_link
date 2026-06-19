package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"food_link/backend/pkg/config"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type User struct {
	ID       string `gorm:"column:id"`
	Nickname string `gorm:"column:nickname"`
}

func (User) TableName() string { return "weapp_user" }

type FoodRecord struct {
	ID            string    `gorm:"column:id"`
	UserID        string    `gorm:"column:user_id"`
	MealType      string    `gorm:"column:meal_type"`
	Description   *string   `gorm:"column:description"`
	Items         string    `gorm:"column:items"`
	RecordTime    time.Time `gorm:"column:record_time"`
	CreatedAt     time.Time `gorm:"column:created_at"`
	EntryType     *string   `gorm:"column:entry_type"`
}

func (FoodRecord) TableName() string { return "user_food_records" }

type WaterLog struct {
	ID         string    `gorm:"column:id"`
	UserID     string    `gorm:"column:user_id"`
	AmountMl   int       `gorm:"column:amount_ml"`
	RecordedOn time.Time `gorm:"column:recorded_on"`
	SourceType string    `gorm:"column:source_type"`
	CreatedAt  time.Time `gorm:"column:created_at"`
}

func (WaterLog) TableName() string { return "user_water_logs" }

func main() {
	cfg, err := config.Load(".")
	if err != nil {
		fmt.Fprintf(os.Stderr, "load config failed: %v\n", err)
		os.Exit(1)
	}

	dsn := fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		cfg.Database.Host,
		cfg.Database.Port,
		cfg.Database.User,
		cfg.Database.Password,
		cfg.Database.Name,
		cfg.Database.SSLMode,
	)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect db failed: %v\n", err)
		os.Exit(1)
	}

	sqlDB, err := db.DB()
	if err != nil {
		fmt.Fprintf(os.Stderr, "get sql db failed: %v\n", err)
		os.Exit(1)
	}
	defer sqlDB.Close()

	ctx := context.Background()

	// 1. 查找用户
	var user User
	if err := db.WithContext(ctx).Where("nickname = ?", "锦恢").First(&user).Error; err != nil {
		fmt.Fprintf(os.Stderr, "find user failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("用户: id=%s nickname=%s\n", user.ID, user.Nickname)

	// 2. 最近 3 天的食物记录（只看 entry_type 为 favorite_recipe 或 analyze 的）
	var records []FoodRecord
	if err := db.WithContext(ctx).
		Where("user_id = ?", user.ID).
		Where("created_at >= NOW() - INTERVAL '3 days'").
		Order("created_at desc").
		Limit(20).
		Find(&records).Error; err != nil {
		fmt.Fprintf(os.Stderr, "query food records failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("\n最近 3 天食物记录 (%d 条):\n", len(records))
	for _, r := range records {
		desc := ""
		if r.Description != nil {
			desc = *r.Description
		}
		entry := ""
		if r.EntryType != nil {
			entry = *r.EntryType
		}
		fmt.Printf("  id=%s meal=%s entry=%s record_time=%s created_at=%s desc=%s items=%s\n",
			r.ID, r.MealType, entry, r.RecordTime.Format("2006-01-02 15:04:05"), r.CreatedAt.Format("2006-01-02 15:04:05"), desc, r.Items)
	}

	// 3. 最近 3 天的饮水日志
	var logs []WaterLog
	if err := db.WithContext(ctx).
		Where("user_id = ?", user.ID).
		Where("created_at >= NOW() - INTERVAL '3 days'").
		Order("created_at desc").
		Limit(50).
		Find(&logs).Error; err != nil {
		fmt.Fprintf(os.Stderr, "query water logs failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("\n最近 3 天饮水日志 (%d 条):\n", len(logs))
	for _, l := range logs {
		fmt.Printf("  id=%s amount=%dml recorded_on=%s source=%s created_at=%s\n",
			l.ID, l.AmountMl, l.RecordedOn.Format("2006-01-02"), l.SourceType, l.CreatedAt.Format("2006-01-02 15:04:05"))
	}
}
