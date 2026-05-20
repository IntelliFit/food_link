package domain

import "time"

const (
	EventTypeOfflineReview = "offline_review"
)

type UserPet struct {
	ID            string     `gorm:"column:id;primaryKey" json:"id"`
	UserID        string     `gorm:"column:user_id" json:"user_id"`
	PetSeed       string     `gorm:"column:pet_seed" json:"pet_seed"`
	Name          string     `gorm:"column:name" json:"name"`
	Color         string     `gorm:"column:color" json:"color"`
	Shape         string     `gorm:"column:shape" json:"shape"`
	Pattern       string     `gorm:"column:pattern" json:"pattern"`
	Accessory     string     `gorm:"column:accessory" json:"accessory"`
	Personality   string     `gorm:"column:personality" json:"personality"`
	Level         int        `gorm:"column:level" json:"level"`
	Experience    int        `gorm:"column:experience" json:"experience"`
	TodayStatus   string     `gorm:"column:today_status" json:"today_status"`
	LastSettledOn *time.Time `gorm:"column:last_settled_on" json:"last_settled_on,omitempty"`
	TotalEvents   int        `gorm:"column:total_events" json:"total_events"`
	LastSummaryAt *time.Time `gorm:"column:last_summary_at" json:"last_summary_at,omitempty"`
	CreatedAt     *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt     *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (UserPet) TableName() string { return "user_pets" }

type UserPetEvent struct {
	ID           string         `gorm:"column:id;primaryKey" json:"id"`
	UserID       string         `gorm:"column:user_id" json:"user_id"`
	PetID        string         `gorm:"column:pet_id" json:"pet_id"`
	EventDate    time.Time      `gorm:"column:event_date" json:"event_date"`
	EventType    string         `gorm:"column:event_type" json:"event_type"`
	Title        string         `gorm:"column:title" json:"title"`
	Message      string         `gorm:"column:message" json:"message"`
	TaskText     string         `gorm:"column:task_text" json:"task_text"`
	HabitScore   int            `gorm:"column:habit_score" json:"habit_score"`
	ExpReward    int            `gorm:"column:exp_reward" json:"exp_reward"`
	CreditReward int            `gorm:"column:credit_reward" json:"credit_reward"`
	ScoreDetails map[string]any `gorm:"column:score_details;serializer:json" json:"score_details,omitempty"`
	IsRead       bool           `gorm:"column:is_read" json:"is_read"`
	ReadAt       *time.Time     `gorm:"column:read_at" json:"read_at,omitempty"`
	IsClaimed    bool           `gorm:"column:is_claimed" json:"is_claimed"`
	ClaimedAt    *time.Time     `gorm:"column:claimed_at" json:"claimed_at,omitempty"`
	CreatedAt    *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt    *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (UserPetEvent) TableName() string { return "user_pet_events" }

type UserPetDailyScore struct {
	ID           string         `gorm:"column:id;primaryKey" json:"id"`
	UserID       string         `gorm:"column:user_id" json:"user_id"`
	ScoreDate    time.Time      `gorm:"column:score_date" json:"score_date"`
	HabitScore   int            `gorm:"column:habit_score" json:"habit_score"`
	ExpGained    int            `gorm:"column:exp_gained" json:"exp_gained"`
	ScoreDetails map[string]any `gorm:"column:score_details;serializer:json" json:"score_details,omitempty"`
	CreatedAt    *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt    *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (UserPetDailyScore) TableName() string { return "user_pet_daily_scores" }
