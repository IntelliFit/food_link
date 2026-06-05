package service

import (
	"testing"

	"food_link/backend/internal/publicfood/domain"

	"github.com/stretchr/testify/require"
)

func TestValidateCampusCreateInputRequiresCoreFields(t *testing.T) {
	foodName := "鸡胸肉套餐"
	school := "北京大学"
	canteen := "学一食堂"
	image := "https://example.com/food.jpg"

	tests := []struct {
		name  string
		input CreateInput
	}{
		{
			name: "missing school",
			input: CreateInput{
				IsCampusFood: true,
				FoodName:     &foodName,
				CanteenName:  &canteen,
				ImagePath:    &image,
			},
		},
		{
			name: "missing canteen",
			input: CreateInput{
				IsCampusFood: true,
				FoodName:     &foodName,
				SchoolName:   &school,
				ImagePath:    &image,
			},
		},
		{
			name: "missing image",
			input: CreateInput{
				IsCampusFood: true,
				FoodName:     &foodName,
				SchoolName:   &school,
				CanteenName:  &canteen,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			imagePaths := []string{}
			if tt.input.ImagePath != nil {
				imagePaths = append(imagePaths, *tt.input.ImagePath)
			}
			err := validateCampusCreateInput(tt.input, imagePaths)
			require.Error(t, err)
		})
	}

	err := validateCampusCreateInput(CreateInput{
		IsCampusFood: true,
		FoodName:     &foodName,
		SchoolName:   &school,
		CanteenName:  &canteen,
		ImagePath:    &image,
	}, []string{image})
	require.NoError(t, err)
}

func TestValidateCampusRangePrice(t *testing.T) {
	priceType := "range"
	foodName := "麻辣烫"
	school := "北京大学"
	canteen := "学一食堂"
	imagePaths := []string{"https://example.com/food.jpg"}
	minPrice := 8.0
	maxPrice := 15.0

	err := validateCampusCreateInput(CreateInput{
		IsCampusFood: true,
		FoodName:     &foodName,
		SchoolName:   &school,
		CanteenName:  &canteen,
		PriceType:    &priceType,
		PriceMin:     &minPrice,
		PriceMax:     &maxPrice,
	}, imagePaths)
	require.NoError(t, err)

	badMax := 6.0
	err = validateCampusCreateInput(CreateInput{
		IsCampusFood: true,
		FoodName:     &foodName,
		SchoolName:   &school,
		CanteenName:  &canteen,
		PriceType:    &priceType,
		PriceMin:     &minPrice,
		PriceMax:     &badMax,
	}, imagePaths)
	require.Error(t, err)
}

func TestHasCampusPrice(t *testing.T) {
	require.False(t, hasCampusPrice(nil))
	require.False(t, hasCampusPrice(&domain.PublicFoodItem{}))
	require.True(t, hasCampusPrice(&domain.PublicFoodItem{Price: 12}))
	require.True(t, hasCampusPrice(&domain.PublicFoodItem{PriceMin: 8, PriceMax: 15}))
}
