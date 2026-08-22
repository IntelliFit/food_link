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
	configDir := flag.String("config-dir", ".", "directory containing config.yaml")
	timeout := flag.Duration("timeout", 2*time.Minute, "migration timeout")
	flag.Parse()

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
		log.Fatalf("获取 SQL 数据库连接失败: %v", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库 ping 失败: %v", err)
	}
	if err := migration.MigrateUserFoodPhotoAnnotations(ctx, db, cfg.Database.Schema); err != nil {
		log.Fatalf("用户食物照片标注结构迁移失败: %v", err)
	}
	schema := cfg.Database.Schema
	if schema == "" {
		schema = "public"
	}
	log.Printf("用户食物照片标注结构迁移完成: schema=%s", schema)
}
