package do

import "time"

type MealRecommendationMemoryDO struct {
	ID            string     `gorm:"column:id;type:uuid;primaryKey"`
	UserID        string     `gorm:"column:user_id;type:uuid;not null;index:idx_meal_memory_user_created,priority:1"`
	RunID         string     `gorm:"column:run_id;type:uuid;not null;index:idx_meal_memory_run"`
	ContextKey    string     `gorm:"column:context_key;type:varchar(64);not null"`
	OptionKey     string     `gorm:"column:option_key;type:varchar(64);not null"`
	SourceID      string     `gorm:"column:source_id;type:text;not null"`
	Fingerprint   string     `gorm:"column:fingerprint;type:varchar(64);not null"`
	Family        string     `gorm:"column:family;type:varchar(64);not null"`
	MealDate      string     `gorm:"column:meal_date;type:varchar(10);not null"`
	MealType      string     `gorm:"column:meal_type;type:varchar(16);not null"`
	EngineVersion string     `gorm:"column:engine_version;type:varchar(64);not null"`
	CreatedAt     time.Time  `gorm:"column:created_at;type:timestamptz;not null;index:idx_meal_memory_user_created,priority:2,sort:desc"`
	ShownAt       *time.Time `gorm:"column:shown_at;type:timestamptz"`
	SkippedAt     *time.Time `gorm:"column:skipped_at;type:timestamptz"`
	SelectedAt    *time.Time `gorm:"column:selected_at;type:timestamptz"`
}

func (MealRecommendationMemoryDO) TableName() string { return "meal_recommendation_memory" }
