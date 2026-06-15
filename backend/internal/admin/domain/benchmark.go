package domain

import (
	"time"

	"food_link/backend/internal/migration/do"
)

const (
	BenchmarkRunStatusPending    = "pending"
	BenchmarkRunStatusRunning    = "running"
	BenchmarkRunStatusDone       = "done"
	BenchmarkRunStatusFailed     = "failed"
	BenchmarkRunStatusCancelled  = "cancelled"

	BenchmarkSampleStatusPending    = "pending"
	BenchmarkSampleStatusProcessing = "processing"
	BenchmarkSampleStatusDone       = "done"
	BenchmarkSampleStatusFailed     = "failed"
	BenchmarkSampleStatusCancelled  = "cancelled"
)

type DatasetSample = do.FoodWeightLabeledSampleDO

type BenchmarkRun = do.BenchmarkRunDO

type BenchmarkRunSample = do.BenchmarkRunSampleDO

type DatasetFilter struct {
	BatchNames []string `json:"batch_names,omitempty"`
	LabelTypes []string `json:"label_types,omitempty"`
	Statuses   []string `json:"statuses,omitempty"`
	SampleIDs  []string `json:"sample_ids,omitempty"`
}

type ModelConfig struct {
	Vision      string `json:"vision,omitempty"`
	Review      string `json:"review,omitempty"`
	Nutrition   string `json:"nutrition,omitempty"`
	Edible      string `json:"edible,omitempty"`
	Suggest     string `json:"suggest,omitempty"`
	Text        string `json:"text,omitempty"`
}

type RunMetrics struct {
	SampleCount           int       `json:"sample_count"`
	CompletedCount        int       `json:"completed_count"`
	FailedCount           int       `json:"failed_count"`
	NameMatchRate         float64   `json:"name_match_rate"`
	TotalWeightMAPE       float64   `json:"total_weight_mape"`
	TotalWeightRMSE       float64   `json:"total_weight_rmse"`
	ItemWeightMAPE        float64   `json:"item_weight_mape"`
	ItemWeightRMSE        float64   `json:"item_weight_rmse"`
	AverageDurationMs     float64   `json:"average_duration_ms"`
}

type SampleMetrics struct {
	NameMatched         bool               `json:"name_matched"`
	NameMatchDetails    []bool             `json:"name_match_details,omitempty"`
	TotalWeightError    float64            `json:"total_weight_error,omitempty"`
	TotalWeightErrorPct float64            `json:"total_weight_error_pct,omitempty"`
	ItemWeightErrors    []float64          `json:"item_weight_errors,omitempty"`
	ItemWeightErrorPcts []float64          `json:"item_weight_error_pcts,omitempty"`
	ItemComparisons     []map[string]any   `json:"item_comparisons,omitempty"`
	DurationMs          float64            `json:"duration_ms,omitempty"`
}

type StageOutputs struct {
	Vision       map[string]any `json:"vision,omitempty"`
	Review       map[string]any `json:"review,omitempty"`
	Edible       map[string]any `json:"edible,omitempty"`
	Nutrition    map[string]any `json:"nutrition,omitempty"`
	SuggestRatio map[string]any `json:"suggest_ratio,omitempty"`
	Final        map[string]any `json:"final,omitempty"`
}

type CreateRunInput struct {
	Name          string        `json:"name"`
	ExecutionMode string        `json:"execution_mode"`
	DatasetFilter DatasetFilter `json:"dataset_filter"`
	ModelConfig   ModelConfig   `json:"model_config,omitempty"`
	TextInput     string        `json:"text_input,omitempty"`
}

type ListSamplesInput struct {
	BatchName string
	LabelType string
	Status    string
	Query     string
	Page      int
	Limit     int
}

type ListSamplesResult struct {
	Items []DatasetSample
	Total int64
	Page  int
	Limit int
}

type ListRunsResult struct {
	Items []BenchmarkRun
	Total int64
	Page  int
	Limit int
}

type ListRunSamplesResult struct {
	Items []BenchmarkRunSample
	Total int64
	Page  int
	Limit int
}

// BenchmarkRunDTO is the snake_case JSON representation used by admin handlers.
type BenchmarkRunDTO struct {
	ID                string         `json:"id"`
	Name              string         `json:"name"`
	Status            string         `json:"status"`
	DatasetFilter     map[string]any `json:"dataset_filter"`
	ExecutionMode     string         `json:"execution_mode"`
	ModelConfig       map[string]any `json:"model_config"`
	SampleCount       int            `json:"sample_count"`
	Metrics           RunMetrics     `json:"metrics"`
	StageOutputsSummary map[string]any `json:"stage_outputs_summary"`
	ErrorMessage      string         `json:"error_message,omitempty"`
	StartedAt         string         `json:"started_at,omitempty"`
	CompletedAt       string         `json:"completed_at,omitempty"`
	CreatedBy         string         `json:"created_by,omitempty"`
	CreatedByUsername string         `json:"created_by_username,omitempty"`
	CreatedAt         string         `json:"created_at"`
	UpdatedAt         string         `json:"updated_at"`
}

