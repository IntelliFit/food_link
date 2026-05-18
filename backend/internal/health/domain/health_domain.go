package domain

import "time"

// BodyWeightRecord — table: user_weight_records
type BodyWeightRecord struct {
	ID             string     `gorm:"column:id"`
	UserID         string     `gorm:"column:user_id"`
	WeightKg       float64    `gorm:"column:weight_kg"`
	RecordedOn     *time.Time `gorm:"column:recorded_on"`
	ClientRecordID *string    `gorm:"column:client_record_id"`
	SourceType     string     `gorm:"column:source_type"`
	CreatedAt      *time.Time `gorm:"column:created_at"`
}

func (BodyWeightRecord) TableName() string { return "user_weight_records" }

// BodyWaterLog — table: user_water_logs
type BodyWaterLog struct {
	ID         string     `gorm:"column:id"`
	UserID     string     `gorm:"column:user_id"`
	AmountMl   int        `gorm:"column:amount_ml"`
	RecordedOn *time.Time `gorm:"column:recorded_on"`
	SourceType string     `gorm:"column:source_type"`
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
	RecordedAt     *time.Time `gorm:"column:recorded_at"`
	AIReasoning    *string    `gorm:"column:ai_reasoning"`
	CreatedAt      *time.Time `gorm:"column:created_at"`
}

func (ExerciseLog) TableName() string { return "user_exercise_logs" }

// ExerciseUserProfile is the weapp_user projection needed for exercise
// calorie estimation profile snapshots.
type ExerciseUserProfile struct {
	ID            string   `gorm:"column:id"`
	Height        *float64 `gorm:"column:height"`
	Weight        *float64 `gorm:"column:weight"`
	Birthday      *string  `gorm:"column:birthday"`
	Gender        *string  `gorm:"column:gender"`
	ActivityLevel *string  `gorm:"column:activity_level"`
	BMR           *float64 `gorm:"column:bmr"`
	TDEE          *float64 `gorm:"column:tdee"`
}

func (ExerciseUserProfile) TableName() string { return "weapp_user" }

type BodyMetricUserProfile struct {
	ID              string         `gorm:"column:id"`
	Weight          *float64       `gorm:"column:weight"`
	Gender          *string        `gorm:"column:gender"`
	ActivityLevel   *string        `gorm:"column:activity_level"`
	HealthCondition map[string]any `gorm:"column:health_condition;serializer:json"`
}

func (BodyMetricUserProfile) TableName() string { return "weapp_user" }

// StatsInsight — table: ai_stats_insights
type StatsInsight struct {
	ID              string     `gorm:"column:id"`
	UserID          string     `gorm:"column:user_id"`
	RangeType       string     `gorm:"column:range_type"`
	GeneratedDate   time.Time  `gorm:"column:generated_date"`
	DataFingerprint string     `gorm:"column:data_fingerprint"`
	InsightText     string     `gorm:"column:insight_text"`
	CreatedAt       *time.Time `gorm:"column:created_at"`
}

func (StatsInsight) TableName() string { return "ai_stats_insights" }

func (s StatsInsight) GeneratedDateString() string {
	if s.GeneratedDate.IsZero() {
		return ""
	}
	return s.GeneratedDate.In(chinaDateLocation()).Format("2006-01-02")
}

func chinaDateLocation() *time.Location {
	return time.FixedZone("Asia/Shanghai", 8*60*60)
}

// StatsUserProfile is the weapp_user projection needed for stats insight.
type StatsUserProfile struct {
	ID              string         `gorm:"column:id"`
	Gender          *string        `gorm:"column:gender"`
	Height          *float64       `gorm:"column:height"`
	Weight          *float64       `gorm:"column:weight"`
	Birthday        *string        `gorm:"column:birthday"`
	ActivityLevel   *string        `gorm:"column:activity_level"`
	BMR             *float64       `gorm:"column:bmr"`
	TDEE            *float64       `gorm:"column:tdee"`
	DietGoal                         *string        `gorm:"column:diet_goal"`
	HealthCondition                  map[string]any `gorm:"column:health_condition;serializer:json"`
	HealthDisclaimerAcknowledgedAt   *time.Time     `gorm:"column:health_disclaimer_acknowledged_at"`
}

func (StatsUserProfile) TableName() string { return "weapp_user" }

// FoodRecord — minimal projection for stats aggregation (table: user_food_records)
type FoodRecord struct {
	ID            string           `gorm:"column:id"`
	UserID        string           `gorm:"column:user_id"`
	MealType      string           `gorm:"column:meal_type"`
	Description   *string          `gorm:"column:description"`
	Items         []map[string]any `gorm:"column:items;serializer:json"`
	TotalCalories float64          `gorm:"column:total_calories"`
	TotalProtein  float64          `gorm:"column:total_protein"`
	TotalCarbs    float64          `gorm:"column:total_carbs"`
	TotalFat      float64          `gorm:"column:total_fat"`
	RecordTime    *time.Time       `gorm:"column:record_time"`
}

func (FoodRecord) TableName() string { return "user_food_records" }

type DietRecommendationFoodItem struct {
	Name     string `json:"name"`
	Amount   string `json:"amount"`
	Source   string `json:"source,omitempty"`
	SourceID string `json:"source_id,omitempty"`
}

type DietRecommendationCandidate struct {
	Source      string                       `json:"source"`
	SourceID    string                       `json:"source_id,omitempty"`
	Title       string                       `json:"title"`
	Description string                       `json:"description,omitempty"`
	Calories    float64                      `json:"calories"`
	Protein     float64                      `json:"protein"`
	Carbs       float64                      `json:"carbs"`
	Fat         float64                      `json:"fat"`
	Items       []DietRecommendationFoodItem `json:"items"`
}

// AnalysisTask — table: analysis_tasks
type AnalysisTask struct {
	ID        string         `gorm:"column:id"`
	UserID    string         `gorm:"column:user_id"`
	TaskType  string         `gorm:"column:task_type"`
	Status    string         `gorm:"column:status"`
	ImageURL  *string        `gorm:"column:image_url"`
	TextInput *string        `gorm:"column:text_input"`
	Payload   map[string]any `gorm:"column:payload;serializer:json"`
	CreatedAt *time.Time     `gorm:"column:created_at"`
}

func (AnalysisTask) TableName() string { return "analysis_tasks" }

// BodyMetricSettings — table: user_body_metric_settings
type BodyMetricSettings struct {
	UserID      string `gorm:"column:user_id;primaryKey"`
	WaterGoalMl int    `gorm:"column:water_goal_ml"`
}

func (BodyMetricSettings) TableName() string { return "user_body_metric_settings" }
