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
	created   *domain.FoodNutrition
}

func (s *foodNutritionRepoStub) List(_ context.Context, input repo.ListFoodNutritionInput) (*repo.ListFoodNutritionResult, error) {
	s.listInput = input
	return &repo.ListFoodNutritionResult{Items: s.items, Total: int64(len(s.items))}, nil
}

func (s *foodNutritionRepoStub) Get(context.Context, string) (*domain.FoodNutrition, error) {
	return nil, nil
}

func (s *foodNutritionRepoStub) Create(_ context.Context, item *domain.FoodNutrition) (*domain.FoodNutrition, error) {
	s.created = item
	return item, nil
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

func TestFoodNutritionServiceCreateInitializesStateTags(t *testing.T) {
	t.Parallel()

	repoStub := &foodNutritionRepoStub{}
	svc := NewFoodNutritionService(repoStub, nil)

	created, err := svc.Create(context.Background(), CreateFoodNutritionInput{
		CanonicalName: "粥里香 黑米粥",
		Source:        "mint_health_food_batch_003",
		IsActive:      true,
	})

	require.NoError(t, err)
	require.NotNil(t, created)
	require.NotNil(t, repoStub.created)
	assert.NotNil(t, repoStub.created.StateTags)
	assert.Empty(t, repoStub.created.StateTags)
}
