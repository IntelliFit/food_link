package database

import (
	"context"
	"fmt"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/metrics"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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
	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true,
	}), &gorm.Config{
		Logger: newGORMLogger(),
	})
	if err != nil {
		return nil, err
	}
	registerGORMLogCallbacks(db)
	metrics.RegisterGORMCallbacks(db)
	if sqlDB, err := db.DB(); err == nil {
		metrics.RegisterDatabase(cfg.Name, sqlDB)
	}
	return db, nil
}

func Ping(ctx context.Context, db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	sqlDB.SetConnMaxLifetime(5 * time.Minute)
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(5)
	start := time.Now()
	err = sqlDB.PingContext(ctx)
	status := "success"
	if err != nil {
		status = "error"
	}
	driver := "unknown"
	if db.Dialector != nil {
		driver = db.Dialector.Name()
	}
	metrics.ObserveDBPing(driver, status, time.Since(start))
	return err
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
