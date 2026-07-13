package repo

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
)

func TestNormalizeBenchmarkJSONUpdates(t *testing.T) {
	updates := normalizeBenchmarkJSONUpdates(map[string]any{
		"items":                 map[string]float64{"米饭": 120},
		"metadata":              map[string]any{"source": "manual"},
		"metrics":               map[string]any{"accuracy": 0.8},
		"prediction":            map[string]any{"items": []any{"米饭"}},
		"stage_outputs_summary": map[string]any{"vision": "ok"},
		"status":                "done",
	}, "items", "metadata", "metrics", "prediction", "stage_outputs_summary")

	for _, key := range []string{"items", "metadata", "metrics", "prediction", "stage_outputs_summary"} {
		raw, ok := updates[key].(datatypes.JSON)
		require.True(t, ok, key)
		var decoded any
		require.NoError(t, json.Unmarshal(raw, &decoded))
		require.NotNil(t, decoded)
	}
	require.Equal(t, "done", updates["status"])
}
