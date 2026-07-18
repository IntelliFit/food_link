package domain

import (
	"encoding/json"
	"time"

	"gorm.io/datatypes"
)

// FoodRecord — table: user_food_records
type FoodRecord struct {
	ID               string     `gorm:"column:id" json:"id"`
	UserID           string     `gorm:"column:user_id" json:"user_id"`
	MealType         string     `gorm:"column:meal_type" json:"meal_type"`
	ImagePath        *string    `gorm:"column:image_path" json:"image_path,omitempty"`
	ImagePaths       []string   `gorm:"column:image_paths;serializer:json" json:"image_paths,omitempty"`
	Description      *string    `gorm:"column:description" json:"description,omitempty"`
	Insight          *string    `gorm:"column:insight" json:"insight,omitempty"`
	Items            []FoodItem `gorm:"column:items;serializer:json" json:"items"`
	TotalCalories    float64    `gorm:"column:total_calories" json:"total_calories"`
	TotalProtein     float64    `gorm:"column:total_protein" json:"total_protein"`
	TotalCarbs       float64    `gorm:"column:total_carbs" json:"total_carbs"`
	TotalFat         float64    `gorm:"column:total_fat" json:"total_fat"`
	TotalWeightGrams int        `gorm:"column:total_weight_grams" json:"total_weight_grams"`
	DietGoal         *string    `gorm:"column:diet_goal" json:"diet_goal,omitempty"`
	ActivityTiming   *string    `gorm:"column:activity_timing" json:"activity_timing,omitempty"`
	PFCRatioComment  *string    `gorm:"column:pfc_ratio_comment" json:"pfc_ratio_comment,omitempty"`
	AbsorptionNotes  *string    `gorm:"column:absorption_notes" json:"absorption_notes,omitempty"`
	ContextAdvice    *string    `gorm:"column:context_advice" json:"context_advice,omitempty"`
	SourceTaskID     *string    `gorm:"column:source_task_id" json:"source_task_id,omitempty"`
	EntryType        *string    `gorm:"column:entry_type" json:"entry_type,omitempty"`
	RecipeID         *string    `gorm:"column:recipe_id" json:"recipe_id,omitempty"`
	RecordTime       *time.Time `gorm:"column:record_time" json:"record_time"`
	CreatedAt        *time.Time `gorm:"column:created_at" json:"created_at"`
	AlreadySaved     bool       `gorm:"-" json:"-"`
}

func (FoodRecord) TableName() string { return "user_food_records" }

type FoodItem struct {
	Name                    string               `json:"name"`
	Weight                  float64              `json:"weight"`
	Ratio                   float64              `json:"ratio"`
	Intake                  float64              `json:"intake"`
	ImagePath               *string              `json:"image_path,omitempty"`
	ImagePaths              []string             `json:"image_paths,omitempty"`
	GrossWeightGrams        float64              `json:"gross_weight_grams,omitempty"`
	EdiblePortionRatio      float64              `json:"edible_portion_ratio,omitempty"`
	EdiblePortionReason     *string              `json:"edible_portion_reason,omitempty"`
	EdiblePortionSource     *string              `json:"edible_portion_source,omitempty"`
	SuggestedRatio          *float64             `json:"suggested_ratio,omitempty"`
	SuggestedRatioReason    *string              `json:"suggested_ratio_reason,omitempty"`
	SuggestedRatioSource    *string              `json:"suggested_ratio_source,omitempty"`
	WaterMl                 float64              `json:"water_ml,omitempty"`
	NutritionSource         *string              `json:"nutrition_source,omitempty"`
	NutritionSourceCategory *string              `json:"nutrition_source_category,omitempty"`
	MatchedFoodID           *string              `json:"matched_food_id,omitempty"`
	PackagedFoodID          *string              `json:"packaged_food_id,omitempty"`
	PackageMatchStatus      *string              `json:"package_match_status,omitempty"`
	PackageMatchConfidence  *float64             `json:"package_match_confidence,omitempty"`
	PackageWeightSource     *string              `json:"package_weight_source,omitempty"`
	PackageWeightApplied    *bool                `json:"package_weight_applied,omitempty"`
	PackageWeightReason     *string              `json:"package_weight_reason,omitempty"`
	PackagedCandidates      []map[string]any     `json:"packaged_candidates,omitempty"`
	Nutrients               FoodItemNutrients    `json:"nutrients"`
	Ingredients             *FoodItemIngredients `json:"ingredients,omitempty"`
	ManualSource            *string              `json:"manual_source,omitempty"`
	ManualSourceID          *string              `json:"manual_source_id,omitempty"`
	ManualSourceTitle       *string              `json:"manual_source_title,omitempty"`
	ManualPortionLabel      *string              `json:"manual_portion_label,omitempty"`
}

