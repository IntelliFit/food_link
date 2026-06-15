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
	NameMatched         bool      `json:"name_matched"`
	NameMatchDetails    []bool    `json:"name_match_details,omitempty"`
	TotalWeightError    float64   `json:"total_weight_error,omitempty"`
	TotalWeightErrorPct float64   `json:"total_weight_error_pct,omitempty"`
	ItemWeightErrors    []float64 `json:"item_weight_errors,omitempty"`
	ItemWeightErrorPcts []float64 `json:"item_weight_error_pcts,omitempty"`
	DurationMs          float64   `json:"duration_ms,omitempty"`
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

// DatasetSampleDTO is the snake_case JSON representation used by admin handlers.
type DatasetSampleDTO struct {
	ID               string           `json:"id"`
	BatchName        string           `json:"batch_name"`
	SampleName       string           `json:"sample_name"`
	OriginalFilename string           `json:"original_filename"`
	ImageURL         *string          `json:"image_url,omitempty"`
	ImageObjectKey   *string          `json:"image_object_key,omitempty"`
	LabelType        string           `json:"label_type"`
	TotalWeightGrams *float64         `json:"total_weight_grams,omitempty"`
	Items            []map[string]any `json:"items,omitempty"`
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
	TotalWeightGrams *float64         `json:"total_weight_grams,omitempty"`
	Items            []map[string]any `json:"items,omitempty"`
	Status           *string          `json:"status,omitempty"`
	Metadata         map[string]any   `json:"metadata,omitempty"`
}

type CreateSampleInput struct {
	BatchName        string           `json:"batch_name"`
	SampleName       string           `json:"sample_name"`
	OriginalFilename string           `json:"original_filename"`
	ImageURL         string           `json:"image_url"`
	LabelType        string           `json:"label_type"`
	TotalWeightGrams *float64         `json:"total_weight_grams,omitempty"`
	Items            []map[string]any `json:"items,omitempty"`
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
