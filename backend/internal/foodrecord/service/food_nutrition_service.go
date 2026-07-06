package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzerepo "food_link/backend/internal/analyze/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/repo"
	"food_link/backend/internal/taskqueue"
)

type FoodNutritionService struct {
	nutritionRepo              *repo.FoodNutritionRepo
	nutritionLabelVisionClient NutritionLabelVisionClient
	taskRepo                   *analyzerepo.TaskRepo
	taskQueue                  taskqueue.Publisher
	rewards                    PackagedRewardAwarder
}

type NutritionLabelVisionClient interface {
	AnalyzeWithImagesAndTemperature(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, error)
	AnalyzeWithImagesAndTemperatureMeta(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, map[string]any, error)
}

type PackagedRewardAwarder interface {
	AwardPackagedUpload(ctx context.Context, userID, sourceTaskID, packagedFoodID string, meta map[string]any) (map[string]any, error)
}

const (
	packagedFoodIngestMethodUserCaptureOCR = "user_capture_ocr"
	packagedFoodIngestMethodSilentAnalyze  = "analyze_silent_capture"
	packagedProductExtractTaskType         = "packaged_product_extract"
	packagedNutritionLabelTaskType         = "packaged_nutrition_label"
	packagedProductExtractMaxImages        = 3
)

type PackagedFoodInput struct {
	Brand                 string
	ProductName           string
	DisplayName           string
	SearchText            string
	ProductFamilyKey      string
	SpecText              string
	Barcode               string
	FlavorText            string
	PackageCategory       string
	IngredientsText       string
	SourceImageURLs       []string
	OCRRawText            string
	NutritionBasisUnit    string
	EnergyUnitRaw         string
	RawLabelPayload       map[string]any
	ConversionStatus      string
	ExtractConfidence     float64
	FieldConfidence       map[string]any
	IngestMethod          string
	NetContentValue       float64
	NetContentUnit        string
	UnitCount             float64
	UnitContentValue      float64
	UnitContentUnit       string
	ReviewStatus          string
	NetWeightG            float64
	ServingWeightG        float64
	KcalPer100g           float64
	ProteinPer100g        float64
	CarbsPer100g          float64
	FatPer100g            float64
	FiberPer100g          float64
	SugarPer100g          float64
	SaturatedFatPer100g   float64
	CholesterolMgPer100g  float64
	SodiumMgPer100g       float64
	PotassiumMgPer100g    float64
	CalciumMgPer100g      float64
	IronMgPer100g         float64
	MagnesiumMgPer100g    float64
	ZincMgPer100g         float64
	VitaminARaeMcgPer100g float64
	VitaminCMgPer100g     float64
	VitaminDMcgPer100g    float64
	VitaminEMgPer100g     float64
	VitaminKMcgPer100g    float64
	ThiaminMgPer100g      float64
	RiboflavinMgPer100g   float64
	NiacinMgPer100g       float64
	VitaminB6MgPer100g    float64
	FolateMcgPer100g      float64
	VitaminB12McgPer100g  float64
	SourceURL             string
	Source                string
}

type PackagedLabelNutritionValue struct {
	Value float64 `json:"value,omitempty"`
	Unit  string  `json:"unit,omitempty"`
}

type PackagedLabelNutritionBasis struct {
	Type  string  `json:"type,omitempty"`
	Value float64 `json:"value,omitempty"`
	Unit  string  `json:"unit,omitempty"`
}

type PackagedLabelRawNutrition struct {
	Energy         PackagedLabelNutritionValue `json:"energy,omitempty"`
	Protein        PackagedLabelNutritionValue `json:"protein,omitempty"`
	Carbs          PackagedLabelNutritionValue `json:"carbs,omitempty"`
	Fat            PackagedLabelNutritionValue `json:"fat,omitempty"`
	Fiber          PackagedLabelNutritionValue `json:"fiber,omitempty"`
	Sugar          PackagedLabelNutritionValue `json:"sugar,omitempty"`
	SaturatedFat   PackagedLabelNutritionValue `json:"saturatedFat,omitempty"`
	CholesterolMg  PackagedLabelNutritionValue `json:"cholesterolMg,omitempty"`
	SodiumMg       PackagedLabelNutritionValue `json:"sodiumMg,omitempty"`
	PotassiumMg    PackagedLabelNutritionValue `json:"potassiumMg,omitempty"`
	CalciumMg      PackagedLabelNutritionValue `json:"calciumMg,omitempty"`
	IronMg         PackagedLabelNutritionValue `json:"ironMg,omitempty"`
	MagnesiumMg    PackagedLabelNutritionValue `json:"magnesiumMg,omitempty"`
	ZincMg         PackagedLabelNutritionValue `json:"zincMg,omitempty"`
	VitaminARaeMcg PackagedLabelNutritionValue `json:"vitaminARaeMcg,omitempty"`
	VitaminCMg     PackagedLabelNutritionValue `json:"vitaminCMg,omitempty"`
	VitaminDMcg    PackagedLabelNutritionValue `json:"vitaminDMcg,omitempty"`
	VitaminEMg     PackagedLabelNutritionValue `json:"vitaminEMg,omitempty"`
	VitaminKMcg    PackagedLabelNutritionValue `json:"vitaminKMcg,omitempty"`
	ThiaminMg      PackagedLabelNutritionValue `json:"thiaminMg,omitempty"`
	RiboflavinMg   PackagedLabelNutritionValue `json:"riboflavinMg,omitempty"`
	NiacinMg       PackagedLabelNutritionValue `json:"niacinMg,omitempty"`
	VitaminB6Mg    PackagedLabelNutritionValue `json:"vitaminB6Mg,omitempty"`
	FolateMcg      PackagedLabelNutritionValue `json:"folateMcg,omitempty"`
	VitaminB12Mcg  PackagedLabelNutritionValue `json:"vitaminB12Mcg,omitempty"`
}

type packagedServingNutritionVariant struct {
	Label          string
	ServingWeightG float64
	Count          float64
	Nutrition      map[string]float64
}

var (
	packagedNutritionNumberRE        = regexp.MustCompile(`[-+]?[0-9]+(\.[0-9]+)?`)
	packagedServingWeightInTextRE    = regexp.MustCompile(`(?i)([0-9]+(\.[0-9]+)?)\s*(g|克)`)
	packagedSpecCountServingWeightRE = regexp.MustCompile(`(?i)([0-9]+(\.[0-9]+)?)\s*(支|个|枚|条|包|袋|杯|份)[^0-9]{0,24}(每|单|/)[^0-9]{0,8}([0-9]+(\.[0-9]+)?)\s*(g|克)`)
	packagedNutritionOutputFieldKeys = []string{"calories", "protein", "carbs", "fat", "fiber", "sugar", "saturatedFat", "cholesterolMg", "sodiumMg", "potassiumMg", "calciumMg", "ironMg", "magnesiumMg", "zincMg", "vitaminARaeMcg", "vitaminCMg", "vitaminDMcg", "vitaminEMg", "vitaminKMcg", "thiaminMg", "riboflavinMg", "niacinMg", "vitaminB6Mg", "folateMcg", "vitaminB12Mcg"}
)

type PackagedNutritionLabelResult struct {
	ProductName           string  `json:"product_name,omitempty"`
	Brand                 string  `json:"brand,omitempty"`
	NetWeightG            float64 `json:"net_weight_g,omitempty"`
	ServingWeightG        float64 `json:"serving_weight_g,omitempty"`
	KcalPer100g           float64 `json:"kcal_per_100g,omitempty"`
	ProteinPer100g        float64 `json:"protein_per_100g,omitempty"`
	CarbsPer100g          float64 `json:"carbs_per_100g,omitempty"`
	FatPer100g            float64 `json:"fat_per_100g,omitempty"`
	FiberPer100g          float64 `json:"fiber_per_100g,omitempty"`
	SugarPer100g          float64 `json:"sugar_per_100g,omitempty"`
	SaturatedFatPer100g   float64 `json:"saturated_fat_per_100g,omitempty"`
	CholesterolMgPer100g  float64 `json:"cholesterol_mg_per_100g,omitempty"`
	SodiumMgPer100g       float64 `json:"sodium_mg_per_100g,omitempty"`
	PotassiumMgPer100g    float64 `json:"potassium_mg_per_100g,omitempty"`
	CalciumMgPer100g      float64 `json:"calcium_mg_per_100g,omitempty"`
	IronMgPer100g         float64 `json:"iron_mg_per_100g,omitempty"`
	MagnesiumMgPer100g    float64 `json:"magnesium_mg_per_100g,omitempty"`
	ZincMgPer100g         float64 `json:"zinc_mg_per_100g,omitempty"`
	VitaminARaeMcgPer100g float64 `json:"vitamin_a_rae_mcg_per_100g,omitempty"`
	VitaminCMgPer100g     float64 `json:"vitamin_c_mg_per_100g,omitempty"`
	VitaminDMcgPer100g    float64 `json:"vitamin_d_mcg_per_100g,omitempty"`
	VitaminEMgPer100g     float64 `json:"vitamin_e_mg_per_100g,omitempty"`
	VitaminKMcgPer100g    float64 `json:"vitamin_k_mcg_per_100g,omitempty"`
	ThiaminMgPer100g      float64 `json:"thiamin_mg_per_100g,omitempty"`
	RiboflavinMgPer100g   float64 `json:"riboflavin_mg_per_100g,omitempty"`
	NiacinMgPer100g       float64 `json:"niacin_mg_per_100g,omitempty"`
	VitaminB6MgPer100g    float64 `json:"vitamin_b6_mg_per_100g,omitempty"`
	FolateMcgPer100g      float64 `json:"folate_mcg_per_100g,omitempty"`
	VitaminB12McgPer100g  float64 `json:"vitamin_b12_mcg_per_100g,omitempty"`
	Confidence            float64 `json:"confidence,omitempty"`
	RawText               string  `json:"raw_text,omitempty"`
}

