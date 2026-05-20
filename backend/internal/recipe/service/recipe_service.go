package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	healthdomain "food_link/backend/internal/health/domain"
	"food_link/backend/internal/recipe/domain"
	"food_link/backend/internal/recipe/repo"
	"food_link/backend/pkg/storage"
	"gorm.io/gorm"
)

type RecipeService struct {
	repo      *repo.RecipeRepo
	storage   *storage.Client
	waterLogs WaterLogRecorder
}

func NewRecipeService(repo *repo.RecipeRepo, storageClient ...*storage.Client) *RecipeService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &RecipeService{repo: repo, storage: client}
}

type WaterLogRecorder interface {
	CreateWaterLog(ctx context.Context, log *healthdomain.BodyWaterLog) error
}

func (s *RecipeService) ConfigureWaterLogRecorder(recorder WaterLogRecorder) {
	s.waterLogs = recorder
}

type CreateInput struct {
	RecipeName       string
	Description      *string
	ImagePath        *string
	Items            []map[string]any
	TotalCalories    float64
	TotalProtein     float64
	TotalCarbs       float64
	TotalFat         float64
	TotalWeightGrams float64
	Tags             []string
	MealType         *string
	IsFavorite       bool
}

type UpdateInput struct {
	RecipeName       *string
	Description      *string
	ImagePath        *string
	Items            []map[string]any
	TotalCalories    *float64
	TotalProtein     *float64
	TotalCarbs       *float64
	TotalFat         *float64
	TotalWeightGrams *float64
	Tags             []string
	TagsSet          bool
	MealType         *string
	IsFavorite       *bool
}

func (s *RecipeService) Create(ctx context.Context, userID string, input CreateInput) (string, error) {
	if strings.TrimSpace(input.RecipeName) == "" {
		return "", &commonerrors.AppError{Code: 10002, Message: "recipe_name 不能为空", HTTPStatus: 400}
	}
	input.ImagePath = s.normalizeImagePathPtr(input.ImagePath)
	recipe := &domain.Recipe{
		UserID:           userID,
		RecipeName:       input.RecipeName,
		Description:      input.Description,
		ImagePath:        input.ImagePath,
		Items:            input.Items,
		TotalCalories:    input.TotalCalories,
		TotalProtein:     input.TotalProtein,
		TotalCarbs:       input.TotalCarbs,
		TotalFat:         input.TotalFat,
		TotalWeightGrams: input.TotalWeightGrams,
		Tags:             domain.StringArray(input.Tags),
		MealType:         normalizeMealPtr(input.MealType),
		IsFavorite:       input.IsFavorite,
	}
	if err := s.repo.Create(ctx, recipe); err != nil {
		return "", err
	}
	return recipe.ID, nil
}

func (s *RecipeService) List(ctx context.Context, userID, mealType string, isFavorite *bool) ([]domain.Recipe, error) {
	recipes, err := s.repo.List(ctx, userID, normalizeMeal(mealType), isFavorite)
	if err != nil {
		return nil, err
	}
	return s.normalizeRecipes(recipes), nil
}

func (s *RecipeService) Count(ctx context.Context, userID string, isFavorite *bool) (int64, error) {
	return s.repo.Count(ctx, userID, isFavorite)
}

func (s *RecipeService) Get(ctx context.Context, userID, recipeID string) (*domain.Recipe, error) {
	recipe, err := s.repo.Get(ctx, recipeID, userID)
	if err != nil {
		return nil, err
	}
	if recipe == nil {
		return nil, commonerrors.ErrNotFound
	}
	return s.normalizeRecipe(recipe), nil
}

