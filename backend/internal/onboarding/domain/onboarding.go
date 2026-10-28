package domain

import (
	"encoding/json"
	"time"
)

// ConfigKey is the app_content_configs row that drives the onboarding_v2
// trust badges and guest-try limits.
const ConfigKey = "onboarding_v2"

// TryEventName is written to app_events for every guest try, before the model
// is called, so the per-install and global daily caps also count failures.
// The "srv." prefix is reserved: clients cannot report events under it.
const TryEventName = "srv.onboarding_try"

type TryLimits struct {
	PerInstall int
	Global     int
}

type TryVerdict string

const (
	TryAllowed       TryVerdict = "allowed"
	TryInstallCapped TryVerdict = "install_capped"
	TryGlobalCapped  TryVerdict = "global_capped"
)

type TrustBadge struct {
	Icon string `json:"icon"`
	Text string `json:"text"`
}

// Config is edited in the admin console. Defaults carry no claims and empty
// text is not shown, so a claim only appears once someone fills it in.
type Config struct {
	Badges                  []TrustBadge `json:"badges"`
	SourceLines             []string     `json:"source_lines"`
	ResultLine              string       `json:"result_line"`
	GuestTryPerInstallDaily int          `json:"guest_try_per_install_daily"`
	GuestTryGlobalDaily     int          `json:"guest_try_global_daily"`
}

// PublicConfig is what guests receive; the limits stay server-side.
type PublicConfig struct {
	Badges      []TrustBadge `json:"badges"`
	SourceLines []string     `json:"source_lines"`
	ResultLine  string       `json:"result_line"`
}

func (c Config) Public() PublicConfig {
	return PublicConfig{Badges: c.Badges, SourceLines: c.SourceLines, ResultLine: c.ResultLine}
}

func DefaultConfig() Config {
	return Config{
		Badges:                  []TrustBadge{},
		SourceLines:             []string{},
		GuestTryPerInstallDaily: 3,
		GuestTryGlobalDaily:     300,
	}
}

type ContentConfig struct {
	Key       string          `gorm:"column:config_key;type:text;primaryKey"`
	Value     json.RawMessage `gorm:"column:value;type:jsonb;not null"`
	UpdatedAt time.Time       `gorm:"column:updated_at;type:timestamptz;not null"`
	UpdatedBy string          `gorm:"column:updated_by;type:text;not null;default:''"`
}

func (ContentConfig) TableName() string { return "app_content_configs" }

// Stats are live counts shown as credibility numbers. Each count only covers
// rows that are actually in use (published, active, reviewed).
type Stats struct {
	StandardFoods      int64     `json:"standard_foods"`
	AuthoritativeFoods int64     `json:"authoritative_foods"`
	CampusDishes       int64     `json:"campus_dishes"`
	CampusSchools      int64     `json:"campus_schools"`
	PackagedFoods      int64     `json:"packaged_foods"`
	Users              int64     `json:"users"`
	FoodRecords        int64     `json:"food_records"`
	AsOf               time.Time `json:"as_of"`
}