type PackagedAutoIngestResult struct {
	Status          string   `json:"status,omitempty"`
	Reason          string   `json:"reason,omitempty"`
	UpsertAction    string   `json:"upsert_action,omitempty"`
	PackagedFoodID  string   `json:"packaged_food_id,omitempty"`
	MissingFields   []string `json:"missing_fields,omitempty"`
	ConflictReasons []string `json:"conflict_reasons,omitempty"`
}

type PackagedProductExtractResult struct {
	Brand                string                      `json:"brand,omitempty"`
	ProductName          string                      `json:"product_name,omitempty"`
	DisplayName          string                      `json:"display_name,omitempty"`
	SearchText           string                      `json:"search_text,omitempty"`
	ProductFamilyKey     string                      `json:"product_family_key,omitempty"`
	FlavorText           string                      `json:"flavor_text,omitempty"`
	PackageCategory      string                      `json:"package_category,omitempty"`
	NetContentValue      float64                     `json:"net_content_value,omitempty"`
	NetContentUnit       string                      `json:"net_content_unit,omitempty"`
	UnitCount            float64                     `json:"unit_count,omitempty"`
	UnitContentValue     float64                     `json:"unit_content_value,omitempty"`
	UnitContentUnit      string                      `json:"unit_content_unit,omitempty"`
	ReviewStatus         string                      `json:"review_status,omitempty"`
	NetWeightG           float64                     `json:"net_weight_g,omitempty"`
	ServingWeightG       float64                     `json:"serving_weight_g,omitempty"`
	SpecText             string                      `json:"spec_text,omitempty"`
	Barcode              string                      `json:"barcode,omitempty"`
	IngredientsText      string                      `json:"ingredients_text,omitempty"`
	UnitNutritionPer100g map[string]any              `json:"unit_nutrition_per_100g,omitempty"`
	NutritionBasisUnit   string                      `json:"nutrition_basis_unit,omitempty"`
	EnergyUnitRaw        string                      `json:"energy_unit_raw,omitempty"`
	RawNutritionBasis    PackagedLabelNutritionBasis `json:"raw_nutrition_basis,omitempty"`
	RawNutritionPerBasis PackagedLabelRawNutrition   `json:"raw_nutrition_per_basis,omitempty"`
	RawLabelPayload      map[string]any              `json:"raw_label_payload,omitempty"`
	ConversionStatus     string                      `json:"conversion_status,omitempty"`
	FieldConfidence      map[string]any              `json:"field_confidence,omitempty"`
	ExtractConfidence    float64                     `json:"extract_confidence,omitempty"`
	NeedsMoreImages      []string                    `json:"needs_more_images,omitempty"`
	MissingFields        []string                    `json:"missing_fields,omitempty"`
	NeedsUserConfirmation bool                       `json:"needs_user_confirmation,omitempty"`
	ConfirmationReasons   []string                   `json:"confirmation_reasons,omitempty"`
	ConfirmationFields    []string                   `json:"confirmation_fields,omitempty"`
	AutoIngestResult     PackagedAutoIngestResult    `json:"auto_ingest_result,omitempty"`
	PackagedFoodID       string                      `json:"packaged_food_id,omitempty"`
	OCRRawText           string                      `json:"ocr_raw_text,omitempty"`
	SourceImageURLs      []string                    `json:"source_image_urls,omitempty"`
}

type SubmitPackagedProductExtractInput struct {
	ImageURLs          []string
	SourceTaskID       string
	RecognizedNameHint string
}

func NewFoodNutritionService(nutritionRepo *repo.FoodNutritionRepo) *FoodNutritionService {
	return &FoodNutritionService{nutritionRepo: nutritionRepo}
}

func (s *FoodNutritionService) ConfigureNutritionLabelVisionClient(client NutritionLabelVisionClient) {
	s.nutritionLabelVisionClient = client
}

func (s *FoodNutritionService) ConfigureAsyncTasks(taskRepo *analyzerepo.TaskRepo, queue taskqueue.Publisher) {
	s.taskRepo = taskRepo
	s.taskQueue = queue
}

func (s *FoodNutritionService) ConfigureRewardAwarder(awarder PackagedRewardAwarder) {
	s.rewards = awarder
}

func (s *FoodNutritionService) AwardPackagedUpload(ctx context.Context, userID, sourceTaskID, packagedFoodID string, meta map[string]any) (map[string]any, error) {
	if s.rewards == nil {
		return nil, nil
	}
	return s.rewards.AwardPackagedUpload(ctx, userID, sourceTaskID, packagedFoodID, meta)
}

func (s *FoodNutritionService) Search(ctx context.Context, query string, limit int) ([]map[string]any, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "query 不能为空", HTTPStatus: 400}
	}
	foods, err := s.nutritionRepo.Search(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	if len(foods) == 0 {
		_ = s.nutritionRepo.LogUnresolved(ctx, q)
	}

	qLower := strings.ToLower(q)
	items := make([]map[string]any, 0, len(foods))
	for _, f := range foods {
		matchSource := "canonical"
		if !strings.Contains(strings.ToLower(f.CanonicalName), qLower) {
			matchSource = "alias"
		}
		items = append(items, map[string]any{
			"food_id":        f.ID,
			"canonical_name": f.CanonicalName,
			"match_source":   matchSource,
			"score":          0,
			"source":         "nutrition_library",
			"unit_nutrition_per_100g": map[string]any{
				"calories": f.KcalPer100g,
				"protein":  f.ProteinPer100g,
				"carbs":    f.CarbsPer100g,
				"fat":      f.FatPer100g,
				"fiber":    f.FiberPer100g,
				"sugar":    f.SugarPer100g,
				"sodiumMg": f.SodiumMgPer100g,
			},
		})
	}
	return items, nil
}

func (s *FoodNutritionService) GetUnresolvedTop(ctx context.Context, limit int) ([]domain.FoodUnresolvedLog, error) {
	return s.nutritionRepo.GetUnresolvedTop(ctx, limit)
}

func (s *FoodNutritionService) CreatePackagedFood(ctx context.Context, input PackagedFoodInput) (*domain.PackagedFood, error) {
	item, _, err := s.CreatePackagedFoodWithAction(ctx, input)
	return item, err
}

func (s *FoodNutritionService) CreatePackagedFoodWithAction(ctx context.Context, input PackagedFoodInput) (*domain.PackagedFood, string, error) {
	productName := strings.TrimSpace(input.ProductName)
	if productName == "" {
		return nil, "", &commonerrors.AppError{Code: 10002, Message: "零食名称不能为空", HTTPStatus: 400}
	}
	input.SourceImageURLs = normalizeStringSlice(input.SourceImageURLs)
	if len(input.SourceImageURLs) == 0 {
		return nil, "", &commonerrors.AppError{Code: 10002, Message: "请至少上传一张包装图片", HTTPStatus: 400}
	}
	if input.ServingWeightG <= 0 && input.NetWeightG > 0 {
		input.ServingWeightG = input.NetWeightG
	} else if input.ServingWeightG <= 0 && input.NetContentValue > 0 && strings.EqualFold(strings.TrimSpace(input.NetContentUnit), "g") {
		input.ServingWeightG = input.NetContentValue
	}
	if input.KcalPer100g <= 0 && input.ProteinPer100g <= 0 && input.CarbsPer100g <= 0 && input.FatPer100g <= 0 {
		return nil, "", &commonerrors.AppError{Code: 10002, Message: "请至少填写热量或三大营养素", HTTPStatus: 400}
	}
	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = "user_submitted"
	}
	return s.nutritionRepo.UpsertPackagedFoodWithAction(ctx, repo.PackagedFoodInput{
		Brand:                 input.Brand,
		ProductName:           productName,
		DisplayName:           input.DisplayName,
		SearchText:            input.SearchText,
		ProductFamilyKey:      input.ProductFamilyKey,
		SpecText:              input.SpecText,
		Barcode:               input.Barcode,
		FlavorText:            input.FlavorText,
		PackageCategory:       input.PackageCategory,
		IngredientsText:       input.IngredientsText,
		SourceImageURLs:       input.SourceImageURLs,
		OCRRawText:            input.OCRRawText,
		NutritionBasisUnit:    input.NutritionBasisUnit,
		EnergyUnitRaw:         input.EnergyUnitRaw,
		RawLabelPayload:       input.RawLabelPayload,
		ConversionStatus:      input.ConversionStatus,
		ExtractConfidence:     input.ExtractConfidence,
		FieldConfidence:       input.FieldConfidence,
		IngestMethod:          input.IngestMethod,
		NetContentValue:       input.NetContentValue,
		NetContentUnit:        input.NetContentUnit,
		UnitCount:             input.UnitCount,
		UnitContentValue:      input.UnitContentValue,
		UnitContentUnit:       input.UnitContentUnit,
		ReviewStatus:          input.ReviewStatus,
		NetWeightG:            input.NetWeightG,
		ServingWeightG:        input.ServingWeightG,
		KcalPer100g:           input.KcalPer100g,
		ProteinPer100g:        input.ProteinPer100g,
		CarbsPer100g:          input.CarbsPer100g,
		FatPer100g:            input.FatPer100g,
		FiberPer100g:          input.FiberPer100g,
		SugarPer100g:          input.SugarPer100g,
		SaturatedFatPer100g:   input.SaturatedFatPer100g,
		CholesterolMgPer100g:  input.CholesterolMgPer100g,
		SodiumMgPer100g:       input.SodiumMgPer100g,
		PotassiumMgPer100g:    input.PotassiumMgPer100g,
		CalciumMgPer100g:      input.CalciumMgPer100g,
		IronMgPer100g:         input.IronMgPer100g,
		MagnesiumMgPer100g:    input.MagnesiumMgPer100g,
		ZincMgPer100g:         input.ZincMgPer100g,
		VitaminARaeMcgPer100g: input.VitaminARaeMcgPer100g,
		VitaminCMgPer100g:     input.VitaminCMgPer100g,
		VitaminDMcgPer100g:    input.VitaminDMcgPer100g,
		VitaminEMgPer100g:     input.VitaminEMgPer100g,
		VitaminKMcgPer100g:    input.VitaminKMcgPer100g,
		ThiaminMgPer100g:      input.ThiaminMgPer100g,
		RiboflavinMgPer100g:   input.RiboflavinMgPer100g,
		NiacinMgPer100g:       input.NiacinMgPer100g,
		VitaminB6MgPer100g:    input.VitaminB6MgPer100g,
		FolateMcgPer100g:      input.FolateMcgPer100g,
		VitaminB12McgPer100g:  input.VitaminB12McgPer100g,
		SourceURL:             input.SourceURL,
		Source:                source,
	})
}

