package do

import "time"

// CanteenCaptureSessionDO is one collector's visit to one canteen window.
type CanteenCaptureSessionDO struct {
	ID                 string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	ClientSessionKey   string         `gorm:"column:client_session_key;type:text;not null;uniqueIndex:uk_canteen_capture_sessions_client_key"`
	UserID             string         `gorm:"column:user_id;type:uuid;not null;index:idx_canteen_capture_sessions_user_created,priority:1"`
	VenueType          string         `gorm:"column:venue_type;type:text;not null;default:'university'"`
	SchoolID           *string        `gorm:"column:school_id;type:uuid;index:idx_canteen_capture_sessions_school"`
	CampusID           *string        `gorm:"column:campus_id;type:uuid"`
	CanteenID          *string        `gorm:"column:canteen_id;type:uuid;index:idx_canteen_capture_sessions_canteen"`
	WindowID           *string        `gorm:"column:window_id;type:uuid"`
	OrganizationName   string         `gorm:"column:organization_name;type:text;not null"`
	AreaName           string         `gorm:"column:area_name;type:text;not null;default:''"`
	CanteenName        string         `gorm:"column:canteen_name;type:text;not null"`
	Floor              string         `gorm:"column:floor;type:text;not null;default:''"`
	WindowName         string         `gorm:"column:window_name;type:text;not null"`
	WindowKey          string         `gorm:"column:window_key;type:text;not null;index:idx_canteen_capture_sessions_window_key"`
	ServiceMode        string         `gorm:"column:service_mode;type:text;not null;default:'unknown';check:canteen_capture_sessions_service_mode_valid,service_mode IN ('unknown','fixed_portion','combo','self_select')"`
	Status             string         `gorm:"column:status;type:text;not null;default:'draft';index:idx_canteen_capture_sessions_status;check:canteen_capture_sessions_status_valid,status IN ('draft','extracting','extracted','extract_failed','submitted')"`
	ExtractTaskID      *string        `gorm:"column:extract_task_id;type:uuid"`
	ExtractError       string         `gorm:"column:extract_error;type:text;not null;default:''"`
	Extraction         map[string]any `gorm:"column:extraction;type:jsonb;serializer:json"`
	ExceptionStatus    string         `gorm:"column:exception_status;type:text;not null;default:'none';index:idx_canteen_capture_sessions_exception;check:canteen_capture_sessions_exception_valid,exception_status IN ('none','pending','resolved')"`
	BatchID            *string        `gorm:"column:batch_id;type:uuid"`
	MenuItemCount      int            `gorm:"column:menu_item_count;type:integer;not null;default:0"`
	PublishedItemCount int            `gorm:"column:published_item_count;type:integer;not null;default:0"`
	ExceptionItemCount int            `gorm:"column:exception_item_count;type:integer;not null;default:0"`
	PhotoItemCount     int            `gorm:"column:photo_item_count;type:integer;not null;default:0"`
	SubmittedAt        *time.Time     `gorm:"column:submitted_at;type:timestamptz"`
	CreatedAt          *time.Time     `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_canteen_capture_sessions_user_created,priority:2,sort:desc"`
	UpdatedAt          *time.Time     `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (CanteenCaptureSessionDO) TableName() string { return "canteen_capture_sessions" }

// CanteenCaptureAssetDO is one uploaded original photo of a capture session.
type CanteenCaptureAssetDO struct {
	ID             string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	SessionID      string     `gorm:"column:session_id;type:uuid;not null;index:idx_canteen_capture_assets_session;uniqueIndex:uk_canteen_capture_assets_session_hash,priority:1"`
	UserID         string     `gorm:"column:user_id;type:uuid;not null;index:idx_canteen_capture_assets_user"`
	Kind           string     `gorm:"column:kind;type:text;not null;check:canteen_capture_assets_kind_valid,kind IN ('menu','dish','stall','other')"`
	ObjectKey      string     `gorm:"column:object_key;type:text;not null"`
	ContentSHA256  string     `gorm:"column:content_sha256;type:text;not null;index:idx_canteen_capture_assets_hash;uniqueIndex:uk_canteen_capture_assets_session_hash,priority:2"`
	SourceFilename string     `gorm:"column:source_filename;type:text;not null;default:''"`
	ItemKey        string     `gorm:"column:item_key;type:text;not null;default:''"`
	DishName       string     `gorm:"column:dish_name;type:text;not null;default:''"`
	Status         string     `gorm:"column:status;type:text;not null;default:'active';check:canteen_capture_assets_status_valid,status IN ('active','removed')"`
	CreatedAt      *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt      *time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (CanteenCaptureAssetDO) TableName() string { return "canteen_capture_assets" }

// CanteenCollectorLedgerDO records collector earnings (positive) and their
// use for membership or withdrawal (negative), in fen.
type CanteenCollectorLedgerDO struct {
	ID          string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID      string         `gorm:"column:user_id;type:uuid;not null;index:idx_canteen_collector_ledger_user_created,priority:1"`
	EntryType   string         `gorm:"column:entry_type;type:text;not null;index:idx_canteen_collector_ledger_type_status,priority:1;check:canteen_collector_ledger_type_valid,entry_type IN ('window_reward','membership_redeem','withdrawal')"`
	Status      string         `gorm:"column:status;type:text;not null;index:idx_canteen_collector_ledger_type_status,priority:2;check:canteen_collector_ledger_status_valid,status IN ('confirmed','rate_pending','rejected','requested','paid','cancelled')"`
	AmountCents int64          `gorm:"column:amount_cents;type:bigint;not null;default:0"`
	SessionID   *string        `gorm:"column:session_id;type:uuid;index:idx_canteen_collector_ledger_session"`
	WindowKey   *string        `gorm:"column:window_key;type:text;index:idx_canteen_collector_ledger_window"`
	SourceKey   string         `gorm:"column:source_key;type:text;not null;uniqueIndex:uk_canteen_collector_ledger_source_key"`
	Meta        map[string]any `gorm:"column:meta;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	ReviewNote  string         `gorm:"column:review_note;type:text;not null;default:''"`
	CreatedAt   *time.Time     `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_canteen_collector_ledger_user_created,priority:2,sort:desc"`
	UpdatedAt   *time.Time     `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (CanteenCollectorLedgerDO) TableName() string { return "canteen_collector_ledger" }

func CanteenCaptureModels() []any {
	return []any{&CanteenCaptureSessionDO{}, &CanteenCaptureAssetDO{}, &CanteenCollectorLedgerDO{}}
}
