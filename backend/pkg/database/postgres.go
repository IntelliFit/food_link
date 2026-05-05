package database

import (
	"context"
	"fmt"
	"time"

	"food_link/backend/pkg/config"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	glogger "gorm.io/gorm/logger"
)

func Open(cfg config.DatabaseConfig) (*gorm.DB, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		cfg.Host,
		cfg.Port,
		cfg.User,
		cfg.Password,
		cfg.Name,
		cfg.SSLMode,
	)
	return gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: glogger.Default.LogMode(glogger.Silent),
	})
}

func Ping(ctx context.Context, db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	sqlDB.SetConnMaxLifetime(5 * time.Minute)
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(5)
	return sqlDB.PingContext(ctx)
}

func CheckSchemaReady(ctx context.Context, db *gorm.DB, tables ...string) error {
	for _, table := range tables {
		var exists bool
		query := `
SELECT EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = current_schema()
    AND table_name = ?
)`
		if err := db.WithContext(ctx).Raw(query, table).Scan(&exists).Error; err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("missing table: %s", table)
		}
	}
	return nil
}