func ToBenchmarkRunDTO(r *BenchmarkRun) BenchmarkRunDTO {
	dto := BenchmarkRunDTO{
		ID:                  r.ID,
		Name:                r.Name,
		Status:              r.Status,
		DatasetFilter:       r.DatasetFilter,
		ExecutionMode:       r.ExecutionMode,
		ModelConfig:         r.ModelConfig,
		SampleCount:         r.SampleCount,
		StageOutputsSummary: r.StageOutputsSummary,
	}
	if r.Metrics != nil {
		dto.Metrics = toRunMetrics(r.Metrics)
	}
	if r.ErrorMessage != nil {
		dto.ErrorMessage = *r.ErrorMessage
	}
	if r.CreatedBy != nil {
		dto.CreatedBy = *r.CreatedBy
	}
	if r.CreatedByUsername != nil {
		dto.CreatedByUsername = *r.CreatedByUsername
	}
	if r.StartedAt != nil {
		dto.StartedAt = r.StartedAt.Format(time.RFC3339)
	}
	if r.CompletedAt != nil {
		dto.CompletedAt = r.CompletedAt.Format(time.RFC3339)
	}
	if r.CreatedAt != nil {
		dto.CreatedAt = r.CreatedAt.Format(time.RFC3339)
	}
	if r.UpdatedAt != nil {
		dto.UpdatedAt = r.UpdatedAt.Format(time.RFC3339)
	}
	return dto
}

func ToBenchmarkRunDTOList(items []BenchmarkRun) []BenchmarkRunDTO {
	out := make([]BenchmarkRunDTO, len(items))
	for i := range items {
		out[i] = ToBenchmarkRunDTO(&items[i])
	}
	return out
}

func toRunMetrics(m map[string]any) RunMetrics {
	r := RunMetrics{}
	if v, ok := m["sample_count"].(float64); ok {
		r.SampleCount = int(v)
	} else if v, ok := m["sample_count"].(int); ok {
		r.SampleCount = v
	}
	if v, ok := m["completed_count"].(float64); ok {
		r.CompletedCount = int(v)
	} else if v, ok := m["completed_count"].(int); ok {
		r.CompletedCount = v
	}
	if v, ok := m["failed_count"].(float64); ok {
		r.FailedCount = int(v)
	} else if v, ok := m["failed_count"].(int); ok {
		r.FailedCount = v
	}
	if v, ok := m["name_match_rate"].(float64); ok {
		r.NameMatchRate = v
	}
	if v, ok := m["total_weight_mape"].(float64); ok {
		r.TotalWeightMAPE = v
	}
	if v, ok := m["total_weight_rmse"].(float64); ok {
		r.TotalWeightRMSE = v
	}
	if v, ok := m["item_weight_mape"].(float64); ok {
		r.ItemWeightMAPE = v
	}
	if v, ok := m["item_weight_rmse"].(float64); ok {
		r.ItemWeightRMSE = v
	}
	if v, ok := m["average_duration_ms"].(float64); ok {
		r.AverageDurationMs = v
	}
	return r
}

// BenchmarkRunSampleDTO is the snake_case JSON representation used by admin handlers.
type BenchmarkRunSampleDTO struct {
	ID           string         `json:"id"`
	RunID        string         `json:"run_id"`
	SampleID     string         `json:"sample_id"`
	TaskID       string         `json:"task_id,omitempty"`
	Status       string         `json:"status"`
	Prediction   map[string]any `json:"prediction"`
	GroundTruth  map[string]any `json:"ground_truth"`
	StageOutputs map[string]any `json:"stage_outputs"`
	Metrics      map[string]any `json:"metrics"`
	ErrorMessage string         `json:"error_message,omitempty"`
	StartedAt    string         `json:"started_at,omitempty"`
	CompletedAt  string         `json:"completed_at,omitempty"`
	CreatedAt    string         `json:"created_at"`
	UpdatedAt    string         `json:"updated_at"`
}

func ToBenchmarkRunSampleDTO(s *BenchmarkRunSample) BenchmarkRunSampleDTO {
	dto := BenchmarkRunSampleDTO{
		ID:           s.ID,
		RunID:        s.RunID,
		SampleID:     s.SampleID,
		Status:       s.Status,
		Prediction:   s.Prediction,
		GroundTruth:  s.GroundTruth,
		StageOutputs: s.StageOutputs,
		Metrics:      s.Metrics,
	}
	if s.TaskID != nil {
		dto.TaskID = *s.TaskID
	}
	if s.ErrorMessage != nil {
		dto.ErrorMessage = *s.ErrorMessage
	}
	if s.StartedAt != nil {
		dto.StartedAt = s.StartedAt.Format(time.RFC3339)
	}
	if s.CompletedAt != nil {
		dto.CompletedAt = s.CompletedAt.Format(time.RFC3339)
	}
	if s.CreatedAt != nil {
		dto.CreatedAt = s.CreatedAt.Format(time.RFC3339)
	}
	if s.UpdatedAt != nil {
		dto.UpdatedAt = s.UpdatedAt.Format(time.RFC3339)
	}
	return dto
}

