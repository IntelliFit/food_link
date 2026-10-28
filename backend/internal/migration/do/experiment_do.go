package do

import "time"

// Experiment tables are additive and never touch business entities. They hold
// the A/B definitions, the anonymous install id that exists before login, the
// sticky per-visitor split and client funnel events.

type ExperimentDO struct {
	ExperimentKey   string     `gorm:"column:experiment_key;type:text;primaryKey"`
	Description     string     `gorm:"column:description;type:text;not null;default:''"`
	Status          string     `gorm:"column:status;type:text;not null;default:'draft'"`
	Audience        string     `gorm:"column:audience;type:text;not null;default:'new_users'"`
	Variants        string     `gorm:"column:variants;type:jsonb;not null"`
	Salt            string     `gorm:"column:salt;type:text;not null"`
	OverrideVariant *string    `gorm:"column:override_variant;type:text"`
	StartedAt       *time.Time `gorm:"column:started_at;type:timestamptz"`
	EndedAt         *time.Time `gorm:"column:ended_at;type:timestamptz"`
	CreatedAt       time.Time  `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt       time.Time  `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (ExperimentDO) TableName() string { return "experiments" }

type AppVisitorDO struct {
	AnonID      string     `gorm:"column:anon_id;type:text;primaryKey"`
	UserID      *string    `gorm:"column:user_id;type:uuid;index:idx_app_visitors_user"`
	Platform    string     `gorm:"column:platform;type:text;not null;default:''"`
	AppVersion  string     `gorm:"column:app_version;type:text;not null;default:''"`
	FirstSeenAt time.Time  `gorm:"column:first_seen_at;type:timestamptz;not null;index:idx_app_visitors_first_seen"`
	LastSeenAt  time.Time  `gorm:"column:last_seen_at;type:timestamptz;not null"`
	BoundAt     *time.Time `gorm:"column:bound_at;type:timestamptz"`
}

func (AppVisitorDO) TableName() string { return "app_visitors" }

type ExperimentAssignmentDO struct {
	ID             string     `gorm:"column:id;type:uuid;primaryKey"`
	ExperimentKey  string     `gorm:"column:experiment_key;type:text;not null;uniqueIndex:uk_experiment_assignments_anon,priority:1"`
	AnonID         string     `gorm:"column:anon_id;type:text;not null;uniqueIndex:uk_experiment_assignments_anon,priority:2"`
	UserID         *string    `gorm:"column:user_id;type:uuid"`
	Variant        string     `gorm:"column:variant;type:text;not null"`
	AssignedAt     time.Time  `gorm:"column:assigned_at;type:timestamptz;not null"`
	FirstExposedAt *time.Time `gorm:"column:first_exposed_at;type:timestamptz"`
	ExcludedReason *string    `gorm:"column:excluded_reason;type:text"`
}

func (ExperimentAssignmentDO) TableName() string { return "experiment_assignments" }

type AppEventDO struct {
	ID        string         `gorm:"column:id;type:uuid;primaryKey"`
	AnonID    string         `gorm:"column:anon_id;type:text;not null;index:idx_app_events_anon"`
	UserID    *string        `gorm:"column:user_id;type:uuid;index:idx_app_events_user"`
	Name      string         `gorm:"column:name;type:text;not null;index:idx_app_events_name_created,priority:1"`
	Props     map[string]any `gorm:"column:props;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	ClientAt  *time.Time     `gorm:"column:client_at;type:timestamptz"`
	CreatedAt time.Time      `gorm:"column:created_at;type:timestamptz;not null;index:idx_app_events_name_created,priority:2,sort:desc"`
}

func (AppEventDO) TableName() string { return "app_events" }

func ExperimentModels() []any {
	return []any{&ExperimentDO{}, &AppVisitorDO{}, &ExperimentAssignmentDO{}, &AppEventDO{}}
}

// AppContentConfigDO holds small admin-edited content blobs (e.g. onboarding
// trust badges), one JSON object per key.
type AppContentConfigDO struct {
	ConfigKey string    `gorm:"column:config_key;type:text;primaryKey"`
	Value     string    `gorm:"column:value;type:jsonb;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
	UpdatedBy string    `gorm:"column:updated_by;type:text;not null;default:''"`
}

func (AppContentConfigDO) TableName() string { return "app_content_configs" }
