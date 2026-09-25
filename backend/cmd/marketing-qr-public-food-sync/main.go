package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"food_link/backend/internal/marketingqr/publicfoodsync"
	publicfoodrepo "food_link/backend/internal/publicfood/repo"
	publicfoodservice "food_link/backend/internal/publicfood/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type commandReport struct {
	DatabaseTarget       string `json:"database_target"`
	Environment          string `json:"environment"`
	Apply                bool   `json:"apply"`
	MapServiceSpotCount  int    `json:"map_service_spot_count"`
	SanshengxiaoSpotFood int    `json:"sanshengxiao_spot_food_count"`
	publicfoodsync.Report
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing backend configuration")
	apply := flag.Bool("apply", false, "write missing 三生晓 products into public_food_library")
	confirmEnvironment := flag.String("confirm-environment", "", "required with --apply; must equal app.env")
	confirmHost := flag.String("confirm-host", "", "required with --apply; must equal database.host")
	confirmDatabase := flag.String("confirm-database", "", "required with --apply; must equal database.name")
	timeout := flag.Duration("timeout", 2*time.Minute, "sync timeout")
	flag.Parse()

	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	schema := strings.TrimSpace(cfg.Database.Schema)
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		log.Fatalf("数据库 schema 非法: %q", schema)
	}
	if *apply {
		if strings.TrimSpace(*confirmEnvironment) == "" || strings.TrimSpace(*confirmHost) == "" || strings.TrimSpace(*confirmDatabase) == "" {
			log.Fatal("--apply 必须同时提供 --confirm-environment、--confirm-host 和 --confirm-database")
		}
		if cfg.App.Env != *confirmEnvironment || cfg.Database.Host != *confirmHost || cfg.Database.Name != *confirmDatabase {
			log.Fatalf("目标库确认不匹配: environment=%s host=%s database=%s", cfg.App.Env, cfg.Database.Host, cfg.Database.Name)
		}
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
	if err := db.WithContext(ctx).Exec("SET search_path TO " + schema).Error; err != nil {
		log.Fatalf("设置数据库 schema 失败: %v", err)
	}

	report, err := publicfoodsync.New(db).Run(ctx, *apply)
	if err != nil {
		log.Fatalf("同步三生晓公共食物失败: %v", err)
	}
	spots, err := publicfoodservice.NewPublicFoodService(publicfoodrepo.NewPublicFoodRepo(db)).ListMapSpots(ctx, "")
	if err != nil {
		log.Fatalf("验证美食地图聚合失败: %v", err)
	}
	sanshengxiaoSpotFood := 0
	for _, spot := range spots {
		if spot.LocationName == report.MerchantName || spot.FeaturedItem.MerchantName == report.MerchantName {
			sanshengxiaoSpotFood = spot.FoodCount
			break
		}
	}
	output := commandReport{
		DatabaseTarget:       fmt.Sprintf("%s/%s/%s", cfg.Database.Host, cfg.Database.Name, schema),
		Environment:          cfg.App.Env,
		Apply:                *apply,
		MapServiceSpotCount:  len(spots),
		SanshengxiaoSpotFood: sanshengxiaoSpotFood,
		Report:               report,
	}
	payload, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		log.Fatalf("编码同步报告失败: %v", err)
	}
	fmt.Println(string(payload))
}