func ToBenchmarkRunSampleDTOList(items []BenchmarkRunSample) []BenchmarkRunSampleDTO {
	out := make([]BenchmarkRunSampleDTO, len(items))
	for i := range items {
		out[i] = ToBenchmarkRunSampleDTO(&items[i])
	}
	return out
}

// DatasetSampleDTO is the snake_case JSON representation used by admin handlers.
type DatasetSampleDTO struct {
	ID               string           `json:"id"`
	BatchName        string           `json:"batch_name"`
	SampleName       string           `json:"sample_name"`
	OriginalFilename string           `json:"original_filename"`
	ImageURL         *string          `json:"image_url,omitempty"`
	ImageObjectKey   *string          `json:"image_object_key,omitempty"`
	LabelType        string           `json:"label_type"`
	TotalWeightGrams *float64          `json:"total_weight_grams,omitempty"`
	Items            map[string]float64 `json:"items,omitempty"`
	Status           string           `json:"status"`
	SourcePath       *string          `json:"source_path,omitempty"`
	Metadata         map[string]any   `json:"metadata,omitempty"`
	CreatedAt        string           `json:"created_at"`
	UpdatedAt        string           `json:"updated_at"`
}

func ToDatasetSampleDTO(s *do.FoodWeightLabeledSampleDO) DatasetSampleDTO {
	dto := DatasetSampleDTO{
		ID:               s.ID,
		BatchName:        s.BatchName,
		SampleName:       s.SampleName,
		OriginalFilename: s.OriginalFilename,
		ImageURL:         s.ImageURL,
		ImageObjectKey:   s.ImageObjectKey,
		LabelType:        s.LabelType,
		TotalWeightGrams: s.TotalWeightGrams,
		Items:            s.Items,
		Status:           s.Status,
		SourcePath:       s.SourcePath,
		Metadata:         s.Metadata,
	}
	if s.CreatedAt != nil {
		dto.CreatedAt = s.CreatedAt.Format(time.RFC3339)
	}
	if s.UpdatedAt != nil {
		dto.UpdatedAt = s.UpdatedAt.Format(time.RFC3339)
	}
	return dto
}

func ToDatasetSampleDTOList(items []do.FoodWeightLabeledSampleDO) []DatasetSampleDTO {
	out := make([]DatasetSampleDTO, len(items))
	for i := range items {
		out[i] = ToDatasetSampleDTO(&items[i])
	}
	return out
}

type UpdateSampleInput struct {
	LabelType        *string          `json:"label_type,omitempty"`
	TotalWeightGrams *float64          `json:"total_weight_grams,omitempty"`
	Items            map[string]float64 `json:"items,omitempty"`
	Status           *string          `json:"status,omitempty"`
	Metadata         map[string]any   `json:"metadata,omitempty"`
}

type CreateSampleInput struct {
	BatchName        string           `json:"batch_name"`
	SampleName       string           `json:"sample_name"`
	OriginalFilename string           `json:"original_filename"`
	ImageURL         string           `json:"image_url"`
	LabelType        string           `json:"label_type"`
	TotalWeightGrams *float64          `json:"total_weight_grams,omitempty"`
	Items            map[string]float64 `json:"items,omitempty"`
	Status           string           `json:"status"`
	Metadata         map[string]any   `json:"metadata,omitempty"`
}

func (r *RunMetrics) ToMap() map[string]any {
	return map[string]any{
		"sample_count":        r.SampleCount,
		"completed_count":     r.CompletedCount,
		"failed_count":        r.FailedCount,
		"name_match_rate":     r.NameMatchRate,
		"total_weight_mape":   r.TotalWeightMAPE,
		"total_weight_rmse":   r.TotalWeightRMSE,
		"item_weight_mape":    r.ItemWeightMAPE,
		"item_weight_rmse":    r.ItemWeightRMSE,
		"average_duration_ms": r.AverageDurationMs,
	}
}

func (s *SampleMetrics) ToMap() map[string]any {
	return map[string]any{
		"name_matched":           s.NameMatched,
		"name_match_details":     s.NameMatchDetails,
		"total_weight_error":     s.TotalWeightError,
		"total_weight_error_pct": s.TotalWeightErrorPct,
		"item_weight_errors":     s.ItemWeightErrors,
		"item_weight_error_pcts": s.ItemWeightErrorPcts,
		"item_comparisons":       s.ItemComparisons,
		"duration_ms":            s.DurationMs,
	}
}

func (f DatasetFilter) ToMap() map[string]any {
	return map[string]any{
		"batch_names": f.BatchNames,
		"label_types": f.LabelTypes,
		"statuses":    f.Statuses,
		"sample_ids":  f.SampleIDs,
	}
}

func (m ModelConfig) ToMap() map[string]any {
	return map[string]any{
		"vision":    m.Vision,
		"review":    m.Review,
		"nutrition": m.Nutrition,
		"edible":    m.Edible,
		"suggest":   m.Suggest,
		"text":      m.Text,
	}
}

func NowPtr() *time.Time {
	t := time.Now()
	return &t
}
