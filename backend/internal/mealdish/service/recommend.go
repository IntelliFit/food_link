package service

import (
	"context"
	"log/slog"
	"strings"

	"food_link/backend/internal/mealdish/domain"
	"food_link/backend/internal/mealdish/repo"
	"food_link/backend/pkg/logger"
)

var recommendedReasonText = map[string]string{
	domain.RecommendedNavigated: "首页推荐 · 你导航过",
	domain.RecommendedChatted:   "首页推荐 · 你问过",
	domain.RecommendedShown:     "首页推荐",
}

func normalizeRecommendedKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case domain.RecommendedNavigated, domain.RecommendedChatted:
		return strings.TrimSpace(kind)
	default:
		return domain.RecommendedShown
	}
}

// recommendedSuggestion turns the canteen dish the home card recommended
// shortly before the photo into the first canteen suggestion. The page sends
// it; the dish must still be published and belong to a canteen.
func (s *Service) recommendedSuggestion(ctx context.Context, input StartInput) (*domain.Canteen, *repo.DishRow) {
	itemID := strings.TrimSpace(input.RecommendedItemID)
	if itemID == "" {
		return nil, nil
	}
	dish, err := s.repo.DishByID(ctx, itemID)
	if err != nil {
		logger.Warn(ctx, "读取首页推荐菜品失败", slog.String("item_id", itemID), logger.Err(err))
		return nil, nil
	}
	if dish == nil || strings.TrimSpace(dish.CanteenID) == "" {
		return nil, nil
	}
	canteen, err := s.repo.CanteenByID(ctx, dish.CanteenID)
	if err != nil || canteen == nil {
		return nil, nil
	}
	canteen.Reason = domain.ReasonRecommended
	canteen.ReasonText = recommendedReasonText[normalizeRecommendedKind(input.RecommendedKind)]
	return canteen, dish
}

func (s *Service) dishView(ctx context.Context, row repo.DishRow) *DishView {
	dish := s.dishFromRow(row)
	view := &DishView{ID: dish.ID, Name: dish.Name, WindowName: dish.WindowName, PriceText: dish.PriceText,
		ImageURL: dish.ImageURL, HasRealPhoto: dish.HasRealPhoto, CanteenID: row.CanteenID}
	if canteen, err := s.repo.CanteenByID(ctx, row.CanteenID); err == nil && canteen != nil {
		view.CanteenName = canteen.Name
	}
	return view
}
