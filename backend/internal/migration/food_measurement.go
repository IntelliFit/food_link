package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

type FoodMeasurementReport struct {
	Schema       string `json:"schema"`
	TableExists  bool   `json:"table_exists"`
	ColumnExists bool   `json:"column_exists"`
	ColumnType   string `json:"column_type"`
}

// InspectFoodMeasurements only reads the selected schema and never backfills data.
func InspectFoodMeasurements(ctx context.Context, db *gorm.DB, schema string) (*FoodMeasurementReport, error) {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("invalid database schema: %q", schema)
	}
	report := &FoodMeasurementReport{Schema: schema}
	if err := db.WithContext(ctx).Raw(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = 'user_custom_foods')`, schema).Scan(&report.TableExists).Error; err != nil {
		return nil, err
	}
	var dataType string
	if err := db.WithContext(ctx).Raw(`SELECT COALESCE(MAX(data_type), '') FROM information_schema.columns WHERE table_schema = ? AND table_name = 'user_custom_foods' AND column_name = 'measurement'`, schema).Scan(&dataType).Error; err != nil {
		return nil, err
	}
	report.ColumnType, report.ColumnExists = dataType, dataType != ""
	return report, nil
}

// MigrateFoodMeasurements adds only the nullable native-unit snapshot column.
// It deliberately leaves every legacy gram value and existing record unchanged.
func MigrateFoodMeasurements(ctx context.Context, db *gorm.DB, schema string) (*FoodMeasurementReport, error) {
	before, err := InspectFoodMeasurements(ctx, db, schema)
	if err != nil {
		return nil, err
	}
	if !before.TableExists {
		return nil, fmt.Errorf("user_custom_foods is missing in schema %s", before.Schema)
	}
	if before.ColumnExists && before.ColumnType != "jsonb" {
		return nil, fmt.Errorf("measurement column has unexpected type: %s", before.ColumnType)
	}
	if !before.ColumnExists {
		if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(before.Schema)).Error; err != nil {
				return err
			}
			return tx.Migrator().AddColumn(&migrationdo.UserCustomFoodDO{}, "Measurement")
		}); err != nil {
			return nil, fmt.Errorf("add food measurement column: %w", err)
		}
	}
	after, err := InspectFoodMeasurements(ctx, db, before.Schema)
	if err != nil {
		return nil, err
	}
	if !after.ColumnExists || after.ColumnType != "jsonb" {
		return nil, fmt.Errorf("food measurement schema verification failed")
	}
	return after, nil
}
