package service

import (
	"context"
	"strings"

	"food_link/backend/internal/admin/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/storage"
)

type PackagedFoodRepo interface {
	List(ctx context.Context, input repo.ListPackagedFoodsInput) (*repo.ListPackagedFoodsResult, error)
	Get(ctx context.Context, id string) (*domain.PackagedFood, error)
	Create(ctx context.Context, item *domain.PackagedFood) (*domain.PackagedFood, error)
	Update(ctx context.Context, id string, patch repo.PackagedFoodPatch) (*domain.PackagedFood, error)
	Delete(ctx context.Context, id string) error
}

type CreatePackagedFoodInput struct {
	Brand                 string         `json:"brand"`
	ProductName           string         `json:"product_name"`
	DisplayName           string         `json:"display_name"`
	SearchText            string         `json:"search_text"`
	ProductFamilyKey      string         `json:"product_family_key"`
	SpecText              *string        `json:"spec_text"`
	Barcode               *string        `json:"barcode"`
	FlavorText            *string        `json:"flavor_text"`
	PackageCategory       *string        `json:"package_category"`
	IngredientsText       *string        `json:"ingredients_text"`
	SourceImageURLs       []string       `json:"source_image_urls"`
	OCRRawText            *string        `json:"ocr_raw_text"`
	NutritionBasisUnit    *string        `json:"nutrition_basis_unit"`
	EnergyUnitRaw         *string        `json:"energy_unit_raw"`
	RawLabelPayload       map[string]any `json:"raw_label_payload"`
	ConversionStatus      *string        `json:"conversion_status"`
	ExtractConfidence     *float64       `json:"extract_confidence"`
	FieldConfidence       map[string]any `json:"field_confidence"`
	IngestMethod          *string        `json:"ingest_method"`
	NetContentValue       *float64       `json:"net_content_value"`
	NetContentUnit        *string        `json:"net_content_unit"`
	UnitCount             *float64       `json:"unit_count"`
	UnitContentValue      *float64       `json:"unit_content_value"`
	UnitContentUnit       *string        `json:"unit_content_unit"`
	ReviewStatus          *string        `json:"review_status"`
	NetWeightG            *float64       `json:"net_weight_g"`
	ServingWeightG        *float64       `json:"serving_weight_g"`
	KcalPer100g           *float64       `json:"kcal_per_100g"`
	ProteinPer100g        *float64       `json:"protein_per_100g"`
	CarbsPer100g          *float64       `json:"carbs_per_100g"`
	FatPer100g            *float64       `json:"fat_per_100g"`
	FiberPer100g          *float64       `json:"fiber_per_100g"`
	SugarPer100g          *float64       `json:"sugar_per_100g"`
	SaturatedFatPer100g   *float64       `json:"saturated_fat_per_100g"`
	CholesterolMgPer100g  *float64       `json:"cholesterol_mg_per_100g"`
	SodiumMgPer100g       *float64       `json:"sodium_mg_per_100g"`
	PotassiumMgPer100g    *float64       `json:"potassium_mg_per_100g"`
	CalciumMgPer100g      *float64       `json:"calcium_mg_per_100g"`
	IronMgPer100g         *float64       `json:"iron_mg_per_100g"`
	MagnesiumMgPer100g    *float64       `json:"magnesium_mg_per_100g"`
	ZincMgPer100g         *float64       `json:"zinc_mg_per_100g"`
	VitaminARaeMcgPer100g *float64       `json:"vitamin_a_rae_mcg_per_100g"`
	VitaminCMgPer100g     *float64       `json:"vitamin_c_mg_per_100g"`
	VitaminDMcgPer100g    *float64       `json:"vitamin_d_mcg_per_100g"`
	VitaminEMgPer100g     *float64       `json:"vitamin_e_mg_per_100g"`
	VitaminKMcgPer100g    *float64       `json:"vitamin_k_mcg_per_100g"`
	ThiaminMgPer100g      *float64       `json:"thiamin_mg_per_100g"`
	RiboflavinMgPer100g   *float64       `json:"riboflavin_mg_per_100g"`
	NiacinMgPer100g       *float64       `json:"niacin_mg_per_100g"`
	VitaminB6MgPer100g    *float64       `json:"vitamin_b6_mg_per_100g"`
	FolateMcgPer100g      *float64       `json:"folate_mcg_per_100g"`
	VitaminB12McgPer100g  *float64       `json:"vitamin_b12_mcg_per_100g"`
	SourceURL             string         `json:"source_url"`
	Source                string         `json:"source"`
	IsActive              *bool          `json:"is_active"`
}

