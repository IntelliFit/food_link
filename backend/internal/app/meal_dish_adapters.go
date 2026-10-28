package app

import (
	"context"
	"time"

	campuscatalogservice "food_link/backend/internal/campuscatalog/service"
	commonerrors "food_link/backend/internal/common/errors"
	publicfoodservice "food_link/backend/internal/publicfood/service"
)

// mealDishPhotoContributor lets the meal-dish prompt append a user's photo to
// a canteen dish through the public food library's existing contribution.
type mealDishPhotoContributor struct {
	publicFood *publicfoodservice.PublicFoodService
}

func (c mealDishPhotoContributor) ContributeDishPhoto(ctx context.Context, userID, itemID string, imagePaths []string) error {
	result, err := c.publicFood.ContributeCampusImages(ctx, userID, itemID, imagePaths)
	if err != nil {
		return err
	}
	if result == nil || !result.Accepted {
		return &commonerrors.AppError{Code: 10002, Message: "这道菜暂时不能补充照片", HTTPStatus: 400}
	}
	return nil
}

// mealDishPriceCorrector writes a price that two users agreed on back to the
// campus catalog as an ordinary versioned correction, credited to the user
// whose answer completed the agreement.
type mealDishPriceCorrector struct {
	catalog *campuscatalogservice.CatalogService
}

func (c mealDishPriceCorrector) ApplyAgreedPrice(ctx context.Context, userID, itemID string, price float64, collectedAt time.Time) error {
	patch := map[string]any{"price": price, "price_type": "fixed", "price_collected_at": collectedAt.Format(time.RFC3339)}
	_, err := c.catalog.ApplyLatestUserCorrection(ctx, userID, itemID, patch, "食堂菜品价格：两位用户确认一致")
	return err
}