func (s *RecipeService) Update(ctx context.Context, userID, recipeID string, input UpdateInput) (*domain.Recipe, error) {
	updates := map[string]any{}
	if input.RecipeName != nil {
		if strings.TrimSpace(*input.RecipeName) == "" {
			return nil, &commonerrors.AppError{Code: 10002, Message: "recipe_name 不能为空", HTTPStatus: 400}
		}
		updates["recipe_name"] = *input.RecipeName
	}
	if input.Description != nil {
		updates["description"] = *input.Description
	}
	if input.ImagePath != nil {
		normalized := s.normalizeImagePathPtr(input.ImagePath)
		if normalized == nil {
			updates["image_path"] = ""
		} else {
			updates["image_path"] = *normalized
		}
	}
	if input.Items != nil {
		updates["items"] = input.Items
	}
	if input.TotalCalories != nil {
		updates["total_calories"] = *input.TotalCalories
	}
	if input.TotalProtein != nil {
		updates["total_protein"] = *input.TotalProtein
	}
	if input.TotalCarbs != nil {
		updates["total_carbs"] = *input.TotalCarbs
	}
	if input.TotalFat != nil {
		updates["total_fat"] = *input.TotalFat
	}
	if input.TotalWeightGrams != nil {
		updates["total_weight_grams"] = *input.TotalWeightGrams
	}
	if input.TagsSet {
		updates["tags"] = domain.StringArray(input.Tags)
	}
	if input.MealType != nil {
		updates["meal_type"] = normalizeMeal(*input.MealType)
	}
	if input.IsFavorite != nil {
		updates["is_favorite"] = *input.IsFavorite
	}
	if len(updates) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "没有要更新的字段", HTTPStatus: 400}
	}
	recipe, err := s.repo.Update(ctx, recipeID, userID, updates)
	if err != nil {
		return nil, err
	}
	if recipe == nil {
		return nil, commonerrors.ErrNotFound
	}
	return s.normalizeRecipe(recipe), nil
}

func (s *RecipeService) Delete(ctx context.Context, userID, recipeID string) error {
	if err := s.repo.Delete(ctx, recipeID, userID); err != nil {
		if err == gorm.ErrRecordNotFound {
			return commonerrors.ErrNotFound
		}
		return err
	}
	return nil
}

func (s *RecipeService) Use(ctx context.Context, userID, recipeID string, mealType *string) (string, error) {
	recipe, err := s.Get(ctx, userID, recipeID)
	if err != nil {
		return "", err
	}
	chosenMeal := "afternoon_snack"
	if recipe.MealType != nil && *recipe.MealType != "" {
		chosenMeal = *recipe.MealType
	}
	if mealType != nil && *mealType != "" {
		chosenMeal = *mealType
	}
	chosenMeal = normalizeMeal(chosenMeal)
	desc := "使用食谱：" + recipe.RecipeName
	recordItems := normalizeRecipeItemsForFoodRecord(recipe.Items, recipe)
	record := &domain.FoodRecord{
		UserID:           userID,
		MealType:         chosenMeal,
		ImagePath:        recipe.ImagePath,
		Description:      &desc,
		Items:            recordItems,
		TotalCalories:    recipe.TotalCalories,
		TotalProtein:     recipe.TotalProtein,
		TotalCarbs:       recipe.TotalCarbs,
		TotalFat:         recipe.TotalFat,
		TotalWeightGrams: int(recipe.TotalWeightGrams),
	}
	if err := s.repo.InsertFoodRecord(ctx, record); err != nil {
		return "", err
	}
	if err := s.recordFoodWaterIntake(ctx, userID, record); err != nil {
		// Food water is a derived side effect. Keep recipe reuse successful even
		// if water-log schema/config is temporarily out of sync.
		fmt.Printf("[recipe] record food water intake failed user_id=%s record_id=%s err=%v\n", userID, record.ID, err)
	}
	_ = s.repo.MarkUsed(ctx, recipeID, userID, recipe.UseCount)
	return record.ID, nil
}

