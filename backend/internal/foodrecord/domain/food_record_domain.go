package domain

import "time"

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
	Nutrients          FoodItemNutrients `json:"nutrients"`
	ManualSource       *string           `json:"manual_source,omitempty"`
	ManualSourceID     *string           `json:"manual_source_id,omitempty"`
	ManualSourceTitle  *string           `json:"manual_source_title,omitempty"`
	ManualPortionLabel *string           `json:"manual_portion_label,omitempty"`
}

type FoodItemNutrients struct {
	Calories float64 `json:"calories"`
	Protein  float64 `json:"protein"`
	Carbs    float64 `json:"carbs"`
	Fat      float64 `json:"fat"`
	Fiber    float64 `json:"fiber"`
	Sugar    float64 `json:"sugar"`
	SodiumMg float64 `json:"sodium_mg"`
}

// FoodNutrition — table: food_nutrition_library (read-only)
type FoodNutrition struct {
	ID              string  `gorm:"column:id" json:"id"`
	CanonicalName   string  `gorm:"column:canonical_name" json:"canonical_name"`
	KcalPer100g     float64 `gorm:"column:kcal_per_100g" json:"kcal_per_100g"`
	ProteinPer100g  float64 `gorm:"column:protein_per_100g" json:"protein_per_100g"`
	CarbsPer100g    float64 `gorm:"column:carbs_per_100g" json:"carbs_per_100g"`
	FatPer100g      float64 `gorm:"column:fat_per_100g" json:"fat_per_100g"`
	FiberPer100g    float64 `gorm:"column:fiber_per_100g" json:"fiber_per_100g"`
	SugarPer100g    float64 `gorm:"column:sugar_per_100g" json:"sugar_per_100g"`
	SodiumMgPer100g float64 `gorm:"column:sodium_mg_per_100g" json:"sodium_mg_per_100g"`
	IsActive        bool    `gorm:"column:is_active" json:"is_active"`
}

func (FoodNutrition) TableName() string { return "food_nutrition_library" }

// FoodNutritionAlias — table: food_nutrition_aliases
type FoodNutritionAlias struct {
	ID        string `gorm:"column:id" json:"id"`
	FoodID    string `gorm:"column:food_id" json:"food_id"`
	AliasName string `gorm:"column:alias_name" json:"alias_name"`
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