func (s *FoodNutritionService) RecognizePackagedNutritionLabel(ctx context.Context, imageURL string) (*PackagedNutritionLabelResult, error) {
	imageURL = strings.TrimSpace(imageURL)
	if imageURL == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "营养成分表图片不能为空", HTTPStatus: 400}
	}
	if s.nutritionLabelVisionClient == nil {
		return nil, &commonerrors.AppError{Code: 10000, Message: "营养成分表识别服务未配置", HTTPStatus: 500}
	}
	result, err := s.nutritionLabelVisionClient.AnalyzeWithImagesAndTemperature(ctx, buildNutritionLabelPrompt(), []string{imageURL}, 0.1)
	if err != nil {
		return nil, fmt.Errorf("识别营养成分表失败: %w", err)
	}
	parsed := parseNutritionLabelResult(result)
	if parsed.KcalPer100g <= 0 && parsed.ProteinPer100g <= 0 && parsed.CarbsPer100g <= 0 && parsed.FatPer100g <= 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "未能从图片中识别出有效营养成分，请拍清楚营养成分表后重试", HTTPStatus: 400}
	}
	return parsed, nil
}

func (s *FoodNutritionService) ExtractPackagedProduct(ctx context.Context, imageURLs []string, recognizedNameHint string) (*PackagedProductExtractResult, error) {
	result, _, err := s.ExtractPackagedProductWithMeta(ctx, imageURLs, recognizedNameHint)
	return result, err
}

// ExtractMetadata 记录一次包装食品识别的原始元数据（耗时、模型、token 等）。
type ExtractMetadata struct {
	DurationMs   int64          `json:"duration_ms"`
	Model        string         `json:"model,omitempty"`
	ResponseID   string         `json:"response_id,omitempty"`
	InputTokens  int64          `json:"input_tokens,omitempty"`
	OutputTokens int64          `json:"output_tokens,omitempty"`
	TotalTokens  int64          `json:"total_tokens,omitempty"`
	RawMeta      map[string]any `json:"raw_meta,omitempty"`
}

func (s *FoodNutritionService) ExtractPackagedProductWithMeta(ctx context.Context, imageURLs []string, recognizedNameHint string) (*PackagedProductExtractResult, *ExtractMetadata, error) {
	imageURLs = normalizeStringSlice(imageURLs)
	if len(imageURLs) == 0 {
		return nil, nil, &commonerrors.AppError{Code: 10002, Message: "包装图片不能为空", HTTPStatus: 400}
	}
	if s.nutritionLabelVisionClient == nil {
		return nil, nil, &commonerrors.AppError{Code: 10000, Message: "预包装商品识别服务未配置", HTTPStatus: 500}
	}
	start := time.Now()
	raw, meta, err := s.nutritionLabelVisionClient.AnalyzeWithImagesAndTemperatureMeta(ctx, buildPackagedProductExtractPrompt(recognizedNameHint, len(imageURLs)), imageURLs, 0.1)
	durationMs := time.Since(start).Milliseconds()
	if err != nil {
		return nil, nil, fmt.Errorf("识别预包装商品失败: %w", err)
	}
	parsed := parsePackagedProductExtractResult(raw, imageURLs)
	enrichPackagedProductExtractResult(parsed)

	extractMeta := &ExtractMetadata{
		DurationMs: durationMs,
		RawMeta:    meta,
	}
	if meta != nil {
		extractMeta.Model = stringFromAny(meta["model"])
		extractMeta.ResponseID = stringFromAny(meta["response_id"])
		extractMeta.InputTokens = int64FromAny(meta["input_tokens"], meta["prompt_tokens"])
		extractMeta.OutputTokens = int64FromAny(meta["output_tokens"], meta["completion_tokens"])
		extractMeta.TotalTokens = int64FromAny(meta["total_tokens"])
		if extractMeta.TotalTokens == 0 {
			extractMeta.TotalTokens = extractMeta.InputTokens + extractMeta.OutputTokens
		}
	}
	return parsed, extractMeta, nil
}

func (s *FoodNutritionService) SubmitPackagedNutritionLabelTask(ctx context.Context, userID, imageURL string) (string, error) {
	imageURL = strings.TrimSpace(imageURL)
	if imageURL == "" {
		return "", &commonerrors.AppError{Code: 10002, Message: "营养成分表图片不能为空", HTTPStatus: 400}
	}
	return s.SubmitPackagedProductExtractTask(ctx, userID, SubmitPackagedProductExtractInput{
		ImageURLs: []string{imageURL},
	})
}

func (s *FoodNutritionService) SubmitPackagedProductExtractTask(ctx context.Context, userID string, input SubmitPackagedProductExtractInput) (string, error) {
	imageURLs := normalizeStringSlice(input.ImageURLs)
	if len(imageURLs) == 0 {
		return "", &commonerrors.AppError{Code: 10002, Message: "包装图片不能为空", HTTPStatus: 400}
	}
	if len(imageURLs) > packagedProductExtractMaxImages {
		return "", &commonerrors.AppError{Code: 10002, Message: "同一种商品最多上传 3 张包装图片", HTTPStatus: 400}
	}
	if s.taskRepo == nil || s.taskQueue == nil {
		return "", &commonerrors.AppError{Code: 10000, Message: "预包装商品异步识别服务未配置", HTTPStatus: 500}
	}
	primaryImageURL := imageURLs[0]
	task := &analyzedomain.AnalysisTask{
		UserID:     userID,
		TaskType:   packagedProductExtractTaskType,
		Status:     "pending",
		ImageURL:   &primaryImageURL,
		ImagePaths: imageURLs,
		Payload: map[string]any{
			"image_url":            primaryImageURL,
			"image_urls":           imageURLs,
			"purpose":              packagedProductExtractTaskType,
			"recognized_name_hint": strings.TrimSpace(input.RecognizedNameHint),
			"source_task_id":       strings.TrimSpace(input.SourceTaskID),
		},
	}
	if err := s.taskRepo.CreateTask(ctx, task); err != nil {
		return "", err
	}
	publishCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := s.taskQueue.PublishTask(publishCtx, taskqueue.TaskMessage{TaskID: task.ID, TaskType: task.TaskType}); err != nil {
		_, _ = s.taskRepo.FailTask(context.Background(), task.ID, "packaged product extract task enqueue failed")
		return "", err
	}
	return task.ID, nil
}

func buildNutritionLabelPrompt() string {
	return `你是食品包装营养成分表 OCR 和结构化提取助手。请只读取图片里真实出现的包装文字和营养成分表，不要编造。
返回严格 JSON，不要 Markdown，不要解释。字段含义都是“每100g”的数值；如果图片写的是每份/每包装，请结合份量、净含量、每份重量换算成每100g。无法确定的字段填 0。
{
  "brand": "",
  "product_name": "",
  "net_weight_g": 0,
  "serving_weight_g": 0,
  "kcal_per_100g": 0,
  "protein_per_100g": 0,
  "carbs_per_100g": 0,
  "fat_per_100g": 0,
  "fiber_per_100g": 0,
  "sugar_per_100g": 0,
  "saturated_fat_per_100g": 0,
  "cholesterol_mg_per_100g": 0,
  "sodium_mg_per_100g": 0,
  "potassium_mg_per_100g": 0,
  "calcium_mg_per_100g": 0,
  "iron_mg_per_100g": 0,
  "magnesium_mg_per_100g": 0,
  "zinc_mg_per_100g": 0,
  "vitamin_a_rae_mcg_per_100g": 0,
  "vitamin_c_mg_per_100g": 0,
  "vitamin_d_mcg_per_100g": 0,
  "vitamin_e_mg_per_100g": 0,
  "vitamin_k_mcg_per_100g": 0,
  "thiamin_mg_per_100g": 0,
  "riboflavin_mg_per_100g": 0,
  "niacin_mg_per_100g": 0,
  "vitamin_b6_mg_per_100g": 0,
  "folate_mcg_per_100g": 0,
  "vitamin_b12_mcg_per_100g": 0,
  "confidence": 0,
  "raw_text": ""
}`
}

