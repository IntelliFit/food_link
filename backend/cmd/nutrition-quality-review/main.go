package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"food_link/backend/internal/migration"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

func main() {
	configDir := flag.String("config-dir", ".", "directory containing config.yaml")
	artifact := flag.String("artifact", "", "review artifact JSON path")
	apply := flag.Bool("apply", false, "commit the reviewed batch; default is validation-only dry-run")
	timeout := flag.Duration("timeout", 15*time.Minute, "review validation/apply timeout")
	flag.Parse()
	if *artifact == "" {
		log.Fatal("必须提供 --artifact")
	}

	cfg, resolvedDir, err := loadConfig(*configDir)
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
	result, err := migration.ApplyNutritionQualityReview(ctx, db, cfg.Database.Schema, *artifact, *apply)
	if err != nil {
		log.Fatalf("营养审核批次执行失败: %v", err)
	}
	body, _ := json.Marshal(result)
	log.Printf("营养审核批次完成: config_dir=%s result=%s", resolvedDir, body)
}

func loadConfig(configDir string) (*config.Config, string, error) {
	candidates := []string{configDir}
	if configDir == "." {
		candidates = append(candidates, "backend", filepath.Join("food_link", "backend"), filepath.Join("..", ".."))
	}
	var firstErr error
	for _, dir := range candidates {
		cfg, err := config.Load(dir)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if hasConfigFile(dir) || hasDatabaseConfig(cfg) {
			return cfg, dir, nil
		}
	}
	if firstErr != nil {
		return nil, "", firstErr
	}
	return nil, "", fmt.Errorf("config.yaml not found and database env vars are incomplete")
}

func hasConfigFile(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, "config.yaml"))
	return err == nil && !info.IsDir()
}

func hasDatabaseConfig(cfg *config.Config) bool {
	return cfg != nil && cfg.Database.Host != "" && cfg.Database.Name != "" && cfg.Database.User != ""
}
