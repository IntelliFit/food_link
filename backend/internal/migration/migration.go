package migration

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	migrationdo "food_link/backend/internal/migration/do"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

//go:embed data/official_higher_education_2026.json.gz.b64
var officialHigherEducation2026Data string

var identifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

var growthPerformanceIndexes = []struct {
	name       string
	table      string
	definition string
}{
	{"idx_feed_interaction_notifications_recipient_created", "feed_interaction_notifications", "(recipient_user_id, created_at DESC, id DESC)"},
	{"idx_user_food_records_user_record_time", "user_food_records", "(user_id, record_time DESC, id DESC)"},
	{"idx_user_food_records_user_created", "user_food_records", "(user_id, created_at DESC, id DESC)"},
	{"idx_user_food_records_feed_created", "user_food_records", "(created_at DESC, id DESC) WHERE hidden_from_feed = false"},
	{"idx_user_exercise_logs_user_created", "user_exercise_logs", "(user_id, created_at DESC, id DESC) WHERE hidden_from_feed = false"},
	{"idx_user_exercise_logs_feed_created", "user_exercise_logs", "(created_at DESC, id DESC) WHERE hidden_from_feed = false"},
	{"idx_user_circle_posts_user_created_page", "user_circle_posts", "(user_id, created_at DESC, id DESC) WHERE hidden_from_feed = false"},
	{"idx_user_circle_posts_feed_created", "user_circle_posts", "(created_at DESC, id DESC) WHERE hidden_from_feed = false"},
	{"idx_user_weight_records_daily_latest", "user_weight_records", "(user_id, recorded_on, created_at DESC, id DESC)"},
}

// MigrateGrowthPerformanceIndexes applies only the indexes used by the
// growth-sensitive feed, notification, and body-summary reads. It deliberately
// avoids AutoMigrate, data backfills, seeds, and unrelated schema changes.
func MigrateGrowthPerformanceIndexes(ctx context.Context, db *gorm.DB, schema string) error {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("get database connection pool: %w", err)
	}
	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("pin database connection: %w", err)
	}
	defer conn.Close()

	for _, index := range growthPerformanceIndexes {
		var valid bool
		err := conn.QueryRowContext(ctx, `
			SELECT i.indisvalid
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			JOIN pg_index i ON i.indexrelid = c.oid
			WHERE n.nspname = $1 AND c.relname = $2
		`, schema, index.name).Scan(&valid)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("inspect growth performance index %s: %w", index.name, err)
		}
		if err == nil && !valid {
			dropSQL := "DROP INDEX CONCURRENTLY " + quoteIdent(schema) + "." + quoteIdent(index.name)
			if _, err := conn.ExecContext(ctx, dropSQL); err != nil {
				return fmt.Errorf("drop invalid growth performance index %s: %w", index.name, err)
			}
		}

		createSQL := "CREATE INDEX CONCURRENTLY IF NOT EXISTS " + quoteIdent(index.name) +
			" ON " + quoteIdent(schema) + "." + quoteIdent(index.table) + " " + index.definition
		if _, err := conn.ExecContext(ctx, createSQL); err != nil {
			return fmt.Errorf("create growth performance index %s: %w", index.name, err)
		}
	}
	return nil
}

func AutoMigrate(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	if err := db.WithContext(ctx).AutoMigrate(migrationdo.AllModels()...); err != nil {
		return fmt.Errorf("auto migrate models: %w", err)
	}
	if err := ensureOnboardingStatus(ctx, db); err != nil {
		return err
	}
	if err := ensureConstraints(ctx, db); err != nil {
		return err
	}
	if err := ensureNutritionQualityConstraints(ctx, db); err != nil {
		return err
	}
	if err := ensureNutritionEmbeddingConstraints(ctx, db); err != nil {
		return err
	}
	if err := ensureIndexes(ctx, db); err != nil {
		return err
	}
	if err := ensureFoodNutritionContributionBackfill(ctx, db); err != nil {
		return err
	}
	if err := ensureNutritionQualityBackfill(ctx, db); err != nil {
		return err
	}
	if err := ensureUsdaNutrientMappingBackfill(ctx, db); err != nil {
		return err
	}
	if err := ensureCommonFoodStateSeed(ctx, db); err != nil {
		return err
	}
	if err := ensureTrialEntitlementIndexes(ctx, db); err != nil {
		return err
	}
	if err := ensureExerciseEnergySeed(ctx, db); err != nil {
		return err
	}
	if err := ensureSupplementCatalogSeed(ctx, db); err != nil {
		return err
	}
	if err := ensurePublicFoodTypeBackfill(ctx, db); err != nil {
		return err
	}
	if err := ensureTrialEntitlementBackfill(ctx, db); err != nil {
		return err
	}
	if err := ensureDeferredRegistrationTrialCompensation(ctx, db); err != nil {
		return err
	}
	if err := ensureRegistrationTrialVouchersAutoApplied(ctx, db); err != nil {
		return err
	}
	if err := ensureDeferredInviteRewards(ctx, db); err != nil {
		return err
	}
	if err := ensureTriggers(ctx, db); err != nil {
		return err
	}
	if err := ensureSchoolsSeed(ctx, db); err != nil {
		return err
	}
	if err := ensureDiningLocationType(ctx, db); err != nil {
		return err
	}
	if err := ensureOfficialHigherEducationDirectory(ctx, db); err != nil {
		return err
	}
	if err := retireLegacyHigherEducationSeedRows(ctx, db); err != nil {
		return err
	}
	if err := ensureCampusDirectorySeed(ctx, db); err != nil {
		return err
	}
	if err := ensureCampusDirectoryImportBatchSeed(ctx, db); err != nil {
		return err
	}
	// Importing or approving reviewed campus-directory data is an explicit
	// release action. Keep it behind the dedicated migration command so a
	// routine schema migration cannot publish or rewrite directory records.
	if err := ensurePublicFoodCampusDirectoryBackfill(ctx, db); err != nil {
		return err
	}
	if err := ensureMottoColumn(ctx, db); err != nil {
		return err
	}
	if err := ensurePublicRecordsDefault(ctx, db); err != nil {
		return err
	}
	if err := ensurePublicFavoriteRecipesDefault(ctx, db); err != nil {
		return err
	}
	if err := ensureRecipeIDColumn(ctx, db); err != nil {
		return err
	}
	if err := ensureAdminResolutionColumns(ctx, db); err != nil {
		return err
	}
	if err := ensureFoodWeightLabeledSamplesStructuredLabels(ctx, db); err != nil {
		return err
	}
	if err := ensurePaymentTestConfig(ctx, db); err != nil {
		return err
	}
	if err := ensureMembershipGrantConfig(ctx, db); err != nil {
		return err
	}
	return ensurePapayContractIndexes(ctx, db)
}

// ensureOnboardingStatus verifies the additive lifecycle column exists. It must
// not backfill existing rows: nil is intentionally interpreted from the legacy
// boolean so this migration never changes user data.
func ensureOnboardingStatus(ctx context.Context, db *gorm.DB) error {
	if !db.Migrator().HasColumn(&migrationdo.UserDO{}, "onboarding_status") {
		return fmt.Errorf("missing onboarding_status column after auto migrate")
	}
	if !db.Migrator().HasColumn(&migrationdo.UserDO{}, "onboarding_draft_step") {
		return fmt.Errorf("missing onboarding_draft_step column after auto migrate")
	}
	return nil
}

func ensureFoodNutritionContributionBackfill(ctx context.Context, db *gorm.DB) error {
	if !db.Migrator().HasTable(&migrationdo.UserCustomFoodDO{}) || !db.Migrator().HasTable(&migrationdo.FoodNutritionContributionDO{}) {
		return nil
	}
	statement := `
		INSERT INTO food_nutrition_contributions (
			user_id, canonical_name, normalized_name,
			kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
			source_text, evidence_image_paths, extra_nutrients, status,
			legacy_custom_food_id, created_at, updated_at
		)
		SELECT
			user_id, title, normalized_title,
			GREATEST(COALESCE(CASE WHEN trim(nutrients_per_100g->>'calories') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN (nutrients_per_100g->>'calories')::numeric END, total_calories * 100 / NULLIF(default_weight_grams, 0), 0), 0),
			GREATEST(COALESCE(CASE WHEN trim(nutrients_per_100g->>'protein') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN (nutrients_per_100g->>'protein')::numeric END, total_protein * 100 / NULLIF(default_weight_grams, 0), 0), 0),
			GREATEST(COALESCE(CASE WHEN trim(nutrients_per_100g->>'carbs') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN (nutrients_per_100g->>'carbs')::numeric END, total_carbs * 100 / NULLIF(default_weight_grams, 0), 0), 0),
			GREATEST(COALESCE(CASE WHEN trim(nutrients_per_100g->>'fat') ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' THEN (nutrients_per_100g->>'fat')::numeric END, total_fat * 100 / NULLIF(default_weight_grams, 0), 0), 0),
			'历史自定义食物公共库待审核记录', COALESCE(image_paths, '[]'::jsonb), COALESCE(extra_nutrients, '{}'::jsonb), 'pending',
			id, COALESCE(created_at, now()), COALESCE(updated_at, now())
		FROM user_custom_foods
		WHERE public_status = 'pending'
		ON CONFLICT (legacy_custom_food_id) DO NOTHING`
	if err := db.WithContext(ctx).Exec(statement).Error; err != nil {
		return fmt.Errorf("backfill legacy food nutrition contributions: %w", err)
	}
	return nil
}

// MigratePapayContracts applies only the automatic-renewal schema changes.
func MigratePapayContracts(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	if err := db.WithContext(ctx).AutoMigrate(&migrationdo.PapayContractDO{}); err != nil {
		return fmt.Errorf("auto migrate papay contract: %w", err)
	}
	return ensurePapayContractIndexes(ctx, db)
}

// MigrateNutritionQuality applies only the nutrition trust-boundary schema and
// deterministic source backfill. It is safe to run repeatedly and deliberately
// excludes unrelated migrations in a dirty development worktree.
func MigrateNutritionQuality(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	if err := db.WithContext(ctx).AutoMigrate(
		&migrationdo.FoodNutritionDO{},
		&migrationdo.FoodNutritionAliasDO{},
	); err != nil {
		return fmt.Errorf("auto migrate nutrition quality: %w", err)
	}
	if err := ensureNutritionQualityConstraints(ctx, db); err != nil {
		return err
	}
	if err := ensureNutritionQualityBackfill(ctx, db); err != nil {
		return err
	}
	return ensureCommonFoodStateSeed(ctx, db)
}

// MigrateNutritionStates adds explicit preparation/state dimensions and the
// reviewed common-state anchors without running unrelated application seeds.
func MigrateNutritionStates(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	if err := db.WithContext(ctx).AutoMigrate(
		&migrationdo.FoodNutritionDO{},
		&migrationdo.FoodNutritionAliasDO{},
	); err != nil {
		return fmt.Errorf("auto migrate nutrition states: %w", err)
	}
	if err := ensureNutritionQualityConstraints(ctx, db); err != nil {
		return err
	}
	return ensureCommonFoodStateSeed(ctx, db)
}

type commonFoodStateSeed struct {
	ID                string
	CanonicalName     string
	NormalizedName    string
	BaseFoodKey       string
	FoodState         string
	WeightBasis       string
	PreparationMethod string
	StateTags         []string
	Kcal              float64
	Protein           float64
	Carbs             float64
	Fat               float64
	FDCID             int
	Aliases           []string
}

type NutritionStateVerificationRow struct {
	ID                string  `gorm:"column:id" json:"id"`
	CanonicalName     string  `gorm:"column:canonical_name" json:"canonical_name"`
	NormalizedName    string  `gorm:"column:normalized_name" json:"normalized_name"`
	BaseFoodKey       string  `gorm:"column:base_food_key" json:"base_food_key"`
	FoodState         string  `gorm:"column:food_state" json:"food_state"`
	WeightBasis       string  `gorm:"column:weight_basis" json:"weight_basis"`
	PreparationMethod string  `gorm:"column:preparation_method" json:"preparation_method"`
	QualityTier       string  `gorm:"column:quality_tier" json:"quality_tier"`
	IsActive          bool    `gorm:"column:is_active" json:"is_active"`
	KcalPer100g       float64 `gorm:"column:kcal_per_100g" json:"kcal_per_100g"`
}

type NutritionStateVerification struct {
	Complete              bool                            `json:"complete"`
	ExpectedCount         int                             `json:"expected_count"`
	FoundCount            int                             `json:"found_count"`
	VisibleCount          int                             `json:"visible_count"`
	StateMetadataCount    int                             `json:"state_metadata_count"`
	ExpectedAliasCount    int                             `json:"expected_alias_count"`
	ApprovedAliasCount    int64                           `json:"approved_alias_count"`
	CompositeIndexPresent bool                            `json:"composite_index_present"`
	MissingNormalized     []string                        `json:"missing_normalized_names"`
	InvalidNormalized     []string                        `json:"invalid_normalized_names"`
	MissingAliases        []string                        `json:"missing_aliases"`
	InvalidAliases        []string                        `json:"invalid_aliases"`
	Rows                  []NutritionStateVerificationRow `json:"rows"`
}

func commonFoodStateSeeds() []commonFoodStateSeed {
	return []commonFoodStateSeed{
		{ID: "a1000000-0000-4000-8000-000000000001", CanonicalName: "土豆（生，带皮可食部）", NormalizedName: "土豆生带皮可食部", BaseFoodKey: "potato", FoodState: "raw", WeightBasis: "raw_edible", PreparationMethod: "raw", StateTags: []string{"生", "带皮", "可食部"}, Kcal: 77, Protein: 2.05, Carbs: 17.5, Fat: 0.09, FDCID: 170026, Aliases: []string{"生土豆（带皮）", "生马铃薯（带皮）"}},
		{ID: "a1000000-0000-4000-8000-000000000002", CanonicalName: "土豆（烤，带皮，无额外油）", NormalizedName: "土豆烤带皮无额外油", BaseFoodKey: "potato", FoodState: "baked", WeightBasis: "cooked_edible", PreparationMethod: "baked_no_added_oil", StateTags: []string{"烤", "带皮", "无额外油"}, Kcal: 93, Protein: 2.5, Carbs: 21.2, Fat: 0.13, FDCID: 170111, Aliases: []string{"无油烤土豆", "烤马铃薯（无额外油）"}},
		{ID: "a1000000-0000-4000-8000-000000000003", CanonicalName: "土豆（水煮，去皮，无盐）", NormalizedName: "土豆水煮去皮无盐", BaseFoodKey: "potato", FoodState: "cooked", WeightBasis: "cooked_edible", PreparationMethod: "boiled", StateTags: []string{"水煮", "去皮", "无盐"}, Kcal: 86, Protein: 1.71, Carbs: 20, Fat: 0.1, FDCID: 170440, Aliases: []string{"水煮土豆（去皮）", "水煮马铃薯（去皮）"}},
		{ID: "a1000000-0000-4000-8000-000000000004", CanonicalName: "马铃薯粉（干）", NormalizedName: "马铃薯粉干", BaseFoodKey: "potato", FoodState: "dry", WeightBasis: "dry", PreparationMethod: "milled_dehydrated", StateTags: []string{"干制", "粉"}, Kcal: 357, Protein: 6.9, Carbs: 83.1, Fat: 0.34, FDCID: 168446, Aliases: []string{"土豆粉（干）"}},
		{ID: "a1000000-0000-4000-8000-000000000005", CanonicalName: "白米（生）", NormalizedName: "白米生", BaseFoodKey: "white_rice", FoodState: "raw", WeightBasis: "dry_raw", PreparationMethod: "uncooked", StateTags: []string{"生", "干重"}, Kcal: 365, Protein: 7.13, Carbs: 80, Fat: 0.66, FDCID: 169756, Aliases: []string{"生白米", "大米（生重）"}},
		{ID: "a1000000-0000-4000-8000-000000000006", CanonicalName: "米饭（白米，熟）", NormalizedName: "米饭白米熟", BaseFoodKey: "white_rice", FoodState: "cooked", WeightBasis: "cooked", PreparationMethod: "boiled", StateTags: []string{"熟", "含水"}, Kcal: 130, Protein: 2.69, Carbs: 28.2, Fat: 0.28, FDCID: 169757, Aliases: []string{"熟白米饭", "白米饭（熟重）"}},
		{ID: "a1000000-0000-4000-8000-000000000007", CanonicalName: "燕麦片（干）", NormalizedName: "燕麦片干", BaseFoodKey: "oats", FoodState: "dry", WeightBasis: "dry", PreparationMethod: "uncooked", StateTags: []string{"干", "未加水"}, Kcal: 379, Protein: 13.2, Carbs: 67.7, Fat: 6.52, FDCID: 173904, Aliases: []string{"干燕麦片", "燕麦片（干重）"}},
		{ID: "a1000000-0000-4000-8000-000000000008", CanonicalName: "燕麦粥（水煮）", NormalizedName: "燕麦粥水煮", BaseFoodKey: "oats", FoodState: "cooked", WeightBasis: "cooked", PreparationMethod: "boiled_with_water", StateTags: []string{"熟", "水煮", "含水"}, Kcal: 71, Protein: 2.54, Carbs: 12, Fat: 1.52, FDCID: 173905, Aliases: []string{"水煮燕麦粥", "熟燕麦片（加水）"}},
		{ID: "a1000000-0000-4000-8000-000000000009", CanonicalName: "意大利面（干）", NormalizedName: "意大利面干", BaseFoodKey: "pasta", FoodState: "dry", WeightBasis: "dry", PreparationMethod: "uncooked", StateTags: []string{"干", "未煮"}, Kcal: 371, Protein: 13, Carbs: 74.7, Fat: 1.51, FDCID: 168927, Aliases: []string{"干意面", "意面（干重）"}},
		{ID: "a1000000-0000-4000-8000-000000000010", CanonicalName: "意大利面（水煮，无盐）", NormalizedName: "意大利面水煮无盐", BaseFoodKey: "pasta", FoodState: "cooked", WeightBasis: "cooked", PreparationMethod: "boiled", StateTags: []string{"熟", "水煮", "含水"}, Kcal: 158, Protein: 5.8, Carbs: 30.9, Fat: 0.93, FDCID: 168928, Aliases: []string{"熟意面（水煮）", "意面（熟重）"}},
		{ID: "a1000000-0000-4000-8000-000000000011", CanonicalName: "红薯（生，可食部）", NormalizedName: "红薯生可食部", BaseFoodKey: "sweet_potato", FoodState: "raw", WeightBasis: "raw_edible", PreparationMethod: "raw", StateTags: []string{"生", "可食部"}, Kcal: 86, Protein: 1.57, Carbs: 20.12, Fat: 0.05, FDCID: 168482, Aliases: []string{"生红薯", "生甘薯"}},
		{ID: "a1000000-0000-4000-8000-000000000012", CanonicalName: "红薯（烤，带皮取肉，无盐无额外油）", NormalizedName: "红薯烤带皮取肉无盐无额外油", BaseFoodKey: "sweet_potato", FoodState: "baked", WeightBasis: "cooked_edible", PreparationMethod: "baked_no_added_oil", StateTags: []string{"烤", "带皮取肉", "无盐", "无额外油"}, Kcal: 90, Protein: 2.01, Carbs: 20.71, Fat: 0.15, FDCID: 168483, Aliases: []string{"烤红薯（无额外油）", "烤地瓜（无额外油）"}},
		{ID: "a1000000-0000-4000-8000-000000000013", CanonicalName: "红薯（水煮，去皮）", NormalizedName: "红薯水煮去皮", BaseFoodKey: "sweet_potato", FoodState: "cooked", WeightBasis: "cooked_edible", PreparationMethod: "boiled", StateTags: []string{"水煮", "去皮", "熟"}, Kcal: 76, Protein: 1.37, Carbs: 17.72, Fat: 0.14, FDCID: 168484, Aliases: []string{"水煮红薯（去皮）", "水煮地瓜（去皮）"}},
		{ID: "a1000000-0000-4000-8000-000000000014", CanonicalName: "鸡蛋（全蛋，生，鲜）", NormalizedName: "鸡蛋全蛋生鲜", BaseFoodKey: "whole_egg", FoodState: "raw", WeightBasis: "raw_edible", PreparationMethod: "raw", StateTags: []string{"全蛋", "生", "鲜"}, Kcal: 143, Protein: 12.56, Carbs: 0.72, Fat: 9.51, FDCID: 171287, Aliases: []string{"生鸡蛋（全蛋）", "鲜鸡蛋（生全蛋）"}},
		{ID: "a1000000-0000-4000-8000-000000000015", CanonicalName: "鸡蛋（全蛋，硬煮）", NormalizedName: "鸡蛋全蛋硬煮", BaseFoodKey: "whole_egg", FoodState: "cooked", WeightBasis: "cooked_edible", PreparationMethod: "hard_boiled", StateTags: []string{"全蛋", "硬煮", "熟"}, Kcal: 155, Protein: 12.58, Carbs: 1.12, Fat: 10.61, FDCID: 173424, Aliases: []string{"水煮鸡蛋（全蛋）", "白煮蛋（全蛋）"}},
		{ID: "a1000000-0000-4000-8000-000000000016", CanonicalName: "鸡蛋（全蛋，煎制）", NormalizedName: "鸡蛋全蛋煎制", BaseFoodKey: "whole_egg", FoodState: "fried", WeightBasis: "cooked_edible", PreparationMethod: "fried", StateTags: []string{"全蛋", "煎制", "熟"}, Kcal: 196, Protein: 13.61, Carbs: 0.83, Fat: 14.84, FDCID: 173423, Aliases: []string{"煎鸡蛋（全蛋，USDA平均）", "煎蛋（全蛋，USDA平均）"}},
		{ID: "a1000000-0000-4000-8000-000000000017", CanonicalName: "鸡胸肉（去皮去骨，生）", NormalizedName: "鸡胸肉去皮去骨生", BaseFoodKey: "chicken_breast", FoodState: "raw", WeightBasis: "raw_edible", PreparationMethod: "raw", StateTags: []string{"去皮", "去骨", "生"}, Kcal: 120, Protein: 22.5, Carbs: 0, Fat: 2.62, FDCID: 171077, Aliases: []string{"生鸡胸肉（去皮去骨）", "去皮鸡胸肉（生重）"}},
		{ID: "a1000000-0000-4000-8000-000000000018", CanonicalName: "鸡胸肉（去皮，烤熟）", NormalizedName: "鸡胸肉去皮烤熟", BaseFoodKey: "chicken_breast", FoodState: "roasted", WeightBasis: "cooked_edible", PreparationMethod: "roasted", StateTags: []string{"去皮", "烤", "熟"}, Kcal: 165, Protein: 31.02, Carbs: 0, Fat: 3.57, FDCID: 171477, Aliases: []string{"烤鸡胸肉（去皮）", "去皮鸡胸肉（烤熟）"}},
		{ID: "a1000000-0000-4000-8000-000000000019", CanonicalName: "小扁豆（干，生）", NormalizedName: "小扁豆干生", BaseFoodKey: "lentil", FoodState: "dry", WeightBasis: "dry_raw", PreparationMethod: "uncooked", StateTags: []string{"干", "生", "成熟籽"}, Kcal: 352, Protein: 24.63, Carbs: 63.35, Fat: 1.06, FDCID: 172420, Aliases: []string{"干小扁豆", "小扁豆（干重）"}},
		{ID: "a1000000-0000-4000-8000-000000000020", CanonicalName: "小扁豆（水煮，无盐）", NormalizedName: "小扁豆水煮无盐", BaseFoodKey: "lentil", FoodState: "cooked", WeightBasis: "cooked", PreparationMethod: "boiled", StateTags: []string{"水煮", "无盐", "熟"}, Kcal: 116, Protein: 9.02, Carbs: 20.13, Fat: 0.38, FDCID: 172421, Aliases: []string{"水煮小扁豆（无盐）", "熟小扁豆（水煮）"}},
		{ID: "a1000000-0000-4000-8000-000000000021", CanonicalName: "黄豆（成熟籽，干，生）", NormalizedName: "黄豆成熟籽干生", BaseFoodKey: "soybean", FoodState: "dry", WeightBasis: "dry_raw", PreparationMethod: "uncooked", StateTags: []string{"成熟籽", "干", "生"}, Kcal: 446, Protein: 36.49, Carbs: 30.16, Fat: 19.94, FDCID: 174270, Aliases: []string{"干黄豆（生）", "大豆（干重，生）"}},
		{ID: "a1000000-0000-4000-8000-000000000022", CanonicalName: "黄豆（成熟籽，水煮，加盐）", NormalizedName: "黄豆成熟籽水煮加盐", BaseFoodKey: "soybean", FoodState: "cooked", WeightBasis: "cooked", PreparationMethod: "boiled_with_salt", StateTags: []string{"成熟籽", "水煮", "加盐", "熟"}, Kcal: 172, Protein: 18.21, Carbs: 8.36, Fat: 8.97, FDCID: 174299, Aliases: []string{"水煮黄豆（加盐）", "熟黄豆（水煮加盐）"}},
		{ID: "a1000000-0000-4000-8000-000000000023", CanonicalName: "鹰嘴豆（成熟籽，干，生）", NormalizedName: "鹰嘴豆成熟籽干生", BaseFoodKey: "chickpea", FoodState: "dry", WeightBasis: "dry_raw", PreparationMethod: "uncooked", StateTags: []string{"成熟籽", "干", "生"}, Kcal: 378, Protein: 20.47, Carbs: 62.95, Fat: 6.04, FDCID: 173756, Aliases: []string{"干鹰嘴豆（生）", "鹰嘴豆（干重）"}},
		{ID: "a1000000-0000-4000-8000-000000000024", CanonicalName: "鹰嘴豆（水煮，无盐）", NormalizedName: "鹰嘴豆水煮无盐", BaseFoodKey: "chickpea", FoodState: "cooked", WeightBasis: "cooked", PreparationMethod: "boiled", StateTags: []string{"水煮", "无盐", "熟"}, Kcal: 164, Protein: 8.86, Carbs: 27.42, Fat: 2.59, FDCID: 173757, Aliases: []string{"水煮鹰嘴豆（无盐）", "熟鹰嘴豆（水煮）"}},
		{ID: "a1000000-0000-4000-8000-000000000025", CanonicalName: "胡萝卜（生）", NormalizedName: "胡萝卜生", BaseFoodKey: "carrot", FoodState: "raw", WeightBasis: "raw_edible", PreparationMethod: "raw", StateTags: []string{"生", "可食部"}, Kcal: 41, Protein: 0.93, Carbs: 9.58, Fat: 0.24, FDCID: 170393, Aliases: []string{"生胡萝卜", "胡萝卜（生重）"}},
		{ID: "a1000000-0000-4000-8000-000000000026", CanonicalName: "胡萝卜（水煮沥干，无盐）", NormalizedName: "胡萝卜水煮沥干无盐", BaseFoodKey: "carrot", FoodState: "cooked", WeightBasis: "cooked_edible", PreparationMethod: "boiled_drained", StateTags: []string{"水煮", "沥干", "无盐", "熟"}, Kcal: 35, Protein: 0.76, Carbs: 8.22, Fat: 0.18, FDCID: 170394, Aliases: []string{"水煮胡萝卜（无盐）", "熟胡萝卜（水煮）"}},
		{ID: "a1000000-0000-4000-8000-000000000027", CanonicalName: "西兰花（生）", NormalizedName: "西兰花生", BaseFoodKey: "broccoli", FoodState: "raw", WeightBasis: "raw_edible", PreparationMethod: "raw", StateTags: []string{"生", "可食部"}, Kcal: 34, Protein: 2.82, Carbs: 6.64, Fat: 0.37, FDCID: 170379, Aliases: []string{"生西兰花", "绿花椰菜（生）"}},
		{ID: "a1000000-0000-4000-8000-000000000028", CanonicalName: "西兰花（水煮沥干，无盐）", NormalizedName: "西兰花水煮沥干无盐", BaseFoodKey: "broccoli", FoodState: "cooked", WeightBasis: "cooked_edible", PreparationMethod: "boiled_drained", StateTags: []string{"水煮", "沥干", "无盐", "熟"}, Kcal: 35, Protein: 2.38, Carbs: 7.18, Fat: 0.41, FDCID: 169967, Aliases: []string{"水煮西兰花（无盐）", "熟绿花椰菜（水煮）"}},
	}
}