func buildPackagedProductExtractPrompt(recognizedNameHint string, imageCount int) string {
	hint := strings.TrimSpace(recognizedNameHint)
	if hint == "" {
		hint = "无"
	}
	imageContext := buildPackagedImageCountContext(imageCount)
	return `你是预包装食品 OCR 和结构化提取助手。现在会给你 1-3 张同一商品图片，可能包括包装正面、营养成分表、净含量、规格、配料表。
` + imageContext + `
这些图片必须被视为同一个商品的一组照片，是同一包装在不同角度、不同折叠状态或大包装局部的补充信息。不要把多张图拆成多个商品，也不要因为多图而输出多个任务。
如果包装较大、弯曲、反光或一张图拍不全，请综合 1-3 张图片互相补全品牌、品名、净含量/规格和营养成分表；若不同图片信息冲突，只记录冲突，不要编造。
请只提取图片中真实可见的信息，不要编造，不要根据常识补品牌和口味。
不要在模型里做自由数学换算。你只负责提取标签上的原始数值、单位、口径（每100g/每100ml/每份）和份量信息。
如果同一大包装是组合装/多口味，且营养成分表有两列或以上，请不要丢弃任一列：在 raw_label_payload 中按“口味/子商品名 + 每份重量”分别记录每列每份营养，例如“浓郁黑巧克力单支营养（42g）”。raw_nutrition_per_basis 仍只在标签只有一套营养表时填写。
营养成分表、净含量/规格、品名是核心信息；配料表和条码是可选增强信息，缺失时不要放入 needs_more_images，也不要降低整体置信度。
只有缺少营养成分表、净含量/规格、品名等核心信息，导致无法确定商品营养或规格时，才在 needs_more_images 里返回对应原因（如 ["nutrition_label"]、["net_weight"]、["front_package"]）。
可参考的已识别名称提示：` + hint + `
返回严格 JSON，不要 Markdown：
{
  "brand": "",
  "product_name": "",
  "flavor_text": "",
  "package_category": "",
  "net_content_value": 0,
  "net_content_unit": "",
  "unit_count": 0,
  "unit_content_value": 0,
  "unit_content_unit": "",
  "net_weight_g": 0,
  "serving_weight_g": 0,
  "spec_text": "",
  "barcode": "",
  "ingredients_text": "",
  "nutrition_basis_unit": "",
  "energy_unit_raw": "",
  "raw_nutrition_basis": {
    "type": "",
    "value": 0,
    "unit": ""
  },
  "raw_nutrition_per_basis": {
    "energy": { "value": 0, "unit": "" },
    "protein": { "value": 0, "unit": "" },
    "carbs": { "value": 0, "unit": "" },
    "fat": { "value": 0, "unit": "" },
    "fiber": { "value": 0, "unit": "" },
    "sugar": { "value": 0, "unit": "" },
    "saturatedFat": { "value": 0, "unit": "" },
    "cholesterolMg": { "value": 0, "unit": "" },
    "sodiumMg": { "value": 0, "unit": "" },
    "potassiumMg": { "value": 0, "unit": "" },
    "calciumMg": { "value": 0, "unit": "" },
    "ironMg": { "value": 0, "unit": "" },
    "magnesiumMg": { "value": 0, "unit": "" },
    "zincMg": { "value": 0, "unit": "" },
    "vitaminARaeMcg": { "value": 0, "unit": "" },
    "vitaminCMg": { "value": 0, "unit": "" },
    "vitaminDMcg": { "value": 0, "unit": "" },
    "vitaminEMg": { "value": 0, "unit": "" },
    "vitaminKMcg": { "value": 0, "unit": "" },
    "thiaminMg": { "value": 0, "unit": "" },
    "riboflavinMg": { "value": 0, "unit": "" },
    "niacinMg": { "value": 0, "unit": "" },
    "vitaminB6Mg": { "value": 0, "unit": "" },
    "folateMcg": { "value": 0, "unit": "" },
    "vitaminB12Mcg": { "value": 0, "unit": "" }
  },
  "unit_nutrition_per_100g": {
    "calories": 0,
    "protein": 0,
    "carbs": 0,
    "fat": 0,
    "fiber": 0,
    "sugar": 0,
    "saturatedFat": 0,
    "cholesterolMg": 0,
    "sodiumMg": 0,
    "potassiumMg": 0,
    "calciumMg": 0,
    "ironMg": 0,
    "magnesiumMg": 0,
    "zincMg": 0,
    "vitaminARaeMcg": 0,
    "vitaminCMg": 0,
    "vitaminDMcg": 0,
    "vitaminEMg": 0,
    "vitaminKMcg": 0,
    "thiaminMg": 0,
    "riboflavinMg": 0,
    "niacinMg": 0,
    "vitaminB6Mg": 0,
    "folateMcg": 0,
    "vitaminB12Mcg": 0
  },
  "field_confidence": {
    "product_name": 0,
    "spec_text": 0,
    "nutrition": 0,
    "brand": 0,
    "ingredients_text": 0
  },
  "extract_confidence": 0,
  "needs_more_images": [],
  "missing_fields": [],
  "ocr_raw_text": "",
  "raw_label_payload": {}
}`
}

func buildPackagedImageCountContext(imageCount int) string {
	switch imageCount {
	case 1:
		return "本次实际只有 1 张图片：这通常表示用户认为品名、净含量/规格和营养成分表都在同一张图里。请尽量从这一张里提取可见信息；不要因为没有第二张图片就默认需要补图，只有核心字段确实看不清时才返回 needs_more_images。"
	case 2:
		return "本次实际有 2 张图片：通常是包装正面/净含量 + 营养成分表。请把两张图合并理解为同一商品的互补信息，不要分别识别为两个商品。"
	case 3:
		return "本次实际有 3 张图片：通常是包装较大、弯曲或文字较小，第三张用于补拍局部。请把三张图合并理解为同一商品的互补信息，优先用更清晰的局部图补全字段。"
	default:
		return "本次实际图片数量不固定，但所有图片都应被视为同一商品的一组照片。"
	}
}

func parseNutritionLabelResult(raw map[string]any) *PackagedNutritionLabelResult {
	return &PackagedNutritionLabelResult{
		ProductName:           stringFromAny(raw["product_name"], raw["productName"], raw["name"]),
		Brand:                 stringFromAny(raw["brand"]),
		NetWeightG:            numberFromAny(raw["net_weight_g"], raw["netWeightG"], raw["net_weight"]),
		ServingWeightG:        numberFromAny(raw["serving_weight_g"], raw["servingWeightG"], raw["serving_weight"]),
		KcalPer100g:           numberFromAny(raw["kcal_per_100g"], raw["calories_per_100g"], raw["calories"]),
		ProteinPer100g:        numberFromAny(raw["protein_per_100g"], raw["protein"]),
		CarbsPer100g:          numberFromAny(raw["carbs_per_100g"], raw["carbohydrate_per_100g"], raw["carbohydrates_per_100g"], raw["carbs"]),
		FatPer100g:            numberFromAny(raw["fat_per_100g"], raw["fat"]),
		FiberPer100g:          numberFromAny(raw["fiber_per_100g"], raw["dietary_fiber_per_100g"], raw["fiber"]),
		SugarPer100g:          numberFromAny(raw["sugar_per_100g"], raw["sugar"]),
		SaturatedFatPer100g:   numberFromAny(raw["saturated_fat_per_100g"], raw["saturated_fat"]),
		CholesterolMgPer100g:  numberFromAny(raw["cholesterol_mg_per_100g"], raw["cholesterol_mg"]),
		SodiumMgPer100g:       numberFromAny(raw["sodium_mg_per_100g"], raw["sodium_mg"], raw["sodium"]),
		PotassiumMgPer100g:    numberFromAny(raw["potassium_mg_per_100g"], raw["potassium_mg"]),
		CalciumMgPer100g:      numberFromAny(raw["calcium_mg_per_100g"], raw["calcium_mg"]),
		IronMgPer100g:         numberFromAny(raw["iron_mg_per_100g"], raw["iron_mg"]),
		MagnesiumMgPer100g:    numberFromAny(raw["magnesium_mg_per_100g"], raw["magnesium_mg"]),
		ZincMgPer100g:         numberFromAny(raw["zinc_mg_per_100g"], raw["zinc_mg"]),
		VitaminARaeMcgPer100g: numberFromAny(raw["vitamin_a_rae_mcg_per_100g"], raw["vitamin_a_mcg"]),
		VitaminCMgPer100g:     numberFromAny(raw["vitamin_c_mg_per_100g"], raw["vitamin_c_mg"]),
		VitaminDMcgPer100g:    numberFromAny(raw["vitamin_d_mcg_per_100g"], raw["vitamin_d_mcg"]),
		VitaminEMgPer100g:     numberFromAny(raw["vitamin_e_mg_per_100g"], raw["vitamin_e_mg"]),
		VitaminKMcgPer100g:    numberFromAny(raw["vitamin_k_mcg_per_100g"], raw["vitamin_k_mcg"]),
		ThiaminMgPer100g:      numberFromAny(raw["thiamin_mg_per_100g"], raw["vitamin_b1_mg"]),
		RiboflavinMgPer100g:   numberFromAny(raw["riboflavin_mg_per_100g"], raw["vitamin_b2_mg"]),
		NiacinMgPer100g:       numberFromAny(raw["niacin_mg_per_100g"], raw["vitamin_b3_mg"]),
		VitaminB6MgPer100g:    numberFromAny(raw["vitamin_b6_mg_per_100g"], raw["vitamin_b6_mg"]),
		FolateMcgPer100g:      numberFromAny(raw["folate_mcg_per_100g"], raw["folate_mcg"]),
		VitaminB12McgPer100g:  numberFromAny(raw["vitamin_b12_mcg_per_100g"], raw["vitamin_b12_mcg"]),
		Confidence:            numberFromAny(raw["confidence"]),
		RawText:               stringFromAny(raw["raw_text"], raw["rawText"], raw["ocr_text"]),
	}
}

