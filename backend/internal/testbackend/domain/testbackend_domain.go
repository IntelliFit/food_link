package domain

import "time"

// Prompt — table: test_prompts
type Prompt struct {
	ID        string     `gorm:"column:id;primaryKey" json:"id"`
	Name      string     `gorm:"column:name" json:"name"`
	Content   string     `gorm:"column:content" json:"content"`
	ModelType string     `gorm:"column:model_type" json:"model_type"`
	IsActive  bool       `gorm:"column:is_active" json:"is_active"`
	Version   int        `gorm:"column:version" json:"version"`
	CreatedBy *string    `gorm:"column:created_by" json:"created_by"`
	CreatedAt *time.Time `gorm:"column:created_at" json:"created_at"`
	UpdatedAt *time.Time `gorm:"column:updated_at" json:"updated_at"`
}

func (Prompt) TableName() string { return "test_prompts" }

// PromptHistory — table: test_prompt_history
type PromptHistory struct {
	ID        string     `gorm:"column:id;primaryKey" json:"id"`
	PromptID  string     `gorm:"column:prompt_id" json:"prompt_id"`
	Name      string     `gorm:"column:name" json:"name"`
	Content   string     `gorm:"column:content" json:"content"`
	ModelType string     `gorm:"column:model_type" json:"model_type"`
	Version   int        `gorm:"column:version" json:"version"`
	CreatedBy *string    `gorm:"column:created_by" json:"created_by"`
	CreatedAt *time.Time `gorm:"column:created_at" json:"created_at"`
}

func (PromptHistory) TableName() string { return "test_prompt_history" }

// TestBatch — table: test_batches
type TestBatch struct {
	ID        string         `gorm:"column:id;primaryKey" json:"id"`
	Name      string         `gorm:"column:name" json:"name"`
	DatasetID string         `gorm:"column:dataset_id" json:"dataset_id"`
	Status    string         `gorm:"column:status" json:"status"` // pending, running, done, failed
	Config    map[string]any `gorm:"column:config;serializer:json" json:"config"`
	Progress  int            `gorm:"column:progress" json:"progress"`
	Results   map[string]any `gorm:"column:results;serializer:json" json:"results"`
	CreatedAt *time.Time     `gorm:"column:created_at" json:"created_at"`
	UpdatedAt *time.Time     `gorm:"column:updated_at" json:"updated_at"`
}

func (TestBatch) TableName() string { return "test_batches" }

// TestDataset — table: test_datasets
type TestDataset struct {
	ID         string     `gorm:"column:id;primaryKey" json:"id"`
	Name       string     `gorm:"column:name" json:"name"`
	ImagePaths []string   `gorm:"column:image_paths;serializer:json" json:"image_paths"`
	Status     string     `gorm:"column:status" json:"status"`
	CreatedAt  *time.Time `gorm:"column:created_at" json:"created_at"`
}

func (TestDataset) TableName() string { return "test_datasets" }
