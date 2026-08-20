package domain

import "time"

type FoodNutritionContribution struct {
	ID                 string         `gorm:"column:id;primaryKey" json:"id"`
	UserID             string         `gorm:"column:user_id" json:"user_id"`
	CanonicalName      string         `gorm:"column:canonical_name" json:"canonical_name"`
	NormalizedName     string         `gorm:"column:normalized_name" json:"normalized_name"`
	KcalPer100g        float64        `gorm:"column:kcal_per_100g" json:"kcal_per_100g"`
	ProteinPer100g     float64        `gorm:"column:protein_per_100g" json:"protein_per_100g"`
	CarbsPer100g       float64        `gorm:"column:carbs_per_100g" json:"carbs_per_100g"`
	FatPer100g         float64        `gorm:"column:fat_per_100g" json:"fat_per_100g"`
	SourceText         string         `gorm:"column:source_text" json:"source_text"`
	EvidenceImagePaths []string       `gorm:"column:evidence_image_paths;serializer:json" json:"evidence_image_paths"`
	ExtraNutrients     map[string]any `gorm:"column:extra_nutrients;serializer:json" json:"extra_nutrients,omitempty"`
	Status             string         `gorm:"column:status" json:"status"`
	ReviewAction       *string        `gorm:"column:review_action" json:"review_action,omitempty"`
	ReviewNote         string         `gorm:"column:review_note" json:"review_note"`
	ReviewedBy         *string        `gorm:"column:reviewed_by" json:"reviewed_by,omitempty"`
	ReviewedAt         *time.Time     `gorm:"column:reviewed_at" json:"reviewed_at,omitempty"`
	TargetFoodID       *string        `gorm:"column:target_food_id" json:"target_food_id,omitempty"`
	LegacyCustomFoodID *string        `gorm:"column:legacy_custom_food_id" json:"legacy_custom_food_id,omitempty"`
	RewardedAt         *time.Time     `gorm:"column:rewarded_at" json:"rewarded_at,omitempty"`
	CreatedAt          time.Time      `gorm:"column:created_at" json:"created_at"`
	UpdatedAt          time.Time      `gorm:"column:updated_at" json:"updated_at"`
}

func (FoodNutritionContribution) TableName() string { return "food_nutrition_contributions" }
