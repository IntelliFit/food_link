package domain

import (
	"errors"
	"time"
)

var (
	ErrVersionConflict            = errors.New("campus food version conflict")
	ErrStaleAnalysisResult        = errors.New("campus food analysis result targets an old version")
	ErrCollectorApplicationAbsent = errors.New("campus collector application not found")
)

// CollectionBatch records one on-site collection session. It deliberately keeps
// location names alongside optional directory IDs so office parks and other
// non-university canteens can use the same ingestion flow.
type CollectionBatch struct {
	ID                  string     `gorm:"column:id" json:"id"`
	ClientBatchKey      string     `gorm:"column:client_batch_key" json:"client_batch_key"`
	BatchName           string     `gorm:"column:batch_name" json:"batch_name"`
	VenueType           string     `gorm:"column:venue_type" json:"venue_type"`
	SchoolID            *string    `gorm:"column:school_id" json:"school_id,omitempty"`
	CampusID            *string    `gorm:"column:campus_id" json:"campus_id,omitempty"`
	CanteenID           *string    `gorm:"column:canteen_id" json:"canteen_id,omitempty"`
	DefaultWindowID     *string    `gorm:"column:default_window_id" json:"default_window_id,omitempty"`
	OrganizationName    string     `gorm:"column:organization_name" json:"organization_name"`
	AreaName            string     `gorm:"column:area_name" json:"area_name,omitempty"`
	CanteenName         string     `gorm:"column:canteen_name" json:"canteen_name"`
	DefaultFloor        string     `gorm:"column:default_floor" json:"default_floor,omitempty"`
	DefaultWindowName   string     `gorm:"column:default_window_name" json:"default_window_name,omitempty"`
	DefaultWindowLayout string     `gorm:"column:default_window_layout" json:"default_window_layout,omitempty"`
	DefaultServiceMode  string     `gorm:"column:default_service_mode" json:"default_service_mode,omitempty"`
	DefaultMealPeriods  []string   `gorm:"column:default_meal_periods;serializer:json" json:"default_meal_periods"`
	CapturedAt          *time.Time `gorm:"column:captured_at" json:"captured_at,omitempty"`
	CollectorName       string     `gorm:"column:collector_name" json:"collector_name,omitempty"`
	SourceNote          string     `gorm:"column:source_note" json:"source_note,omitempty"`
	Status              string     `gorm:"column:status" json:"status"`
	CreatedByAdminID    *string    `gorm:"column:created_by_admin_id" json:"created_by_admin_id,omitempty"`
	ContributorUserID   *string    `gorm:"column:contributor_user_id" json:"contributor_user_id,omitempty"`
	SourceChannel       string     `gorm:"column:source_channel" json:"source_channel"`
	CreatedAt           *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt           *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
	ItemCount           int        `gorm:"column:item_count;->" json:"item_count"`
}

func (CollectionBatch) TableName() string { return "campus_food_collection_batches" }