type PackagedFoodService struct {
	repo    PackagedFoodRepo
	storage *storage.Client
}

type ListPackagedFoodsInput struct {
	Query        string
	ReviewStatus string
	Active       string
	ImageState   string
	Page         int
	Limit        int
}

type UpdatePackagedFoodInput struct {
	Brand                 *string         `json:"brand"`
	ProductName           *string         `json:"product_name"`
	DisplayName           *string         `json:"display_name"`
	SearchText            *string         `json:"search_text"`
	ProductFamilyKey      *string         `json:"product_family_key"`
	SpecText              *string         `json:"spec_text"`
	Barcode               *string         `json:"barcode"`
	FlavorText            *string         `json:"flavor_text"`
	PackageCategory       *string         `json:"package_category"`
	IngredientsText       *string         `json:"ingredients_text"`
	SourceImageURLs       *[]string       `json:"source_image_urls"`
	OCRRawText            *string         `json:"ocr_raw_text"`
	NutritionBasisUnit    *string         `json:"nutrition_basis_unit"`
	EnergyUnitRaw         *string         `json:"energy_unit_raw"`
	RawLabelPayload       *map[string]any `json:"raw_label_payload"`
	ConversionStatus      *string         `json:"conversion_status"`
	ExtractConfidence     *float64        `json:"extract_confidence"`
	FieldConfidence       *map[string]any `json:"field_confidence"`
	IngestMethod          *string         `json:"ingest_method"`
	NetContentValue       *float64        `json:"net_content_value"`
	NetContentUnit        *string         `json:"net_content_unit"`
	UnitCount             *float64        `json:"unit_count"`
	UnitContentValue      *float64        `json:"unit_content_value"`
	UnitContentUnit       *string         `json:"unit_content_unit"`
	ReviewStatus          *string         `json:"review_status"`
	NetWeightG            *float64        `json:"net_weight_g"`
	ServingWeightG        *float64        `json:"serving_weight_g"`
	KcalPer100g           *float64        `json:"kcal_per_100g"`
	ProteinPer100g        *float64        `json:"protein_per_100g"`
	CarbsPer100g          *float64        `json:"carbs_per_100g"`
	FatPer100g            *float64        `json:"fat_per_100g"`
	FiberPer100g          *float64        `json:"fiber_per_100g"`
	SugarPer100g          *float64        `json:"sugar_per_100g"`
	SaturatedFatPer100g   *float64        `json:"saturated_fat_per_100g"`
	CholesterolMgPer100g  *float64        `json:"cholesterol_mg_per_100g"`
	SodiumMgPer100g       *float64        `json:"sodium_mg_per_100g"`
	PotassiumMgPer100g    *float64        `json:"potassium_mg_per_100g"`
	CalciumMgPer100g      *float64        `json:"calcium_mg_per_100g"`
	IronMgPer100g         *float64        `json:"iron_mg_per_100g"`
	MagnesiumMgPer100g    *float64        `json:"magnesium_mg_per_100g"`
	ZincMgPer100g         *float64        `json:"zinc_mg_per_100g"`
	VitaminARaeMcgPer100g *float64        `json:"vitamin_a_rae_mcg_per_100g"`
	VitaminCMgPer100g     *float64        `json:"vitamin_c_mg_per_100g"`
	VitaminDMcgPer100g    *float64        `json:"vitamin_d_mcg_per_100g"`
	VitaminEMgPer100g     *float64        `json:"vitamin_e_mg_per_100g"`
	VitaminKMcgPer100g    *float64        `json:"vitamin_k_mcg_per_100g"`
	ThiaminMgPer100g      *float64        `json:"thiamin_mg_per_100g"`
	RiboflavinMgPer100g   *float64        `json:"riboflavin_mg_per_100g"`
	NiacinMgPer100g       *float64        `json:"niacin_mg_per_100g"`
	VitaminB6MgPer100g    *float64        `json:"vitamin_b6_mg_per_100g"`
	FolateMcgPer100g      *float64        `json:"folate_mcg_per_100g"`
	VitaminB12McgPer100g  *float64        `json:"vitamin_b12_mcg_per_100g"`
	SourceURL             *string         `json:"source_url"`
	Source                *string         `json:"source"`
	IsActive              *bool           `json:"is_active"`
}

