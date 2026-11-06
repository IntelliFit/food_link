package do

import "time"

// ResearchWeightSampleDO is one weighed dish contributed for the Chinese food
// weight benchmark: scale readings as ground truth plus evaluation photos
// taken off the scale. Grams are computed by the server from the readings.
type ResearchWeightSampleDO struct {
	ID                  string                `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID              string                `gorm:"column:user_id;type:uuid;not null;index:idx_research_weight_samples_user_created,priority:1;uniqueIndex:uk_research_weight_samples_user_client_key,priority:1"`
	ClientKey           string                `gorm:"column:client_key;type:text;not null;uniqueIndex:uk_research_weight_samples_user_client_key,priority:2"`
	Scene               string                `gorm:"column:scene;type:text;not null;check:research_weight_samples_scene_valid,scene IN ('canteen','home','takeout','restaurant','other')"`
	WeighingMode        string                `gorm:"column:weighing_mode;type:text;not null;check:research_weight_samples_mode_valid,weighing_mode IN ('whole','itemized','multi')"`
	DishName            string                `gorm:"column:dish_name;type:text;not null;default:''"`
	VenueName           string                `gorm:"column:venue_name;type:text;not null;default:''"`
	City                string                `gorm:"column:city;type:text;not null;default:''"`
	ContainerType       string                `gorm:"column:container_type;type:text;not null;check:research_weight_samples_container_valid,container_type IN ('bowl','plate','tray','box','other')"`
	TareMode            string                `gorm:"column:tare_mode;type:text;not null;check:research_weight_samples_tare_mode_valid,tare_mode IN ('measured','zeroed','after_meal','library','per_container')"`
	TareGrams           float64               `gorm:"column:tare_grams;type:numeric;not null;default:0"`
	GrossReadingGrams   *float64              `gorm:"column:gross_reading_grams;type:numeric"`
	TotalNetGrams       float64               `gorm:"column:total_net_grams;type:numeric;not null;check:research_weight_samples_net_positive,total_net_grams > 0"`
	ScalePrecisionGrams float64               `gorm:"column:scale_precision_grams;type:numeric;not null;default:1"`
	Items               []ResearchWeightItem  `gorm:"column:items;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	Photos              []ResearchWeightPhoto `gorm:"column:photos;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	ReferenceObject     string                `gorm:"column:reference_object;type:text;not null;default:'none'"`
	VideoObjectKey      string                `gorm:"column:video_object_key;type:text;not null;default:''"`
	Device              map[string]any        `gorm:"column:device;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	Notes               string                `gorm:"column:notes;type:text;not null;default:''"`
	ConsentVersion      string                `gorm:"column:consent_version;type:text;not null"`
	ConsentedAt         time.Time             `gorm:"column:consented_at;type:timestamptz;not null"`
	Status              string                `gorm:"column:status;type:text;not null;default:'pending';index:idx_research_weight_samples_status_created,priority:1;check:research_weight_samples_status_valid,status IN ('pending','approved','rejected')"`
	QualityTier         *string               `gorm:"column:quality_tier;type:text;check:research_weight_samples_tier_valid,quality_tier IS NULL OR quality_tier IN ('A','B','C')"`
	ReviewNote          string                `gorm:"column:review_note;type:text;not null;default:''"`
	ReviewedBy          *string               `gorm:"column:reviewed_by;type:text"`
	ReviewedAt          *time.Time            `gorm:"column:reviewed_at;type:timestamptz"`
	RewardCredits       int                   `gorm:"column:reward_credits;type:integer;not null;default:0;check:research_weight_samples_reward_nonnegative,reward_credits >= 0"`
	RewardedAt          *time.Time            `gorm:"column:rewarded_at;type:timestamptz"`
	BenchmarkSampleID   *string               `gorm:"column:benchmark_sample_id;type:uuid"`
	// Campus channel attribution: set by the server at submission from the
	// contributor's active campaign, never changed afterwards.
	CampaignID         *string `gorm:"column:campaign_id;type:uuid;index:idx_research_weight_samples_campaign_created,priority:1"`
	CollectionChannel  string  `gorm:"column:collection_channel;type:text;not null;default:'personal';check:research_weight_samples_channel_valid,collection_channel IN ('personal','campus_self_scale','campus_station','campus_same_dish')"`
	StationSessionID   *string `gorm:"column:station_session_id;type:uuid"`
	CanteenID          *string `gorm:"column:canteen_id;type:uuid"`
	CatalogItemID      *string `gorm:"column:catalog_item_id;type:uuid;index:idx_research_weight_samples_catalog_item"`
	PairedFoodRecordID *string `gorm:"column:paired_food_record_id;type:uuid"`
	// ReviewMode tells automatic decisions from reviewer ones; AutoReview keeps
	// every check the pipeline ran so a decision can be audited later.
	ReviewMode string                    `gorm:"column:review_mode;type:text;not null;default:'manual';check:research_weight_samples_review_mode_valid,review_mode IN ('manual','auto')"`
	AutoReview *ResearchWeightAutoReview `gorm:"column:auto_review;type:jsonb;serializer:json"`
	CreatedAt  *time.Time                `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_research_weight_samples_user_created,priority:2,sort:desc;index:idx_research_weight_samples_status_created,priority:2,sort:desc;index:idx_research_weight_samples_campaign_created,priority:2,sort:desc"`
	UpdatedAt  *time.Time                `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (ResearchWeightSampleDO) TableName() string { return "research_weight_samples" }

// ResearchWeightItem is one component added to the container in itemized
// mode, or one container (a takeout box, a bowl) in multi mode. In itemized
// mode CumulativeReadingGrams is what the scale showed after adding it; in
// multi mode the container's own gross reading, tare and tare source are set.
// Grams is always computed by the server.
type ResearchWeightItem struct {
	Name                   string   `json:"name"`
	CumulativeReadingGrams float64  `json:"cumulative_reading_grams"`
	Grams                  float64  `json:"grams"`
	ContainsBone           bool     `json:"contains_bone"`
	ContainsSoup           bool     `json:"contains_soup"`
	CookingMethod          string   `json:"cooking_method,omitempty"`
	GrossReadingGrams      *float64 `json:"gross_reading_grams,omitempty"`
	TareGrams              *float64 `json:"tare_grams,omitempty"`
	TareSource             string   `json:"tare_source,omitempty"`
	ContainerID            string   `json:"container_id,omitempty"`
	ContainerType          string   `json:"container_type,omitempty"`
}

// ResearchWeightPhoto is one stored photo. Role tells evidence photos (scale
// readings) apart from evaluation photos (taken off the scale).
type ResearchWeightPhoto struct {
	Role       string `json:"role"`
	ObjectKey  string `json:"object_key"`
	ItemIndex  *int   `json:"item_index,omitempty"`
	CapturedAt string `json:"captured_at,omitempty"`
	Source     string `json:"source,omitempty"`
}

// ResearchWeightContainerDO is a contributor's saved empty container (a
// takeout box model, a home bowl) weighed once so later samples can reuse its
// weight instead of weighing the empty container again.
type ResearchWeightContainerDO struct {
	ID             string  `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID         string  `gorm:"column:user_id;type:uuid;not null;index:idx_research_weight_containers_user_status,priority:1"`
	Name           string  `gorm:"column:name;type:text;not null"`
	ContainerType  string  `gorm:"column:container_type;type:text;not null;check:research_weight_containers_type_valid,container_type IN ('bowl','plate','tray','box','other')"`
	Grams          float64 `gorm:"column:grams;type:numeric;not null;check:research_weight_containers_grams_positive,grams > 0"`
	PhotoObjectKey string  `gorm:"column:photo_object_key;type:text;not null"`
	// CampaignID marks a container shared with a campus campaign (a canteen
	// tray weighed once by the club); UserID stays the member who saved it.
	CampaignID *string    `gorm:"column:campaign_id;type:uuid;index:idx_research_weight_containers_campaign"`
	Status     string     `gorm:"column:status;type:text;not null;default:'active';index:idx_research_weight_containers_user_status,priority:2;check:research_weight_containers_status_valid,status IN ('active','archived')"`
	CreatedAt  *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt  *time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (ResearchWeightContainerDO) TableName() string { return "research_weight_containers" }

// ResearchWeightPhotoCheckDO is the server's own evidence about one uploaded
// research photo: its content hash (to catch the same picture submitted by
// someone else) and, for scale photos, what the reading models saw. Clients
// never write it, so the automatic review can trust it.
type ResearchWeightPhotoCheckDO struct {
	ObjectKey     string                       `gorm:"column:object_key;type:text;primaryKey"`
	UserID        string                       `gorm:"column:user_id;type:uuid;not null;index:idx_research_weight_photo_checks_user"`
	ContentSHA256 string                       `gorm:"column:content_sha256;type:text;not null;index:idx_research_weight_photo_checks_sha"`
	Readings      []ResearchWeightScaleReading `gorm:"column:readings;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	ReadAt        *time.Time                   `gorm:"column:read_at;type:timestamptz"`
	CreatedAt     *time.Time                   `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt     *time.Time                   `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (ResearchWeightPhotoCheckDO) TableName() string { return "research_weight_photo_checks" }

// ResearchWeightScaleReading is one model's reading of a scale display. Grams
// is converted by the server from RawValue and Unit; ResolutionGrams is the
// smallest step the display can show in that unit.
type ResearchWeightScaleReading struct {
	Model           string   `json:"model,omitempty"`
	IsScaleDisplay  bool     `json:"is_scale_display"`
	Readable        bool     `json:"readable"`
	RawValue        string   `json:"raw_value,omitempty"`
	Unit            string   `json:"unit,omitempty"`
	Grams           *float64 `json:"grams,omitempty"`
	ResolutionGrams float64  `json:"resolution_grams,omitempty"`
	TareIndicator   bool     `json:"tare_indicator,omitempty"`
	Negative        bool     `json:"negative,omitempty"`
	Reason          string   `json:"reason,omitempty"`
	Error           string   `json:"error,omitempty"`
}

// ResearchWeightAutoReview records what the automatic review decided and why.
type ResearchWeightAutoReview struct {
	Version   string                    `json:"version"`
	Decision  string                    `json:"decision"`
	Tier      string                    `json:"tier,omitempty"`
	Credits   int                       `json:"credits"`
	Note      string                    `json:"note,omitempty"`
	Checks    []ResearchWeightAutoCheck `json:"checks"`
	DecidedAt string                    `json:"decided_at"`
}

// ResearchWeightAutoCheck is one check the automatic review ran.
type ResearchWeightAutoCheck struct {
	Name      string `json:"name"`
	Status    string `json:"status"`
	Detail    string `json:"detail,omitempty"`
	PhotoRole string `json:"photo_role,omitempty"`
	ItemIndex *int   `json:"item_index,omitempty"`
}

func ResearchWeightModels() []any {
	return []any{&ResearchWeightSampleDO{}, &ResearchWeightContainerDO{}, &ResearchWeightPhotoCheckDO{}}
}
