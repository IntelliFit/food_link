package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"

	"gorm.io/gorm"
)

var foodNutritionContributionDependencies = []string{
	"weapp_user",
	"admin_accounts",
	"food_nutrition_library",
	"user_custom_foods",
}

var foodNutritionContributionConstraintNames = []string{
	"food_nutrition_contributions_status_check",
	"food_nutrition_contributions_review_action_check",
	"food_nutrition_contributions_nutrition_check",
	"food_nutrition_contributions_user_id_fkey",
	"food_nutrition_contributions_reviewed_by_fkey",
	"food_nutrition_contributions_target_food_id_fkey",
	"food_nutrition_contributions_legacy_custom_food_id_fkey",
}

var foodNutritionContributionIndexNames = []string{
	"idx_food_nutrition_contributions_user_created",
	"idx_food_nutrition_contributions_status_name",
	"idx_food_nutrition_contributions_target_food",
	"idx_food_nutrition_contributions_legacy_custom",
	"idx_food_nutrition_contributions_pending_user_name",
}

type FoodNutritionContributionMigrationReport struct {
	Schema                   string   `json:"schema"`
	TableExisted             bool     `json:"table_existed"`
	TableExists              bool     `json:"table_exists"`
	LegacyPendingRows        int64    `json:"legacy_pending_rows"`
	ContributionRowsBefore   int64    `json:"contribution_rows_before"`
	ContributionRowsAfter    int64    `json:"contribution_rows_after"`
	BackfilledRows           int64    `json:"backfilled_rows"`
	MissingDependencies      []string `json:"missing_dependencies,omitempty"`
	MissingConstraints       []string `json:"missing_constraints,omitempty"`
	MissingIndexes           []string `json:"missing_indexes,omitempty"`
	SchemaVerificationPassed bool     `json:"schema_verification_passed"`
}

// InspectFoodNutritionContributions is read-only and reports whether the
// contribution queue can be migrated safely in the selected schema.
func InspectFoodNutritionContributions(ctx context.Context, db *gorm.DB, schema string) (*FoodNutritionContributionMigrationReport, error) {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return nil, fmt.Errorf("set search path: %w", err)
	}
	report := &FoodNutritionContributionMigrationReport{Schema: schema}
	for _, table := range foodNutritionContributionDependencies {
		if !db.Migrator().HasTable(table) {
			report.MissingDependencies = append(report.MissingDependencies, table)
		}
	}
	if db.Migrator().HasTable(&migrationdo.UserCustomFoodDO{}) {
		if err := db.WithContext(ctx).Table("user_custom_foods").Where("public_status = ?", "pending").Count(&report.LegacyPendingRows).Error; err != nil {
			return nil, fmt.Errorf("count legacy pending custom foods: %w", err)
		}
	}
	report.TableExisted = db.Migrator().HasTable(&migrationdo.FoodNutritionContributionDO{})
	report.TableExists = report.TableExisted
	if report.TableExists {
		if err := db.WithContext(ctx).Table("food_nutrition_contributions").Count(&report.ContributionRowsBefore).Error; err != nil {
			return nil, fmt.Errorf("count contribution rows: %w", err)
		}
		report.ContributionRowsAfter = report.ContributionRowsBefore
		if err := inspectFoodNutritionContributionSchema(ctx, db, report); err != nil {
			return nil, err
		}
		report.SchemaVerificationPassed = len(report.MissingConstraints) == 0 && len(report.MissingIndexes) == 0
	}
	return report, nil
}

