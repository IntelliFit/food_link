package domain

import "time"

const (
	AdminAccountStatusActive   = "active"
	AdminAccountStatusDisabled = "disabled"
)

type AdminAccount struct {
	ID           string
	Username     string
	DisplayName  string
	PasswordHash string
	Status       string
	LastLoginAt  *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
