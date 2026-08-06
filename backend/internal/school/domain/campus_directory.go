package domain

import "time"

type School struct {
	ID                    string  `gorm:"column:id" json:"id"`
	Name                  string  `gorm:"column:name" json:"name"`
	LocationType          string  `gorm:"column:location_type" json:"location_type"`
	OfficialCode          string  `gorm:"column:official_code" json:"official_code,omitempty"`
	Authority             string  `gorm:"column:authority" json:"authority,omitempty"`
	OfficialSourceVersion string  `gorm:"column:official_source_version" json:"official_source_version,omitempty"`
	InstitutionKind       string  `gorm:"column:institution_kind" json:"institution_kind,omitempty"`
	Province              string  `gorm:"column:province" json:"province,omitempty"`
	City                  string  `gorm:"column:city" json:"city,omitempty"`
	Level                 string  `gorm:"column:level" json:"level,omitempty"`
	Is985                 bool    `gorm:"column:is_985" json:"is_985"`
	Is211                 bool    `gorm:"column:is_211" json:"is_211"`
	Status                string  `gorm:"column:status" json:"status"`
	LogoURL               *string `gorm:"column:logo_url" json:"logo_url,omitempty"`
}

func (School) TableName() string { return "schools" }

type SchoolCampus struct {
	ID         string     `gorm:"column:id" json:"id"`
	SchoolID   string     `gorm:"column:school_id" json:"school_id"`
	Name       string     `gorm:"column:name" json:"name"`
	Aliases    []string   `gorm:"column:aliases;serializer:json" json:"aliases"`
	Address    string     `gorm:"column:address" json:"address,omitempty"`
	CampusType string     `gorm:"column:campus_type" json:"campus_type,omitempty"`
	SourceURL  string     `gorm:"column:source_url" json:"source_url,omitempty"`
	Status     string     `gorm:"column:status" json:"status"`
	SortOrder  int        `gorm:"column:sort_order" json:"sort_order"`
	CreatedAt  *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt  *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (SchoolCampus) TableName() string { return "school_campuses" }

type SchoolCanteen struct {
	ID               string     `gorm:"column:id" json:"id"`
	SchoolID         string     `gorm:"column:school_id" json:"school_id"`
	CampusID         *string    `gorm:"column:campus_id" json:"campus_id,omitempty"`
	CampusName       string     `gorm:"column:campus_name;->" json:"campus_name,omitempty"`
	Name             string     `gorm:"column:name" json:"name"`
	Aliases          []string   `gorm:"column:aliases;serializer:json" json:"aliases"`
	LocationText     string     `gorm:"column:location_text" json:"location_text,omitempty"`
	BuildingOrFloor  string     `gorm:"column:building_or_floor" json:"building_or_floor,omitempty"`
	ServiceType      string     `gorm:"column:service_type" json:"service_type,omitempty"`
	Audience         string     `gorm:"column:audience" json:"audience,omitempty"`
	MealPeriods      []string   `gorm:"column:meal_periods;serializer:json" json:"meal_periods"`
	OpeningHoursRaw  string     `gorm:"column:opening_hours_raw" json:"opening_hours_raw,omitempty"`
	PaymentMethods   []string   `gorm:"column:payment_methods;serializer:json" json:"payment_methods"`
	HalalOrEthnic    *bool      `gorm:"column:halal_or_ethnic" json:"halal_or_ethnic,omitempty"`
	VisitorAvailable *bool      `gorm:"column:visitor_available" json:"visitor_available,omitempty"`
	SourceURL        string     `gorm:"column:source_url" json:"source_url,omitempty"`
	SourceOrg        string     `gorm:"column:source_org" json:"source_org,omitempty"`
	SourceType       string     `gorm:"column:source_type" json:"source_type,omitempty"`
	ConfidenceLevel  *string    `gorm:"column:confidence_level" json:"confidence_level,omitempty"`
	Status           string     `gorm:"column:status" json:"status"`
	ReviewNote       string     `gorm:"column:review_note" json:"review_note,omitempty"`
	ReviewedBy       *string    `gorm:"column:reviewed_by" json:"reviewed_by,omitempty"`
	ReviewedAt       *time.Time `gorm:"column:reviewed_at" json:"reviewed_at,omitempty"`
	SortOrder        int        `gorm:"column:sort_order" json:"sort_order"`
	SourceCount      int        `gorm:"column:source_count;->" json:"source_count,omitempty"`
	CreatedAt        *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt        *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (SchoolCanteen) TableName() string { return "school_canteens" }

type CampusDirectoryImportBatch struct {
	ID            string     `gorm:"column:id" json:"id"`
	Name          string     `gorm:"column:name" json:"name"`
	Region        string     `gorm:"column:region" json:"region,omitempty"`
	SourceScope   string     `gorm:"column:source_scope" json:"source_scope,omitempty"`
	Status        string     `gorm:"column:status" json:"status"`
	TotalSchools  int        `gorm:"column:total_schools" json:"total_schools"`
	TotalCampuses int        `gorm:"column:total_campuses" json:"total_campuses"`
	TotalCanteens int        `gorm:"column:total_canteens" json:"total_canteens"`
	TotalWindows  int        `gorm:"column:total_windows" json:"total_windows"`
	TotalSources  int        `gorm:"column:total_sources" json:"total_sources"`
	Notes         string     `gorm:"column:notes" json:"notes,omitempty"`
	CreatedBy     *string    `gorm:"column:created_by" json:"created_by,omitempty"`
	ReviewedBy    *string    `gorm:"column:reviewed_by" json:"reviewed_by,omitempty"`
	ReviewedAt    *time.Time `gorm:"column:reviewed_at" json:"reviewed_at,omitempty"`
	CreatedAt     *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt     *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (CampusDirectoryImportBatch) TableName() string { return "campus_directory_import_batches" }

type CanteenWindow struct {
	ID        string     `gorm:"column:id" json:"id"`
	SchoolID  string     `gorm:"column:school_id" json:"school_id"`
	CampusID  *string    `gorm:"column:campus_id" json:"campus_id,omitempty"`
	CanteenID string     `gorm:"column:canteen_id" json:"canteen_id"`
	Name      string     `gorm:"column:name" json:"name"`
	Aliases   []string   `gorm:"column:aliases;serializer:json" json:"aliases"`
	Floor     string     `gorm:"column:floor" json:"floor,omitempty"`
	SourceURL string     `gorm:"column:source_url" json:"source_url,omitempty"`
	Status    string     `gorm:"column:status" json:"status"`
	SortOrder int        `gorm:"column:sort_order" json:"sort_order"`
	CreatedAt *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (CanteenWindow) TableName() string { return "canteen_windows" }

// CanteenFloor is a derived directory item. Floors are sourced from the
// canteen's reviewed location metadata and its reviewed windows, so callers do
// not have to infer floors from window availability.
type CanteenFloor struct {
	Name       string `json:"name"`
	SortOrder  int    `json:"sort_order"`
	IsFallback bool   `json:"is_fallback,omitempty"`
	IsDefault  bool   `json:"is_default,omitempty"`
}

type CampusCanteenApplication struct {
	ID                   string     `gorm:"column:id" json:"id"`
	UserID               string     `gorm:"column:user_id" json:"user_id"`
	SchoolID             string     `gorm:"column:school_id" json:"school_id"`
	CampusID             *string    `gorm:"column:campus_id" json:"campus_id,omitempty"`
	CanteenID            *string    `gorm:"column:canteen_id" json:"canteen_id,omitempty"`
	RequestedSchoolName  string     `gorm:"column:requested_school_name" json:"requested_school_name"`
	RequestedCampusName  string     `gorm:"column:requested_campus_name" json:"requested_campus_name,omitempty"`
	RequestedCanteenName string     `gorm:"column:requested_canteen_name" json:"requested_canteen_name"`
	LocationText         string     `gorm:"column:location_text" json:"location_text,omitempty"`
	EvidenceURL          string     `gorm:"column:evidence_url" json:"evidence_url,omitempty"`
	ApplicantNote        string     `gorm:"column:applicant_note" json:"applicant_note,omitempty"`
	Status               string     `gorm:"column:status" json:"status"`
	ReviewNote           string     `gorm:"column:review_note" json:"review_note,omitempty"`
	ReviewedBy           *string    `gorm:"column:reviewed_by" json:"reviewed_by,omitempty"`
	ReviewedAt           *time.Time `gorm:"column:reviewed_at" json:"reviewed_at,omitempty"`
	CreatedAt            *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt            *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (CampusCanteenApplication) TableName() string { return "campus_canteen_applications" }

type CampusDirectorySource struct {
	ID                string     `gorm:"column:id" json:"id"`
	BatchID           *string    `gorm:"column:batch_id" json:"batch_id,omitempty"`
	SchoolID          string     `gorm:"column:school_id" json:"school_id"`
	CampusID          *string    `gorm:"column:campus_id" json:"campus_id,omitempty"`
	CanteenID         *string    `gorm:"column:canteen_id" json:"canteen_id,omitempty"`
	SourceURL         string     `gorm:"column:source_url" json:"source_url"`
	SourceTitle       string     `gorm:"column:source_title" json:"source_title,omitempty"`
	SourceOrg         string     `gorm:"column:source_org" json:"source_org,omitempty"`
	SourceType        string     `gorm:"column:source_type" json:"source_type,omitempty"`
	EvidenceLevel     string     `gorm:"column:evidence_level" json:"evidence_level,omitempty"`
	EvidenceExcerpt   string     `gorm:"column:evidence_excerpt" json:"evidence_excerpt,omitempty"`
	ReviewStatus      string     `gorm:"column:review_status" json:"review_status"`
	SourcePublishedAt *time.Time `gorm:"column:source_published_at" json:"source_published_at,omitempty"`
	CollectedAt       *time.Time `gorm:"column:collected_at" json:"collected_at,omitempty"`
	CreatedAt         *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt         *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (CampusDirectorySource) TableName() string { return "campus_directory_sources" }
