package repo

import (
	"context"
	"sync"
	"testing"

	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupPackagedFoodCorrectionTest(t *testing.T) (*FoodNutritionRepo, *domain.PackagedFood, *domain.PackagedFoodCorrectionSubmission) {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(
		&domain.PackagedFood{},
		&domain.PackagedFoodCorrectionSubmission{},
		&domain.PackagedFoodChangeLog{},
	))
	require.NoError(t, db.Exec(`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()`).Error)

	food := &domain.PackagedFood{
		ID:                   uuid.NewString(),
		Brand:                "原品牌",
		ProductName:          "原食品",
		DisplayName:          "原食品",
		SourceImageURLs:      []string{"https://cdn.example.com/original.jpg"},
		KcalPer100g:          420,
		ProteinPer100g:       12,
		CalciumMgPer100g:     88,
		VitaminCMgPer100g:    9,
		CholesterolMgPer100g: 7,
		IsActive:             true,
	}
	require.NoError(t, db.Create(food).Error)
	before, err := packagedFoodSnapshot(*food)
	require.NoError(t, err)
	submission := &domain.PackagedFoodCorrectionSubmission{
		ID:             uuid.NewString(),
		UserID:         uuid.NewString(),
		PackagedFoodID: food.ID,
		Status:         "pending",
		ReasonType:     "nutrition_wrong",
		BeforeSnapshot: before,
		ProposedPatch:  map[string]any{"kcal_per_100g": 390.0},
	}
	require.NoError(t, db.Create(submission).Error)
	return NewFoodNutritionRepo(db), food, submission
}

func TestReviewPackagedFoodCorrectionAppliesOnlyProposedFields(t *testing.T) {
	repo, food, submission := setupPackagedFoodCorrectionTest(t)

	result, updated, err := repo.ReviewPackagedFoodCorrectionSubmission(context.Background(), submission.ID, true, "证据清晰", uuid.NewString())
	require.NoError(t, err)
	assert.Equal(t, "applied", result.Status)
	assert.Equal(t, 390.0, updated.KcalPer100g)
	assert.Equal(t, food.CalciumMgPer100g, updated.CalciumMgPer100g)
	assert.Equal(t, food.VitaminCMgPer100g, updated.VitaminCMgPer100g)
	assert.Equal(t, food.CholesterolMgPer100g, updated.CholesterolMgPer100g)
}

func TestReviewPackagedFoodCorrectionRejectsSecondReview(t *testing.T) {
	repo, _, submission := setupPackagedFoodCorrectionTest(t)
	ctx := context.Background()

	_, _, err := repo.ReviewPackagedFoodCorrectionSubmission(ctx, submission.ID, true, "首次审批", uuid.NewString())
	require.NoError(t, err)
	_, _, err = repo.ReviewPackagedFoodCorrectionSubmission(ctx, submission.ID, true, "重复审批", uuid.NewString())
	assert.ErrorIs(t, err, ErrPackagedFoodCorrectionAlreadyReviewed)
}

func TestReviewPackagedFoodCorrectionRejectsStaleProposal(t *testing.T) {
	repo, food, submission := setupPackagedFoodCorrectionTest(t)
	require.NoError(t, repo.db.Model(&domain.PackagedFood{}).Where("id = ?", food.ID).Update("kcal_per_100g", 405).Error)

	_, _, err := repo.ReviewPackagedFoodCorrectionSubmission(context.Background(), submission.ID, true, "审批旧提案", uuid.NewString())
	assert.ErrorIs(t, err, ErrPackagedFoodCorrectionStale)
	var current domain.PackagedFood
	require.NoError(t, repo.db.Where("id = ?", food.ID).First(&current).Error)
	assert.Equal(t, 405.0, current.KcalPer100g)
}

func TestReviewPackagedFoodCorrectionConcurrentReviewSucceedsOnce(t *testing.T) {
	repo, _, submission := setupPackagedFoodCorrectionTest(t)
	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, _, err := repo.ReviewPackagedFoodCorrectionSubmission(context.Background(), submission.ID, true, "并发审批", uuid.NewString())
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)

	successes := 0
	alreadyReviewed := 0
	for err := range errs {
		switch {
		case err == nil:
			successes++
		case assert.ErrorIs(t, err, ErrPackagedFoodCorrectionAlreadyReviewed):
			alreadyReviewed++
		}
	}
	assert.Equal(t, 1, successes)
	assert.Equal(t, 1, alreadyReviewed)
	var logCount int64
	require.NoError(t, repo.db.Model(&domain.PackagedFoodChangeLog{}).Where("submission_id = ?", submission.ID).Count(&logCount).Error)
	assert.Equal(t, int64(1), logCount)
}
