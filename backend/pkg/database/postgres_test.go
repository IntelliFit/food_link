package database

import (
	"context"
	"testing"
	"time"

	"food_link/backend/pkg/config"
)

func TestPingWithEnvConfig(t *testing.T) {
	cfg, err := config.Load("../..")
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.Database.Host == "" || cfg.Database.User == "" || cfg.Database.Name == "" {
		t.Skip("database env not configured")
	}
	db, err := Open(cfg.Database)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := Ping(ctx, db); err != nil {
		t.Fatalf("ping database: %v", err)
	}
}