// MigrateFoodNutritionContributions creates only the standard-food user review
// queue, its constraints/indexes/foreign keys, and the idempotent legacy
// pending-row backfill. It deliberately excludes all unrelated migrations.
func MigrateFoodNutritionContributions(ctx context.Context, db *gorm.DB, schema string) (*FoodNutritionContributionMigrationReport, error) {
	preflight, err := InspectFoodNutritionContributions(ctx, db, schema)
	if err != nil {
		return nil, err
	}
	if len(preflight.MissingDependencies) > 0 {
		return nil, fmt.Errorf("food nutrition contribution migration dependencies are missing: %v", preflight.MissingDependencies)
	}
	if err := prepareSchema(ctx, db, preflight.Schema); err != nil {
		return nil, err
	}

	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(preflight.Schema)).Error; err != nil {
			return fmt.Errorf("set transaction search path: %w", err)
		}
		if err := tx.AutoMigrate(&migrationdo.FoodNutritionContributionDO{}); err != nil {
			return fmt.Errorf("auto migrate food nutrition contributions: %w", err)
		}
		for _, statement := range foodNutritionContributionStatements() {
			if err := tx.Exec(statement).Error; err != nil {
				return fmt.Errorf("apply food nutrition contribution schema statement: %w", err)
			}
		}
		if err := ensureFoodNutritionContributionBackfill(ctx, tx); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	verified, err := InspectFoodNutritionContributions(ctx, db, preflight.Schema)
	if err != nil {
		return nil, err
	}
	verified.TableExisted = preflight.TableExisted
	verified.ContributionRowsBefore = preflight.ContributionRowsBefore
	verified.BackfilledRows = verified.ContributionRowsAfter - preflight.ContributionRowsBefore
	if !verified.TableExists || len(verified.MissingConstraints) > 0 || len(verified.MissingIndexes) > 0 {
		return nil, fmt.Errorf("food nutrition contribution schema verification failed: constraints=%v indexes=%v", verified.MissingConstraints, verified.MissingIndexes)
	}
	verified.SchemaVerificationPassed = true
	return verified, nil
}

func foodNutritionContributionStatements() []string {
	return []string{
		dropAndAddCheck("food_nutrition_contributions", "food_nutrition_contributions_status_check", `status = ANY (ARRAY['pending'::text,'approved'::text,'rejected'::text])`),
		dropAndAddCheck("food_nutrition_contributions", "food_nutrition_contributions_review_action_check", `review_action IS NULL OR review_action = ANY (ARRAY['approve_new'::text,'merge_existing'::text,'reject'::text])`),
		dropAndAddCheck("food_nutrition_contributions", "food_nutrition_contributions_nutrition_check", `kcal_per_100g >= 0 AND protein_per_100g >= 0 AND carbs_per_100g >= 0 AND fat_per_100g >= 0`),
		addFK("food_nutrition_contributions_user_id_fkey", "food_nutrition_contributions", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("food_nutrition_contributions_reviewed_by_fkey", "food_nutrition_contributions", "reviewed_by", "admin_accounts", "id", "SET NULL"),
		addFK("food_nutrition_contributions_target_food_id_fkey", "food_nutrition_contributions", "target_food_id", "food_nutrition_library", "id", "SET NULL"),
		addFK("food_nutrition_contributions_legacy_custom_food_id_fkey", "food_nutrition_contributions", "legacy_custom_food_id", "user_custom_foods", "id", "SET NULL"),
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_food_nutrition_contributions_pending_user_name ON food_nutrition_contributions (user_id, normalized_name) WHERE status = 'pending'`,
	}
}

func inspectFoodNutritionContributionSchema(ctx context.Context, db *gorm.DB, report *FoodNutritionContributionMigrationReport) error {
	for _, name := range foodNutritionContributionConstraintNames {
		var exists bool
		if err := db.WithContext(ctx).Raw(`SELECT EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conname = ? AND conrelid = 'food_nutrition_contributions'::regclass
		)`, name).Scan(&exists).Error; err != nil {
			return fmt.Errorf("inspect contribution constraint %s: %w", name, err)
		}
		if !exists {
			report.MissingConstraints = append(report.MissingConstraints, name)
		}
	}
	for _, name := range foodNutritionContributionIndexNames {
		var exists bool
		qualified := quoteIdent(report.Schema) + "." + quoteIdent(name)
		if err := db.WithContext(ctx).Raw("SELECT to_regclass(?) IS NOT NULL", qualified).Scan(&exists).Error; err != nil {
			return fmt.Errorf("inspect contribution index %s: %w", name, err)
		}
		if !exists {
			report.MissingIndexes = append(report.MissingIndexes, name)
		}
	}
	return nil
}