func parsePackagedProductExtractResult(raw map[string]any, imageURLs []string) *PackagedProductExtractResult {
	unit := mapFromAny(raw["unit_nutrition_per_100g"])
	fieldConfidence := mapFromAny(raw["field_confidence"])
	result := &PackagedProductExtractResult{
		Brand:                stringFromAny(raw["brand"]),
		ProductName:          stringFromAny(raw["product_name"], raw["productName"], raw["name"]),
		DisplayName:          stringFromAny(raw["display_name"], raw["displayName"]),
		SearchText:           stringFromAny(raw["search_text"], raw["searchText"]),
		ProductFamilyKey:     stringFromAny(raw["product_family_key"], raw["productFamilyKey"]),
		FlavorText:           stringFromAny(raw["flavor_text"], raw["flavorText"]),
		PackageCategory:      stringFromAny(raw["package_category"], raw["packageCategory"]),
		NetContentValue:      numberFromAny(raw["net_content_value"], raw["netContentValue"]),
		NetContentUnit:       strings.ToLower(stringFromAny(raw["net_content_unit"], raw["netContentUnit"])),
		UnitCount:            numberFromAny(raw["unit_count"], raw["unitCount"]),
		UnitContentValue:     numberFromAny(raw["unit_content_value"], raw["unitContentValue"]),
		UnitContentUnit:      strings.ToLower(stringFromAny(raw["unit_content_unit"], raw["unitContentUnit"])),
		ReviewStatus:         stringFromAny(raw["review_status"], raw["reviewStatus"]),
		NetWeightG:           numberFromAny(raw["net_weight_g"], raw["netWeightG"]),
		ServingWeightG:       numberFromAny(raw["serving_weight_g"], raw["servingWeightG"]),
		SpecText:             stringFromAny(raw["spec_text"], raw["specText"]),
		Barcode:              stringFromAny(raw["barcode"]),
		IngredientsText:      stringFromAny(raw["ingredients_text"], raw["ingredientsText"]),
		UnitNutritionPer100g: normalizeNutritionUnitMap(unit),
		NutritionBasisUnit:   strings.ToLower(stringFromAny(raw["nutrition_basis_unit"])),
		EnergyUnitRaw:        strings.ToLower(stringFromAny(raw["energy_unit_raw"])),
		RawNutritionBasis:    parseRawNutritionBasis(raw["raw_nutrition_basis"]),
		RawNutritionPerBasis: parseRawNutritionValues(raw["raw_nutrition_per_basis"]),
		RawLabelPayload:      mapFromAny(raw["raw_label_payload"]),
		ConversionStatus:     stringFromAny(raw["conversion_status"]),
		FieldConfidence:      normalizeConfidenceMap(fieldConfidence),
		ExtractConfidence:    numberFromAny(raw["extract_confidence"], raw["confidence"]),
		NeedsMoreImages:      stringSliceFromAny(raw["needs_more_images"]),
		MissingFields:        stringSliceFromAny(raw["missing_fields"]),
		OCRRawText:           stringFromAny(raw["ocr_raw_text"], raw["raw_text"], raw["rawText"]),
		SourceImageURLs:      imageURLs,
	}
	if result.UnitNutritionPer100g == nil {
		result.UnitNutritionPer100g = map[string]any{}
	}
	if result.RawLabelPayload == nil {
		result.RawLabelPayload = map[string]any{}
	}
	if result.FieldConfidence == nil {
		result.FieldConfidence = map[string]any{}
	}
	return result
}

func enrichPackagedProductExtractResult(result *PackagedProductExtractResult) {
	if result == nil {
		return
	}
	missingFields := make([]string, 0, len(result.MissingFields))
	seen := map[string]bool{}
	addMissing := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		missingFields = append(missingFields, value)
	}
	for _, field := range result.MissingFields {
		addMissing(field)
	}
	if strings.TrimSpace(result.ProductName) == "" {
		addMissing("product_name")
	}
	if result.NetWeightG <= 0 && result.NetContentValue <= 0 {
		addMissing("net_weight_g")
	}
	convertPackagedNutrition(result)
	normalized := repo.PackagedProductNormalizer{}.Normalize(repo.PackagedProductNormalizeInput{
		Brand:            result.Brand,
		ProductName:      result.ProductName,
		DisplayName:      result.DisplayName,
		SearchText:       result.SearchText,
		ProductFamilyKey: result.ProductFamilyKey,
		FlavorText:       result.FlavorText,
		SpecText:         result.SpecText,
		Barcode:          result.Barcode,
		PackageCategory:  result.PackageCategory,
		OCRRawText:       result.OCRRawText,
		NetWeightG:       result.NetWeightG,
		NetContentValue:  result.NetContentValue,
		NetContentUnit:   result.NetContentUnit,
		UnitCount:        result.UnitCount,
		UnitContentValue: result.UnitContentValue,
		UnitContentUnit:  result.UnitContentUnit,
		ReviewStatus:     result.ReviewStatus,
	})
	result.DisplayName = normalized.DisplayName
	result.SearchText = normalized.SearchText
	result.ProductFamilyKey = normalized.ProductFamilyKey
	result.NetWeightG = normalized.NetWeightG
	result.NetContentValue = normalized.NetContentValue
	result.NetContentUnit = normalized.NetContentUnit
	result.UnitCount = normalized.UnitCount
	result.UnitContentValue = normalized.UnitContentValue
	result.UnitContentUnit = normalized.UnitContentUnit
	result.ReviewStatus = normalized.ReviewStatus
	result.NeedsMoreImages = normalizeStringSlice(result.NeedsMoreImages)
	result.MissingFields = missingFields
	result.ConfirmationReasons, result.ConfirmationFields = determinePackagedConfirmation(result)
	result.NeedsUserConfirmation = len(result.ConfirmationReasons) > 0
}

func stringFromAny(values ...any) string {
	for _, value := range values {
		text := strings.TrimSpace(fmt.Sprintf("%v", value))
		if text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func int64FromAny(values ...any) int64 {
	for _, value := range values {
		switch v := value.(type) {
		case int:
			return int64(v)
		case int8:
			return int64(v)
		case int16:
			return int64(v)
		case int32:
			return int64(v)
		case int64:
			return v
		case uint:
			return int64(v)
		case uint8:
			return int64(v)
		case uint16:
			return int64(v)
		case uint32:
			return int64(v)
		case uint64:
			return int64(v)
		case float32:
			return int64(v)
		case float64:
			return int64(v)
		case string:
			if n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil {
				return n
			}
		}
	}
	return 0
}

func stringSliceFromAny(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		if typed, typedOK := value.([]string); typedOK {
			return normalizeStringSlice(typed)
		}
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		text := strings.TrimSpace(fmt.Sprintf("%v", item))
		if text == "" || text == "<nil>" {
			continue
		}
		out = append(out, text)
	}
	return normalizeStringSlice(out)
}

func mapFromAny(value any) map[string]any {
	if value == nil {
		return nil
	}
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	if typed, ok := value.(map[string]interface{}); ok {
		return typed
	}
	return nil
}

func normalizeConfidenceMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return map[string]any{}
	}
	out := map[string]any{}
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		score := numberFromAny(value)
		if score < 0 {
			score = 0
		}
		if score > 1 {
			score = 1
		}
		out[key] = score
	}
	return out
}

func normalizeNutritionUnitMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return map[string]any{}
	}
	keys := []string{
		"calories", "protein", "carbs", "fat", "fiber", "sugar", "saturatedFat",
		"cholesterolMg", "sodiumMg", "potassiumMg", "calciumMg", "ironMg",
		"magnesiumMg", "zincMg", "vitaminARaeMcg", "vitaminCMg", "vitaminDMcg",
		"vitaminEMg", "vitaminKMcg", "thiaminMg", "riboflavinMg", "niacinMg",
		"vitaminB6Mg", "folateMcg", "vitaminB12Mcg",
	}
	out := map[string]any{}
	for _, key := range keys {
		out[key] = numberFromAny(values[key])
	}
	return out
}

func parseRawNutritionBasis(value any) PackagedLabelNutritionBasis {
	raw := mapFromAny(value)
	return PackagedLabelNutritionBasis{
		Type:  strings.ToLower(stringFromAny(raw["type"])),
		Value: numberFromAny(raw["value"]),
		Unit:  strings.ToLower(stringFromAny(raw["unit"])),
	}
}

func parseRawNutritionValues(value any) PackagedLabelRawNutrition {
	raw := mapFromAny(value)
	return PackagedLabelRawNutrition{
		Energy:         parseNutritionValue(raw["energy"]),
		Protein:        parseNutritionValue(raw["protein"]),
		Carbs:          parseNutritionValue(raw["carbs"]),
		Fat:            parseNutritionValue(raw["fat"]),
		Fiber:          parseNutritionValue(raw["fiber"]),
		Sugar:          parseNutritionValue(raw["sugar"]),
		SaturatedFat:   parseNutritionValue(raw["saturatedFat"]),
		CholesterolMg:  parseNutritionValue(raw["cholesterolMg"]),
		SodiumMg:       parseNutritionValue(raw["sodiumMg"]),
		PotassiumMg:    parseNutritionValue(raw["potassiumMg"]),
		CalciumMg:      parseNutritionValue(raw["calciumMg"]),
		IronMg:         parseNutritionValue(raw["ironMg"]),
		MagnesiumMg:    parseNutritionValue(raw["magnesiumMg"]),
		ZincMg:         parseNutritionValue(raw["zincMg"]),
		VitaminARaeMcg: parseNutritionValue(raw["vitaminARaeMcg"]),
		VitaminCMg:     parseNutritionValue(raw["vitaminCMg"]),
		VitaminDMcg:    parseNutritionValue(raw["vitaminDMcg"]),
		VitaminEMg:     parseNutritionValue(raw["vitaminEMg"]),
		VitaminKMcg:    parseNutritionValue(raw["vitaminKMcg"]),
		ThiaminMg:      parseNutritionValue(raw["thiaminMg"]),
		RiboflavinMg:   parseNutritionValue(raw["riboflavinMg"]),
		NiacinMg:       parseNutritionValue(raw["niacinMg"]),
		VitaminB6Mg:    parseNutritionValue(raw["vitaminB6Mg"]),
		FolateMcg:      parseNutritionValue(raw["folateMcg"]),
		VitaminB12Mcg:  parseNutritionValue(raw["vitaminB12Mcg"]),
	}
}

func parseNutritionValue(value any) PackagedLabelNutritionValue {
	raw := mapFromAny(value)
	return PackagedLabelNutritionValue{
		Value: numberFromAny(raw["value"]),
		Unit:  strings.ToLower(stringFromAny(raw["unit"])),
	}
}

