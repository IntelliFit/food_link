package domain

import (
	"time"

	"gorm.io/datatypes"
)

const (
	CategoryBug        = "bug"
	CategorySuggestion = "suggestion"
	CategoryExperience = "experience"
	CategoryOther      = "other"

	StatusOpen = "open"
)

type RecentRequestTrace struct {
	Method       string `json:"method"`
	Path         string `json:"path"`
	StatusCode   int    `json:"statusCode"`
	DurationMs   int    `json:"durationMs"`
	StartedAt    string `json:"startedAt"`
	TraceID      string `json:"traceId,omitempty"`
	RequestID    string `json:"requestId,omitempty"`
	HostName     string `json:"hostName,omitempty"`
	ErrorMessage string `json:"errorMessage,omitempty"`
}

type UserFeedback struct {
	ID                string                                  `gorm:"column:id" json:"id"`
	UserID            string                                  `gorm:"column:user_id" json:"user_id"`
	Category          string                                  `gorm:"column:category" json:"category"`
	Content           string                                  `gorm:"column:content" json:"content"`
	Contact           string                                  `gorm:"column:contact" json:"contact"`
	PagePath          string                                  `gorm:"column:page_path" json:"page_path"`
	AppVersion        string                                  `gorm:"column:app_version" json:"app_version"`
	ClientInfo        datatypes.JSONMap                       `gorm:"column:client_info;serializer:json" json:"client_info"`
	RecentRequests    datatypes.JSONSlice[RecentRequestTrace] `gorm:"column:recent_requests;serializer:json" json:"recent_requests"`
	ImageURLs         datatypes.JSONSlice[string]             `gorm:"column:image_urls;serializer:json" json:"image_urls"`
	SubmitTraceID     string                                  `gorm:"column:submit_trace_id" json:"submit_trace_id"`
	SubmitRequestID   string                                  `gorm:"column:submit_request_id" json:"submit_request_id"`
	SubmitHostName    string                                  `gorm:"column:submit_host_name" json:"submit_host_name"`
	Status            string                                  `gorm:"column:status" json:"status"`
	ResolutionMessage string                                  `gorm:"column:resolution_message" json:"resolution_message"`
	RewardCredits     int                                     `gorm:"column:reward_credits" json:"reward_credits"`
	RewardLedgerID    *string                                 `gorm:"column:reward_ledger_id" json:"reward_ledger_id,omitempty"`
	CreatedAt         *time.Time                              `gorm:"column:created_at" json:"created_at"`
	UpdatedAt         *time.Time                              `gorm:"column:updated_at" json:"updated_at"`
}

func (UserFeedback) TableName() string { return "user_feedback" }
