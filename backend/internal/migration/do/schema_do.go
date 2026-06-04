package do

import "time"

type UserDO struct {
	ID                             string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	OpenID                         string         `gorm:"column:openid;type:text;not null;unique;index:idx_weapp_user_openid"`
	UnionID                        *string        `gorm:"column:unionid;type:text;unique;index:idx_weapp_user_unionid,where:unionid IS NOT NULL"`
	Avatar                         *string        `gorm:"column:avatar;type:text;default:''"`
	Nickname                       *string        `gorm:"column:nickname;type:text;default:''"`
	Telephone                      *string        `gorm:"column:telephone;type:text"`
	CreatedAt                      *time.Time     `gorm:"column:create_time;type:timestamptz;default:now()"`
	UpdatedAt                      *time.Time     `gorm:"column:update_time;type:timestamptz;default:now()"`
	Height                         *float64       `gorm:"column:height;type:numeric"`
	Weight                         *float64       `gorm:"column:weight;type:numeric"`
	Birthday                       *time.Time     `gorm:"column:birthday;type:date"`
	Gender                         *string        `gorm:"column:gender;type:text"`
	ActivityLevel                  *string        `gorm:"column:activity_level;type:text"`
	HealthCondition                map[string]any `gorm:"column:health_condition;type:jsonb;serializer:json;default:'{}'::jsonb"`
	BMR                            *float64       `gorm:"column:bmr;type:numeric"`
	TDEE                           *float64       `gorm:"column:tdee;type:numeric"`
	OnboardingCompleted            *bool          `gorm:"column:onboarding_completed;type:boolean;default:false"`
	DietGoal                       *string        `gorm:"column:diet_goal;type:varchar(50)"`
	Searchable                     *bool          `gorm:"column:searchable;type:boolean;default:true"`
	PublicRecords                  *bool          `gorm:"column:public_records;type:boolean;default:true"`
	LastSeenAnalyzeHistory         *time.Time     `gorm:"column:last_seen_analyze_history_at;type:timestamptz"`
	ExecutionMode                  *string        `gorm:"column:execution_mode;type:text;default:'standard'"`
	ModeSetBy                      *string        `gorm:"column:mode_set_by;type:text;default:'system'"`
	ModeSetAt                      *time.Time     `gorm:"column:mode_set_at;type:timestamptz"`
	ModeReason                     *string        `gorm:"column:mode_reason;type:text"`
	ModeCommitmentDays             *int           `gorm:"column:mode_commitment_days;type:integer;default:14"`
	ModeSwitchCount30d             *int           `gorm:"column:mode_switch_count_30d;type:integer;default:0"`
	PointsBalance                  *float64       `gorm:"column:points_balance;type:numeric;default:100"`
	RegistrationInviteCode         *string        `gorm:"column:registration_invite_code;type:text;index:idx_weapp_user_registration_invite_code"`
	ReferredByUserID               *string        `gorm:"column:referred_by_user_id;type:uuid;index:idx_weapp_user_referred_by_user_id"`
	EarnedCreditsBalance           int            `gorm:"column:earned_credits_balance;type:integer;not null;default:0"`
	HealthDisclaimerAcknowledgedAt *time.Time     `gorm:"column:health_disclaimer_acknowledged_at;type:timestamptz"`
}

func (UserDO) TableName() string { return "weapp_user" }

type UserDailyNutritionTargetDO struct {
	ID            string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID        string     `gorm:"column:user_id;type:uuid;not null;uniqueIndex:idx_user_daily_nutrition_targets_user_date,priority:1;index:idx_user_daily_nutrition_targets_user_id"`
	TargetDate    time.Time  `gorm:"column:target_date;type:date;not null;uniqueIndex:idx_user_daily_nutrition_targets_user_date,priority:2"`
	CalorieTarget float64    `gorm:"column:calorie_target;type:numeric;not null"`
	ProteinTarget float64    `gorm:"column:protein_target;type:numeric;not null"`
	CarbsTarget   float64    `gorm:"column:carbs_target;type:numeric;not null"`
	FatTarget     float64    `gorm:"column:fat_target;type:numeric;not null"`
	Source        string     `gorm:"column:source;type:text;not null;default:'user_manual'"`
	CreatedAt     *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
	UpdatedAt     *time.Time `gorm:"column:updated_at;type:timestamptz;default:now()"`
}

func (UserDailyNutritionTargetDO) TableName() string { return "user_daily_nutrition_targets" }

