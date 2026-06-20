package repo

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"gorm.io/datatypes"
)

func TestNormalizeUserJSONUpdatesWrapsHealthCondition(t *testing.T) {
	healthCondition := map[string]any{
		"medical_history": []string{"gout"},
		"dashboard_targets": map[string]float64{
			"calorie_target": 1610,
		},
	}
	updates := map[string]any{"health_condition": healthCondition}

	normalized := normalizeUserJSONUpdates(updates)

	assert.IsType(t, datatypes.JSONMap{}, normalized["health_condition"])
	assert.Equal(t, datatypes.JSONMap(healthCondition), normalized["health_condition"])
}

func TestNormalizeUserJSONUpdatesKeepsExistingJSONMap(t *testing.T) {
	healthCondition := datatypes.JSONMap{"daily_life_activity_level": "light"}
	updates := map[string]any{"health_condition": healthCondition}

	normalized := normalizeUserJSONUpdates(updates)

	assert.IsType(t, datatypes.JSONMap{}, normalized["health_condition"])
	assert.Equal(t, healthCondition, normalized["health_condition"])
}
