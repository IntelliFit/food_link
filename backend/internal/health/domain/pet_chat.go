package domain

import "time"

type PetChatSession struct {
	ID                  string
	UserID              string
	PetID               *string
	Title               string
	RangeType           string
	Status              string
	ContextStartDate    string
	ContextEndDate      string
	ContextFingerprint  string
	RecordedDays        int
	LastQuestion        string
	LastAnswer          string
	LastMessageAt       *time.Time
	TotalCreditsCharged int
	Meta                map[string]any
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type PetChatMessage struct {
	ID               string
	SessionID        string
	UserID           string
	Role             string
	Content          string
	MessageType      string
	RangeType        string
	CreditsCharged   int
	AIUsagePricing   map[string]any
	EstimatedPricing map[string]any
	Meta             map[string]any
	CreatedAt        time.Time
}
