package domain

import "time"

// AnalysisTask — table: analysis_tasks
type AnalysisTask struct {
	ID              string         `json:"id" gorm:"column:id"`
	UserID          string         `json:"user_id" gorm:"column:user_id"`
	TaskType        string         `json:"task_type" gorm:"column:task_type"` // food, food_text, precision_plan, health_report
	Status          string         `json:"status" gorm:"column:status"`       // pending, processing, done, failed, cancelled, timed_out
	ImageURL        *string        `json:"image_url,omitempty" gorm:"column:image_url"`
	ImagePaths      []string       `json:"image_paths,omitempty" gorm:"column:image_paths;serializer:json"`
	TextInput       *string        `json:"text_input,omitempty" gorm:"column:text_input"`
	Payload         map[string]any `json:"payload,omitempty" gorm:"column:payload;serializer:json"`
	Result          map[string]any `json:"result,omitempty" gorm:"column:result;serializer:json"`
	ErrorMessage    *string        `json:"error_message,omitempty" gorm:"column:error_message"`
	IsViolated      bool           `json:"is_violated,omitempty" gorm:"column:is_violated"`
	ViolationReason *string        `json:"violation_reason,omitempty" gorm:"column:violation_reason"`
	WorkerID        *string        `json:"worker_id,omitempty" gorm:"column:worker_id"`
	AttemptID       *string        `json:"attempt_id,omitempty" gorm:"column:attempt_id"`
	AttemptCount    int            `json:"attempt_count,omitempty" gorm:"column:attempt_count"`
	ProcessingAt    *time.Time     `json:"processing_started_at,omitempty" gorm:"column:processing_started_at"`
	LeaseUntil      *time.Time     `json:"lease_until,omitempty" gorm:"column:lease_until"`
	IsRecorded      bool           `json:"is_recorded" gorm:"-"`
	RecordID        string         `json:"record_id,omitempty" gorm:"-"`
	CreatedAt       *time.Time     `json:"created_at,omitempty" gorm:"column:created_at"`
	UpdatedAt       *time.Time     `json:"updated_at,omitempty" gorm:"column:updated_at"`
}

func (AnalysisTask) TableName() string { return "analysis_tasks" }

// AnalysisFeedbackSample — table: analysis_feedback_samples
type AnalysisFeedbackSample struct {
	ID                  string           `json:"id" gorm:"column:id"`
	UserID              string           `json:"user_id" gorm:"column:user_id"`
	FeedbackType        string           `json:"feedback_type" gorm:"column:feedback_type"`
	SourceTaskID        *string          `json:"source_task_id,omitempty" gorm:"column:source_task_id"`
	CorrectionTaskID    *string          `json:"correction_task_id,omitempty" gorm:"column:correction_task_id"`
	RootTaskID          *string          `json:"root_task_id,omitempty" gorm:"column:root_task_id"`
	TaskType            string           `json:"task_type" gorm:"column:task_type"`
	ModelName           *string          `json:"model_name,omitempty" gorm:"column:model_name"`
	AnalysisEngine      *string          `json:"analysis_engine,omitempty" gorm:"column:analysis_engine"`
	BeforeResult        map[string]any   `json:"before_result,omitempty" gorm:"column:before_result;serializer:json"`
	UserCorrectionItems []map[string]any `json:"user_correction_items,omitempty" gorm:"column:user_correction_items;serializer:json"`
	AfterResult         map[string]any   `json:"after_result,omitempty" gorm:"column:after_result;serializer:json"`
	PayloadSnapshot     map[string]any   `json:"payload_snapshot,omitempty" gorm:"column:payload_snapshot;serializer:json"`
	ErrorMessage        *string          `json:"error_message,omitempty" gorm:"column:error_message"`
	CreatedAt           *time.Time       `json:"created_at,omitempty" gorm:"column:created_at"`
	UpdatedAt           *time.Time       `json:"updated_at,omitempty" gorm:"column:updated_at"`
}

func (AnalysisFeedbackSample) TableName() string { return "analysis_feedback_samples" }

// PrecisionSession — table: precision_sessions
type PrecisionSession struct {
	ID                  string         `gorm:"column:id"`
	UserID              string         `gorm:"column:user_id"`
	SourceType          string         `gorm:"column:source_type"`
	ExecutionMode       string         `gorm:"column:execution_mode"`
	Status              string         `gorm:"column:status"`
	RoundIndex          int            `gorm:"column:round_index"`
	LatestInputs        map[string]any `gorm:"column:latest_inputs;serializer:json"`
	PendingRequirements []any          `gorm:"column:pending_requirements;serializer:json"`
	ReferenceObjects    []any          `gorm:"column:reference_objects;serializer:json"`
	SplitPlan           map[string]any `gorm:"column:split_plan;serializer:json"`
	LatestPlannerResult map[string]any `gorm:"column:latest_planner_result;serializer:json"`
	FinalResult         map[string]any `gorm:"column:final_result;serializer:json"`
	CurrentTaskID       *string        `gorm:"column:current_task_id"`
	LastError           *string        `gorm:"column:last_error"`
	CreatedAt           *time.Time     `gorm:"column:created_at"`
	UpdatedAt           *time.Time     `gorm:"column:updated_at"`
}

func (PrecisionSession) TableName() string { return "precision_sessions" }

// PrecisionSessionRound — table: precision_session_rounds
type PrecisionSessionRound struct {
	ID            string         `gorm:"column:id"`
	SessionID     string         `gorm:"column:session_id"`
	RoundIndex    int            `gorm:"column:round_index"`
	ActorRole     string         `gorm:"column:actor_role"`
	InputPayload  map[string]any `gorm:"column:input_payload;serializer:json"`
	PlannerResult map[string]any `gorm:"column:planner_result;serializer:json"`
	CreatedAt     *time.Time     `gorm:"column:created_at"`
}

func (PrecisionSessionRound) TableName() string { return "precision_session_rounds" }

// PrecisionItemEstimate — table: precision_item_estimates
type PrecisionItemEstimate struct {
	ID           string         `gorm:"column:id"`
	SessionID    string         `gorm:"column:session_id"`
	RoundIndex   int            `gorm:"column:round_index"`
	ItemIndex    int            `gorm:"column:item_index"`
	ItemKey      string         `gorm:"column:item_key"`
	ItemName     string         `gorm:"column:item_name"`
	Status       string         `gorm:"column:status"`
	Payload      map[string]any `gorm:"column:payload;serializer:json"`
	Result       map[string]any `gorm:"column:result;serializer:json"`
	SourceTaskID *string        `gorm:"column:source_task_id"`
	ErrorMessage *string        `gorm:"column:error_message"`
	CreatedAt    *time.Time     `gorm:"column:created_at"`
	UpdatedAt    *time.Time     `gorm:"column:updated_at"`
}

func (PrecisionItemEstimate) TableName() string { return "precision_item_estimates" }
