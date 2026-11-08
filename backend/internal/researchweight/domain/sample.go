package domain

import (
	"time"

	"food_link/backend/internal/migration/do"
)

// ConsentVersion is the research-use consent text the mini program shows.
// Bump it (and the page copy) whenever the consent wording changes.
const ConsentVersion = "2026-10-28"

const (
	StatusPending  = "pending"
	StatusApproved = "approved"
	StatusRejected = "rejected"

	ModeWhole    = "whole"
	ModeItemized = "itemized"
	// ModeMulti is one meal photo with several containers (takeout boxes,
	// bowls), each weighed on its own with its own tare source.
	ModeMulti = "multi"

	TareMeasured = "measured"
	TareZeroed   = "zeroed"
	// TareAfterMeal weighs the empty container after eating; TareLibrary
	// reuses a saved container weight; TarePerContainer marks a multi sample
	// whose tares live on each container.
	TareAfterMeal    = "after_meal"
	TareLibrary      = "library"
	TarePerContainer = "per_container"

	// Evidence photos show the scale display.
	RoleTareScale  = "tare_scale"
	RoleGrossScale = "gross_scale"
	RoleItemScale  = "item_scale"
	// Multi mode: each container's full and empty readings, by item_index.
	RoleContainerGross = "container_gross"
	RoleContainerTare  = "container_tare"
	// Evaluation photos are taken off the scale; models only ever see these.
	RoleEvalTop      = "eval_top"
	RoleEvalAngle    = "eval_angle"
	RoleEvalTopRef   = "eval_top_ref"
	RoleEvalAngleRef = "eval_angle_ref"

	MaxItems        = 12
	MaxContainers   = 8
	MaxNetGrams     = 5000.0
	MaxReadingGrams = 10000.0
	MaxTotalGrams   = 10000.0
	// MaxSavedContainers caps one contributor's active container library.
	MaxSavedContainers = 30
	MaxContainerGrams  = 3000.0

	ContainerActive    = "active"
	ContainerArchived  = "archived"
	PhotoSourceLibrary = "library"

	// FlagAfterMealTareEarly marks an empty-container photo taken before the
	// evaluation photo, which "weighed after eating" should never be.
	FlagAfterMealTareEarly = "after_meal_tare_before_photo"
	// DailySubmissionLimit allows a full canteen session; rewards still need
	// a reviewer, so the cap only stops runaway clients.
	DailySubmissionLimit = 200
	MaxRewardCredits     = 20
)

var (
	Scenes           = []string{"canteen", "home", "takeout", "restaurant", "other"}
	ContainerTypes   = []string{"bowl", "plate", "tray", "box", "other"}
	ReferenceObjects = []string{"none", "chopsticks", "spoon", "card", "hand", "other"}
	// TareSources are the ways one container's empty weight can be known.
	TareSources  = []string{TareMeasured, TareZeroed, TareAfterMeal, TareLibrary}
	QualityTiers = []string{"A", "B", "C"}
)

type Sample = do.ResearchWeightSampleDO
type Item = do.ResearchWeightItem
type Photo = do.ResearchWeightPhoto
type Container = do.ResearchWeightContainerDO

// ContainerView is a saved container as clients see it.
type ContainerView struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	ContainerType string     `json:"container_type"`
	Grams         float64    `json:"grams"`
	PhotoURL      string     `json:"photo_url"`
	CreatedAt     *time.Time `json:"created_at,omitempty"`
}

// PhotoView is a stored photo with its access URL for clients.
type PhotoView struct {
	Photo
	URL string `json:"url"`
}

// SampleView is what the APIs return: the stored sample with photo and video
// URLs resolved.
type SampleView struct {
	ID                  string         `json:"id"`
	UserID              string         `json:"user_id"`
	Scene               string         `json:"scene"`
	WeighingMode        string         `json:"weighing_mode"`
	DishName            string         `json:"dish_name"`
	VenueName           string         `json:"venue_name"`
	City                string         `json:"city"`
	ContainerType       string         `json:"container_type"`
	TareMode            string         `json:"tare_mode"`
	TareGrams           float64        `json:"tare_grams"`
	GrossReadingGrams   *float64       `json:"gross_reading_grams,omitempty"`
	TotalNetGrams       float64        `json:"total_net_grams"`
	ScalePrecisionGrams float64        `json:"scale_precision_grams"`
	Items               []Item         `json:"items"`
	Photos              []PhotoView    `json:"photos"`
	ReferenceObject     string         `json:"reference_object"`
	VideoURL            string         `json:"video_url,omitempty"`
	Device              map[string]any `json:"device"`
	Notes               string         `json:"notes"`
	ConsentVersion      string         `json:"consent_version"`
	Status              string         `json:"status"`
	QualityTier         *string        `json:"quality_tier,omitempty"`
	ReviewNote          string         `json:"review_note"`
	ReviewedAt          *time.Time     `json:"reviewed_at,omitempty"`
	RewardCredits       int            `json:"reward_credits"`
	RewardedAt          *time.Time     `json:"rewarded_at,omitempty"`
	BenchmarkSampleID   *string        `json:"benchmark_sample_id,omitempty"`
	CreatedAt           *time.Time     `json:"created_at,omitempty"`
	Flags               []string       `json:"flags,omitempty"`
	ReviewMode          string         `json:"review_mode"`
	AutoReview          *AutoReview    `json:"auto_review,omitempty"`
	CollectionChannel   string         `json:"collection_channel"`
	CampaignID          *string        `json:"campaign_id,omitempty"`
	CatalogItemID       *string        `json:"catalog_item_id,omitempty"`
}

// MineSummary counts one contributor's samples by status.
type MineSummary struct {
	Total    int64 `json:"total"`
	Pending  int64 `json:"pending"`
	Approved int64 `json:"approved"`
	Rejected int64 `json:"rejected"`
}

type ListFilter struct {
	Status            string
	WeighingMode      string
	Scene             string
	CampaignID        string
	CollectionChannel string
	ReviewMode        string
	QualityTier       string
	Query             string
	Limit             int
	Offset            int
}

// PromotableFilter selects approved samples not yet in the benchmark.
type PromotableFilter struct {
	QualityTiers      []string
	CollectionChannel string
	Limit             int
}

type ListResult struct {
	Items []Sample
	Total int64
}
