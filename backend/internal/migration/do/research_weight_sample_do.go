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
	WeighingMode        string                `gorm:"column:weighing_mode;type:text;not null;check:research_weight_samples_mode_valid,weighing_mode IN ('whole','itemized')"`
	DishName            string                `gorm:"column:dish_name;type:text;not null;default:''"`
	VenueName           string                `gorm:"column:venue_name;type:text;not null;default:''"`
	City                string                `gorm:"column:city;type:text;not null;default:''"`
	ContainerType       string                `gorm:"column:container_type;type:text;not null;check:research_weight_samples_container_valid,container_type IN ('bowl','plate','tray','box','other')"`
	TareMode            string                `gorm:"column:tare_mode;type:text;not null;check:research_weight_samples_tare_mode_valid,tare_mode IN ('measured','zeroed')"`
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
	CreatedAt           *time.Time            `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_research_weight_samples_user_created,priority:2,sort:desc;index:idx_research_weight_samples_status_created,priority:2,sort:desc"`
	UpdatedAt           *time.Time            `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (ResearchWeightSampleDO) TableName() string { return "research_weight_samples" }

// ResearchWeightItem is one component added to the container in itemized
// mode. CumulativeReadingGrams is what the scale showed after adding it;
// Grams is the server-computed increment over the previous reading.
type ResearchWeightItem struct {
	Name                   string  `json:"name"`
	CumulativeReadingGrams float64 `json:"cumulative_reading_grams"`
	Grams                  float64 `json:"grams"`
	ContainsBone           bool    `json:"contains_bone"`
	ContainsSoup           bool    `json:"contains_soup"`
	CookingMethod          string  `json:"cooking_method,omitempty"`
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

func ResearchWeightModels() []any {
	return []any{&ResearchWeightSampleDO{}}
}