// VerifyNutritionStates performs a read-only audit of the state dimensions and
// common authoritative anchors. It is intentionally separate from migration so
// deploy and operations workflows can prove the database state without writes.
func VerifyNutritionStates(ctx context.Context, db *gorm.DB) (*NutritionStateVerification, error) {
	seeds := commonFoodStateSeeds()
	report := &NutritionStateVerification{
		ExpectedCount:     len(seeds),
		MissingNormalized: []string{},
		InvalidNormalized: []string{},
		MissingAliases:    []string{},
		InvalidAliases:    []string{},
		Rows:              []NutritionStateVerificationRow{},
	}
	normalizedNames := make([]string, 0, len(seeds))
	for _, seed := range seeds {
		normalizedNames = append(normalizedNames, seed.NormalizedName)
		report.ExpectedAliasCount += len(seed.Aliases)
	}
	if !db.Migrator().HasTable(&migrationdo.FoodNutritionDO{}) {
		report.MissingNormalized = append(report.MissingNormalized, normalizedNames...)
		return report, nil
	}
	if err := db.WithContext(ctx).Model(&migrationdo.FoodNutritionDO{}).
		Where("normalized_name IN ?", normalizedNames).Order("normalized_name ASC").Find(&report.Rows).Error; err != nil {
		return nil, fmt.Errorf("verify nutrition state rows: %w", err)
	}
	report.FoundCount = len(report.Rows)
	rowsByName := make(map[string]NutritionStateVerificationRow, len(report.Rows))
	for _, row := range report.Rows {
		rowsByName[row.NormalizedName] = row
		if row.IsActive && isTrustedNutritionQualityTier(row.QualityTier) {
			report.VisibleCount++
		}
		if strings.TrimSpace(row.BaseFoodKey) != "" && strings.TrimSpace(row.FoodState) != "" &&
			strings.TrimSpace(row.WeightBasis) != "" && strings.TrimSpace(row.PreparationMethod) != "" {
			report.StateMetadataCount++
		}
	}
	for _, seed := range seeds {
		row, ok := rowsByName[seed.NormalizedName]
		if !ok {
			report.MissingNormalized = append(report.MissingNormalized, seed.NormalizedName)
			continue
		}
		if !row.IsActive || !isTrustedNutritionQualityTier(row.QualityTier) ||
			strings.TrimSpace(row.BaseFoodKey) == "" || strings.TrimSpace(row.FoodState) == "" ||
			strings.TrimSpace(row.WeightBasis) == "" || strings.TrimSpace(row.PreparationMethod) == "" {
			report.InvalidNormalized = append(report.InvalidNormalized, seed.NormalizedName)
		}
	}
	expectedAliasFoodIDs := map[string]string{}
	for _, seed := range seeds {
		row, ok := rowsByName[seed.NormalizedName]
		if !ok {
			continue
		}
		for _, aliasName := range seed.Aliases {
			normalizedAlias := normalizeCommonFoodStateAlias(aliasName)
			expectedAliasFoodIDs[normalizedAlias] = row.ID
		}
	}
	if len(expectedAliasFoodIDs) > 0 && db.Migrator().HasTable(&migrationdo.FoodNutritionAliasDO{}) {
		aliasNames := make([]string, 0, len(expectedAliasFoodIDs))
		for aliasName := range expectedAliasFoodIDs {
			aliasNames = append(aliasNames, aliasName)
		}
		var aliases []migrationdo.FoodNutritionAliasDO
		if err := db.WithContext(ctx).Where("normalized_alias IN ?", aliasNames).Find(&aliases).Error; err != nil {
			return nil, fmt.Errorf("verify nutrition state aliases: %w", err)
		}
		aliasesByName := make(map[string]migrationdo.FoodNutritionAliasDO, len(aliases))
		for _, alias := range aliases {
			aliasesByName[alias.NormalizedAlias] = alias
		}
		for aliasName, expectedFoodID := range expectedAliasFoodIDs {
			alias, ok := aliasesByName[aliasName]
			if !ok {
				report.MissingAliases = append(report.MissingAliases, aliasName)
				continue
			}
			if alias.FoodID != expectedFoodID || alias.MatchStatus != "approved_exact" {
				report.InvalidAliases = append(report.InvalidAliases, aliasName)
				continue
			}
			report.ApprovedAliasCount++
		}
	}
	report.CompositeIndexPresent = db.Migrator().HasIndex(&migrationdo.FoodNutritionDO{}, "idx_food_nutrition_library_base_state")
	report.Complete = report.FoundCount == report.ExpectedCount &&
		report.VisibleCount == report.ExpectedCount &&
		report.StateMetadataCount == report.ExpectedCount &&
		len(report.MissingNormalized) == 0 && len(report.InvalidNormalized) == 0 &&
		len(report.MissingAliases) == 0 && len(report.InvalidAliases) == 0 &&
		report.ApprovedAliasCount == int64(report.ExpectedAliasCount) && report.CompositeIndexPresent
	return report, nil
}

func isTrustedNutritionQualityTier(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "authoritative", "reviewed_estimate", "legacy_curated":
		return true
	default:
		return false
	}
}

func ensureCommonFoodStateSeed(ctx context.Context, db *gorm.DB) error {
	if !db.Migrator().HasTable(&migrationdo.FoodNutritionDO{}) {
		return nil
	}
	source := "USDA FoodData Central SR Legacy"
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, seed := range commonFoodStateSeeds() {
			row := migrationdo.FoodNutritionDO{
				ID: seed.ID, CanonicalName: seed.CanonicalName, NormalizedName: seed.NormalizedName,
				BaseFoodKey: seed.BaseFoodKey, FoodState: seed.FoodState, WeightBasis: seed.WeightBasis,
				PreparationMethod: seed.PreparationMethod, StateTags: seed.StateTags,
				KcalPer100g: seed.Kcal, ProteinPer100g: seed.Protein, CarbsPer100g: seed.Carbs, FatPer100g: seed.Fat,
				IsActive: true, Source: &source, QualityTier: "authoritative",
				QualityEvidence: commonFoodStateQualityEvidence(seed),
			}

			var persisted migrationdo.FoodNutritionDO
			err := tx.Where("normalized_name = ?", seed.NormalizedName).Take(&persisted).Error
			switch {
			case errors.Is(err, gorm.ErrRecordNotFound):
				if err := tx.Create(&row).Error; err != nil {
					return fmt.Errorf("seed common food state %s: %w", seed.CanonicalName, err)
				}
				persisted = row
			case err != nil:
				return fmt.Errorf("resolve common food state %s: %w", seed.CanonicalName, err)
			default:
				metadata := migrationdo.FoodNutritionDO{
					BaseFoodKey: seed.BaseFoodKey, FoodState: seed.FoodState, WeightBasis: seed.WeightBasis,
					PreparationMethod: seed.PreparationMethod, StateTags: seed.StateTags,
				}
				fields := []string{"base_food_key", "food_state", "weight_basis", "preparation_method", "state_tags"}
				if shouldUpgradeCommonFoodStateSeed(persisted) {
					metadata.CanonicalName = seed.CanonicalName
					metadata.KcalPer100g = seed.Kcal
					metadata.ProteinPer100g = seed.Protein
					metadata.CarbsPer100g = seed.Carbs
					metadata.FatPer100g = seed.Fat
					metadata.IsActive = true
					metadata.Source = &source
					metadata.QualityTier = "authoritative"
					metadata.QualityEvidence = commonFoodStateQualityEvidence(seed)
					fields = append(fields,
						"canonical_name", "kcal_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g",
						"is_active", "source", "quality_tier", "quality_evidence",
					)
				}
				if err := tx.Model(&migrationdo.FoodNutritionDO{}).Where("id = ?", persisted.ID).Select(fields).Updates(&metadata).Error; err != nil {
					return fmt.Errorf("update common food state %s: %w", seed.CanonicalName, err)
				}
			}

			for aliasIndex, aliasName := range seed.Aliases {
				alias := migrationdo.FoodNutritionAliasDO{
					ID:     fmt.Sprintf("b%07d-0000-4000-8000-%012d", seed.FDCID%10000000, aliasIndex+1),
					FoodID: persisted.ID, AliasName: aliasName, NormalizedAlias: normalizeCommonFoodStateAlias(aliasName),
					MatchStatus:      "approved_exact",
					ApprovalEvidence: map[string]any{"reason": "same food and explicit state/basis", "source": "system_common_state_seed"},
				}
				if err := tx.Clauses(clause.OnConflict{
					Columns: []clause.Column{{Name: "normalized_alias"}},
					DoUpdates: clause.AssignmentColumns([]string{
						"food_id", "alias_name", "match_status", "approval_evidence", "updated_at",
					}),
				}).Create(&alias).Error; err != nil {
					return fmt.Errorf("seed common food state alias %s: %w", aliasName, err)
				}
			}
		}
		return nil
	})
}

func normalizeCommonFoodStateAlias(value string) string {
	return strings.NewReplacer("（", "", "）", "", " ", "").Replace(value)
}

func commonFoodStateQualityEvidence(seed commonFoodStateSeed) map[string]any {
	return map[string]any{
		"source_name": "USDA FoodData Central", "data_type": "SR Legacy", "fdc_id": seed.FDCID,
		"basis": "per 100 g edible portion", "license": "CC0 1.0", "verified_on": "2026-08-21",
	}
}

func shouldUpgradeCommonFoodStateSeed(existing migrationdo.FoodNutritionDO) bool {
	switch strings.ToLower(strings.TrimSpace(existing.QualityTier)) {
	case "", "plausible", "unreviewed", "rejected":
		return true
	default:
		return false
	}
}

// MigrateNutritionEmbeddings applies only the semantic-retrieval storage. It
// intentionally avoids every unrelated migration in a dirty worktree.
func MigrateNutritionEmbeddings(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	if err := db.WithContext(ctx).AutoMigrate(&migrationdo.FoodNutritionEmbeddingDO{}); err != nil {
		return fmt.Errorf("auto migrate nutrition embeddings: %w", err)
	}
	return ensureNutritionEmbeddingConstraints(ctx, db)
}

func ensureNutritionEmbeddingConstraints(ctx context.Context, db *gorm.DB) error {
	for _, statement := range []string{
		dropAndAddCheck("food_nutrition_embeddings", "food_nutrition_embeddings_source_type_check", `source_type = ANY (ARRAY['canonical'::text,'alias'::text])`),
		dropAndAddCheck("food_nutrition_embeddings", "food_nutrition_embeddings_dimensions_check", `embedding_dimensions > 0 AND embedding_dimensions <= 4096`),
	} {
		if err := db.WithContext(ctx).Exec(statement).Error; err != nil {
			return fmt.Errorf("ensure nutrition embedding constraint: %w", err)
		}
	}
	return nil
}

func ensureNutritionQualityConstraints(ctx context.Context, db *gorm.DB) error {
	for _, statement := range []string{
		dropAndAddCheck("food_nutrition_library", "food_nutrition_library_quality_tier_check", `quality_tier = ANY (ARRAY['authoritative'::text,'reviewed_estimate'::text,'legacy_curated'::text,'plausible'::text,'unreviewed'::text,'rejected'::text])`),
		dropAndAddCheck("food_nutrition_aliases", "food_nutrition_aliases_match_status_check", `match_status = ANY (ARRAY['approved_exact'::text,'candidate_only'::text,'blocked'::text])`),
	} {
		if err := db.WithContext(ctx).Exec(statement).Error; err != nil {
			return fmt.Errorf("ensure nutrition quality constraint: %w", err)
		}
	}
	return nil
}

// MigrateOnboardingStatus applies only the additive onboarding-status schema.
// It deliberately avoids the broad AutoMigrate routine because that routine
// also contains historical data normalization and seed operations.
func MigrateOnboardingStatus(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	if !db.Migrator().HasColumn(&migrationdo.UserDO{}, "onboarding_status") {
		if err := db.WithContext(ctx).Migrator().AddColumn(&migrationdo.UserDO{}, "OnboardingStatus"); err != nil {
			return fmt.Errorf("add onboarding status column: %w", err)
		}
	}
	if !db.Migrator().HasColumn(&migrationdo.UserDO{}, "onboarding_draft_step") {
		if err := db.WithContext(ctx).Migrator().AddColumn(&migrationdo.UserDO{}, "OnboardingDraftStep"); err != nil {
			return fmt.Errorf("add onboarding draft step column: %w", err)
		}
	}
	if err := ensureOnboardingStatus(ctx, db); err != nil {
		return err
	}
	if err := db.WithContext(ctx).Exec(dropAndAddCheck("weapp_user", "weapp_user_onboarding_status_check", `onboarding_status IS NULL OR onboarding_status = ANY (ARRAY['pending'::text,'skipped'::text,'completed'::text])`)).Error; err != nil {
		return fmt.Errorf("add onboarding status check: %w", err)
	}
	if err := db.WithContext(ctx).Exec(dropAndAddCheck("weapp_user", "weapp_user_onboarding_draft_step_check", `onboarding_draft_step IS NULL OR onboarding_draft_step BETWEEN 0 AND 12`)).Error; err != nil {
		return fmt.Errorf("add onboarding draft step check: %w", err)
	}
	return nil
}

// MigrateCampusCatalogPublishing applies only the additive schema needed by
// the admin draft-to-publication workflow. It deliberately excludes every
// historical seed and data backfill in AutoMigrate.
func MigrateCampusCatalogPublishing(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	if err := db.WithContext(ctx).AutoMigrate(&migrationdo.CampusFoodCatalogItemDO{}); err != nil {
		return fmt.Errorf("auto migrate campus catalog publishing: %w", err)
	}
	if !db.Migrator().HasTable(&migrationdo.PublicFoodItemDO{}) {
		return fmt.Errorf("public_food_library table is required")
	}
	if err := db.WithContext(ctx).Exec(`ALTER TABLE public_food_library ALTER COLUMN user_id DROP NOT NULL`).Error; err != nil {
		return fmt.Errorf("allow official public food author: %w", err)
	}
	return nil
}

// MigrateSupplements applies only the additive supplement cabinet and intake
// schema. It intentionally avoids broad AutoMigrate backfills and seed jobs so
// the supplement feature can be released independently.
func MigrateSupplements(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	if err := db.WithContext(ctx).AutoMigrate(
		&migrationdo.SupplementCatalogItemDO{},
		&migrationdo.UserSupplementDO{},
		&migrationdo.SupplementIntakeDO{},
	); err != nil {
		return fmt.Errorf("auto migrate supplement models: %w", err)
	}
	if err := ensureSupplementCatalogSeed(ctx, db); err != nil {
		return err
	}
	for _, table := range []string{"supplement_catalog_items", "user_supplements", "supplement_intakes"} {
		if !db.WithContext(ctx).Migrator().HasTable(table) {
			return fmt.Errorf("missing supplement table after migration: %s", table)
		}
	}
	if !db.WithContext(ctx).Migrator().HasColumn(&migrationdo.UserSupplementDO{}, "image_urls") {
		return fmt.Errorf("missing supplement column after migration: user_supplements.image_urls")
	}
	for _, check := range []struct {
		model any
		index string
	}{
		{model: &migrationdo.SupplementCatalogItemDO{}, index: "idx_supplement_catalog_status_sort"},
		{model: &migrationdo.UserSupplementDO{}, index: "idx_user_supplements_user_status"},
		{model: &migrationdo.SupplementIntakeDO{}, index: "idx_supplement_intakes_user_taken"},
		{model: &migrationdo.SupplementIntakeDO{}, index: "idx_supplement_intakes_user_idempotency"},
	} {
		if !db.WithContext(ctx).Migrator().HasIndex(check.model, check.index) {
			return fmt.Errorf("missing supplement index after migration: %s", check.index)
		}
	}
	return nil
}

