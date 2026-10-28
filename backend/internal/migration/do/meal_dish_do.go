package do

import (
	"time"

	"gorm.io/datatypes"
)

// MealDishPromptDO links one recognition task to the canteen dish the user
// picked while waiting, and records how far the user got (the funnel).
type MealDishPromptDO struct {
	ID                  string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID              string         `gorm:"column:user_id;type:uuid;not null;uniqueIndex:uk_meal_dish_prompts_user_task,priority:1;index:idx_meal_dish_prompts_user_created,priority:1"`
	AnalysisTaskID      string         `gorm:"column:analysis_task_id;type:uuid;not null;uniqueIndex:uk_meal_dish_prompts_user_task,priority:2"`
	Surface             string         `gorm:"column:surface;type:text;not null;default:'wait';check:meal_dish_prompts_surface_valid,surface IN ('wait','result')"`
	LocationStatus      string         `gorm:"column:location_status;type:text;not null;default:'unknown';check:meal_dish_prompts_location_valid,location_status IN ('granted','denied','unavailable','unknown')"`
	NearestDistanceM    *int           `gorm:"column:nearest_distance_m;type:integer"`
	SuggestionSources   datatypes.JSON `gorm:"column:suggestion_sources;type:jsonb;not null;default:'[]'::jsonb"`
	SuggestedCanteenIDs datatypes.JSON `gorm:"column:suggested_canteen_ids;type:jsonb;not null;default:'[]'::jsonb"`
	ChosenCanteenID     *string        `gorm:"column:chosen_canteen_id;type:uuid;index:idx_meal_dish_prompts_canteen"`
	ChosenCanteenName   string         `gorm:"column:chosen_canteen_name;type:text;not null;default:''"`
	CanteenRank         *int           `gorm:"column:canteen_rank;type:integer"`
	CanteenAnsweredAt   *time.Time     `gorm:"column:canteen_answered_at;type:timestamptz"`
	SuggestedItemIDs    datatypes.JSON `gorm:"column:suggested_item_ids;type:jsonb;not null;default:'[]'::jsonb"`
	ChosenItemID        *string        `gorm:"column:chosen_item_id;type:uuid;index:idx_meal_dish_prompts_item"`
	ChosenItemName      string         `gorm:"column:chosen_item_name;type:text;not null;default:''"`
	ChosenWindowName    string         `gorm:"column:chosen_window_name;type:text;not null;default:''"`
	ChosenPriceText     string         `gorm:"column:chosen_price_text;type:text;not null;default:''"`
	ItemRank            *int           `gorm:"column:item_rank;type:integer"`
	RecognitionRank     *int           `gorm:"column:recognition_rank;type:integer"`
	ItemAnsweredAt      *time.Time     `gorm:"column:item_answered_at;type:timestamptz"`
	GapKind             string         `gorm:"column:gap_kind;type:text;not null;default:'none';check:meal_dish_prompts_gap_valid,gap_kind IN ('none','photo','menu')"`
	PhotoConsent        *bool          `gorm:"column:photo_consent;type:boolean"`
	PhotoContributedAt  *time.Time     `gorm:"column:photo_contributed_at;type:timestamptz"`
	RewardCredits       int            `gorm:"column:reward_credits;type:integer;not null;default:0"`
	SkippedAt           *time.Time     `gorm:"column:skipped_at;type:timestamptz"`
	SkipStep            string         `gorm:"column:skip_step;type:text;not null;default:''"`
	// Cohort is how much the user was asked: regular users only pick the dish,
	// active users and contributors may get one price question.
	Cohort            string     `gorm:"column:cohort;type:text;not null;default:'regular';check:meal_dish_prompts_cohort_valid,cohort IN ('regular','active','contributor')"`
	RecommendedItemID *string    `gorm:"column:recommended_item_id;type:uuid"`
	RecommendedKind   string     `gorm:"column:recommended_kind;type:text;not null;default:'';check:meal_dish_prompts_recommended_kind_valid,recommended_kind IN ('','navigated','chatted','shown')"`
	PriceAskedAt      *time.Time `gorm:"column:price_asked_at;type:timestamptz"`
	PriceAnswer       *float64   `gorm:"column:price_answer;type:numeric(8,2)"`
	PriceAnswerKind   string     `gorm:"column:price_answer_kind;type:text;not null;default:'';check:meal_dish_prompts_price_kind_valid,price_answer_kind IN ('','same','changed','skipped')"`
	PriceAnsweredAt   *time.Time `gorm:"column:price_answered_at;type:timestamptz"`
	PriceAppliedAt    *time.Time `gorm:"column:price_applied_at;type:timestamptz"`
	CreatedAt         *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_meal_dish_prompts_user_created,priority:2,sort:desc;index:idx_meal_dish_prompts_created"`
	UpdatedAt         *time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (MealDishPromptDO) TableName() string { return "meal_dish_prompts" }

// CanteenLocationSampleDO is an anonymous position taken when a user confirms
// a canteen; it carries no user id.
type CanteenLocationSampleDO struct {
	ID        string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	CanteenID string     `gorm:"column:canteen_id;type:uuid;not null;index:idx_canteen_location_samples_canteen"`
	Latitude  float64    `gorm:"column:latitude;type:double precision;not null;check:canteen_location_samples_lat_valid,latitude BETWEEN -90 AND 90"`
	Longitude float64    `gorm:"column:longitude;type:double precision;not null;check:canteen_location_samples_lng_valid,longitude BETWEEN -180 AND 180"`
	AccuracyM *float64   `gorm:"column:accuracy_m;type:double precision"`
	CreatedAt *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
}

func (CanteenLocationSampleDO) TableName() string { return "canteen_location_samples" }

func MealDishModels() []any {
	return []any{&MealDishPromptDO{}, &CanteenLocationSampleDO{}}
}
