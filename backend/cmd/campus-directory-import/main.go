package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"time"

	"food_link/backend/internal/migration"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

func main() {
	seedPath := flag.String("seed", "data/campus_directory_pending_research_seed.json", "campus directory research seed JSON")
	apply := flag.Bool("apply", false, "write the reviewed seed to the configured database")
	showTarget := flag.Bool("show-target", false, "print the resolved non-sensitive database target without writing")
	configDir := flag.String("config-dir", ".", "directory containing .env plus app-config.yaml or apollo-config.yaml")
	timeout := flag.Duration("timeout", time.Minute, "database import timeout")
	confirmEnvironment := flag.String("confirm-environment", "", "required with --apply; must exactly match app.env")
	confirmHost := flag.String("confirm-host", "", "required with --apply; must exactly match database.host")
	confirmDatabase := flag.String("confirm-database", "", "required with --apply; must exactly match database.name")
	flag.Parse()

	stats, err := migration.InspectCampusDirectoryResearchSeed(*seedPath)
	if err != nil {
		log.Fatalf("校园目录导入包校验失败: %v", err)
	}
	payload, _ := json.MarshalIndent(stats, "", "  ")
	fmt.Printf("校园目录导入预检完成（尚未写数据库）:\n%s\n", payload)
	if !*apply && !*showTarget {
		return
	}

	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	if *showTarget {
		fmt.Printf("当前数据库目标: environment=%s host=%s database=%s schema=%s\n", cfg.App.Env, cfg.Database.Host, cfg.Database.Name, cfg.Database.Schema)
		if !*apply {
			return
		}
	}
	if *confirmEnvironment == "" || *confirmHost == "" || *confirmDatabase == "" {
		log.Fatal("--apply 必须同时提供 --confirm-environment、--confirm-host 和 --confirm-database")
	}
	if cfg.App.Env != *confirmEnvironment || cfg.Database.Host != *confirmHost || cfg.Database.Name != *confirmDatabase {
		log.Fatalf("目标库确认不匹配: environment=%s host=%s database=%s", cfg.App.Env, cfg.Database.Host, cfg.Database.Name)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
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
	if err := migration.ImportCampusDirectoryResearchSeed(ctx, db, cfg.Database.Schema, *seedPath); err != nil {
		log.Fatalf("校园目录导入失败: %v", err)
	}
	log.Printf("校园目录导入完成: environment=%s host=%s database=%s schema=%s", cfg.App.Env, cfg.Database.Host, cfg.Database.Name, cfg.Database.Schema)
}
