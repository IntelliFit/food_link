package do

import "time"

type PushPreferencesDO struct {
	UserID    string         `gorm:"column:user_id;type:uuid;primaryKey"`
	Settings  map[string]any `gorm:"column:settings;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	UpdatedAt time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (PushPreferencesDO) TableName() string { return "push_reminder_preferences" }

type PushDeviceDO struct {
	ID         string    `gorm:"column:id;type:text;primaryKey"`
	UserID     string    `gorm:"column:user_id;type:uuid;not null;index:idx_push_devices_user_active,priority:1"`
	Token      string    `gorm:"column:token;type:text;not null;uniqueIndex:idx_push_devices_active_token,where:active = true"`
	ProjectID  string    `gorm:"column:project_id;type:text;not null"`
	Platform   string    `gorm:"column:platform;type:text;not null"`
	Active     bool      `gorm:"column:active;not null;default:false;index:idx_push_devices_user_active,priority:2"`
	LastSeenAt time.Time `gorm:"column:last_seen_at;type:timestamptz;not null"`
	CreatedAt  time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt  time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (PushDeviceDO) TableName() string { return "push_devices" }

type PushDeliveryDO struct {
	ID                 string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID             string     `gorm:"column:user_id;type:uuid;not null;index:idx_push_delivery_user_created,priority:1"`
	DeviceID           string     `gorm:"column:device_id;type:text;not null"`
	DedupeKey          string     `gorm:"column:dedupe_key;type:text;not null;uniqueIndex:idx_push_delivery_dedupe"`
	TokenHash          string     `gorm:"column:token_hash;type:text;not null"`
	PreferencesVersion time.Time  `gorm:"column:preferences_version;type:timestamptz;not null"`
	Kind               string     `gorm:"column:kind;type:text;not null"`
	MealType           string     `gorm:"column:meal_type;type:text;not null;default:''"`
	LocalDate          string     `gorm:"column:local_date;type:text;not null"`
	Status             string     `gorm:"column:status;type:text;not null;default:'pending';index:idx_push_delivery_due,priority:1"`
	NotBefore          time.Time  `gorm:"column:not_before;type:timestamptz;not null;index:idx_push_delivery_due,priority:2"`
	ExpiresAt          time.Time  `gorm:"column:expires_at;type:timestamptz;not null"`
	Attempts           int        `gorm:"column:attempts;not null;default:0"`
	LeaseID            string     `gorm:"column:lease_id;type:text;not null;default:''"`
	LeaseUntil         *time.Time `gorm:"column:lease_until;type:timestamptz"`
	TicketID           string     `gorm:"column:ticket_id;type:text;not null;default:''"`
	ReceiptCheckAt     *time.Time `gorm:"column:receipt_check_at;type:timestamptz;index:idx_push_delivery_receipt"`
	AcceptedAt         *time.Time `gorm:"column:accepted_at;type:timestamptz"`
	LastCode           string     `gorm:"column:last_code;type:text;not null;default:''"`
	CreatedAt          time.Time  `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_push_delivery_user_created,priority:2"`
	UpdatedAt          time.Time  `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (PushDeliveryDO) TableName() string { return "push_deliveries" }