func NewPackagedFoodService(repo PackagedFoodRepo, storage *storage.Client) *PackagedFoodService {
	return &PackagedFoodService{repo: repo, storage: storage}
}

func (s *PackagedFoodService) List(ctx context.Context, input ListPackagedFoodsInput) (*repo.ListPackagedFoodsResult, error) {
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
	result, err := s.repo.List(ctx, repo.ListPackagedFoodsInput{
		Query:        input.Query,
		ReviewStatus: input.ReviewStatus,
		Active:       input.Active,
		ImageState:   input.ImageState,
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

func (s *PackagedFoodService) Get(ctx context.Context, id string) (*domain.PackagedFood, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "商品 ID 不能为空", HTTPStatus: 400}
	}
	item, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	s.normalizeImages(item)
	return item, nil
}

func (s *PackagedFoodService) Create(ctx context.Context, input CreatePackagedFoodInput) (*domain.PackagedFood, error) {
	input.Brand = strings.TrimSpace(input.Brand)
	input.ProductName = strings.TrimSpace(input.ProductName)
	if input.Brand == "" || input.ProductName == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "品牌与商品名称不能为空", HTTPStatus: 400}
	}

	normalized := foodrecordrepo.PackagedProductNormalizer{}.Normalize(foodrecordrepo.PackagedProductNormalizeInput{
		Brand:            input.Brand,
		ProductName:      input.ProductName,
		DisplayName:      input.DisplayName,
		SearchText:       input.SearchText,
		ProductFamilyKey: input.ProductFamilyKey,
		FlavorText:       stringPtr(input.FlavorText),
		SpecText:         stringPtr(input.SpecText),
		Barcode:          stringPtr(input.Barcode),
		PackageCategory:  stringPtr(input.PackageCategory),
		OCRRawText:       stringPtr(input.OCRRawText),
		NetWeightG:       floatPtrValue(input.NetWeightG),
		NetContentValue:  floatPtrValue(input.NetContentValue),
		NetContentUnit:   stringPtr(input.NetContentUnit),
		UnitCount:        floatPtrValue(input.UnitCount),
		UnitContentValue: floatPtrValue(input.UnitContentValue),
		UnitContentUnit:  stringPtr(input.UnitContentUnit),
		ReviewStatus:     stringPtr(input.ReviewStatus),
	})

	item := &domain.PackagedFood{
		Brand:            input.Brand,
		ProductName:      input.ProductName,
		NormalizedName:   normalized.NormalizedName,
		ProductKey:       normalized.ProductKey,
		DisplayName:      normalized.DisplayName,
		SearchText:       normalized.SearchText,
		ProductFamilyKey: normalized.ProductFamilyKey,
		SpecText:         input.SpecText,
		Barcode:          input.Barcode,
		FlavorText:       input.FlavorText,
		PackageCategory:  input.PackageCategory,
		IngredientsText:  input.IngredientsText,
		SourceImageURLs:  normalizeStringSlice(input.SourceImageURLs),
		OCRRawText:       input.OCRRawText,
		NutritionBasisUnit: input.NutritionBasisUnit,
		EnergyUnitRaw:    input.EnergyUnitRaw,
		ConversionStatus: input.ConversionStatus,
		IngestMethod:     input.IngestMethod,
		ReviewStatus:     normalized.ReviewStatus,
		SourceURL:        strings.TrimSpace(input.SourceURL),
		Source:           strings.TrimSpace(input.Source),
		NetWeightG:       normalized.NetWeightG,
		NetContentValue:  normalized.NetContentValue,
		NetContentUnit:   ptrString(normalized.NetContentUnit),
		UnitCount:        normalized.UnitCount,
		UnitContentValue: normalized.UnitContentValue,
		UnitContentUnit:  ptrString(normalized.UnitContentUnit),
	}
	if input.ExtractConfidence != nil {
		item.ExtractConfidence = *input.ExtractConfidence
	}
	item.NetWeightG = normalized.NetWeightG
	if input.ServingWeightG != nil {
		item.ServingWeightG = *input.ServingWeightG
	}
	if input.KcalPer100g != nil {
		item.KcalPer100g = *input.KcalPer100g
	}
	if input.ProteinPer100g != nil {
		item.ProteinPer100g = *input.ProteinPer100g
	}
	if input.CarbsPer100g != nil {
		item.CarbsPer100g = *input.CarbsPer100g
	}
	if input.FatPer100g != nil {
		item.FatPer100g = *input.FatPer100g
	}
	if input.FiberPer100g != nil {
		item.FiberPer100g = *input.FiberPer100g
	}
	if input.SugarPer100g != nil {
		item.SugarPer100g = *input.SugarPer100g
	}
	if input.SaturatedFatPer100g != nil {
		item.SaturatedFatPer100g = *input.SaturatedFatPer100g
	}
	if input.CholesterolMgPer100g != nil {
		item.CholesterolMgPer100g = *input.CholesterolMgPer100g
	}
	if input.SodiumMgPer100g != nil {
		item.SodiumMgPer100g = *input.SodiumMgPer100g
	}
	if input.PotassiumMgPer100g != nil {
		item.PotassiumMgPer100g = *input.PotassiumMgPer100g
	}
	if input.CalciumMgPer100g != nil {
		item.CalciumMgPer100g = *input.CalciumMgPer100g
	}
	if input.IronMgPer100g != nil {
		item.IronMgPer100g = *input.IronMgPer100g
	}
	if input.MagnesiumMgPer100g != nil {
		item.MagnesiumMgPer100g = *input.MagnesiumMgPer100g
	}
	if input.ZincMgPer100g != nil {
		item.ZincMgPer100g = *input.ZincMgPer100g
	}
	if input.VitaminARaeMcgPer100g != nil {
		item.VitaminARaeMcgPer100g = *input.VitaminARaeMcgPer100g
	}
	if input.VitaminCMgPer100g != nil {
		item.VitaminCMgPer100g = *input.VitaminCMgPer100g
	}
	if input.VitaminDMcgPer100g != nil {
		item.VitaminDMcgPer100g = *input.VitaminDMcgPer100g
	}
	if input.VitaminEMgPer100g != nil {
		item.VitaminEMgPer100g = *input.VitaminEMgPer100g
	}
	if input.VitaminKMcgPer100g != nil {
		item.VitaminKMcgPer100g = *input.VitaminKMcgPer100g
	}
	if input.ThiaminMgPer100g != nil {
		item.ThiaminMgPer100g = *input.ThiaminMgPer100g
	}
	if input.RiboflavinMgPer100g != nil {
		item.RiboflavinMgPer100g = *input.RiboflavinMgPer100g
	}
	if input.NiacinMgPer100g != nil {
		item.NiacinMgPer100g = *input.NiacinMgPer100g
	}
	if input.VitaminB6MgPer100g != nil {
		item.VitaminB6MgPer100g = *input.VitaminB6MgPer100g
	}
	if input.FolateMcgPer100g != nil {
		item.FolateMcgPer100g = *input.FolateMcgPer100g
	}
	if input.VitaminB12McgPer100g != nil {
		item.VitaminB12McgPer100g = *input.VitaminB12McgPer100g
	}
	if input.IsActive != nil {
		item.IsActive = *input.IsActive
	} else {
		item.IsActive = true
	}

	if len(input.RawLabelPayload) > 0 {
		item.RawLabelPayload = input.RawLabelPayload
	}
	if len(input.FieldConfidence) > 0 {
		item.FieldConfidence = input.FieldConfidence
	}

	created, err := s.repo.Create(ctx, item)
	if err != nil {
		return nil, err
	}
	s.normalizeImages(created)
	return created, nil
}

