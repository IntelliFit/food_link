package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	campuscatalogservice "food_link/backend/internal/campuscatalog/service"
	publicfoodservice "food_link/backend/internal/publicfood/service"

	"github.com/google/uuid"
)

// campusCatalogAdapter keeps the legacy public-food HTTP contract while
// routing every campus write through the versioned catalog source of truth.
type campusCatalogAdapter struct {
	catalog *campuscatalogservice.CatalogService
}

func (a campusCatalogAdapter) CreateCampusFood(ctx context.Context, userID string, input publicfoodservice.CreateInput) (string, error) {
	priceType := pointerText(input.PriceType)
	if priceType == "weight" {
		priceType = "by_weight"
	}
	imagePaths := append([]string{}, input.ImagePaths...)
	if len(imagePaths) == 0 && input.ImagePath != nil && strings.TrimSpace(*input.ImagePath) != "" {
		imagePaths = append(imagePaths, strings.TrimSpace(*input.ImagePath))
	}
	clientBatchKey := pointerText(input.ClientBatchKey)
	if clientBatchKey == "" {
		clientBatchKey = uuid.NewString()
	}
	result, err := a.catalog.CreateUserSingle(ctx, userID, campuscatalogservice.CreateBatchInput{
		ClientBatchKey:      "user-single:" + clientBatchKey,
		BatchName:           strings.Join(nonEmptyAdapterValues(pointerText(input.SchoolName), pointerText(input.CanteenName), time.Now().Format("2006-01-02")), "-"),
		VenueType:           "university",
		SchoolID:            input.SchoolID,
		CampusID:            input.CampusID,
		CanteenID:           input.CanteenID,
		DefaultWindowID:     input.WindowID,
		OrganizationName:    pointerText(input.SchoolName),
		AreaName:            pointerText(input.CampusName),
		CanteenName:         pointerText(input.CanteenName),
		DefaultFloor:        pointerText(input.Floor),
		DefaultWindowName:   pointerText(input.WindowName),
		DefaultWindowLayout: "unknown",
		DefaultServiceMode:  "unknown",
		CapturedAt:          input.PriceCollectedAt,
		CollectorName:       "小程序用户",
		SourceNote:          pointerText(input.UserNotes),
		Entries: []campuscatalogservice.CreateCatalogItemInput{{
			EntryType: "dish", Name: pointerText(input.FoodName), Description: pointerText(input.Description),
			WindowID: input.WindowID, Floor: pointerText(input.Floor), WindowName: pointerText(input.WindowName),
			WindowLayout: "unknown", ServiceMode: "unknown", PriceType: priceType,
			Price: input.Price, PriceMin: input.PriceMin, PriceMax: input.PriceMax, PriceUnit: pointerText(input.PriceUnit),
			PortionDescription: pointerText(input.PortionDescription), ImagePaths: imagePaths, ImageKind: "dish",
			Notes: pointerText(input.UserNotes),
		}},
	})
	if err != nil {
		return "", err
	}
	if result == nil || len(result.Items) != 1 {
		return "", fmt.Errorf("校园单菜上传未生成主记录")
	}
	return result.Items[0].ID, nil
}

func (a campusCatalogAdapter) AppendCampusFoodImages(ctx context.Context, userID, itemID string, imagePaths []string) ([]string, error) {
	result, err := a.catalog.ApplyLatestUserCorrection(ctx, userID, itemID, map[string]any{"append_image_paths": imagePaths}, "补充菜品照片")
	if err != nil {
		return nil, err
	}
	return result.Item.ImagePaths, nil
}

func (a campusCatalogAdapter) UpdateCampusFood(ctx context.Context, userID, itemID string, input publicfoodservice.CreateInput) error {
	patch := map[string]any{}
	putAdapterString(patch, "name", input.FoodName)
	putAdapterString(patch, "description", input.Description)
	putAdapterString(patch, "school_id", input.SchoolID)
	putAdapterString(patch, "campus_id", input.CampusID)
	putAdapterString(patch, "canteen_id", input.CanteenID)
	putAdapterString(patch, "window_id", input.WindowID)
	putAdapterString(patch, "floor", input.Floor)
	putAdapterString(patch, "window_name", input.WindowName)
	putAdapterString(patch, "price_type", input.PriceType)
	putAdapterString(patch, "price_unit", input.PriceUnit)
	putAdapterString(patch, "portion_description", input.PortionDescription)
	if input.Price != nil {
		patch["price"] = *input.Price
	}
	if input.PriceMin != nil {
		patch["price_min"] = *input.PriceMin
	}
	if input.PriceMax != nil {
		patch["price_max"] = *input.PriceMax
	}
	if input.PriceCollectedAt != nil {
		patch["price_collected_at"] = input.PriceCollectedAt.Format(time.RFC3339)
	}
	if len(input.ImagePaths) > 0 {
		patch["image_paths"] = input.ImagePaths
	}
	if len(patch) == 0 {
		return nil
	}
	_, err := a.catalog.ApplyLatestUserCorrection(ctx, userID, itemID, patch, "兼容旧版菜品编辑")
	return err
}

func pointerText(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func putAdapterString(target map[string]any, key string, value *string) {
	if value != nil {
		target[key] = strings.TrimSpace(*value)
	}
}

func nonEmptyAdapterValues(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			out = append(out, value)
		}
	}
	return out
}
