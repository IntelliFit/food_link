package e2e

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"food_link/backend/internal/migration"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/gorm"
)

var dbNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type TempDatabase struct {
	Config config.DatabaseConfig
	Name   string
	admin  *gorm.DB
	app    *gorm.DB
	keep   bool
}

func PrepareDatabase(ctx context.Context, suite *Suite, cfg *config.Config) (*TempDatabase, error) {
	dbCfg := cfg.Database
	temp := &TempDatabase{Config: dbCfg, keep: suite.TempDB.Keep}
	if suite.TempDB.Enabled == nil || !*suite.TempDB.Enabled {
		appDB, err := database.Open(dbCfg)
		if err != nil {
			return nil, err
		}
		temp.app = appDB
		if err := migration.AutoMigrate(ctx, appDB, dbCfg.Schema); err != nil {
			_ = temp.Close(ctx)
			return nil, err
		}
		return temp, nil
	}

	now := time.Now().UTC()
	name := fmt.Sprintf("%s_%s_%09d", suite.TempDB.NamePrefix, now.Format("20060102150405"), now.Nanosecond())
	name = strings.ToLower(name)
	if !dbNamePattern.MatchString(name) {
		return nil, fmt.Errorf("invalid generated temp database name %q", name)
	}

	adminCfg := dbCfg
	adminCfg.Name = suite.TempDB.AdminDatabase
	adminDB, err := database.Open(adminCfg)
	if err != nil {
		return nil, fmt.Errorf("open admin database %q: %w", adminCfg.Name, err)
	}
	if err := adminDB.WithContext(ctx).Exec("CREATE DATABASE " + quoteDBIdent(name)).Error; err != nil {
		_ = closeGorm(adminDB)
		return nil, fmt.Errorf("create temp database %q: %w", name, err)
	}

	dbCfg.Name = name
	appDB, err := database.Open(dbCfg)
	if err != nil {
		_ = dropDatabase(ctx, adminDB, name)
		_ = closeGorm(adminDB)
		return nil, fmt.Errorf("open temp database %q: %w", name, err)
	}
	if err := migration.AutoMigrate(ctx, appDB, dbCfg.Schema); err != nil {
		_ = closeGorm(appDB)
		_ = dropDatabase(ctx, adminDB, name)
		_ = closeGorm(adminDB)
		return nil, fmt.Errorf("migrate temp database %q: %w", name, err)
	}

	temp.Config = dbCfg
	temp.Name = name
	temp.admin = adminDB
	temp.app = appDB
	return temp, nil
}

func (t *TempDatabase) Close(ctx context.Context) error {
	var firstErr error
	if t.app != nil {
		if err := closeGorm(t.app); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if t.Name != "" && t.admin != nil && !t.keep {
		if err := dropDatabase(ctx, t.admin, t.Name); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if t.admin != nil {
		if err := closeGorm(t.admin); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (t *TempDatabase) DB() *gorm.DB {
	return t.app
}

func dropDatabase(ctx context.Context, db *gorm.DB, name string) error {
	if !dbNamePattern.MatchString(name) {
		return fmt.Errorf("invalid temp database name %q", name)
	}
	if err := db.WithContext(ctx).Exec(
		`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()`,
		name,
	).Error; err != nil {
		return err
	}
	return db.WithContext(ctx).Exec("DROP DATABASE IF EXISTS " + quoteDBIdent(name)).Error
}

func quoteDBIdent(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func closeGorm(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}
