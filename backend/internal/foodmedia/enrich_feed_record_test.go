package foodmedia

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestManualSourceLabel(t *testing.T) {
	assert.Equal(t, "常用食物", ManualSourceLabel("nutrition_library"))
	assert.Equal(t, "包装食品", ManualSourceLabel("packaged_food"))
	assert.Equal(t, "真实餐食", ManualSourceLabel("public_library"))
	assert.Equal(t, "", ManualSourceLabel(""))
}

func TestEnrichFoodRecordDisplayFieldsSourceLabel(t *testing.T) {
	items := EnrichFoodRecordDisplayFields(nil, nil, nil, nil, nil, []map[string]any{
		{
			"name":           "白米饭",
			"manual_source":  "nutrition_library",
			"manual_source_id": "uuid-1",
		},
	})
	assert.Len(t, items, 1)
	assert.Equal(t, "常用食物", items[0]["source_label"])
}
