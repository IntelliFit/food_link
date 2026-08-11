package service

import (
	"context"
	"testing"

	"food_link/backend/internal/admin/repo"
	"food_link/backend/internal/foodrecord/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type foodNutritionRepoStub struct {
	listInput repo.ListFoodNutritionInput
	items     []domain.FoodNutrition
}

func (s *foodNutritionRepoStub) List(_ context.Context, input repo.ListFoodNutritionInput) (*repo.ListFoodNutritionResult, error) {
	s.listInput = input
	return &repo.ListFoodNutritionResult{Items: s.items, Total: int64(len(s.items))}, nil
}

func (s *foodNutritionRepoStub) Get(context.Context, string) (*domain.FoodNutrition, error) {
	return nil, nil
}

func (s *foodNutritionRepoStub) Create(context.Context, *domain.FoodNutrition) (*domain.FoodNutrition, error) {
	return nil, nil
}

func (s *foodNutritionRepoStub) Update(context.Context, string, repo.FoodNutritionPatch) (*domain.FoodNutrition, error) {
	return nil, nil
}

func (s *foodNutritionRepoStub) Delete(context.Context, string) error { return nil }

func TestFoodNutritionServiceListUsesSharedCategory(t *testing.T) {
	t.Parallel()

	repoStub := &foodNutritionRepoStub{items: []domain.FoodNutrition{
		{ID: "tomato", CanonicalName: "番茄"},
		{ID: "egg", CanonicalName: "番茄炒鸡蛋"},
	}}
	svc := NewFoodNutritionService(repoStub, nil)

	result, err := svc.List(context.Background(), ListFoodNutritionInput{
		Category: "vegetable",
		Page:     2,
		Limit:    20,
	})

	require.NoError(t, err)
	assert.Equal(t, "vegetable", repoStub.listInput.Category)
	assert.Equal(t, 20, repoStub.listInput.Offset)
	require.Len(t, result.Items, 2)
	assert.Equal(t, "vegetable", result.Items[0].Category)
	assert.Equal(t, "protein", result.Items[1].Category)
}
