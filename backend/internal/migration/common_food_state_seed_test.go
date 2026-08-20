package migration

import (
	"context"
	"fmt"
	"testing"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCommonFoodStateSeedsHaveExplicitStateBasisAndOfficialIDs(t *testing.T) {
	seeds := commonFoodStateSeeds()
	require.GreaterOrEqual(t, len(seeds), 10)
	seen := map[string]bool{}
	statesByBase := map[string]map[string]bool{}
	for _, seed := range seeds {
		assert.NotEmpty(t, seed.ID)
		assert.NotEmpty(t, seed.CanonicalName)
		assert.NotEmpty(t, seed.NormalizedName)
		assert.NotEmpty(t, seed.BaseFoodKey)
		assert.NotEmpty(t, seed.FoodState)
		assert.NotEmpty(t, seed.WeightBasis)
		assert.NotZero(t, seed.FDCID)
		assert.False(t, seen[seed.NormalizedName], "duplicate normalized state seed: %s", seed.NormalizedName)
		seen[seed.NormalizedName] = true
		if statesByBase[seed.BaseFoodKey] == nil {
			statesByBase[seed.BaseFoodKey] = map[string]bool{}
		}
		statesByBase[seed.BaseFoodKey][seed.FoodState] = true
	}
	assert.True(t, statesByBase["potato"]["raw"])
	assert.True(t, statesByBase["potato"]["baked"])
	assert.True(t, statesByBase["potato"]["cooked"])
	assert.True(t, statesByBase["white_rice"]["raw"])
	assert.True(t, statesByBase["white_rice"]["cooked"])
}

func TestEnsureCommonFoodStateSeedIsIdempotentAndAliasesUsePersistedFoodID(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.FoodNutritionDO{}, &migrationdo.FoodNutritionAliasDO{}))
	existingID := "c1000000-0000-4000-8000-000000000001"
	wrongID := "c1000000-0000-4000-8000-000000000099"
	source := "existing"
	require.NoError(t, db.Create(&migrationdo.FoodNutritionDO{
		ID: existingID, CanonicalName: "已有生土豆", NormalizedName: "土豆生带皮可食部",
		KcalPer100g: 88, ProteinPer100g: 2.2, CarbsPer100g: 18, FatPer100g: 0.2,
		IsActive: true, Source: &source, QualityTier: "authoritative", ImagePaths: []string{}, StateTags: []string{},
	}).Error)
	require.NoError(t, db.Create(&migrationdo.FoodNutritionDO{
		ID: wrongID, CanonicalName: "错误旧食物", NormalizedName: "错误旧食物",
		IsActive: true, Source: &source, QualityTier: "legacy_curated", ImagePaths: []string{}, StateTags: []string{},
	}).Error)
	require.NoError(t, db.Create(&migrationdo.FoodNutritionAliasDO{
		ID: "c1000000-0000-4000-8000-000000000098", FoodID: wrongID,
		AliasName: "生土豆（带皮）", NormalizedAlias: "生土豆带皮", MatchStatus: "candidate_only",
	}).Error)

	require.NoError(t, ensureCommonFoodStateSeed(context.Background(), db))
	require.NoError(t, ensureCommonFoodStateSeed(context.Background(), db))

	var foodCount int64
	require.NoError(t, db.Model(&migrationdo.FoodNutritionDO{}).
		Where("normalized_name IN ?", func() []string {
			values := make([]string, 0, len(commonFoodStateSeeds()))
			for _, seed := range commonFoodStateSeeds() {
				values = append(values, seed.NormalizedName)
			}
			return values
		}()).Count(&foodCount).Error)
	assert.Equal(t, int64(len(commonFoodStateSeeds())), foodCount)

	var alias migrationdo.FoodNutritionAliasDO
	require.NoError(t, db.Where("normalized_alias = ?", "生土豆带皮").Take(&alias).Error)
	assert.Equal(t, existingID, alias.FoodID)

	var preserved migrationdo.FoodNutritionDO
	require.NoError(t, db.Where("id = ?", existingID).Take(&preserved).Error)
	assert.Equal(t, "已有生土豆", preserved.CanonicalName)
	assert.Equal(t, 88.0, preserved.KcalPer100g)
	assert.Equal(t, "existing", *preserved.Source)
	assert.Equal(t, "authoritative", preserved.QualityTier)
	assert.Equal(t, "raw", preserved.FoodState)
	assert.Equal(t, "raw_edible", preserved.WeightBasis)
}

func TestEnsureCommonFoodStateSeedUpgradesWeakConflictingRow(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.FoodNutritionDO{}, &migrationdo.FoodNutritionAliasDO{}))
	existingID := "c1000000-0000-4000-8000-000000000002"
	source := "legacy_ai"
	require.NoError(t, db.Create(&migrationdo.FoodNutritionDO{
		ID: existingID, CanonicalName: "旧意面干", NormalizedName: "意大利面干",
		KcalPer100g: 999, ProteinPer100g: 1, CarbsPer100g: 1, FatPer100g: 50,
		IsActive: false, Source: &source, QualityTier: "unreviewed", ImagePaths: []string{}, StateTags: []string{},
	}).Error)

	require.NoError(t, ensureCommonFoodStateSeed(context.Background(), db))

	var upgraded migrationdo.FoodNutritionDO
	require.NoError(t, db.Where("id = ?", existingID).Take(&upgraded).Error)
	assert.Equal(t, "意大利面（干）", upgraded.CanonicalName)
	assert.Equal(t, 371.0, upgraded.KcalPer100g)
	assert.Equal(t, 13.0, upgraded.ProteinPer100g)
	assert.Equal(t, 74.7, upgraded.CarbsPer100g)
	assert.Equal(t, 1.51, upgraded.FatPer100g)
	assert.True(t, upgraded.IsActive)
	assert.Equal(t, "authoritative", upgraded.QualityTier)
	require.NotNil(t, upgraded.Source)
	assert.Equal(t, "USDA FoodData Central SR Legacy", *upgraded.Source)
	assert.Equal(t, "pasta", upgraded.BaseFoodKey)
	assert.Equal(t, "dry", upgraded.FoodState)
	assert.Equal(t, "168927", fmt.Sprint(upgraded.QualityEvidence["fdc_id"]))

	var alias migrationdo.FoodNutritionAliasDO
	require.NoError(t, db.Where("normalized_alias = ?", "干意面").Take(&alias).Error)
	assert.Equal(t, existingID, alias.FoodID)
}

func TestVerifyNutritionStatesReportsCompleteSeedSet(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.FoodNutritionDO{}, &migrationdo.FoodNutritionAliasDO{}))

	before, err := VerifyNutritionStates(context.Background(), db)
	require.NoError(t, err)
	assert.False(t, before.Complete)
	assert.Equal(t, 0, before.FoundCount)

	require.NoError(t, ensureCommonFoodStateSeed(context.Background(), db))
	after, err := VerifyNutritionStates(context.Background(), db)
	require.NoError(t, err)
	assert.True(t, after.Complete)
	assert.Equal(t, after.ExpectedCount, after.FoundCount)
	assert.Equal(t, after.ExpectedCount, after.VisibleCount)
	assert.Equal(t, after.ExpectedCount, after.StateMetadataCount)
	assert.GreaterOrEqual(t, after.ApprovedAliasCount, int64(after.ExpectedAliasCount))
	assert.True(t, after.CompositeIndexPresent)
}
