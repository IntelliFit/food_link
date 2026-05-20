package domain

import "time"

type DailyNutritionTarget struct {
	ID            string     `gorm:"column:id"`
	UserID        string     `gorm:"column:user_id"`
	TargetDate    time.Time  `gorm:"column:target_date"`
	CalorieTarget float64    `gorm:"column:calorie_target"`
	ProteinTarget float64    `gorm:"column:protein_target"`
	CarbsTarget   float64    `gorm:"column:carbs_target"`
	FatTarget     float64    `gorm:"column:fat_target"`
	Source        string     `gorm:"column:source"`
	CreatedAt     *time.Time `gorm:"column:created_at"`
	UpdatedAt     *time.Time `gorm:"column:updated_at"`
}

func (DailyNutritionTarget) TableName() string { return "user_daily_nutrition_targets" }
