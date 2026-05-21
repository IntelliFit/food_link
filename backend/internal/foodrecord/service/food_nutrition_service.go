package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/repo"
)

type FoodNutritionService struct {
	nutritionRepo              *repo.FoodNutritionRepo
	nutritionLabelVisionClient NutritionLabelVisionClient
}

type NutritionLabelVisionClient interface {
	AnalyzeWithImagesAndTemperature(ctx context.Context, prompt string, imageURLs []string, temperature float64) (map[string]any, error)
}

type PackagedFoodInput struct {
	Brand                 string
	ProductName           string
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
}

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

func NewFoodNutritionService(nutritionRepo *repo.FoodNutritionRepo) *FoodNutritionService {
	return &FoodNutritionService{nutritionRepo: nutritionRepo}
}

func (s *FoodNutritionService) ConfigureNutritionLabelVisionClient(client NutritionLabelVisionClient) {
	s.nutritionLabelVisionClient = client
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
	productName := strings.TrimSpace(input.ProductName)
	if productName == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "零食名称不能为空", HTTPStatus: 400}
	}
	if input.NetWeightG <= 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "零食重量必须大于0", HTTPStatus: 400}
	}
	if input.ServingWeightG <= 0 {
		input.ServingWeightG = input.NetWeightG
	}
	if input.KcalPer100g <= 0 && input.ProteinPer100g <= 0 && input.CarbsPer100g <= 0 && input.FatPer100g <= 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请至少填写热量或三大营养素", HTTPStatus: 400}
	}
	return s.nutritionRepo.UpsertPackagedFood(ctx, repo.PackagedFoodInput{
		Brand:                 input.Brand,
		ProductName:           productName,
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
		Source:                "user_submitted",
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

func stringFromAny(values ...any) string {
	for _, value := range values {
		text := strings.TrimSpace(fmt.Sprintf("%v", value))
		if text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
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