type UserPetDO struct {
	ID            string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID        string         `gorm:"column:user_id;type:uuid;not null;uniqueIndex:idx_user_pets_user_id"`
	PetSeed       string         `gorm:"column:pet_seed;type:text;not null"`
	Name          string         `gorm:"column:name;type:text;not null"`
	Color         string         `gorm:"column:color;type:text;not null"`
	Shape         string         `gorm:"column:shape;type:text;not null"`
	Pattern       string         `gorm:"column:pattern;type:text;not null"`
	Accessory     string         `gorm:"column:accessory;type:text;not null"`
	Personality   string         `gorm:"column:personality;type:text;not null"`
	Level         int            `gorm:"column:level;type:integer;not null;default:1"`
	Experience    int            `gorm:"column:experience;type:integer;not null;default:0"`
	TodayStatus   string         `gorm:"column:today_status;type:text;not null;default:'calm'"`
	LastSettledOn *time.Time     `gorm:"column:last_settled_on;type:date"`
	TotalEvents   int            `gorm:"column:total_events;type:integer;not null;default:0"`
	LastSummaryAt *time.Time     `gorm:"column:last_summary_at;type:timestamptz"`
	Meta          map[string]any `gorm:"column:meta;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	CreatedAt     time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt     time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (UserPetDO) TableName() string { return "user_pets" }

type UserPetEventDO struct {
	ID           string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID       string         `gorm:"column:user_id;type:uuid;not null;index:idx_user_pet_events_user_date,priority:1;index:idx_user_pet_events_user_claimed,priority:1"`
	PetID        string         `gorm:"column:pet_id;type:uuid;not null;index:idx_user_pet_events_pet_id"`
	EventDate    time.Time      `gorm:"column:event_date;type:date;not null;index:idx_user_pet_events_user_date,priority:2"`
	EventType    string         `gorm:"column:event_type;type:text;not null;index:idx_user_pet_events_user_date,priority:3"`
	Title        string         `gorm:"column:title;type:text;not null"`
	Message      string         `gorm:"column:message;type:text;not null"`
	TaskText     string         `gorm:"column:task_text;type:text;not null"`
	HabitScore   int            `gorm:"column:habit_score;type:integer;not null;default:0"`
	ExpReward    int            `gorm:"column:exp_reward;type:integer;not null;default:0"`
	CreditReward int            `gorm:"column:credit_reward;type:integer;not null;default:0"`
	ScoreDetails map[string]any `gorm:"column:score_details;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	IsRead       bool           `gorm:"column:is_read;type:boolean;not null;default:false"`
	ReadAt       *time.Time     `gorm:"column:read_at;type:timestamptz"`
	IsClaimed    bool           `gorm:"column:is_claimed;type:boolean;not null;default:false;index:idx_user_pet_events_user_claimed,priority:2"`
	ClaimedAt    *time.Time     `gorm:"column:claimed_at;type:timestamptz"`
	CreatedAt    time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_user_pet_events_user_claimed,priority:3,sort:desc"`
	UpdatedAt    time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (UserPetEventDO) TableName() string { return "user_pet_events" }

type UserPetDailyScoreDO struct {
	ID           string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID       string         `gorm:"column:user_id;type:uuid;not null;index:idx_user_pet_daily_scores_user_date,priority:1"`
	ScoreDate    time.Time      `gorm:"column:score_date;type:date;not null;index:idx_user_pet_daily_scores_user_date,priority:2"`
	HabitScore   int            `gorm:"column:habit_score;type:integer;not null;default:0"`
	ExpGained    int            `gorm:"column:exp_gained;type:integer;not null;default:0"`
	ScoreDetails map[string]any `gorm:"column:score_details;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	CreatedAt    time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt    time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (UserPetDailyScoreDO) TableName() string { return "user_pet_daily_scores" }

type UserTrialEntitlementDO struct {
	ID                string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	FirstUserID       *string    `gorm:"column:first_user_id;type:uuid;index:idx_user_trial_entitlements_first_user_id"`
	OpenID            string     `gorm:"column:openid;type:text;not null;uniqueIndex:idx_user_trial_entitlements_openid"`
	UnionID           *string    `gorm:"column:unionid;type:text;uniqueIndex:idx_user_trial_entitlements_unionid,where:unionid IS NOT NULL"`
	FirstRegisteredAt *time.Time `gorm:"column:first_registered_at;type:timestamptz;not null;default:now()"`
	EarlyUserRank     *int       `gorm:"column:early_user_rank;type:integer"`
	TrialDaysTotal    int        `gorm:"column:trial_days_total;type:integer;not null;default:3"`
	TrialPolicy       string     `gorm:"column:trial_policy;type:text;not null;default:'regular_new_user'"`
	CreatedAt         *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
	UpdatedAt         *time.Time `gorm:"column:updated_at;type:timestamptz;default:now()"`
}

func (UserTrialEntitlementDO) TableName() string { return "user_trial_entitlements" }

type AnalysisTaskDO struct {
	ID              string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID          string         `gorm:"column:user_id;type:uuid;not null;index:idx_analysis_tasks_user_id"`
	TaskType        string         `gorm:"column:task_type;type:text;not null;index:idx_analysis_tasks_status_type,priority:2"`
	ImageURL        *string        `gorm:"column:image_url;type:text"`
	ImagePaths      []string       `gorm:"column:image_paths;type:jsonb;serializer:json;default:'[]'::jsonb"`
	TextInput       *string        `gorm:"column:text_input;type:text"`
	Status          string         `gorm:"column:status;type:text;not null;default:'pending';index:idx_analysis_tasks_status_type,priority:1;index:idx_analysis_tasks_status_lease,priority:1"`
	Payload         map[string]any `gorm:"column:payload;type:jsonb;serializer:json;default:'{}'::jsonb"`
	Result          map[string]any `gorm:"column:result;type:jsonb;serializer:json"`
	ErrorMessage    *string        `gorm:"column:error_message;type:text"`
	IsViolated      bool           `gorm:"column:is_violated;type:boolean;not null;default:false"`
	ViolationReason *string        `gorm:"column:violation_reason;type:text"`
	WorkerID        *string        `gorm:"column:worker_id;type:text;index:idx_analysis_tasks_worker_id"`
	AttemptID       *string        `gorm:"column:attempt_id;type:text;index:idx_analysis_tasks_attempt_id"`
	AttemptCount    int            `gorm:"column:attempt_count;type:integer;not null;default:0"`
	ProcessingAt    *time.Time     `gorm:"column:processing_started_at;type:timestamptz"`
	LeaseUntil      *time.Time     `gorm:"column:lease_until;type:timestamptz;index:idx_analysis_tasks_status_lease,priority:2"`
	CreatedAt       *time.Time     `gorm:"column:created_at;type:timestamptz;default:now();index:idx_analysis_tasks_created_at"`
	UpdatedAt       *time.Time     `gorm:"column:updated_at;type:timestamptz;default:now()"`
}

func (AnalysisTaskDO) TableName() string { return "analysis_tasks" }

type AnalysisFeedbackSampleDO struct {
	ID                  string           `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID              string           `gorm:"column:user_id;type:uuid;not null;index:idx_analysis_feedback_samples_user_id"`
	FeedbackType        string           `gorm:"column:feedback_type;type:text;not null;index:idx_analysis_feedback_samples_type"`
	SourceTaskID        *string          `gorm:"column:source_task_id;type:uuid;index:idx_analysis_feedback_samples_source_task_id"`
	CorrectionTaskID    *string          `gorm:"column:correction_task_id;type:uuid;uniqueIndex:idx_analysis_feedback_samples_correction_task_id"`
	RootTaskID          *string          `gorm:"column:root_task_id;type:uuid;index:idx_analysis_feedback_samples_root_task_id"`
	TaskType            string           `gorm:"column:task_type;type:text;not null"`
	ModelName           *string          `gorm:"column:model_name;type:text"`
	AnalysisEngine      *string          `gorm:"column:analysis_engine;type:text"`
	BeforeResult        map[string]any   `gorm:"column:before_result;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	UserCorrectionItems []map[string]any `gorm:"column:user_correction_items;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	AfterResult         map[string]any   `gorm:"column:after_result;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	PayloadSnapshot     map[string]any   `gorm:"column:payload_snapshot;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	ErrorMessage        *string          `gorm:"column:error_message;type:text"`
	CreatedAt           *time.Time       `gorm:"column:created_at;type:timestamptz;default:now();index:idx_analysis_feedback_samples_created_at"`
	UpdatedAt           *time.Time       `gorm:"column:updated_at;type:timestamptz;default:now()"`
}

func (AnalysisFeedbackSampleDO) TableName() string { return "analysis_feedback_samples" }

type PrecisionSessionDO struct {
	ID                  string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID              string         `gorm:"column:user_id;type:uuid;not null;index:idx_precision_sessions_user_created_at,priority:1;index:idx_precision_sessions_user_status,priority:1"`
	SourceType          string         `gorm:"column:source_type;type:text;not null"`
	ExecutionMode       string         `gorm:"column:execution_mode;type:text;not null;default:'experimental'"`
	Status              string         `gorm:"column:status;type:text;not null;default:'collecting';index:idx_precision_sessions_user_status,priority:2"`
	RoundIndex          int            `gorm:"column:round_index;type:integer;not null;default:1"`
	LatestInputs        map[string]any `gorm:"column:latest_inputs;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	PendingRequirements []any          `gorm:"column:pending_requirements;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	ReferenceObjects    []any          `gorm:"column:reference_objects;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	SplitPlan           map[string]any `gorm:"column:split_plan;type:jsonb;serializer:json"`
	LatestPlannerResult map[string]any `gorm:"column:latest_planner_result;type:jsonb;serializer:json"`
	FinalResult         map[string]any `gorm:"column:final_result;type:jsonb;serializer:json"`
	CurrentTaskID       *string        `gorm:"column:current_task_id;type:uuid"`
	LastError           *string        `gorm:"column:last_error;type:text"`
	CreatedAt           time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_precision_sessions_user_created_at,priority:2,sort:desc"`
	UpdatedAt           time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (PrecisionSessionDO) TableName() string { return "precision_sessions" }

type PrecisionSessionRoundDO struct {
	ID            string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	SessionID     string         `gorm:"column:session_id;type:uuid;not null;index:idx_precision_session_rounds_session_round,priority:1"`
	RoundIndex    int            `gorm:"column:round_index;type:integer;not null;index:idx_precision_session_rounds_session_round,priority:2"`
	ActorRole     string         `gorm:"column:actor_role;type:text;not null"`
	InputPayload  map[string]any `gorm:"column:input_payload;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	PlannerResult map[string]any `gorm:"column:planner_result;type:jsonb;serializer:json"`
	CreatedAt     time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_precision_session_rounds_session_round,priority:3"`
}

func (PrecisionSessionRoundDO) TableName() string { return "precision_session_rounds" }

type PrecisionItemEstimateDO struct {
	ID           string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	SessionID    string         `gorm:"column:session_id;type:uuid;not null;index:idx_precision_item_estimates_session_round,priority:1"`
	RoundIndex   int            `gorm:"column:round_index;type:integer;not null;index:idx_precision_item_estimates_session_round,priority:2"`
	ItemIndex    int            `gorm:"column:item_index;type:integer;not null;index:idx_precision_item_estimates_session_round,priority:3"`
	ItemKey      string         `gorm:"column:item_key;type:text;not null"`
	ItemName     string         `gorm:"column:item_name;type:text;not null"`
	Status       string         `gorm:"column:status;type:text;not null;default:'pending'"`
	Payload      map[string]any `gorm:"column:payload;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	Result       map[string]any `gorm:"column:result;type:jsonb;serializer:json"`
	SourceTaskID *string        `gorm:"column:source_task_id;type:uuid;index:idx_precision_item_estimates_source_task_id"`
	ErrorMessage *string        `gorm:"column:error_message;type:text"`
	CreatedAt    time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt    time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (PrecisionItemEstimateDO) TableName() string { return "precision_item_estimates" }

type FoodRecordDO struct {
	ID               string           `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID           string           `gorm:"column:user_id;type:uuid;not null;index:idx_user_food_records_user_id"`
	MealType         string           `gorm:"column:meal_type;type:text;not null;index:idx_user_food_records_meal_type"`
	ImagePath        *string          `gorm:"column:image_path;type:text"`
	ImagePaths       []string         `gorm:"column:image_paths;type:jsonb;serializer:json;default:'[]'::jsonb"`
	Description      *string          `gorm:"column:description;type:text"`
	Insight          *string          `gorm:"column:insight;type:text"`
	Items            []map[string]any `gorm:"column:items;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	TotalCalories    *float64         `gorm:"column:total_calories;type:numeric;default:0"`
	TotalProtein     *float64         `gorm:"column:total_protein;type:numeric;default:0"`
	TotalCarbs       *float64         `gorm:"column:total_carbs;type:numeric;default:0"`
	TotalFat         *float64         `gorm:"column:total_fat;type:numeric;default:0"`
	TotalWeightGrams *int             `gorm:"column:total_weight_grams;type:integer;default:0"`
	RecordTime       *time.Time       `gorm:"column:record_time;type:timestamptz;default:now();index:idx_user_food_records_record_time"`
	CreatedAt        *time.Time       `gorm:"column:created_at;type:timestamptz;default:now();index:idx_user_food_records_created_at"`
	ContextState     *string          `gorm:"column:context_state;type:text"`
	PFCRatioComment  *string          `gorm:"column:pfc_ratio_comment;type:text"`
	AbsorptionNotes  *string          `gorm:"column:absorption_notes;type:text"`
	ContextAdvice    *string          `gorm:"column:context_advice;type:text"`
	DietGoal         *string          `gorm:"column:diet_goal;type:text"`
	ActivityTiming   *string          `gorm:"column:activity_timing;type:text"`
	SourceTaskID     *string          `gorm:"column:source_task_id;type:uuid;index:idx_user_food_records_source_task_id"`
	HiddenFromFeed   bool             `gorm:"column:hidden_from_feed;type:boolean;not null;default:false;index:idx_user_food_records_hidden_from_feed,where:hidden_from_feed = false"`
}

func (FoodRecordDO) TableName() string { return "user_food_records" }

type FoodNutritionDO struct {
	ID                    string    `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	CanonicalName         string    `gorm:"column:canonical_name;type:text;not null;index:idx_food_nutrition_library_canonical_name"`
	NormalizedName        string    `gorm:"column:normalized_name;type:text;not null;unique"`
	ImagePath             *string   `gorm:"column:image_path;type:text"`
	ImagePaths            []string  `gorm:"column:image_paths;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	KcalPer100g           float64   `gorm:"column:kcal_per_100g;type:numeric;not null;default:0"`
	ProteinPer100g        float64   `gorm:"column:protein_per_100g;type:numeric;not null;default:0"`
	CarbsPer100g          float64   `gorm:"column:carbs_per_100g;type:numeric;not null;default:0"`
	FatPer100g            float64   `gorm:"column:fat_per_100g;type:numeric;not null;default:0"`
	FiberPer100g          float64   `gorm:"column:fiber_per_100g;type:numeric;not null;default:0"`
	SugarPer100g          float64   `gorm:"column:sugar_per_100g;type:numeric;not null;default:0"`
	SaturatedFatPer100g   float64   `gorm:"column:saturated_fat_per_100g;type:numeric;not null;default:0"`
	CholesterolMgPer100g  float64   `gorm:"column:cholesterol_mg_per_100g;type:numeric;not null;default:0"`
	SodiumMgPer100g       float64   `gorm:"column:sodium_mg_per_100g;type:numeric;not null;default:0"`
	PotassiumMgPer100g    float64   `gorm:"column:potassium_mg_per_100g;type:numeric;not null;default:0"`
	CalciumMgPer100g      float64   `gorm:"column:calcium_mg_per_100g;type:numeric;not null;default:0"`
	IronMgPer100g         float64   `gorm:"column:iron_mg_per_100g;type:numeric;not null;default:0"`
	MagnesiumMgPer100g    float64   `gorm:"column:magnesium_mg_per_100g;type:numeric;not null;default:0"`
	ZincMgPer100g         float64   `gorm:"column:zinc_mg_per_100g;type:numeric;not null;default:0"`
	VitaminARaeMcgPer100g float64   `gorm:"column:vitamin_a_rae_mcg_per_100g;type:numeric;not null;default:0"`
	VitaminCMgPer100g     float64   `gorm:"column:vitamin_c_mg_per_100g;type:numeric;not null;default:0"`
	VitaminDMcgPer100g    float64   `gorm:"column:vitamin_d_mcg_per_100g;type:numeric;not null;default:0"`
	VitaminEMgPer100g     float64   `gorm:"column:vitamin_e_mg_per_100g;type:numeric;not null;default:0"`
	VitaminKMcgPer100g    float64   `gorm:"column:vitamin_k_mcg_per_100g;type:numeric;not null;default:0"`
	ThiaminMgPer100g      float64   `gorm:"column:thiamin_mg_per_100g;type:numeric;not null;default:0"`
	RiboflavinMgPer100g   float64   `gorm:"column:riboflavin_mg_per_100g;type:numeric;not null;default:0"`
	NiacinMgPer100g       float64   `gorm:"column:niacin_mg_per_100g;type:numeric;not null;default:0"`
	VitaminB6MgPer100g    float64   `gorm:"column:vitamin_b6_mg_per_100g;type:numeric;not null;default:0"`
	FolateMcgPer100g      float64   `gorm:"column:folate_mcg_per_100g;type:numeric;not null;default:0"`
	VitaminB12McgPer100g  float64   `gorm:"column:vitamin_b12_mcg_per_100g;type:numeric;not null;default:0"`
	IsActive              bool      `gorm:"column:is_active;type:boolean;not null;default:true;index:idx_food_nutrition_library_is_active"`
	Source                *string   `gorm:"column:source;type:text"`
	CreatedAt             time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt             time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (FoodNutritionDO) TableName() string { return "food_nutrition_library" }

type PackagedFoodDO struct {
	ID                    string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	Brand                 string         `gorm:"column:brand;type:text;not null;default:'';index:idx_packaged_food_library_brand"`
	ProductName           string         `gorm:"column:product_name;type:text;not null;index:idx_packaged_food_library_product_name"`
	NormalizedName        string         `gorm:"column:normalized_name;type:text;not null"`
	ProductKey            string         `gorm:"column:product_key;type:text;not null;default:''"`
	DisplayName           string         `gorm:"column:display_name;type:text;not null;default:'';index:idx_packaged_food_library_display_name"`
	SearchText            string         `gorm:"column:search_text;type:text;not null;default:''"`
	ProductFamilyKey      string         `gorm:"column:product_family_key;type:text;not null;default:'';index:idx_packaged_food_library_family_key"`
	SpecText              *string        `gorm:"column:spec_text;type:text"`
	Barcode               *string        `gorm:"column:barcode;type:text;index:idx_packaged_food_library_barcode"`
	FlavorText            *string        `gorm:"column:flavor_text;type:text"`
	PackageCategory       *string        `gorm:"column:package_category;type:text"`
	IngredientsText       *string        `gorm:"column:ingredients_text;type:text"`
	SourceImageURLs       []string       `gorm:"column:source_image_urls;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	OCRRawText            *string        `gorm:"column:ocr_raw_text;type:text"`
	NutritionBasisUnit    *string        `gorm:"column:nutrition_basis_unit;type:text"`
	EnergyUnitRaw         *string        `gorm:"column:energy_unit_raw;type:text"`
	RawLabelPayload       map[string]any `gorm:"column:raw_label_payload;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	ConversionStatus      *string        `gorm:"column:conversion_status;type:text"`
	ExtractConfidence     float64        `gorm:"column:extract_confidence;type:numeric;not null;default:0"`
	FieldConfidence       map[string]any `gorm:"column:field_confidence;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	IngestMethod          *string        `gorm:"column:ingest_method;type:text"`
	NetContentValue       float64        `gorm:"column:net_content_value;type:numeric;not null;default:0"`
	NetContentUnit        *string        `gorm:"column:net_content_unit;type:text"`
	UnitCount             float64        `gorm:"column:unit_count;type:numeric;not null;default:0"`
	UnitContentValue      float64        `gorm:"column:unit_content_value;type:numeric;not null;default:0"`
	UnitContentUnit       *string        `gorm:"column:unit_content_unit;type:text"`
	ReviewStatus          string         `gorm:"column:review_status;type:text;not null;default:'active';index:idx_packaged_food_library_review_status"`
	NetWeightG            float64        `gorm:"column:net_weight_g;type:numeric;not null;default:0"`
	ServingWeightG        float64        `gorm:"column:serving_weight_g;type:numeric;not null;default:0"`
	KcalPer100g           float64        `gorm:"column:kcal_per_100g;type:numeric;not null;default:0"`
	ProteinPer100g        float64        `gorm:"column:protein_per_100g;type:numeric;not null;default:0"`
	CarbsPer100g          float64        `gorm:"column:carbs_per_100g;type:numeric;not null;default:0"`
	FatPer100g            float64        `gorm:"column:fat_per_100g;type:numeric;not null;default:0"`
	FiberPer100g          float64        `gorm:"column:fiber_per_100g;type:numeric;not null;default:0"`
	SugarPer100g          float64        `gorm:"column:sugar_per_100g;type:numeric;not null;default:0"`
	SaturatedFatPer100g   float64        `gorm:"column:saturated_fat_per_100g;type:numeric;not null;default:0"`
	CholesterolMgPer100g  float64        `gorm:"column:cholesterol_mg_per_100g;type:numeric;not null;default:0"`
	SodiumMgPer100g       float64        `gorm:"column:sodium_mg_per_100g;type:numeric;not null;default:0"`
	PotassiumMgPer100g    float64        `gorm:"column:potassium_mg_per_100g;type:numeric;not null;default:0"`
	CalciumMgPer100g      float64        `gorm:"column:calcium_mg_per_100g;type:numeric;not null;default:0"`
	IronMgPer100g         float64        `gorm:"column:iron_mg_per_100g;type:numeric;not null;default:0"`
	MagnesiumMgPer100g    float64        `gorm:"column:magnesium_mg_per_100g;type:numeric;not null;default:0"`
	ZincMgPer100g         float64        `gorm:"column:zinc_mg_per_100g;type:numeric;not null;default:0"`
	VitaminARaeMcgPer100g float64        `gorm:"column:vitamin_a_rae_mcg_per_100g;type:numeric;not null;default:0"`
	VitaminCMgPer100g     float64        `gorm:"column:vitamin_c_mg_per_100g;type:numeric;not null;default:0"`
	VitaminDMcgPer100g    float64        `gorm:"column:vitamin_d_mcg_per_100g;type:numeric;not null;default:0"`
	VitaminEMgPer100g     float64        `gorm:"column:vitamin_e_mg_per_100g;type:numeric;not null;default:0"`
	VitaminKMcgPer100g    float64        `gorm:"column:vitamin_k_mcg_per_100g;type:numeric;not null;default:0"`
	ThiaminMgPer100g      float64        `gorm:"column:thiamin_mg_per_100g;type:numeric;not null;default:0"`
	RiboflavinMgPer100g   float64        `gorm:"column:riboflavin_mg_per_100g;type:numeric;not null;default:0"`
	NiacinMgPer100g       float64        `gorm:"column:niacin_mg_per_100g;type:numeric;not null;default:0"`
	VitaminB6MgPer100g    float64        `gorm:"column:vitamin_b6_mg_per_100g;type:numeric;not null;default:0"`
	FolateMcgPer100g      float64        `gorm:"column:folate_mcg_per_100g;type:numeric;not null;default:0"`
	VitaminB12McgPer100g  float64        `gorm:"column:vitamin_b12_mcg_per_100g;type:numeric;not null;default:0"`
	SourceURL             *string        `gorm:"column:source_url;type:text"`
	Source                *string        `gorm:"column:source;type:text"`
	IsActive              bool           `gorm:"column:is_active;type:boolean;not null;default:true;index:idx_packaged_food_library_is_active"`
	CreatedAt             time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt             time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (PackagedFoodDO) TableName() string { return "packaged_food_library" }

type PackagedFoodAliasDO struct {
	ID              string    `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	FoodID          string    `gorm:"column:food_id;type:uuid;not null;index:idx_packaged_food_aliases_food_id"`
	AliasName       string    `gorm:"column:alias_name;type:text;not null"`
	NormalizedAlias string    `gorm:"column:normalized_alias;type:text;not null;index:idx_packaged_food_aliases_normalized_alias"`
	CreatedAt       time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt       time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (PackagedFoodAliasDO) TableName() string { return "packaged_food_aliases" }

type FoodNutritionAliasDO struct {
	ID              string    `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	FoodID          string    `gorm:"column:food_id;type:uuid;not null;index:idx_food_nutrition_aliases_food_id"`
	AliasName       string    `gorm:"column:alias_name;type:text;not null"`
	NormalizedAlias string    `gorm:"column:normalized_alias;type:text;not null;unique"`
	CreatedAt       time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt       time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (FoodNutritionAliasDO) TableName() string { return "food_nutrition_aliases" }

type FoodUnresolvedLogDO struct {
	ID             string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	TaskID         *string        `gorm:"column:task_id;type:uuid"`
	RawName        string         `gorm:"column:raw_name;type:text;not null"`
	NormalizedName string         `gorm:"column:normalized_name;type:text;not null;unique"`
	HitCount       int            `gorm:"column:hit_count;type:integer;not null;default:1;index:idx_food_unresolved_logs_hit_count,sort:desc"`
	FirstSeenAt    time.Time      `gorm:"column:first_seen_at;type:timestamptz;not null;default:now()"`
	LastSeenAt     time.Time      `gorm:"column:last_seen_at;type:timestamptz;not null;default:now();index:idx_food_unresolved_logs_last_seen_at,sort:desc"`
	SamplePayload  map[string]any `gorm:"column:sample_payload;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	CreatedAt      time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt      time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (FoodUnresolvedLogDO) TableName() string { return "food_unresolved_logs" }

type CriticalSampleDO struct {
	ID               string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID           string     `gorm:"column:user_id;type:uuid;not null;index:idx_critical_samples_weapp_user_id"`
	ImagePath        *string    `gorm:"column:image_path;type:text"`
	FoodName         string     `gorm:"column:food_name;type:text;not null"`
	AIWeight         float64    `gorm:"column:ai_weight;type:numeric;not null"`
	UserWeight       float64    `gorm:"column:user_weight;type:numeric;not null"`
	DeviationPercent float64    `gorm:"column:deviation_percent;type:numeric;not null"`
	CreatedAt        *time.Time `gorm:"column:created_at;type:timestamptz;default:now();index:idx_critical_samples_weapp_created_at"`
}

func (CriticalSampleDO) TableName() string { return "critical_samples_weapp" }

type PublicFoodItemDO struct {
	ID                 string           `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID             string           `gorm:"column:user_id;type:uuid;not null;index:idx_public_food_library_user_id"`
	SourceRecordID     *string          `gorm:"column:source_record_id;type:uuid"`
	ImagePath          *string          `gorm:"column:image_path;type:text"`
	ImagePaths         []string         `gorm:"column:image_paths;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	TotalCalories      *float64         `gorm:"column:total_calories;type:numeric;default:0"`
	TotalProtein       *float64         `gorm:"column:total_protein;type:numeric;default:0"`
	TotalCarbs         *float64         `gorm:"column:total_carbs;type:numeric;default:0"`
	TotalFat           *float64         `gorm:"column:total_fat;type:numeric;default:0"`
	Items              []map[string]any `gorm:"column:items;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	Description        *string          `gorm:"column:description;type:text"`
	Insight            *string          `gorm:"column:insight;type:text"`
	FoodName           *string          `gorm:"column:food_name;type:text;index:idx_public_food_library_food_name"`
	MerchantName       *string          `gorm:"column:merchant_name;type:text;index:idx_public_food_library_merchant"`
	MerchantAddress    *string          `gorm:"column:merchant_address;type:text"`
	DetailAddress      *string          `gorm:"column:detail_address;type:text"`
	TasteRating        *int16           `gorm:"column:taste_rating;type:smallint"`
	SuitableForFatLoss *bool            `gorm:"column:suitable_for_fat_loss;type:boolean;default:false;index:idx_public_food_library_suitable"`
	UserTags           []string         `gorm:"column:user_tags;type:jsonb;serializer:json;default:'[]'::jsonb"`
	UserNotes          *string          `gorm:"column:user_notes;type:text"`
	Latitude           *float64         `gorm:"column:latitude;type:numeric"`
	Longitude          *float64         `gorm:"column:longitude;type:numeric"`
	Province           *string          `gorm:"column:province;type:text;index:idx_public_food_library_province"`
	City               *string          `gorm:"column:city;type:text;index:idx_public_food_library_city"`
	District           *string          `gorm:"column:district;type:text"`
	Status             string           `gorm:"column:status;type:text;not null;default:'published';index:idx_public_food_library_status"`
	AuditRejectReason  *string          `gorm:"column:audit_reject_reason;type:text"`
	PublishedAt        *time.Time       `gorm:"column:published_at;type:timestamptz;index:idx_public_food_library_published_at,sort:desc"`
	LikeCount          *int             `gorm:"column:like_count;type:integer;default:0;index:idx_public_food_library_like_count,sort:desc"`
	CommentCount       *int             `gorm:"column:comment_count;type:integer;default:0"`
	CollectionCount    *int             `gorm:"column:collection_count;type:integer;default:0;index:idx_public_food_library_collection_count,sort:desc"`
	AvgRating          *float64         `gorm:"column:avg_rating;type:numeric;default:0"`
	CreatedAt          *time.Time       `gorm:"column:created_at;type:timestamptz;default:now()"`
	UpdatedAt          *time.Time       `gorm:"column:updated_at;type:timestamptz;default:now()"`
}

func (PublicFoodItemDO) TableName() string { return "public_food_library" }

type PublicFoodLikeDO struct {
	ID            string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID        string     `gorm:"column:user_id;type:uuid;not null;index:idx_public_food_library_likes_user"`
	LibraryItemID string     `gorm:"column:library_item_id;type:uuid;not null;index:idx_public_food_library_likes_item"`
	CreatedAt     *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (PublicFoodLikeDO) TableName() string { return "public_food_library_likes" }

type PublicFoodCollectionDO struct {
	ID            string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID        string     `gorm:"column:user_id;type:uuid;not null;index:idx_public_food_library_collections_user"`
	LibraryItemID string     `gorm:"column:library_item_id;type:uuid;not null;index:idx_public_food_library_collections_item"`
	CreatedAt     *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (PublicFoodCollectionDO) TableName() string { return "public_food_library_collections" }

type PublicFoodCommentDO struct {
	ID            string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID        string     `gorm:"column:user_id;type:uuid;not null;index:idx_public_food_library_comments_user_id"`
	LibraryItemID string     `gorm:"column:library_item_id;type:uuid;not null;index:idx_public_food_library_comments_library_item_id"`
	Content       string     `gorm:"column:content;type:text;not null"`
	Rating        *int16     `gorm:"column:rating;type:smallint"`
	CreatedAt     *time.Time `gorm:"column:created_at;type:timestamptz;default:now();index:idx_public_food_library_comments_created_at,sort:desc"`
}

func (PublicFoodCommentDO) TableName() string { return "public_food_library_comments" }

type PublicFoodFeedbackDO struct {
	ID            string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID        string     `gorm:"column:user_id;type:uuid;not null;index:idx_public_food_library_feedback_user_id"`
	LibraryItemID *string    `gorm:"column:library_item_id;type:uuid;index:idx_public_food_library_feedback_library_item_id"`
	Content       string     `gorm:"column:content;type:text;not null"`
	CreatedAt     *time.Time `gorm:"column:created_at;type:timestamptz;default:now();index:idx_public_food_library_feedback_created_at,sort:desc"`
}

func (PublicFoodFeedbackDO) TableName() string { return "public_food_library_feedback" }

type RewardTaskUploadDO struct {
	ID               string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID           string         `gorm:"column:user_id;type:uuid;not null;index:idx_reward_task_uploads_user_date,priority:1"`
	TaskType         string         `gorm:"column:task_type;type:text;not null;index:idx_reward_task_uploads_task_type"`
	BonusDate        string         `gorm:"column:bonus_date;type:text;not null;index:idx_reward_task_uploads_user_date,priority:2"`
	Status           string         `gorm:"column:status;type:text;not null;default:'pending';index:idx_reward_task_uploads_status"`
	RewardCredits    int            `gorm:"column:reward_credits;type:integer;not null;default:0"`
	SourceTaskID     *string        `gorm:"column:source_task_id;type:uuid;index:idx_reward_task_uploads_source_task_id"`
	PackagedFoodID   *string        `gorm:"column:packaged_food_id;type:uuid;index:idx_reward_task_uploads_packaged_food_id"`
	PublicFoodItemID *string        `gorm:"column:public_food_item_id;type:uuid;index:idx_reward_task_uploads_public_food_item_id"`
	SourceKey        *string        `gorm:"column:source_key;type:text"`
	FailureReason    *string        `gorm:"column:failure_reason;type:text"`
	Meta             map[string]any `gorm:"column:meta;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	CreatedAt        *time.Time     `gorm:"column:created_at;type:timestamptz;default:now()"`
	UpdatedAt        *time.Time     `gorm:"column:updated_at;type:timestamptz;default:now()"`
}

func (RewardTaskUploadDO) TableName() string { return "reward_task_uploads" }

type FeedLikeDO struct {
	ID         string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID     string     `gorm:"column:user_id;type:uuid;not null;index:idx_feed_likes_user_id"`
	RecordID   *string    `gorm:"column:record_id;type:uuid;index:idx_feed_likes_record_id"`
	TargetType string     `gorm:"column:target_type;type:text;not null;default:'food_record';index:idx_feed_likes_target,priority:1"`
	TargetID   *string    `gorm:"column:target_id;type:uuid;index:idx_feed_likes_target,priority:2"`
	CreatedAt  *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (FeedLikeDO) TableName() string { return "feed_likes" }

type FeedCommentDO struct {
	ID              string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID          string     `gorm:"column:user_id;type:uuid;not null;index:idx_feed_comments_user_id"`
	RecordID        *string    `gorm:"column:record_id;type:uuid;index:idx_feed_comments_record_id"`
	TargetType      string     `gorm:"column:target_type;type:text;not null;default:'food_record';index:idx_feed_comments_target,priority:1"`
	TargetID        *string    `gorm:"column:target_id;type:uuid;index:idx_feed_comments_target,priority:2"`
	ParentCommentID *string    `gorm:"column:parent_comment_id;type:uuid;index:idx_feed_comments_parent_comment_id"`
	ReplyToUserID   *string    `gorm:"column:reply_to_user_id;type:uuid;index:idx_feed_comments_reply_to_user_id"`
	Content         string     `gorm:"column:content;type:text;not null"`
	CreatedAt       *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (FeedCommentDO) TableName() string { return "feed_comments" }

type FeedInteractionNotificationDO struct {
	ID               string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	RecipientUserID  string     `gorm:"column:recipient_user_id;type:uuid;not null;index:idx_feed_interaction_notifications_recipient,priority:1"`
	ActorUserID      *string    `gorm:"column:actor_user_id;type:uuid"`
	RecordID         *string    `gorm:"column:record_id;type:uuid;index:idx_feed_interaction_notifications_record_id"`
	TargetType       string     `gorm:"column:target_type;type:text;not null;default:'food_record';index:idx_feed_interaction_notifications_target,priority:1"`
	TargetID         *string    `gorm:"column:target_id;type:uuid;index:idx_feed_interaction_notifications_target,priority:2"`
	CommentID        *string    `gorm:"column:comment_id;type:uuid"`
	ParentCommentID  *string    `gorm:"column:parent_comment_id;type:uuid"`
	NotificationType string     `gorm:"column:notification_type;type:text;not null"`
	ContentPreview   *string    `gorm:"column:content_preview;type:text"`
	IsRead           bool       `gorm:"column:is_read;type:boolean;not null;default:false;index:idx_feed_interaction_notifications_recipient,priority:2"`
	CreatedAt        *time.Time `gorm:"column:created_at;type:timestamptz;default:now();index:idx_feed_interaction_notifications_recipient,priority:3,sort:desc"`
	ReadAt           *time.Time `gorm:"column:read_at;type:timestamptz"`
}

func (FeedInteractionNotificationDO) TableName() string { return "feed_interaction_notifications" }

type CommentTaskDO struct {
	ID              string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID          string         `gorm:"column:user_id;type:uuid;not null;index:idx_comment_tasks_user_id"`
	CommentType     string         `gorm:"column:comment_type;type:text;not null;index:idx_comment_tasks_status_type,priority:2"`
	TargetID        string         `gorm:"column:target_id;type:uuid;not null"`
	Content         string         `gorm:"column:content;type:text;not null"`
	Rating          *int           `gorm:"column:rating;type:integer"`
	Status          string         `gorm:"column:status;type:text;not null;default:'pending';index:idx_comment_tasks_status_type,priority:1"`
	Result          map[string]any `gorm:"column:result;type:jsonb;serializer:json"`
	ErrorMessage    *string        `gorm:"column:error_message;type:text"`
	IsViolated      bool           `gorm:"column:is_violated;type:boolean;not null;default:false"`
	ViolationReason *string        `gorm:"column:violation_reason;type:text"`
	Extra           map[string]any `gorm:"column:extra;type:jsonb;serializer:json"`
	CreatedAt       *time.Time     `gorm:"column:created_at;type:timestamptz;default:now();index:idx_comment_tasks_created_at"`
	UpdatedAt       *time.Time     `gorm:"column:updated_at;type:timestamptz;default:now()"`
}

func (CommentTaskDO) TableName() string { return "comment_tasks" }

type ExpiryItemDO struct {
	ID           string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID       string     `gorm:"column:user_id;type:uuid;not null;index:idx_food_expiry_items_user_id;index:idx_food_expiry_items_user_status,priority:1;index:idx_food_expiry_items_user_expire_date,priority:1"`
	FoodName     string     `gorm:"column:food_name;type:text;not null"`
	Category     *string    `gorm:"column:category;type:text"`
	StorageType  string     `gorm:"column:storage_type;type:text;not null;default:'refrigerated'"`
	QuantityNote *string    `gorm:"column:quantity_note;type:text"`
	ExpireDate   time.Time  `gorm:"column:expire_date;type:date;not null;index:idx_food_expiry_items_user_expire_date,priority:2"`
	OpenedDate   *time.Time `gorm:"column:opened_date;type:date"`
	Note         *string    `gorm:"column:note;type:text"`
	SourceType   string     `gorm:"column:source_type;type:text;not null;default:'manual'"`
	Status       string     `gorm:"column:status;type:text;not null;default:'active';index:idx_food_expiry_items_user_status,priority:2"`
	CreatedAt    time.Time  `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt    time.Time  `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (ExpiryItemDO) TableName() string { return "food_expiry_items" }

type ExpiryNotificationJobDO struct {
	ID              string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID          string         `gorm:"column:user_id;type:uuid;not null;index:idx_food_expiry_notification_jobs_user_id"`
	ExpiryItemID    string         `gorm:"column:expiry_item_id;type:uuid;not null;index:idx_food_expiry_notification_jobs_expiry_item_id"`
	TemplateID      string         `gorm:"column:template_id;type:text;not null"`
	OpenID          string         `gorm:"column:openid;type:text;not null"`
	Status          string         `gorm:"column:status;type:text;not null;default:'pending';index:idx_food_expiry_notification_jobs_status_schedule,priority:1"`
	ScheduledAt     time.Time      `gorm:"column:scheduled_at;type:timestamptz;not null;index:idx_food_expiry_notification_jobs_status_schedule,priority:2"`
	SentAt          *time.Time     `gorm:"column:sent_at;type:timestamptz"`
	LastError       *string        `gorm:"column:last_error;type:text"`
	RetryCount      int            `gorm:"column:retry_count;type:integer;not null;default:0"`
	MaxRetryCount   int            `gorm:"column:max_retry_count;type:integer;not null;default:3"`
	PayloadSnapshot map[string]any `gorm:"column:payload_snapshot;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	CreatedAt       time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt       time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (ExpiryNotificationJobDO) TableName() string { return "food_expiry_notification_jobs" }

type FriendRequestDO struct {
	ID         string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	FromUserID string     `gorm:"column:from_user_id;type:uuid;not null;index:idx_friend_requests_from_user"`
	ToUserID   string     `gorm:"column:to_user_id;type:uuid;not null;index:idx_friend_requests_to_user"`
	Status     string     `gorm:"column:status;type:text;not null;default:'pending'"`
	CreatedAt  *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
	UpdatedAt  *time.Time `gorm:"column:updated_at;type:timestamptz;default:now()"`
}

func (FriendRequestDO) TableName() string { return "friend_requests" }

type UserFriendDO struct {
	ID        string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID    string     `gorm:"column:user_id;type:uuid;not null;index:idx_user_friends_user_id"`
	FriendID  string     `gorm:"column:friend_id;type:uuid;not null;index:idx_user_friends_friend_id"`
	CreatedAt *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (UserFriendDO) TableName() string { return "user_friends" }

type BodyWeightRecordDO struct {
	ID             string    `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID         string    `gorm:"column:user_id;type:uuid;not null;index:idx_user_weight_records_user_date,priority:1;index:idx_user_weight_records_user_created_at,priority:1;index:idx_user_weight_records_user_client_record_id,priority:1,where:client_record_id IS NOT NULL"`
	RecordedOn     time.Time `gorm:"column:recorded_on;type:date;not null;index:idx_user_weight_records_user_date,priority:2"`
	ClientRecordID *string   `gorm:"column:client_record_id;type:text;index:idx_user_weight_records_user_client_record_id,priority:2,where:client_record_id IS NOT NULL"`
	WeightKg       float64   `gorm:"column:weight_kg;type:numeric(6,2);not null"`
	SourceType     string    `gorm:"column:source_type;type:text;not null;default:'manual'"`
	Note           *string   `gorm:"column:note;type:text"`
	CreatedAt      time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_user_weight_records_user_created_at,priority:2,sort:desc"`
	UpdatedAt      time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (BodyWeightRecordDO) TableName() string { return "user_weight_records" }

type BodyWaterLogDO struct {
	ID         string    `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID     string    `gorm:"column:user_id;type:uuid;not null;index:idx_user_water_logs_user_date,priority:1;index:idx_user_water_logs_user_recorded_at,priority:1"`
	RecordedOn time.Time `gorm:"column:recorded_on;type:date;not null;index:idx_user_water_logs_user_date,priority:2"`
	AmountMl   int       `gorm:"column:amount_ml;type:integer;not null"`
	SourceType string    `gorm:"column:source_type;type:text;not null;default:'manual'"`
	CreatedAt  time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	RecordedAt time.Time `gorm:"column:recorded_at;type:timestamptz;not null;default:now();index:idx_user_water_logs_user_recorded_at,priority:2,sort:desc"`
}

func (BodyWaterLogDO) TableName() string { return "user_water_logs" }

type BodyMetricSettingsDO struct {
	UserID      string    `gorm:"column:user_id;type:uuid;primaryKey"`
	WaterGoalMl int       `gorm:"column:water_goal_ml;type:integer;not null;default:2000"`
	CreatedAt   time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt   time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (BodyMetricSettingsDO) TableName() string { return "user_body_metric_settings" }

type ExerciseLogDO struct {
	ID             string    `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID         string    `gorm:"column:user_id;type:uuid;not null;index:idx_user_exercise_logs_user_date,priority:1;index:idx_user_exercise_logs_user_recorded_at,priority:1"`
	ExerciseDesc   string    `gorm:"column:exercise_desc;type:text;not null"`
	ExerciseType   *string   `gorm:"column:exercise_type;type:text"`
	ImageURL       *string   `gorm:"column:image_url;type:text"`
	CaloriesBurned int       `gorm:"column:calories_burned;type:integer;not null"`
	DurationMin    *int      `gorm:"column:duration_min;type:integer"`
	RecordedOn     time.Time `gorm:"column:recorded_on;type:date;not null;index:idx_user_exercise_logs_user_date,priority:2"`
	RecordedAt     time.Time `gorm:"column:recorded_at;type:timestamptz;not null;default:now();index:idx_user_exercise_logs_user_recorded_at,priority:2,sort:desc"`
	AIReasoning    *string   `gorm:"column:ai_reasoning;type:text"`
	HiddenFromFeed bool      `gorm:"column:hidden_from_feed;type:boolean;not null;default:false;index:idx_user_exercise_logs_hidden_from_feed"`
	CreatedAt      time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
}

func (ExerciseLogDO) TableName() string { return "user_exercise_logs" }

type StatsInsightDO struct {
	ID              string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID          string     `gorm:"column:user_id;type:uuid;not null;index:idx_ai_stats_insights_user_range_date,priority:1"`
	RangeType       string     `gorm:"column:range_type;type:text;not null;index:idx_ai_stats_insights_user_range_date,priority:2"`
	GeneratedDate   time.Time  `gorm:"column:generated_date;type:date;not null;index:idx_ai_stats_insights_user_range_date,priority:3"`
	DataFingerprint string     `gorm:"column:data_fingerprint;type:text;not null;default:''"`
	InsightText     string     `gorm:"column:insight_text;type:text;not null;default:''"`
	CreatedAt       *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (StatsInsightDO) TableName() string { return "ai_stats_insights" }

type CustomFocusCardDO struct {
	ID              string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID          string     `gorm:"column:user_id;type:uuid;not null;index:idx_ai_custom_focus_cards_user_range_focus,priority:1"`
	FocusID         string     `gorm:"column:focus_id;type:text;not null;index:idx_ai_custom_focus_cards_user_range_focus,priority:3"`
	RangeType       string     `gorm:"column:range_type;type:text;not null;index:idx_ai_custom_focus_cards_user_range_focus,priority:2"`
	GeneratedDate   time.Time  `gorm:"column:generated_date;type:date;not null"`
	DataFingerprint string     `gorm:"column:data_fingerprint;type:text;not null;default:''"`
	FocusLabel      string     `gorm:"column:focus_label;type:text;not null;default:''"`
	Score           int        `gorm:"column:score;type:integer;not null;default:0"`
	Brief           string     `gorm:"column:brief;type:text;not null;default:''"`
	Summary         string     `gorm:"column:summary;type:text;not null;default:''"`
	Basis           string     `gorm:"column:basis;type:text;not null;default:''"`
	Action          string     `gorm:"column:action;type:text;not null;default:''"`
	CreatedAt       *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (CustomFocusCardDO) TableName() string { return "ai_custom_focus_cards" }

type MembershipPlanDO struct {
	Code           string    `gorm:"column:code;type:varchar(50);primaryKey"`
	Name           string    `gorm:"column:name;type:varchar(100);not null"`
	Amount         float64   `gorm:"column:amount;type:numeric;not null"`
	DurationMonths int       `gorm:"column:duration_months;type:integer;not null;default:1"`
	IsActive       bool      `gorm:"column:is_active;type:boolean;not null;default:true"`
	Description    *string   `gorm:"column:description;type:text"`
	Tier           *string   `gorm:"column:tier;type:text;index:idx_membership_plan_config_tier_period,priority:1"`
	Period         *string   `gorm:"column:period;type:text;index:idx_membership_plan_config_tier_period,priority:2"`
	DailyCredits   int       `gorm:"column:daily_credits;type:integer;not null;default:0"`
	OriginalAmount *float64  `gorm:"column:original_amount;type:numeric"`
	SortOrder      int       `gorm:"column:sort_order;type:integer;not null;default:0"`
	CreatedAt      time.Time `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt      time.Time `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (MembershipPlanDO) TableName() string { return "membership_plan_config" }

type UserMembershipDO struct {
	ID                 string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID             string     `gorm:"column:user_id;type:uuid;not null;unique"`
	CurrentPlanCode    *string    `gorm:"column:current_plan_code;type:varchar(50)"`
	Status             string     `gorm:"column:status;type:varchar(20);not null;default:'inactive'"`
	FirstActivatedAt   *time.Time `gorm:"column:first_activated_at;type:timestamptz"`
	CurrentPeriodStart *time.Time `gorm:"column:current_period_start;type:timestamptz"`
	ExpiresAt          *time.Time `gorm:"column:expires_at;type:timestamptz"`
	LastPaidAt         *time.Time `gorm:"column:last_paid_at;type:timestamptz"`
	AutoRenew          bool       `gorm:"column:auto_renew;type:boolean;not null;default:false"`
	DailyCredits       int        `gorm:"column:daily_credits;type:integer;not null;default:0"`
	CreatedAt          time.Time  `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt          time.Time  `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (UserMembershipDO) TableName() string { return "user_pro_memberships" }

type MembershipPaymentDO struct {
	ID              string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID          string         `gorm:"column:user_id;type:uuid;not null"`
	PlanCode        string         `gorm:"column:plan_code;type:varchar(50);not null"`
	OrderNo         string         `gorm:"column:order_no;type:varchar(100);not null;unique"`
	Amount          float64        `gorm:"column:amount;type:numeric;not null"`
	Currency        string         `gorm:"column:currency;type:varchar(10);not null;default:'CNY'"`
	DurationMonths  int            `gorm:"column:duration_months;type:integer;not null;default:1"`
	PayChannel      string         `gorm:"column:pay_channel;type:varchar(50);not null;default:'wechat_mini_program'"`
	TradeType       string         `gorm:"column:trade_type;type:varchar(20);not null;default:'JSAPI'"`
	Status          string         `gorm:"column:status;type:varchar(20);not null;default:'pending'"`
	WxOpenID        *string        `gorm:"column:wx_openid;type:text"`
	WxPrepayID      *string        `gorm:"column:wx_prepay_id;type:text"`
	WxTransactionID *string        `gorm:"column:wx_transaction_id;type:text;unique"`
	WxBankType      *string        `gorm:"column:wx_bank_type;type:text"`
	PaidAt          *time.Time     `gorm:"column:paid_at;type:timestamptz"`
	ClosedAt        *time.Time     `gorm:"column:closed_at;type:timestamptz"`
	RefundedAt      *time.Time     `gorm:"column:refunded_at;type:timestamptz"`
	NotifyPayload   map[string]any `gorm:"column:notify_payload;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	Extra           map[string]any `gorm:"column:extra;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	CreatedAt       time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt       time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (MembershipPaymentDO) TableName() string { return "pro_membership_payment_records" }

type UserInviteReferralDO struct {
	ID                       string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	InviterUserID            string     `gorm:"column:inviter_user_id;type:uuid;not null;index:idx_user_invite_referrals_inviter,priority:1"`
	InviteeUserID            string     `gorm:"column:invitee_user_id;type:uuid;not null;unique;index:idx_user_invite_referrals_invitee,priority:1"`
	InviteCode               *string    `gorm:"column:invite_code;type:text"`
	SourceRequestID          *string    `gorm:"column:source_request_id;type:uuid"`
	Status                   string     `gorm:"column:status;type:text;not null;default:'pending_qualified';index:idx_user_invite_referrals_inviter,priority:2;index:idx_user_invite_referrals_invitee,priority:2"`
	FirstEffectiveActionAt   *time.Time `gorm:"column:first_effective_action_at;type:timestamptz"`
	FirstEffectiveActionType *string    `gorm:"column:first_effective_action_type;type:text"`
	RewardStartDate          *time.Time `gorm:"column:reward_start_date;type:date;index:idx_user_invite_referrals_inviter,priority:3;index:idx_user_invite_referrals_invitee,priority:3"`
	RewardEndDate            *time.Time `gorm:"column:reward_end_date;type:date;index:idx_user_invite_referrals_inviter,priority:4;index:idx_user_invite_referrals_invitee,priority:4"`
	BlockedReason            *string    `gorm:"column:blocked_reason;type:text"`
	CreatedAt                time.Time  `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt                time.Time  `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (UserInviteReferralDO) TableName() string { return "user_invite_referrals" }

type UserCreditBonusEventDO struct {
	ID             string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID         string         `gorm:"column:user_id;type:uuid;not null;index:idx_user_credit_bonus_events_user_date,priority:1"`
	BonusType      string         `gorm:"column:bonus_type;type:text;not null;index:idx_user_credit_bonus_events_user_date,priority:2"`
	BonusDate      time.Time      `gorm:"column:bonus_date;type:date;not null;index:idx_user_credit_bonus_events_user_date,priority:3"`
	Credits        int            `gorm:"column:credits;type:integer;not null;default:0"`
	SourceRecordID *string        `gorm:"column:source_record_id;type:uuid"`
	SourceScope    *string        `gorm:"column:source_scope;type:text"`
	SourceKey      *string        `gorm:"column:source_key;type:text"`
	Meta           map[string]any `gorm:"column:meta;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	CreatedAt      time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now()"`
	UpdatedAt      time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (UserCreditBonusEventDO) TableName() string { return "user_credit_bonus_events" }

type UserEarnedCreditLedgerDO struct {
	ID           string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID       string         `gorm:"column:user_id;type:uuid;not null;index:idx_user_earned_credit_ledger_user_created_at,priority:1;index:idx_user_earned_credit_ledger_user_related_date,priority:1"`
	Delta        int            `gorm:"column:delta;type:integer;not null"`
	BalanceAfter int            `gorm:"column:balance_after;type:integer;not null"`
	Reason       string         `gorm:"column:reason;type:text;not null"`
	SourceKey    *string        `gorm:"column:source_key;type:text"`
	RelatedDate  *time.Time     `gorm:"column:related_date;type:date;index:idx_user_earned_credit_ledger_user_related_date,priority:2,sort:desc"`
	Meta         map[string]any `gorm:"column:meta;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	CreatedAt    time.Time      `gorm:"column:created_at;type:timestamptz;not null;default:now();index:idx_user_earned_credit_ledger_user_created_at,priority:2,sort:desc"`
	UpdatedAt    time.Time      `gorm:"column:updated_at;type:timestamptz;not null;default:now()"`
}

func (UserEarnedCreditLedgerDO) TableName() string { return "user_earned_credit_ledger" }

type MembershipShareRewardDO struct {
	ID        string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID    string     `gorm:"column:user_id;type:uuid;not null"`
	RecordID  string     `gorm:"column:record_id;type:uuid;not null"`
	CreatedAt *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (MembershipShareRewardDO) TableName() string { return "membership_share_rewards" }

type RecipeDO struct {
	ID               string           `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID           string           `gorm:"column:user_id;type:uuid;not null;index:idx_user_recipes_user_id"`
	RecipeName       string           `gorm:"column:recipe_name;type:varchar(100);not null"`
	Description      *string          `gorm:"column:description;type:text"`
	ImagePath        *string          `gorm:"column:image_path;type:text"`
	Items            []map[string]any `gorm:"column:items;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	TotalCalories    float64          `gorm:"column:total_calories;type:numeric(10,2);not null;default:0"`
	TotalProtein     float64          `gorm:"column:total_protein;type:numeric(10,2);not null;default:0"`
	TotalCarbs       float64          `gorm:"column:total_carbs;type:numeric(10,2);not null;default:0"`
	TotalFat         float64          `gorm:"column:total_fat;type:numeric(10,2);not null;default:0"`
	TotalWeightGrams float64          `gorm:"column:total_weight_grams;type:numeric(10,2);not null;default:0"`
	Tags             []string         `gorm:"column:tags;type:text[]"`
	MealType         *string          `gorm:"column:meal_type;type:varchar(20);index:idx_user_recipes_meal_type"`
	IsFavorite       *bool            `gorm:"column:is_favorite;type:boolean;default:false;index:idx_user_recipes_is_favorite"`
	UseCount         *int             `gorm:"column:use_count;type:integer;default:0"`
	LastUsedAt       *time.Time       `gorm:"column:last_used_at;type:timestamptz"`
	CreatedAt        *time.Time       `gorm:"column:created_at;type:timestamptz;default:CURRENT_TIMESTAMP;index:idx_user_recipes_created_at,sort:desc"`
	UpdatedAt        *time.Time       `gorm:"column:updated_at;type:timestamptz;default:CURRENT_TIMESTAMP"`
}

func (RecipeDO) TableName() string { return "user_recipes" }

type UserHealthDocumentDO struct {
	ID               string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID           string         `gorm:"column:user_id;type:uuid;not null"`
	DocumentType     *string        `gorm:"column:document_type;type:text;default:'report'"`
	ImageURL         *string        `gorm:"column:image_url;type:text"`
	ExtractedContent map[string]any `gorm:"column:extracted_content;type:jsonb;serializer:json"`
	CreatedAt        *time.Time     `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (UserHealthDocumentDO) TableName() string { return "user_health_documents" }

type UserModeSwitchLogDO struct {
	ID         string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID     string     `gorm:"column:user_id;type:uuid;not null"`
	FromMode   string     `gorm:"column:from_mode;type:text;not null"`
	ToMode     string     `gorm:"column:to_mode;type:text;not null"`
	ChangedBy  string     `gorm:"column:changed_by;type:text;not null"`
	ReasonCode *string    `gorm:"column:reason_code;type:text"`
	CreatedAt  *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (UserModeSwitchLogDO) TableName() string { return "user_mode_switch_logs" }

type ManualFoodDO struct {
	ID       string  `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	Name     string  `gorm:"column:name;type:text;not null"`
	Category string  `gorm:"column:category;type:text;not null"`
	Calories float64 `gorm:"column:calories;type:numeric;not null;default:0"`
	Protein  float64 `gorm:"column:protein;type:numeric;not null;default:0"`
	Carbs    float64 `gorm:"column:carbs;type:numeric;not null;default:0"`
	Fat      float64 `gorm:"column:fat;type:numeric;not null;default:0"`
}

func (ManualFoodDO) TableName() string { return "manual_food_library" }

type PromptDO struct {
	ID        string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	Name      string     `gorm:"column:name;type:text;not null"`
	Content   string     `gorm:"column:content;type:text;not null"`
	ModelType string     `gorm:"column:model_type;type:text;not null"`
	IsActive  bool       `gorm:"column:is_active;type:boolean;not null;default:false"`
	Version   int        `gorm:"column:version;type:integer;not null;default:1"`
	CreatedBy *string    `gorm:"column:created_by;type:uuid"`
	CreatedAt *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
	UpdatedAt *time.Time `gorm:"column:updated_at;type:timestamptz;default:now()"`
}

func (PromptDO) TableName() string { return "test_prompts" }

type PromptHistoryDO struct {
	ID        string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	PromptID  string     `gorm:"column:prompt_id;type:uuid;not null"`
	Name      string     `gorm:"column:name;type:text;not null"`
	Content   string     `gorm:"column:content;type:text;not null"`
	ModelType string     `gorm:"column:model_type;type:text;not null"`
	Version   int        `gorm:"column:version;type:integer;not null"`
	CreatedBy *string    `gorm:"column:created_by;type:uuid"`
	CreatedAt *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (PromptHistoryDO) TableName() string { return "test_prompt_history" }

type TestBatchDO struct {
	ID        string         `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	Name      string         `gorm:"column:name;type:text;not null"`
	DatasetID string         `gorm:"column:dataset_id;type:uuid;not null"`
	Status    string         `gorm:"column:status;type:text;not null;default:'pending'"`
	Config    map[string]any `gorm:"column:config;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	Progress  int            `gorm:"column:progress;type:integer;not null;default:0"`
	Results   map[string]any `gorm:"column:results;type:jsonb;serializer:json;not null;default:'{}'::jsonb"`
	CreatedAt *time.Time     `gorm:"column:created_at;type:timestamptz;default:now()"`
	UpdatedAt *time.Time     `gorm:"column:updated_at;type:timestamptz;default:now()"`
}

func (TestBatchDO) TableName() string { return "test_batches" }

type TestDatasetDO struct {
	ID         string     `gorm:"column:id;type:uuid;primaryKey;default:gen_random_uuid()"`
	Name       string     `gorm:"column:name;type:text;not null"`
	ImagePaths []string   `gorm:"column:image_paths;type:jsonb;serializer:json;not null;default:'[]'::jsonb"`
	Status     string     `gorm:"column:status;type:text;not null;default:'pending'"`
	CreatedAt  *time.Time `gorm:"column:created_at;type:timestamptz;default:now()"`
}

func (TestDatasetDO) TableName() string { return "test_datasets" }

func AllModels() []any {
	return []any{
		&UserDO{},
		&UserDailyNutritionTargetDO{},
		&UserPetDO{},
		&UserPetEventDO{},
		&UserPetDailyScoreDO{},
		&UserTrialEntitlementDO{},
		&MembershipPlanDO{},
		&AnalysisTaskDO{},
		&AnalysisFeedbackSampleDO{},
		&FoodRecordDO{},
		&FoodNutritionDO{},
		&PackagedFoodDO{},
		&PackagedFoodAliasDO{},
		&FoodNutritionAliasDO{},
		&FoodUnresolvedLogDO{},
		&CriticalSampleDO{},
		&PrecisionSessionDO{},
		&PrecisionSessionRoundDO{},
		&PrecisionItemEstimateDO{},
		&PublicFoodItemDO{},
		&PublicFoodLikeDO{},
		&PublicFoodCollectionDO{},
		&PublicFoodCommentDO{},
		&PublicFoodFeedbackDO{},
		&FeedLikeDO{},
		&FeedCommentDO{},
		&FeedInteractionNotificationDO{},
		&CommentTaskDO{},
		&ExpiryItemDO{},
		&ExpiryNotificationJobDO{},
		&FriendRequestDO{},
		&UserFriendDO{},
		&BodyWeightRecordDO{},
		&BodyWaterLogDO{},
		&BodyMetricSettingsDO{},
		&ExerciseLogDO{},
		&StatsInsightDO{},
		&CustomFocusCardDO{},
		&UserMembershipDO{},
		&MembershipPaymentDO{},
		&UserInviteReferralDO{},
		&UserCreditBonusEventDO{},
		&UserEarnedCreditLedgerDO{},
		&RewardTaskUploadDO{},
		&MembershipShareRewardDO{},
		&RecipeDO{},
		&UserHealthDocumentDO{},
		&UserModeSwitchLogDO{},
		&ManualFoodDO{},
		&PromptDO{},
		&PromptHistoryDO{},
		&TestDatasetDO{},
		&TestBatchDO{},
	}
}
