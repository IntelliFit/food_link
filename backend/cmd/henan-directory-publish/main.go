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
	timeout := flag.Duration("timeout", time.Minute, "Henan owner-verified directory publication timeout")
	checkTarget := flag.Bool("check-target", false, "print the non-sensitive deployment target without changing data")
	dryRun := flag.Bool("dry-run", false, "inspect the import delta without changing data")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	if *checkTarget {
		log.Printf(
			"河南本科院校食堂目录目标检查: app_env=%s database_host=%s database_port=%d database_name=%s schema=%s",
			cfg.App.Env,
			cfg.Database.Host,
			cfg.Database.Port,
			cfg.Database.Name,
			cfg.Database.Schema,
		)
		return
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
		log.Fatalf("数据库连接检查失败: %v", err)
	}
	if *dryRun {
		result, inspectErr := migration.InspectHenanOwnerVerifiedDiningDirectory(ctx, db, cfg.Database.Schema)
		if inspectErr != nil {
			log.Fatalf("检查河南本科院校已核实目录失败: %v", inspectErr)
		}
		log.Printf(
			"河南本科院校已核实目录 dry-run 完成: schools=%d campuses=%d canteens=%d existing_campuses=%d new_campuses=%d existing_canteens=%d new_canteens=%d",
			result.Schools,
			result.Campuses,
			result.Canteens,
			result.ExistingCampuses,
			result.NewCampuses,
			result.ExistingCanteens,
			result.NewCanteens,
		)
		return
	}
	if err := migration.PublishHenanOwnerVerifiedDiningDirectory(ctx, db, cfg.Database.Schema); err != nil {
		log.Fatalf("发布河南本科院校已核实餐饮目录失败: %v", err)
	}
	log.Printf("河南本科院校已核实餐饮目录发布完成: schema=%s", cfg.Database.Schema)
}
