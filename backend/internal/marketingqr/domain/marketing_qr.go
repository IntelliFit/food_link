package domain

import "time"

type Nutrition struct {
	CaloriesKcal float64 `json:"calories_kcal"`
	ProteinG     float64 `json:"protein_g"`
	CarbsG       float64 `json:"carbs_g"`
	FatG         float64 `json:"fat_g"`
}

type Landing struct {
	Code                string     `json:"code"`
	Kind                string     `json:"kind"`
	Title               string     `json:"title"`
	Subtitle            string     `json:"subtitle"`
	Category            string     `json:"category,omitempty"`
	MerchantName        string     `json:"merchant_name,omitempty"`
	BranchName          string     `json:"branch_name,omitempty"`
	Address             string     `json:"address,omitempty"`
	Latitude            *float64   `json:"latitude,omitempty"`
	Longitude           *float64   `json:"longitude,omitempty"`
	LocationIsEstimated bool       `json:"location_is_estimated"`
	ImageURL            string     `json:"image_url,omitempty"`
	PriceMin            float64    `json:"price_min,omitempty"`
	PriceMax            float64    `json:"price_max,omitempty"`
	PortionDescription  string     `json:"portion_description,omitempty"`
	Nutrition           *Nutrition `json:"nutrition,omitempty"`
	NutritionNotice     string     `json:"nutrition_notice,omitempty"`
	DataVersion         string     `json:"data_version"`
	CallToAction        string     `json:"call_to_action"`
	PublicFoodItemID    string     `json:"public_food_item_id,omitempty"`
}

type Attribution struct {
	ID           string     `gorm:"column:id;type:uuid;primaryKey" json:"id"`
	CampaignCode string     `gorm:"column:campaign_code;type:text;not null;uniqueIndex:uidx_marketing_qr_attribution_visitor,priority:1" json:"campaign_code"`
	VisitorID    string     `gorm:"column:visitor_id;type:text;not null;uniqueIndex:uidx_marketing_qr_attribution_visitor,priority:2" json:"visitor_id"`
	UserID       *string    `gorm:"column:user_id;type:uuid;uniqueIndex:uidx_marketing_qr_attribution_user,where:user_id IS NOT NULL" json:"user_id,omitempty"`
	FirstSeenAt  time.Time  `gorm:"column:first_seen_at;type:timestamptz;not null" json:"first_seen_at"`
	LastSeenAt   time.Time  `gorm:"column:last_seen_at;type:timestamptz;not null" json:"last_seen_at"`
	BoundAt      *time.Time `gorm:"column:bound_at;type:timestamptz" json:"bound_at,omitempty"`
	CreatedAt    time.Time  `gorm:"column:created_at;type:timestamptz;not null" json:"created_at"`
	UpdatedAt    time.Time  `gorm:"column:updated_at;type:timestamptz;not null" json:"updated_at"`
}

func (Attribution) TableName() string { return "marketing_qr_attributions" }

type Event struct {
	ID           string         `gorm:"column:id;type:uuid;primaryKey" json:"id"`
	CampaignCode string         `gorm:"column:campaign_code;type:text;not null;index:idx_marketing_qr_events_campaign_created,priority:1" json:"campaign_code"`
	VisitorID    string         `gorm:"column:visitor_id;type:text;not null;index:idx_marketing_qr_events_visitor" json:"visitor_id"`
	UserID       *string        `gorm:"column:user_id;type:uuid;index:idx_marketing_qr_events_user" json:"user_id,omitempty"`
	EventType    string         `gorm:"column:event_type;type:text;not null;index:idx_marketing_qr_events_type" json:"event_type"`
	Metadata     map[string]any `gorm:"column:metadata;type:jsonb;serializer:json;not null;default:'{}'::jsonb" json:"metadata"`
	CreatedAt    time.Time      `gorm:"column:created_at;type:timestamptz;not null;index:idx_marketing_qr_events_campaign_created,priority:2,sort:desc" json:"created_at"`
}

func (Event) TableName() string { return "marketing_qr_events" }

type Summary struct {
	CampaignCode       string `json:"campaign_code"`
	Kind               string `json:"kind"`
	Title              string `json:"title"`
	LandingViews       int64  `json:"landing_views"`
	UniqueVisitors     int64  `json:"unique_visitors"`
	RegistrationClicks int64  `json:"registration_clicks"`
	RegisteredUsers    int64  `json:"registered_users"`
	PaidUsers          int64  `json:"paid_users"`
}
