package migration

import (
	"testing"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
)

func TestEnsureUsdaNutrientMappingBackfillQuarantinesOnlyLegacyMappings(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.FoodNutritionDO{}))
	usdaSource := "美国农业部食物数据中心（Foundation）"
	rows := []migrationdo.FoodNutritionDO{
		{
			ID: "00000000-0000-0000-0000-000000000001", CanonicalName: "旧映射", NormalizedName: "旧映射",
			Source: &usdaSource, VitaminDMcgPer100g: 200, FolateMcgPer100g: 400,
		},
		{
			ID: "00000000-0000-0000-0000-000000000002", CanonicalName: "新映射", NormalizedName: "新映射",
			Source: &usdaSource, VitaminDMcgPer100g: 5, FolateMcgPer100g: 240,
			QualityEvidence: datatypes.JSONMap{"usda_nutrient_mapping_version": "v2_1114_1177"},
		},
	}
	require.NoError(t, db.Create(&rows).Error)

	require.NoError(t, ensureUsdaNutrientMappingBackfill(t.Context(), db))
	require.NoError(t, ensureUsdaNutrientMappingBackfill(t.Context(), db))

	var legacy, current migrationdo.FoodNutritionDO
	require.NoError(t, db.First(&legacy, "id = ?", rows[0].ID).Error)
	require.Zero(t, legacy.VitaminDMcgPer100g)
	require.Zero(t, legacy.FolateMcgPer100g)
	require.Equal(t, "legacy_values_cleared", legacy.QualityEvidence["usda_nutrient_mapping_quarantine"])
	require.NoError(t, db.First(&current, "id = ?", rows[1].ID).Error)
	require.Equal(t, 5.0, current.VitaminDMcgPer100g)
	require.Equal(t, 240.0, current.FolateMcgPer100g)
}
