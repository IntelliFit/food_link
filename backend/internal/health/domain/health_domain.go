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
	ID             string           `gorm:"column:id"`
	UserID         string           `gorm:"column:user_id"`
	ExerciseDesc   string           `gorm:"column:exercise_desc"`
	ExerciseType   *string          `gorm:"column:exercise_type"`
	ImageURL       *string          `gorm:"column:image_url"`
	CaloriesBurned *float64         `gorm:"column:calories_burned"`
	DurationMin    *int             `gorm:"column:duration_min"`
	RecordedOn     *time.Time       `gorm:"column:recorded_on"`
	RecordedAt     *time.Time       `gorm:"column:recorded_at"`
	AIReasoning    *string          `gorm:"column:ai_reasoning"`
	ExerciseItems  []map[string]any `gorm:"column:exercise_items;serializer:json"`
	HiddenFromFeed bool             `gorm:"column:hidden_from_feed"`
	CreatedAt      *time.Time       `gorm:"column:created_at"`
}

func (ExerciseLog) TableName() string { return "user_exercise_logs" }

// ExerciseEnergyActivity — table: exercise_energy_library
type ExerciseEnergyActivity struct {
	ID             string     `gorm:"column:id" json:"id"`
	CanonicalName  string     `gorm:"column:canonical_name" json:"canonical_name"`
	NormalizedName string     `gorm:"column:normalized_name" json:"normalized_name"`
	Category       string     `gorm:"column:category" json:"category"`
	Intensity      string     `gorm:"column:intensity" json:"intensity"`
	METValue       float64    `gorm:"column:met_value" json:"met_value"`
	Source         string     `gorm:"column:source" json:"source"`
	Evidence       string     `gorm:"column:evidence" json:"evidence"`
	ReviewStatus   string     `gorm:"column:review_status" json:"review_status"`
	IsActive       bool       `gorm:"column:is_active" json:"is_active"`
	CreatedAt      *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt      *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (ExerciseEnergyActivity) TableName() string { return "exercise_energy_library" }

// ExerciseEnergyAlias — table: exercise_energy_aliases
type ExerciseEnergyAlias struct {
	ID              string     `gorm:"column:id" json:"id"`
	ActivityID      string     `gorm:"column:activity_id" json:"activity_id"`
	AliasName       string     `gorm:"column:alias_name" json:"alias_name"`
	NormalizedAlias string     `gorm:"column:normalized_alias" json:"normalized_alias"`
	CreatedAt       *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
}

func (ExerciseEnergyAlias) TableName() string { return "exercise_energy_aliases" }

type ExerciseEnergyResolveResult struct {
	Activity    *ExerciseEnergyActivity
	Status      string
	MatchSource string
	Score       float64
}

type ExerciseEnergyActivityInput struct {
	CanonicalName string
	Category      string
	Intensity     string
	METValue      float64
	Source        string
	Evidence      string
	ReviewStatus  string
	IsActive      bool
	Aliases       []string
}

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
	GenerationCount int        `gorm:"column:generation_count"`
	CreatedAt       *time.Time `gorm:"column:created_at"`
}

func (StatsInsight) TableName() string { return "ai_stats_insights" }

// CustomFocusCard — table: ai_custom_focus_cards
type CustomFocusCard struct {
	ID              string     `gorm:"column:id"`
	UserID          string     `gorm:"column:user_id"`
	FocusID         string     `gorm:"column:focus_id"`
	RangeType       string     `gorm:"column:range_type"`
	GeneratedDate   time.Time  `gorm:"column:generated_date"`
	DataFingerprint string     `gorm:"column:data_fingerprint"`
	FocusLabel      string     `gorm:"column:focus_label"`
	Score           int        `gorm:"column:score"`
	Brief           string     `gorm:"column:brief"`
	Summary         string     `gorm:"column:summary"`
	Basis           string     `gorm:"column:basis"`
	Action          string     `gorm:"column:action"`
	CreatedAt       *time.Time `gorm:"column:created_at"`
}

func (CustomFocusCard) TableName() string { return "ai_custom_focus_cards" }

func (c CustomFocusCard) GeneratedDateString() string {
	if c.GeneratedDate.IsZero() {
		return ""
	}
	return c.GeneratedDate.In(chinaDateLocation()).Format("2006-01-02")
}

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
	ID                             string         `gorm:"column:id"`
	Gender                         *string        `gorm:"column:gender"`
	Height                         *float64       `gorm:"column:height"`
	Weight                         *float64       `gorm:"column:weight"`
	Birthday                       *string        `gorm:"column:birthday"`
	ActivityLevel                  *string        `gorm:"column:activity_level"`
	BMR                            *float64       `gorm:"column:bmr"`
	TDEE                           *float64       `gorm:"column:tdee"`
	DietGoal                       *string        `gorm:"column:diet_goal"`
	HealthCondition                map[string]any `gorm:"column:health_condition;serializer:json"`
	HealthDisclaimerAcknowledgedAt *time.Time     `gorm:"column:health_disclaimer_acknowledged_at"`
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

type DietRecommendationScope struct {
	SchoolID         string
	CampusID         string
	IncludeSourceIDs []string
	ExcludeSourceIDs []string
}

type CampusDietSearchFilter struct {
	SchoolID         string
	CampusID         string
	Keyword          string
	CanteenName      string
	IncludeSourceIDs []string
	ExcludeSourceIDs []string
	MaxCalories      *float64
	MinProtein       *float64
	MaxFat           *float64
	MaxPrice         *float64
	TargetCalories   *float64
	SortBy           string
	Limit            int
	Offset           int
}

type DietRecommendationSchool struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type DietRecommendationCandidate struct {
	Source                  string                       `json:"source"`
	SourceID                string                       `json:"source_id,omitempty"`
	Title                   string                       `json:"title"`
	Description             string                       `json:"description,omitempty"`
	Calories                float64                      `json:"calories"`
	Protein                 float64                      `json:"protein"`
	Carbs                   float64                      `json:"carbs"`
	Fat                     float64                      `json:"fat"`
	Items                   []DietRecommendationFoodItem `json:"items"`
	IsCampusFood            bool                         `json:"is_campus_food,omitempty"`
	SchoolID                string                       `json:"school_id,omitempty"`
	SchoolName              string                       `json:"school_name,omitempty"`
	CampusID                string                       `json:"campus_id,omitempty"`
	CampusName              string                       `json:"campus_name,omitempty"`
	CanteenID               string                       `json:"canteen_id,omitempty"`
	CanteenName             string                       `json:"canteen_name,omitempty"`
	WindowID                string                       `json:"window_id,omitempty"`
	WindowName              string                       `json:"window_name,omitempty"`
	Floor                   string                       `json:"floor,omitempty"`
	Price                   float64                      `json:"price,omitempty"`
	PriceUnit               string                       `json:"price_unit,omitempty"`
	ImagePath               string                       `json:"image_path,omitempty"`
	PortionDescription      string                       `json:"portion_description,omitempty"`
	NutritionBasis          string                       `json:"nutrition_basis,omitempty"`
	NutritionSourceCategory string                       `json:"nutrition_source_category,omitempty"`
	WeightMethod            string                       `json:"weight_method,omitempty"`
	WeightConfidence        float64                      `json:"weight_confidence,omitempty"`
	UncertaintyLevel        string                       `json:"uncertainty_level,omitempty"`
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
