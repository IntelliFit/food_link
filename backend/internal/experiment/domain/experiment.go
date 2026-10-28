package domain

import "time"

const (
	StatusDraft   = "draft"
	StatusRunning = "running"
	StatusStopped = "stopped"

	AudienceAll      = "all"
	AudienceNewUsers = "new_users"

	// ExcludedExistingUser marks a pre-login assignment whose visitor turned out
	// to be an account created before a new-users-only experiment started.
	ExcludedExistingUser = "existing_user"
	// ExcludedDuplicateUnit marks a second install of an account that already
	// has an assignment (reinstall, cleared storage, a racing second phone).
	ExcludedDuplicateUnit = "duplicate_unit"
	// ExcludedAccountDeleted keeps the arm counts honest after the account and
	// its link to this row are removed.
	ExcludedAccountDeleted = "account_deleted"
)

type Variant struct {
	Key    string `json:"key"`
	Weight int    `json:"weight"`
}

// Experiment is one A/B test. Variants[0] is the control and the fallback for
// every unit that is not (or no longer) tracked.
type Experiment struct {
	Key             string     `gorm:"column:experiment_key;type:text;primaryKey" json:"key"`
	Description     string     `gorm:"column:description;type:text;not null;default:''" json:"description"`
	Status          string     `gorm:"column:status;type:text;not null" json:"status"`
	Audience        string     `gorm:"column:audience;type:text;not null" json:"audience"`
	Variants        []Variant  `gorm:"column:variants;type:jsonb;serializer:json;not null" json:"variants"`
	Salt            string     `gorm:"column:salt;type:text;not null" json:"salt"`
	OverrideVariant *string    `gorm:"column:override_variant;type:text" json:"override_variant,omitempty"`
	StartedAt       *time.Time `gorm:"column:started_at;type:timestamptz" json:"started_at,omitempty"`
	EndedAt         *time.Time `gorm:"column:ended_at;type:timestamptz" json:"ended_at,omitempty"`
	CreatedAt       time.Time  `gorm:"column:created_at;type:timestamptz;not null" json:"created_at"`
	UpdatedAt       time.Time  `gorm:"column:updated_at;type:timestamptz;not null" json:"updated_at"`
}

func (Experiment) TableName() string { return "experiments" }

func (e Experiment) ControlKey() string {
	if len(e.Variants) == 0 {
		return ""
	}
	return e.Variants[0].Key
}

// Visitor is one mini-program install, identified by a random id the client
// keeps in local storage. It exists before login so the funnel can start at
// the first open.
type Visitor struct {
	AnonID      string     `gorm:"column:anon_id;type:text;primaryKey" json:"anon_id"`
	UserID      *string    `gorm:"column:user_id;type:uuid" json:"user_id,omitempty"`
	Platform    string     `gorm:"column:platform;type:text;not null;default:''" json:"platform"`
	AppVersion  string     `gorm:"column:app_version;type:text;not null;default:''" json:"app_version"`
	FirstSeenAt time.Time  `gorm:"column:first_seen_at;type:timestamptz;not null" json:"first_seen_at"`
	LastSeenAt  time.Time  `gorm:"column:last_seen_at;type:timestamptz;not null" json:"last_seen_at"`
	BoundAt     *time.Time `gorm:"column:bound_at;type:timestamptz" json:"bound_at,omitempty"`
}

func (Visitor) TableName() string { return "app_visitors" }

type Assignment struct {
	ID             string     `gorm:"column:id;type:uuid;primaryKey" json:"id"`
	ExperimentKey  string     `gorm:"column:experiment_key;type:text;not null" json:"experiment_key"`
	AnonID         string     `gorm:"column:anon_id;type:text;not null" json:"anon_id"`
	UserID         *string    `gorm:"column:user_id;type:uuid" json:"user_id,omitempty"`
	Variant        string     `gorm:"column:variant;type:text;not null" json:"variant"`
	AssignedAt     time.Time  `gorm:"column:assigned_at;type:timestamptz;not null" json:"assigned_at"`
	FirstExposedAt *time.Time `gorm:"column:first_exposed_at;type:timestamptz" json:"first_exposed_at,omitempty"`
	ExcludedReason *string    `gorm:"column:excluded_reason;type:text" json:"excluded_reason,omitempty"`
}

func (Assignment) TableName() string { return "experiment_assignments" }

type Event struct {
	ID        string         `gorm:"column:id;type:uuid;primaryKey" json:"id"`
	AnonID    string         `gorm:"column:anon_id;type:text;not null" json:"anon_id"`
	UserID    *string        `gorm:"column:user_id;type:uuid" json:"user_id,omitempty"`
	Name      string         `gorm:"column:name;type:text;not null" json:"name"`
	Props     map[string]any `gorm:"column:props;type:jsonb;serializer:json;not null" json:"props"`
	ClientAt  *time.Time     `gorm:"column:client_at;type:timestamptz" json:"client_at,omitempty"`
	CreatedAt time.Time      `gorm:"column:created_at;type:timestamptz;not null" json:"created_at"`
}

func (Event) TableName() string { return "app_events" }

// Served is what the client renders. Tracked is false for anyone outside the
// experiment population (existing users, overrides, stopped tests); their
// behaviour must not be counted in either arm.
type Served struct {
	Variant string `json:"variant"`
	Tracked bool   `json:"tracked"`
}

// VariantSummary counts one arm. Outcome counts only include units whose
// window has fully elapsed (Matured24h / Matured48h are their denominators).
type VariantSummary struct {
	Variant           string `gorm:"column:variant" json:"variant"`
	Assigned          int64  `gorm:"column:assigned" json:"assigned"`
	Excluded          int64  `gorm:"column:excluded" json:"excluded"`
	Exposed           int64  `gorm:"column:exposed" json:"exposed"`
	ExposedLoggedIn   int64  `gorm:"column:exposed_logged_in" json:"exposed_logged_in"`
	Matured24h        int64  `gorm:"column:matured_24h" json:"matured_24h"`
	Matured48h        int64  `gorm:"column:matured_48h" json:"matured_48h"`
	AIWithin24h       int64  `gorm:"column:ai_within_24h" json:"ai_within_24h"`
	RecordWithin24h   int64  `gorm:"column:record_within_24h" json:"record_within_24h"`
	RecordOnSecondDay int64  `gorm:"column:record_on_second_day" json:"record_on_second_day"`
}
