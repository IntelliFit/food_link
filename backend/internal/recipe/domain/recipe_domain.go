package domain

import (
	"database/sql/driver"
	"fmt"
	"strings"
	"time"
)

type StringArray []string

func (a StringArray) Value() (driver.Value, error) {
	if a == nil {
		return nil, nil
	}
	escaped := make([]string, 0, len(a))
	for _, s := range a {
		s = strings.ReplaceAll(s, `\`, `\\`)
		s = strings.ReplaceAll(s, `"`, `\"`)
		escaped = append(escaped, `"`+s+`"`)
	}
	return "{" + strings.Join(escaped, ",") + "}", nil
}

func (a *StringArray) Scan(value any) error {
	if value == nil {
		*a = nil
		return nil
	}
	var raw string
	switch v := value.(type) {
	case string:
		raw = v
	case []byte:
		raw = string(v)
	default:
		return fmt.Errorf("scan string array: unsupported %T", value)
	}
	raw = strings.Trim(raw, "{}")
	if raw == "" {
		*a = []string{}
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.Trim(p, `"`)
		p = strings.ReplaceAll(p, `\"`, `"`)
		p = strings.ReplaceAll(p, `\\`, `\`)
		out = append(out, p)
	}
	*a = out
	return nil
}

type Recipe struct {
	ID               string           `gorm:"column:id" json:"id"`
	UserID           string           `gorm:"column:user_id" json:"user_id"`
	RecipeName       string           `gorm:"column:recipe_name" json:"recipe_name"`
	Description      *string          `gorm:"column:description" json:"description,omitempty"`
	ImagePath        *string          `gorm:"column:image_path" json:"image_path,omitempty"`
	Items            []map[string]any `gorm:"column:items;serializer:json" json:"items"`
	TotalCalories    float64          `gorm:"column:total_calories" json:"total_calories"`
	TotalProtein     float64          `gorm:"column:total_protein" json:"total_protein"`
	TotalCarbs       float64          `gorm:"column:total_carbs" json:"total_carbs"`
	TotalFat         float64          `gorm:"column:total_fat" json:"total_fat"`
	TotalWeightGrams float64          `gorm:"column:total_weight_grams" json:"total_weight_grams"`
	Tags             StringArray      `gorm:"column:tags;type:text[]" json:"tags"`
	MealType         *string          `gorm:"column:meal_type" json:"meal_type,omitempty"`
	IsFavorite       bool             `gorm:"column:is_favorite" json:"is_favorite"`
	SourceTaskID     *string          `gorm:"column:source_task_id" json:"source_task_id,omitempty"`
	UseCount         int              `gorm:"column:use_count" json:"use_count"`
	LastUsedAt       *time.Time       `gorm:"column:last_used_at" json:"last_used_at,omitempty"`
	CreatedAt        *time.Time       `gorm:"column:created_at" json:"created_at"`
	UpdatedAt        *time.Time       `gorm:"column:updated_at" json:"updated_at"`
}

func (Recipe) TableName() string { return "user_recipes" }

type FoodRecord struct {
	ID               string           `gorm:"column:id" json:"id"`
	UserID           string           `gorm:"column:user_id" json:"user_id"`
	MealType         string           `gorm:"column:meal_type" json:"meal_type"`
	ImagePath        *string          `gorm:"column:image_path" json:"image_path,omitempty"`
	Description      *string          `gorm:"column:description" json:"description,omitempty"`
	Items            []map[string]any `gorm:"column:items;serializer:json" json:"items"`
	TotalCalories    float64          `gorm:"column:total_calories" json:"total_calories"`
	TotalProtein     float64          `gorm:"column:total_protein" json:"total_protein"`
	TotalCarbs       float64          `gorm:"column:total_carbs" json:"total_carbs"`
	TotalFat         float64          `gorm:"column:total_fat" json:"total_fat"`
	TotalWeightGrams int              `gorm:"column:total_weight_grams" json:"total_weight_grams"`
	EntryType        *string          `gorm:"column:entry_type" json:"entry_type,omitempty"`
	RecipeID         *string          `gorm:"column:recipe_id" json:"recipe_id,omitempty"`
	RecordTime       *time.Time       `gorm:"column:record_time" json:"record_time"`
	CreatedAt        *time.Time       `gorm:"column:created_at" json:"created_at"`
}

func (FoodRecord) TableName() string { return "user_food_records" }
