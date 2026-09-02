package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	openplatformdomain "food_link/backend/internal/openplatform/domain"
	openrepo "food_link/backend/internal/openplatform/repo"
	openservice "food_link/backend/internal/openplatform/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

func main() {
	configDir := flag.String("config-dir", ".", "directory containing config.yaml")
	action := flag.String("action", "create-app", "create-app, top-up, or upsert-package")
	confirmDB := flag.String("confirm-db", "", "required; must equal host/database/schema")
	name := flag.String("name", "", "developer app name for create-app")
	apiKeyOutput := flag.String("api-key-output", "", "optional path for writing the one-time API key with restrictive permissions")
	initialUnits := flag.Int64("initial-units", 1000, "promotional units for create-app")
	scopes := flag.String("scopes", openservice.ScopeFoodAnalyze+","+openservice.ScopeFoodSearch, "comma-separated scopes")
	appID := flag.String("app-id", "", "target app id for top-up")
	units := flag.Int64("units", 0, "units to add for top-up")
	reference := flag.String("reference", "", "unique payment or manual grant reference for top-up")
	description := flag.String("description", "人工充值 API 点数", "ledger description for top-up")
	packageCode := flag.String("package-code", "", "credit package code for upsert-package")
	packageName := flag.String("package-name", "", "credit package display name")
	amountFen := flag.Int("amount-fen", 0, "credit package price in CNY fen")
	active := flag.Bool("active", false, "whether the credit package is publicly purchasable")
	sortOrder := flag.Int("sort-order", 0, "credit package display order")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	target := databaseTarget(cfg.Database.Host, cfg.Database.Name, cfg.Database.Schema)
	if strings.TrimSpace(*confirmDB) != target {
		log.Fatalf("写入保护未通过：--confirm-db 必须为 %q", target)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}

	repository := openrepo.New(db)
	platform := openservice.New(repository, nil, nil, nil)
	switch strings.ToLower(strings.TrimSpace(*action)) {
	case "create-app":
		material, err := platform.CreateBetaApp(ctx, *name, *initialUnits, splitCSV(*scopes))
		if err != nil {
			log.Fatalf("创建开放平台应用失败: %v", err)
		}
		body, _ := json.MarshalIndent(map[string]any{
			"app_id":        material.App.ID,
			"app_name":      material.App.Name,
			"balance_units": material.App.BalanceUnits,
			"key_prefix":    material.APIKey.KeyPrefix,
			"scopes":        material.APIKey.Scopes,
			"api_key":       material.Secret,
			"warning":       "api_key 只显示这一次，请立即保存到密码管理器或密钥系统",
		}, "", "  ")
		if outputPath := strings.TrimSpace(*apiKeyOutput); outputPath != "" {
			file, err := os.OpenFile(outputPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
			if err != nil {
				log.Fatalf("创建 API Key 输出文件失败: %v", err)
			}
			if _, err := file.WriteString(material.Secret + "\n"); err != nil {
				_ = file.Close()
				log.Fatalf("写入 API Key 输出文件失败: %v", err)
			}
			if err := file.Close(); err != nil {
				log.Fatalf("关闭 API Key 输出文件失败: %v", err)
			}
			body, _ = json.MarshalIndent(map[string]any{
				"app_id":              material.App.ID,
				"app_name":            material.App.Name,
				"balance_units":       material.App.BalanceUnits,
				"key_prefix":          material.APIKey.KeyPrefix,
				"scopes":              material.APIKey.Scopes,
				"api_key_output_file": outputPath,
				"warning":             "API Key 已写入本地文件，终端不会显示明文",
			}, "", "  ")
		}
		fmt.Println(string(body))
	case "top-up":
		if strings.TrimSpace(*appID) == "" || *units <= 0 || strings.TrimSpace(*reference) == "" {
			log.Fatal("top-up 必须提供 --app-id、正数 --units 和唯一 --reference")
		}
		balance, created, err := platform.TopUp(ctx, strings.TrimSpace(*appID), *units, strings.TrimSpace(*reference), *description)
		if err != nil {
			log.Fatalf("充值开放平台点数失败: %v", err)
		}
		body, _ := json.MarshalIndent(map[string]any{
			"app_id":        strings.TrimSpace(*appID),
			"balance_units": balance,
			"created":       created,
			"reference":     strings.TrimSpace(*reference),
		}, "", "  ")
		fmt.Println(string(body))
	case "upsert-package":
		if strings.TrimSpace(*packageCode) == "" || strings.TrimSpace(*packageName) == "" || *units <= 0 || *amountFen <= 0 {
			log.Fatal("upsert-package 必须提供 --package-code、--package-name、正数 --units 和 --amount-fen")
		}
		creditPackage := &openplatformdomain.CreditPackage{Code: strings.TrimSpace(*packageCode), Name: strings.TrimSpace(*packageName), Description: strings.TrimSpace(*description), Units: *units, AmountFen: *amountFen, IsActive: *active, SortOrder: *sortOrder}
		if err := repository.UpsertCreditPackage(ctx, creditPackage); err != nil {
			log.Fatalf("保存 API 点数套餐失败: %v", err)
		}
		body, _ := json.MarshalIndent(creditPackage, "", "  ")
		fmt.Println(string(body))
	default:
		log.Fatalf("未知 action: %s", *action)
	}
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}

func databaseTarget(host, name, schema string) string {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		schema = "public"
	}
	return fmt.Sprintf("%s/%s/%s", strings.TrimSpace(host), strings.TrimSpace(name), schema)
}
