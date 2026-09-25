package service

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/marketingqr/catalog"
	"food_link/backend/internal/marketingqr/domain"
	"food_link/backend/internal/marketingqr/repo"
	publicfooddomain "food_link/backend/internal/publicfood/domain"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
)

type MarketingQRService struct {
	repo    *repo.MarketingQRRepo
	storage *storage.Client
}

func NewMarketingQRService(repo *repo.MarketingQRRepo, storageClient *storage.Client) *MarketingQRService {
	return &MarketingQRService{repo: repo, storage: storageClient}
}

func (s *MarketingQRService) Landing(ctx context.Context, rawCode string) (*domain.Landing, error) {
	code := catalog.NormalizeCode(rawCode)
	if code == catalog.TakeoutCode {
		return &domain.Landing{
			Code:         code,
			Kind:         "takeout",
			Title:        "这一餐，也值得被认真了解",
			Subtitle:     "拍照识别食物、记录营养摄入，并获得更适合自己的下一餐建议。",
			DataVersion:  "2026-09-26-v1",
			CallToAction: "开始使用食探",
		}, nil
	}

	product, ok := catalog.ProductByCode(code)
	if !ok {
		return nil, &commonerrors.AppError{Code: 10004, Message: "二维码对应的商品不存在", HTTPStatus: http.StatusNotFound}
	}
	dataset := catalog.DatasetSnapshot()
	lat, lng := dataset.Latitude, dataset.Longitude
	landing := &domain.Landing{
		Code:                product.Code,
		Kind:                "product",
		Title:               product.Name,
		Subtitle:            product.Category + " · " + product.PortionDescription,
		Category:            product.Category,
		MerchantName:        dataset.MerchantName,
		BranchName:          dataset.BranchName,
		Address:             dataset.Address,
		Latitude:            &lat,
		Longitude:           &lng,
		LocationIsEstimated: dataset.LocationIsEstimated,
		PriceMin:            product.PriceMin,
		PriceMax:            product.PriceMax,
		PortionDescription:  product.PortionDescription,
		Nutrition: &domain.Nutrition{
			CaloriesKcal: product.Nutrition.CaloriesKcal,
			ProteinG:     product.Nutrition.ProteinG,
			CarbsG:       product.Nutrition.CarbsG,
			FatG:         product.Nutrition.FatG,
		},
		NutritionNotice: dataset.NutritionNotice,
		DataVersion:     dataset.Version,
		CallToAction:    "注册食探，记录这一杯",
	}
	if s.storage != nil {
		landing.ImageURL = s.storage.BuildAccessURL("food-images", product.ImageKey)
	}

	if s.repo != nil {
		override, err := s.repo.FindPublishedMerchantFood(ctx, dataset.MerchantName, product.Name)
		if err != nil {
			logger.Warn(ctx, "读取二维码商品后台修订失败，继续使用临时估算数据",
				slog.String("campaign_code", code),
				slog.String("food_name", product.Name),
				slog.String("error", err.Error()),
			)
		} else if override != nil {
			applyPublicFoodOverride(landing, override, s.storage)
		}
	}
	return landing, nil
}

