package service

import (
	"context"
	"strings"
	"time"

	"food_link/backend/internal/admin/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/pkg/storage"
)

type PublicFoodRepo interface {
	List(ctx context.Context, input repo.ListPublicFoodInput) (*repo.ListPublicFoodResult, error)
	Get(ctx context.Context, id string) (*domain.PublicFoodItem, error)
	Create(ctx context.Context, item *domain.PublicFoodItem) (*domain.PublicFoodItem, error)
	Update(ctx context.Context, id string, patch repo.PublicFoodPatch) (*domain.PublicFoodItem, error)
	Delete(ctx context.Context, id string) error
}

type PublicFoodService struct {
	repo    PublicFoodRepo
	storage *storage.Client
}

func NewPublicFoodService(repo PublicFoodRepo, storage *storage.Client) *PublicFoodService {
	return &PublicFoodService{repo: repo, storage: storage}
}

type ListPublicFoodInput struct {
	Query        string `form:"q"`
	Status       string `form:"status"`
	IsCampusFood string `form:"is_campus_food"`
	Type         string `form:"type"`
	Page         int    `form:"page"`
	Limit        int    `form:"limit"`
}

type CreatePublicFoodInput struct {
	FoodName           string           `json:"food_name" binding:"required"`
	Description        string           `json:"description"`
	MerchantName       string           `json:"merchant_name"`
	MerchantAddress    string           `json:"merchant_address"`
	DetailAddress      string           `json:"detail_address"`
	Type               string           `json:"type"`
	Status             string           `json:"status"`
	IsCampusFood       bool             `json:"is_campus_food"`
	SchoolID           string           `json:"school_id"`
	CampusID           string           `json:"campus_id"`
	CanteenID          string           `json:"canteen_id"`
	WindowID           string           `json:"window_id"`
	SchoolName         string           `json:"school_name"`
	CampusName         string           `json:"campus_name"`
	CanteenName        string           `json:"canteen_name"`
	Floor              string           `json:"floor"`
	WindowName         string           `json:"window_name"`
	Price              float64          `json:"price"`
	PriceType          string           `json:"price_type"`
	PriceUnit          string           `json:"price_unit"`
	PortionDescription string           `json:"portion_description"`
	SuitableForFatLoss bool             `json:"suitable_for_fat_loss"`
	TotalCalories      float64          `json:"total_calories"`
	TotalProtein       float64          `json:"total_protein"`
	TotalCarbs         float64          `json:"total_carbs"`
	TotalFat           float64          `json:"total_fat"`
	Items              []map[string]any `json:"items"`
	ImagePaths         []string         `json:"image_paths"`
	UserNotes          string           `json:"user_notes"`
}

type UpdatePublicFoodInput struct {
	FoodName           *string           `json:"food_name,omitempty"`
	Description        *string           `json:"description,omitempty"`
	MerchantName       *string           `json:"merchant_name,omitempty"`
	MerchantAddress    *string           `json:"merchant_address,omitempty"`
	DetailAddress      *string           `json:"detail_address,omitempty"`
	Type               *string           `json:"type,omitempty"`
	Status             *string           `json:"status,omitempty"`
	IsCampusFood       *bool             `json:"is_campus_food,omitempty"`
	SchoolID           *string           `json:"school_id,omitempty"`
	CampusID           *string           `json:"campus_id,omitempty"`
	CanteenID          *string           `json:"canteen_id,omitempty"`
	WindowID           *string           `json:"window_id,omitempty"`
	SchoolName         *string           `json:"school_name,omitempty"`
	CampusName         *string           `json:"campus_name,omitempty"`
	CanteenName        *string           `json:"canteen_name,omitempty"`
	Floor              *string           `json:"floor,omitempty"`
	WindowName         *string           `json:"window_name,omitempty"`
	Price              *float64          `json:"price,omitempty"`
	PriceType          *string           `json:"price_type,omitempty"`
	PriceUnit          *string           `json:"price_unit,omitempty"`
	PortionDescription *string           `json:"portion_description,omitempty"`
	SuitableForFatLoss *bool             `json:"suitable_for_fat_loss,omitempty"`
	TotalCalories      *float64          `json:"total_calories,omitempty"`
	TotalProtein       *float64          `json:"total_protein,omitempty"`
	TotalCarbs         *float64          `json:"total_carbs,omitempty"`
	TotalFat           *float64          `json:"total_fat,omitempty"`
	Items              *[]map[string]any `json:"items,omitempty"`
	ImagePaths         *[]string         `json:"image_paths,omitempty"`
	UserNotes          *string           `json:"user_notes,omitempty"`
}

func (s *PublicFoodService) List(ctx context.Context, input ListPublicFoodInput) (*repo.ListPublicFoodResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 40
	}
	if limit > 100 {
		limit = 100
	}
	page := input.Page
	if page <= 0 {
		page = 1
	}
	result, err := s.repo.List(ctx, repo.ListPublicFoodInput{
		Query:        input.Query,
		Status:       input.Status,
		IsCampusFood: input.IsCampusFood,
		Type:         input.Type,
		Limit:        limit,
		Offset:       (page - 1) * limit,
	})
	if err != nil {
		return nil, err
	}
	for i := range result.Items {
		s.normalizeImages(&result.Items[i])
	}
	return result, nil
}

func (s *PublicFoodService) Get(ctx context.Context, id string) (*domain.PublicFoodItem, error) {
	item, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	s.normalizeImages(item)
	return item, nil
}

