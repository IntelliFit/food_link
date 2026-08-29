package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"strings"
	"time"

	"food_link/backend/internal/migration"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

type options struct {
	configDir      string
	apply          bool
	expectedHost   string
	expectedDB     string
	expectedSchema string
	timeout        time.Duration
}

func main() {
	opts := parseFlags()
	cfg, err := config.Load(opts.configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	if opts.apply {
		if err := validateExpectedTarget(cfg, opts); err != nil {
			log.Fatal(err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), opts.timeout)
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
		log.Fatalf("数据库连接检查失败: %v", err)
	}

	var report *migration.FoodNutritionContributionMigrationReport
	if opts.apply {
		report, err = migration.MigrateFoodNutritionContributions(ctx, db, cfg.Database.Schema)
	} else {
		report, err = migration.InspectFoodNutritionContributions(ctx, db, cfg.Database.Schema)
	}
	if err != nil {
		log.Fatalf("标准食物用户待审表定向迁移失败: %v", err)
	}
	body, err := json.MarshalIndent(map[string]any{
		"applied":  opts.apply,
		"host":     cfg.Database.Host,
		"database": cfg.Database.Name,
		"report":   report,
	}, "", "  ")
	if err != nil {
		log.Fatalf("序列化迁移报告失败: %v", err)
	}
	fmt.Println(string(body))
}

func parseFlags() options {
	var opts options
	flag.StringVar(&opts.configDir, "config-dir", ".", "包含后端配置的目录")
	flag.BoolVar(&opts.apply, "apply", false, "执行定向迁移；默认只读预检")
	flag.StringVar(&opts.expectedHost, "expected-host", "", "写入前必须精确匹配的数据库主机")
	flag.StringVar(&opts.expectedDB, "expected-database", "", "写入前必须精确匹配的数据库名")
	flag.StringVar(&opts.expectedSchema, "expected-schema", "", "写入前必须精确匹配的 schema")
	flag.DurationVar(&opts.timeout, "timeout", 5*time.Minute, "任务超时")
	flag.Parse()
	return opts
}

func validateExpectedTarget(cfg *config.Config, opts options) error {
	if cfg == nil {
		return fmt.Errorf("数据库配置为空")
	}
	actualSchema := strings.TrimSpace(cfg.Database.Schema)
	if actualSchema == "" {
		actualSchema = "public"
	}
	if strings.TrimSpace(opts.expectedHost) == "" || strings.TrimSpace(opts.expectedDB) == "" || strings.TrimSpace(opts.expectedSchema) == "" {
		return fmt.Errorf("--apply 必须同时提供 --expected-host、--expected-database 和 --expected-schema")
	}
	if cfg.Database.Host != opts.expectedHost || cfg.Database.Name != opts.expectedDB || actualSchema != opts.expectedSchema {
		return fmt.Errorf("数据库目标不匹配: actual=%s/%s/%s expected=%s/%s/%s",
			cfg.Database.Host, cfg.Database.Name, actualSchema,
			opts.expectedHost, opts.expectedDB, opts.expectedSchema)
	}
	return nil
}