func (s *MarketingQRService) Track(ctx context.Context, rawCode, visitorID, userID, eventType string, metadata map[string]any) error {
	code, visitorID, err := validateIdentifiers(rawCode, visitorID)
	if err != nil {
		return err
	}
	eventType = strings.TrimSpace(eventType)
	if eventType != "landing_view" && eventType != "register_click" {
		return &commonerrors.AppError{Code: 10002, Message: "不支持的二维码事件", HTTPStatus: http.StatusBadRequest}
	}
	if s.repo == nil {
		return fmt.Errorf("二维码归因存储未配置")
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	return s.repo.RecordEvent(ctx, code, visitorID, strings.TrimSpace(userID), eventType, metadata)
}

func (s *MarketingQRService) BindUser(ctx context.Context, rawCode, visitorID, userID string) error {
	code, visitorID, err := validateIdentifiers(rawCode, visitorID)
	if err != nil {
		return err
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return commonerrors.ErrUnauthorized
	}
	if s.repo == nil {
		return fmt.Errorf("二维码归因存储未配置")
	}
	return s.repo.BindUser(ctx, code, visitorID, userID)
}

func (s *MarketingQRService) Summary(ctx context.Context) ([]domain.Summary, error) {
	rows, err := s.repo.Summary(ctx)
	if err != nil {
		return nil, err
	}
	counts := make(map[string]repo.SummaryCounts, len(rows))
	for _, row := range rows {
		counts[catalog.NormalizeCode(row.CampaignCode)] = row
	}
	result := make([]domain.Summary, 0, len(catalog.Codes()))
	for _, code := range catalog.Codes() {
		row := counts[code]
		kind, title := "product", code
		if code == catalog.TakeoutCode {
			kind, title = "takeout", "统一外卖包装码"
		} else if product, ok := catalog.ProductByCode(code); ok {
			title = product.Name
		}
		result = append(result, domain.Summary{
			CampaignCode:       code,
			Kind:               kind,
			Title:              title,
			LandingViews:       row.LandingViews,
			UniqueVisitors:     row.UniqueVisitors,
			RegistrationClicks: row.RegistrationClicks,
			RegisteredUsers:    row.RegisteredUsers,
			PaidUsers:          row.PaidUsers,
		})
	}
	return result, nil
}

func validateIdentifiers(rawCode, rawVisitorID string) (string, string, error) {
	code := catalog.NormalizeCode(rawCode)
	if !catalog.IsKnownCode(code) {
		return "", "", &commonerrors.AppError{Code: 10004, Message: "二维码对应的活动不存在", HTTPStatus: http.StatusNotFound}
	}
	visitorID := strings.TrimSpace(rawVisitorID)
	if len(visitorID) < 8 || len(visitorID) > 128 {
		return "", "", &commonerrors.AppError{Code: 10002, Message: "访客标识无效", HTTPStatus: http.StatusBadRequest}
	}
	return code, visitorID, nil
}

func applyPublicFoodOverride(landing *domain.Landing, item *publicfooddomain.PublicFoodItem, storageClient *storage.Client) {
	if landing == nil || item == nil {
		return
	}
	landing.PublicFoodItemID = item.ID
	if strings.TrimSpace(item.FoodName) != "" {
		landing.Title = strings.TrimSpace(item.FoodName)
	}
	if strings.TrimSpace(item.MerchantAddress) != "" {
		landing.Address = strings.TrimSpace(item.MerchantAddress)
	}
	if strings.TrimSpace(item.DetailAddress) != "" {
		landing.Address = strings.TrimSpace(item.DetailAddress)
	}
	if item.Latitude != nil && item.Longitude != nil {
		landing.Latitude = item.Latitude
		landing.Longitude = item.Longitude
		landing.LocationIsEstimated = false
	}
	if strings.TrimSpace(item.PortionDescription) != "" {
		landing.PortionDescription = strings.TrimSpace(item.PortionDescription)
	}
	if item.PriceType == "range" && item.PriceMin > 0 && item.PriceMax > 0 {
		landing.PriceMin = item.PriceMin
		landing.PriceMax = item.PriceMax
	} else if item.Price > 0 {
		landing.PriceMin = item.Price
		landing.PriceMax = item.Price
	}
	if item.TotalCalories > 0 {
		landing.Nutrition = &domain.Nutrition{
			CaloriesKcal: item.TotalCalories,
			ProteinG:     item.TotalProtein,
			CarbsG:       item.TotalCarbs,
			FatG:         item.TotalFat,
		}
		if strings.EqualFold(strings.TrimSpace(item.NutritionStatus), "verified") {
			landing.NutritionNotice = "营养数据已由后台核验；糖度、冰量和加料仍可能改变实际摄入。"
		} else {
			landing.NutritionNotice = "营养数据来自当前后台版本，仍可能随配方、糖度、冰量和加料变化。"
		}
		landing.DataVersion = fmt.Sprintf("public-food-%d", item.NutritionVersion)
	}
	if storageClient != nil {
		if item.ImagePath != nil && strings.TrimSpace(*item.ImagePath) != "" {
			landing.ImageURL = storageClient.ResolveReferenceURL("food-images", *item.ImagePath)
		} else if len(item.ImagePaths) > 0 {
			landing.ImageURL = storageClient.ResolveReferenceURL("food-images", item.ImagePaths[0])
		}
	}
}
