package domain

import "time"

// Published notices are immutable: changed content must get a new ID.
type Update struct {
	ID           string     `json:"id"`
	Title        string     `json:"title"`
	Content      string     `json:"content"`
	MinVersion   string     `json:"min_version"`
	Status       string     `json:"status"`
	CreatedBy    string     `json:"created_by"`
	CreatedAt    time.Time  `json:"created_at"`
	PublishedAt  *time.Time `json:"published_at"`
	Acknowledged int64      `json:"acknowledged_count"`
}

func (Update) TableName() string { return "product_updates" }
