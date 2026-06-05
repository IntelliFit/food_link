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

func TestNormalizePublicFoodLocationInputHomemadeOnlyRequiresProvinceCity(t *testing.T) {
	province := "浙江省"
	city := "杭州市"
	district := "西湖区"
	merchantName := "不应该保存的商家"
	merchantAddress := "不应该保存的地址"
	detailAddress := "不应该保存的详细地址"
	latitude := 30.25
	longitude := 120.16
	priceType := "fixed"
	price := 12.0

	input := CreateInput{
		UserTags:        []string{"自制"},
		Province:        &province,
		City:            &city,
		District:        &district,
		MerchantName:    &merchantName,
		MerchantAddress: &merchantAddress,
		DetailAddress:   &detailAddress,
		Latitude:        &latitude,
		Longitude:       &longitude,
		Price:           &price,
		PriceType:       &priceType,
	}

	err := normalizePublicFoodLocationInput(&input)
	require.NoError(t, err)
	require.Nil(t, input.MerchantName)
	require.Nil(t, input.MerchantAddress)
	require.Nil(t, input.DetailAddress)
	require.Nil(t, input.District)
	require.Nil(t, input.Latitude)
	require.Nil(t, input.Longitude)
	require.Nil(t, input.Price)
	require.Nil(t, input.PriceType)
}

func TestNormalizePublicFoodLocationInputHomemadeLocationOptional(t *testing.T) {
	input := CreateInput{
		UserTags: []string{"自制"},
	}

	err := normalizePublicFoodLocationInput(&input)
	require.NoError(t, err)
}

func TestNormalizePublicFoodLocationInputNonHomemadeRequiresFullLocation(t *testing.T) {
	province := "浙江省"
	city := "杭州市"
	input := CreateInput{
		Province: &province,
		City:     &city,
	}

	err := normalizePublicFoodLocationInput(&input)
	require.Error(t, err)
}

func TestNormalizePublicFoodLocationInputNonCampusClearsPriceFields(t *testing.T) {
	province := "浙江省"
	city := "杭州市"
	district := "西湖区"
	latitude := 30.25
	longitude := 120.16
	priceType := "fixed"
	price := 12.0
	input := CreateInput{
		Province:  &province,
		City:      &city,
		District:  &district,
		Latitude:  &latitude,
		Longitude: &longitude,
		Price:     &price,
		PriceType: &priceType,
	}

	err := normalizePublicFoodLocationInput(&input)
	require.NoError(t, err)
	require.Nil(t, input.Price)
	require.Nil(t, input.PriceType)
}
