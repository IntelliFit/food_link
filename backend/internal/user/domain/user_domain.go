package domain

import "time"

// UserHealthDocument - table: user_health_documents
type UserHealthDocument struct {
	ID               string         `gorm:"column:id"`
	UserID           string         `gorm:"column:user_id"`
	DocumentType     string         `gorm:"column:document_type"`
	ImageURL         *string        `gorm:"column:image_url"`
	ExtractedContent map[string]any `gorm:"column:extracted_content;serializer:json"`
	CreatedAt        *time.Time     `gorm:"column:created_at"`
}

func (UserHealthDocument) TableName() string { return "user_health_documents" }

// UserModeSwitchLog - table: user_mode_switch_logs
type UserModeSwitchLog struct {
	ID         string     `gorm:"column:id"`
	UserID     string     `gorm:"column:user_id"`
	FromMode   string     `gorm:"column:from_mode"`
	ToMode     string     `gorm:"column:to_mode"`
	ChangedBy  string     `gorm:"column:changed_by"`
	ReasonCode *string    `gorm:"column:reason_code"`
	CreatedAt  *time.Time `gorm:"column:created_at"`
}

func (UserModeSwitchLog) TableName() string { return "user_mode_switch_logs" }

// AnalysisTask - table: analysis_tasks (minimal for health_report creation)
type AnalysisTask struct {
	ID        string         `gorm:"column:id"`
	UserID    string         `gorm:"column:user_id"`
	TaskType  string         `gorm:"column:task_type"`
	Status    string         `gorm:"column:status"`
	ImageURL  *string        `gorm:"column:image_url"`
	ImagePaths []string      `gorm:"column:image_paths;serializer:json"`
	Payload   map[string]any `gorm:"column:payload;serializer:json"`
	CreatedAt *time.Time     `gorm:"column:created_at"`
}

func (AnalysisTask) TableName() string { return "analysis_tasks" }