func (s *RecipeService) recordFoodWaterIntake(ctx context.Context, userID string, record *domain.FoodRecord) error {
	if s.waterLogs == nil || record == nil || strings.TrimSpace(userID) == "" {
		return nil
	}
	amountMl := totalRecipeFoodWaterIntakeMl(record.Items)
	if amountMl <= 0 {
		return nil
	}
	recordedOn := time.Now().In(chinaTZ)
	if record.RecordTime != nil {
		recordedOn = record.RecordTime.In(chinaTZ)
	}
	recordedDate := time.Date(recordedOn.Year(), recordedOn.Month(), recordedOn.Day(), 0, 0, 0, 0, chinaTZ)
	now := time.Now().UTC()
	sourceType := foodWaterSourceType(record.ID)
	if sourceType == "" {
		return nil
	}
	return s.waterLogs.CreateWaterLog(ctx, &healthdomain.BodyWaterLog{
		UserID:     userID,
		AmountMl:   amountMl,
		RecordedOn: &recordedDate,
		SourceType: sourceType,
		CreatedAt:  &now,
	})
}

func (s *RecipeService) normalizeRecipes(recipes []domain.Recipe) []domain.Recipe {
	for i := range recipes {
		recipe := &recipes[i]
		recipes[i] = *s.normalizeRecipe(recipe)
	}
	return recipes
}

func (s *RecipeService) normalizeRecipe(recipe *domain.Recipe) *domain.Recipe {
	if recipe == nil {
		return nil
	}
	recipe.ImagePath = s.normalizeImagePathPtr(recipe.ImagePath)
	return recipe
}

func (s *RecipeService) normalizeImagePathPtr(value *string) *string {
	if value == nil {
		return nil
	}
	resolved := s.resolveFoodImageURL(*value)
	if resolved == "" {
		return nil
	}
	return &resolved
}

func (s *RecipeService) resolveFoodImageURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("food-images", value)
	if resolved == "" {
		return value
	}
	return resolved
}

func normalizeMealPtr(v *string) *string {
	if v == nil || *v == "" {
		return v
	}
	normalized := normalizeMeal(*v)
	return &normalized
}

func normalizeMeal(v string) string {
	switch strings.TrimSpace(strings.ToLower(v)) {
	case "breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "evening_snack":
		return strings.TrimSpace(strings.ToLower(v))
	case "snack":
		return "afternoon_snack"
	default:
		return v
	}
}

func normalizeRecipeItemsForFoodRecord(items []map[string]any, recipe *domain.Recipe) []map[string]any {
	if len(items) == 0 {
		return items
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		normalized := make(map[string]any, len(item)+4)
		for key, value := range item {
			normalized[key] = value
		}

		weight := firstNumberFromMap(item, "weight", "estimatedWeightGrams", "estimated_weight_grams")
		if weight > 0 {
			normalized["weight"] = weight
		}
		ratio := firstNumberFromMap(item, "ratio", "suggestedRatio", "suggested_ratio")
		if ratio <= 0 {
			ratio = 100
		}
		normalized["ratio"] = ratio
		intake := firstNumberFromMap(item, "intake")
		if intake <= 0 && weight > 0 {
			intake = weight * ratio / 100
		}
		if intake > 0 {
			normalized["intake"] = intake
		}
		if waterMl := firstNumberFromMap(item, "water_ml", "waterMl"); waterMl > 0 {
			normalized["water_ml"] = waterMl
		}

		nutrients := normalizeRecipeItemNutrients(item)
		if len(items) == 1 && recipe != nil {
			fillNutrientIfMissing(nutrients, "calories", recipe.TotalCalories)
			fillNutrientIfMissing(nutrients, "protein", recipe.TotalProtein)
			fillNutrientIfMissing(nutrients, "carbs", recipe.TotalCarbs)
			fillNutrientIfMissing(nutrients, "fat", recipe.TotalFat)
		}
		normalized["nutrients"] = nutrients
		out = append(out, normalized)
	}
	return out
}

var chinaTZ = time.FixedZone("Asia/Shanghai", 8*60*60)

func foodWaterSourceType(recordID string) string {
	recordID = strings.TrimSpace(recordID)
	if recordID == "" {
		return ""
	}
	return "ai_food_record:" + recordID
}

