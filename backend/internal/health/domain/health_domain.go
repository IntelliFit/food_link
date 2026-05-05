package domain

import "time"

// BodyWeightRecord — table: user_weight_records
type BodyWeightRecord struct {
	ID         string     `gorm:"column:id"`
	UserID     string     `gorm:"column:user_id"`
	WeightKg   float64    `gorm:"column:weight_kg"`
	RecordedOn *time.Time `gorm:"column:recorded_on"`
	CreatedAt  *time.Time `gorm:"column:created_at"`
}

func (BodyWeightRecord) TableName() string { return "user_weight_records" }

// BodyWaterLog — table: user_water_logs
type BodyWaterLog struct {
	ID         string     `gorm:"column:id"`
	UserID     string     `gorm:"column:user_id"`
	AmountMl   int        `gorm:"column:amount_ml"`
	RecordedOn *time.Time `gorm:"column:recorded_on"`
	CreatedAt  *time.Time `gorm:"column:created_at"`
}

func (BodyWaterLog) TableName() string { return "user_water_logs" }

// ExerciseLog — table: user_exercise_logs
type ExerciseLog struct {
	ID             string     `gorm:"column:id"`
	UserID         string     `gorm:"column:user_id"`
	ExerciseDesc   string     `gorm:"column:exercise_desc"`
	CaloriesBurned *float64   `gorm:"column:calories_burned"`
	DurationMin    *int       `gorm:"column:duration_min"`
	RecordedOn     *time.Time `gorm:"column:recorded_on"`
	CreatedAt      *time.Time `gorm:"column:created_at"`
}

func (ExerciseLog) TableName() string { return "user_exercise_logs" }

// StatsInsight — table: user_stats_insights
type StatsInsight struct {
	ID        string     `gorm:"column:id"`
	UserID    string     `gorm:"column:user_id"`
	Content   string     `gorm:"column:content"`
	DateRange string     `gorm:"column:date_range"`
	CreatedAt *time.Time `gorm:"column:created_at"`
}

func (StatsInsight) TableName() string { return "user_stats_insights" }

// FoodRecord — minimal projection for stats aggregation (table: user_food_records)
type FoodRecord struct {
	ID            string     `gorm:"column:id"`
	UserID        string     `gorm:"column:user_id"`
	MealType      string     `gorm:"column:meal_type"`
	TotalCalories float64    `gorm:"column:total_calories"`
	TotalProtein  float64    `gorm:"column:total_protein"`
	TotalCarbs    float64    `gorm:"column:total_carbs"`
	TotalFat      float64    `gorm:"column:total_fat"`
	RecordTime    *time.Time `gorm:"column:record_time"`
}

func (FoodRecord) TableName() string { return "user_food_records" }

// AnalysisTask — table: analysis_tasks
type AnalysisTask struct {
	ID        string         `gorm:"column:id"`
	UserID    string         `gorm:"column:user_id"`
	TaskType  string         `gorm:"column:task_type"`
	Status    string         `gorm:"column:status"`
	TextInput *string        `gorm:"column:text_input"`
	Payload   map[string]any `gorm:"column:payload;serializer:json"`
	CreatedAt *time.Time     `gorm:"column:created_at"`
}

func (AnalysisTask) TableName() string { return "analysis_tasks" }

// BodyMetricSettings — table: user_body_metric_settings
type BodyMetricSettings struct {
	UserID       string `gorm:"column:user_id;primaryKey"`
	WaterGoalMl  int    `gorm:"column:water_goal_ml"`
}

func (BodyMetricSettings) TableName() string { return "user_body_metric_settings" }
