package domain

import "time"

// AnalysisTask — table: analysis_tasks
type AnalysisTask struct {
	ID           string         `gorm:"column:id"`
	UserID       string         `gorm:"column:user_id"`
	TaskType     string         `gorm:"column:task_type"` // food, food_text, precision_plan, health_report
	Status       string         `gorm:"column:status"`    // pending, processing, done, failed, cancelled, timed_out
	ImageURL     *string        `gorm:"column:image_url"`
	ImagePaths   []string       `gorm:"column:image_paths;serializer:json"`
	TextInput    *string        `gorm:"column:text_input"`
	Payload      map[string]any `gorm:"column:payload;serializer:json"`
	Result       map[string]any `gorm:"column:result;serializer:json"`
	ErrorMessage *string        `gorm:"column:error_message"`
	CreatedAt    *time.Time     `gorm:"column:created_at"`
	UpdatedAt    *time.Time     `gorm:"column:updated_at"`
}

func (AnalysisTask) TableName() string { return "analysis_tasks" }

// PrecisionSession — table: precision_sessions
type PrecisionSession struct {
	ID            string     `gorm:"column:id"`
	UserID        string     `gorm:"column:user_id"`
	Status        string     `gorm:"column:status"`
	RoundIndex    int        `gorm:"column:round_index"`
	CurrentTaskID *string    `gorm:"column:current_task_id"`
	CreatedAt     *time.Time `gorm:"column:created_at"`
}

func (PrecisionSession) TableName() string { return "precision_sessions" }

// PrecisionSessionRound — table: precision_session_rounds
type PrecisionSessionRound struct {
	ID         string     `gorm:"column:id"`
	SessionID  string     `gorm:"column:session_id"`
	RoundIndex int        `gorm:"column:round_index"`
	CreatedAt  *time.Time `gorm:"column:created_at"`
}

func (PrecisionSessionRound) TableName() string { return "precision_session_rounds" }
