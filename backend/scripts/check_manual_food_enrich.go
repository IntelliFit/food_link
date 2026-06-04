//go:build ignore

// 一次性检查 catalog enrich。用法：cd backend && go run ./scripts/check_manual_food_enrich.go
package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	utilityrepo "food_link/backend/internal/utility/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	cfg, err := config.Load(".")
	if err != nil {
		fmt.Fprintf(os.Stderr, "load config: %v\n", err)
		os.Exit(1)
	}
	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		cfg.Database.Host, cfg.Database.Port, cfg.Database.User, cfg.Database.Password, cfg.Database.Name, cfg.Database.SSLMode,
	)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		fmt.Fprintf(os.Stderr, "db: %v\n", err)
		os.Exit(1)
	}
	ctx := context.Background()
	repo := utilityrepo.NewManualFoodRepo(db, storage.New(cfg.Storage))
	catalog, err := repo.Catalog(ctx, "", "common", 1, 8)
	if err != nil {
		fmt.Fprintf(os.Stderr, "catalog: %v\n", err)
		os.Exit(1)
	}
	for _, item := range catalog.Items {
		img := ""
		if item.ImagePath != nil {
			img = *item.ImagePath
		}
		fmt.Printf("%s id=%s image_path=%s\n", item.Title, item.ID, trim(img))
	}
}

func trim(s string) string {
	if len(s) > 120 {
		return s[:120] + "..."
	}
	return strings.TrimSpace(s)
}
