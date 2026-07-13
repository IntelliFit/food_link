package domain

import (
	"time"

	foodrecordservice "food_link/backend/internal/foodrecord/service"
)

// PackagedFoodTestRun 记录一次包装食品识别测试运行。
type PackagedFoodTestRun struct {
	ID             string                 `json:"id"`
	PackagedFoodID string                 `json:"packaged_food_id"`
	Status         string                 `json:"status"`
	Result         *foodrecordservice.PackagedProductExtractResult `json:"result,omitempty"`
	Metadata       PackagedFoodTestRunMetadata                     `json:"metadata"`
	ErrorMessage   *string                `json:"error_message,omitempty"`
	StartedAt      *time.Time             `json:"started_at,omitempty"`
	CompletedAt    *time.Time             `json:"completed_at,omitempty"`
	CreatedBy      *string                `json:"created_by,omitempty"`
	CreatedAt      *time.Time             `json:"created_at,omitempty"`
	UpdatedAt      *time.Time             `json:"updated_at,omitempty"`
}

// PackagedFoodTestRunMetadata 记录运行耗时与上游 token 等元数据。
type PackagedFoodTestRunMetadata struct {
	DurationMs   int64          `json:"duration_ms"`
	Model        string         `json:"model,omitempty"`
	ResponseID   string         `json:"response_id,omitempty"`
	InputTokens  int64          `json:"input_tokens,omitempty"`
	OutputTokens int64          `json:"output_tokens,omitempty"`
	TotalTokens  int64          `json:"total_tokens,omitempty"`
	RawMeta      map[string]any `json:"raw_meta,omitempty"`
}