func (s *PublicFoodService) Create(ctx context.Context, input CreatePublicFoodInput) (*domain.PublicFoodItem, error) {
	name := strings.TrimSpace(input.FoodName)
	if name == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "食物名称不能为空", HTTPStatus: 400}
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = "published"
	}
	itemType := strings.TrimSpace(input.Type)
	if itemType == "" {
		itemType = "common"
	}
	now := time.Now()
	item := &domain.PublicFoodItem{
		FoodName:           name,
		Description:        strings.TrimSpace(input.Description),
		MerchantName:       strings.TrimSpace(input.MerchantName),
		MerchantAddress:    strings.TrimSpace(input.MerchantAddress),
		DetailAddress:      strings.TrimSpace(input.DetailAddress),
		Type:               itemType,
		Status:             status,
		IsCampusFood:       input.IsCampusFood,
		SchoolID:           stringPtrFromValue(input.SchoolID),
		CampusID:           stringPtrFromValue(input.CampusID),
		CanteenID:          stringPtrFromValue(input.CanteenID),
		WindowID:           stringPtrFromValue(input.WindowID),
		SchoolName:         strings.TrimSpace(input.SchoolName),
		CampusName:         strings.TrimSpace(input.CampusName),
		CanteenName:        strings.TrimSpace(input.CanteenName),
		Floor:              strings.TrimSpace(input.Floor),
		WindowName:         strings.TrimSpace(input.WindowName),
		Price:              input.Price,
		PriceType:          strings.TrimSpace(input.PriceType),
		PriceUnit:          strings.TrimSpace(input.PriceUnit),
		PortionDescription: strings.TrimSpace(input.PortionDescription),
		SuitableForFatLoss: input.SuitableForFatLoss,
		TotalCalories:      input.TotalCalories,
		TotalProtein:       input.TotalProtein,
		TotalCarbs:         input.TotalCarbs,
		TotalFat:           input.TotalFat,
		Items:              input.Items,
		ImagePaths:         normalizeStringSlice(input.ImagePaths),
		UserNotes:          strings.TrimSpace(input.UserNotes),
		PublishedAt:        &now,
	}
	created, err := s.repo.Create(ctx, item)
	if err != nil {
		return nil, err
	}
	s.normalizeImages(created)
	return created, nil
}

func (s *PublicFoodService) Update(ctx context.Context, id string, input UpdatePublicFoodInput) (*domain.PublicFoodItem, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "条目 ID 不能为空", HTTPStatus: 400}
	}
	current, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	_ = current
	patch := repo.PublicFoodPatch{}
	setStringPtr(patch, "food_name", input.FoodName)
	setStringPtr(patch, "description", input.Description)
	setStringPtr(patch, "merchant_name", input.MerchantName)
	setStringPtr(patch, "merchant_address", input.MerchantAddress)
	setStringPtr(patch, "detail_address", input.DetailAddress)
	setStringPtr(patch, "type", input.Type)
	setStringPtr(patch, "status", input.Status)
	setBoolPtr(patch, "is_campus_food", input.IsCampusFood)
	setStringPtr(patch, "school_id", input.SchoolID)
	setStringPtr(patch, "campus_id", input.CampusID)
	setStringPtr(patch, "canteen_id", input.CanteenID)
	setStringPtr(patch, "window_id", input.WindowID)
	setStringPtr(patch, "school_name", input.SchoolName)
	setStringPtr(patch, "campus_name", input.CampusName)
	setStringPtr(patch, "canteen_name", input.CanteenName)
	setStringPtr(patch, "floor", input.Floor)
	setStringPtr(patch, "window_name", input.WindowName)
	setFloatPtr(patch, "price", input.Price)
	setStringPtr(patch, "price_type", input.PriceType)
	setStringPtr(patch, "price_unit", input.PriceUnit)
	setStringPtr(patch, "portion_description", input.PortionDescription)
	setBoolPtr(patch, "suitable_for_fat_loss", input.SuitableForFatLoss)
	setFloatPtr(patch, "total_calories", input.TotalCalories)
	setFloatPtr(patch, "total_protein", input.TotalProtein)
	setFloatPtr(patch, "total_carbs", input.TotalCarbs)
	setFloatPtr(patch, "total_fat", input.TotalFat)
	setStringSlicePtr(patch, "image_paths", input.ImagePaths)
	setStringPtr(patch, "user_notes", input.UserNotes)
	if input.Items != nil {
		patch["items"] = *input.Items
	}
	if len(patch) == 0 {
		s.normalizeImages(current)
		return current, nil
	}
	updated, err := s.repo.Update(ctx, id, patch)
	if err != nil {
		return nil, err
	}
	s.normalizeImages(updated)
	return updated, nil
}

func (s *PublicFoodService) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, strings.TrimSpace(id))
}

func (s *PublicFoodService) normalizeImages(item *domain.PublicFoodItem) {
	if s.storage == nil || item == nil {
		return
	}
	item.ImagePaths = s.storage.ResolveReferenceURLs("food-images", item.ImagePaths)
	if item.ImagePath != nil {
		resolved := s.storage.ResolveReferenceURL("food-images", *item.ImagePath)
		if strings.TrimSpace(resolved) != "" && !stringSliceContains(item.ImagePaths, resolved) {
			*item.ImagePath = resolved
			item.ImagePaths = append([]string{resolved}, item.ImagePaths...)
		}
	}
}
