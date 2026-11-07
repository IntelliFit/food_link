package migration

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
)

func writeNutritionReviewArtifact(t *testing.T, artifact NutritionQualityReviewArtifact) string {
	t.Helper()
	body, err := json.Marshal(artifact)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "review.json")
	require.NoError(t, os.WriteFile(path, body, 0o600))
	return path
}

func TestApplyNutritionQualityReviewPromotesWithoutAliasRows(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.FoodNutritionDO{}, &migrationdo.FoodNutritionAliasDO{}))
	source := "qwen_generated"
	food := migrationdo.FoodNutritionDO{
		ID: "41000000-0000-4000-8000-000000000001", CanonicalName: "鸡胸肉", NormalizedName: "鸡胸肉",
		Source: &source, IsActive: false, QualityTier: "plausible",
		KcalPer100g: 156, ProteinPer100g: 30, CarbsPer100g: 0, FatPer100g: 4,
	}
	require.NoError(t, db.Create(&food).Error)
	reviewed := NutritionReviewValues{Kcal: 133, Protein: 26, Carbs: 0, Fat: 3.2222}
	reviewed.Kcal = reviewed.Protein*4 + reviewed.Carbs*4 + reviewed.Fat*9
	artifact := NutritionQualityReviewArtifact{
		BatchID: "temp-food-review-test", PolicyVersion: "demand-consensus-v1",
		Rows: []NutritionQualityReviewRow{{
			ID: food.ID, CanonicalName: food.CanonicalName, Source: source, Action: "promote_consensus_estimate",
			ExpectedNutrition: NutritionReviewValues{Kcal: 156, Protein: 30, Fat: 4},
			Nutrition:         reviewed,
			Evidence:          map[string]any{"reviewer": "test"},
		}},
	}
	path := writeNutritionReviewArtifact(t, artifact)
	ctx := context.Background()

	result, err := ApplyNutritionQualityReview(ctx, db, "", path, false)
	require.NoError(t, err)
	require.True(t, result.DryRun)
	require.Equal(t, 1, result.Actions["promote_consensus_estimate"])
	var current migrationdo.FoodNutritionDO
	require.NoError(t, db.First(&current, "id=?", food.ID).Error)
	require.False(t, current.IsActive)
	require.Equal(t, 156.0, current.KcalPer100g)

	_, err = ApplyNutritionQualityReview(ctx, db, "", path, true)
	require.NoError(t, err)
	require.NoError(t, db.First(&current, "id=?", food.ID).Error)
	require.True(t, current.IsActive)
	require.Equal(t, "reviewed_estimate", current.QualityTier)
	require.InDelta(t, reviewed.Kcal, current.KcalPer100g, 0.0001)
	require.Equal(t, "temp-food-review-test", current.QualityEvidence["batch_id"])

	// Re-running the same batch is a no-op that only checks the final state.
	_, err = ApplyNutritionQualityReview(ctx, db, "", path, true)
	require.NoError(t, err)
}

func TestApplyNutritionQualityReviewRejectsChangedSnapshot(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.FoodNutritionDO{}, &migrationdo.FoodNutritionAliasDO{}))
	source := "qwen_generated"
	food := migrationdo.FoodNutritionDO{
		ID: "41000000-0000-4000-8000-000000000002", CanonicalName: "豆浆", NormalizedName: "豆浆",
		Source: &source, IsActive: false, QualityTier: "plausible",
		KcalPer100g: 32, ProteinPer100g: 3, CarbsPer100g: 1.2, FatPer100g: 1.6,
	}
	require.NoError(t, db.Create(&food).Error)
	path := writeNutritionReviewArtifact(t, NutritionQualityReviewArtifact{
		BatchID: "temp-food-review-test-2", PolicyVersion: "demand-consensus-v1",
		Rows: []NutritionQualityReviewRow{{
			ID: food.ID, CanonicalName: food.CanonicalName, Source: source, Action: "promote_consensus_estimate",
			ExpectedNutrition: NutritionReviewValues{Kcal: 40, Protein: 3, Carbs: 1.2, Fat: 1.6},
			Nutrition:         NutritionReviewValues{Kcal: 30.4, Protein: 3, Carbs: 1.2, Fat: 1.6},
		}},
	})

	_, err := ApplyNutritionQualityReview(context.Background(), db, "", path, true)
	require.ErrorContains(t, err, "营养值在审核后发生变化")
	var current migrationdo.FoodNutritionDO
	require.NoError(t, db.First(&current, "id=?", food.ID).Error)
	require.False(t, current.IsActive)
}