func totalRecipeFoodWaterIntakeMl(items []map[string]any) int {
	total := 0.0
	for _, item := range items {
		waterMl := firstNumberFromMap(item, "water_ml", "waterMl")
		if waterMl <= 0 {
			if nutrients, ok := item["nutrients"].(map[string]any); ok {
				waterMl = firstNumberFromMap(nutrients, "water_ml", "waterMl")
			}
		}
		if waterMl <= 0 {
			continue
		}
		ratio := firstNumberFromMap(item, "ratio")
		if ratio > 0 {
			total += waterMl * ratio / 100
			continue
		}
		intake := firstNumberFromMap(item, "intake")
		weight := firstNumberFromMap(item, "weight", "estimatedWeightGrams", "estimated_weight_grams")
		if intake > 0 && weight > 0 {
			total += waterMl * intake / weight
			continue
		}
		if intake == 0 && weight == 0 {
			total += waterMl
		}
	}
	if total <= 0 {
		return 0
	}
	return int(math.Round(total))
}

func normalizeRecipeItemNutrients(item map[string]any) map[string]any {
	nutrients := map[string]any{}
	if raw, ok := item["nutrients"].(map[string]any); ok {
		for key, value := range raw {
			nutrients[key] = value
		}
	}
	aliases := map[string][]string{
		"calories":       {"calories", "calorie", "kcal", "energy", "total_calories"},
		"protein":        {"protein", "total_protein"},
		"carbs":          {"carbs", "carbohydrates", "carbohydrate", "total_carbs"},
		"fat":            {"fat", "total_fat"},
		"fiber":          {"fiber"},
		"sugar":          {"sugar"},
		"saturatedFat":   {"saturatedFat", "saturated_fat"},
		"cholesterolMg":  {"cholesterolMg", "cholesterol_mg"},
		"sodiumMg":       {"sodiumMg", "sodium_mg"},
		"potassiumMg":    {"potassiumMg", "potassium_mg"},
		"calciumMg":      {"calciumMg", "calcium_mg"},
		"ironMg":         {"ironMg", "iron_mg"},
		"magnesiumMg":    {"magnesiumMg", "magnesium_mg"},
		"zincMg":         {"zincMg", "zinc_mg"},
		"vitaminARaeMcg": {"vitaminARaeMcg", "vitamin_a_rae_mcg"},
		"vitaminCMg":     {"vitaminCMg", "vitamin_c_mg"},
		"vitaminDMcg":    {"vitaminDMcg", "vitamin_d_mcg"},
		"vitaminEMg":     {"vitaminEMg", "vitamin_e_mg"},
		"vitaminKMcg":    {"vitaminKMcg", "vitamin_k_mcg"},
		"thiaminMg":      {"thiaminMg", "thiamin_mg"},
		"riboflavinMg":   {"riboflavinMg", "riboflavin_mg"},
		"niacinMg":       {"niacinMg", "niacin_mg"},
		"vitaminB6Mg":    {"vitaminB6Mg", "vitamin_b6_mg"},
		"folateMcg":      {"folateMcg", "folate_mcg"},
		"vitaminB12Mcg":  {"vitaminB12Mcg", "vitamin_b12_mcg"},
	}
	for canonical, keys := range aliases {
		if value := firstNumberFromMap(nutrients, keys...); value > 0 {
			nutrients[canonical] = value
			continue
		}
		if value := firstNumberFromMap(item, keys...); value > 0 {
			nutrients[canonical] = value
		}
	}
	return nutrients
}

func fillNutrientIfMissing(nutrients map[string]any, key string, value float64) {
	if value <= 0 || firstNumberFromMap(nutrients, key) > 0 {
		return
	}
	nutrients[key] = math.Round(value*10) / 10
}

func firstNumberFromMap(values map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if number := numberFromAny(values[key]); number > 0 {
			return number
		}
	}
	return 0
}

func numberFromAny(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case int32:
		return float64(v)
	case uint:
		return float64(v)
	case uint64:
		return float64(v)
	case uint32:
		return float64(v)
	case json.Number:
		n, _ := v.Float64()
		return n
	default:
		return 0
	}
}
