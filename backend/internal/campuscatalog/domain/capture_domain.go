package domain

import "time"

// CaptureSession is one collector's visit to one canteen window. Menu photos,
// dish photos and the automatic extraction all hang off the session; only the
// items that pass the automatic checks (or are resolved later) become catalog
// items through the normal batch and revision path.
type CaptureSession struct {
	ID                 string             `gorm:"column:id" json:"id"`
	ClientSessionKey   string             `gorm:"column:client_session_key" json:"client_session_key"`
	UserID             string             `gorm:"column:user_id" json:"user_id"`
	VenueType          string             `gorm:"column:venue_type" json:"venue_type"`
	SchoolID           *string            `gorm:"column:school_id" json:"school_id,omitempty"`
	CampusID           *string            `gorm:"column:campus_id" json:"campus_id,omitempty"`
	CanteenID          *string            `gorm:"column:canteen_id" json:"canteen_id,omitempty"`
	WindowID           *string            `gorm:"column:window_id" json:"window_id,omitempty"`
	OrganizationName   string             `gorm:"column:organization_name" json:"organization_name"`
	AreaName           string             `gorm:"column:area_name" json:"area_name,omitempty"`
	CanteenName        string             `gorm:"column:canteen_name" json:"canteen_name"`
	Floor              string             `gorm:"column:floor" json:"floor,omitempty"`
	WindowName         string             `gorm:"column:window_name" json:"window_name"`
	WindowKey          string             `gorm:"column:window_key" json:"window_key"`
	ServiceMode        string             `gorm:"column:service_mode" json:"service_mode"`
	Status             string             `gorm:"column:status" json:"status"`
	ExtractTaskID      *string            `gorm:"column:extract_task_id" json:"extract_task_id,omitempty"`
	ExtractError       string             `gorm:"column:extract_error" json:"extract_error,omitempty"`
	Extraction         *CaptureExtraction `gorm:"column:extraction;serializer:json" json:"extraction,omitempty"`
	ExceptionStatus    string             `gorm:"column:exception_status" json:"exception_status"`
	BatchID            *string            `gorm:"column:batch_id" json:"batch_id,omitempty"`
	MenuItemCount      int                `gorm:"column:menu_item_count" json:"menu_item_count"`
	PublishedItemCount int                `gorm:"column:published_item_count" json:"published_item_count"`
	ExceptionItemCount int                `gorm:"column:exception_item_count" json:"exception_item_count"`
	PhotoItemCount     int                `gorm:"column:photo_item_count" json:"photo_item_count"`
	SubmittedAt        *time.Time         `gorm:"column:submitted_at" json:"submitted_at,omitempty"`
	CreatedAt          *time.Time         `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt          *time.Time         `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (CaptureSession) TableName() string { return "canteen_capture_sessions" }

// CaptureAsset is one uploaded original photo. The content hash is computed on
// the server so the same photo cannot be reused for another window's reward.
type CaptureAsset struct {
	ID             string     `gorm:"column:id" json:"id"`
	SessionID      string     `gorm:"column:session_id" json:"session_id"`
	UserID         string     `gorm:"column:user_id" json:"user_id"`
	Kind           string     `gorm:"column:kind" json:"kind"`
	ObjectKey      string     `gorm:"column:object_key" json:"-"`
	ContentSHA256  string     `gorm:"column:content_sha256" json:"content_sha256"`
	SourceFilename string     `gorm:"column:source_filename" json:"source_filename,omitempty"`
	ItemKey        string     `gorm:"column:item_key" json:"item_key,omitempty"`
	DishName       string     `gorm:"column:dish_name" json:"dish_name,omitempty"`
	Status         string     `gorm:"column:status" json:"status"`
	CreatedAt      *time.Time `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt      *time.Time `gorm:"column:updated_at" json:"updated_at,omitempty"`
	URL            string     `gorm:"-" json:"url,omitempty"`
}

func (CaptureAsset) TableName() string { return "canteen_capture_assets" }

// CollectorLedgerEntry is an immutable-ish money row. Earnings are positive,
// membership redemptions and withdrawals are negative. Amounts are in fen.
type CollectorLedgerEntry struct {
	ID          string         `gorm:"column:id" json:"id"`
	UserID      string         `gorm:"column:user_id" json:"user_id"`
	EntryType   string         `gorm:"column:entry_type" json:"entry_type"`
	Status      string         `gorm:"column:status" json:"status"`
	AmountCents int64          `gorm:"column:amount_cents" json:"amount_cents"`
	SessionID   *string        `gorm:"column:session_id" json:"session_id,omitempty"`
	WindowKey   *string        `gorm:"column:window_key" json:"window_key,omitempty"`
	SourceKey   string         `gorm:"column:source_key" json:"source_key"`
	Meta        map[string]any `gorm:"column:meta;serializer:json" json:"meta"`
	ReviewNote  string         `gorm:"column:review_note" json:"review_note,omitempty"`
	CreatedAt   *time.Time     `gorm:"column:created_at" json:"created_at,omitempty"`
	UpdatedAt   *time.Time     `gorm:"column:updated_at" json:"updated_at,omitempty"`
}

func (CollectorLedgerEntry) TableName() string { return "canteen_collector_ledger" }

// CaptureExtraction is the stored result of the two independent model passes
// plus the deterministic checks. It is evidence, not catalog truth.
type CaptureExtraction struct {
	Version int                  `json:"version"`
	Items   []CaptureItem        `json:"items"`
	Images  []CaptureImageResult `json:"images"`
	Models  []string             `json:"models,omitempty"`
	// Errors records per-photo model failures so a missing verification is
	// visible instead of silently turning every item into an exception.
	Errors      []string   `json:"errors,omitempty"`
	DurationMs  int64      `json:"duration_ms,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

type CaptureImageResult struct {
	AssetID         string   `json:"asset_id"`
	IsMenu          bool     `json:"is_menu"`
	Readable        bool     `json:"readable"`
	PrimaryLines    []string `json:"primary_lines,omitempty"`
	VerifierLines   []string `json:"verifier_lines,omitempty"`
	UnreadableNotes string   `json:"unreadable_notes,omitempty"`
}

type CaptureOptionGroup struct {
	Title   string   `json:"title"`
	Choices []string `json:"choices"`
}

// CaptureItem is one extracted or collector-added sellable line.
type CaptureItem struct {
	Key           string               `json:"key"`
	Kind          string               `json:"kind"`
	Name          string               `json:"name"`
	PriceText     string               `json:"price_text,omitempty"`
	Prices        []float64            `json:"prices,omitempty"`
	PriceUnit     string               `json:"price_unit,omitempty"`
	OptionGroups  []CaptureOptionGroup `json:"option_groups,omitempty"`
	Note          string               `json:"note,omitempty"`
	AssetIDs      []string             `json:"asset_ids,omitempty"`
	DishAssetIDs  []string             `json:"dish_asset_ids,omitempty"`
	Status        string               `json:"status"`
	Reasons       []string             `json:"reasons,omitempty"`
	Source        string               `json:"source"`
	CatalogItemID string               `json:"catalog_item_id,omitempty"`
	ResolvedBy    string               `json:"resolved_by,omitempty"`
}

const (
	CaptureKindDish       = "dish"
	CaptureKindCombo      = "combo"
	CaptureKindIngredient = "ingredient"

	CaptureItemPassed    = "passed"
	CaptureItemException = "exception"
	CaptureItemPublished = "published"
	CaptureItemDiscarded = "discarded"
	CaptureItemKept      = "kept"

	CaptureSourceModel      = "model"
	CaptureSourceCollector  = "collector"
	CaptureSourceLocalAgent = "local_agent"

	CaptureStatusDraft      = "draft"
	CaptureStatusExtracting = "extracting"
	CaptureStatusExtracted  = "extracted"
	CaptureStatusFailed     = "extract_failed"
	CaptureStatusSubmitted  = "submitted"

	CaptureExceptionNone     = "none"
	CaptureExceptionPending  = "pending"
	CaptureExceptionResolved = "resolved"

	CaptureAssetMenu  = "menu"
	CaptureAssetDish  = "dish"
	CaptureAssetStall = "stall"
	CaptureAssetOther = "other"

	LedgerWindowReward    = "window_reward"
	LedgerMembershipSpend = "membership_redeem"
	LedgerWithdrawal      = "withdrawal"

	LedgerStatusConfirmed   = "confirmed"
	LedgerStatusRatePending = "rate_pending"
	LedgerStatusRejected    = "rejected"
	LedgerStatusRequested   = "requested"
	LedgerStatusPaid        = "paid"
	LedgerStatusCancelled   = "cancelled"
)

// Reason codes explain why an item was not published automatically.
const (
	ReasonNameNotGrounded   = "NAME_NOT_GROUNDED"
	ReasonPriceNotGrounded  = "PRICE_NOT_GROUNDED"
	ReasonPassesDisagree    = "PASSES_DISAGREE"
	ReasonMissedByPrimary   = "MISSED_BY_PRIMARY"
	ReasonKindDisagree      = "KIND_DISAGREE"
	ReasonPriceConflict     = "PRICE_CONFLICT"
	ReasonPriceOutOfRange   = "PRICE_OUT_OF_RANGE"
	ReasonNameInvalid       = "NAME_INVALID"
	ReasonOptionsUngrounded = "OPTIONS_NOT_GROUNDED"
	ReasonVerifierFailed    = "VERIFIER_FAILED"
	ReasonSelfSelectSuspect = "SELF_SELECT_SUSPECTED"
)
