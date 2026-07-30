package main

import (
	"context"
	"flag"
	"log"
	"time"

	"food_link/backend/internal/migration"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

func main() {
	configDir := flag.String("config-dir", ".", "directory containing .env plus app-config.yaml or apollo-config.yaml")
	timeout := flag.Duration("timeout", time.Minute, "verified directory publication timeout")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("获取数据库连接失败: %v", err)
	}
	defer sqlDB.Close()
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库 ping 失败: %v", err)
	}
	if err := migration.PublishVerifiedDiningDirectory(ctx, db, cfg.Database.Schema); err != nil {
		log.Fatalf("发布已核验餐饮目录失败: %v", err)
	}
	log.Printf("已核验餐饮目录发布完成: schema=%s", cfg.Database.Schema)
}
