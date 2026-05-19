package domain

import (
	"encoding/json"
	"time"
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
	RecordTime       *time.Time `gorm:"column:record_time" json:"record_time"`
	CreatedAt        *time.Time `gorm:"column:created_at" json:"created_at"`
}

func (FoodRecord) TableName() string { return "user_food_records" }

type FoodItem struct {
	Name               string            `json:"name"`
	Weight             float64           `json:"weight"`
	Ratio              float64           `json:"ratio"`
	Intake             float64           `json:"intake"`
	WaterMl            float64           `json:"water_ml,omitempty"`
	Nutrients          FoodItemNutrients `json:"nutrients"`
	ManualSource       *string           `json:"manual_source,omitempty"`
	ManualSourceID     *string           `json:"manual_source_id,omitempty"`
	ManualSourceTitle  *string           `json:"manual_source_title,omitempty"`
	ManualPortionLabel *string           `json:"manual_portion_label,omitempty"`
}

func (f *FoodItem) UnmarshalJSON(data []byte) error {
	type Alias FoodItem
	aux := struct {
		*Alias
		WaterMlCamel *float64       `json:"waterMl"`
		WaterMlSnake *float64       `json:"water_ml"`
		NutrientsRaw map[string]any `json:"nutrients"`
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
	switch {
	case aux.WaterMlSnake != nil:
		f.WaterMl = *aux.WaterMlSnake
	case aux.WaterMlCamel != nil:
		f.WaterMl = *aux.WaterMlCamel
	case f.WaterMl <= 0 && aux.NutrientsRaw != nil:
		f.WaterMl = numberFromAny(aux.NutrientsRaw["water_ml"])
		if f.WaterMl <= 0 {
			f.WaterMl = numberFromAny(aux.NutrientsRaw["waterMl"])
		}
	}
	if raw.Ratio == nil {
		if raw.Intake != nil && raw.Weight != nil && *raw.Intake >= 0 && *raw.Weight > 0 {
			f.Ratio = *raw.Intake / *raw.Weight * 100
		} else {
			f.Ratio = 100
		}
	}
	if raw.Intake == nil && f.Weight > 0 {
		f.Intake = f.Weight * f.Ratio / 100
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
	ID                    string  `gorm:"column:id" json:"id"`
	CanonicalName         string  `gorm:"column:canonical_name" json:"canonical_name"`
	NormalizedName        string  `gorm:"column:normalized_name" json:"normalized_name"`
	KcalPer100g           float64 `gorm:"column:kcal_per_100g" json:"kcal_per_100g"`
	ProteinPer100g        float64 `gorm:"column:protein_per_100g" json:"protein_per_100g"`
	CarbsPer100g          float64 `gorm:"column:carbs_per_100g" json:"carbs_per_100g"`
	FatPer100g            float64 `gorm:"column:fat_per_100g" json:"fat_per_100g"`
	FiberPer100g          float64 `gorm:"column:fiber_per_100g" json:"fiber_per_100g"`
	SugarPer100g          float64 `gorm:"column:sugar_per_100g" json:"sugar_per_100g"`
	SaturatedFatPer100g   float64 `gorm:"column:saturated_fat_per_100g" json:"saturated_fat_per_100g"`
	CholesterolMgPer100g  float64 `gorm:"column:cholesterol_mg_per_100g" json:"cholesterol_mg_per_100g"`
	SodiumMgPer100g       float64 `gorm:"column:sodium_mg_per_100g" json:"sodium_mg_per_100g"`
	PotassiumMgPer100g    float64 `gorm:"column:potassium_mg_per_100g" json:"potassium_mg_per_100g"`
	CalciumMgPer100g      float64 `gorm:"column:calcium_mg_per_100g" json:"calcium_mg_per_100g"`
	IronMgPer100g         float64 `gorm:"column:iron_mg_per_100g" json:"iron_mg_per_100g"`
	MagnesiumMgPer100g    float64 `gorm:"column:magnesium_mg_per_100g" json:"magnesium_mg_per_100g"`
	ZincMgPer100g         float64 `gorm:"column:zinc_mg_per_100g" json:"zinc_mg_per_100g"`
	VitaminARaeMcgPer100g float64 `gorm:"column:vitamin_a_rae_mcg_per_100g" json:"vitamin_a_rae_mcg_per_100g"`
	VitaminCMgPer100g     float64 `gorm:"column:vitamin_c_mg_per_100g" json:"vitamin_c_mg_per_100g"`
	VitaminDMcgPer100g    float64 `gorm:"column:vitamin_d_mcg_per_100g" json:"vitamin_d_mcg_per_100g"`
	VitaminEMgPer100g     float64 `gorm:"column:vitamin_e_mg_per_100g" json:"vitamin_e_mg_per_100g"`
	VitaminKMcgPer100g    float64 `gorm:"column:vitamin_k_mcg_per_100g" json:"vitamin_k_mcg_per_100g"`
	ThiaminMgPer100g      float64 `gorm:"column:thiamin_mg_per_100g" json:"thiamin_mg_per_100g"`
	RiboflavinMgPer100g   float64 `gorm:"column:riboflavin_mg_per_100g" json:"riboflavin_mg_per_100g"`
	NiacinMgPer100g       float64 `gorm:"column:niacin_mg_per_100g" json:"niacin_mg_per_100g"`
	VitaminB6MgPer100g    float64 `gorm:"column:vitamin_b6_mg_per_100g" json:"vitamin_b6_mg_per_100g"`
	FolateMcgPer100g      float64 `gorm:"column:folate_mcg_per_100g" json:"folate_mcg_per_100g"`
	VitaminB12McgPer100g  float64 `gorm:"column:vitamin_b12_mcg_per_100g" json:"vitamin_b12_mcg_per_100g"`
	Source                string  `gorm:"column:source" json:"source"`
	IsActive              bool    `gorm:"column:is_active" json:"is_active"`
}

func (FoodNutrition) TableName() string { return "food_nutrition_library" }

// PackagedFood — table: packaged_food_library
type PackagedFood struct {
	ID                    string  `gorm:"column:id" json:"id"`
	Brand                 string  `gorm:"column:brand" json:"brand"`
	ProductName           string  `gorm:"column:product_name" json:"product_name"`
	NormalizedName        string  `gorm:"column:normalized_name" json:"normalized_name"`
	NetWeightG            float64 `gorm:"column:net_weight_g" json:"net_weight_g"`
	ServingWeightG        float64 `gorm:"column:serving_weight_g" json:"serving_weight_g"`
	KcalPer100g           float64 `gorm:"column:kcal_per_100g" json:"kcal_per_100g"`
	ProteinPer100g        float64 `gorm:"column:protein_per_100g" json:"protein_per_100g"`
	CarbsPer100g          float64 `gorm:"column:carbs_per_100g" json:"carbs_per_100g"`
	FatPer100g            float64 `gorm:"column:fat_per_100g" json:"fat_per_100g"`
	FiberPer100g          float64 `gorm:"column:fiber_per_100g" json:"fiber_per_100g"`
	SugarPer100g          float64 `gorm:"column:sugar_per_100g" json:"sugar_per_100g"`
	SaturatedFatPer100g   float64 `gorm:"column:saturated_fat_per_100g" json:"saturated_fat_per_100g"`
	CholesterolMgPer100g  float64 `gorm:"column:cholesterol_mg_per_100g" json:"cholesterol_mg_per_100g"`
	SodiumMgPer100g       float64 `gorm:"column:sodium_mg_per_100g" json:"sodium_mg_per_100g"`
	PotassiumMgPer100g    float64 `gorm:"column:potassium_mg_per_100g" json:"potassium_mg_per_100g"`
	CalciumMgPer100g      float64 `gorm:"column:calcium_mg_per_100g" json:"calcium_mg_per_100g"`
	IronMgPer100g         float64 `gorm:"column:iron_mg_per_100g" json:"iron_mg_per_100g"`
	MagnesiumMgPer100g    float64 `gorm:"column:magnesium_mg_per_100g" json:"magnesium_mg_per_100g"`
	ZincMgPer100g         float64 `gorm:"column:zinc_mg_per_100g" json:"zinc_mg_per_100g"`
	VitaminARaeMcgPer100g float64 `gorm:"column:vitamin_a_rae_mcg_per_100g" json:"vitamin_a_rae_mcg_per_100g"`
	VitaminCMgPer100g     float64 `gorm:"column:vitamin_c_mg_per_100g" json:"vitamin_c_mg_per_100g"`
	VitaminDMcgPer100g    float64 `gorm:"column:vitamin_d_mcg_per_100g" json:"vitamin_d_mcg_per_100g"`
	VitaminEMgPer100g     float64 `gorm:"column:vitamin_e_mg_per_100g" json:"vitamin_e_mg_per_100g"`
	VitaminKMcgPer100g    float64 `gorm:"column:vitamin_k_mcg_per_100g" json:"vitamin_k_mcg_per_100g"`
	ThiaminMgPer100g      float64 `gorm:"column:thiamin_mg_per_100g" json:"thiamin_mg_per_100g"`
	RiboflavinMgPer100g   float64 `gorm:"column:riboflavin_mg_per_100g" json:"riboflavin_mg_per_100g"`
	NiacinMgPer100g       float64 `gorm:"column:niacin_mg_per_100g" json:"niacin_mg_per_100g"`
	VitaminB6MgPer100g    float64 `gorm:"column:vitamin_b6_mg_per_100g" json:"vitamin_b6_mg_per_100g"`
	FolateMcgPer100g      float64 `gorm:"column:folate_mcg_per_100g" json:"folate_mcg_per_100g"`
	VitaminB12McgPer100g  float64 `gorm:"column:vitamin_b12_mcg_per_100g" json:"vitamin_b12_mcg_per_100g"`
	SourceURL             string  `gorm:"column:source_url" json:"source_url"`
	Source                string  `gorm:"column:source" json:"source"`
	IsActive              bool    `gorm:"column:is_active" json:"is_active"`
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
	ID              string `gorm:"column:id" json:"id"`
	FoodID          string `gorm:"column:food_id" json:"food_id"`
	AliasName       string `gorm:"column:alias_name" json:"alias_name"`
	NormalizedAlias string `gorm:"column:normalized_alias" json:"normalized_alias"`
}

func (FoodNutritionAlias) TableName() string { return "food_nutrition_aliases" }

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
