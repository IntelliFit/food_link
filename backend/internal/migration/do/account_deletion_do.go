package do

import "time"

// No FK to weapp_user: the receipt must survive deletion and invalidate old sessions.
type AccountDeletionDO struct {
	UserID        string     `gorm:"column:user_id;type:uuid;primaryKey"`
	State         string     `gorm:"column:state;type:text;not null;index:idx_account_deletion_due,priority:1"`
	RequestedAt   time.Time  `gorm:"column:requested_at;type:timestamptz;not null"`
	ExecuteAt     time.Time  `gorm:"column:execute_at;type:timestamptz;not null;index:idx_account_deletion_due,priority:2"`
	RevokedBefore int64      `gorm:"column:revoked_before;not null"`
	Snapshot      string     `gorm:"column:snapshot;type:text;not null;default:'{}'"`
	CompletedAt   *time.Time `gorm:"column:completed_at;type:timestamptz"`
	Attempts      int        `gorm:"column:attempts;not null;default:0"`
	ImageCursor   int        `gorm:"column:image_cursor;not null;default:0"`
}

func (AccountDeletionDO) TableName() string { return "account_deletions" }

// Only allowlisted financial/evidence fields, never credentials or entire user rows.
type AccountDeletionRetainedDO struct {
	ID          string    `gorm:"column:id;type:text;primaryKey"`
	Kind        string    `gorm:"column:kind;type:text;not null"`
	Payload     string    `gorm:"column:payload;type:text;not null"`
	DeleteAfter time.Time `gorm:"column:delete_after;type:timestamptz;not null;index"`
}

func (AccountDeletionRetainedDO) TableName() string { return "account_deletion_retained" }
