package main

import (
	"context"
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
	timeout := flag.Duration("timeout", 5*time.Minute, "migration timeout")
	onlyPapay := flag.Bool("only-papay", false, "only migrate WeChat automatic-renewal contracts")
	onlyNutritionQuality := flag.Bool("only-nutrition-quality", false, "only migrate nutrition quality tiers and alias approval status")
	onlyNutritionEmbeddings := flag.Bool("only-nutrition-embeddings", false, "only migrate nutrition semantic embedding storage")
	onlyOnboardingStatus := flag.Bool("only-onboarding-status", false, "only add nullable onboarding status schema without data backfills")
	onlyManualFoodSausage := flag.Bool("only-manual-food-sausage", false, "only normalize Taiwanese grilled sausage data")
	flag.Parse()
	selectedOnlyModes := 0
	for _, selected := range []bool{*onlyPapay, *onlyNutritionQuality, *onlyNutritionEmbeddings, *onlyOnboardingStatus, *onlyManualFoodSausage} {
		if selected {
			selectedOnlyModes++
		}
	}
	if selectedOnlyModes > 1 {
		log.Fatal("--only-papay、--only-nutrition-quality、--only-nutrition-embeddings 与 --only-onboarding-status 不能同时使用")
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
	var migrateErr error
	if *onlyPapay {
		migrateErr = migration.MigratePapayContracts(ctx, db, cfg.Database.Schema)
	} else if *onlyNutritionQuality {
		migrateErr = migration.MigrateNutritionQuality(ctx, db, cfg.Database.Schema)
	} else if *onlyNutritionEmbeddings {
		migrateErr = migration.MigrateNutritionEmbeddings(ctx, db, cfg.Database.Schema)
	} else if *onlyOnboardingStatus {
		migrateErr = migration.MigrateOnboardingStatus(ctx, db, cfg.Database.Schema)
	} else if *onlyManualFoodSausage {
		migrateErr = migration.MigrateManualFoodSausage(ctx, db, cfg.Database.Schema)
	} else {
		migrateErr = migration.AutoMigrate(ctx, db, cfg.Database.Schema)
	}
	if migrateErr != nil {
		log.Fatalf("自动迁移失败: %v", migrateErr)
	}
	schema := cfg.Database.Schema
	if schema == "" {
		schema = "public"
	}
	if *onlyPapay {
		log.Printf("微信自动续费迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyNutritionQuality {
		log.Printf("营养可信等级迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyNutritionEmbeddings {
		log.Printf("营养向量存储迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyOnboardingStatus {
		log.Printf("新手引导状态迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyManualFoodSausage {
		log.Printf("台式烤香肠数据迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	log.Printf("数据库迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
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