func convertPackagedNutrition(result *PackagedProductExtractResult) {
	if result == nil {
		return
	}
	if result.UnitNutritionPer100g == nil {
		result.UnitNutritionPer100g = map[string]any{}
	}
	basis := normalizeBasisUnit(result.RawNutritionBasis.Type, result.RawNutritionBasis.Unit, result.NutritionBasisUnit)
	result.NutritionBasisUnit = basis
	result.EnergyUnitRaw = normalizeEnergyUnit(result.RawNutritionPerBasis.Energy.Unit, result.EnergyUnitRaw)
	conversionStatus := "insufficient"
	switch basis {
	case "100g", "100ml":
		scale := basisScale(result.RawNutritionBasis, basis)
		if scale > 0 {
			fillConvertedNutrition(result.UnitNutritionPer100g, result.RawNutritionPerBasis, scale, result.EnergyUnitRaw)
			conversionStatus = "converted"
		}
	case "serving":
		servingSize := effectiveServingWeight(result)
		if basisUnit := servingBasisUnit(result); servingSize > 0 && basisUnit != "" {
			scale := 100.0 / servingSize
			fillConvertedNutrition(result.UnitNutritionPer100g, result.RawNutritionPerBasis, scale, result.EnergyUnitRaw)
			result.NutritionBasisUnit = "100" + basisUnit
			conversionStatus = "converted"
		}
	}
	if (conversionStatus != "converted" || (!hasValidPackagedNutrition(result.UnitNutritionPer100g) && !PackagedExtractHasVerifiedZeroNutritionEvidence(result))) && fillMultiServingNutritionFromRawPayload(result) {
		conversionStatus = "converted"
	}
	if conversionStatus == "converted" && !hasValidPackagedNutrition(result.UnitNutritionPer100g) && !PackagedExtractHasVerifiedZeroNutritionEvidence(result) {
		conversionStatus = "insufficient"
	}
	result.ConversionStatus = conversionStatus
	if len(result.RawLabelPayload) == 0 {
		result.RawLabelPayload = map[string]any{
			"raw_nutrition_basis":     result.RawNutritionBasis,
			"raw_nutrition_per_basis": result.RawNutritionPerBasis,
			"nutrition_basis_unit":    result.NutritionBasisUnit,
			"energy_unit_raw":         result.EnergyUnitRaw,
		}
	}
}

func fillMultiServingNutritionFromRawPayload(result *PackagedProductExtractResult) bool {
	if result == nil || len(result.RawLabelPayload) == 0 {
		return false
	}
	variants := extractPackagedServingNutritionVariants(result.RawLabelPayload)
	if len(variants) < 2 {
		return false
	}
	applyVariantCounts(result, variants)
	totalWeight := 0.0
	totalCount := 0.0
	for _, variant := range variants {
		if variant.ServingWeightG <= 0 || variant.Count <= 0 {
			return false
		}
		totalWeight += variant.ServingWeightG * variant.Count
		totalCount += variant.Count
	}
	if totalWeight <= 0 {
		return false
	}
	if result.NetWeightG > 0 {
		tolerance := math.Max(5, result.NetWeightG*0.03)
		if math.Abs(totalWeight-result.NetWeightG) > tolerance {
			return false
		}
	} else {
		result.NetWeightG = totalWeight
		result.NetContentValue = totalWeight
		result.NetContentUnit = "g"
	}
	unit := map[string]any{}
	for _, key := range packagedNutritionOutputFieldKeys {
		total := 0.0
		for _, variant := range variants {
			total += variant.Nutrition[key] * variant.Count
		}
		unit[key] = total * 100 / totalWeight
	}
	result.UnitNutritionPer100g = unit
	result.NutritionBasisUnit = "100g"
	if result.ServingWeightG <= 0 && totalCount > 0 {
		result.ServingWeightG = totalWeight / totalCount
	}
	if result.RawLabelPayload == nil {
		result.RawLabelPayload = map[string]any{}
	}
	result.RawLabelPayload["combined_nutrition_source"] = "multi_serving_weighted_average"
	return true
}

func extractPackagedServingNutritionVariants(payload map[string]any) []packagedServingNutritionVariant {
	variants := []packagedServingNutritionVariant{}
	for label, raw := range payload {
		rawMap := mapFromAny(raw)
		if len(rawMap) == 0 {
			continue
		}
		weightG := parseServingWeightFromText(label)
		if weightG <= 0 {
			weightG = parseServingWeightFromPayload(rawMap)
		}
		if weightG <= 0 {
			continue
		}
		nutrition := parseServingNutritionFromPayload(rawMap)
		if !hasCoreServingNutrition(nutrition) {
			continue
		}
		variants = append(variants, packagedServingNutritionVariant{
			Label:          label,
			ServingWeightG: weightG,
			Count:          0,
			Nutrition:      nutrition,
		})
	}
	return variants
}

func applyVariantCounts(result *PackagedProductExtractResult, variants []packagedServingNutritionVariant) {
	countsByWeight := parseSpecVariantCountsByServingWeight(result.SpecText)
	for i := range variants {
		if count := countsByWeight[packagedServingWeightKey(variants[i].ServingWeightG)]; count > 0 {
			variants[i].Count = count
		}
	}
	missingCount := false
	for _, variant := range variants {
		if variant.Count <= 0 {
			missingCount = true
			break
		}
	}
	if !missingCount {
		return
	}
	fallbackCount := 1.0
	if result != nil && result.UnitCount > 0 && len(variants) > 0 {
		fallbackCount = result.UnitCount / float64(len(variants))
	}
	for i := range variants {
		if variants[i].Count <= 0 {
			variants[i].Count = fallbackCount
		}
	}
}

func parseSpecVariantCountsByServingWeight(spec string) map[int64]float64 {
	out := map[int64]float64{}
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return out
	}
	for _, match := range packagedSpecCountServingWeightRE.FindAllStringSubmatch(spec, -1) {
		if len(match) < 6 {
			continue
		}
		count, errCount := strconv.ParseFloat(match[1], 64)
		weight, errWeight := strconv.ParseFloat(match[5], 64)
		if errCount != nil || errWeight != nil || count <= 0 || weight <= 0 {
			continue
		}
		out[packagedServingWeightKey(weight)] += count
	}
	return out
}

func packagedServingWeightKey(weight float64) int64 {
	return int64(math.Round(weight * 10))
}

func parseServingWeightFromPayload(raw map[string]any) float64 {
	for _, key := range []string{"serving_weight_g", "servingWeightG", "每份重量", "单支重量", "每支重量"} {
		if value := numberFromAny(raw[key]); value > 0 {
			return value
		}
		if value := parseServingWeightFromText(fmt.Sprint(raw[key])); value > 0 {
			return value
		}
	}
	return 0
}

func parseServingWeightFromText(text string) float64 {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0
	}
	match := packagedServingWeightInTextRE.FindStringSubmatch(text)
	if len(match) < 2 {
		return 0
	}
	value, err := strconv.ParseFloat(match[1], 64)
	if err != nil || value <= 0 {
		return 0
	}
	return value
}

func parseServingNutritionFromPayload(raw map[string]any) map[string]float64 {
	out := map[string]float64{}
	for key, value := range raw {
		nutritionKey := packagedServingNutritionKey(key)
		if nutritionKey == "" {
			continue
		}
		amount, unit := packagedNutritionAmountAndUnit(value)
		if amount <= 0 {
			continue
		}
		switch nutritionKey {
		case "calories":
			out[nutritionKey] = convertEnergyToKcal(amount, unit)
		case "sodiumMg", "potassiumMg", "calciumMg", "ironMg", "magnesiumMg", "zincMg":
			if isGramUnit(unit) {
				amount *= 1000
			}
			out[nutritionKey] = amount
		default:
			out[nutritionKey] = amount
		}
	}
	return out
}

func packagedServingNutritionKey(key string) string {
	normalized := strings.ToLower(strings.TrimSpace(key))
	normalized = strings.ReplaceAll(normalized, " ", "")
	normalized = strings.ReplaceAll(normalized, "_", "")
	normalized = strings.ReplaceAll(normalized, "-", "")
	switch {
	case strings.Contains(normalized, "能量") || strings.Contains(normalized, "energy") || strings.Contains(normalized, "calorie") || strings.Contains(normalized, "kcal"):
		return "calories"
	case strings.Contains(normalized, "饱和脂肪") || strings.Contains(normalized, "saturatedfat"):
		return "saturatedFat"
	case strings.Contains(normalized, "蛋白") || strings.Contains(normalized, "protein"):
		return "protein"
	case strings.Contains(normalized, "碳水") || strings.Contains(normalized, "carb"):
		return "carbs"
	case strings.Contains(normalized, "脂肪") || normalized == "fat":
		return "fat"
	case strings.Contains(normalized, "膳食纤维") || strings.Contains(normalized, "fiber") || strings.Contains(normalized, "fibre"):
		return "fiber"
	case strings.Contains(normalized, "糖") || strings.Contains(normalized, "sugar"):
		return "sugar"
	case strings.Contains(normalized, "胆固醇") || strings.Contains(normalized, "cholesterol"):
		return "cholesterolMg"
	case strings.Contains(normalized, "钠") || strings.Contains(normalized, "sodium"):
		return "sodiumMg"
	case strings.Contains(normalized, "钾") || strings.Contains(normalized, "potassium"):
		return "potassiumMg"
	case strings.Contains(normalized, "钙") || strings.Contains(normalized, "calcium"):
		return "calciumMg"
	case strings.Contains(normalized, "铁") || strings.Contains(normalized, "iron"):
		return "ironMg"
	case strings.Contains(normalized, "镁") || strings.Contains(normalized, "magnesium"):
		return "magnesiumMg"
	case strings.Contains(normalized, "锌") || strings.Contains(normalized, "zinc"):
		return "zincMg"
	default:
		return ""
	}
}

