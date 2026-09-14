package worker

import (
	"context"
	"errors"
	"testing"

	"food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCompleteTaskRejectsEmptyFoodResult(t *testing.T) {
	runner := &Runner{}
	task := &domain.AnalysisTask{ID: "empty-food-task", TaskType: "food", Status: "processing"}

	err := runner.completeTask(context.Background(), task, map[string]any{"items": []any{}})

	require.Error(t, err)
	assert.True(t, errors.Is(err, analyzeservice.ErrEmptyFoodAnalysisResult))
	assert.Equal(t, "processing", task.Status)
}
