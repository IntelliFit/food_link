package do

import "time"

// CampusOrgDO is a student club (a university fitness association) that runs
// data collection campaigns. Clubs are created by an administrator once.
type CampusOrgDO struct {
	ID                string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	SchoolID          string     `gorm:"column:school_id;type:uuid;not null;uniqueIndex:uk_campus_orgs_school_name,priority:1"`
	CampusID          *string    `gorm:"column:campus_id;type:uuid"`
	Name              string     `gorm:"column:name;type:text;not null;uniqueIndex:uk_campus_orgs_school_name,priority:2"`
	OrgType           string     `gorm:"column:org_type;type:text;not null;default:'fitness_club';check:campus_orgs_type_valid,org_type IN ('fitness_club','other')"`
	Status            string     `gorm:"column:status;type:text;not null;default:'active';check:campus_orgs_status_valid,status IN ('active','paused','ended')"`
	AgreementVersion  string     `gorm:"column:agreement_version;type:text;not null;default:''"`
	AgreementSignedAt *time.Time `gorm:"column:agreement_signed_at;type:timestamptz"`
	Note              string     `gorm:"column:note;type:text;not null;default:''"`
	CreatedByAdminID  string     `gorm:"column:created_by_admin_id;type:text;not null;default:''"`
	CreatedAt         *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt         *time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (CampusOrgDO) TableName() string { return "campus_orgs" }

// CampusCampaignDO is one club's collection campaign with a time window.
// Members join with the join code (carried by the share link or QR code).
type CampusCampaignDO struct {
	ID                 string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	OrgID              string         `gorm:"column:org_id;type:uuid;not null;index:idx_campus_campaigns_org"`
	SchoolID           string         `gorm:"column:school_id;type:uuid;not null;index:idx_campus_campaigns_school"`
	Title              string         `gorm:"column:title;type:text;not null"`
	JoinCode           string         `gorm:"column:join_code;type:text;not null;uniqueIndex:uk_campus_campaigns_join_code"`
	StartsAt           time.Time      `gorm:"column:starts_at;type:timestamptz;not null"`
	EndsAt             time.Time      `gorm:"column:ends_at;type:timestamptz;not null;check:campus_campaigns_window_valid,ends_at > starts_at"`
	Status             string         `gorm:"column:status;type:text;not null;default:'draft';index:idx_campus_campaigns_status_ends,priority:1;check:campus_campaigns_status_valid,status IN ('draft','active','ended')"`
	CoreMemberCap      int            `gorm:"column:core_member_cap;type:integer;not null;default:15;check:campus_campaigns_core_cap_valid,core_member_cap >= 0 AND core_member_cap <= 200"`
	MembershipPlanCode string         `gorm:"column:membership_plan_code;type:text;not null;default:'standard_monthly'"`
	Goals              map[string]any `gorm:"column:goals;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	ClubRewardNote     string         `gorm:"column:club_reward_note;type:text;not null;default:''"`
	CreatedByAdminID   string         `gorm:"column:created_by_admin_id;type:text;not null;default:''"`
	CreatedAt          *time.Time     `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt          *time.Time     `gorm:"column:updated_at;type:timestamptz;not null;default:now();index:idx_campus_campaigns_status_ends,priority:2"`
}

func (CampusCampaignDO) TableName() string { return "campus_campaigns" }

// CampusCampaignMemberDO is a user who joined a campaign. Leaders are set by
// an administrator; leaders mark core members, who get membership for the
// rest of the campaign.
type CampusCampaignMemberDO struct {
	ID                  string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	CampaignID          string     `gorm:"column:campaign_id;type:uuid;not null;uniqueIndex:uk_campus_campaign_members_campaign_user,priority:1"`
	UserID              string     `gorm:"column:user_id;type:uuid;not null;uniqueIndex:uk_campus_campaign_members_campaign_user,priority:2;index:idx_campus_campaign_members_user_status,priority:1"`
	Role                string     `gorm:"column:role;type:text;not null;default:'member';check:campus_campaign_members_role_valid,role IN ('leader','core','member')"`
	HasScale            bool       `gorm:"column:has_scale;type:boolean;not null;default:false"`
	ScalePrecisionGrams *float64   `gorm:"column:scale_precision_grams;type:numeric"`
	JoinSource          string     `gorm:"column:join_source;type:text;not null;default:'code';check:campus_campaign_members_source_valid,join_source IN ('qr','link','code','admin')"`
	Status              string     `gorm:"column:status;type:text;not null;default:'active';index:idx_campus_campaign_members_user_status,priority:2;check:campus_campaign_members_status_valid,status IN ('active','left','removed')"`
	CoreMarkedBy        *string    `gorm:"column:core_marked_by;type:uuid"`
	CoreMarkedAt        *time.Time `gorm:"column:core_marked_at;type:timestamptz"`
	MembershipGrantedAt *time.Time `gorm:"column:membership_granted_at;type:timestamptz"`
	MembershipGrantDays int        `gorm:"column:membership_grant_days;type:integer;not null;default:0"`
	JoinedAt            time.Time  `gorm:"column:joined_at;type:timestamptz;not null;default:now()"`
	CreatedAt           *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt           *time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (CampusCampaignMemberDO) TableName() string { return "campus_campaign_members" }

// CampusCampaignRecordDO links a member's photo-estimated food record to the
// campaign and the canteen dish. These grams are model estimates: they live
// only here and never in research_weight_samples or the benchmark.
type CampusCampaignRecordDO struct {
	ID                  string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	CampaignID          string     `gorm:"column:campaign_id;type:uuid;not null;index:idx_campus_campaign_records_campaign_created,priority:1"`
	UserID              string     `gorm:"column:user_id;type:uuid;not null"`
	FoodRecordID        string     `gorm:"column:food_record_id;type:uuid;not null;uniqueIndex:uk_campus_campaign_records_food_record"`
	AnalysisTaskID      *string    `gorm:"column:analysis_task_id;type:uuid"`
	ExecutionMode       string     `gorm:"column:execution_mode;type:text;not null;default:''"`
	LabelSource         string     `gorm:"column:label_source;type:text;not null;default:'model_estimate';check:campus_campaign_records_label_valid,label_source IN ('model_estimate','user_adjusted')"`
	EstimatedTotalGrams *float64   `gorm:"column:estimated_total_grams;type:numeric"`
	CanteenID           *string    `gorm:"column:canteen_id;type:uuid"`
	WindowID            *string    `gorm:"column:window_id;type:uuid"`
	CatalogItemID       *string    `gorm:"column:catalog_item_id;type:uuid;index:idx_campus_campaign_records_catalog_item"`
	DishName            string     `gorm:"column:dish_name;type:text;not null;default:''"`
	CreatedAt           *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_campus_campaign_records_campaign_created,priority:2,sort:desc"`
}

func (CampusCampaignRecordDO) TableName() string { return "campus_campaign_records" }

// CampusStationSessionDO is a club's weighing day (members bring their own
// meal to the club's scale) or a same-dish session (several portions of one
// dish weighed for its portion distribution).
type CampusStationSessionDO struct {
	ID                  string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	CampaignID          string     `gorm:"column:campaign_id;type:uuid;not null;index:idx_campus_station_sessions_campaign_date,priority:1"`
	CreatedByUserID     string     `gorm:"column:created_by_user_id;type:uuid;not null"`
	CanteenID           *string    `gorm:"column:canteen_id;type:uuid"`
	LocationText        string     `gorm:"column:location_text;type:text;not null;default:''"`
	SessionDate         string     `gorm:"column:session_date;type:date;not null;index:idx_campus_station_sessions_campaign_date,priority:2"`
	MealPeriod          string     `gorm:"column:meal_period;type:text;not null;check:campus_station_sessions_meal_valid,meal_period IN ('breakfast','lunch','dinner','other')"`
	Kind                string     `gorm:"column:kind;type:text;not null;default:'weigh_station';check:campus_station_sessions_kind_valid,kind IN ('weigh_station','same_dish')"`
	CatalogItemID       *string    `gorm:"column:catalog_item_id;type:uuid"`
	ScalePrecisionGrams float64    `gorm:"column:scale_precision_grams;type:numeric;not null;default:1"`
	Notes               string     `gorm:"column:notes;type:text;not null;default:''"`
	Status              string     `gorm:"column:status;type:text;not null;default:'open';check:campus_station_sessions_status_valid,status IN ('open','closed')"`
	CreatedAt           *time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
}

func (CampusStationSessionDO) TableName() string { return "campus_station_sessions" }

func CampusCampaignModels() []any {
	return []any{&CampusOrgDO{}, &CampusCampaignDO{}, &CampusCampaignMemberDO{}, &CampusCampaignRecordDO{}, &CampusStationSessionDO{}}
}