func packagedNutritionAmountAndUnit(value any) (float64, string) {
	if raw := mapFromAny(value); len(raw) > 0 {
		amount := numberFromAny(raw["value"])
		unit := strings.ToLower(firstNonEmpty(stringFromAny(raw["unit"]), stringFromAny(raw["Unit"])))
		if amount > 0 {
			return amount, unit
		}
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" {
		return 0, ""
	}
	number := packagedNutritionNumberRE.FindString(text)
	if number == "" {
		return 0, strings.ToLower(text)
	}
	amount, err := strconv.ParseFloat(number, 64)
	if err != nil {
		return 0, strings.ToLower(text)
	}
	return amount, strings.ToLower(text)
}

func isGramUnit(unit string) bool {
	unit = strings.ToLower(strings.TrimSpace(unit))
	if unit == "" {
		return false
	}
	if strings.Contains(unit, "mg") || strings.Contains(unit, "毫克") {
		return false
	}
	return strings.Contains(unit, "g") || strings.Contains(unit, "克")
}

func hasCoreServingNutrition(nutrition map[string]float64) bool {
	if nutrition["calories"] > 0 {
		return true
	}
	return nutrition["protein"]+nutrition["carbs"]+nutrition["fat"] > 0
}

func fillConvertedNutrition(out map[string]any, raw PackagedLabelRawNutrition, scale float64, energyUnitRaw string) {
	if out == nil || scale <= 0 {
		return
	}
	out["calories"] = convertEnergyToKcal(raw.Energy.Value, firstNonEmpty(energyUnitRaw, raw.Energy.Unit)) * scale
	out["protein"] = raw.Protein.Value * scale
	out["carbs"] = raw.Carbs.Value * scale
	out["fat"] = raw.Fat.Value * scale
	out["fiber"] = raw.Fiber.Value * scale
	out["sugar"] = raw.Sugar.Value * scale
	out["saturatedFat"] = raw.SaturatedFat.Value * scale
	out["cholesterolMg"] = raw.CholesterolMg.Value * scale
	out["sodiumMg"] = raw.SodiumMg.Value * scale
	out["potassiumMg"] = raw.PotassiumMg.Value * scale
	out["calciumMg"] = raw.CalciumMg.Value * scale
	out["ironMg"] = raw.IronMg.Value * scale
	out["magnesiumMg"] = raw.MagnesiumMg.Value * scale
	out["zincMg"] = raw.ZincMg.Value * scale
	out["vitaminARaeMcg"] = raw.VitaminARaeMcg.Value * scale
	out["vitaminCMg"] = raw.VitaminCMg.Value * scale
	out["vitaminDMcg"] = raw.VitaminDMcg.Value * scale
	out["vitaminEMg"] = raw.VitaminEMg.Value * scale
	out["vitaminKMcg"] = raw.VitaminKMcg.Value * scale
	out["thiaminMg"] = raw.ThiaminMg.Value * scale
	out["riboflavinMg"] = raw.RiboflavinMg.Value * scale
	out["niacinMg"] = raw.NiacinMg.Value * scale
	out["vitaminB6Mg"] = raw.VitaminB6Mg.Value * scale
	out["folateMcg"] = raw.FolateMcg.Value * scale
	out["vitaminB12Mcg"] = raw.VitaminB12Mcg.Value * scale
}

func convertEnergyToKcal(value float64, unit string) float64 {
	normalized := strings.ToLower(strings.TrimSpace(unit))
	if strings.Contains(normalized, "kj") || strings.Contains(normalized, "千焦") {
		return value / 4.184
	}
	return value
}

func normalizeBasisUnit(basisType, basisUnit, fallback string) string {
	normalizedType := normalizeBasisToken(basisType)
	fallback = normalizeBasisToken(fallback)
	if normalizedType == "" {
		normalizedType = fallback
	}
	basisUnit = normalizeBasisToken(basisUnit)
	if normalizedType == "份" || strings.Contains(normalizedType, "perserving") || strings.Contains(normalizedType, "serving") {
		return "serving"
	}
	if strings.Contains(normalizedType, "100ml") {
		return "100ml"
	}
	if strings.Contains(normalizedType, "100g") {
		return "100g"
	}
	switch normalizedType {
	case "100g", "100ml", "serving":
		return normalizedType
	case "per100g":
		return "100g"
	case "per100ml":
		return "100ml"
	case "per_serving":
		return "serving"
	}
	if basisUnit == "g" {
		return "100g"
	}
	if basisUnit == "ml" {
		return "100ml"
	}
	return fallback
}

func normalizeBasisToken(value string) string {
	normalizedType := strings.ToLower(strings.TrimSpace(value))
	normalizedType = strings.ReplaceAll(normalizedType, " ", "")
	normalizedType = strings.ReplaceAll(normalizedType, "每", "")
	normalizedType = strings.ReplaceAll(normalizedType, "毫升", "ml")
	normalizedType = strings.ReplaceAll(normalizedType, "克", "g")
	normalizedType = strings.ReplaceAll(normalizedType, "（", "(")
	normalizedType = strings.ReplaceAll(normalizedType, "）", ")")
	return normalizedType
}

func basisScale(basis PackagedLabelNutritionBasis, normalizedBasis string) float64 {
	if basis.Value <= 0 {
		if normalizedBasis == "100g" || normalizedBasis == "100ml" {
			return 1
		}
		return 0
	}
	return 100.0 / basis.Value
}

func servingBasisUnit(result *PackagedProductExtractResult) string {
	if result == nil {
		return ""
	}
	rawUnit := normalizeBasisToken(result.RawNutritionBasis.Unit)
	switch rawUnit {
	case "g":
		return "g"
	case "ml":
		return "ml"
	}
	category := strings.ToLower(strings.TrimSpace(result.PackageCategory))
	if strings.Contains(category, "固体饮料") {
		return "g"
	}
	if strings.Contains(category, "drink") || strings.Contains(category, "饮料") || strings.Contains(category, "饮品") {
		return "ml"
	}
	if result.NutritionBasisUnit == "100ml" {
		return "ml"
	}
	return "g"
}

func normalizeEnergyUnit(primary, fallback string) string {
	value := strings.ToLower(strings.TrimSpace(primary))
	if value != "" {
		return value
	}
	return strings.ToLower(strings.TrimSpace(fallback))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func normalizeStringSlice(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func evaluatePackagedAutoIngest(result *PackagedProductExtractResult) *PackagedAutoIngestResult {
	auto := &PackagedAutoIngestResult{
		Status: "blocked",
	}
	if result == nil {
		auto.Reason = "empty_result"
		return auto
	}
	auto.MissingFields = append([]string(nil), result.MissingFields...)
	auto.ConflictReasons = detectPackagedExtractConflicts(result)
	if strings.TrimSpace(result.ProductName) == "" {
		auto.Reason = "missing_product_name"
		return auto
	}
	if result.NetWeightG <= 0 && result.NetContentValue <= 0 {
		auto.Reason = "missing_net_content"
		return auto
	}
	if strings.TrimSpace(result.ConversionStatus) != "converted" {
		auto.Reason = "conversion_not_closed"
		return auto
	}
	if hasImplausiblePackagedNutrition(result.UnitNutritionPer100g) {
		auto.Reason = "nutrition_out_of_range"
		return auto
	}
	if !hasValidPackagedNutrition(result.UnitNutritionPer100g) && !PackagedExtractHasVerifiedZeroNutritionEvidence(result) {
		auto.Reason = "missing_nutrition"
		return auto
	}
	auto.Status = "ready"
	auto.Reason = "passed"
	return auto
}

func detectPackagedExtractConflicts(result *PackagedProductExtractResult) []string {
	conflicts := []string{}
	if result == nil {
		return conflicts
	}
	if result.ServingWeightG > 0 && result.NetWeightG > 0 && result.ServingWeightG > result.NetWeightG*1.2 {
		conflicts = append(conflicts, "serving_weight_exceeds_net_weight")
	}
	if result.NetWeightG > 0 && result.SpecText != "" {
		if totalFromSpec := parseSpecTotalWeight(result.SpecText); totalFromSpec > 0 && math.Abs(totalFromSpec-result.NetWeightG) > 5 {
			conflicts = append(conflicts, "spec_total_weight_conflict")
		}
	}
	return conflicts
}

func determinePackagedConfirmation(result *PackagedProductExtractResult) ([]string, []string) {
	if result == nil {
		return nil, nil
	}
	reasons := make([]string, 0, 8)
	fields := make([]string, 0, 8)
	seenReasons := map[string]bool{}
	seenFields := map[string]bool{}
	addReason := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || seenReasons[value] {
			return
		}
		seenReasons[value] = true
		reasons = append(reasons, value)
	}
	addField := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || seenFields[value] {
			return
		}
		seenFields[value] = true
		fields = append(fields, value)
	}

	if strings.TrimSpace(result.ProductName) == "" {
		addReason("missing_product_name")
		addField("product_name")
	}
	if result.NetWeightG <= 0 && result.NetContentValue <= 0 {
		addReason("missing_net_content")
		addField("net_weight_g")
	}
	if strings.TrimSpace(result.ConversionStatus) != "converted" {
		addReason("conversion_not_closed")
		addField("nutrition_basis_unit")
		addField("unit_nutrition_per_100g")
	}
	if hasImplausiblePackagedNutrition(result.UnitNutritionPer100g) {
		addReason("nutrition_out_of_range")
		addField("unit_nutrition_per_100g")
	}
	if !hasValidPackagedNutrition(result.UnitNutritionPer100g) && !PackagedExtractHasVerifiedZeroNutritionEvidence(result) {
		addReason("missing_nutrition")
		addField("unit_nutrition_per_100g")
	}

	for _, field := range result.MissingFields {
		switch strings.TrimSpace(field) {
		case "product_name":
			addField("product_name")
		case "net_weight_g":
			addField("net_weight_g")
		case "spec_text":
			addField("spec_text")
		}
	}

	for _, imageNeed := range result.NeedsMoreImages {
		switch strings.TrimSpace(imageNeed) {
		case "front_package":
			addReason("need_clearer_front_package")
			addField("product_name")
		case "nutrition_label":
			addReason("need_clearer_nutrition_label")
			addField("unit_nutrition_per_100g")
			addField("nutrition_basis_unit")
		case "net_weight":
			addReason("need_clearer_net_weight")
			addField("net_weight_g")
			addField("spec_text")
		}
	}

	for _, conflict := range detectPackagedExtractConflicts(result) {
		addReason(conflict)
	}

	if numberFromAny(result.FieldConfidence["product_name"]) > 0 && numberFromAny(result.FieldConfidence["product_name"]) < 0.6 {
		addField("product_name")
	}
	if numberFromAny(result.FieldConfidence["spec_text"]) > 0 && numberFromAny(result.FieldConfidence["spec_text"]) < 0.6 {
		addField("spec_text")
	}
	if numberFromAny(result.FieldConfidence["nutrition"]) > 0 && numberFromAny(result.FieldConfidence["nutrition"]) < 0.7 {
		addField("unit_nutrition_per_100g")
		addField("nutrition_basis_unit")
	}
	if result.ExtractConfidence > 0 && result.ExtractConfidence < 0.65 {
		if strings.TrimSpace(result.ProductName) == "" {
			addField("product_name")
		}
		if result.NetWeightG <= 0 && result.NetContentValue <= 0 {
			addField("net_weight_g")
		}
		if !hasValidPackagedNutrition(result.UnitNutritionPer100g) {
			addField("unit_nutrition_per_100g")
		}
	}

	return reasons, fields
}

