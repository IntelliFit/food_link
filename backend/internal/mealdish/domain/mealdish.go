// Package domain holds the types of the "which canteen dish was this meal"
// prompt shown while a photo is being recognised.
package domain

import "time"

// Prompt is one recognition task's prompt. It is both the link between the
// meal and a canteen dish and the funnel record used to measure the feature:
// which suggestion the user took, at which step they stopped, and whether
// they shared their photo.
type Prompt struct {
	ID                  string     `gorm:"column:id" json:"id"`
	UserID              string     `gorm:"column:user_id" json:"-"`
	AnalysisTaskID      string     `gorm:"column:analysis_task_id" json:"analysis_task_id"`
	Surface             string     `gorm:"column:surface" json:"surface"`
	LocationStatus      string     `gorm:"column:location_status" json:"location_status"`
	NearestDistanceM    *int       `gorm:"column:nearest_distance_m" json:"nearest_distance_m,omitempty"`
	SuggestionSources   []string   `gorm:"column:suggestion_sources;serializer:json" json:"suggestion_sources"`
	SuggestedCanteenIDs []string   `gorm:"column:suggested_canteen_ids;serializer:json" json:"suggested_canteen_ids"`
	ChosenCanteenID     *string    `gorm:"column:chosen_canteen_id" json:"chosen_canteen_id,omitempty"`
	ChosenCanteenName   string     `gorm:"column:chosen_canteen_name" json:"chosen_canteen_name,omitempty"`
	CanteenRank         *int       `gorm:"column:canteen_rank" json:"canteen_rank,omitempty"`
	CanteenAnsweredAt   *time.Time `gorm:"column:canteen_answered_at" json:"canteen_answered_at,omitempty"`
	SuggestedItemIDs    []string   `gorm:"column:suggested_item_ids;serializer:json" json:"suggested_item_ids"`
	ChosenItemID        *string    `gorm:"column:chosen_item_id" json:"chosen_item_id,omitempty"`
	ChosenItemName      string     `gorm:"column:chosen_item_name" json:"chosen_item_name,omitempty"`
	ChosenWindowName    string     `gorm:"column:chosen_window_name" json:"chosen_window_name,omitempty"`
	ChosenPriceText     string     `gorm:"column:chosen_price_text" json:"chosen_price_text,omitempty"`
	ItemRank            *int       `gorm:"column:item_rank" json:"item_rank,omitempty"`
	RecognitionRank     *int       `gorm:"column:recognition_rank" json:"recognition_rank,omitempty"`
	ItemAnsweredAt      *time.Time `gorm:"column:item_answered_at" json:"item_answered_at,omitempty"`
	GapKind             string     `gorm:"column:gap_kind" json:"gap_kind"`
	PhotoConsent        *bool      `gorm:"column:photo_consent" json:"photo_consent,omitempty"`
	PhotoContributedAt  *time.Time `gorm:"column:photo_contributed_at" json:"photo_contributed_at,omitempty"`
	RewardCredits       int        `gorm:"column:reward_credits" json:"reward_credits"`
	SkippedAt           *time.Time `gorm:"column:skipped_at" json:"skipped_at,omitempty"`
	SkipStep            string     `gorm:"column:skip_step" json:"skip_step,omitempty"`
	Cohort              string     `gorm:"column:cohort" json:"cohort"`
	RecommendedItemID   *string    `gorm:"column:recommended_item_id" json:"recommended_item_id,omitempty"`
	RecommendedKind     string     `gorm:"column:recommended_kind" json:"recommended_kind,omitempty"`
	PriceAskedAt        *time.Time `gorm:"column:price_asked_at" json:"price_asked_at,omitempty"`
	PriceAnswer         *float64   `gorm:"column:price_answer" json:"price_answer,omitempty"`
	PriceAnswerKind     string     `gorm:"column:price_answer_kind" json:"price_answer_kind,omitempty"`
	PriceAnsweredAt     *time.Time `gorm:"column:price_answered_at" json:"price_answered_at,omitempty"`
	PriceAppliedAt      *time.Time `gorm:"column:price_applied_at" json:"price_applied_at,omitempty"`
	CreatedAt           *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt           *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (Prompt) TableName() string { return "meal_dish_prompts" }

// LocationSample is an anonymous position recorded when a user confirms the
// canteen they are in. Enough samples locate a canteen that the directory has
// no coordinates for. No user id is stored.
type LocationSample struct {
	ID        string     `gorm:"column:id" json:"id"`
	CanteenID string     `gorm:"column:canteen_id" json:"canteen_id"`
	Latitude  float64    `gorm:"column:latitude" json:"latitude"`
	Longitude float64    `gorm:"column:longitude" json:"longitude"`
	AccuracyM *float64   `gorm:"column:accuracy_m" json:"accuracy_m,omitempty"`
	CreatedAt *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
}

func (LocationSample) TableName() string { return "canteen_location_samples" }

// Canteen is one suggestion in the "where did you eat" step.
type Canteen struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	SchoolName  string `json:"school_name"`
	CampusName  string `json:"campus_name,omitempty"`
	DistanceM   *int   `json:"distance_m,omitempty"`
	Reason      string `json:"reason"`
	ReasonText  string `json:"reason_text"`
	DishCount   int    `json:"dish_count"`
	RecentCount int    `json:"recent_count,omitempty"`
}

// Dish is one candidate in the "which dish" step.
type Dish struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	WindowName   string  `json:"window_name"`
	Floor        string  `json:"floor,omitempty"`
	PriceText    string  `json:"price_text"`
	ImageURL     string  `json:"image_url,omitempty"`
	HasRealPhoto bool    `json:"has_real_photo"`
	Score        float64 `json:"score"`
	Popularity   int     `json:"-"`
}

// Window groups dishes for the window chips.
type Window struct {
	Name      string `json:"name"`
	DishCount int    `json:"dish_count"`
}

const (
	SurfaceWait   = "wait"
	SurfaceResult = "result"

	LocationGranted     = "granted"
	LocationDenied      = "denied"
	LocationUnavailable = "unavailable"
	LocationUnknown     = "unknown"

	ReasonRecommended = "recommended"
	ReasonRecent      = "recent"
	ReasonNearby      = "nearby"
	ReasonSchool      = "school"
	ReasonManual      = "manual"
	GapNone           = "none"
	GapPhoto          = "photo"
	GapMenu           = "menu"
	StepCanteen       = "canteen"
	StepDish          = "dish"
	StepPhoto         = "photo"
	StepPrice         = "price"
	StepSkip          = "skip"
	maxSuggestion     = 3

	CohortRegular     = "regular"
	CohortActive      = "active"
	CohortContributor = "contributor"

	// How the user met the home recommendation before the photo.
	RecommendedNavigated = "navigated"
	RecommendedChatted   = "chatted"
	RecommendedShown     = "shown"

	PriceSame    = "same"
	PriceChanged = "changed"
	PriceSkipped = "skipped"
)

// MaxSuggestions is how many canteens the first step lists.
const MaxSuggestions = maxSuggestion
