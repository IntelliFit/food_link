package domain

import "time"

// ManualFood — table: manual_food_library
type ManualFood struct {
	ID       string  `gorm:"column:id" json:"id"`
	Name     string  `gorm:"column:name" json:"name"`
	Category string  `gorm:"column:category" json:"category"`
	Calories float64 `gorm:"column:calories" json:"calories"`
	Protein  float64 `gorm:"column:protein" json:"protein"`
	Carbs    float64 `gorm:"column:carbs" json:"carbs"`
	Fat      float64 `gorm:"column:fat" json:"fat"`
}

func (ManualFood) TableName() string { return "manual_food_library" }

type UserCustomFood struct {
	ID                 string         `gorm:"column:id" json:"id"`
	UserID             string         `gorm:"column:user_id" json:"user_id"`
	Title              string         `gorm:"column:title" json:"title"`
	NormalizedTitle    string         `gorm:"column:normalized_title" json:"normalized_title"`
	Category           string         `gorm:"column:category" json:"category"`
	DefaultWeightGrams float64        `gorm:"column:default_weight_grams" json:"default_weight_grams"`
	TotalCalories      float64        `gorm:"column:total_calories" json:"total_calories"`
	TotalProtein       float64        `gorm:"column:total_protein" json:"total_protein"`
	TotalCarbs         float64        `gorm:"column:total_carbs" json:"total_carbs"`
	TotalFat           float64        `gorm:"column:total_fat" json:"total_fat"`
	NutrientsPer100g   map[string]any `gorm:"column:nutrients_per_100g;serializer:json" json:"nutrients_per_100g"`
	ExtraNutrients     map[string]any `gorm:"column:extra_nutrients;serializer:json" json:"extra_nutrients"`
	ImagePath          *string        `gorm:"column:image_path" json:"image_path,omitempty"`
	ImagePaths         []string       `gorm:"column:image_paths;serializer:json" json:"image_paths,omitempty"`
	PortionLabel       string         `gorm:"column:portion_label" json:"portion_label"`
	RecommendReason    string         `gorm:"column:recommend_reason" json:"recommend_reason"`
	PublicStatus       string         `gorm:"column:public_status" json:"public_status"`
	PublicFoodItemID   *string        `gorm:"column:public_food_item_id" json:"public_food_item_id,omitempty"`
	Status             string         `gorm:"column:status" json:"status"`
	CreatedAt          *time.Time     `gorm:"column:created_at" json:"created_at"`
	UpdatedAt          *time.Time     `gorm:"column:updated_at" json:"updated_at"`
}

func (UserCustomFood) TableName() string { return "user_custom_foods" }

type ManualFoodNutrients struct {
	Calories       float64 `json:"calories"`
	Protein        float64 `json:"protein"`
	Carbs          float64 `json:"carbs"`
	Fat            float64 `json:"fat"`
	Fiber          float64 `json:"fiber"`
	Sugar          float64 `json:"sugar"`
	SaturatedFat   float64 `json:"saturatedFat,omitempty"`
	CholesterolMg  float64 `json:"cholesterolMg,omitempty"`
	SodiumMg       float64 `json:"sodium_mg,omitempty"`
	PotassiumMg    float64 `json:"potassiumMg,omitempty"`
	CalciumMg      float64 `json:"calciumMg,omitempty"`
	IronMg         float64 `json:"ironMg,omitempty"`
	MagnesiumMg    float64 `json:"magnesiumMg,omitempty"`
	ZincMg         float64 `json:"zincMg,omitempty"`
	VitaminARaeMcg float64 `json:"vitaminARaeMcg,omitempty"`
	VitaminCMg     float64 `json:"vitaminCMg,omitempty"`
	VitaminDMcg    float64 `json:"vitaminDMcg,omitempty"`
	VitaminEMg     float64 `json:"vitaminEMg,omitempty"`
	VitaminKMcg    float64 `json:"vitaminKMcg,omitempty"`
	ThiaminMg      float64 `json:"thiaminMg,omitempty"`
	RiboflavinMg   float64 `json:"riboflavinMg,omitempty"`
	NiacinMg       float64 `json:"niacinMg,omitempty"`
	VitaminB6Mg    float64 `json:"vitaminB6Mg,omitempty"`
	FolateMcg      float64 `json:"folateMcg,omitempty"`
	VitaminB12Mcg  float64 `json:"vitaminB12Mcg,omitempty"`
}

type ManualFoodServingPreset struct {
	Label    string  `json:"label"`
	Grams    float64 `json:"grams"`
	Quantity float64 `json:"quantity"`
}

type ManualFoodResult struct {
	ID                  string                    `json:"id"`
	Source              string                    `json:"source"`
	Title               string                    `json:"title"`
	Subtitle            string                    `json:"subtitle"`
	Category            string                    `json:"category,omitempty"`
	DefaultWeightGrams  float64                   `json:"default_weight_grams"`
	DisplayUnit         string                    `json:"display_unit,omitempty"`
	DisplayUnitLabel    string                    `json:"display_unit_label,omitempty"`
	ServingPresets      []ManualFoodServingPreset `json:"serving_presets,omitempty"`
	TotalCalories       float64                   `json:"total_calories"`
	TotalProtein        float64                   `json:"total_protein"`
	TotalCarbs          float64                   `json:"total_carbs"`
	TotalFat            float64                   `json:"total_fat"`
	NutrientsPer100g    *ManualFoodNutrients      `json:"nutrients_per_100g,omitempty"`
	ExtraNutrients      *ManualFoodNutrients      `json:"extra_nutrients,omitempty"`
	Items               []map[string]any          `json:"items,omitempty"`
	ImagePath           *string                   `json:"image_path,omitempty"`
	ImagePaths          []string                  `json:"image_paths,omitempty"`
	PortionLabel        string                    `json:"portion_label,omitempty"`
	SourceLabel         string                    `json:"source_label,omitempty"`
	RecommendReason     string                    `json:"recommend_reason,omitempty"`
	NutritionHighlights []string                  `json:"nutrition_highlights,omitempty"`
	UsageCount          int                       `json:"usage_count,omitempty"`
	Collected           bool                      `json:"collected,omitempty"`
	LikeCount           int                       `json:"like_count,omitempty"`
	CollectionCount     int                       `json:"collection_count,omitempty"`
	MatchScore          float64                   `json:"match_score,omitempty"`
}

type ManualFoodBrowseStats struct {
	NutritionFoodCount  int64 `json:"nutrition_food_count"`
	NutritionAliasCount int64 `json:"nutrition_alias_count"`
	PublicFoodCount     int64 `json:"public_food_count"`
}

type ManualFoodBrowseResult struct {
	RecentItems            []ManualFoodResult     `json:"recent_items"`
	CollectedPublicLibrary []ManualFoodResult     `json:"collected_public_library"`
	PublicLibrary          []ManualFoodResult     `json:"public_library"`
	NutritionLibrary       []ManualFoodResult     `json:"nutrition_library"`
	Stats                  *ManualFoodBrowseStats `json:"stats,omitempty"`
}

type ManualFoodCatalogCategory struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int    `json:"count,omitempty"`
}

type ManualFoodCatalogResult struct {
	Categories []ManualFoodCatalogCategory `json:"categories"`
	Items      []ManualFoodResult          `json:"items"`
	Category   string                      `json:"category"`
	Page       int                         `json:"page"`
	PageSize   int                         `json:"page_size"`
	HasMore    bool                        `json:"has_more"`
	Stats      *ManualFoodBrowseStats      `json:"stats,omitempty"`
}
