package do

import "time"

// Statistics live in separate tables and never update business entities.
type AnalyticsActivityDO struct {
	Day       string    `gorm:"type:date;primaryKey"`
	UserID    string    `gorm:"type:uuid;primaryKey"`
	CreatedAt time.Time `gorm:"type:timestamptz;not null;default:now()"`
}

func (AnalyticsActivityDO) TableName() string { return "admin_analytics_activity" }

type AnalyticsDailyDO struct {
	Day         string `gorm:"type:date;primaryKey"`
	DAU         *int64
	MAU         *int64
	PayingUsers int64
	UpdatedAt   time.Time `gorm:"type:timestamptz;not null"`
}

func (AnalyticsDailyDO) TableName() string { return "admin_analytics_daily" }

type AnalyticsStateDO struct {
	ID        int       `gorm:"primaryKey"`
	StartedAt time.Time `gorm:"type:timestamptz;not null;default:now()"`
}

func (AnalyticsStateDO) TableName() string { return "admin_analytics_state" }
