package repo

import (
	"context"
	"testing"

	contributiondomain "food_link/backend/internal/foodcontribution/domain"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func setupContributionRepo(t *testing.T) *ContributionRepo {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.FoodNutritionDO{}, &migrationdo.UserCustomFoodDO{}, &contributiondomain.FoodNutritionContribution{}))
	return NewContributionRepo(db)
}

func pendingContribution() contributiondomain.FoodNutritionContribution {
	return contributiondomain.FoodNutritionContribution{
		ID: uuid.NewString(), UserID: uuid.NewString(), CanonicalName: "熟鸡蛋", NormalizedName: "熟鸡蛋",
		KcalPer100g: 144, ProteinPer100g: 13, CarbsPer100g: 1, FatPer100g: 10,
		SourceText: "食物成分表", EvidenceImagePaths: []string{"evidence.jpg"}, ExtraNutrients: map[string]any{}, Status: "pending",
	}
}

func TestCreateAssignsIDWhenCallerOmitsIt(t *testing.T) {
	repo := setupContributionRepo(t)
	item := pendingContribution()
	item.ID = ""
	require.NoError(t, repo.Create(context.Background(), &item))
	require.NotEmpty(t, item.ID)
	stored, err := repo.Get(context.Background(), item.ID)
	require.NoError(t, err)
	require.Equal(t, item.CanonicalName, stored.CanonicalName)
}

func TestReviewApproveNewPublishesNutrition(t *testing.T) {
	repo := setupContributionRepo(t)
	item := pendingContribution()
	require.NoError(t, repo.Create(context.Background(), &item))
	reviewed, err := repo.Review(context.Background(), item.ID, "approve_new", "", "可信来源", uuid.NewString())
	require.NoError(t, err)
	require.Equal(t, "approved", reviewed.Status)
	require.NotNil(t, reviewed.TargetFoodID)
	var food foodrecorddomain.FoodNutrition
	require.NoError(t, repo.db.Where("id = ?", *reviewed.TargetFoodID).First(&food).Error)
	require.Equal(t, 144.0, food.KcalPer100g)
	require.Equal(t, foodrecorddomain.NutritionQualityReviewedEstimate, food.QualityTier)
}

func TestReviewMergeUpdatesExplicitTarget(t *testing.T) {
	repo := setupContributionRepo(t)
	target := foodrecorddomain.FoodNutrition{
		ID: uuid.NewString(), CanonicalName: "鸡蛋", NormalizedName: "鸡蛋", KcalPer100g: 100,
		ImagePaths: []string{}, QualityTier: foodrecorddomain.NutritionQualityUnreviewed,
		QualityEvidence: map[string]any{}, IsActive: true,
	}
	require.NoError(t, repo.db.Create(&target).Error)
	item := pendingContribution()
	require.NoError(t, repo.Create(context.Background(), &item))
	reviewed, err := repo.Review(context.Background(), item.ID, "merge_existing", target.ID, "采用用户证据", uuid.NewString())
	require.NoError(t, err)
	require.Equal(t, target.ID, *reviewed.TargetFoodID)
	var updated foodrecorddomain.FoodNutrition
	require.NoError(t, repo.db.Where("id = ?", target.ID).First(&updated).Error)
	require.Equal(t, "鸡蛋", updated.CanonicalName)
	require.Equal(t, 144.0, updated.KcalPer100g)
}

func TestReviewMergeDoesNotDowngradeLegacyCuratedProvenance(t *testing.T) {
	repo := setupContributionRepo(t)
	target := foodrecorddomain.FoodNutrition{
		ID: uuid.NewString(), CanonicalName: "鸡蛋", NormalizedName: "鸡蛋", KcalPer100g: 100,
		Source: "legacy_editorial", QualityTier: foodrecorddomain.NutritionQualityLegacyCurated,
		QualityEvidence: map[string]any{"batch": "legacy"}, ImagePaths: []string{}, IsActive: true,
	}
	require.NoError(t, repo.db.Create(&target).Error)
	item := pendingContribution()
	item.ExtraNutrients = map[string]any{"calciumMg": 55.0}
	require.NoError(t, repo.Create(context.Background(), &item))
	_, err := repo.Review(context.Background(), item.ID, "merge_existing", target.ID, "采用用户证据", uuid.NewString())
	require.NoError(t, err)

	var updated foodrecorddomain.FoodNutrition
	require.NoError(t, repo.db.Where("id = ?", target.ID).First(&updated).Error)
	require.Equal(t, "legacy_editorial", updated.Source)
	require.Equal(t, foodrecorddomain.NutritionQualityLegacyCurated, updated.QualityTier)
	require.Equal(t, 55.0, updated.CalciumMgPer100g)
}

func TestReviewMergeRejectsAuthoritativeTarget(t *testing.T) {
	repo := setupContributionRepo(t)
	target := foodrecorddomain.FoodNutrition{
		ID: uuid.NewString(), CanonicalName: "鸡蛋", NormalizedName: "鸡蛋", KcalPer100g: 100,
		Source: "official", QualityTier: foodrecorddomain.NutritionQualityAuthoritative,
		QualityEvidence: map[string]any{}, ImagePaths: []string{}, IsActive: true,
	}
	require.NoError(t, repo.db.Create(&target).Error)
	item := pendingContribution()
	require.NoError(t, repo.Create(context.Background(), &item))
	_, err := repo.Review(context.Background(), item.ID, "merge_existing", target.ID, "", uuid.NewString())
	require.ErrorContains(t, err, "权威来源食物不能")
}

func TestReviewMirrorsLegacyCustomFoodLifecycle(t *testing.T) {
	repo := setupContributionRepo(t)
	legacy := migrationdo.UserCustomFoodDO{
		ID: uuid.NewString(), UserID: uuid.NewString(), Title: "熟鸡蛋", NormalizedTitle: "熟鸡蛋",
		NutrientsPer100g: map[string]any{}, ExtraNutrients: map[string]any{}, ImagePaths: []string{},
		PublicStatus: "pending", Status: "active",
	}
	require.NoError(t, repo.db.Create(&legacy).Error)
	item := pendingContribution()
	item.LegacyCustomFoodID = &legacy.ID
	require.NoError(t, repo.Create(context.Background(), &item))
	_, err := repo.Review(context.Background(), item.ID, "approve_new", "", "", uuid.NewString())
	require.NoError(t, err)

	var updated migrationdo.UserCustomFoodDO
	require.NoError(t, repo.db.Where("id = ?", legacy.ID).First(&updated).Error)
	require.Equal(t, "published", updated.PublicStatus)
}

func TestReviewRejectsInvalidLegacyNutrition(t *testing.T) {
	repo := setupContributionRepo(t)
	item := pendingContribution()
	item.KcalPer100g = 0
	require.NoError(t, repo.Create(context.Background(), &item))
	_, err := repo.Review(context.Background(), item.ID, "approve_new", "", "", uuid.NewString())
	require.ErrorContains(t, err, "营养数据无效")

	var foodCount int64
	require.NoError(t, repo.db.Model(&foodrecorddomain.FoodNutrition{}).Count(&foodCount).Error)
	require.Zero(t, foodCount)
}
