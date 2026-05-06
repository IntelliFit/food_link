package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestPrompt_Struct(t *testing.T) {
	now := time.Now()
	prompt := Prompt{
		ID:        "p-1",
		Name:      "Test Prompt",
		Content:   "test content",
		ModelType: "gpt-4",
		IsActive:  true,
		Version:   1,
		CreatedAt: &now,
		UpdatedAt: &now,
	}
	assert.Equal(t, "p-1", prompt.ID)
	assert.Equal(t, "test_prompts", prompt.TableName())
}

func TestPromptHistory_Struct(t *testing.T) {
	now := time.Now()
	history := PromptHistory{
		ID:        "h-1",
		PromptID:  "p-1",
		Name:      "Test Prompt",
		Content:   "test content",
		ModelType: "gpt-4",
		Version:   1,
		CreatedAt: &now,
	}
	assert.Equal(t, "h-1", history.ID)
	assert.Equal(t, "test_prompt_history", history.TableName())
}

func TestTestBatch_Struct(t *testing.T) {
	now := time.Now()
	batch := TestBatch{
		ID:        "b-1",
		Name:      "Test Batch",
		DatasetID: "d-1",
		Status:    "pending",
		Config:    map[string]any{"key": "value"},
		Progress:  0,
		Results:   map[string]any{},
		CreatedAt: &now,
		UpdatedAt: &now,
	}
	assert.Equal(t, "b-1", batch.ID)
	assert.Equal(t, "test_batches", batch.TableName())
}

func TestTestDataset_Struct(t *testing.T) {
	now := time.Now()
	dataset := TestDataset{
		ID:         "d-1",
		Name:       "Test Dataset",
		ImagePaths: []string{"image1.jpg"},
		Status:     "ready",
		CreatedAt:  &now,
	}
	assert.Equal(t, "d-1", dataset.ID)
	assert.Equal(t, "test_datasets", dataset.TableName())
}
