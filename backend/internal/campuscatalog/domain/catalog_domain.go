package domain

import "time"

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
	ID                 string         `gorm:"column:id" json:"id"`
	BatchID            string         `gorm:"column:batch_id" json:"batch_id"`
	EntryType          string         `gorm:"column:entry_type" json:"entry_type"`
	Name               string         `gorm:"column:name" json:"name,omitempty"`
	Description        string         `gorm:"column:description" json:"description,omitempty"`
	SchoolID           *string        `gorm:"column:school_id" json:"school_id,omitempty"`
	CampusID           *string        `gorm:"column:campus_id" json:"campus_id,omitempty"`
	CanteenID          *string        `gorm:"column:canteen_id" json:"canteen_id,omitempty"`
	WindowID           *string        `gorm:"column:window_id" json:"window_id,omitempty"`
	OrganizationName   string         `gorm:"column:organization_name" json:"organization_name"`
	AreaName           string         `gorm:"column:area_name" json:"area_name,omitempty"`
	CanteenName        string         `gorm:"column:canteen_name" json:"canteen_name"`
	Floor              string         `gorm:"column:floor" json:"floor,omitempty"`
	WindowName         string         `gorm:"column:window_name" json:"window_name,omitempty"`
	WindowLayout       string         `gorm:"column:window_layout" json:"window_layout,omitempty"`
	MealPeriods        []string       `gorm:"column:meal_periods;serializer:json" json:"meal_periods"`
	AvailableWeekdays  []string       `gorm:"column:available_weekdays;serializer:json" json:"available_weekdays"`
	AvailabilityNote   string         `gorm:"column:availability_note" json:"availability_note,omitempty"`
	ServiceMode        string         `gorm:"column:service_mode" json:"service_mode"`
	PriceType          string         `gorm:"column:price_type" json:"price_type"`
	Price              *float64       `gorm:"column:price" json:"price,omitempty"`
	PriceMin           *float64       `gorm:"column:price_min" json:"price_min,omitempty"`
	PriceMax           *float64       `gorm:"column:price_max" json:"price_max,omitempty"`
	PriceUnit          string         `gorm:"column:price_unit" json:"price_unit,omitempty"`
	PriceText          string         `gorm:"column:price_text" json:"price_text,omitempty"`
	PriceOptions       map[string]any `gorm:"column:price_options;serializer:json" json:"price_options"`
	PortionDescription string         `gorm:"column:portion_description" json:"portion_description,omitempty"`
	ImagePaths         []string       `gorm:"column:image_paths;serializer:json" json:"image_paths"`
	ImageKind          string         `gorm:"column:image_kind" json:"image_kind"`
	SourceFilename     string         `gorm:"column:source_filename" json:"source_filename,omitempty"`
	RawText            string         `gorm:"column:raw_text" json:"raw_text,omitempty"`
	Notes              string         `gorm:"column:notes" json:"notes,omitempty"`
	MissingFields      []string       `gorm:"column:missing_fields;serializer:json" json:"missing_fields"`
	CompletenessStatus string         `gorm:"column:completeness_status" json:"completeness_status"`
	Status             string         `gorm:"column:status" json:"status"`
	CapturedAt         *time.Time     `gorm:"column:captured_at" json:"captured_at,omitempty"`
	ContributorUserID  *string        `gorm:"column:contributor_user_id" json:"contributor_user_id,omitempty"`
	CreatedByAdminID   *string        `gorm:"column:created_by_admin_id" json:"created_by_admin_id,omitempty"`
	CreatedAt          *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt          *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (CatalogItem) TableName() string { return "campus_food_catalog_items" }
