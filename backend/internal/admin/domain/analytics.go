package domain

import "time"

type AnalyticsDay struct {
	Day         string    `json:"day"`
	DAU         *int64    `json:"dau"`
	MAU         *int64    `json:"mau"`
	PayingUsers int64     `json:"paying_users"`
	UpdatedAt   time.Time `json:"updated_at"`
}
type AnalyticsOverview struct {
	Today               AnalyticsDay   `json:"today"`
	PeriodPayingUsers   int64          `json:"period_paying_users"`
	TotalPayingUsers    int64          `json:"total_paying_users"`
	ActivePaidMembers   int64          `json:"active_paid_members"`
	Days                []AnalyticsDay `json:"days"`
	UpdatedAt           time.Time      `json:"updated_at"`
	CollectionStartedAt time.Time      `json:"collection_started_at"`
	Timezone            string         `json:"timezone"`
}