// FoodItemIngredients holds the ingredient label / nutrition facts extracted
// from packaged food images during the first-stage vision recognition.
type FoodItemIngredients struct {
	IngredientsText  string         `json:"ingredientsText,omitempty"`
	ServingSize      string         `json:"servingSize,omitempty"`
	NutritionPer100g map[string]any `json:"nutritionPer100g,omitempty"`
}

func (f *FoodItem) UnmarshalJSON(data []byte) error {
	type Alias FoodItem
	aux := struct {
		*Alias
		WaterMlCamel *float64 `json:"waterMl"`
		WaterMlSnake *float64 `json:"water_ml"`
	}{
		Alias: (*Alias)(f),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	var raw struct {
		Ratio  *float64 `json:"ratio"`
		Intake *float64 `json:"intake"`
		Weight *float64 `json:"weight"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	var nutrients struct {
		Values FoodItemNutrients `json:"nutrients"`
	}
	if err := json.Unmarshal(data, &nutrients); err != nil {
		return err
	}
	f.Nutrients = nutrients.Values
	var nutrientsRaw struct {
		Values map[string]any `json:"nutrients"`
	}
	if err := json.Unmarshal(data, &nutrientsRaw); err != nil {
		return err
	}
	switch {
	case aux.WaterMlSnake != nil:
		f.WaterMl = *aux.WaterMlSnake
	case aux.WaterMlCamel != nil:
		f.WaterMl = *aux.WaterMlCamel
	case f.WaterMl <= 0 && nutrientsRaw.Values != nil:
		f.WaterMl = numberFromAny(nutrientsRaw.Values["water_ml"])
		if f.WaterMl <= 0 {
			f.WaterMl = numberFromAny(nutrientsRaw.Values["waterMl"])
		}
	}
	if raw.Ratio == nil {
		if raw.Intake != nil && raw.Weight != nil && *raw.Intake >= 0 && *raw.Weight > 0 {
			f.Ratio = *raw.Intake / *raw.Weight * 100
		} else {
			f.Ratio = 100
		}
	}
	if f.Ratio > 100 {
		f.Ratio = 100
	}
	if f.Ratio < 0 {
		f.Ratio = 0
	}
	if raw.Intake == nil && f.Weight > 0 {
		f.Intake = f.Weight * f.Ratio / 100
	}
	if f.Intake > f.Weight {
		f.Intake = f.Weight
	}
	if f.Intake < 0 {
		f.Intake = 0
	}
	return nil
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
	case json.Number:
		n, _ := v.Float64()
		return n
	default:
		return 0
	}
}

type FoodItemNutrients struct {
	Calories       float64 `json:"calories"`
	Protein        float64 `json:"protein"`
	Carbs          float64 `json:"carbs"`
	Fat            float64 `json:"fat"`
	Fiber          float64 `json:"fiber"`
	Sugar          float64 `json:"sugar"`
	SaturatedFat   float64 `json:"saturatedFat"`
	CholesterolMg  float64 `json:"cholesterolMg"`
	SodiumMg       float64 `json:"sodiumMg"`
	PotassiumMg    float64 `json:"potassiumMg"`
	CalciumMg      float64 `json:"calciumMg"`
	IronMg         float64 `json:"ironMg"`
	MagnesiumMg    float64 `json:"magnesiumMg"`
	ZincMg         float64 `json:"zincMg"`
	VitaminARaeMcg float64 `json:"vitaminARaeMcg"`
	VitaminCMg     float64 `json:"vitaminCMg"`
	VitaminDMcg    float64 `json:"vitaminDMcg"`
	VitaminEMg     float64 `json:"vitaminEMg"`
	VitaminKMcg    float64 `json:"vitaminKMcg"`
	ThiaminMg      float64 `json:"thiaminMg"`
	RiboflavinMg   float64 `json:"riboflavinMg"`
	NiacinMg       float64 `json:"niacinMg"`
	VitaminB6Mg    float64 `json:"vitaminB6Mg"`
	FolateMcg      float64 `json:"folateMcg"`
	VitaminB12Mcg  float64 `json:"vitaminB12Mcg"`
}

func (n *FoodItemNutrients) UnmarshalJSON(data []byte) error {
	type Alias FoodItemNutrients
	aux := struct {
		*Alias
		CarbsSnake          *float64 `json:"carbohydrate"`
		CarbsPluralSnake    *float64 `json:"carbohydrates"`
		FiberSnake          *float64 `json:"dietary_fiber"`
		FibreSnake          *float64 `json:"fibre"`
		SugarSnake          *float64 `json:"total_sugar"`
		SugarsSnake         *float64 `json:"sugars"`
		SaturatedFatSnake   *float64 `json:"saturated_fat"`
		CholesterolMgSnake  *float64 `json:"cholesterol_mg"`
		SodiumMgSnake       *float64 `json:"sodium_mg"`
		PotassiumMgSnake    *float64 `json:"potassium_mg"`
		CalciumMgSnake      *float64 `json:"calcium_mg"`
		IronMgSnake         *float64 `json:"iron_mg"`
		MagnesiumMgSnake    *float64 `json:"magnesium_mg"`
		ZincMgSnake         *float64 `json:"zinc_mg"`
		VitaminARaeMcgSnake *float64 `json:"vitamin_a_rae_mcg"`
		VitaminCMgSnake     *float64 `json:"vitamin_c_mg"`
		VitaminDMcgSnake    *float64 `json:"vitamin_d_mcg"`
		VitaminEMgSnake     *float64 `json:"vitamin_e_mg"`
		VitaminKMcgSnake    *float64 `json:"vitamin_k_mcg"`
		ThiaminMgSnake      *float64 `json:"thiamin_mg"`
		RiboflavinMgSnake   *float64 `json:"riboflavin_mg"`
		NiacinMgSnake       *float64 `json:"niacin_mg"`
		VitaminB6MgSnake    *float64 `json:"vitamin_b6_mg"`
		FolateMcgSnake      *float64 `json:"folate_mcg"`
		VitaminB12McgSnake  *float64 `json:"vitamin_b12_mcg"`
	}{
		Alias: (*Alias)(n),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if aux.CarbsSnake != nil {
		n.Carbs = *aux.CarbsSnake
	}
	if aux.CarbsPluralSnake != nil {
		n.Carbs = *aux.CarbsPluralSnake
	}
	if aux.FiberSnake != nil {
		n.Fiber = *aux.FiberSnake
	}
	if aux.FibreSnake != nil {
		n.Fiber = *aux.FibreSnake
	}
	if aux.SugarSnake != nil {
		n.Sugar = *aux.SugarSnake
	}
	if aux.SugarsSnake != nil {
		n.Sugar = *aux.SugarsSnake
	}
	if aux.SaturatedFatSnake != nil {
		n.SaturatedFat = *aux.SaturatedFatSnake
	}
	if aux.CholesterolMgSnake != nil {
		n.CholesterolMg = *aux.CholesterolMgSnake
	}
	if aux.SodiumMgSnake != nil {
		n.SodiumMg = *aux.SodiumMgSnake
	}
	if aux.PotassiumMgSnake != nil {
		n.PotassiumMg = *aux.PotassiumMgSnake
	}
	if aux.CalciumMgSnake != nil {
		n.CalciumMg = *aux.CalciumMgSnake
	}
	if aux.IronMgSnake != nil {
		n.IronMg = *aux.IronMgSnake
	}
	if aux.MagnesiumMgSnake != nil {
		n.MagnesiumMg = *aux.MagnesiumMgSnake
	}
	if aux.ZincMgSnake != nil {
		n.ZincMg = *aux.ZincMgSnake
	}
	if aux.VitaminARaeMcgSnake != nil {
		n.VitaminARaeMcg = *aux.VitaminARaeMcgSnake
	}
	if aux.VitaminCMgSnake != nil {
		n.VitaminCMg = *aux.VitaminCMgSnake
	}
	if aux.VitaminDMcgSnake != nil {
		n.VitaminDMcg = *aux.VitaminDMcgSnake
	}
	if aux.VitaminEMgSnake != nil {
		n.VitaminEMg = *aux.VitaminEMgSnake
	}
	if aux.VitaminKMcgSnake != nil {
		n.VitaminKMcg = *aux.VitaminKMcgSnake
	}
	if aux.ThiaminMgSnake != nil {
		n.ThiaminMg = *aux.ThiaminMgSnake
	}
	if aux.RiboflavinMgSnake != nil {
		n.RiboflavinMg = *aux.RiboflavinMgSnake
	}
	if aux.NiacinMgSnake != nil {
		n.NiacinMg = *aux.NiacinMgSnake
	}
	if aux.VitaminB6MgSnake != nil {
		n.VitaminB6Mg = *aux.VitaminB6MgSnake
	}
	if aux.FolateMcgSnake != nil {
		n.FolateMcg = *aux.FolateMcgSnake
	}
	if aux.VitaminB12McgSnake != nil {
		n.VitaminB12Mcg = *aux.VitaminB12McgSnake
	}
	return nil
}

// FoodNutrition — table: food_nutrition_library (read-only)
type FoodNutrition struct {
	ID                    string            `gorm:"column:id" json:"id"`
	CanonicalName         string            `gorm:"column:canonical_name" json:"canonical_name"`
	NormalizedName        string            `gorm:"column:normalized_name" json:"normalized_name"`
	KcalPer100g           float64           `gorm:"column:kcal_per_100g" json:"kcal_per_100g"`
	ProteinPer100g        float64           `gorm:"column:protein_per_100g" json:"protein_per_100g"`
	CarbsPer100g          float64           `gorm:"column:carbs_per_100g" json:"carbs_per_100g"`
	FatPer100g            float64           `gorm:"column:fat_per_100g" json:"fat_per_100g"`
	FiberPer100g          float64           `gorm:"column:fiber_per_100g" json:"fiber_per_100g"`
	SugarPer100g          float64           `gorm:"column:sugar_per_100g" json:"sugar_per_100g"`
	SaturatedFatPer100g   float64           `gorm:"column:saturated_fat_per_100g" json:"saturated_fat_per_100g"`
	CholesterolMgPer100g  float64           `gorm:"column:cholesterol_mg_per_100g" json:"cholesterol_mg_per_100g"`
	SodiumMgPer100g       float64           `gorm:"column:sodium_mg_per_100g" json:"sodium_mg_per_100g"`
	PotassiumMgPer100g    float64           `gorm:"column:potassium_mg_per_100g" json:"potassium_mg_per_100g"`
	CalciumMgPer100g      float64           `gorm:"column:calcium_mg_per_100g" json:"calcium_mg_per_100g"`
	IronMgPer100g         float64           `gorm:"column:iron_mg_per_100g" json:"iron_mg_per_100g"`
	MagnesiumMgPer100g    float64           `gorm:"column:magnesium_mg_per_100g" json:"magnesium_mg_per_100g"`
	ZincMgPer100g         float64           `gorm:"column:zinc_mg_per_100g" json:"zinc_mg_per_100g"`
	VitaminARaeMcgPer100g float64           `gorm:"column:vitamin_a_rae_mcg_per_100g" json:"vitamin_a_rae_mcg_per_100g"`
	VitaminCMgPer100g     float64           `gorm:"column:vitamin_c_mg_per_100g" json:"vitamin_c_mg_per_100g"`
	VitaminDMcgPer100g    float64           `gorm:"column:vitamin_d_mcg_per_100g" json:"vitamin_d_mcg_per_100g"`
	VitaminEMgPer100g     float64           `gorm:"column:vitamin_e_mg_per_100g" json:"vitamin_e_mg_per_100g"`
	VitaminKMcgPer100g    float64           `gorm:"column:vitamin_k_mcg_per_100g" json:"vitamin_k_mcg_per_100g"`
	ThiaminMgPer100g      float64           `gorm:"column:thiamin_mg_per_100g" json:"thiamin_mg_per_100g"`
	RiboflavinMgPer100g   float64           `gorm:"column:riboflavin_mg_per_100g" json:"riboflavin_mg_per_100g"`
	NiacinMgPer100g       float64           `gorm:"column:niacin_mg_per_100g" json:"niacin_mg_per_100g"`
	VitaminB6MgPer100g    float64           `gorm:"column:vitamin_b6_mg_per_100g" json:"vitamin_b6_mg_per_100g"`
	FolateMcgPer100g      float64           `gorm:"column:folate_mcg_per_100g" json:"folate_mcg_per_100g"`
	VitaminB12McgPer100g  float64           `gorm:"column:vitamin_b12_mcg_per_100g" json:"vitamin_b12_mcg_per_100g"`
	ImagePath             *string           `gorm:"column:image_path" json:"image_path,omitempty"`
	ImagePaths            []string          `gorm:"column:image_paths;serializer:json" json:"image_paths,omitempty"`
	ImageSourceURL        *string           `gorm:"column:image_source_url" json:"image_source_url,omitempty"`
	ImageSourceLabel      *string           `gorm:"column:image_source_label" json:"image_source_label,omitempty"`
	ImageLicense          *string           `gorm:"column:image_license" json:"image_license,omitempty"`
	Source                string            `gorm:"column:source" json:"source"`
	IsActive              bool              `gorm:"column:is_active" json:"is_active"`
	QualityTier           string            `gorm:"column:quality_tier" json:"quality_tier"`
	QualityEvidence       datatypes.JSONMap `gorm:"column:quality_evidence" json:"quality_evidence,omitempty"`
	QualityReviewedAt     *time.Time        `gorm:"column:quality_reviewed_at" json:"quality_reviewed_at,omitempty"`
}

func (FoodNutrition) TableName() string { return "food_nutrition_library" }

// PackagedFood — table: packaged_food_library
type PackagedFood struct {
	ID                    string         `gorm:"column:id" json:"id"`
	Brand                 string         `gorm:"column:brand" json:"brand"`
	ProductName           string         `gorm:"column:product_name" json:"product_name"`
	NormalizedName        string         `gorm:"column:normalized_name" json:"normalized_name"`
	ProductKey            string         `gorm:"column:product_key" json:"product_key"`
	DisplayName           string         `gorm:"column:display_name" json:"display_name"`
	SearchText            string         `gorm:"column:search_text" json:"search_text,omitempty"`
	ProductFamilyKey      string         `gorm:"column:product_family_key" json:"product_family_key,omitempty"`
	SpecText              *string        `gorm:"column:spec_text" json:"spec_text,omitempty"`
	Barcode               *string        `gorm:"column:barcode" json:"barcode,omitempty"`
	FlavorText            *string        `gorm:"column:flavor_text" json:"flavor_text,omitempty"`
	PackageCategory       *string        `gorm:"column:package_category" json:"package_category,omitempty"`
	IngredientsText       *string        `gorm:"column:ingredients_text" json:"ingredients_text,omitempty"`
	SourceImageURLs       []string       `gorm:"column:source_image_urls;serializer:json" json:"source_image_urls,omitempty"`
	OCRRawText            *string        `gorm:"column:ocr_raw_text" json:"ocr_raw_text,omitempty"`
	NutritionBasisUnit    *string        `gorm:"column:nutrition_basis_unit" json:"nutrition_basis_unit,omitempty"`
	EnergyUnitRaw         *string        `gorm:"column:energy_unit_raw" json:"energy_unit_raw,omitempty"`
	RawLabelPayload       map[string]any `gorm:"column:raw_label_payload;serializer:json" json:"raw_label_payload,omitempty"`
	ConversionStatus      *string        `gorm:"column:conversion_status" json:"conversion_status,omitempty"`
	ExtractConfidence     float64        `gorm:"column:extract_confidence" json:"extract_confidence"`
	FieldConfidence       map[string]any `gorm:"column:field_confidence;serializer:json" json:"field_confidence,omitempty"`
	IngestMethod          *string        `gorm:"column:ingest_method" json:"ingest_method,omitempty"`
	NetContentValue       float64        `gorm:"column:net_content_value" json:"net_content_value,omitempty"`
	NetContentUnit        *string        `gorm:"column:net_content_unit" json:"net_content_unit,omitempty"`
	UnitCount             float64        `gorm:"column:unit_count" json:"unit_count,omitempty"`
	UnitContentValue      float64        `gorm:"column:unit_content_value" json:"unit_content_value,omitempty"`
	UnitContentUnit       *string        `gorm:"column:unit_content_unit" json:"unit_content_unit,omitempty"`
	ReviewStatus          string         `gorm:"column:review_status" json:"review_status,omitempty"`
	NetWeightG            float64        `gorm:"column:net_weight_g" json:"net_weight_g"`
	ServingWeightG        float64        `gorm:"column:serving_weight_g" json:"serving_weight_g"`
	KcalPer100g           float64        `gorm:"column:kcal_per_100g" json:"kcal_per_100g"`
	ProteinPer100g        float64        `gorm:"column:protein_per_100g" json:"protein_per_100g"`
	CarbsPer100g          float64        `gorm:"column:carbs_per_100g" json:"carbs_per_100g"`
	FatPer100g            float64        `gorm:"column:fat_per_100g" json:"fat_per_100g"`
	FiberPer100g          float64        `gorm:"column:fiber_per_100g" json:"fiber_per_100g"`
	SugarPer100g          float64        `gorm:"column:sugar_per_100g" json:"sugar_per_100g"`
	SaturatedFatPer100g   float64        `gorm:"column:saturated_fat_per_100g" json:"saturated_fat_per_100g"`
	CholesterolMgPer100g  float64        `gorm:"column:cholesterol_mg_per_100g" json:"cholesterol_mg_per_100g"`
	SodiumMgPer100g       float64        `gorm:"column:sodium_mg_per_100g" json:"sodium_mg_per_100g"`
	PotassiumMgPer100g    float64        `gorm:"column:potassium_mg_per_100g" json:"potassium_mg_per_100g"`
	CalciumMgPer100g      float64        `gorm:"column:calcium_mg_per_100g" json:"calcium_mg_per_100g"`
	IronMgPer100g         float64        `gorm:"column:iron_mg_per_100g" json:"iron_mg_per_100g"`
	MagnesiumMgPer100g    float64        `gorm:"column:magnesium_mg_per_100g" json:"magnesium_mg_per_100g"`
	ZincMgPer100g         float64        `gorm:"column:zinc_mg_per_100g" json:"zinc_mg_per_100g"`
	VitaminARaeMcgPer100g float64        `gorm:"column:vitamin_a_rae_mcg_per_100g" json:"vitamin_a_rae_mcg_per_100g"`
	VitaminCMgPer100g     float64        `gorm:"column:vitamin_c_mg_per_100g" json:"vitamin_c_mg_per_100g"`
	VitaminDMcgPer100g    float64        `gorm:"column:vitamin_d_mcg_per_100g" json:"vitamin_d_mcg_per_100g"`
	VitaminEMgPer100g     float64        `gorm:"column:vitamin_e_mg_per_100g" json:"vitamin_e_mg_per_100g"`
	VitaminKMcgPer100g    float64        `gorm:"column:vitamin_k_mcg_per_100g" json:"vitamin_k_mcg_per_100g"`
	ThiaminMgPer100g      float64        `gorm:"column:thiamin_mg_per_100g" json:"thiamin_mg_per_100g"`
	RiboflavinMgPer100g   float64        `gorm:"column:riboflavin_mg_per_100g" json:"riboflavin_mg_per_100g"`
	NiacinMgPer100g       float64        `gorm:"column:niacin_mg_per_100g" json:"niacin_mg_per_100g"`
	VitaminB6MgPer100g    float64        `gorm:"column:vitamin_b6_mg_per_100g" json:"vitamin_b6_mg_per_100g"`
	FolateMcgPer100g      float64        `gorm:"column:folate_mcg_per_100g" json:"folate_mcg_per_100g"`
	VitaminB12McgPer100g  float64        `gorm:"column:vitamin_b12_mcg_per_100g" json:"vitamin_b12_mcg_per_100g"`
	SourceURL             string         `gorm:"column:source_url" json:"source_url"`
	Source                string         `gorm:"column:source" json:"source"`
	IsActive              bool           `gorm:"column:is_active" json:"is_active"`
}

func (PackagedFood) TableName() string { return "packaged_food_library" }

// PackagedFoodAlias — table: packaged_food_aliases
type PackagedFoodAlias struct {
	ID              string `gorm:"column:id" json:"id"`
	FoodID          string `gorm:"column:food_id" json:"food_id"`
	AliasName       string `gorm:"column:alias_name" json:"alias_name"`
	NormalizedAlias string `gorm:"column:normalized_alias" json:"normalized_alias"`
}

func (PackagedFoodAlias) TableName() string { return "packaged_food_aliases" }

// FoodNutritionAlias — table: food_nutrition_aliases
type FoodNutritionAlias struct {
	ID               string            `gorm:"column:id" json:"id"`
	FoodID           string            `gorm:"column:food_id" json:"food_id"`
	AliasName        string            `gorm:"column:alias_name" json:"alias_name"`
	NormalizedAlias  string            `gorm:"column:normalized_alias" json:"normalized_alias"`
	MatchStatus      string            `gorm:"column:match_status;not null;default:'candidate_only'" json:"match_status"`
	ApprovalEvidence datatypes.JSONMap `gorm:"column:approval_evidence;type:jsonb;not null;default:'{}'::jsonb" json:"approval_evidence,omitempty"`
	ReviewedAt       *time.Time        `gorm:"column:reviewed_at" json:"reviewed_at,omitempty"`
}

func (FoodNutritionAlias) TableName() string { return "food_nutrition_aliases" }

// FoodNutritionEmbedding stores precomputed retrieval vectors separately from
// nutrition facts. Vectors are candidate recall evidence only and never grant
// permission to reuse a nutrition row without the analyze-layer identity gate.
type FoodNutritionEmbedding struct {
	ID                  string    `json:"id" gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	IdentityKey         string    `json:"identityKey" gorm:"column:identity_key;type:text;not null;uniqueIndex:idx_food_nutrition_embeddings_identity_model,priority:1"`
	FoodID              string    `json:"foodId" gorm:"column:food_id;type:uuid;not null;index:idx_food_nutrition_embeddings_food_id"`
	SourceType          string    `json:"sourceType" gorm:"column:source_type;type:text;not null"`
	SourceID            string    `json:"sourceId" gorm:"column:source_id;type:uuid;not null"`
	EmbeddingText       string    `json:"embeddingText" gorm:"column:embedding_text;type:text;not null"`
	ContentHash         string    `json:"contentHash" gorm:"column:content_hash;type:text;not null"`
	EmbeddingModel      string    `json:"embeddingModel" gorm:"column:embedding_model;type:text;not null;uniqueIndex:idx_food_nutrition_embeddings_identity_model,priority:2"`
	EmbeddingDimensions int       `json:"embeddingDimensions" gorm:"column:embedding_dimensions;type:integer;not null;uniqueIndex:idx_food_nutrition_embeddings_identity_model,priority:3"`
	EmbeddingBytes      []byte    `json:"-" gorm:"column:embedding_bytes;type:bytea;not null"`
	IsActive            bool      `json:"isActive" gorm:"column:is_active;type:boolean;not null;default:true;index:idx_food_nutrition_embeddings_active_model"`
	CreatedAt           time.Time `json:"createdAt" gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt           time.Time `json:"updatedAt" gorm:"column:updated_at;type:timestamptz;not null;default:now();index:idx_food_nutrition_embeddings_active_model"`
}

func (FoodNutritionEmbedding) TableName() string { return "food_nutrition_embeddings" }

// FoodUnresolvedLog — table: food_unresolved_logs
type FoodUnresolvedLog struct {
	ID             string `gorm:"column:id" json:"id"`
	RawName        string `gorm:"column:raw_name" json:"raw_name"`
	NormalizedName string `gorm:"column:normalized_name" json:"normalized_name"`
	HitCount       int    `gorm:"column:hit_count" json:"hit_count"`
}

func (FoodUnresolvedLog) TableName() string { return "food_unresolved_logs" }

// CriticalSample — table: critical_samples_weapp
type CriticalSample struct {
	ID               string  `gorm:"column:id" json:"id"`
	UserID           string  `gorm:"column:user_id" json:"user_id"`
	ImagePath        *string `gorm:"column:image_path" json:"image_path,omitempty"`
	FoodName         string  `gorm:"column:food_name" json:"food_name"`
	AIWeight         float64 `gorm:"column:ai_weight" json:"ai_weight"`
	UserWeight       float64 `gorm:"column:user_weight" json:"user_weight"`
	DeviationPercent float64 `gorm:"column:deviation_percent" json:"deviation_percent"`
}

func (CriticalSample) TableName() string { return "critical_samples_weapp" }
