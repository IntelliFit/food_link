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
	onlyCampusDirectoryReviewed := flag.Bool("only-campus-directory-reviewed", false, "only publish the reviewed Beijing campus dining directory")
	onlyCampusDirectoryPending := flag.Bool("only-campus-directory-pending", false, "only import pending-review campus dining research in one transaction")
	onlyFoodRecordMood := flag.Bool("only-food-record-mood", false, "only add the optional food-record eating mood column and constraint")
	onlyManualFoodSausage := flag.Bool("only-manual-food-sausage", false, "only normalize Taiwanese grilled sausage nutrition and historical records")
	onlyCampusCatalogPublishing := flag.Bool("only-campus-catalog-publishing", false, "only add campus catalog publishing schema")
	onlySupplements := flag.Bool("only-supplements", false, "only add supplement catalog, cabinet, intake schema, and catalog seeds")
	flag.Parse()
	selectedOnlyModes := 0
	for _, selected := range []bool{*onlyPapay, *onlyNutritionQuality, *onlyNutritionEmbeddings, *onlyOnboardingStatus, *onlyCampusDirectoryReviewed, *onlyCampusDirectoryPending, *onlyFoodRecordMood, *onlyManualFoodSausage, *onlyCampusCatalogPublishing, *onlySupplements} {
		if selected {
			selectedOnlyModes++
		}
	}
	if selectedOnlyModes > 1 {
		log.Fatal("--only-* 迁移模式不能同时使用")
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
	} else if *onlyCampusDirectoryReviewed {
		migrateErr = migration.PublishBeijingOwnerVerifiedDiningDirectory(ctx, db, cfg.Database.Schema)
	} else if *onlyCampusDirectoryPending {
		migrateErr = migration.ImportPendingCampusDirectoryResearch(ctx, db, cfg.Database.Schema)
	} else if *onlyFoodRecordMood {
		migrateErr = migration.MigrateFoodRecordMood(ctx, db, cfg.Database.Schema)
	} else if *onlyManualFoodSausage {
		migrateErr = migration.MigrateManualFoodSausage(ctx, db, cfg.Database.Schema)
	} else if *onlyCampusCatalogPublishing {
		migrateErr = migration.MigrateCampusCatalogPublishing(ctx, db, cfg.Database.Schema)
	} else if *onlySupplements {
		migrateErr = migration.MigrateSupplements(ctx, db, cfg.Database.Schema)
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
	if *onlyCampusDirectoryPending {
		log.Printf("待审核校园食堂资料导入完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyFoodRecordMood {
		log.Printf("食探记录心情字段迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyManualFoodSausage {
		log.Printf("台式烤香肠数据迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyCampusCatalogPublishing {
		log.Printf("校园采集条目发布结构迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlySupplements {
		log.Printf("补剂公共库与记录结构迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
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
