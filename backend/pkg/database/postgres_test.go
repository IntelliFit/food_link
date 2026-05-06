package database

import (
	"context"
	"testing"
	"time"

	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
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

func TestOpen(t *testing.T) {
	// Use sqlite to test Open without needing real postgres
	// Since Open is hardcoded to use postgres driver, we test the DSN generation indirectly
	cfg := config.DatabaseConfig{
		Host:     "localhost",
		Port:     5432,
		User:     "test",
		Password: "test",
		Name:     "test",
		SSLMode:  "disable",
	}
	// This will fail since we're not connecting to real postgres
	_, err := Open(cfg)
	// We expect an error but verify it doesn't panic
	assert.Error(t, err)
}

func TestPing_WithSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	ctx := context.Background()
	err = Ping(ctx, db)
	require.NoError(t, err)
}

func TestCheckSchemaReady(t *testing.T) {
	// This test requires a real PostgreSQL connection since CheckSchemaReady
	// uses PostgreSQL-specific information_schema.tables query
	cfg, err := config.Load("../..")
	require.NoError(t, err)
	if cfg.Database.Host == "" || cfg.Database.User == "" || cfg.Database.Name == "" {
		t.Skip("database env not configured")
	}

	db, err := Open(cfg.Database)
	if err != nil {
		t.Skipf("could not connect to postgres: %v", err)
	}

	ctx := context.Background()

	// Table missing
	err = CheckSchemaReady(ctx, db, "missing_table_"+time.Now().Format("20060102150405"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing table:")
}
