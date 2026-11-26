package migration

import (
	"context"
	"fmt"
	"log/slog"
	"sort"

	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/logger"
	"gorm.io/gorm"
)

// MigrateNullableNutrition only changes the ordinary-food nutrient contract.
// Historical zeros are NOT guessed to be missing: repair requires source evidence.
func MigrateNullableNutrition(ctx context.Context, db *gorm.DB, schema string) error {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("数据库schema名称无效")
	}
	columns := make([]string, 0, len(domain.NutritionFields))
	for c := range domain.NutritionFields {
		columns = append(columns, c)
	}
	sort.Strings(columns)
	logger.Info(ctx, "开始迁移普通食物未知营养值", slog.Int("columns", len(columns)), slog.String("schema", schema))
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if e := tx.Exec("SET LOCAL lock_timeout = '5s'").Error; e != nil {
			return e
		}
		if e := tx.Exec("SET LOCAL statement_timeout = '60s'").Error; e != nil {
			return e
		}
		if e := tx.Exec("SELECT pg_advisory_xact_lock(704631921178)").Error; e != nil {
			return e
		}
		table := `"` + schema + `"."food_nutrition_library"`
		for _, c := range columns {
			if e := tx.Exec("ALTER TABLE " + table + ` ALTER COLUMN "` + c + `" DROP NOT NULL, ALTER COLUMN "` + c + `" DROP DEFAULT`).Error; e != nil {
				return fmt.Errorf("迁移营养字段%s失败: %w", c, e)
			}
		}
		return nil
	})
	if err != nil {
		logger.Error(ctx, "普通食物未知营养值迁移失败", err)
		return err
	}
	logger.Info(ctx, "普通食物未知营养值迁移完成", slog.Int("columns", len(columns)))
	return nil
}
