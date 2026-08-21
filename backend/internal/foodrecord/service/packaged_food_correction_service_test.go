package service

import (
	"context"
	"testing"

	"food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubmitPackagedFoodCorrectionOnlyProposesProvidedFields(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&domain.PackagedFood{}, &domain.PackagedFoodCorrectionSubmission{}))
	require.NoError(t, db.Exec(`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()`).Error)
	food := &domain.PackagedFood{
		ID:                uuid.NewString(),
		Brand:             "原品牌",
		ProductName:       "原食品",
		DisplayName:       "原食品",
		SourceImageURLs:   []string{"https://cdn.example.com/original.jpg"},
		KcalPer100g:       420,
		CalciumMgPer100g:  88,
		VitaminCMgPer100g: 9,
		IsActive:          true,
	}
	require.NoError(t, db.Create(food).Error)
	svc := NewFoodNutritionService(foodrecordrepo.NewFoodNutritionRepo(db))

	submission, err := svc.SubmitPackagedFoodCorrection(context.Background(), uuid.NewString(), SubmitPackagedFoodCorrectionInput{
		PackagedFoodID: food.ID,
		ReasonType:     "nutrition_wrong",
		Payload: PackagedFoodInput{
			KcalPer100g: 0,
		},
		ProvidedFields: map[string]bool{"kcal_per_100g": true},
	})

	require.NoError(t, err)
	assert.Equal(t, map[string]any{"kcal_per_100g": float64(0)}, submission.ProposedPatch)
	assert.NotContains(t, submission.ProposedPatch, "calcium_mg_per_100g")
	assert.NotContains(t, submission.ProposedPatch, "vitamin_c_mg_per_100g")
	assert.Equal(t, []string{"https://cdn.example.com/original.jpg"}, submission.EvidenceImageURLs)
}
