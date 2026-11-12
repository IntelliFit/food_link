package service

import (
	"context"
	"math"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodmeasure"
	"food_link/backend/internal/foodrecord/domain"
)

func (s *FoodRecordService) requireMeasuredLibraryItems(ctx context.Context, userID string, items []domain.FoodItem) error {
	for i := range items {
		restored, err := s.recordRepo.RestoreLegacyVolumeItem(ctx, userID, &items[i])
		if err != nil {
			return err
		}
		if restored {
			continue
		}
		item := items[i]
		required, err := s.recordRepo.SourceRequiresNativeMeasurement(ctx, userID, item)
		if err != nil {
			return err
		}
		if required {
			return &commonerrors.AppError{Code: 10002, Message: "该食物按毫升、个或份计量，请使用支持数量单位的新版页面录餐", HTTPStatus: 409}
		}
	}
	return nil
}

func hasMeasuredFoodItems(items []domain.FoodItem) bool {
	for _, item := range items {
		if item.Measurement != nil {
			return true
		}
	}
	return false
}

func measuredRecordTotals(items []domain.FoodItem) (calories, protein, carbs, fat float64, grams int) {
	mass := 0.0
	for _, item := range items {
		scale := math.Max(0, math.Min(100, item.Ratio)) / 100
		calories += item.Nutrients.Calories * scale
		protein += item.Nutrients.Protein * scale
		carbs += item.Nutrients.Carbs * scale
		fat += item.Nutrients.Fat * scale
		mass += item.Weight * scale
	}
	return roundOneDecimal(calories), roundOneDecimal(protein), roundOneDecimal(carbs), roundOneDecimal(fat), int(math.Round(mass))
}

// Old clients may omit the new snapshot, but cannot silently reinterpret a
// saved volume/count record as grams while editing the same food.
func validateMeasurementUpdateCompatibility(existing, incoming []domain.FoodItem) error {
	for _, previous := range existing {
		if previous.Measurement == nil || previous.Measurement.Unit == foodmeasure.Gram {
			continue
		}
		for _, next := range incoming {
			same := previous.Name == next.Name
			if previous.ManualSourceID != nil && next.ManualSourceID != nil {
				same = *previous.ManualSourceID == *next.ManualSourceID
			}
			if same && next.Measurement == nil {
				return &commonerrors.AppError{Code: 10002, Message: "此记录包含毫升、个或份，请使用支持数量单位的新版页面修改", HTTPStatus: 409}
			}
		}
	}
	return nil
}