func (s *PackagedFoodService) Delete(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return &commonerrors.AppError{Code: 10002, Message: "商品 ID 不能为空", HTTPStatus: 400}
	}
	_, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	return s.repo.Delete(ctx, id)
}

func (s *PackagedFoodService) Update(ctx context.Context, id string, input UpdatePackagedFoodInput) (*domain.PackagedFood, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "商品 ID 不能为空", HTTPStatus: 400}
	}
	current, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	patch, err := buildPatch(current, input)
	if err != nil {
		return nil, err
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

func buildPatch(current *domain.PackagedFood, input UpdatePackagedFoodInput) (repo.PackagedFoodPatch, error) {
	patch := repo.PackagedFoodPatch{}

	setString(patch, "brand", input.Brand)
	setString(patch, "product_name", input.ProductName)
	setString(patch, "display_name", input.DisplayName)
	setString(patch, "search_text", input.SearchText)
	setString(patch, "product_family_key", input.ProductFamilyKey)
	setNullableString(patch, "spec_text", input.SpecText)
	setNullableString(patch, "barcode", input.Barcode)
	setNullableString(patch, "flavor_text", input.FlavorText)
	setNullableString(patch, "package_category", input.PackageCategory)
	setNullableString(patch, "ingredients_text", input.IngredientsText)
	setNullableString(patch, "ocr_raw_text", input.OCRRawText)
	setNullableString(patch, "nutrition_basis_unit", input.NutritionBasisUnit)
	setNullableString(patch, "energy_unit_raw", input.EnergyUnitRaw)
	setNullableString(patch, "conversion_status", input.ConversionStatus)
	setNullableString(patch, "ingest_method", input.IngestMethod)
	setNullableString(patch, "net_content_unit", input.NetContentUnit)
	setNullableString(patch, "unit_content_unit", input.UnitContentUnit)
	setString(patch, "review_status", input.ReviewStatus)
	setString(patch, "source_url", input.SourceURL)
	setString(patch, "source", input.Source)
	setBool(patch, "is_active", input.IsActive)

	setFloat(patch, "extract_confidence", input.ExtractConfidence)
	setFloat(patch, "net_content_value", input.NetContentValue)
	setFloat(patch, "unit_count", input.UnitCount)
	setFloat(patch, "unit_content_value", input.UnitContentValue)
	setFloat(patch, "net_weight_g", input.NetWeightG)
	setFloat(patch, "serving_weight_g", input.ServingWeightG)
	setFloat(patch, "kcal_per_100g", input.KcalPer100g)
	setFloat(patch, "protein_per_100g", input.ProteinPer100g)
	setFloat(patch, "carbs_per_100g", input.CarbsPer100g)
	setFloat(patch, "fat_per_100g", input.FatPer100g)
	setFloat(patch, "fiber_per_100g", input.FiberPer100g)
	setFloat(patch, "sugar_per_100g", input.SugarPer100g)
	setFloat(patch, "saturated_fat_per_100g", input.SaturatedFatPer100g)
	setFloat(patch, "cholesterol_mg_per_100g", input.CholesterolMgPer100g)
	setFloat(patch, "sodium_mg_per_100g", input.SodiumMgPer100g)
	setFloat(patch, "potassium_mg_per_100g", input.PotassiumMgPer100g)
	setFloat(patch, "calcium_mg_per_100g", input.CalciumMgPer100g)
	setFloat(patch, "iron_mg_per_100g", input.IronMgPer100g)
	setFloat(patch, "magnesium_mg_per_100g", input.MagnesiumMgPer100g)
	setFloat(patch, "zinc_mg_per_100g", input.ZincMgPer100g)
	setFloat(patch, "vitamin_a_rae_mcg_per_100g", input.VitaminARaeMcgPer100g)
	setFloat(patch, "vitamin_c_mg_per_100g", input.VitaminCMgPer100g)
	setFloat(patch, "vitamin_d_mcg_per_100g", input.VitaminDMcgPer100g)
	setFloat(patch, "vitamin_e_mg_per_100g", input.VitaminEMgPer100g)
	setFloat(patch, "vitamin_k_mcg_per_100g", input.VitaminKMcgPer100g)
	setFloat(patch, "thiamin_mg_per_100g", input.ThiaminMgPer100g)
	setFloat(patch, "riboflavin_mg_per_100g", input.RiboflavinMgPer100g)
	setFloat(patch, "niacin_mg_per_100g", input.NiacinMgPer100g)
	setFloat(patch, "vitamin_b6_mg_per_100g", input.VitaminB6MgPer100g)
	setFloat(patch, "folate_mcg_per_100g", input.FolateMcgPer100g)
	setFloat(patch, "vitamin_b12_mcg_per_100g", input.VitaminB12McgPer100g)

	if input.SourceImageURLs != nil {
		encoded, err := repo.JSONValue(normalizeStringSlice(*input.SourceImageURLs), []string{})
		if err != nil {
			return nil, err
		}
		patch["source_image_urls"] = encoded
	}
	if input.RawLabelPayload != nil {
		encoded, err := repo.JSONValue(*input.RawLabelPayload, map[string]any{})
		if err != nil {
			return nil, err
		}
		patch["raw_label_payload"] = encoded
	}
	if input.FieldConfidence != nil {
		encoded, err := repo.JSONValue(*input.FieldConfidence, map[string]any{})
		if err != nil {
			return nil, err
		}
		patch["field_confidence"] = encoded
	}

	if needsNormalizedPatch(input) {
		normalized := foodrecordrepo.PackagedProductNormalizer{}.Normalize(foodrecordrepo.PackagedProductNormalizeInput{
			Brand:            effectiveString(input.Brand, current.Brand),
			ProductName:      effectiveString(input.ProductName, current.ProductName),
			DisplayName:      effectiveString(input.DisplayName, current.DisplayName),
			SearchText:       effectiveString(input.SearchText, current.SearchText),
			ProductFamilyKey: effectiveString(input.ProductFamilyKey, current.ProductFamilyKey),
			FlavorText:       effectiveString(input.FlavorText, stringPtr(current.FlavorText)),
			SpecText:         effectiveString(input.SpecText, stringPtr(current.SpecText)),
			Barcode:          effectiveString(input.Barcode, stringPtr(current.Barcode)),
			PackageCategory:  effectiveString(input.PackageCategory, stringPtr(current.PackageCategory)),
			OCRRawText:       effectiveString(input.OCRRawText, stringPtr(current.OCRRawText)),
			NetWeightG:       effectiveFloat(input.NetWeightG, current.NetWeightG),
			NetContentValue:  effectiveFloat(input.NetContentValue, current.NetContentValue),
			NetContentUnit:   effectiveString(input.NetContentUnit, stringPtr(current.NetContentUnit)),
			UnitCount:        effectiveFloat(input.UnitCount, current.UnitCount),
			UnitContentValue: effectiveFloat(input.UnitContentValue, current.UnitContentValue),
			UnitContentUnit:  effectiveString(input.UnitContentUnit, stringPtr(current.UnitContentUnit)),
			ReviewStatus:     effectiveString(input.ReviewStatus, current.ReviewStatus),
		})
		patch["normalized_name"] = normalized.NormalizedName
		patch["product_key"] = normalized.ProductKey
		patch["display_name"] = normalized.DisplayName
		patch["search_text"] = normalized.SearchText
		patch["product_family_key"] = normalized.ProductFamilyKey
		patch["net_weight_g"] = normalized.NetWeightG
		patch["net_content_value"] = normalized.NetContentValue
		patch["net_content_unit"] = nullableString(normalized.NetContentUnit)
		patch["unit_count"] = normalized.UnitCount
		patch["unit_content_value"] = normalized.UnitContentValue
		patch["unit_content_unit"] = nullableString(normalized.UnitContentUnit)
		patch["review_status"] = normalized.ReviewStatus
	}

	return patch, nil
}

func needsNormalizedPatch(input UpdatePackagedFoodInput) bool {
	return input.Brand != nil ||
		input.ProductName != nil ||
		input.DisplayName != nil ||
		input.SearchText != nil ||
		input.ProductFamilyKey != nil ||
		input.SpecText != nil ||
		input.Barcode != nil ||
		input.FlavorText != nil ||
		input.PackageCategory != nil ||
		input.OCRRawText != nil ||
		input.NetWeightG != nil ||
		input.NetContentValue != nil ||
		input.NetContentUnit != nil ||
		input.UnitCount != nil ||
		input.UnitContentValue != nil ||
		input.UnitContentUnit != nil ||
		input.ReviewStatus != nil
}

func setString(patch repo.PackagedFoodPatch, key string, value *string) {
	if value == nil {
		return
	}
	patch[key] = strings.TrimSpace(*value)
}

func setNullableString(patch repo.PackagedFoodPatch, key string, value *string) {
	if value == nil {
		return
	}
	patch[key] = nullableString(*value)
}

func setFloat(patch repo.PackagedFoodPatch, key string, value *float64) {
	if value == nil {
		return
	}
	patch[key] = *value
}

func setBool(patch repo.PackagedFoodPatch, key string, value *bool) {
	if value == nil {
		return
	}
	patch[key] = *value
}

func nullableString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func effectiveString(value *string, fallback string) string {
	if value == nil {
		return fallback
	}
	return strings.TrimSpace(*value)
}

func effectiveFloat(value *float64, fallback float64) float64 {
	if value == nil {
		return fallback
	}
	return *value
}

func stringPtr(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func floatPtrValue(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func (s *PackagedFoodService) normalizeImages(item *domain.PackagedFood) {
	if s.storage == nil || item == nil {
		return
	}
	item.SourceImageURLs = s.storage.ResolveReferenceURLs("food-images", item.SourceImageURLs)
}