// CatalogItem is a flexible evidence-backed canteen catalog record. An item can
// be a dish, a menu label, a stall overview, a combo rule, or an ingredient
// display. Name, image, and price are intentionally allowed to be incomplete so
// later contributors can enrich the record without discarding today's evidence.
type CatalogItem struct {
	ID                  string         `gorm:"column:id" json:"id"`
	BatchID             string         `gorm:"column:batch_id" json:"batch_id"`
	EntryType           string         `gorm:"column:entry_type" json:"entry_type"`
	Name                string         `gorm:"column:name" json:"name,omitempty"`
	Description         string         `gorm:"column:description" json:"description,omitempty"`
	SchoolID            *string        `gorm:"column:school_id" json:"school_id,omitempty"`
	CampusID            *string        `gorm:"column:campus_id" json:"campus_id,omitempty"`
	CanteenID           *string        `gorm:"column:canteen_id" json:"canteen_id,omitempty"`
	WindowID            *string        `gorm:"column:window_id" json:"window_id,omitempty"`
	OrganizationName    string         `gorm:"column:organization_name" json:"organization_name"`
	AreaName            string         `gorm:"column:area_name" json:"area_name,omitempty"`
	CanteenName         string         `gorm:"column:canteen_name" json:"canteen_name"`
	Floor               string         `gorm:"column:floor" json:"floor,omitempty"`
	WindowName          string         `gorm:"column:window_name" json:"window_name,omitempty"`
	WindowLayout        string         `gorm:"column:window_layout" json:"window_layout,omitempty"`
	MealPeriods         []string       `gorm:"column:meal_periods;serializer:json" json:"meal_periods"`
	AvailableWeekdays   []string       `gorm:"column:available_weekdays;serializer:json" json:"available_weekdays"`
	AvailabilityNote    string         `gorm:"column:availability_note" json:"availability_note,omitempty"`
	ServiceMode         string         `gorm:"column:service_mode" json:"service_mode"`
	PriceType           string         `gorm:"column:price_type" json:"price_type"`
	Price               *float64       `gorm:"column:price" json:"price,omitempty"`
	PriceMin            *float64       `gorm:"column:price_min" json:"price_min,omitempty"`
	PriceMax            *float64       `gorm:"column:price_max" json:"price_max,omitempty"`
	PriceUnit           string         `gorm:"column:price_unit" json:"price_unit,omitempty"`
	PriceText           string         `gorm:"column:price_text" json:"price_text,omitempty"`
	PriceOptions        map[string]any `gorm:"column:price_options;serializer:json" json:"price_options"`
	PortionDescription  string         `gorm:"column:portion_description" json:"portion_description,omitempty"`
	ImagePaths          []string       `gorm:"column:image_paths;serializer:json" json:"image_paths"`
	ImageKind           string         `gorm:"column:image_kind" json:"image_kind"`
	SourceFilename      string         `gorm:"column:source_filename" json:"source_filename,omitempty"`
	RawText             string         `gorm:"column:raw_text" json:"raw_text,omitempty"`
	Notes               string         `gorm:"column:notes" json:"notes,omitempty"`
	MissingFields       []string       `gorm:"column:missing_fields;serializer:json" json:"missing_fields"`
	CompletenessStatus  string         `gorm:"column:completeness_status" json:"completeness_status"`
	Status              string         `gorm:"column:status" json:"status"`
	AnalysisTaskID      *string        `gorm:"column:analysis_task_id" json:"analysis_task_id,omitempty"`
	AnalysisError       string         `gorm:"column:analysis_error" json:"analysis_error,omitempty"`
	AnalysisStartedAt   *time.Time     `gorm:"column:analysis_started_at" json:"analysis_started_at,omitempty"`
	AnalysisCompletedAt *time.Time     `gorm:"column:analysis_completed_at" json:"analysis_completed_at,omitempty"`
	PublishedAt         *time.Time     `gorm:"column:published_at" json:"published_at,omitempty"`
	PublishedByAdminID  *string        `gorm:"column:published_by_admin_id" json:"published_by_admin_id,omitempty"`
	CapturedAt          *time.Time     `gorm:"column:captured_at" json:"captured_at,omitempty"`
	ContributorUserID   *string        `gorm:"column:contributor_user_id" json:"contributor_user_id,omitempty"`
	LastContributorID   *string        `gorm:"column:last_contributor_user_id" json:"last_contributor_user_id,omitempty"`
	CreatedByAdminID    *string        `gorm:"column:created_by_admin_id" json:"created_by_admin_id,omitempty"`
	Version             int64          `gorm:"column:version" json:"version"`
	SourceChannel       string         `gorm:"column:source_channel" json:"source_channel"`
	NutritionVersion    int64          `gorm:"column:nutrition_source_version" json:"nutrition_source_version"`
	NutritionStatus     string         `gorm:"column:nutrition_status" json:"nutrition_status"`
	AvailabilityStatus  string         `gorm:"column:availability_status" json:"availability_status"`
	LastVerifiedAt      *time.Time     `gorm:"column:last_verified_at" json:"last_verified_at,omitempty"`
	CreatedAt           *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt           *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
	TotalCalories       *float64       `gorm:"column:total_calories;->;-:migration" json:"total_calories,omitempty"`
	TotalProtein        *float64       `gorm:"column:total_protein;->;-:migration" json:"total_protein,omitempty"`
	TotalCarbs          *float64       `gorm:"column:total_carbs;->;-:migration" json:"total_carbs,omitempty"`
	TotalFat            *float64       `gorm:"column:total_fat;->;-:migration" json:"total_fat,omitempty"`
	ClientStatus        string         `gorm:"column:client_status;->;-:migration" json:"client_status,omitempty"`
}

func (CatalogItem) TableName() string { return "campus_food_catalog_items" }

// Revision records every accepted community change. It is append-only: a
// rollback is represented by another revision that points at the reverted one.
type Revision struct {
	ID                 string         `gorm:"column:id" json:"id"`
	CatalogItemID      string         `gorm:"column:catalog_item_id" json:"catalog_item_id"`
	BaseVersion        int64          `gorm:"column:base_version" json:"base_version"`
	ResultVersion      int64          `gorm:"column:result_version" json:"result_version"`
	ActorType          string         `gorm:"column:actor_type" json:"actor_type"`
	ActorUserID        *string        `gorm:"column:actor_user_id" json:"actor_user_id,omitempty"`
	ActorAdminID       *string        `gorm:"column:actor_admin_id" json:"actor_admin_id,omitempty"`
	ActionType         string         `gorm:"column:action_type" json:"action_type"`
	BeforeSnapshot     map[string]any `gorm:"column:before_snapshot;serializer:json" json:"before_snapshot"`
	ProposedPatch      map[string]any `gorm:"column:proposed_patch;serializer:json" json:"proposed_patch"`
	AfterSnapshot      map[string]any `gorm:"column:after_snapshot;serializer:json" json:"after_snapshot"`
	ChangedFields      []string       `gorm:"column:changed_fields;serializer:json" json:"changed_fields"`
	EvidenceImagePaths []string       `gorm:"column:evidence_image_paths;serializer:json" json:"evidence_image_paths"`
	Reason             string         `gorm:"column:reason" json:"reason,omitempty"`
	RevertsRevisionID  *string        `gorm:"column:reverts_revision_id" json:"reverts_revision_id,omitempty"`
	CreatedAt          *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
}