func ensureSupplementCatalogSeed(ctx context.Context, db *gorm.DB) error {
	type component = map[string]any
	seeds := []migrationdo.SupplementCatalogItemDO{
		{ID: "9d4a1000-0000-4000-8000-000000000001", Name: "维生素D3", Category: "vitamin", Description: "常用维生素模板，请按瓶身标签核对每份含量。", ServingLabel: "1粒", SearchTerms: "维D vitamin d cholecalciferol 胆钙化醇", SortOrder: 10, Status: "active", Components: []component{{"code": "vitamin_d", "name": "维生素D", "category": "nutrient", "amount": 25, "unit": "mcg", "nutrient_key": "vitaminDMcg"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000002", Name: "维生素C", Category: "vitamin", Description: "常用维生素模板，请按瓶身标签核对每份含量。", ServingLabel: "1片", SearchTerms: "vitamin c 抗坏血酸", SortOrder: 20, Status: "active", Components: []component{{"code": "vitamin_c", "name": "维生素C", "category": "nutrient", "amount": 500, "unit": "mg", "nutrient_key": "vitaminCMg"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000003", Name: "镁", Category: "mineral", Description: "矿物质模板，可按标签修改为甘氨酸镁、柠檬酸镁等具体形式。", ServingLabel: "2粒", SearchTerms: "magnesium 甘氨酸镁 柠檬酸镁", SortOrder: 30, Status: "active", Components: []component{{"code": "magnesium", "name": "镁", "category": "nutrient", "amount": 200, "unit": "mg", "nutrient_key": "magnesiumMg"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000004", Name: "锌", Category: "mineral", Description: "常用矿物质模板，请按瓶身标签核对每份含量。", ServingLabel: "1片", SearchTerms: "zinc 葡萄糖酸锌", SortOrder: 40, Status: "active", Components: []component{{"code": "zinc", "name": "锌", "category": "nutrient", "amount": 15, "unit": "mg", "nutrient_key": "zincMg"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000005", Name: "钙", Category: "mineral", Description: "常用矿物质模板，请按瓶身标签核对每份含量。", ServingLabel: "1片", SearchTerms: "calcium 碳酸钙 柠檬酸钙", SortOrder: 50, Status: "active", Components: []component{{"code": "calcium", "name": "钙", "category": "nutrient", "amount": 500, "unit": "mg", "nutrient_key": "calciumMg"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000006", Name: "铁", Category: "mineral", Description: "常用矿物质模板，请按瓶身标签核对每份含量。", ServingLabel: "1片", SearchTerms: "iron 富马酸亚铁 甘氨酸亚铁", SortOrder: 60, Status: "active", Components: []component{{"code": "iron", "name": "铁", "category": "nutrient", "amount": 18, "unit": "mg", "nutrient_key": "ironMg"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000007", Name: "维生素B12", Category: "vitamin", Description: "常用维生素模板，请按瓶身标签核对每份含量。", ServingLabel: "1片", SearchTerms: "vitamin b12 cobalamin 钴胺素", SortOrder: 70, Status: "active", Components: []component{{"code": "vitamin_b12", "name": "维生素B12", "category": "nutrient", "amount": 100, "unit": "mcg", "nutrient_key": "vitaminB12Mcg"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000008", Name: "叶酸", Category: "vitamin", Description: "常用维生素模板，请按瓶身标签核对每份含量。", ServingLabel: "1片", SearchTerms: "folate folic acid 维生素B9", SortOrder: 80, Status: "active", Components: []component{{"code": "folate", "name": "叶酸", "category": "nutrient", "amount": 400, "unit": "mcg", "nutrient_key": "folateMcg"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000009", Name: "鱼油（EPA+DHA）", Category: "wellness", Description: "功能成分模板，不把鱼油总量误当作 Omega-3 含量。", ServingLabel: "1粒", SearchTerms: "fish oil omega 3 欧米伽3 epa dha", SortOrder: 90, Status: "active", Components: []component{{"code": "epa", "name": "EPA", "category": "functional", "amount": 180, "unit": "mg"}, {"code": "dha", "name": "DHA", "category": "functional", "amount": 120, "unit": "mg"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000010", Name: "一水肌酸", Category: "sports", Description: "运动营养模板，作为功能成分记录。", ServingLabel: "1勺", SearchTerms: "creatine monohydrate 肌酸粉", SortOrder: 100, Status: "active", Components: []component{{"code": "creatine_monohydrate", "name": "一水肌酸", "category": "functional", "amount": 5, "unit": "g"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000011", Name: "益生菌", Category: "wellness", Description: "菌株与活菌数差异较大，请按瓶身标签补充或修改。", ServingLabel: "1粒", SearchTerms: "probiotic 乳酸菌 双歧杆菌", SortOrder: 110, Status: "active", Components: []component{{"code": "probiotics", "name": "益生菌", "category": "blend", "amount": 10, "unit": "B CFU"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000012", Name: "辅酶Q10", Category: "wellness", Description: "常用功能成分模板，请按瓶身标签核对每份含量。", ServingLabel: "1粒", SearchTerms: "coq10 coenzyme q10 ubiquinone 泛醌", SortOrder: 120, Status: "active", Components: []component{{"code": "coq10", "name": "辅酶Q10", "category": "functional", "amount": 100, "unit": "mg"}}},
		{ID: "9d4a1000-0000-4000-8000-000000000013", Name: "叶黄素", Category: "wellness", Description: "常用功能成分模板，请按瓶身标签核对每份含量。", ServingLabel: "1粒", SearchTerms: "lutein 玉米黄质 护眼", SortOrder: 130, Status: "active", Components: []component{{"code": "lutein", "name": "叶黄素", "category": "functional", "amount": 10, "unit": "mg"}}},
	}
	for _, seed := range seeds {
		if err := db.WithContext(ctx).Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "id"}},
			DoUpdates: clause.AssignmentColumns([]string{"name", "category", "description", "brand", "image_url", "serving_label", "components", "search_terms", "sort_order", "status", "updated_at"}),
		}).Create(&seed).Error; err != nil {
			return fmt.Errorf("seed supplement catalog item %s: %w", seed.Name, err)
		}
	}
	return nil
}

// MigrateFoodRecordMood applies only the optional eating_mood column for food
// records. It is intentionally narrow so a small product-field rollout does
// not publish unrelated pending schema or data migrations.
func MigrateFoodRecordMood(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	if !db.Migrator().HasColumn(&migrationdo.FoodRecordDO{}, "eating_mood") {
		if err := db.WithContext(ctx).Migrator().AddColumn(&migrationdo.FoodRecordDO{}, "EatingMood"); err != nil {
			return fmt.Errorf("add user_food_records.eating_mood: %w", err)
		}
	}
	if err := db.WithContext(ctx).Exec(dropAndAddCheck(
		"user_food_records",
		"user_food_records_eating_mood_check",
		`eating_mood IS NULL OR eating_mood = ANY (ARRAY['happy'::text,'calm'::text,'stressed'::text,'tired'::text,'bored'::text,'treat'::text])`,
	)).Error; err != nil {
		return fmt.Errorf("add user_food_records eating mood check: %w", err)
	}
	return nil
}

func prepareSchema(ctx context.Context, db *gorm.DB, schema string) error {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	qSchema := quoteIdent(schema)
	if err := db.WithContext(ctx).Exec("CREATE SCHEMA IF NOT EXISTS " + qSchema).Error; err != nil {
		return fmt.Errorf("create schema: %w", err)
	}
	if err := db.WithContext(ctx).Exec("CREATE EXTENSION IF NOT EXISTS pgcrypto").Error; err != nil {
		return fmt.Errorf("create pgcrypto extension: %w", err)
	}
	if err := db.WithContext(ctx).Exec("CREATE EXTENSION IF NOT EXISTS pg_trgm").Error; err != nil {
		return fmt.Errorf("create pg_trgm extension: %w", err)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + qSchema).Error; err != nil {
		return fmt.Errorf("set search path: %w", err)
	}
	return nil
}

func ensurePapayContractIndexes(ctx context.Context, db *gorm.DB) error {
	return db.WithContext(ctx).Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wechat_papay_contracts_one_effective_per_user
ON wechat_papay_contracts (user_id)
WHERE status IN ('pending', 'active', 'termination_requested')`).Error
}

// ensureTrialEntitlementIndexes scopes a registration trial to an account,
// rather than to a permanent WeChat identity. This allows a user who deleted an
// account and later registered again to receive the new-account trial.
func ensureTrialEntitlementIndexes(ctx context.Context, db *gorm.DB) error {
	for _, sql := range []string{
		`DROP INDEX IF EXISTS idx_user_trial_entitlements_openid`,
		`DROP INDEX IF EXISTS idx_user_trial_entitlements_unionid`,
		`DROP INDEX IF EXISTS idx_user_trial_entitlements_first_user_id`,
		`CREATE INDEX IF NOT EXISTS idx_user_trial_entitlements_openid ON user_trial_entitlements (openid)`,
		`CREATE INDEX IF NOT EXISTS idx_user_trial_entitlements_unionid ON user_trial_entitlements (unionid) WHERE unionid IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_trial_entitlements_first_user_id ON user_trial_entitlements (first_user_id) WHERE first_user_id IS NOT NULL`,
	} {
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("update user trial entitlement indexes: %w", err)
		}
	}
	return nil
}

func ensureDeferredInviteRewards(ctx context.Context, db *gorm.DB) error {
	result := db.WithContext(ctx).Exec(`
UPDATE user_vouchers
SET status = 'pending',
    valid_end_at = NULL,
    updated_at = now()
WHERE voucher_type = 'invite_light_week'
  AND status IN ('pending', 'expired')
  AND used_at IS NULL
  AND (status <> 'pending' OR valid_end_at IS NOT NULL)
`)
	if result.Error != nil {
		return fmt.Errorf("normalize deferred invite rewards: %w", result.Error)
	}
	return nil
}

func quoteIdent(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func ensureConstraints(ctx context.Context, db *gorm.DB) error {
	for _, sql := range []string{
		`ALTER TABLE user_credit_bonus_events DROP CONSTRAINT IF EXISTS user_credit_bonus_events_user_id_bonus_type_bonus_date_key`,
		dropAndAddCheck("weapp_user", "weapp_user_gender_check", `gender IS NULL OR gender = ANY (ARRAY['male'::text,'female'::text,'other'::text,''::text])`),
		dropAndAddCheck("weapp_user", "weapp_user_activity_level_check", `activity_level IS NULL OR activity_level = ANY (ARRAY['sedentary'::text,'light'::text,'moderate'::text,'active'::text,'very_active'::text,''::text])`),
		dropAndAddCheck("weapp_user", "weapp_user_onboarding_status_check", `onboarding_status IS NULL OR onboarding_status = ANY (ARRAY['pending'::text,'skipped'::text,'completed'::text])`),
		dropAndAddCheck("weapp_user", "weapp_user_onboarding_draft_step_check", `onboarding_draft_step IS NULL OR onboarding_draft_step BETWEEN 0 AND 12`),
		dropAndAddCheck("weapp_user", "weapp_user_execution_mode_check", `execution_mode IS NULL OR execution_mode = ANY (ARRAY['standard'::text,'standard_web_search'::text,'fast'::text,'fast_web_search'::text,'strict'::text,'strict_web_search'::text,'experimental'::text,'gemini35_flash'::text,'gemini35_flash_grouped'::text])`),
		dropAndAddCheck("weapp_user", "weapp_user_last_login_method_check", `last_login_method IS NULL OR last_login_method = ANY (ARRAY['wechat_miniprogram'::text,'wechat_app'::text,'password'::text,'sms_code'::text,'development_test_openid'::text,'debug_impersonate'::text])`),
		dropAndAddCheck("weapp_user", "weapp_user_telephone_format_check", `telephone IS NULL OR trim(telephone) = '' OR regexp_replace(trim(telephone), '[\s\-\(\)]', '', 'g') ~ '^(\+?86)?1[3-9][0-9]{9}$'`),
		`DELETE FROM user_feedback WHERE status = 'processing'`,
		`DELETE FROM feed_reports WHERE status = 'processing'`,
		dropAndAddCheck("user_feedback", "user_feedback_category_check", `category = ANY (ARRAY['bug'::text,'suggestion'::text,'experience'::text,'other'::text])`),
		dropAndAddCheck("user_feedback", "user_feedback_source_check", `source = ANY (ARRAY['app'::text,'campus_location'::text,'campus_food'::text,'food_library'::text])`),
		dropAndAddCheck("user_feedback", "user_feedback_status_check", `status = ANY (ARRAY['open'::text,'resolved'::text,'closed'::text])`),
		dropAndAddCheck("user_feedback", "user_feedback_reward_credits_check", `reward_credits >= 0`),
		dropAndAddCheck("admin_accounts", "admin_accounts_status_check", `status = ANY (ARRAY['active'::text,'disabled'::text])`),
		dropAndAddCheck("analysis_tasks", "analysis_tasks_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'done'::text,'failed'::text,'cancelled'::text,'timed_out'::text,'violated'::text])`),
		dropAndAddCheck("analysis_tasks", "analysis_tasks_task_type_check", `task_type = ANY (ARRAY['food'::text,'food_text'::text,'precision_plan'::text,'precision_item_estimate'::text,'precision_aggregate'::text,'health_report'::text,'public_food_library_text'::text,'exercise'::text,'expiry_recognize'::text,'expiry_notification'::text,'packaged_nutrition_label'::text,'packaged_product_extract'::text]) OR task_type ~ '^(food|food_text|precision_plan|precision_item_estimate|precision_aggregate|health_report|public_food_library_text|exercise|expiry_recognize|expiry_notification|packaged_nutrition_label|packaged_product_extract)_debug(_[a-z0-9_]+)?$'`),
		dropAndAddCheck("exercise_energy_library", "exercise_energy_library_review_status_check", `review_status = ANY (ARRAY['pending'::text,'active'::text,'disabled'::text])`),
		dropAndAddCheck("exercise_energy_library", "exercise_energy_library_met_value_check", `met_value > 0 AND met_value <= 30`),
		dropAndAddCheck("analysis_feedback_samples", "analysis_feedback_samples_feedback_type_check", `feedback_type = ANY (ARRAY['correction'::text,'retry'::text,'manual_entry'::text,'failed'::text,'weight_mismatch'::text,'nutrition_mismatch'::text,'suspect_distrust'::text,'record_corrected'::text])`),
		dropAndAddCheck("analysis_feedback_samples", "analysis_feedback_samples_resolution_state_check", `resolution_state = ANY (ARRAY['user_corrected'::text,'still_distrust'::text])`),
		dropAndAddCheck("user_food_records", "user_food_records_meal_type_check", `meal_type = ANY (ARRAY['breakfast'::text,'morning_snack'::text,'lunch'::text,'afternoon_snack'::text,'dinner'::text,'evening_snack'::text,'snack'::text])`),
		dropAndAddCheck("user_food_records", "user_food_records_entry_type_check", `entry_type = ANY (ARRAY['food_image'::text,'food_text'::text,'food_library'::text,'favorite_recipe'::text,'analyze_history'::text,'campus_canteen'::text,'public_food_library'::text,'unknown'::text])`),
		dropAndAddCheck("user_food_records", "user_food_records_eating_mood_check", `eating_mood IS NULL OR eating_mood = ANY (ARRAY['happy'::text,'calm'::text,'stressed'::text,'tired'::text,'bored'::text,'treat'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_source_type_check", `source_type = ANY (ARRAY['image'::text,'text'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_execution_mode_check", `execution_mode = ANY (ARRAY['standard'::text,'standard_web_search'::text,'fast'::text,'fast_web_search'::text,'strict'::text,'strict_web_search'::text,'experimental'::text,'gemini35_flash'::text,'gemini35_flash_grouped'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_status_check", `status = ANY (ARRAY['collecting'::text,'estimating'::text,'needs_user_input'::text,'needs_retake'::text,'done'::text,'cancelled'::text,'failed'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_round_index_check", `round_index >= 1`),
		dropAndAddCheck("precision_session_rounds", "precision_session_rounds_actor_role_check", `actor_role = ANY (ARRAY['user'::text,'assistant'::text,'system'::text])`),
		dropAndAddCheck("precision_session_rounds", "precision_session_rounds_round_index_check", `round_index >= 1`),
		dropAndAddCheck("precision_item_estimates", "precision_item_estimates_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'done'::text,'failed'::text])`),
		dropAndAddCheck("precision_item_estimates", "precision_item_estimates_round_index_check", `round_index >= 1`),
		dropAndAddCheck("precision_item_estimates", "precision_item_estimates_item_index_check", `item_index >= 0`),
		dropAndAddCheck("public_food_library", "public_food_library_status_check", `status = ANY (ARRAY['pending'::text,'published'::text,'rejected'::text,'user_deleted'::text,'deleted'::text])`),
		dropAndAddCheck("public_food_library", "public_food_library_type_check", `type = ANY (ARRAY['common'::text,'campus'::text])`),
		dropAndAddCheck("public_food_library", "public_food_library_taste_rating_check", `taste_rating IS NULL OR (taste_rating >= 1 AND taste_rating <= 5)`),
		dropAndAddCheck("public_food_library", "public_food_library_price_type_check", `price_type IS NULL OR price_type = ANY (ARRAY['fixed'::text,'weight'::text,'range'::text,'combo'::text,'unknown'::text])`),
		dropAndAddCheck("public_food_library_comments", "public_food_library_comments_rating_check", `rating IS NULL OR (rating >= 1 AND rating <= 5)`),
		dropAndAddCheck("school_campuses", "school_campuses_status_check", `status = ANY (ARRAY['pending_review'::text,'active'::text,'inactive'::text,'deleted'::text])`),
		dropAndAddCheck("school_canteens", "school_canteens_status_check", `status = ANY (ARRAY['pending_review'::text,'active'::text,'inactive'::text,'rejected'::text,'deleted'::text])`),
		dropAndAddCheck("school_canteens", "school_canteens_confidence_level_check", `confidence_level IS NULL OR confidence_level = ANY (ARRAY['A'::text,'B'::text,'C'::text,'D'::text])`),
		dropAndAddCheck("canteen_windows", "canteen_windows_status_check", `status = ANY (ARRAY['pending_review'::text,'active'::text,'inactive'::text,'deleted'::text])`),
		dropAndAddCheck("campus_canteen_applications", "campus_canteen_applications_status_check", `status = ANY (ARRAY['pending'::text,'approved'::text,'rejected'::text])`),
		dropAndAddCheck("campus_directory_import_batches", "campus_directory_import_batches_status_check", `status = ANY (ARRAY['pending_review'::text,'collecting'::text,'ready_for_review'::text,'approved'::text,'rejected'::text,'archived'::text])`),
		dropAndAddCheck("campus_directory_sources", "campus_directory_sources_review_status_check", `review_status = ANY (ARRAY['pending_review'::text,'approved'::text,'rejected'::text])`),
		dropAndAddCheck("campus_directory_sources", "campus_directory_sources_evidence_level_check", `evidence_level IS NULL OR evidence_level = ANY (ARRAY['A'::text,'B'::text,'C'::text,'D'::text])`),
		dropAndAddCheck("user_custom_foods", "user_custom_foods_status_check", `status = ANY (ARRAY['active'::text,'deleted'::text])`),
		dropAndAddCheck("user_custom_foods", "user_custom_foods_public_status_check", `public_status = ANY (ARRAY['private'::text,'pending'::text,'published'::text,'rejected'::text])`),
		dropAndAddCheck("feed_interaction_notifications", "feed_interaction_notifications_type_check", `notification_type = ANY (ARRAY['like_received'::text,'comment_received'::text,'reply_received'::text,'comment_rejected'::text])`),
		dropAndAddCheck("feed_likes", "feed_likes_target_type_check", `target_type = ANY (ARRAY['food_record'::text,'exercise_log'::text,'circle_post'::text])`),
		dropAndAddCheck("feed_comments", "feed_comments_target_type_check", `target_type = ANY (ARRAY['food_record'::text,'exercise_log'::text,'circle_post'::text])`),
		dropAndAddCheck("feed_interaction_notifications", "feed_interaction_notifications_target_type_check", `target_type = ANY (ARRAY['food_record'::text,'exercise_log'::text,'circle_post'::text])`),
		dropAndAddCheck("comment_tasks", "comment_tasks_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'done'::text,'failed'::text,'violated'::text])`),
		dropAndAddCheck("comment_tasks", "comment_tasks_type_check", `comment_type = ANY (ARRAY['feed'::text,'public_food_library'::text])`),
		dropAndAddCheck("feed_reports", "feed_reports_status_check", `status = ANY (ARRAY['pending'::text,'resolved'::text,'rejected'::text])`),
		dropAndAddCheck("feed_reports", "feed_reports_reason_check", `reason = ANY (ARRAY['spam'::text,'porn'::text,'illegal'::text,'abuse'::text,'other'::text])`),
		dropAndAddCheck("feed_reports", "feed_reports_target_type_check", `target_type = ANY (ARRAY['food_record'::text,'exercise_log'::text,'circle_post'::text])`),
		dropAndAddCheck("food_expiry_items", "food_expiry_items_storage_type_check", `storage_type = ANY (ARRAY['room_temp'::text,'refrigerated'::text,'frozen'::text])`),
		dropAndAddCheck("food_expiry_items", "food_expiry_items_source_type_check", `source_type = ANY (ARRAY['manual'::text,'ocr'::text,'ai'::text])`),
		dropAndAddCheck("food_expiry_items", "food_expiry_items_status_check", `status = ANY (ARRAY['active'::text,'consumed'::text,'discarded'::text])`),
		dropAndAddCheck("food_expiry_notification_jobs", "food_expiry_notification_jobs_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'sent'::text,'failed'::text,'cancelled'::text])`),
		dropAndAddCheck("food_expiry_notification_jobs", "food_expiry_notification_jobs_retry_count_check", `retry_count >= 0`),
		dropAndAddCheck("food_expiry_notification_jobs", "food_expiry_notification_jobs_max_retry_count_check", `max_retry_count >= 0`),
		dropAndAddCheck("friend_requests", "friend_requests_no_self", `from_user_id <> to_user_id`),
		dropAndAddCheck("friend_requests", "friend_requests_status_check", `status = ANY (ARRAY['pending'::text,'accepted'::text,'rejected'::text])`),
		dropAndAddCheck("user_friends", "user_friends_no_self", `user_id <> friend_id`),
		dropAndAddCheck("private_messages", "private_messages_content_type_check", `content_type = ANY (ARRAY['text'::text,'image'::text,'system'::text])`),
		dropAndAddCheck("private_message_reports", "private_message_reports_reason_check", `reason = ANY (ARRAY['spam'::text,'porn'::text,'illegal'::text,'abuse'::text,'other'::text])`),
		dropAndAddCheck("private_message_reports", "private_message_reports_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'resolved'::text,'rejected'::text])`),
		dropAndAddCheck("user_weight_records", "user_weight_records_weight_kg_check", `weight_kg >= 20 AND weight_kg <= 300`),
		dropAndAddCheck("user_weight_records", "user_weight_records_source_type_check", `source_type = ANY (ARRAY['manual'::text,'imported'::text,'ai'::text])`),
		dropAndAddCheck("user_water_logs", "user_water_logs_amount_ml_check", `amount_ml > 0 AND amount_ml <= 5000`),
		dropAndAddCheck("user_water_logs", "user_water_logs_source_type_check", `source_type = ANY (ARRAY['manual'::text,'imported'::text,'ai'::text]) OR source_type ~ '^ai_food_record:[0-9a-fA-F-]{36}$'`),
		dropAndAddCheck("user_body_metric_settings", "user_body_metric_settings_water_goal_ml_check", `water_goal_ml >= 500 AND water_goal_ml <= 10000`),
		dropAndAddCheck("user_exercise_logs", "user_exercise_logs_calories_burned_check", `calories_burned >= 0 AND calories_burned <= 5000`),
		dropAndAddCheck("ai_stats_insights", "ai_stats_insights_range_type_check", `range_type = ANY (ARRAY['week'::text,'month'::text])`),
		dropAndAddCheck("ai_custom_focus_cards", "ai_custom_focus_cards_range_type_check", `range_type = ANY (ARRAY['week'::text,'month'::text])`),
		dropAndAddCheck("membership_plan_config", "membership_plan_config_tier_check", `tier IS NULL OR tier = ANY (ARRAY['light'::text,'standard'::text,'advanced'::text])`),
		dropAndAddCheck("membership_plan_config", "membership_plan_config_period_check", `period IS NULL OR period = ANY (ARRAY['monthly'::text,'quarterly'::text,'yearly'::text])`),
		dropAndAddCheck("pro_membership_payment_records", "pro_membership_payment_records_status_check", `status = ANY (ARRAY['pending'::text,'paid'::text,'failed'::text,'cancelled'::text,'expired'::text,'closed'::text,'refunded'::text])`),
		dropAndAddCheck("membership_payment_test_settings", "membership_payment_test_settings_id_check", `id = 'default'`),
		dropAndAddCheck("user_invite_referrals", "user_invite_referrals_status_check", `status = ANY (ARRAY['pending_qualified'::text,'reward_active'::text,'reward_completed'::text,'reward_blocked'::text,'cancelled'::text])`),
		dropAndAddCheck("user_membership_grants", "user_membership_grants_grant_days_check", `grant_days > 0`),
		dropAndAddCheck("user_membership_grants", "user_membership_grants_status_check", `status = ANY (ARRAY['applied'::text,'cancelled'::text])`),
		dropAndAddCheck("user_membership_grants", "user_membership_grants_role_check", `role IS NULL OR role = ANY (ARRAY['inviter'::text,'invitee'::text])`),
		dropAndAddCheck("user_pets", "user_pets_level_check", `level >= 1`),
		dropAndAddCheck("user_pets", "user_pets_experience_check", `experience >= 0`),
		dropAndAddCheck("user_pets", "user_pets_total_events_check", `total_events >= 0`),
		dropAndAddCheck("food_weight_labeled_samples", "food_weight_labeled_samples_label_type_check", `label_type = ANY (ARRAY['total'::text,'items'::text,'unlabeled'::text])`),
		dropAndAddCheck("food_weight_labeled_samples", "food_weight_labeled_samples_status_check", `status = ANY (ARRAY['labeled'::text,'unlabeled'::text])`),
		dropAndAddCheck("benchmark_runs", "benchmark_runs_status_check", `status = ANY (ARRAY['pending'::text,'running'::text,'done'::text,'failed'::text,'cancelled'::text])`),
		dropAndAddCheck("benchmark_run_samples", "benchmark_run_samples_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'done'::text,'failed'::text,'cancelled'::text])`),
		addFK("benchmark_runs_created_by_fkey", "benchmark_runs", "created_by", "admin_accounts", "id", "SET NULL"),
		dropAndAddCheck("user_pet_events", "user_pet_events_event_type_check", `event_type = ANY (ARRAY['offline_review'::text])`),
		dropAndAddCheck("user_pet_events", "user_pet_events_habit_score_check", `habit_score >= 0`),
		dropAndAddCheck("user_pet_events", "user_pet_events_rewards_check", `exp_reward >= 0 AND credit_reward >= 0 AND credit_reward <= 2`),
		dropAndAddCheck("user_pet_daily_scores", "user_pet_daily_scores_score_check", `habit_score >= 0 AND exp_gained >= 0`),
		dropAndAddCheck("user_credit_bonus_events", "user_credit_bonus_events_bonus_type_check", `bonus_type = ANY (ARRAY['share_poster'::text])`),
		dropAndAddCheck("user_credit_bonus_events", "user_credit_bonus_events_credits_check", `credits >= 0`),
		dropAndAddCheck("reward_task_uploads", "reward_task_uploads_task_type_check", `task_type = ANY (ARRAY['packaged_food_upload'::text,'public_food_upload'::text,'standard_food_upload'::text])`),
		dropAndAddCheck("food_nutrition_contributions", "food_nutrition_contributions_status_check", `status = ANY (ARRAY['pending'::text,'approved'::text,'rejected'::text])`),
		dropAndAddCheck("food_nutrition_contributions", "food_nutrition_contributions_review_action_check", `review_action IS NULL OR review_action = ANY (ARRAY['approve_new'::text,'merge_existing'::text,'reject'::text])`),
		dropAndAddCheck("food_nutrition_contributions", "food_nutrition_contributions_nutrition_check", `kcal_per_100g >= 0 AND protein_per_100g >= 0 AND carbs_per_100g >= 0 AND fat_per_100g >= 0`),
		dropAndAddCheck("reward_task_uploads", "reward_task_uploads_status_check", `status = ANY (ARRAY['pending'::text,'succeeded'::text,'failed'::text])`),
		dropAndAddCheck("reward_task_uploads", "reward_task_uploads_reward_credits_check", `reward_credits >= 0`),
		dropAndAddCheck("packaged_food_correction_submissions", "packaged_food_correction_submissions_status_check", `status = ANY (ARRAY['pending'::text,'applied'::text,'rejected'::text])`),
		dropAndAddCheck("packaged_food_correction_submissions", "packaged_food_correction_submissions_reason_type_check", `reason_type = ANY (ARRAY['nutrition_wrong'::text,'barcode_wrong'::text,'name_wrong'::text,'spec_wrong'::text,'duplicate'::text,'other'::text])`),
		dropAndAddCheck("packaged_food_change_logs", "packaged_food_change_logs_operator_type_check", `operator_type = ANY (ARRAY['admin'::text,'system'::text])`),
		dropAndAddCheck("user_earned_credit_ledger", "user_earned_credit_ledger_balance_after_check", `balance_after >= 0`),
		addFK("analysis_tasks_user_id_fkey", "analysis_tasks", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_feedback_user_id_fkey", "user_feedback", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_feedback_reward_ledger_id_fkey", "user_feedback", "reward_ledger_id", "user_earned_credit_ledger", "id", "SET NULL"),
		addFK("analysis_feedback_samples_user_id_fkey", "analysis_feedback_samples", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("analysis_feedback_samples_source_task_id_fkey", "analysis_feedback_samples", "source_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("analysis_feedback_samples_correction_task_id_fkey", "analysis_feedback_samples", "correction_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("analysis_feedback_samples_root_task_id_fkey", "analysis_feedback_samples", "root_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("analysis_feedback_samples_source_record_id_fkey", "analysis_feedback_samples", "source_record_id", "user_food_records", "id", "SET NULL"),
		addFK("user_food_records_user_id_fkey", "user_food_records", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_food_records_source_task_id_fkey", "user_food_records", "source_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("user_circle_posts_user_id_fkey", "user_circle_posts", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("food_nutrition_aliases_food_id_fkey", "food_nutrition_aliases", "food_id", "food_nutrition_library", "id", "CASCADE"),
		addFK("packaged_food_aliases_food_id_fkey", "packaged_food_aliases", "food_id", "packaged_food_library", "id", "CASCADE"),
		addFK("packaged_food_correction_submissions_user_id_fkey", "packaged_food_correction_submissions", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("packaged_food_correction_submissions_food_id_fkey", "packaged_food_correction_submissions", "packaged_food_id", "packaged_food_library", "id", "CASCADE"),
		addFK("packaged_food_correction_submissions_reviewed_by_fkey", "packaged_food_correction_submissions", "reviewed_by", "admin_accounts", "id", "SET NULL"),
		addFK("packaged_food_change_logs_food_id_fkey", "packaged_food_change_logs", "packaged_food_id", "packaged_food_library", "id", "CASCADE"),
		addFK("packaged_food_change_logs_submission_id_fkey", "packaged_food_change_logs", "submission_id", "packaged_food_correction_submissions", "id", "SET NULL"),
		addFK("packaged_food_change_logs_operator_id_fkey", "packaged_food_change_logs", "operator_id", "admin_accounts", "id", "SET NULL"),
		addFK("food_unresolved_logs_task_id_fkey", "food_unresolved_logs", "task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("critical_samples_weapp_user_id_fkey", "critical_samples_weapp", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("precision_sessions_user_id_fkey", "precision_sessions", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("precision_sessions_current_task_id_fkey", "precision_sessions", "current_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("precision_session_rounds_session_id_fkey", "precision_session_rounds", "session_id", "precision_sessions", "id", "CASCADE"),
		addFK("precision_item_estimates_session_id_fkey", "precision_item_estimates", "session_id", "precision_sessions", "id", "CASCADE"),
		addFK("precision_item_estimates_source_task_id_fkey", "precision_item_estimates", "source_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("public_food_library_user_id_fkey", "public_food_library", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_source_record_id_fkey", "public_food_library", "source_record_id", "user_food_records", "id", "SET NULL"),
		addFK("public_food_library_analysis_task_id_fkey", "public_food_library", "analysis_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("campus_food_catalog_items_analysis_task_id_fkey", "campus_food_catalog_items", "analysis_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("school_campuses_school_id_fkey", "school_campuses", "school_id", "schools", "id", "CASCADE"),
		addFK("school_canteens_school_id_fkey", "school_canteens", "school_id", "schools", "id", "CASCADE"),
		addFK("school_canteens_campus_id_fkey", "school_canteens", "campus_id", "school_campuses", "id", "SET NULL"),
		addFK("canteen_windows_school_id_fkey", "canteen_windows", "school_id", "schools", "id", "CASCADE"),
		addFK("canteen_windows_campus_id_fkey", "canteen_windows", "campus_id", "school_campuses", "id", "SET NULL"),
		addFK("canteen_windows_canteen_id_fkey", "canteen_windows", "canteen_id", "school_canteens", "id", "CASCADE"),
		addFK("campus_canteen_applications_user_id_fkey", "campus_canteen_applications", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("campus_canteen_applications_school_id_fkey", "campus_canteen_applications", "school_id", "schools", "id", "CASCADE"),
		addFK("campus_canteen_applications_campus_id_fkey", "campus_canteen_applications", "campus_id", "school_campuses", "id", "SET NULL"),
		addFK("campus_canteen_applications_canteen_id_fkey", "campus_canteen_applications", "canteen_id", "school_canteens", "id", "SET NULL"),
		addFK("campus_directory_sources_batch_id_fkey", "campus_directory_sources", "batch_id", "campus_directory_import_batches", "id", "SET NULL"),
		addFK("campus_directory_sources_school_id_fkey", "campus_directory_sources", "school_id", "schools", "id", "CASCADE"),
		addFK("campus_directory_sources_campus_id_fkey", "campus_directory_sources", "campus_id", "school_campuses", "id", "SET NULL"),
		addFK("campus_directory_sources_canteen_id_fkey", "campus_directory_sources", "canteen_id", "school_canteens", "id", "SET NULL"),
		addFK("public_food_library_school_id_fkey", "public_food_library", "school_id", "schools", "id", "SET NULL"),
		addFK("public_food_library_campus_id_fkey", "public_food_library", "campus_id", "school_campuses", "id", "SET NULL"),
		addFK("public_food_library_canteen_id_fkey", "public_food_library", "canteen_id", "school_canteens", "id", "SET NULL"),
		addFK("public_food_library_window_id_fkey", "public_food_library", "window_id", "canteen_windows", "id", "SET NULL"),
		addFK("public_food_library_likes_user_id_fkey", "public_food_library_likes", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_likes_library_item_id_fkey", "public_food_library_likes", "library_item_id", "public_food_library", "id", "CASCADE"),
		addFK("public_food_library_collections_user_id_fkey", "public_food_library_collections", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_collections_library_item_id_fkey", "public_food_library_collections", "library_item_id", "public_food_library", "id", "CASCADE"),
		addFK("public_food_library_comments_user_id_fkey", "public_food_library_comments", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_comments_library_item_id_fkey", "public_food_library_comments", "library_item_id", "public_food_library", "id", "CASCADE"),
		addFK("public_food_library_comments_parent_comment_id_fkey", "public_food_library_comments", "parent_comment_id", "public_food_library_comments", "id", "CASCADE"),
		addFK("public_food_library_comments_reply_to_user_id_fkey", "public_food_library_comments", "reply_to_user_id", "weapp_user", "id", "SET NULL"),
		addFK("public_food_library_feedback_user_id_fkey", "public_food_library_feedback", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_feedback_library_item_id_fkey", "public_food_library_feedback", "library_item_id", "public_food_library", "id", "SET NULL"),
		addFK("user_custom_foods_user_id_fkey", "user_custom_foods", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_custom_foods_public_food_item_id_fkey", "user_custom_foods", "public_food_item_id", "public_food_library", "id", "SET NULL"),
		addFK("feed_likes_user_id_fkey", "feed_likes", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("feed_likes_record_id_fkey", "feed_likes", "record_id", "user_food_records", "id", "CASCADE"),
		addFK("feed_comments_user_id_fkey", "feed_comments", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("feed_comments_record_id_fkey", "feed_comments", "record_id", "user_food_records", "id", "CASCADE"),
		addFK("feed_comments_parent_comment_id_fkey", "feed_comments", "parent_comment_id", "feed_comments", "id", "CASCADE"),
		addFK("feed_comments_reply_to_user_id_fkey", "feed_comments", "reply_to_user_id", "weapp_user", "id", "SET NULL"),
		addFK("feed_interaction_notifications_recipient_user_id_fkey", "feed_interaction_notifications", "recipient_user_id", "weapp_user", "id", "CASCADE"),
		addFK("feed_interaction_notifications_actor_user_id_fkey", "feed_interaction_notifications", "actor_user_id", "weapp_user", "id", "SET NULL"),
		addFK("feed_interaction_notifications_record_id_fkey", "feed_interaction_notifications", "record_id", "user_food_records", "id", "CASCADE"),
		addFK("feed_interaction_notifications_comment_id_fkey", "feed_interaction_notifications", "comment_id", "feed_comments", "id", "CASCADE"),
		addFK("feed_interaction_notifications_parent_comment_id_fkey", "feed_interaction_notifications", "parent_comment_id", "feed_comments", "id", "CASCADE"),
		addFK("comment_tasks_user_id_fkey", "comment_tasks", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("food_expiry_items_user_id_fkey", "food_expiry_items", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("food_expiry_notification_jobs_user_id_fkey", "food_expiry_notification_jobs", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("food_expiry_notification_jobs_expiry_item_id_fkey", "food_expiry_notification_jobs", "expiry_item_id", "food_expiry_items", "id", "CASCADE"),
		addFK("friend_requests_from_user_id_fkey", "friend_requests", "from_user_id", "weapp_user", "id", "CASCADE"),
		addFK("friend_requests_to_user_id_fkey", "friend_requests", "to_user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_friends_user_id_fkey", "user_friends", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_friends_friend_id_fkey", "user_friends", "friend_id", "weapp_user", "id", "CASCADE"),
		addFK("user_weight_records_user_id_fkey", "user_weight_records", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_water_logs_user_id_fkey", "user_water_logs", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_body_metric_settings_user_id_fkey", "user_body_metric_settings", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_exercise_logs_user_id_fkey", "user_exercise_logs", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("exercise_energy_aliases_activity_id_fkey", "exercise_energy_aliases", "activity_id", "exercise_energy_library", "id", "CASCADE"),
		addFK("ai_stats_insights_user_id_fkey", "ai_stats_insights", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("ai_custom_focus_cards_user_id_fkey", "ai_custom_focus_cards", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pro_memberships_user_id_fkey", "user_pro_memberships", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pro_memberships_current_plan_code_fkey", "user_pro_memberships", "current_plan_code", "membership_plan_config", "code", "SET NULL"),
		addFK("user_membership_grants_user_id_fkey", "user_membership_grants", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_membership_grants_plan_code_fkey", "user_membership_grants", "plan_code", "membership_plan_config", "code", "RESTRICT"),
		addFK("user_membership_grants_referral_id_fkey", "user_membership_grants", "referral_id", "user_invite_referrals", "id", "SET NULL"),
		addFK("pro_membership_payment_records_user_id_fkey", "pro_membership_payment_records", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("pro_membership_payment_records_plan_code_fkey", "pro_membership_payment_records", "plan_code", "membership_plan_config", "code", "RESTRICT"),
		addFK("membership_payment_test_users_user_id_fkey", "membership_payment_test_users", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_invite_referrals_inviter_user_id_fkey", "user_invite_referrals", "inviter_user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_invite_referrals_invitee_user_id_fkey", "user_invite_referrals", "invitee_user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pets_user_id_fkey", "user_pets", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pet_events_user_id_fkey", "user_pet_events", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pet_events_pet_id_fkey", "user_pet_events", "pet_id", "user_pets", "id", "CASCADE"),
		addFK("user_pet_daily_scores_user_id_fkey", "user_pet_daily_scores", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_credit_bonus_events_user_id_fkey", "user_credit_bonus_events", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_credit_bonus_events_source_record_id_fkey", "user_credit_bonus_events", "source_record_id", "user_food_records", "id", "SET NULL"),
		addFK("reward_task_uploads_user_id_fkey", "reward_task_uploads", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("food_nutrition_contributions_user_id_fkey", "food_nutrition_contributions", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("food_nutrition_contributions_reviewed_by_fkey", "food_nutrition_contributions", "reviewed_by", "admin_accounts", "id", "SET NULL"),
		addFK("food_nutrition_contributions_target_food_id_fkey", "food_nutrition_contributions", "target_food_id", "food_nutrition_library", "id", "SET NULL"),
		addFK("food_nutrition_contributions_legacy_custom_food_id_fkey", "food_nutrition_contributions", "legacy_custom_food_id", "user_custom_foods", "id", "SET NULL"),
		addFK("reward_task_uploads_source_task_id_fkey", "reward_task_uploads", "source_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("reward_task_uploads_packaged_food_id_fkey", "reward_task_uploads", "packaged_food_id", "packaged_food_library", "id", "SET NULL"),
		addFK("reward_task_uploads_public_food_item_id_fkey", "reward_task_uploads", "public_food_item_id", "public_food_library", "id", "SET NULL"),
		addFK("user_earned_credit_ledger_user_id_fkey", "user_earned_credit_ledger", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("membership_share_rewards_user_id_fkey", "membership_share_rewards", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("membership_share_rewards_record_id_fkey", "membership_share_rewards", "record_id", "user_food_records", "id", "CASCADE"),
		addFK("user_recipes_user_id_fkey", "user_recipes", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_health_documents_user_id_fkey", "user_health_documents", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_mode_switch_logs_user_id_fkey", "user_mode_switch_logs", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("test_prompt_history_prompt_id_fkey", "test_prompt_history", "prompt_id", "test_prompts", "id", "CASCADE"),
		addFK("test_batches_dataset_id_fkey", "test_batches", "dataset_id", "test_datasets", "id", "CASCADE"),
	} {
		if sql == "" {
			continue
		}
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("apply constraint/index statement: %w", err)
		}
	}
	return nil
}

func ensureNicknameUniqueIndex(ctx context.Context, db *gorm.DB) error {
	// Nicknames are currently display names, not account identifiers. Remove the
	// historical uniqueness constraint so registrations and profile edits may reuse one.
	if err := db.WithContext(ctx).Exec("DROP INDEX IF EXISTS idx_weapp_user_nickname_normalized_unique").Error; err != nil {
		return fmt.Errorf("删除昵称唯一索引: %w", err)
	}
	return nil
}
func ensureIndexes(ctx context.Context, db *gorm.DB) error {
	if err := ensureNicknameUniqueIndex(ctx, db); err != nil {
		return err
	}
	for _, sql := range []string{
		`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app'`,
		`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb`,
		`CREATE INDEX IF NOT EXISTS idx_user_feedback_source_created ON user_feedback (source, created_at DESC)`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS app_openid text`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS app_unionid text`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS username text`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS password_hash text`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS password_set_at timestamptz`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS last_login_method text`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS last_login_at timestamptz`,
		`UPDATE weapp_user SET username = lower(trim(username)) WHERE username IS NOT NULL AND username <> lower(trim(username))`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_weapp_user_app_openid ON weapp_user (app_openid) WHERE app_openid IS NOT NULL AND app_openid <> ''`,
		`CREATE INDEX IF NOT EXISTS idx_weapp_user_app_unionid ON weapp_user (app_unionid) WHERE app_unionid IS NOT NULL AND app_unionid <> ''`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_weapp_user_username ON weapp_user (lower(username)) WHERE username IS NOT NULL AND username <> ''`,
		`CREATE INDEX IF NOT EXISTS idx_weapp_user_telephone ON weapp_user (telephone) WHERE telephone IS NOT NULL AND telephone <> ''`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_weapp_user_telephone_normalized_unique ON weapp_user ((
CASE
  WHEN regexp_replace(trim(telephone), '[\s\-\(\)]', '', 'g') ~ '^\+?86(1[3-9][0-9]{9})$'
    THEN regexp_replace(regexp_replace(trim(telephone), '[\s\-\(\)]', '', 'g'), '^\+?86', '')
  ELSE regexp_replace(trim(telephone), '[\s\-\(\)]', '', 'g')
END
)) WHERE telephone IS NOT NULL AND trim(telephone) <> ''`,
		`ALTER TABLE membership_plan_config ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true`,
		`ALTER TABLE membership_plan_config ADD COLUMN IF NOT EXISTS is_test_plan boolean NOT NULL DEFAULT false`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_payment_test_users_user_id ON membership_payment_test_users (user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_membership_payment_test_users_created_at ON membership_payment_test_users (created_at DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_membership_grants_source_key ON user_membership_grants (source_key)`,
		`CREATE INDEX IF NOT EXISTS idx_user_membership_grants_user_created ON user_membership_grants (user_id, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_user_membership_grants_referral_role ON user_membership_grants (referral_id, role)`,
		`ALTER TABLE packaged_food_library DROP CONSTRAINT IF EXISTS packaged_food_library_normalized_name_key`,
		`DROP INDEX IF EXISTS uni_packaged_food_library_normalized_name`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS product_key text NOT NULL DEFAULT ''`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT ''`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT ''`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS product_family_key text NOT NULL DEFAULT ''`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS spec_text text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS barcode text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS flavor_text text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS package_category text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS ingredients_text text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS source_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS ocr_raw_text text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS nutrition_basis_unit text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS energy_unit_raw text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS raw_label_payload jsonb NOT NULL DEFAULT '{}'::jsonb`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS conversion_status text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS extract_confidence numeric NOT NULL DEFAULT 0`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS ingest_method text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS net_content_value numeric NOT NULL DEFAULT 0`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS net_content_unit text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS unit_count numeric NOT NULL DEFAULT 0`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS unit_content_value numeric NOT NULL DEFAULT 0`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS unit_content_unit text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'active'`,
		`ALTER TABLE food_nutrition_library ADD COLUMN IF NOT EXISTS image_path text`,
		`ALTER TABLE food_nutrition_library ADD COLUMN IF NOT EXISTS image_paths jsonb NOT NULL DEFAULT '[]'::jsonb`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS analysis_task_id uuid`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_analysis_task_id ON public_food_library (analysis_task_id)`,
		`ALTER TABLE packaged_food_aliases DROP CONSTRAINT IF EXISTS packaged_food_aliases_normalized_alias_key`,
		`DROP INDEX IF EXISTS uni_packaged_food_aliases_normalized_alias`,
		`DROP INDEX IF EXISTS packaged_food_aliases_normalized_alias_key`,
		`ALTER TABLE reward_task_uploads ADD COLUMN IF NOT EXISTS source_key text`,
		`ALTER TABLE user_exercise_logs ADD COLUMN IF NOT EXISTS image_url text`,
		`ALTER TABLE user_exercise_logs ADD COLUMN IF NOT EXISTS exercise_type text`,
		`ALTER TABLE user_exercise_logs ADD COLUMN IF NOT EXISTS exercise_items jsonb NOT NULL DEFAULT '[]'::jsonb`,
		`ALTER TABLE user_exercise_logs ALTER COLUMN exercise_items SET DEFAULT '[]'::jsonb`,
		`UPDATE user_exercise_logs SET exercise_items = '[]'::jsonb WHERE exercise_items IS NULL`,
		`ALTER TABLE user_exercise_logs ALTER COLUMN exercise_items SET NOT NULL`,
		`ALTER TABLE user_exercise_logs ADD COLUMN IF NOT EXISTS hidden_from_feed boolean NOT NULL DEFAULT false`,
		`ALTER TABLE user_food_records ADD COLUMN IF NOT EXISTS entry_type text`,
		`ALTER TABLE user_food_records ADD COLUMN IF NOT EXISTS eating_mood text`,
		`ALTER TABLE feed_likes ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'food_record'`,
		`ALTER TABLE feed_likes ADD COLUMN IF NOT EXISTS target_id uuid`,
		`UPDATE feed_likes SET target_type = 'food_record', target_id = record_id WHERE target_id IS NULL AND record_id IS NOT NULL`,
		`ALTER TABLE feed_likes ALTER COLUMN record_id DROP NOT NULL`,
		`ALTER TABLE feed_likes ALTER COLUMN target_id SET NOT NULL`,
		`ALTER TABLE feed_comments ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'food_record'`,
		`ALTER TABLE feed_comments ADD COLUMN IF NOT EXISTS target_id uuid`,
		`UPDATE feed_comments SET target_type = 'food_record', target_id = record_id WHERE target_id IS NULL AND record_id IS NOT NULL`,
		`ALTER TABLE feed_comments ALTER COLUMN record_id DROP NOT NULL`,
		`ALTER TABLE feed_comments ALTER COLUMN target_id SET NOT NULL`,
		`ALTER TABLE feed_interaction_notifications ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'food_record'`,
		`ALTER TABLE feed_interaction_notifications ADD COLUMN IF NOT EXISTS target_id uuid`,
		`UPDATE feed_interaction_notifications SET target_type = 'food_record', target_id = record_id WHERE target_id IS NULL AND record_id IS NOT NULL`,
		`ALTER TABLE ai_stats_insights ADD COLUMN IF NOT EXISTS generation_count integer NOT NULL DEFAULT 1`,
		`ALTER TABLE user_credit_bonus_events ADD COLUMN IF NOT EXISTS source_scope text`,
		`ALTER TABLE user_credit_bonus_events ADD COLUMN IF NOT EXISTS source_key text`,
		`UPDATE user_credit_bonus_events
SET source_scope = COALESCE(NULLIF(source_scope, ''), 'meal_record'),
    source_key = COALESCE(NULLIF(source_key, ''), 'meal_record:' || source_record_id::text),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'source_scope', COALESCE(NULLIF(source_scope, ''), 'meal_record'),
      'source_key', COALESCE(NULLIF(source_key, ''), 'meal_record:' || source_record_id::text)
    )
WHERE bonus_type = 'share_poster'
  AND source_record_id IS NOT NULL
  AND COALESCE(source_key, '') = ''`,
		`UPDATE packaged_food_library
SET product_key = LOWER(
  regexp_replace(
    COALESCE(NULLIF(brand, ''), '') ||
    COALESCE(NULLIF(product_name, ''), '') ||
    COALESCE(NULLIF(flavor_text, ''), '') ||
    COALESCE(
      NULLIF(spec_text, ''),
      CASE
        WHEN COALESCE(net_weight_g, 0) > 0 THEN regexp_replace(trim(to_char(net_weight_g, 'FM999999990.00')), '[^[:alnum:]]', '', 'g') || 'g'
        ELSE ''
      END
    ),
    '[^[:alnum:]]',
    '',
    'g'
  )
)
WHERE COALESCE(product_key, '') = ''`,
		`UPDATE packaged_food_library
SET net_content_value = COALESCE(NULLIF(net_content_value, 0), NULLIF(net_weight_g, 0), 0),
    net_content_unit = COALESCE(NULLIF(net_content_unit, ''), CASE WHEN COALESCE(net_weight_g, 0) > 0 THEN 'g' ELSE NULL END),
    display_name = COALESCE(NULLIF(display_name, ''), trim(concat_ws(' ',
      NULLIF(brand, ''),
      NULLIF(product_name, ''),
      NULLIF(flavor_text, ''),
      CASE
        WHEN COALESCE(net_weight_g, 0) > 0 THEN regexp_replace(trim(to_char(net_weight_g, 'FM999999990.00')), '\.?0+$', '') || 'g'
        ELSE NULLIF(spec_text, '')
      END
    ))),
    product_family_key = COALESCE(NULLIF(product_family_key, ''), lower(regexp_replace(COALESCE(NULLIF(brand, ''), '') || COALESCE(NULLIF(product_name, ''), ''), '[^[:alnum:]]', '', 'g'))),
    search_text = COALESCE(NULLIF(search_text, ''), trim(concat_ws(' ',
      NULLIF(brand, ''),
      NULLIF(product_name, ''),
      NULLIF(flavor_text, ''),
      NULLIF(spec_text, ''),
      NULLIF(barcode, ''),
      NULLIF(package_category, ''),
      NULLIF(display_name, ''),
      NULLIF(ocr_raw_text, '')
    ))),
    review_status = COALESCE(NULLIF(review_status, ''), 'active')
WHERE COALESCE(display_name, '') = ''
   OR COALESCE(search_text, '') = ''
   OR COALESCE(product_family_key, '') = ''
   OR COALESCE(net_content_value, 0) = 0
   OR COALESCE(review_status, '') = ''`,
		`DROP INDEX IF EXISTS idx_packaged_food_library_product_key`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_library_product_key ON packaged_food_library (product_key)`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_library_display_name ON packaged_food_library (display_name)`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_library_family_key ON packaged_food_library (product_family_key)`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_library_review_status ON packaged_food_library (review_status)`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_aliases_normalized_alias ON packaged_food_aliases (normalized_alias)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_food_nutrition_alias_candidates_pending_unique ON food_nutrition_alias_candidates (normalized_alias, proposed_food_id) WHERE status = 'pending'`,
		`CREATE INDEX IF NOT EXISTS idx_food_nutrition_alias_candidates_review_queue ON food_nutrition_alias_candidates (status, created_at DESC)`,
		`ALTER TABLE food_nutrition_alias_candidates DROP CONSTRAINT IF EXISTS food_nutrition_alias_candidates_status_check`,
		`ALTER TABLE food_nutrition_alias_candidates ADD CONSTRAINT food_nutrition_alias_candidates_status_check CHECK (status IN ('pending', 'approved', 'rejected'))`,
		addFK("fk_food_nutrition_alias_candidates_food", "food_nutrition_alias_candidates", "proposed_food_id", "food_nutrition_library", "id", "RESTRICT"),
		addFK("fk_food_nutrition_alias_candidates_reviewer", "food_nutrition_alias_candidates", "reviewer_id", "admin_accounts", "id", "SET NULL"),
		addFK("fk_food_nutrition_alias_candidates_source_task", "food_nutrition_alias_candidates", "source_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("fk_food_nutrition_alias_candidates_generated_from", "food_nutrition_alias_candidates", "generated_from_id", "food_nutrition_alias_candidates", "id", "SET NULL"),
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_library_barcode ON packaged_food_library (barcode) WHERE barcode IS NOT NULL AND barcode <> ''`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_correction_submissions_status_created_at ON packaged_food_correction_submissions (status, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_change_logs_food_created_at ON packaged_food_change_logs (packaged_food_id, created_at DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_task_uploads_source_key ON reward_task_uploads (source_key) WHERE source_key IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_food_nutrition_contributions_pending_user_name ON food_nutrition_contributions (user_id, normalized_name) WHERE status = 'pending'`,
		`CREATE UNIQUE INDEX IF NOT EXISTS precision_item_estimates_session_round_item_key_key ON precision_item_estimates (session_id, round_index, item_key)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_food_records_user_task_unique ON user_food_records (user_id, source_task_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_recipes_user_source_task_unique ON user_recipes (user_id, source_task_id) WHERE source_task_id IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS public_food_library_likes_unique ON public_food_library_likes (user_id, library_item_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS public_food_library_collections_unique ON public_food_library_collections (user_id, library_item_id)`,
		`ALTER TABLE public_food_library_comments ADD COLUMN IF NOT EXISTS parent_comment_id uuid`,
		`ALTER TABLE public_food_library_comments ADD COLUMN IF NOT EXISTS reply_to_user_id uuid`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_comments_parent_comment_id ON public_food_library_comments (parent_comment_id)`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_comments_reply_to_user_id ON public_food_library_comments (reply_to_user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_comments_item_parent_created ON public_food_library_comments (library_item_id, parent_comment_id, created_at)`,
		`ALTER TABLE feed_likes DROP CONSTRAINT IF EXISTS feed_likes_unique`,
		`DROP INDEX IF EXISTS feed_likes_unique`,
		`CREATE UNIQUE INDEX IF NOT EXISTS feed_likes_unique_target ON feed_likes (user_id, target_type, target_id)`,
		`CREATE INDEX IF NOT EXISTS idx_feed_comments_target_created_at ON feed_comments (target_type, target_id, created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_feed_interaction_notifications_target ON feed_interaction_notifications (target_type, target_id)`,
		`CREATE INDEX IF NOT EXISTS idx_user_circle_posts_user_created_hidden ON user_circle_posts (user_id, created_at DESC) WHERE hidden_from_feed = false`,
		`CREATE UNIQUE INDEX IF NOT EXISTS food_expiry_notification_jobs_item_template_schedule_unique ON food_expiry_notification_jobs (expiry_item_id, template_id, scheduled_at)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pair ON friend_requests (from_user_id, to_user_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_friends_unique ON user_friends (user_id, friend_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_follows_unique ON user_follows (follower_id, followee_id)`,
		`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
		`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid`,
		`CREATE INDEX IF NOT EXISTS idx_private_messages_conversation ON private_messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_private_messages_unread ON private_messages (receiver_id, sender_id) WHERE is_read = false`,
		`CREATE INDEX IF NOT EXISTS idx_private_messages_active_conversation ON private_messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC) WHERE deleted_at IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_private_message_reports_reporter_message_unique ON private_message_reports (reporter_user_id, message_id)`,
		`CREATE INDEX IF NOT EXISTS idx_private_message_reports_reported_status ON private_message_reports (reported_user_id, status, created_at DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ai_stats_insights_user_range_date_unique ON ai_stats_insights (user_id, range_type, generated_date)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ai_custom_focus_cards_user_range_focus_unique ON ai_custom_focus_cards (user_id, range_type, focus_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_user_credit_bonus_share_poster_record ON user_credit_bonus_events (user_id, bonus_type, bonus_date, source_record_id) WHERE bonus_type = 'share_poster' AND source_record_id IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_user_credit_bonus_share_poster_source_key ON user_credit_bonus_events (user_id, bonus_type, bonus_date, source_key) WHERE bonus_type = 'share_poster' AND source_key IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_earned_credit_ledger_user_reason_source ON user_earned_credit_ledger (user_id, reason, source_key) WHERE source_key IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_pets_user_id_unique ON user_pets (user_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_pet_events_user_date_type_unique ON user_pet_events (user_id, event_date, event_type)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_pet_daily_scores_user_date_unique ON user_pet_daily_scores (user_id, score_date)`,
		`CREATE INDEX IF NOT EXISTS idx_pet_chat_sessions_user_updated ON pet_chat_sessions (user_id, range_type, updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_pet_chat_sessions_user_status ON pet_chat_sessions (user_id, status, updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_pet_chat_messages_session_created ON pet_chat_messages (session_id, created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_pet_chat_messages_user_created ON pet_chat_messages (user_id, created_at DESC)`,
		addFK("fk_pet_chat_messages_session", "pet_chat_messages", "session_id", "pet_chat_sessions", "id", "CASCADE"),
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_food_weight_labeled_samples_batch_sample ON food_weight_labeled_samples (batch_name, sample_name)`,
		`CREATE INDEX IF NOT EXISTS idx_food_weight_labeled_samples_batch ON food_weight_labeled_samples (batch_name)`,
		`CREATE INDEX IF NOT EXISTS idx_food_weight_labeled_samples_label_type ON food_weight_labeled_samples (label_type)`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_runs_status ON benchmark_runs (status)`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_runs_created_at ON benchmark_runs (created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_run_samples_run_id ON benchmark_run_samples (run_id)`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_run_samples_sample_id ON benchmark_run_samples (sample_id)`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_run_samples_task_id ON benchmark_run_samples (task_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_weight_records_user_client_record_id ON user_weight_records (user_id, client_record_id) WHERE client_record_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_user_food_records_hidden_from_feed ON user_food_records (hidden_from_feed) WHERE hidden_from_feed = false`,
		// Campus food library columns
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS is_campus_food boolean NOT NULL DEFAULT false`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS school_id uuid`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS campus_id uuid`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS canteen_id uuid`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS window_id uuid`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS school_name text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS campus_name text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS canteen_name text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS floor text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS window_name text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price numeric`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price_type text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price_min numeric`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price_max numeric`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price_unit text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price_collected_at timestamptz`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS portion_description text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS is_campus_highlight boolean NOT NULL DEFAULT false`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS campus_location_text text`,
		// Official campus catalog entries are published by an admin account rather
		// than a mini-program user, so their author is intentionally nullable.
		`ALTER TABLE public_food_library ALTER COLUMN user_id DROP NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_is_campus ON public_food_library (is_campus_food)`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_school_id ON public_food_library (school_id) WHERE school_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_campus_id ON public_food_library (campus_id) WHERE campus_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_canteen_id ON public_food_library (canteen_id) WHERE canteen_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_window_id ON public_food_library (window_id) WHERE window_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_school ON public_food_library (school_name) WHERE school_name IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_canteen ON public_food_library (canteen_name) WHERE canteen_name IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_campus_highlight ON public_food_library (is_campus_highlight) WHERE is_campus_highlight = true`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_campus_published ON public_food_library (is_campus_food, status, published_at) WHERE is_campus_food = true`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_price_type ON public_food_library (price_type) WHERE price_type IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_school_campuses_school_name_active ON school_campuses (school_id, lower(name)) WHERE status <> 'deleted'`,
		`DROP INDEX IF EXISTS idx_school_canteens_campus_name_active`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_school_canteens_campus_name_active ON school_canteens (school_id, COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE status NOT IN ('deleted', 'rejected')`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_canteen_windows_canteen_name_active ON canteen_windows (canteen_id, lower(name)) WHERE status <> 'deleted'`,
		`CREATE INDEX IF NOT EXISTS idx_school_canteens_school_status ON school_canteens (school_id, status, sort_order, name)`,
		`CREATE INDEX IF NOT EXISTS idx_school_campuses_school_status ON school_campuses (school_id, status, sort_order, name)`,
		`CREATE INDEX IF NOT EXISTS idx_campus_canteen_applications_school_status ON campus_canteen_applications (school_id, status, created_at DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_campus_directory_import_batches_name_unique ON campus_directory_import_batches (name)`,
		`CREATE INDEX IF NOT EXISTS idx_campus_directory_import_batches_status ON campus_directory_import_batches (status, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_campus_directory_sources_batch_status ON campus_directory_sources (batch_id, review_status, created_at DESC) WHERE batch_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_campus_directory_sources_url ON campus_directory_sources (source_url)`,
		// Analysis tasks search text column + index for name-based search
		`ALTER TABLE analysis_tasks ADD COLUMN IF NOT EXISTS search_text text`,
		`UPDATE analysis_tasks SET search_text = COALESCE(NULLIF(text_input, ''), result->'items'->0->>'name', result->>'description', '') WHERE search_text IS NULL OR search_text = ''`,
		`CREATE INDEX IF NOT EXISTS idx_analysis_tasks_user_created_at_id ON analysis_tasks (user_id, created_at DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_analysis_tasks_user_search_gin ON analysis_tasks USING gin (search_text gin_trgm_ops)`,
		// Community search trigram indexes for keyword matching
		`CREATE INDEX IF NOT EXISTS idx_weapp_user_nickname_gin ON weapp_user USING gin (nickname gin_trgm_ops)`,
		`CREATE INDEX IF NOT EXISTS idx_user_food_records_desc_gin ON user_food_records USING gin ((COALESCE(description, '')) gin_trgm_ops) WHERE hidden_from_feed = false`,
		`CREATE INDEX IF NOT EXISTS idx_user_exercise_logs_desc_gin ON user_exercise_logs USING gin ((COALESCE(exercise_desc, '')) gin_trgm_ops)`,
		`CREATE INDEX IF NOT EXISTS idx_exercise_energy_library_search_gin ON exercise_energy_library USING gin (((COALESCE(canonical_name, '') || ' ' || COALESCE(category, '') || ' ' || COALESCE(evidence, ''))) gin_trgm_ops)`,
		`CREATE INDEX IF NOT EXISTS idx_exercise_energy_aliases_alias_gin ON exercise_energy_aliases USING gin ((COALESCE(alias_name, '')) gin_trgm_ops)`,
		`CREATE INDEX IF NOT EXISTS idx_user_circle_posts_search_gin ON user_circle_posts USING gin (((COALESCE(title, '') || ' ' || COALESCE(body, ''))) gin_trgm_ops)`,
		// Analysis feedback samples extra columns/indexes for frontend tracking
		`ALTER TABLE analysis_feedback_samples ADD COLUMN IF NOT EXISTS resolution_state text NOT NULL DEFAULT 'user_corrected'`,
		`ALTER TABLE analysis_feedback_samples ADD COLUMN IF NOT EXISTS source_record_id uuid`,
		`CREATE INDEX IF NOT EXISTS idx_analysis_feedback_samples_source_record_id ON analysis_feedback_samples (source_record_id)`,
		`CREATE INDEX IF NOT EXISTS idx_analysis_feedback_samples_resolution_state ON analysis_feedback_samples (resolution_state)`,
		// School badge logo URL
		`ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_url text`,
		// Circle posts: title/body split + extended nutrition fields
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS title text`,
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS body text`,
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS fiber numeric(10,2)`,
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS sugar numeric(10,2)`,
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS sodium_mg numeric(10,2)`,
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS total_weight_grams numeric(10,2)`,
		`UPDATE user_circle_posts SET body = content WHERE body IS NULL AND content IS NOT NULL AND content <> ''`,
		`UPDATE user_circle_posts SET content = '' WHERE content IS NULL`,
	} {
		if sql == "" {
			continue
		}
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("apply index statement: %w", err)
		}
	}
	return nil
}

func ensureTriggers(ctx context.Context, db *gorm.DB) error {
	for _, sql := range []string{
		`CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql`,
		`DROP TRIGGER IF EXISTS trigger_update_food_expiry_notification_jobs_updated_at ON food_expiry_notification_jobs`,
		`CREATE TRIGGER trigger_update_food_expiry_notification_jobs_updated_at BEFORE UPDATE ON food_expiry_notification_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`,
		`DROP TRIGGER IF EXISTS trigger_update_user_recipes_updated_at ON user_recipes`,
		`CREATE TRIGGER trigger_update_user_recipes_updated_at BEFORE UPDATE ON user_recipes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`,
		`DROP TRIGGER IF EXISTS trigger_update_user_circle_posts_updated_at ON user_circle_posts`,
		`CREATE TRIGGER trigger_update_user_circle_posts_updated_at BEFORE UPDATE ON user_circle_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`,
	} {
		if sql == "" {
			continue
		}
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("apply trigger statement: %w", err)
		}
	}
	return nil
}

func ensurePublicFoodTypeBackfill(ctx context.Context, db *gorm.DB) error {
	sql := `
UPDATE public_food_library
SET type = CASE WHEN COALESCE(is_campus_food, false) THEN 'campus' ELSE 'common' END
WHERE type IS NULL OR type = '' OR (type = 'common' AND COALESCE(is_campus_food, false) = true)
`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("backfill public_food_library type: %w", err)
	}
	return nil
}

func ensureTrialEntitlementBackfill(ctx context.Context, db *gorm.DB) error {
	sql := `
WITH ranked_users AS (
  SELECT
    id,
    openid,
    unionid,
    create_time,
    CASE
      -- Registration trials were briefly issued as pending vouchers. They did
      -- not become active until manually redeemed, so compensate affected users
      -- with their full trial period from this migration.
      WHEN EXISTS (
        SELECT 1
        FROM user_vouchers v
        WHERE v.user_id = weapp_user.id
          AND v.voucher_type = 'registration_trial'
      ) THEN now()
      ELSE COALESCE(create_time, now())
    END AS trial_started_at,
    ROW_NUMBER() OVER (
      ORDER BY create_time IS NULL ASC, create_time ASC, id ASC
    ) AS registration_rank
  FROM weapp_user
  WHERE openid IS NOT NULL AND openid <> ''
),
prepared AS (
  SELECT
    gen_random_uuid() AS id,
    id AS first_user_id,
    openid,
    unionid,
    trial_started_at AS first_registered_at,
    CASE
      WHEN registration_rank <= 1000 THEN registration_rank
      ELSE NULL
    END AS early_user_rank,
    CASE
      WHEN registration_rank <= 500 THEN 60
      WHEN registration_rank <= 1000 THEN 30
      ELSE 3
    END AS trial_days_total,
    CASE
      WHEN registration_rank <= 500 THEN 'founding_top_500_bonus_month'
      WHEN registration_rank <= 1000 THEN 'early_first_1000'
      ELSE 'regular_new_user'
    END AS trial_policy,
    now() AS created_at,
    now() AS updated_at
  FROM ranked_users
)
INSERT INTO user_trial_entitlements (
  id,
  first_user_id,
  openid,
  unionid,
  first_registered_at,
  early_user_rank,
  trial_days_total,
  trial_policy,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.first_user_id,
  p.openid,
  p.unionid,
  p.first_registered_at,
  p.early_user_rank,
  p.trial_days_total,
  p.trial_policy,
  p.created_at,
  p.updated_at
FROM prepared p
WHERE NOT EXISTS (
  SELECT 1
  FROM user_trial_entitlements e
  WHERE e.first_user_id = p.first_user_id
);`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("backfill user trial entitlements: %w", err)
	}
	return nil
}

// ensureDeferredRegistrationTrialCompensation repairs registrations that were
// initially backfilled with their original registration time after a deferred
// trial voucher had already been auto-activated. They receive the full three
// days from the repair time, exactly once.
func ensureDeferredRegistrationTrialCompensation(ctx context.Context, db *gorm.DB) error {
	result := db.WithContext(ctx).Exec(`
UPDATE user_trial_entitlements e
SET first_registered_at = now(),
    trial_days_total = 3,
    trial_policy = 'regular_new_user',
    early_user_rank = NULL,
    updated_at = now()
FROM weapp_user u
JOIN user_vouchers v
  ON v.user_id = u.id
WHERE e.first_user_id = u.id
  AND v.voucher_type = 'registration_trial'
  AND v.status = 'used'
  AND v.used_at IS NOT NULL
  AND e.created_at IS NOT NULL
  AND e.first_registered_at < e.created_at - INTERVAL '1 hour'
  AND v.used_at > u.create_time + INTERVAL '1 hour'
`)
	if result.Error != nil {
		return fmt.Errorf("compensate deferred registration trials: %w", result.Error)
	}
	return nil
}

// ensureRegistrationTrialVouchersAutoApplied closes the historical deferred
// registration vouchers after their trial entitlement has been activated. Invite
// and admin vouchers remain explicitly user-redeemable.
func ensureRegistrationTrialVouchersAutoApplied(ctx context.Context, db *gorm.DB) error {
	result := db.WithContext(ctx).Exec(`
UPDATE user_vouchers v
SET status = 'used',
    used_at = COALESCE(v.used_at, now()),
    updated_at = now()
WHERE v.voucher_type = 'registration_trial'
  AND v.status IN ('pending', 'expired')
  AND EXISTS (
    SELECT 1
    FROM user_trial_entitlements e
    WHERE e.first_user_id = v.user_id
  )
`)
	if result.Error != nil {
		return fmt.Errorf("activate historical registration trial vouchers: %w", result.Error)
	}
	return nil
}

func ensureSchoolsSeed(ctx context.Context, db *gorm.DB) error {
	var count int64
	if err := db.WithContext(ctx).Raw("SELECT COUNT(*) FROM schools").Scan(&count).Error; err != nil {
		return fmt.Errorf("count schools: %w", err)
	}
	if count > 0 {
		return nil
	}

	data, err := os.ReadFile("data/schools_seed.json")
	if err != nil {
		return fmt.Errorf("read schools seed file: %w", err)
	}

	var seeds []struct {
		Name     string  `json:"name"`
		Province *string `json:"province"`
		City     *string `json:"city"`
		Level    *string `json:"level"`
		Is985    *bool   `json:"is_985"`
		Is211    *bool   `json:"is_211"`
	}
	if err := json.Unmarshal(data, &seeds); err != nil {
		return fmt.Errorf("parse schools seed file: %w", err)
	}

	for _, s := range seeds {
		do := migrationdo.SchoolDO{
			Name:     s.Name,
			Province: s.Province,
			City:     s.City,
			Level:    s.Level,
			Is985:    s.Is985,
			Is211:    s.Is211,
			Status:   "active",
		}
		if err := db.WithContext(ctx).Create(&do).Error; err != nil {
			return fmt.Errorf("insert school %q: %w", s.Name, err)
		}
	}
	return nil
}

// ensureDiningLocationType keeps the legacy schools table compatible while
// allowing the shared dining directory to also contain companies and communities.
func ensureDiningLocationType(ctx context.Context, db *gorm.DB) error {
	statements := []string{
		`ALTER TABLE schools ADD COLUMN IF NOT EXISTS location_type text NOT NULL DEFAULT 'university'`,
		`UPDATE schools SET location_type = 'university' WHERE NULLIF(trim(location_type), '') IS NULL`,
		`CREATE INDEX IF NOT EXISTS idx_schools_location_type ON schools(location_type)`,
		`ALTER TABLE schools DROP CONSTRAINT IF EXISTS chk_schools_location_type`,
		`ALTER TABLE schools ADD CONSTRAINT chk_schools_location_type CHECK (location_type IN ('university', 'company', 'community'))`,
	}
	for _, statement := range statements {
		if err := db.WithContext(ctx).Exec(statement).Error; err != nil {
			return fmt.Errorf("ensure dining location type: %w", err)
		}
	}
	return nil
}

type officialHigherEducationSnapshot struct {
	SourceVersion string                               `json:"source_version"`
	Sources       []string                             `json:"sources"`
	Institutions  []officialHigherEducationInstitution `json:"institutions"`
}

type officialHigherEducationInstitution struct {
	Name         string `json:"name"`
	OfficialCode string `json:"official_code"`
	Authority    string `json:"authority"`
	Province     string `json:"province"`
	Level        string `json:"level"`
	Kind         string `json:"kind"`
}

func ensureOfficialHigherEducationDirectory(ctx context.Context, db *gorm.DB) error {
	snapshot, err := loadOfficialHigherEducationSnapshot()
	if err != nil {
		return err
	}
	if snapshot.SourceVersion != "2026-06-17" || len(snapshot.Institutions) != 3196 {
		return fmt.Errorf("validate official higher education snapshot: version=%q institutions=%d", snapshot.SourceVersion, len(snapshot.Institutions))
	}
	rows := make([]officialHigherEducationSyncRow, 0, len(snapshot.Institutions))
	for _, institution := range snapshot.Institutions {
		if err := validateOfficialHigherEducationInstitution(institution); err != nil {
			return err
		}
		rows = append(rows, officialHigherEducationSyncRow{
			Name:                  institution.Name,
			NormalizedName:        normalizeOfficialSchoolName(institution.Name),
			OfficialCode:          institution.OfficialCode,
			Authority:             nullableText(institution.Authority),
			OfficialSourceVersion: snapshot.SourceVersion,
			InstitutionKind:       institution.Kind,
			Province:              nullableText(institution.Province),
			Level:                 nullableText(institution.Level),
		})
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		const table = "official_higher_education_sync"
		if err := tx.Exec(`CREATE TEMP TABLE official_higher_education_sync (
			name text NOT NULL,
			normalized_name text NOT NULL,
			official_code text PRIMARY KEY,
			authority text,
			official_source_version text NOT NULL,
			institution_kind text NOT NULL,
			province text,
			level text
		) ON COMMIT DROP`).Error; err != nil {
			return fmt.Errorf("create official higher education sync table: %w", err)
		}
		if err := tx.Table(table).CreateInBatches(&rows, 500).Error; err != nil {
			return fmt.Errorf("stage official higher education directory: %w", err)
		}
		if err := tx.Exec(`UPDATE schools AS school
			SET name = source.name,
				authority = source.authority,
				official_source_version = source.official_source_version,
				institution_kind = source.institution_kind,
				province = source.province,
				level = source.level,
				status = 'active'
			FROM official_higher_education_sync AS source
			WHERE school.location_type = 'university'
				AND school.official_code = source.official_code`).Error; err != nil {
			return fmt.Errorf("refresh coded official higher education institutions: %w", err)
		}
		if err := tx.Exec(`UPDATE schools AS school
			SET name = source.name,
				official_code = source.official_code,
				authority = source.authority,
				official_source_version = source.official_source_version,
				institution_kind = source.institution_kind,
				province = source.province,
				level = source.level,
				status = 'active'
			FROM official_higher_education_sync AS source
			WHERE school.location_type = 'university'
				AND (school.official_code IS NULL OR trim(school.official_code) = '')
				AND regexp_replace(replace(replace(school.name, '（', '('), '）', ')'), '\s+', '', 'g') = source.normalized_name`).Error; err != nil {
			return fmt.Errorf("match legacy higher education institutions by name: %w", err)
		}
		if err := tx.Exec(`INSERT INTO schools (
			name, location_type, official_code, authority, official_source_version,
			institution_kind, province, level, status
		)
		SELECT name, 'university', official_code, authority, official_source_version,
			institution_kind, province, level, 'active'
		FROM official_higher_education_sync
		ON CONFLICT (official_code) DO UPDATE SET
			name = EXCLUDED.name,
			authority = EXCLUDED.authority,
			official_source_version = EXCLUDED.official_source_version,
			institution_kind = EXCLUDED.institution_kind,
			province = EXCLUDED.province,
			level = EXCLUDED.level,
			status = 'active'`).Error; err != nil {
			return fmt.Errorf("upsert official higher education institutions: %w", err)
		}
		return nil
	})
}

func retireLegacyHigherEducationSeedRows(ctx context.Context, db *gorm.DB) error {
	data, err := os.ReadFile("data/schools_seed.json")
	if err != nil {
		return fmt.Errorf("read legacy higher education seed: %w", err)
	}
	var seeds []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(data, &seeds); err != nil {
		return fmt.Errorf("parse legacy higher education seed: %w", err)
	}
	names := make([]string, 0, len(seeds))
	for _, seed := range seeds {
		if name := strings.TrimSpace(seed.Name); name != "" {
			names = append(names, name)
		}
	}
	for start := 0; start < len(names); start += 500 {
		end := start + 500
		if end > len(names) {
			end = len(names)
		}
		if err := db.WithContext(ctx).Model(&migrationdo.SchoolDO{}).
			Where("location_type = ? AND official_source_version IS NULL AND status = ? AND name IN ?", "university", "active", names[start:end]).
			Update("status", "inactive").Error; err != nil {
			return fmt.Errorf("retire outdated higher education seed rows: %w", err)
		}
	}
	return nil
}

type officialHigherEducationSyncRow struct {
	Name                  string  `gorm:"column:name"`
	NormalizedName        string  `gorm:"column:normalized_name"`
	OfficialCode          string  `gorm:"column:official_code"`
	Authority             *string `gorm:"column:authority"`
	OfficialSourceVersion string  `gorm:"column:official_source_version"`
	InstitutionKind       string  `gorm:"column:institution_kind"`
	Province              *string `gorm:"column:province"`
	Level                 *string `gorm:"column:level"`
}

func loadOfficialHigherEducationSnapshot() (*officialHigherEducationSnapshot, error) {
	encoded := strings.Join(strings.Fields(officialHigherEducation2026Data), "")
	compressed, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode official higher education snapshot: %w", err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, fmt.Errorf("open official higher education snapshot: %w", err)
	}
	defer reader.Close()
	raw, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read official higher education snapshot: %w", err)
	}
	var snapshot officialHigherEducationSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return nil, fmt.Errorf("parse official higher education snapshot: %w", err)
	}
	return &snapshot, nil
}

func validateOfficialHigherEducationInstitution(institution officialHigherEducationInstitution) error {
	if strings.TrimSpace(institution.Name) == "" || strings.TrimSpace(institution.OfficialCode) == "" {
		return fmt.Errorf("validate official higher education institution: name/code is required")
	}
	if institution.Kind != "regular" && institution.Kind != "adult" {
		return fmt.Errorf("validate official higher education institution %q: unsupported kind %q", institution.Name, institution.Kind)
	}
	return nil
}

func normalizeOfficialSchoolName(value string) string {
	value = strings.NewReplacer("（", "(", "）", ")").Replace(value)
	return strings.Join(strings.Fields(strings.TrimSpace(value)), "")
}

func nullableText(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

type campusDirectorySeed struct {
	School    string              `json:"school"`
	SourceURL string              `json:"source_url"`
	Campuses  []campusSeed        `json:"campuses"`
	Canteens  []campusCanteenSeed `json:"canteens"`
}

type campusSeed struct {
	Name      string `json:"name"`
	SourceURL string `json:"source_url"`
}

type campusCanteenSeed struct {
	Campus string `json:"campus"`
	Name   string `json:"name"`
}

type campusDirectoryImportBatchSeed struct {
	Name          string `json:"name"`
	Region        string `json:"region"`
	SourceScope   string `json:"source_scope"`
	Status        string `json:"status"`
	TotalSchools  int    `json:"total_schools"`
	TotalCampuses int    `json:"total_campuses"`
	TotalCanteens int    `json:"total_canteens"`
	TotalWindows  int    `json:"total_windows"`
	TotalSources  int    `json:"total_sources"`
	Notes         string `json:"notes"`
}

type campusDirectoryPendingResearchSeed struct {
	BatchName   string                        `json:"batch_name"`
	Region      string                        `json:"region"`
	SourceScope string                        `json:"source_scope"`
	Schools     []campusDirectoryResearchItem `json:"schools"`
}

type campusDirectoryResearchItem struct {
	School       string                           `json:"school"`
	ReviewStatus string                           `json:"review_status"`
	Campuses     []campusDirectoryResearchCampus  `json:"campuses"`
	Canteens     []campusDirectoryResearchCanteen `json:"canteens"`
	Windows      []campusDirectoryResearchWindow  `json:"windows"`
	Notes        []string                         `json:"notes"`
}

type campusDirectoryResearchCampus struct {
	Name      string   `json:"name"`
	Aliases   []string `json:"aliases"`
	Address   string   `json:"address"`
	SourceURL string   `json:"source_url"`
}

type campusDirectoryResearchCanteen struct {
	Campus            string                          `json:"campus"`
	Name              string                          `json:"name"`
	Aliases           []string                        `json:"aliases"`
	LocationText      string                          `json:"location_text"`
	BuildingOrFloor   string                          `json:"building_or_floor"`
	ServiceType       string                          `json:"service_type"`
	Audience          string                          `json:"audience"`
	OpeningHoursRaw   string                          `json:"opening_hours_raw"`
	SourceURL         string                          `json:"source_url"`
	SourceTitle       string                          `json:"source_title"`
	SourceOrg         string                          `json:"source_org"`
	SourceType        string                          `json:"source_type"`
	EvidenceLevel     string                          `json:"evidence_level"`
	EvidenceExcerpt   string                          `json:"evidence_excerpt"`
	ReviewStatus      string                          `json:"review_status"`
	AdditionalSources []campusDirectoryResearchSource `json:"additional_sources"`
}

type campusDirectoryResearchSource struct {
	SourceURL       string `json:"source_url"`
	SourceTitle     string `json:"source_title"`
	SourceOrg       string `json:"source_org"`
	SourceType      string `json:"source_type"`
	EvidenceLevel   string `json:"evidence_level"`
	EvidenceExcerpt string `json:"evidence_excerpt"`
}

type campusDirectoryResearchWindow struct {
	Campus          string   `json:"campus"`
	Canteen         string   `json:"canteen"`
	Name            string   `json:"name"`
	Aliases         []string `json:"aliases"`
	Floor           string   `json:"floor"`
	SourceURL       string   `json:"source_url"`
	SourceTitle     string   `json:"source_title"`
	SourceOrg       string   `json:"source_org"`
	SourceType      string   `json:"source_type"`
	EvidenceLevel   string   `json:"evidence_level"`
	EvidenceExcerpt string   `json:"evidence_excerpt"`
	ReviewStatus    string   `json:"review_status"`
}

func ensureCampusDirectoryImportBatchSeed(ctx context.Context, db *gorm.DB) error {
	data, err := os.ReadFile("data/campus_directory_import_batches_seed.json")
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read campus directory import batch seed file: %w", err)
	}
	var seeds []campusDirectoryImportBatchSeed
	if err := json.Unmarshal(data, &seeds); err != nil {
		return fmt.Errorf("parse campus directory import batch seed file: %w", err)
	}
	for _, seed := range seeds {
		name := strings.TrimSpace(seed.Name)
		if name == "" {
			continue
		}
		status := strings.TrimSpace(seed.Status)
		if status == "" {
			status = "pending_review"
		}
		row := migrationdo.CampusDirectoryImportBatchDO{
			Name:          name,
			Region:        stringPtr(strings.TrimSpace(seed.Region)),
			SourceScope:   stringPtr(strings.TrimSpace(seed.SourceScope)),
			Status:        status,
			TotalSchools:  seed.TotalSchools,
			TotalCampuses: seed.TotalCampuses,
			TotalCanteens: seed.TotalCanteens,
			TotalWindows:  seed.TotalWindows,
			TotalSources:  seed.TotalSources,
			Notes:         stringPtr(strings.TrimSpace(seed.Notes)),
		}
		if err := db.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "name"}}, DoNothing: true}).Create(&row).Error; err != nil {
			return fmt.Errorf("insert campus directory import batch %q: %w", name, err)
		}
	}
	return nil
}

func ensureCampusDirectoryPendingResearchSeed(ctx context.Context, db *gorm.DB) error {
	return ensureCampusDirectoryResearchSeedFile(ctx, db, "data/campus_directory_pending_research_seed.json")
}

// ImportPendingCampusDirectoryResearch imports the pending-review research seed in a
// single transaction. It is intentionally separate from schema migration so a
// failed batch cannot leave a partially-created school hierarchy behind.
func ImportPendingCampusDirectoryResearch(ctx context.Context, db *gorm.DB, schema string) error {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + schema).Error; err != nil {
			return fmt.Errorf("set campus directory import schema: %w", err)
		}
		return ensureCampusDirectoryPendingResearchSeed(ctx, tx)
	})
}

func ensureBeijingOwnerVerifiedDiningSeed(ctx context.Context, db *gorm.DB) error {
	return ensureCampusDirectoryResearchSeedFile(ctx, db, "data/beijing_owner_verified_dining_seed.json")
}

func ensureCampusDirectoryResearchSeedFile(ctx context.Context, db *gorm.DB, path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read campus directory research seed file %q: %w", path, err)
	}
	var seeds []campusDirectoryPendingResearchSeed
	if err := json.Unmarshal(data, &seeds); err != nil {
		return fmt.Errorf("parse campus directory research seed file %q: %w", path, err)
	}
	for _, batchSeed := range seeds {
		batchName := strings.TrimSpace(batchSeed.BatchName)
		if batchName == "" {
			continue
		}
		batchID, err := ensureCampusDirectoryPendingBatch(ctx, db, batchSeed)
		if err != nil {
			return err
		}
		for _, schoolSeed := range batchSeed.Schools {
			if err := ensureCampusDirectoryPendingSchoolResearch(ctx, db, batchID, schoolSeed); err != nil {
				return err
			}
		}
	}
	return nil
}

// ensureVerifiedDiningDirectoryPublication promotes only direct official
// evidence (level A) to the user-facing directory. Window-like rows are kept
// out of the canteen list; the small number that can be linked to one exact
// parent canteen are migrated into canteen_windows below.
func ensureVerifiedDiningDirectoryPublication(ctx context.Context, db *gorm.DB) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		statements := []string{
			`UPDATE campus_directory_sources
			 SET review_status = 'approved', updated_at = now()
			 WHERE (evidence_level = 'A'
			     OR (evidence_level = 'D' AND source_type LIKE 'user_verified%'))
			   AND review_status <> 'approved'`,
			`UPDATE school_canteens AS c
			 SET status = 'active',
			     review_note = CASE
			       WHEN EXISTS (
			         SELECT 1 FROM campus_directory_sources AS user_source
			         WHERE user_source.canteen_id = c.id
			           AND user_source.evidence_level = 'D'
			           AND user_source.source_type LIKE 'user_verified%'
			           AND user_source.review_status = 'approved'
			       ) THEN '用户已核验的现行餐饮目录记录'
			       ELSE 'A级官方公开来源自动发布'
			     END,
			     reviewed_at = COALESCE(c.reviewed_at, now()),
			     updated_at = now()
			 WHERE c.status = 'pending_review'
			   AND c.name !~ '(窗口|档口)'
			   AND EXISTS (
			     SELECT 1 FROM campus_directory_sources AS s
			     WHERE s.canteen_id = c.id
			       AND (s.evidence_level = 'A'
			         OR (s.evidence_level = 'D' AND s.source_type LIKE 'user_verified%'))
			       AND s.review_status = 'approved'
			   )`,
			`UPDATE canteen_windows AS w
			 SET status = 'active', updated_at = now()
			 WHERE w.status = 'pending_review'
			   AND EXISTS (
			     SELECT 1 FROM campus_directory_sources AS s
			     WHERE s.canteen_id = w.canteen_id
			       AND s.source_url = w.source_url
			       AND s.evidence_level = 'A'
			       AND s.review_status = 'approved'
			   )`,
			`UPDATE school_campuses AS campus
			 SET status = 'active', updated_at = now()
			 WHERE campus.status = 'pending_review'
			   AND EXISTS (
			     SELECT 1 FROM school_canteens AS c
			     WHERE c.campus_id = campus.id AND c.status = 'active'
			   )`,
			`UPDATE campus_directory_import_batches AS batch
			 SET status = 'approved', updated_at = now()
			 WHERE batch.name = '北京92所高校食堂目录-产品负责人确认-20260727'
			   AND NOT EXISTS (
			     SELECT 1 FROM campus_directory_sources AS source
			     WHERE source.batch_id = batch.id
			       AND source.review_status <> 'approved'
			   )`,
			`INSERT INTO canteen_windows (
			   id, school_id, campus_id, canteen_id, name, aliases, floor,
			   source_url, status, sort_order, created_at, updated_at
			 )
			 SELECT gen_random_uuid(), parent.school_id,
			        COALESCE(parent.campus_id, child.campus_id), parent.id,
			        '清真窗口', '[]'::jsonb, '一楼', child.source_url,
			        'active', 1, now(), now()
			 FROM schools AS school
			 JOIN school_canteens AS child
			   ON child.school_id = school.id AND child.name = '棘园一楼清真窗口'
			 JOIN school_canteens AS parent
			   ON parent.school_id = school.id AND parent.name = '棘园餐厅'
			 WHERE school.name = '东北农业大学'
			   AND parent.status = 'active'
			   AND EXISTS (
			     SELECT 1 FROM campus_directory_sources AS source
			     WHERE source.canteen_id = child.id
			       AND source.evidence_level = 'A'
			       AND source.review_status = 'approved'
			   )
			   AND NOT EXISTS (
			     SELECT 1 FROM canteen_windows AS cw
			     WHERE cw.canteen_id = parent.id
			       AND cw.name = '清真窗口'
			       AND cw.floor = '一楼'
			       AND cw.status <> 'deleted'
			   )`,
			`INSERT INTO canteen_windows (
			   id, school_id, campus_id, canteen_id, name, aliases, floor,
			   source_url, status, sort_order, created_at, updated_at
			 )
			 SELECT gen_random_uuid(), parent.school_id,
			        COALESCE(parent.campus_id, child.campus_id), parent.id,
			        '教工午餐档口', '[]'::jsonb, '负一楼', child.source_url,
			        'active', 1, now(), now()
			 FROM schools AS school
			 JOIN school_canteens AS child
			   ON child.school_id = school.id AND child.name = '国内大厦负一层食堂教工午餐档口'
			 JOIN school_canteens AS parent
			   ON parent.school_id = school.id AND parent.name = '国内大厦学生食堂'
			 WHERE school.name = '北京外国语大学'
			   AND parent.status = 'active'
			   AND EXISTS (
			     SELECT 1 FROM campus_directory_sources AS source
			     WHERE source.canteen_id = child.id
			       AND source.evidence_level = 'A'
			       AND source.review_status = 'approved'
			   )
			   AND NOT EXISTS (
			     SELECT 1 FROM canteen_windows AS cw
			     WHERE cw.canteen_id = parent.id
			       AND cw.name = '教工午餐档口'
			       AND cw.floor = '负一楼'
			       AND cw.status <> 'deleted'
			   )`,
			`UPDATE school_canteens AS child
			 SET status = 'inactive',
			     review_note = '该记录属于窗口/档口，已迁移到对应食堂窗口目录',
			     reviewed_at = COALESCE(child.reviewed_at, now()),
			     updated_at = now()
			 FROM schools AS school
			 WHERE child.school_id = school.id
			   AND ((school.name = '东北农业大学' AND child.name = '棘园一楼清真窗口')
			     OR (school.name = '北京外国语大学' AND child.name = '国内大厦负一层食堂教工午餐档口'))
			   AND EXISTS (
			     SELECT 1 FROM canteen_windows AS cw
			     WHERE cw.school_id = child.school_id
			       AND cw.source_url = child.source_url
			       AND cw.status = 'active'
			   )`,
			`UPDATE school_canteens AS canteen
			 SET building_or_floor = NULL,
			     updated_at = now()
			 FROM schools AS school
			 WHERE canteen.school_id = school.id
			   AND school.name = '中国政法大学'
			   AND canteen.name = '二食堂'
			   AND trim(COALESCE(canteen.building_or_floor, '')) = '清真食堂位于二食堂二层'`,
			`WITH mappings(school_name, duplicate_campus, duplicate_name, canonical_campus, canonical_name) AS (
			   VALUES
			     ('中国石油大学（北京）', '北京校区', '学生第一食堂', '北校园', '学生第一食堂'),
			     ('中国石油大学（北京）', '北京校区', '学生第二食堂', '北校园', '学生第二食堂'),
			     ('中国矿业大学（北京）', '学院路校区', '丰园餐厅', '学院路校区', '丰园'),
			     ('中国矿业大学（北京）', '学院路校区', '清真餐厅', '学院路校区', '清真园'),
			     ('中国矿业大学（北京）', '沙河校区', '豐园餐厅', '沙河校区', '丰园'),
			     ('中国矿业大学（北京）', '沙河校区', '菁园餐厅', '沙河校区', '菁园'),
			     ('中国矿业大学（北京）', '沙河校区', '馨园餐厅', '沙河校区', '馨园')
			 ), pairs AS (
			   SELECT duplicate.id AS duplicate_id, canonical.id AS canonical_id,
			          canonical.campus_id AS canonical_campus_id
			   FROM mappings AS mapping
			   JOIN schools AS school ON school.name = mapping.school_name
			   JOIN school_campuses AS duplicate_campus
			     ON duplicate_campus.school_id = school.id AND duplicate_campus.name = mapping.duplicate_campus
			   JOIN school_canteens AS duplicate
			     ON duplicate.school_id = school.id AND duplicate.campus_id = duplicate_campus.id
			    AND duplicate.name = mapping.duplicate_name AND duplicate.status <> 'deleted'
			   JOIN school_campuses AS canonical_campus
			     ON canonical_campus.school_id = school.id AND canonical_campus.name = mapping.canonical_campus
			   JOIN school_canteens AS canonical
			     ON canonical.school_id = school.id AND canonical.campus_id = canonical_campus.id
			    AND canonical.name = mapping.canonical_name AND canonical.status <> 'deleted'
			 )
			 UPDATE campus_directory_sources AS source
			 SET canteen_id = pairs.canonical_id,
			     campus_id = pairs.canonical_campus_id,
			     updated_at = now()
			 FROM pairs
			 WHERE source.canteen_id = pairs.duplicate_id
			   AND NOT EXISTS (
			     SELECT 1 FROM campus_directory_sources AS existing
			     WHERE existing.school_id = source.school_id
			       AND existing.canteen_id = pairs.canonical_id
			       AND existing.source_url = source.source_url
			   )`,
			`WITH mappings(school_name, duplicate_campus, duplicate_name, canonical_campus, canonical_name) AS (
			   VALUES
			     ('中国石油大学（北京）', '北京校区', '学生第一食堂', '北校园', '学生第一食堂'),
			     ('中国石油大学（北京）', '北京校区', '学生第二食堂', '北校园', '学生第二食堂'),
			     ('中国矿业大学（北京）', '学院路校区', '丰园餐厅', '学院路校区', '丰园'),
			     ('中国矿业大学（北京）', '学院路校区', '清真餐厅', '学院路校区', '清真园'),
			     ('中国矿业大学（北京）', '沙河校区', '豐园餐厅', '沙河校区', '丰园'),
			     ('中国矿业大学（北京）', '沙河校区', '菁园餐厅', '沙河校区', '菁园'),
			     ('中国矿业大学（北京）', '沙河校区', '馨园餐厅', '沙河校区', '馨园')
			 ), pairs AS (
			   SELECT duplicate.id AS duplicate_id, canonical.id AS canonical_id
			   FROM mappings AS mapping
			   JOIN schools AS school ON school.name = mapping.school_name
			   JOIN school_campuses AS duplicate_campus
			     ON duplicate_campus.school_id = school.id AND duplicate_campus.name = mapping.duplicate_campus
			   JOIN school_canteens AS duplicate
			     ON duplicate.school_id = school.id AND duplicate.campus_id = duplicate_campus.id
			    AND duplicate.name = mapping.duplicate_name AND duplicate.status <> 'deleted'
			   JOIN school_campuses AS canonical_campus
			     ON canonical_campus.school_id = school.id AND canonical_campus.name = mapping.canonical_campus
			   JOIN school_canteens AS canonical
			     ON canonical.school_id = school.id AND canonical.campus_id = canonical_campus.id
			    AND canonical.name = mapping.canonical_name AND canonical.status <> 'deleted'
			 )
			 DELETE FROM campus_directory_sources AS source
			 USING pairs
			 WHERE source.canteen_id = pairs.duplicate_id
			   AND EXISTS (
			     SELECT 1 FROM campus_directory_sources AS existing
			     WHERE existing.school_id = source.school_id
			       AND existing.canteen_id = pairs.canonical_id
			       AND existing.source_url = source.source_url
			   )`,
			`WITH mappings(school_name, duplicate_campus, duplicate_name, canonical_campus, canonical_name) AS (
			   VALUES
			     ('中国石油大学（北京）', '北京校区', '学生第一食堂', '北校园', '学生第一食堂'),
			     ('中国石油大学（北京）', '北京校区', '学生第二食堂', '北校园', '学生第二食堂'),
			     ('中国矿业大学（北京）', '学院路校区', '丰园餐厅', '学院路校区', '丰园'),
			     ('中国矿业大学（北京）', '学院路校区', '清真餐厅', '学院路校区', '清真园'),
			     ('中国矿业大学（北京）', '沙河校区', '豐园餐厅', '沙河校区', '丰园'),
			     ('中国矿业大学（北京）', '沙河校区', '菁园餐厅', '沙河校区', '菁园'),
			     ('中国矿业大学（北京）', '沙河校区', '馨园餐厅', '沙河校区', '馨园')
			 ), duplicate_rows AS (
			   SELECT duplicate.id
			   FROM mappings AS mapping
			   JOIN schools AS school ON school.name = mapping.school_name
			   JOIN school_campuses AS duplicate_campus
			     ON duplicate_campus.school_id = school.id AND duplicate_campus.name = mapping.duplicate_campus
			   JOIN school_canteens AS duplicate
			     ON duplicate.school_id = school.id AND duplicate.campus_id = duplicate_campus.id
			    AND duplicate.name = mapping.duplicate_name AND duplicate.status <> 'deleted'
			   JOIN school_campuses AS canonical_campus
			     ON canonical_campus.school_id = school.id AND canonical_campus.name = mapping.canonical_campus
			   JOIN school_canteens AS canonical
			     ON canonical.school_id = school.id AND canonical.campus_id = canonical_campus.id
			    AND canonical.name = mapping.canonical_name AND canonical.status <> 'deleted'
			 )
			 UPDATE school_canteens AS duplicate
			 SET status = 'inactive',
			     review_note = '同义食堂记录已合并到官方校区下的规范名称',
			     updated_at = now()
			 FROM duplicate_rows
			 WHERE duplicate.id = duplicate_rows.id`,
			`UPDATE school_canteens AS canteen
			 SET status = 'inactive',
			     review_note = '已由用户提供的精确食堂名称和楼层记录替代；历史泛称不再作为现行下拉项',
			     reviewed_at = COALESCE(canteen.reviewed_at, now()),
			     updated_at = now()
			 FROM schools AS school
			 WHERE canteen.school_id = school.id
			   AND school.name = '北京协和医学院'
			   AND canteen.name IN ('食堂', '学生食堂', '八大处校区食堂')
			   AND canteen.status NOT IN ('deleted', 'rejected')`,
			`WITH stale_rows AS (
			   SELECT canteen.id
			   FROM school_canteens AS canteen
			   JOIN schools AS school ON school.id = canteen.school_id
			   JOIN school_campuses AS campus ON campus.id = canteen.campus_id
			   WHERE school.name = '北京大学'
			     AND canteen.status NOT IN ('deleted', 'rejected')
			     AND ((campus.name = '燕园校区' AND canteen.name = '燕南美食')
			       OR (campus.name = '燕园校区' AND canteen.name = '馨园食堂'))
			 )
			 UPDATE school_canteens AS canteen
			 SET status = 'inactive',
			     review_note = CASE
			       WHEN canteen.name = '馨园食堂' THEN '馨园食堂已纠正到昌平新校区（新燕园校区）'
			       ELSE '旧名称已由当前官方名称燕南食堂替代'
			     END,
			     reviewed_at = COALESCE(canteen.reviewed_at, now()),
			     updated_at = now()
			 FROM stale_rows
			 WHERE canteen.id = stale_rows.id`,
		}
		for _, statement := range statements {
			if err := tx.Exec(statement).Error; err != nil {
				return fmt.Errorf("publish verified dining directory: %w", err)
			}
		}
		return nil
	})
}

// PublishVerifiedDiningDirectory runs the reviewed campus-directory data
// publication independently from the full schema migration. It is used when a
// production table lock prevents AutoMigrate from reaching this idempotent
// data step.
func PublishVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return fmt.Errorf("set search path: %w", err)
	}
	if err := ensureCanteenWindowReviewStatusConstraint(ctx, db); err != nil {
		return fmt.Errorf("upgrade canteen window review status constraint: %w", err)
	}
	if err := ensureCampusDirectoryPendingResearchSeed(ctx, db); err != nil {
		return fmt.Errorf("import reviewed dining directory seed: %w", err)
	}
	if err := ensureBeijingOwnerVerifiedDiningSeed(ctx, db); err != nil {
		return fmt.Errorf("import Beijing owner-verified dining directory seed: %w", err)
	}
	return ensureVerifiedDiningDirectoryPublication(ctx, db)
}

// PublishBeijingOwnerVerifiedDiningDirectory publishes only the owner-approved
// Beijing batch. It deliberately leaves non-Beijing campus dining records
// untouched while the rest of the nationwide dining hierarchy is incomplete.
func PublishBeijingOwnerVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return fmt.Errorf("set search path: %w", err)
	}
	if err := ensureBeijingOwnerVerifiedDiningSeed(ctx, db); err != nil {
		return fmt.Errorf("import Beijing owner-verified dining directory seed: %w", err)
	}
	const batchName = "北京92所高校食堂目录-产品负责人确认-20260727"
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		statements := []string{
			`UPDATE campus_directory_sources AS source
			 SET review_status = 'approved', updated_at = now()
			 FROM campus_directory_import_batches AS batch
			 WHERE source.batch_id = batch.id
			   AND batch.name = ?
			   AND source.review_status <> 'approved'`,
			`UPDATE school_canteens AS canteen
			 SET status = 'active',
			     review_note = '产品负责人确认的北京高校现行食堂目录',
			     reviewed_at = COALESCE(canteen.reviewed_at, now()),
			     updated_at = now()
			 WHERE canteen.status IN ('pending_review', 'inactive')
			   AND canteen.name !~ '(窗口|档口)'
			   AND EXISTS (
			     SELECT 1
			     FROM campus_directory_sources AS source
			     JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id
			     WHERE source.canteen_id = canteen.id
			       AND batch.name = ?
			       AND source.review_status = 'approved'
			   )`,
			`UPDATE school_campuses AS campus
			 SET status = 'active', updated_at = now()
			 WHERE campus.status = 'pending_review'
			   AND EXISTS (
			     SELECT 1
			     FROM school_canteens AS canteen
			     JOIN campus_directory_sources AS source ON source.canteen_id = canteen.id
			     JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id
			     WHERE canteen.campus_id = campus.id
			       AND canteen.status = 'active'
			       AND batch.name = ?
			   )`,
			`UPDATE campus_directory_import_batches
			 SET status = 'approved', updated_at = now()
			 WHERE name = ?`,
		}
		for _, statement := range statements {
			if err := tx.Exec(statement, batchName).Error; err != nil {
				return fmt.Errorf("publish Beijing owner-verified dining directory: %w", err)
			}
		}
		return nil
	})
}

func ensureCanteenWindowReviewStatusConstraint(ctx context.Context, db *gorm.DB) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`ALTER TABLE canteen_windows DROP CONSTRAINT IF EXISTS canteen_windows_status_check`).Error; err != nil {
			return err
		}
		return tx.Exec(`ALTER TABLE canteen_windows ADD CONSTRAINT canteen_windows_status_check CHECK (status = ANY (ARRAY['pending_review'::text,'active'::text,'inactive'::text,'deleted'::text]))`).Error
	})
}

func ensureCampusDirectoryPendingBatch(ctx context.Context, db *gorm.DB, seed campusDirectoryPendingResearchSeed) (string, error) {
	totalCampuses := 0
	totalCanteens := 0
	totalWindows := 0
	totalSources := 0
	noteParts := make([]string, 0, len(seed.Schools))
	for _, school := range seed.Schools {
		totalCampuses += len(school.Campuses)
		totalCanteens += len(school.Canteens)
		totalWindows += len(school.Windows)
		for _, canteen := range school.Canteens {
			if strings.TrimSpace(canteen.SourceURL) != "" {
				totalSources++
			}
			for _, source := range canteen.AdditionalSources {
				if strings.TrimSpace(source.SourceURL) != "" {
					totalSources++
				}
			}
		}
		for _, window := range school.Windows {
			if strings.TrimSpace(window.SourceURL) != "" {
				totalSources++
			}
		}
		for _, note := range school.Notes {
			if trimmed := strings.TrimSpace(note); trimmed != "" {
				noteParts = append(noteParts, strings.TrimSpace(school.School)+": "+trimmed)
			}
		}
	}
	row := migrationdo.CampusDirectoryImportBatchDO{
		Name:          strings.TrimSpace(seed.BatchName),
		Region:        stringPtr(strings.TrimSpace(seed.Region)),
		SourceScope:   stringPtr(strings.TrimSpace(seed.SourceScope)),
		Status:        "pending_review",
		TotalSchools:  len(seed.Schools),
		TotalCampuses: totalCampuses,
		TotalCanteens: totalCanteens,
		TotalWindows:  totalWindows,
		TotalSources:  totalSources,
		Notes:         stringPtr(strings.Join(noteParts, "\n")),
	}
	if row.SourceScope == nil {
		row.SourceScope = stringPtr("学校官网、后勤/总务、餐饮服务中心、校园地图、迎新指南、官方采购公告")
	}
	if err := db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "name"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"region", "source_scope", "total_schools", "total_campuses", "total_canteens", "total_windows", "total_sources", "notes", "updated_at",
		}),
	}).Create(&row).Error; err != nil {
		return "", fmt.Errorf("upsert campus directory pending batch %q: %w", row.Name, err)
	}
	var saved struct {
		ID string
	}
	if err := db.WithContext(ctx).Table("campus_directory_import_batches").Select("id").Where("name = ?", row.Name).Take(&saved).Error; err != nil {
		return "", fmt.Errorf("find campus directory pending batch %q: %w", row.Name, err)
	}
	return saved.ID, nil
}

func ensureCampusDirectoryPendingSchoolResearch(ctx context.Context, db *gorm.DB, batchID string, seed campusDirectoryResearchItem) error {
	schoolName := strings.TrimSpace(seed.School)
	if schoolName == "" {
		return nil
	}
	var school struct {
		ID string
	}
	if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", schoolName, "active").Take(&school).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return fmt.Errorf("find school %q for pending research: %w", schoolName, err)
	}
	campusIDs := map[string]string{}
	canteenIDs := map[string]string{}
	for i, campus := range seed.Campuses {
		name := strings.TrimSpace(campus.Name)
		if name == "" {
			continue
		}
		status := normalizePendingReviewStatus(seed.ReviewStatus)
		row := migrationdo.SchoolCampusDO{
			SchoolID:  school.ID,
			Name:      name,
			Aliases:   campus.Aliases,
			Address:   stringPtr(strings.TrimSpace(campus.Address)),
			SourceURL: stringPtr(strings.TrimSpace(campus.SourceURL)),
			Status:    status,
			SortOrder: i + 1,
		}
		if err := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return fmt.Errorf("insert pending campus %q/%q: %w", schoolName, name, err)
		}
		var saved struct {
			ID string
		}
		if err := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, name, "deleted").Take(&saved).Error; err != nil {
			return fmt.Errorf("find pending campus %q/%q: %w", schoolName, name, err)
		}
		campusUpdates := map[string]any{}
		if len(campus.Aliases) > 0 {
			aliasesJSON, marshalErr := json.Marshal(campus.Aliases)
			if marshalErr != nil {
				return fmt.Errorf("encode pending campus aliases %q/%q: %w", schoolName, name, marshalErr)
			}
			campusUpdates["aliases"] = gorm.Expr("?::jsonb", string(aliasesJSON))
		}
		if value := strings.TrimSpace(campus.Address); value != "" {
			campusUpdates["address"] = value
		}
		if value := strings.TrimSpace(campus.SourceURL); value != "" {
			campusUpdates["source_url"] = value
		}
		if len(campusUpdates) > 0 {
			campusUpdates["updated_at"] = gorm.Expr("now()")
			if err := db.WithContext(ctx).Table("school_campuses").Where("id = ? AND status = ?", saved.ID, "pending_review").Updates(campusUpdates).Error; err != nil {
				return fmt.Errorf("update pending campus metadata %q/%q: %w", schoolName, name, err)
			}
		}
		campusIDs[name] = saved.ID
		for _, alias := range campus.Aliases {
			alias = strings.TrimSpace(alias)
			if alias != "" {
				campusIDs[alias] = saved.ID
			}
		}
	}
	for i, canteen := range seed.Canteens {
		name := strings.TrimSpace(canteen.Name)
		if name == "" {
			continue
		}
		var campusID *string
		if id := campusIDs[strings.TrimSpace(canteen.Campus)]; id != "" {
			campusID = &id
		}
		confidence := normalizeCampusEvidenceLevel(canteen.EvidenceLevel)
		row := migrationdo.SchoolCanteenDO{
			SchoolID:        school.ID,
			CampusID:        campusID,
			Name:            name,
			Aliases:         canteen.Aliases,
			LocationText:    stringPtr(strings.TrimSpace(canteen.LocationText)),
			BuildingOrFloor: stringPtr(strings.TrimSpace(canteen.BuildingOrFloor)),
			ServiceType:     stringPtr(strings.TrimSpace(canteen.ServiceType)),
			Audience:        stringPtr(strings.TrimSpace(canteen.Audience)),
			MealPeriods:     []string{},
			OpeningHoursRaw: stringPtr(strings.TrimSpace(canteen.OpeningHoursRaw)),
			PaymentMethods:  []string{},
			SourceURL:       stringPtr(strings.TrimSpace(canteen.SourceURL)),
			SourceOrg:       stringPtr(strings.TrimSpace(canteen.SourceOrg)),
			SourceType:      stringPtr(strings.TrimSpace(canteen.SourceType)),
			ConfidenceLevel: &confidence,
			Status:          normalizePendingReviewStatus(canteen.ReviewStatus),
			ReviewNote:      stringPtr("公开资料采集待后台审核"),
			SortOrder:       i + 1,
		}
		if row.Status == "" {
			row.Status = "pending_review"
		}
		if err := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return fmt.Errorf("insert pending canteen %q/%q: %w", schoolName, name, err)
		}
		canteenID, err := findCampusDirectoryCanteenID(ctx, db, school.ID, campusID, name)
		if err != nil {
			return fmt.Errorf("find pending canteen %q/%q: %w", schoolName, name, err)
		}
		canteenUpdates := map[string]any{}
		if len(canteen.Aliases) > 0 {
			aliasesJSON, marshalErr := json.Marshal(canteen.Aliases)
			if marshalErr != nil {
				return fmt.Errorf("encode pending canteen aliases %q/%q: %w", schoolName, name, marshalErr)
			}
			canteenUpdates["aliases"] = gorm.Expr("?::jsonb", string(aliasesJSON))
		}
		for column, value := range map[string]string{
			"location_text":     canteen.LocationText,
			"building_or_floor": canteen.BuildingOrFloor,
			"service_type":      canteen.ServiceType,
			"audience":          canteen.Audience,
			"opening_hours_raw": canteen.OpeningHoursRaw,
			"source_url":        canteen.SourceURL,
			"source_org":        canteen.SourceOrg,
			"source_type":       canteen.SourceType,
			"confidence_level":  confidence,
		} {
			if value = strings.TrimSpace(value); value != "" {
				canteenUpdates[column] = value
			}
		}
		if len(canteenUpdates) > 0 {
			canteenUpdates["updated_at"] = gorm.Expr("now()")
			if err := db.WithContext(ctx).Table("school_canteens").
				Where("id = ? AND status = ?", *canteenID, "pending_review").
				Where(`CASE COALESCE(confidence_level, 'D')
					WHEN 'A' THEN 1
					WHEN 'B' THEN 2
					WHEN 'C' THEN 3
					ELSE 4
				END >= ?`, campusEvidenceRank(confidence)).
				Updates(canteenUpdates).Error; err != nil {
				return fmt.Errorf("update pending canteen metadata %q/%q: %w", schoolName, name, err)
			}
		}
		if err := restoreCanteenConfidenceFromApprovedSource(ctx, db, *canteenID); err != nil {
			return fmt.Errorf("restore approved canteen confidence %q/%q: %w", schoolName, name, err)
		}
		if err := ensureCampusDirectoryPendingSource(ctx, db, batchID, school.ID, campusID, canteenID, canteen); err != nil {
			return err
		}
		for _, source := range canteen.AdditionalSources {
			additional := campusDirectoryResearchCanteen{
				SourceURL:       source.SourceURL,
				SourceTitle:     source.SourceTitle,
				SourceOrg:       source.SourceOrg,
				SourceType:      source.SourceType,
				EvidenceLevel:   source.EvidenceLevel,
				EvidenceExcerpt: source.EvidenceExcerpt,
			}
			if err := ensureCampusDirectoryPendingSource(ctx, db, batchID, school.ID, campusID, canteenID, additional); err != nil {
				return err
			}
		}
		canteenIDs[campusCanteenKey(strings.TrimSpace(canteen.Campus), name)] = *canteenID
	}
	for i, window := range seed.Windows {
		name := strings.TrimSpace(window.Name)
		canteenName := strings.TrimSpace(window.Canteen)
		campusName := strings.TrimSpace(window.Campus)
		if name == "" || canteenName == "" {
			continue
		}
		canteenID := canteenIDs[campusCanteenKey(campusName, canteenName)]
		if canteenID == "" {
			var campusID *string
			if id := campusIDs[campusName]; id != "" {
				campusID = &id
			}
			found, findErr := findCampusDirectoryCanteenID(ctx, db, school.ID, campusID, canteenName)
			if findErr != nil {
				return fmt.Errorf("find pending window parent %q/%q/%q: %w", schoolName, canteenName, name, findErr)
			}
			canteenID = *found
		}
		var campusID *string
		if id := campusIDs[campusName]; id != "" {
			campusID = &id
		}
		row := migrationdo.CanteenWindowDO{
			SchoolID:  school.ID,
			CampusID:  campusID,
			CanteenID: canteenID,
			Name:      name,
			Aliases:   window.Aliases,
			Floor:     stringPtr(strings.TrimSpace(window.Floor)),
			SourceURL: stringPtr(strings.TrimSpace(window.SourceURL)),
			Status:    normalizePendingReviewStatus(window.ReviewStatus),
			SortOrder: i + 1,
		}
		if err := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return fmt.Errorf("insert pending window %q/%q/%q: %w", schoolName, canteenName, name, err)
		}
		evidence := campusDirectoryResearchCanteen{
			SourceURL:       window.SourceURL,
			SourceTitle:     window.SourceTitle,
			SourceOrg:       window.SourceOrg,
			SourceType:      window.SourceType,
			EvidenceLevel:   window.EvidenceLevel,
			EvidenceExcerpt: window.EvidenceExcerpt,
		}
		if err := ensureCampusDirectoryPendingSource(ctx, db, batchID, school.ID, campusID, &canteenID, evidence); err != nil {
			return err
		}
	}
	return nil
}

func restoreCanteenConfidenceFromApprovedSource(ctx context.Context, db *gorm.DB, canteenID string) error {
	return db.WithContext(ctx).Exec(`
		WITH approved AS (
			SELECT s.evidence_level
			FROM campus_directory_sources AS s
			WHERE s.canteen_id = ?
				AND s.review_status = 'approved'
				AND s.evidence_level IN ('A', 'B', 'C', 'D')
			ORDER BY CASE s.evidence_level
				WHEN 'A' THEN 1
				WHEN 'B' THEN 2
				WHEN 'C' THEN 3
				ELSE 4
			END
			LIMIT 1
		)
		UPDATE school_canteens AS c
		SET confidence_level = approved.evidence_level,
			updated_at = now()
		FROM approved
		WHERE c.id = ?
			AND CASE COALESCE(c.confidence_level, 'D')
				WHEN 'A' THEN 1
				WHEN 'B' THEN 2
				WHEN 'C' THEN 3
				ELSE 4
			END > CASE approved.evidence_level
				WHEN 'A' THEN 1
				WHEN 'B' THEN 2
				WHEN 'C' THEN 3
				ELSE 4
			END
	`, canteenID, canteenID).Error
}

func campusCanteenKey(campus, canteen string) string {
	return strings.ToLower(strings.TrimSpace(campus)) + "\x00" + strings.ToLower(strings.TrimSpace(canteen))
}

func findCampusDirectoryCanteenID(ctx context.Context, db *gorm.DB, schoolID string, campusID *string, name string) (*string, error) {
	query := db.WithContext(ctx).Table("school_canteens").Select("id").Where("school_id = ? AND lower(name) = lower(?) AND status NOT IN ?", schoolID, name, []string{"deleted", "rejected"})
	if campusID == nil {
		query = query.Where("campus_id IS NULL")
	} else {
		query = query.Where("campus_id = ?", *campusID)
	}
	var saved struct {
		ID string
	}
	if err := query.Take(&saved).Error; err != nil {
		return nil, err
	}
	return &saved.ID, nil
}

func ensureCampusDirectoryPendingSource(ctx context.Context, db *gorm.DB, batchID string, schoolID string, campusID *string, canteenID *string, seed campusDirectoryResearchCanteen) error {
	sourceURL := strings.TrimSpace(seed.SourceURL)
	if sourceURL == "" {
		return nil
	}
	var count int64
	query := db.WithContext(ctx).Table("campus_directory_sources").Where("school_id = ? AND source_url = ?", schoolID, sourceURL)
	if canteenID == nil {
		query = query.Where("canteen_id IS NULL")
	} else {
		query = query.Where("canteen_id = ?", *canteenID)
	}
	if err := query.Count(&count).Error; err != nil {
		return fmt.Errorf("count campus directory source %q: %w", sourceURL, err)
	}
	evidenceLevel := normalizeCampusEvidenceLevel(seed.EvidenceLevel)
	batchIDPtr := batchID
	row := migrationdo.CampusDirectorySourceDO{
		BatchID:         &batchIDPtr,
		SchoolID:        schoolID,
		CampusID:        campusID,
		CanteenID:       canteenID,
		SourceURL:       sourceURL,
		SourceTitle:     stringPtr(strings.TrimSpace(seed.SourceTitle)),
		SourceOrg:       stringPtr(strings.TrimSpace(seed.SourceOrg)),
		SourceType:      stringPtr(strings.TrimSpace(seed.SourceType)),
		EvidenceLevel:   &evidenceLevel,
		EvidenceExcerpt: stringPtr(strings.TrimSpace(seed.EvidenceExcerpt)),
		ReviewStatus:    "pending_review",
	}
	if count > 0 {
		updates := map[string]any{
			"batch_id":         row.BatchID,
			"source_title":     row.SourceTitle,
			"source_org":       row.SourceOrg,
			"source_type":      row.SourceType,
			"evidence_level":   row.EvidenceLevel,
			"evidence_excerpt": row.EvidenceExcerpt,
			"review_status":    row.ReviewStatus,
			"updated_at":       gorm.Expr("now()"),
		}
		updateQuery := db.WithContext(ctx).Table("campus_directory_sources").Where("school_id = ? AND source_url = ?", schoolID, sourceURL)
		if canteenID == nil {
			updateQuery = updateQuery.Where("canteen_id IS NULL")
		} else {
			updateQuery = updateQuery.Where("canteen_id = ?", *canteenID)
		}
		updateQuery = updateQuery.Where("review_status = ?", "pending_review")
		return updateQuery.Updates(updates).Error
	}
	if err := db.WithContext(ctx).Create(&row).Error; err != nil {
		return fmt.Errorf("insert campus directory source %q: %w", sourceURL, err)
	}
	return nil
}

func normalizePendingReviewStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "active", "inactive", "rejected", "deleted":
		return strings.TrimSpace(status)
	default:
		return "pending_review"
	}
}

func normalizeCampusEvidenceLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "a", "high", "official", "official_high", "official_direct", "official_dining_page", "official_logistics", "official_logistics_page", "official_campus_dining_page", "official_named_with_hours", "official_named_status", "official_named_location", "official_procurement_named", "official_freshman_guide", "official_welcome_guide", "official_service_guide", "official_logistics_service_guide":
		return "A"
	case "b", "medium", "official_medium", "official_news", "official_procurement", "official_procurement_notice", "official_logistics_procurement", "official_logistics_notice", "official_logistics_news", "official_logistics_homepage", "official_campus_notice", "official_notice", "official_exam_notice", "official_phone_directory", "official_account_named_list", "official_facility_location", "official_index", "official_planned", "official_campus_status_only", "official_campus_construction_procurement", "official_logistics_notice_index", "official_service_portal":
		return "B"
	case "c", "low", "secondary", "secondary_procurement_direct", "procurement_proxy_pdf", "official_department_news", "official_college_news", "official_career_notice", "official_indirect":
		return "C"
	default:
		return "D"
	}
}

func campusEvidenceRank(level string) int {
	switch normalizeCampusEvidenceLevel(level) {
	case "A":
		return 1
	case "B":
		return 2
	case "C":
		return 3
	default:
		return 4
	}
}

func ensureCampusDirectorySeed(ctx context.Context, db *gorm.DB) error {
	data, err := os.ReadFile("data/campus_directory_seed.json")
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read campus directory seed file: %w", err)
	}
	var seeds []campusDirectorySeed
	if err := json.Unmarshal(data, &seeds); err != nil {
		return fmt.Errorf("parse campus directory seed file: %w", err)
	}
	for _, schoolSeed := range seeds {
		schoolName := strings.TrimSpace(schoolSeed.School)
		if schoolName == "" {
			continue
		}
		var school struct {
			ID string
		}
		if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", schoolName, "active").Take(&school).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return fmt.Errorf("find school %q: %w", schoolName, err)
		}
		campusIDs := map[string]string{}
		for i, campus := range schoolSeed.Campuses {
			name := strings.TrimSpace(campus.Name)
			if name == "" {
				continue
			}
			sourceURL := strings.TrimSpace(campus.SourceURL)
			row := migrationdo.SchoolCampusDO{
				SchoolID:  school.ID,
				Name:      name,
				Aliases:   []string{},
				Status:    "active",
				SortOrder: i + 1,
			}
			if sourceURL != "" {
				row.SourceURL = &sourceURL
			}
			if err := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
				return fmt.Errorf("insert campus %q/%q: %w", schoolName, name, err)
			}
			var saved struct {
				ID string
			}
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, name, "deleted").Take(&saved).Error; err != nil {
				return fmt.Errorf("find campus %q/%q: %w", schoolName, name, err)
			}
			campusIDs[name] = saved.ID
		}
		for i, canteen := range schoolSeed.Canteens {
			name := strings.TrimSpace(canteen.Name)
			if name == "" {
				continue
			}
			var campusID *string
			if id := campusIDs[strings.TrimSpace(canteen.Campus)]; id != "" {
				campusID = &id
			}
			sourceURL := strings.TrimSpace(schoolSeed.SourceURL)
			sourceOrg := schoolName
			confidence := "B"
			row := migrationdo.SchoolCanteenDO{
				SchoolID:        school.ID,
				CampusID:        campusID,
				Name:            name,
				Aliases:         []string{},
				MealPeriods:     []string{},
				PaymentMethods:  []string{},
				Status:          "active",
				SortOrder:       i + 1,
				SourceOrg:       &sourceOrg,
				SourceType:      stringPtr("official"),
				ConfidenceLevel: &confidence,
			}
			if sourceURL != "" {
				row.SourceURL = &sourceURL
			}
			if err := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
				return fmt.Errorf("insert canteen %q/%q: %w", schoolName, name, err)
			}
		}
	}
	return nil
}

func ensurePublicFoodCampusDirectoryBackfill(ctx context.Context, db *gorm.DB) error {
	statements := []string{
		`
		UPDATE public_food_library p
		SET school_id = s.id
		FROM schools s
		WHERE p.school_id IS NULL
		  AND NULLIF(trim(p.school_name), '') IS NOT NULL
		  AND s.status = 'active'
		  AND lower(trim(p.school_name)) = lower(s.name)
		`,
		`
		UPDATE public_food_library p
		SET campus_id = sc.id
		FROM school_campuses sc
		WHERE p.campus_id IS NULL
		  AND p.school_id IS NOT NULL
		  AND NULLIF(trim(p.campus_name), '') IS NOT NULL
		  AND sc.school_id = p.school_id
		  AND sc.status = 'active'
		  AND lower(trim(p.campus_name)) = lower(sc.name)
		`,
		`
		UPDATE public_food_library p
		SET canteen_id = (
			SELECT c.id
			FROM school_canteens c
			WHERE c.school_id = p.school_id
			  AND c.status = 'active'
			  AND lower(trim(p.canteen_name)) = lower(c.name)
			  AND (p.campus_id IS NULL OR c.campus_id = p.campus_id OR c.campus_id IS NULL)
			ORDER BY CASE WHEN c.campus_id = p.campus_id THEN 0 ELSE 1 END, c.sort_order ASC, c.name ASC
			LIMIT 1
		)
		WHERE p.canteen_id IS NULL
		  AND p.school_id IS NOT NULL
		  AND NULLIF(trim(p.canteen_name), '') IS NOT NULL
		  AND EXISTS (
			SELECT 1
			FROM school_canteens c
			WHERE c.school_id = p.school_id
			  AND c.status = 'active'
			  AND lower(trim(p.canteen_name)) = lower(c.name)
			  AND (p.campus_id IS NULL OR c.campus_id = p.campus_id OR c.campus_id IS NULL)
		  )
		`,
		`
		UPDATE public_food_library p
		SET window_id = (
			SELECT w.id
			FROM canteen_windows w
			WHERE w.canteen_id = p.canteen_id
			  AND w.status = 'active'
			  AND lower(trim(p.window_name)) = lower(w.name)
			  AND (NULLIF(trim(p.floor), '') IS NULL OR NULLIF(trim(w.floor), '') IS NULL OR lower(trim(p.floor)) = lower(trim(w.floor)))
			ORDER BY CASE WHEN lower(trim(p.floor)) = lower(trim(w.floor)) THEN 0 ELSE 1 END, w.sort_order ASC, w.name ASC
			LIMIT 1
		)
		WHERE p.window_id IS NULL
		  AND p.canteen_id IS NOT NULL
		  AND NULLIF(trim(p.window_name), '') IS NOT NULL
		  AND EXISTS (
			SELECT 1
			FROM canteen_windows w
			WHERE w.canteen_id = p.canteen_id
			  AND w.status = 'active'
			  AND lower(trim(p.window_name)) = lower(w.name)
			  AND (NULLIF(trim(p.floor), '') IS NULL OR NULLIF(trim(w.floor), '') IS NULL OR lower(trim(p.floor)) = lower(trim(w.floor)))
		  )
		`,
	}
	for _, sql := range statements {
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("backfill public food campus directory ids: %w", err)
		}
	}
	return nil
}

func stringPtr(value string) *string {
	return &value
}

type exerciseEnergySeed struct {
	Name      string
	Norm      string
	Category  string
	Intensity string
	MET       float64
	Aliases   []string
	Evidence  string
}

func ensureExerciseEnergySeed(ctx context.Context, db *gorm.DB) error {
	seeds := []exerciseEnergySeed{
		{Name: "深蹲", Norm: "深蹲", Category: "strength", Intensity: "high", MET: 5.0, Aliases: []string{"杠铃深蹲", "深蹲训练"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "杠铃深蹲", Norm: "杠铃深蹲", Category: "strength", Intensity: "high", MET: 5.0, Aliases: []string{"40kg杠铃深蹲", "负重深蹲"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "卧推", Norm: "卧推", Category: "strength", Intensity: "high", MET: 4.5, Aliases: []string{"杠铃卧推", "卧推训练"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "高位下拉", Norm: "高位下拉", Category: "strength", Intensity: "moderate", MET: 4.0, Aliases: []string{"龙门架高位下拉", "下拉"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "龙门架高位下拉", Norm: "龙门架高位下拉", Category: "strength", Intensity: "moderate", MET: 4.0, Aliases: []string{"宽握高位下拉"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "坐姿划船", Norm: "坐姿划船", Category: "strength", Intensity: "moderate", MET: 4.0, Aliases: []string{"器械划船", "划船训练"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "哑铃推举", Norm: "哑铃推举", Category: "strength", Intensity: "high", MET: 4.5, Aliases: []string{"肩推", "哑铃肩推", "推举"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "弯举", Norm: "弯举", Category: "strength", Intensity: "moderate", MET: 3.5, Aliases: []string{"杠铃弯举", "哑铃弯举", "二头弯举"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "臂弯举", Norm: "臂弯举", Category: "strength", Intensity: "moderate", MET: 3.5, Aliases: []string{"手臂弯举", "二头肌弯举"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "绳索下压", Norm: "绳索下压", Category: "strength", Intensity: "moderate", MET: 3.5, Aliases: []string{"直杆下压", "三头下压"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "跑步机", Norm: "跑步机", Category: "cardio", Intensity: "high", MET: 8.3, Aliases: []string{"跑步机跑步", "坡度跑", "跑步"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "跑步机跑步", Norm: "跑步机跑步", Category: "cardio", Intensity: "high", MET: 8.3, Aliases: []string{"跑步机有氧"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "卷腹", Norm: "卷腹", Category: "strength", Intensity: "moderate", MET: 3.8, Aliases: []string{"仰卧卷腹", "腹部卷腹"}, Evidence: "基础核心训练 MET 种子"},
		{Name: "垫上卷腹", Norm: "垫上卷腹", Category: "strength", Intensity: "moderate", MET: 3.8, Aliases: []string{"垫上腹部卷腹"}, Evidence: "基础核心训练 MET 种子"},
		{Name: "平板支撑", Norm: "平板支撑", Category: "strength", Intensity: "moderate", MET: 3.0, Aliases: []string{"平板", "plank"}, Evidence: "基础核心训练 MET 种子"},
		{Name: "背部伸展", Norm: "背部伸展", Category: "strength", Intensity: "moderate", MET: 3.5, Aliases: []string{"背伸", "罗马椅背伸"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "拉伸", Norm: "拉伸", Category: "flexibility", Intensity: "low", MET: 2.3, Aliases: []string{"静态拉伸", "放松拉伸"}, Evidence: "基础拉伸训练 MET 种子"},
		{Name: "全身肌群拉伸", Norm: "全身肌群拉伸", Category: "flexibility", Intensity: "low", MET: 2.3, Aliases: []string{"全身拉伸", "多肌群拉伸"}, Evidence: "基础拉伸训练 MET 种子"},
		{Name: "慢跑", Norm: "慢跑", Category: "cardio", Intensity: "moderate", MET: 7.0, Aliases: []string{"跑步30分钟", "轻松跑"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "跳绳", Norm: "跳绳", Category: "cardio", Intensity: "high", MET: 10.0, Aliases: []string{"跳绳训练"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "壶铃训练", Norm: "壶铃训练", Category: "strength", Intensity: "high", MET: 8.0, Aliases: []string{"壶铃摆动", "壶铃"}, Evidence: "基础力量循环训练 MET 种子"},
		{Name: "骑行", Norm: "骑行", Category: "cardio", Intensity: "moderate", MET: 6.8, Aliases: []string{"绿道骑行", "户外骑行", "自行车骑行", "自行车", "单车"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "动感单车", Norm: "动感单车", Category: "cardio", Intensity: "high", MET: 8.5, Aliases: []string{"单车课", "室内单车"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "游泳", Norm: "游泳", Category: "cardio", Intensity: "high", MET: 6.0, Aliases: []string{"自由泳", "蛙泳", "泳池游泳", "游泳训练"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "瑜伽", Norm: "瑜伽", Category: "flexibility", Intensity: "low", MET: 3.0, Aliases: []string{"瑜伽练习", "流瑜伽", "哈他瑜伽"}, Evidence: "基础柔韧训练 MET 种子"},
		{Name: "普拉提", Norm: "普拉提", Category: "flexibility", Intensity: "moderate", MET: 3.0, Aliases: []string{"普拉提训练", "核心普拉提"}, Evidence: "基础核心训练 MET 种子"},
		{Name: "羽毛球", Norm: "羽毛球", Category: "cardio", Intensity: "moderate", MET: 5.5, Aliases: []string{"打羽毛球", "羽毛球训练"}, Evidence: "基础球类训练 MET 种子"},
		{Name: "篮球", Norm: "篮球", Category: "cardio", Intensity: "high", MET: 6.5, Aliases: []string{"打篮球", "篮球训练"}, Evidence: "基础球类训练 MET 种子"},
		{Name: "足球", Norm: "足球", Category: "cardio", Intensity: "high", MET: 7.0, Aliases: []string{"踢足球", "足球训练"}, Evidence: "基础球类训练 MET 种子"},
		{Name: "快走", Norm: "快走", Category: "cardio", Intensity: "moderate", MET: 4.3, Aliases: []string{"健走", "快速步行", "暴走"}, Evidence: "基础步行训练 MET 种子"},
		{Name: "散步", Norm: "散步", Category: "cardio", Intensity: "low", MET: 3.0, Aliases: []string{"走路", "步行", "遛弯"}, Evidence: "基础步行训练 MET 种子"},
		{Name: "爬楼梯", Norm: "爬楼梯", Category: "cardio", Intensity: "high", MET: 8.8, Aliases: []string{"上下楼梯", "楼梯训练", "爬楼"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "椭圆机", Norm: "椭圆机", Category: "cardio", Intensity: "moderate", MET: 5.0, Aliases: []string{"椭圆仪", "椭圆机训练"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "划船机", Norm: "划船机", Category: "cardio", Intensity: "high", MET: 7.0, Aliases: []string{"划船器", "划船机训练"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "徒步", Norm: "徒步", Category: "cardio", Intensity: "moderate", MET: 6.0, Aliases: []string{"登山徒步", "户外徒步", "爬山"}, Evidence: "基础户外运动 MET 种子"},
		{Name: "HIIT", Norm: "hiit", Category: "cardio", Intensity: "high", MET: 8.0, Aliases: []string{"高强度间歇训练", "间歇训练", "燃脂训练"}, Evidence: "基础间歇训练 MET 种子"},
	}
	for _, seed := range seeds {
		if err := db.WithContext(ctx).Exec(`
			INSERT INTO exercise_energy_library (
				canonical_name,
				normalized_name,
				category,
				intensity,
				met_value,
				source,
				evidence,
				review_status,
				is_active
			)
			VALUES (?, ?, ?, ?, ?, 'system_seed', ?, 'active', true)
			ON CONFLICT (normalized_name) DO UPDATE SET
				category = EXCLUDED.category,
				intensity = EXCLUDED.intensity,
				met_value = EXCLUDED.met_value,
				source = CASE
					WHEN exercise_energy_library.source = 'system_seed' THEN EXCLUDED.source
					ELSE exercise_energy_library.source
				END,
				evidence = CASE
					WHEN exercise_energy_library.source = 'system_seed' THEN EXCLUDED.evidence
					ELSE exercise_energy_library.evidence
				END,
				review_status = CASE
					WHEN exercise_energy_library.review_status = 'pending' THEN 'active'
					ELSE exercise_energy_library.review_status
				END,
				is_active = true,
				updated_at = now()
		`, seed.Name, seed.Norm, seed.Category, seed.Intensity, seed.MET, seed.Evidence).Error; err != nil {
			return fmt.Errorf("seed exercise energy activity %s: %w", seed.Name, err)
		}
		for _, alias := range append(seed.Aliases, seed.Name) {
			alias = strings.TrimSpace(alias)
			if alias == "" {
				continue
			}
			normalizedAlias := normalizeExerciseEnergySeedAlias(alias)
			if normalizedAlias == "" {
				continue
			}
			if err := db.WithContext(ctx).Exec(`
				INSERT INTO exercise_energy_aliases (activity_id, alias_name, normalized_alias)
				SELECT id, ?, ?
				FROM exercise_energy_library
				WHERE normalized_name = ?
				ON CONFLICT (normalized_alias) DO NOTHING
			`, alias, normalizedAlias, seed.Norm).Error; err != nil {
				return fmt.Errorf("seed exercise energy alias %s: %w", alias, err)
			}
		}
	}
	return nil
}

func normalizeExerciseEnergySeedAlias(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	replacer := strings.NewReplacer(" ", "", "\t", "", "\n", "", "\r", "", "-", "", "_", "", "，", "", "。", "", "、", "", "；", "", ":", "", "：", "", "(", "", ")", "", "（", "", "）", "")
	return replacer.Replace(value)
}

func ensureMottoColumn(ctx context.Context, db *gorm.DB) error {
	var exists int64
	if err := db.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_name = 'weapp_user' AND column_name = 'motto'
	`).Scan(&exists).Error; err != nil {
		return fmt.Errorf("check motto column exists: %w", err)
	}
	if exists > 0 {
		return nil
	}
	sql := `ALTER TABLE weapp_user ADD COLUMN motto TEXT`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("add motto column: %w", err)
	}
	return nil
}

func ensurePublicRecordsDefault(ctx context.Context, db *gorm.DB) error {
	result := db.WithContext(ctx).Exec(`
		UPDATE weapp_user
		SET public_records = TRUE
		WHERE public_records IS NULL
	`)
	if result.Error != nil {
		return fmt.Errorf("backfill public_records default: %w", result.Error)
	}
	return nil
}

func ensurePublicFavoriteRecipesDefault(ctx context.Context, db *gorm.DB) error {
	result := db.WithContext(ctx).Exec(`
		UPDATE weapp_user
		SET public_favorite_recipes = TRUE
		WHERE public_favorite_recipes IS NULL
	`)
	if result.Error != nil {
		return fmt.Errorf("backfill public_favorite_recipes default: %w", result.Error)
	}
	return nil
}

func ensureRecipeIDColumn(ctx context.Context, db *gorm.DB) error {
	var exists int64
	if err := db.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_name = 'user_food_records' AND column_name = 'recipe_id'
	`).Scan(&exists).Error; err != nil {
		return fmt.Errorf("check recipe_id column exists: %w", err)
	}
	if exists > 0 {
		return nil
	}
	sql := `ALTER TABLE user_food_records ADD COLUMN recipe_id uuid`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("add recipe_id column: %w", err)
	}
	return nil
}

func ensureAdminResolutionColumns(ctx context.Context, db *gorm.DB) error {
	columns := []string{
		`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS reward_credits integer NOT NULL DEFAULT 0`,
		`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS reward_ledger_id uuid`,
		`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS resolution_message text NOT NULL DEFAULT ''`,
		`ALTER TABLE feed_reports ADD COLUMN IF NOT EXISTS resolution_note text NOT NULL DEFAULT ''`,
		`ALTER TABLE feed_reports ADD COLUMN IF NOT EXISTS reward_credits integer NOT NULL DEFAULT 0`,
		`ALTER TABLE feed_reports ADD COLUMN IF NOT EXISTS reward_ledger_id uuid`,
		`ALTER TABLE feed_reports ADD COLUMN IF NOT EXISTS handled_by text`,
		`ALTER TABLE feed_reports ADD COLUMN IF NOT EXISTS handled_at timestamptz`,
	}
	for _, sql := range columns {
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("admin resolution column migration: %w", err)
		}
	}
	return nil
}

func ensureFoodWeightLabeledSamplesStructuredLabels(ctx context.Context, db *gorm.DB) error {
	sql := `
	ALTER TABLE food_weight_labeled_samples ALTER COLUMN items SET DEFAULT '{}'::jsonb;

	UPDATE food_weight_labeled_samples
	SET items = COALESCE((
		SELECT jsonb_object_agg(elem->>'name', (elem->>'weight_grams')::numeric)
		FROM jsonb_array_elements(items) AS elem
	), '{}'::jsonb)
	WHERE label_type = 'items'
	  AND jsonb_typeof(items) = 'array';

	UPDATE food_weight_labeled_samples
	SET items = CASE
		WHEN total_weight_grams IS NOT NULL THEN jsonb_build_object('__total__', total_weight_grams)
		ELSE '{}'::jsonb
	END
	WHERE label_type = 'total'
	  AND (jsonb_typeof(items) = 'array' OR items = '{}'::jsonb);

	UPDATE food_weight_labeled_samples
	SET items = '{}'::jsonb
	WHERE label_type = 'unlabeled'
	  AND jsonb_typeof(items) = 'array';
	`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("convert food_weight_labeled_samples items to structured labels: %w", err)
	}
	return nil
}

func ensurePaymentTestConfig(ctx context.Context, db *gorm.DB) error {
	sqls := []string{
		`INSERT INTO membership_payment_test_settings (id, enabled, created_at, updated_at)
VALUES ('default', false, now(), now())
ON CONFLICT (id) DO NOTHING`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_snapshot_taken_at timestamptz`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_cancelled_at timestamptz`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_cancelled_by text`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_restored_at timestamptz`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_restored_by text`,
		`INSERT INTO membership_plan_config (
  code,
  name,
  description,
  amount,
  duration_months,
  is_active,
  is_visible,
  is_test_plan,
  tier,
  period,
  daily_credits,
  original_amount,
  sort_order,
  created_at,
  updated_at
) VALUES (
  'test_one_cent_monthly',
  'Pay Test - 0.01 CNY',
  'Hidden one-cent payment test membership plan',
  0.01,
  1,
  true,
  false,
  true,
  'light',
  'monthly',
  8,
  NULL,
  9999,
  now(),
  now()
) ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  amount = EXCLUDED.amount,
  duration_months = EXCLUDED.duration_months,
  is_active = true,
  is_visible = false,
  is_test_plan = true,
  tier = EXCLUDED.tier,
  period = EXCLUDED.period,
  daily_credits = EXCLUDED.daily_credits,
  original_amount = EXCLUDED.original_amount,
  sort_order = EXCLUDED.sort_order,
  updated_at = now()`,
	}
	for _, sql := range sqls {
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("ensure payment test config: %w", err)
		}
	}
	return nil
}

func ensureMembershipGrantConfig(ctx context.Context, db *gorm.DB) error {
	sql := `INSERT INTO membership_plan_config (
  code,
  name,
  description,
  amount,
  duration_months,
  is_active,
  is_visible,
  is_test_plan,
  tier,
  period,
  daily_credits,
  original_amount,
  sort_order,
  created_at,
  updated_at
) VALUES (
  'light_monthly',
  '轻度版月卡',
  '邀请赠送会员兜底套餐：每日 8 积分',
  0,
  1,
  true,
  false,
  false,
  'light',
  'monthly',
  8,
  NULL,
  9000,
  now(),
  now()
) ON CONFLICT (code) DO NOTHING`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("ensure membership grant config: %w", err)
	}
	return nil
}

func ensureNutritionQualityBackfill(ctx context.Context, db *gorm.DB) error {
	statements := []string{
		`UPDATE food_nutrition_library
SET quality_tier = 'authoritative',
    quality_evidence = COALESCE(quality_evidence, '{}'::jsonb) || jsonb_build_object('backfill', 'source_authority_v1')
WHERE quality_tier = 'unreviewed'
  AND (
    source LIKE '美国农业部食物数据中心%'
    OR source LIKE '中国疾控营养成分平台%'
  )`,
		`UPDATE food_nutrition_library
SET quality_tier = 'plausible',
    quality_evidence = COALESCE(quality_evidence, '{}'::jsonb) || jsonb_build_object('backfill', 'legacy_ai_requires_consensus_v1')
WHERE quality_tier = 'unreviewed'
  AND (
    LOWER(TRIM(COALESCE(source, ''))) IN (
      'qwen_generated','gemini_generated','deepseek_generated',
      'deepseek_v4_pro_auto','deepseek_auto','llm_generated'
    )
    OR LOWER(TRIM(COALESCE(source, ''))) LIKE '%\_generated' ESCAPE '\'
    OR LOWER(TRIM(COALESCE(source, ''))) LIKE 'ai估算%'
  )`,
		`UPDATE food_nutrition_library
SET quality_tier = 'legacy_curated',
    quality_evidence = COALESCE(quality_evidence, '{}'::jsonb) || jsonb_build_object('backfill', 'pre_quality_tier_active_row_v1')
WHERE quality_tier = 'unreviewed'
  AND is_active = true
  AND created_at < TIMESTAMPTZ '2026-07-19 00:00:00+08:00'`,
	}
	for _, statement := range statements {
		if err := db.WithContext(ctx).Exec(statement).Error; err != nil {
			return fmt.Errorf("backfill nutrition quality tier: %w", err)
		}
	}
	return nil
}

func ensureUsdaNutrientMappingBackfill(ctx context.Context, db *gorm.DB) error {
	const mappingVersion = "v2_1114_1177"
	statement := `UPDATE food_nutrition_library
SET vitamin_d_mcg_per_100g = 0,
    folate_mcg_per_100g = 0,
    quality_evidence = COALESCE(quality_evidence, '{}'::jsonb) || jsonb_build_object(
      'usda_nutrient_mapping_quarantine', 'legacy_values_cleared',
      'required_usda_nutrient_mapping_version', CAST(? AS text)
    ),
    updated_at = now()
WHERE source LIKE '美国农业部食物数据中心%'
  AND COALESCE(quality_evidence->>'usda_nutrient_mapping_version', '') <> ?
  AND (vitamin_d_mcg_per_100g <> 0 OR folate_mcg_per_100g <> 0)`
	if err := db.WithContext(ctx).Exec(statement, mappingVersion, mappingVersion).Error; err != nil {
		return fmt.Errorf("quarantine legacy USDA vitamin D and folate values: %w", err)
	}
	return nil
}

func dropAndAddCheck(table, name, expression string) string {
	return fmt.Sprintf(`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = '%s'
      AND conrelid = '%s'::regclass
  ) THEN
    ALTER TABLE %s DROP CONSTRAINT %s;
  END IF;
  ALTER TABLE %s ADD CONSTRAINT %s CHECK (%s);
END $$`, name, table, table, name, table, name, expression)
}

func addFK(name, table, column, refTable, refColumn, onDelete string) string {
	return fmt.Sprintf(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = '%s'
      AND conrelid = '%s'::regclass
  ) THEN
    ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s) ON DELETE %s;
  END IF;
END $$`, name, table, table, name, column, refTable, refColumn, onDelete)
}
