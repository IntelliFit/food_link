package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"strings"
	"time"

	"food_link/backend/internal/migration"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

func main() {
	configDir := flag.String("config-dir", ".", "backend config directory")
	dryRun := flag.Bool("dry-run", false, "inspect the exact correction without writing")
	confirmDB := flag.String("confirm-db", "", "required for correction; host/database/schema")
	timeout := flag.Duration("timeout", 2*time.Minute, "command timeout")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	schema := strings.TrimSpace(cfg.Database.Schema)
	if schema == "" {
		schema = "public"
	}
	target := fmt.Sprintf("%s/%s/%s", cfg.Database.Host, cfg.Database.Name, schema)
	if !*dryRun && strings.TrimSpace(*confirmDB) != target {
		log.Fatalf("写入保护未通过：--confirm-db 必须为 %q", target)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库连接检查失败: %v", err)
	}
	if *dryRun {
		result, err := migration.InspectTangshanDirectoryCorrection(ctx, db, schema)
		if err != nil {
			log.Fatalf("检查唐山高校目录纠正失败: %v", err)
		}
		log.Printf("唐山高校目录纠正 dry-run: batch_sources=%d rejected_sources=%d active_campuses=%d active_canteens=%d", result.BatchSources, result.RejectedSources, result.ActiveCampuses, result.ActiveCanteens)
		return
	}
	if err := migration.ApplyTangshanDirectoryCorrection(ctx, db, schema); err != nil {
		log.Fatalf("纠正唐山高校目录失败: %v", err)
	}
	log.Printf("唐山高校目录纠正完成: target=%s", target)
}