func (Revision) TableName() string { return "campus_food_revisions" }

type CollectorApplication struct {
	ID            string     `gorm:"column:id" json:"id"`
	UserID        string     `gorm:"column:user_id" json:"user_id"`
	SchoolID      string     `gorm:"column:school_id" json:"school_id"`
	CampusID      *string    `gorm:"column:campus_id" json:"campus_id,omitempty"`
	CanteenID     *string    `gorm:"column:canteen_id" json:"canteen_id,omitempty"`
	ApplicantNote string     `gorm:"column:applicant_note" json:"applicant_note,omitempty"`
	Status        string     `gorm:"column:status" json:"status"`
	ReviewNote    string     `gorm:"column:review_note" json:"review_note,omitempty"`
	ReviewedBy    *string    `gorm:"column:reviewed_by" json:"reviewed_by,omitempty"`
	ReviewedAt    *time.Time `gorm:"column:reviewed_at" json:"reviewed_at,omitempty"`
	CreatedAt     *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt     *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
	UserNickname  string     `gorm:"column:user_nickname;->;-:migration" json:"user_nickname,omitempty"`
	UserTelephone string     `gorm:"column:user_telephone;->;-:migration" json:"user_telephone,omitempty"`
	SchoolName    string     `gorm:"column:school_name;->;-:migration" json:"school_name,omitempty"`
	CampusName    string     `gorm:"column:campus_name;->;-:migration" json:"campus_name,omitempty"`
	CanteenName   string     `gorm:"column:canteen_name;->;-:migration" json:"canteen_name,omitempty"`
}

func (CollectorApplication) TableName() string { return "campus_collector_applications" }

type CollectorScope struct {
	ID               string     `gorm:"column:id" json:"id"`
	UserID           string     `gorm:"column:user_id" json:"user_id"`
	ApplicationID    *string    `gorm:"column:application_id" json:"application_id,omitempty"`
	SchoolID         string     `gorm:"column:school_id" json:"school_id"`
	CampusID         *string    `gorm:"column:campus_id" json:"campus_id,omitempty"`
	CanteenID        *string    `gorm:"column:canteen_id" json:"canteen_id,omitempty"`
	Status           string     `gorm:"column:status" json:"status"`
	GrantedByAdminID string     `gorm:"column:granted_by_admin_id" json:"granted_by_admin_id"`
	ExpiresAt        *time.Time `gorm:"column:expires_at" json:"expires_at,omitempty"`
	RevokedAt        *time.Time `gorm:"column:revoked_at" json:"revoked_at,omitempty"`
	RevokedByAdminID *string    `gorm:"column:revoked_by_admin_id" json:"revoked_by_admin_id,omitempty"`
	CreatedAt        *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt        *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
	SchoolName       string     `gorm:"column:school_name;->;-:migration" json:"school_name,omitempty"`
	CampusName       string     `gorm:"column:campus_name;->;-:migration" json:"campus_name,omitempty"`
	CanteenName      string     `gorm:"column:canteen_name;->;-:migration" json:"canteen_name,omitempty"`
}

func (CollectorScope) TableName() string { return "campus_collector_scopes" }

type DirectoryRef struct {
	SchoolID    string
	SchoolName  string
	CampusID    string
	CampusName  string
	CanteenID   string
	CanteenName string
	WindowID    string
	WindowName  string
	Floor       string
}

type CatalogItemFilter struct {
	BatchID   string
	SchoolID  string
	CampusID  string
	CanteenID string
	WindowID  string
	Status    string
	Query     string
	Limit     int
	Offset    int
}

// AnalysisProgress is the administrator-facing snapshot of the campus dish
// publication pipeline. The counts come from catalog states, which remain the
// source of truth even while analysis workers are processing asynchronously.
type AnalysisProgress struct {
	Total            int64            `json:"total"`
	AnalyzableTotal  int64            `json:"analyzable_total"`
	Completed        int64            `json:"completed"`
	CompletedPercent float64          `json:"completed_percent"`
	StatusCounts     map[string]int64 `json:"status_counts"`
}

// LegacyAnalysisCandidate is a catalog row still linked to the retired
// precision fan-out pipeline. Maintenance uses it to publish a valid terminal
// result or atomically claim the row for the current single-task pipeline.
type LegacyAnalysisCandidate struct {
	Item       CatalogItem
	TaskID     string
	TaskType   string
	TaskStatus string
	TaskResult map[string]any
	TaskError  string
}

// CurrentAnalysisCandidate is a catalog row still waiting on a terminal task
// from the current food/food_text pipeline. Maintenance uses the persisted
// result when it is publishable, otherwise it safely transitions the row to a
// retryable failure instead of leaving permanent fake progress.
type CurrentAnalysisCandidate struct {
	Item       CatalogItem
	TaskID     string
	TaskType   string
	TaskStatus string
	TaskResult map[string]any
	TaskError  string
}