func hasValidPackagedNutrition(unit map[string]any) bool {
	if len(unit) == 0 {
		return false
	}
	if numberFromAny(unit["calories"]) > 0 {
		return true
	}
	macroCount := 0
	for _, key := range []string{"protein", "carbs", "fat"} {
		if numberFromAny(unit[key]) > 0 {
			macroCount++
		}
	}
	return macroCount >= 2
}

func PackagedExtractHasVerifiedZeroNutritionEvidence(result *PackagedProductExtractResult) bool {
	if result == nil {
		return false
	}
	if hasPositiveCoreNutrition(result.UnitNutritionPer100g) {
		return false
	}
	if rawNutritionHasVerifiedZeroEvidence(result.RawNutritionPerBasis) {
		return true
	}
	return textHasVerifiedZeroNutritionEvidence(strings.Join([]string{
		result.OCRRawText,
		result.EnergyUnitRaw,
		result.NutritionBasisUnit,
		flattenLabelEvidence(result.RawLabelPayload),
	}, "\n"))
}

func PackagedFoodHasVerifiedZeroNutritionEvidence(food *domain.PackagedFood) bool {
	if food == nil {
		return false
	}
	if food.KcalPer100g != 0 || food.ProteinPer100g != 0 || food.CarbsPer100g != 0 || food.FatPer100g != 0 {
		return false
	}
	return textHasVerifiedZeroNutritionEvidence(strings.Join([]string{
		stringPointerValue(food.OCRRawText),
		stringPointerValue(food.EnergyUnitRaw),
		stringPointerValue(food.NutritionBasisUnit),
		flattenLabelEvidence(food.RawLabelPayload),
		flattenLabelEvidence(food.FieldConfidence),
	}, "\n"))
}

func hasPositiveCoreNutrition(unit map[string]any) bool {
	if len(unit) == 0 {
		return false
	}
	for _, key := range []string{"calories", "protein", "carbs", "fat"} {
		if numberFromAny(unit[key]) > 0 {
			return true
		}
	}
	return false
}

func rawNutritionHasVerifiedZeroEvidence(raw PackagedLabelRawNutrition) bool {
	if !isZeroNutritionValueWithUnit(raw.Energy, "kj", "kcal", "千焦", "千卡", "大卡") {
		return false
	}
	for _, value := range []PackagedLabelNutritionValue{raw.Protein, raw.Carbs, raw.Fat} {
		if isZeroNutritionValueWithUnit(value, "g", "克") {
			return true
		}
	}
	return false
}

func isZeroNutritionValueWithUnit(value PackagedLabelNutritionValue, units ...string) bool {
	if value.Value != 0 || strings.TrimSpace(value.Unit) == "" {
		return false
	}
	unit := strings.ToLower(strings.TrimSpace(value.Unit))
	for _, allowed := range units {
		if unit == strings.ToLower(strings.TrimSpace(allowed)) {
			return true
		}
	}
	return false
}

func textHasVerifiedZeroNutritionEvidence(text string) bool {
	text = normalizeZeroNutritionEvidenceText(text)
	if strings.TrimSpace(text) == "" {
		return false
	}
	return zeroEnergyEvidenceRE.MatchString(text) &&
		!nonZeroEnergyEvidenceRE.MatchString(text) &&
		zeroMacroEvidenceRE.MatchString(text)
}

var (
	zeroEnergyEvidenceRE    = regexp.MustCompile(`(?:能量|energy)[^\d]{0,16}0(?:\.0+)?\s*(?:kj|kcal)|0(?:\.0+)?\s*(?:kj|kcal)[^\n;；,，]{0,16}(?:能量|energy)`)
	nonZeroEnergyEvidenceRE = regexp.MustCompile(`(?:能量|energy)[^\d]{0,16}[1-9]\d*(?:\.\d+)?\s*(?:kj|kcal)`)
	zeroMacroEvidenceRE     = regexp.MustCompile(`(?:蛋白质|protein|脂肪|fat|碳水化合物|碳水|carbohydrate|carbs)[^\d]{0,16}0(?:\.0+)?\s*g`)
)

func normalizeZeroNutritionEvidenceText(text string) string {
	text = strings.ToLower(text)
	replacements := map[string]string{
		"：":  ":",
		"，":  ",",
		"；":  ";",
		"（":  "(",
		"）":  ")",
		"千焦": "kj",
		"千卡": "kcal",
		"大卡": "kcal",
		"克":  "g",
	}
	for old, next := range replacements {
		text = strings.ReplaceAll(text, old, next)
	}
	return text
}

func flattenLabelEvidence(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case map[string]any:
		parts := make([]string, 0, len(typed)*2)
		for key, nested := range typed {
			parts = append(parts, key, flattenLabelEvidence(nested))
		}
		return strings.Join(parts, " ")
	case []any:
		parts := make([]string, 0, len(typed))
		for _, nested := range typed {
			parts = append(parts, flattenLabelEvidence(nested))
		}
		return strings.Join(parts, " ")
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func stringPointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func hasImplausiblePackagedNutrition(unit map[string]any) bool {
	if len(unit) == 0 {
		return false
	}
	if calories := numberFromAny(unit["calories"]); calories > 900 {
		return true
	}
	macroSum := 0.0
	for _, key := range []string{"protein", "carbs", "fat"} {
		value := numberFromAny(unit[key])
		if value > 100 {
			return true
		}
		macroSum += value
	}
	return macroSum > 120
}

func confidenceBelow(confidence map[string]any, key string, threshold float64) bool {
	if threshold <= 0 {
		return false
	}
	score := numberFromAny(confidence[key])
	return score > 0 && score < threshold
}

func effectiveServingWeight(result *PackagedProductExtractResult) float64 {
	if result != nil && result.ServingWeightG > 0 {
		return result.ServingWeightG
	}
	if result != nil {
		return result.NetWeightG
	}
	return 0
}

func parseSpecTotalWeight(specText string) float64 {
	specText = strings.ToLower(strings.TrimSpace(specText))
	if specText == "" {
		return 0
	}
	specText = strings.ReplaceAll(specText, "×", "*")
	specText = strings.ReplaceAll(specText, "x", "*")
	multiIdx := strings.Index(specText, "*")
	if multiIdx <= 0 {
		return parseLeadingWeight(specText)
	}
	left := parseLeadingWeight(specText[:multiIdx])
	right := parseCount(specText[multiIdx+1:])
	if left > 0 && right > 0 {
		return left * right
	}
	return parseLeadingWeight(specText)
}

func parseLeadingWeight(text string) float64 {
	text = strings.TrimSpace(text)
	if strings.Contains(text, "ml") {
		return numberFromAny(strings.TrimSpace(strings.ReplaceAll(text, "ml", "")))
	}
	if strings.Contains(text, "g") {
		return numberFromAny(strings.TrimSpace(strings.ReplaceAll(text, "g", "")))
	}
	return numberFromAny(text)
}

func parseCount(text string) float64 {
	text = strings.TrimSpace(text)
	for _, suffix := range []string{"袋", "包", "盒", "瓶", "杯", "支", "枚"} {
		text = strings.ReplaceAll(text, suffix, "")
	}
	return numberFromAny(text)
}

func numberFromAny(values ...any) float64 {
	for _, value := range values {
		switch v := value.(type) {
		case float64:
			if isFiniteNonNegative(v) {
				return v
			}
		case float32:
			f := float64(v)
			if isFiniteNonNegative(f) {
				return f
			}
		case int:
			if v >= 0 {
				return float64(v)
			}
		case int64:
			if v >= 0 {
				return float64(v)
			}
		case json.Number:
			if f, err := v.Float64(); err == nil && isFiniteNonNegative(f) {
				return f
			}
		case string:
			text := strings.TrimSpace(v)
			text = strings.TrimSuffix(text, "kcal")
			text = strings.TrimSuffix(text, "mg")
			text = strings.TrimSuffix(text, "mcg")
			text = strings.TrimSuffix(text, "g")
			text = strings.TrimSpace(text)
			if f, err := strconv.ParseFloat(text, 64); err == nil && isFiniteNonNegative(f) {
				return f
			}
		}
	}
	return 0
}

func isFiniteNonNegative(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}
