package domain

import "time"

// FeedReportItem 是 Admin 后台展示用的举报记录，包含举报人/被举报人用户信息。
type FeedReportItem struct {
	ID             string     `json:"id"`
	ReporterUserID string     `json:"reporter_user_id"`
	ReporterNickname string   `json:"reporter_nickname"`
	ReporterAvatar   string   `json:"reporter_avatar"`
	ReportedUserID string     `json:"reported_user_id"`
	ReportedNickname string   `json:"reported_nickname"`
	ReportedAvatar   string   `json:"reported_avatar"`
	TargetType     string     `json:"target_type"`
	TargetID       string     `json:"target_id"`
	Reason         string     `json:"reason"`
	ReasonName     string     `json:"reason_name"`
	ExtraContent   string     `json:"extra_content"`
	Status         string     `json:"status"`
	ResolutionNote string     `json:"resolution_note"`
	HandledBy      *string    `json:"handled_by"`
	HandledAt      *time.Time `json:"handled_at"`
	CreatedAt      *time.Time `json:"created_at"`
	UpdatedAt      *time.Time `json:"updated_at"`
}

// FeedReportTargetSnapshot 用于 Admin 详情展示被举报目标摘要。
type FeedReportTargetSnapshot struct {
	Title       string   `json:"title"`
	Body        string   `json:"body"`
	Description string   `json:"description"`
	ImageURLs   []string `json:"image_urls"`
	AuthorID    string   `json:"author_id"`
	CreatedAt   *time.Time `json:"created_at"`
}
