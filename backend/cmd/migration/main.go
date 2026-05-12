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
	flag.Parse()

	cfg, resolvedDir, err := loadConfig(*configDir)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("get sql db: %v", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("ping database: %v", err)
	}
	if err := migration.AutoMigrate(ctx, db, cfg.Database.Schema); err != nil {
		log.Fatalf("auto migrate: %v", err)
	}
	schema := cfg.Database.Schema
	if schema == "" {
		schema = "public"
	}
	log.Printf("migration completed: config_dir=%s schema=%s", resolvedDir, schema)
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
