package domain

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

type ManualFoodNutrients struct {
	Calories float64 `json:"calories"`
	Protein  float64 `json:"protein"`
	Carbs    float64 `json:"carbs"`
	Fat      float64 `json:"fat"`
	Fiber    float64 `json:"fiber"`
	Sugar    float64 `json:"sugar"`
	SodiumMg float64 `json:"sodium_mg,omitempty"`
}

type ManualFoodResult struct {
	ID                  string               `json:"id"`
	Source              string               `json:"source"`
	Title               string               `json:"title"`
	Subtitle            string               `json:"subtitle"`
	Category            string               `json:"category,omitempty"`
	DefaultWeightGrams  float64              `json:"default_weight_grams"`
	TotalCalories       float64              `json:"total_calories"`
	TotalProtein        float64              `json:"total_protein"`
	TotalCarbs          float64              `json:"total_carbs"`
	TotalFat            float64              `json:"total_fat"`
	NutrientsPer100g    *ManualFoodNutrients `json:"nutrients_per_100g,omitempty"`
	ExtraNutrients      *ManualFoodNutrients `json:"extra_nutrients,omitempty"`
	Items               []map[string]any     `json:"items,omitempty"`
	ImagePath           *string              `json:"image_path,omitempty"`
	ImagePaths          []string             `json:"image_paths,omitempty"`
	PortionLabel        string               `json:"portion_label,omitempty"`
	SourceLabel         string               `json:"source_label,omitempty"`
	RecommendReason     string               `json:"recommend_reason,omitempty"`
	NutritionHighlights []string             `json:"nutrition_highlights,omitempty"`
	UsageCount          int                  `json:"usage_count,omitempty"`
	Collected           bool                 `json:"collected,omitempty"`
	LikeCount           int                  `json:"like_count,omitempty"`
	CollectionCount     int                  `json:"collection_count,omitempty"`
	MatchScore          float64              `json:"match_score,omitempty"`
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
