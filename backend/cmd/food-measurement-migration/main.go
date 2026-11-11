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

func main() {
	configDir := flag.String("config-dir", ".", "包含后端配置的目录")
	apply := flag.Bool("apply", false, "添加自定义食物measurement列；默认只读预检")
	host := flag.String("expected-host", "", "写入前精确匹配的数据库主机")
	name := flag.String("expected-database", "", "写入前精确匹配的数据库名")
	schema := flag.String("expected-schema", "", "写入前精确匹配的schema")
	flag.Parse()
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatal("加载配置失败: ", err)
	}
	actualSchema := strings.TrimSpace(cfg.Database.Schema)
	if actualSchema == "" {
		actualSchema = "public"
	}
	if *apply && (*host == "" || *name == "" || *schema == "" || *host != cfg.Database.Host || *name != cfg.Database.Name || *schema != actualSchema) {
		log.Fatal("执行迁移须明确提供并匹配 expected-host / expected-database / expected-schema")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatal("连接数据库失败: ", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal(err)
	}
	defer sqlDB.Close()
	var report *migration.FoodMeasurementReport
	if *apply {
		report, err = migration.MigrateFoodMeasurements(ctx, db, actualSchema)
	} else {
		report, err = migration.InspectFoodMeasurements(ctx, db, actualSchema)
	}
	if err != nil {
		log.Fatal("食物单位定向迁移失败: ", err)
	}
	body, err := json.Marshal(map[string]any{"applied": *apply, "report": report})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(body))
}
