package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	contentsecurity "food_link/backend/internal/contentsecurity/service"
	"food_link/backend/internal/migration"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"
)

func main() {
	configDir := flag.String("config-dir", ".", "directory containing config.yaml")
	onlyMealMemory := flag.Bool("only-meal-recommendation-memory", false, "only migrate meal recommendation feedback")
	onlyNutritionPlans := flag.Bool("only-nutrition-plans", false, "only add nutrition plan library, versioned defaults and day snapshots")
	onlyMealMeetups := flag.Bool("only-meal-meetups", false, "only add meal meetup activities, participation, events, and reports")
	timeout := flag.Duration("timeout", 5*time.Minute, "migration timeout")
	onlyPapay := flag.Bool("only-papay", false, "only migrate WeChat automatic-renewal contracts")
	onlyNutritionQuality := flag.Bool("only-nutrition-quality", false, "only migrate nutrition quality tiers and alias approval status")
	onlyNutritionStates := flag.Bool("only-nutrition-states", false, "only add nutrition state dimensions and reviewed common-state seeds")
	verifyNutritionStates := flag.Bool("verify-nutrition-states", false, "read-only verification of nutrition state dimensions, seeds, aliases, and index")
	onlyNutritionEmbeddings := flag.Bool("only-nutrition-embeddings", false, "only migrate nutrition semantic embedding storage")
	onlyOnboardingStatus := flag.Bool("only-onboarding-status", false, "only add nullable onboarding status schema without data backfills")
	onlyCampusDirectoryReviewed := flag.Bool("only-campus-directory-reviewed", false, "only publish the reviewed Beijing campus dining directory")
	onlyCampusDirectoryPending := flag.Bool("only-campus-directory-pending", false, "only import pending-review campus dining research in one transaction")
	onlyFoodRecordMood := flag.Bool("only-food-record-mood", false, "only add the optional food-record eating mood column and constraint")
	onlyManualFoodSausage := flag.Bool("only-manual-food-sausage", false, "only reclassify Taiwanese grilled sausage as an independently packaged 38g food and relink historical records")
	onlyCampusCatalogPublishing := flag.Bool("only-campus-catalog-publishing", false, "only add campus catalog publishing schema")
	onlySupplements := flag.Bool("only-supplements", false, "only add supplement catalog, cabinet, intake schema, and catalog seeds")
	onlySupplementFeed := flag.Bool("only-supplement-feed", false, "only add supplement intake feed visibility and update feed interaction target constraints")
	onlySupplementProduct := flag.Bool("only-supplement-feed-product", false, "only add optional supplement bottle identity snapshots")
	productBefore := flag.String("supplement-product-before", "", "optional RFC3339 cutoff to inspect matching legacy product metadata")
	productApply := flag.Bool("supplement-product-apply", false, "apply moderated product metadata backfill; requires cutoff")
	restoreSupplementFeed := flag.Bool("restore-supplement-feed", false, "inspect or restore moderated historical supplement feed records only")
	restoreBefore := flag.String("restore-before", "", "required RFC3339 cutoff for historical intake creation time")
	restoreRunKey := flag.String("restore-run-key", "", "required restoration audit identifier")
	restoreApply := flag.Bool("restore-apply", false, "apply the supplement restoration; default is read-only inspection")
	restoreExcludeIDs := flag.String("restore-exclude-ids", "", "comma-separated author-hidden intake IDs to preserve")
	onlyGrowthPerformanceIndexes := flag.Bool("only-growth-performance-indexes", false, "only create growth-sensitive feed, notification, and body-summary indexes")
	onlyMarketingQR := flag.Bool("only-marketing-qr", false, "only add offline marketing QR attribution tables")
	onlyCampusMapLocations := flag.Bool("only-campus-map-locations", false, "only add school, campus, and canteen coordinates used by the food map")
	onlySleep := flag.Bool("only-sleep-records", false, "only add manual daily sleep records")
	onlyPushReminders := flag.Bool("only-push-reminders", false, "only migrate the three push reminder tables and constraints")
	onlyAnalytics := flag.Bool("only-analytics", false, "only migrate admin roles and isolated analytics tables")
	printTarget := flag.Bool("print-target", false, "print resolved database target without credentials; do not connect or migrate")
	flag.Parse()
	if (!*onlySupplementProduct && (*productBefore != "" || *productApply)) || (*productApply && *productBefore == "") {
		log.Fatal("补剂产品补齐参数须与 --only-supplement-feed-product 及截止时间一起使用")
	}
	if !*restoreSupplementFeed && (*restoreBefore != "" || *restoreRunKey != "" || *restoreApply || *restoreExcludeIDs != "") {
		log.Fatal("补剂恢复参数须与 --restore-supplement-feed 一起使用")
	}
	selectedOnlyModes := 0
	if *onlyNutritionPlans {
		selectedOnlyModes++
	}
	if *onlyMealMeetups {
		selectedOnlyModes++
	}
	if *onlySupplementProduct {
		selectedOnlyModes++
	}
	for _, selected := range []bool{*onlyAnalytics, *onlyPushReminders, *onlySleep, *onlyPapay, *onlyNutritionQuality, *onlyNutritionStates, *verifyNutritionStates, *onlyNutritionEmbeddings, *onlyOnboardingStatus, *onlyCampusDirectoryReviewed, *onlyCampusDirectoryPending, *onlyFoodRecordMood, *onlyManualFoodSausage, *onlyCampusCatalogPublishing, *onlySupplements, *onlySupplementFeed, *onlyGrowthPerformanceIndexes, *onlyMarketingQR, *onlyCampusMapLocations} {
		if selected {
			selectedOnlyModes++
		}
	}
	if selectedOnlyModes > 1 {
		log.Fatal("--only-* 迁移模式不能同时使用")
	}
	if *onlyMealMemory && selectedOnlyModes > 0 {
		log.Fatal("--only-* 迁移模式不能同时使用")
	}
	if *restoreSupplementFeed && (selectedOnlyModes > 0 || *onlyMealMemory) {
		log.Fatal("补剂恢复不能与其它迁移模式一起使用")
	}

	cfg, resolvedDir, err := loadConfig(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	schema := cfg.Database.Schema
	if schema == "" {
		schema = "public"
	}
	log.Printf(
		"数据库迁移目标: config_source=%s app_env=%s host=%s port=%d database=%s schema=%s",
		cfg.ConfigSource,
		cfg.App.Env,
		cfg.Database.Host,
		cfg.Database.Port,
		cfg.Database.Name,
		schema,
	)

	if *printTarget {
		return
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
	if *onlySupplementProduct {
		var before time.Time
		if *productBefore != "" {
			before, err = time.Parse(time.RFC3339Nano, *productBefore)
			if err != nil || before.IsZero() || before.After(time.Now()) {
				log.Fatal("补剂产品补齐截止时间须为已过去的 RFC3339 时间")
			}
		}
		if err := migration.MigrateSupplementFeedProduct(ctx, db, schema); err != nil {
			log.Fatalf("补剂动态产品快照迁移失败: %v", err)
		}
		if before.IsZero() {
			log.Printf("补剂动态产品快照迁移完成: schema=%s", schema)
			return
		}
		var check func(context.Context, string, map[string]any) error
		if *productApply {
			checker, err := contentsecurity.New(cfg, authrepo.NewUserRepo(db))
			if err != nil {
				log.Fatalf("创建补剂产品资料审核失败: %v", err)
			}
			defer checker.Close()
			store := storage.New(cfg.Storage)
			check = func(ctx context.Context, userID string, doc map[string]any) error {
				return checker.CheckPublication(ctx, userID, 2, doc, store)
			}
		}
		report, err := migration.BackfillSupplementFeedProduct(ctx, db, schema, before, *productApply, check)
		if report != nil {
			body, _ := json.Marshal(report)
			fmt.Println(string(body))
		}
		if err != nil {
			log.Fatalf("补剂动态产品资料补齐失败: %v", err)
		}
		return
	}
	if *restoreSupplementFeed {
		before, err := time.Parse(time.RFC3339Nano, *restoreBefore)
		if err != nil {
			log.Fatal("补剂恢复截止时间须为 RFC3339")
		}
		var excludeIDs []string
		if strings.TrimSpace(*restoreExcludeIDs) != "" {
			for _, id := range strings.Split(*restoreExcludeIDs, ",") {
				excludeIDs = append(excludeIDs, strings.TrimSpace(id))
			}
		}
		var check func(context.Context, string, map[string]any) error
		if *restoreApply {
			checker, err := contentsecurity.New(cfg, authrepo.NewUserRepo(db))
			if err != nil {
				log.Fatalf("创建补剂内容审核失败: %v", err)
			}
			defer checker.Close()
			// Historical intakes often repeat the same immutable label snapshot.
			// Reuse this run's decision for identical content by the same author.
			decisions := map[string]error{}
			check = func(ctx context.Context, userID string, doc map[string]any) error {
				body, err := json.Marshal(doc)
				if err != nil {
					return err
				}
				key := userID + "\x00" + string(body)
				if decision, ok := decisions[key]; ok {
					return decision
				}
				err = checker.CheckPublication(ctx, userID, 2, doc, nil)
				decisions[key] = err
				return err
			}
		}
		report, err := migration.RestoreSupplementFeed(ctx, db, schema, migration.SupplementFeedRestoreOptions{Before: before, RunKey: *restoreRunKey, Apply: *restoreApply, ExcludeIDs: excludeIDs}, check)
		if report != nil {
			body, _ := json.Marshal(report)
			fmt.Println(string(body))
		}
		if err != nil {
			log.Fatalf("补剂历史动态恢复失败: %v", err)
		}
		return
	}
	if *onlyNutritionPlans {
		if err := migration.MigrateNutritionPlans(ctx, db, schema); err != nil {
			log.Fatalf("饮食方案迁移失败: %v", err)
		}
		log.Println("饮食方案结构迁移完成")
		return
	}
	if *onlyMealMemory {
		// The mutually exclusive mode check above covers meal meetups as well.
		if err := migration.MigrateMealRecommendationMemory(ctx, db); err != nil {
			log.Fatalf("餐食推荐反馈迁移失败: %v", err)
		}
		log.Printf("餐食推荐反馈迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyMealMeetups {
		if err := migration.MigrateMealMeetups(ctx, db, schema); err != nil {
			log.Fatalf("约饭迁移失败: %v", err)
		}
		log.Printf("约饭迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *verifyNutritionStates {
		report, err := migration.VerifyNutritionStates(ctx, db)
		if err != nil {
			log.Fatalf("营养状态库只读验证失败: %v", err)
		}
		body, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			log.Fatalf("序列化营养状态库验证结果失败: %v", err)
		}
		fmt.Println(string(body))
		if !report.Complete {
			log.Fatal("营养状态库只读验证未通过")
		}
		return
	}
	var migrateErr error
	if *onlyAnalytics {
		migrateErr = migration.MigrateAnalytics(ctx, db, cfg.Database.Schema)
	} else if *onlyPushReminders {
		migrateErr = migration.MigratePushReminders(ctx, db, cfg.Database.Schema)
	} else if *onlySleep {
		migrateErr = migration.MigrateSleepRecords(ctx, db, cfg.Database.Schema)
	} else if *onlyPapay {
		migrateErr = migration.MigratePapayContracts(ctx, db, cfg.Database.Schema)
	} else if *onlyNutritionQuality {
		migrateErr = migration.MigrateNutritionQuality(ctx, db, cfg.Database.Schema)
	} else if *onlyNutritionStates {
		migrateErr = migration.MigrateNutritionStates(ctx, db, cfg.Database.Schema)
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
	} else if *onlySupplementFeed {
		migrateErr = migration.MigrateSupplementFeed(ctx, db, cfg.Database.Schema)
	} else if *onlyGrowthPerformanceIndexes {
		migrateErr = migration.MigrateGrowthPerformanceIndexes(ctx, db, cfg.Database.Schema)
	} else if *onlyMarketingQR {
		migrateErr = migration.MigrateMarketingQR(ctx, db, cfg.Database.Schema)
	} else if *onlyCampusMapLocations {
		migrateErr = migration.MigrateCampusMapLocations(ctx, db)
	} else {
		migrateErr = migration.AutoMigrate(ctx, db, cfg.Database.Schema)
	}
	if migrateErr != nil {
		log.Fatalf("自动迁移失败: %v", migrateErr)
	}
	if *onlyPushReminders {
		log.Printf("提醒三表迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyPapay {
		log.Printf("微信自动续费迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyNutritionQuality {
		log.Printf("营养可信等级迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyNutritionStates {
		log.Printf("营养状态库迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
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
		log.Printf("台式烤香肠包装食品数据迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
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
	if *onlySupplementFeed {
		log.Printf("补剂动态可见性与互动类型迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyGrowthPerformanceIndexes {
		log.Printf("增长型查询性能索引迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyMarketingQR {
		log.Printf("线下二维码归因结构迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
		return
	}
	if *onlyCampusMapLocations {
		log.Printf("校园美食地图坐标字段迁移完成: config_dir=%s schema=%s", resolvedDir, schema)
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
