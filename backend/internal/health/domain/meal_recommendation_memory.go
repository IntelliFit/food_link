package domain

import "time"

// Issued options and actual interactions are separate: creating a row is NOT an exposure.
// No location, health profile, chat text or food-record contents are stored here.
type MealRecommendationMemory struct {
	ID            string
	UserID        string
	RunID         string
	ContextKey    string
	OptionKey     string
	SourceID      string
	Fingerprint   string
	Family        string
	MealDate      string
	MealType      string
	EngineVersion string
	CreatedAt     time.Time
	ShownAt       *time.Time
	SkippedAt     *time.Time
	SelectedAt    *time.Time
}
