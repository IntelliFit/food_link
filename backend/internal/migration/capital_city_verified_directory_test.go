package migration

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCapitalCityVerifiedDiningSeed(t *testing.T) {
	data, err := os.ReadFile("../../data/capital_city_verified_dining_seed_20260811.json")
	require.NoError(t, err)

	var batches []campusDirectoryPendingResearchSeed
	require.NoError(t, json.Unmarshal(data, &batches))
	require.Len(t, batches, 1)
	assert.Equal(t, capitalCityVerifiedDiningBatchName, batches[0].BatchName)

	schools := 0
	campuses := 0
	canteens := 0
	windows := 0
	keys := map[string]struct{}{}
	for _, school := range batches[0].Schools {
		schools++
		campuses += len(school.Campuses)
		for _, canteen := range school.Canteens {
			canteens++
			assert.Equal(t, "A", canteen.EvidenceLevel)
			assert.Equal(t, "pending_review", canteen.ReviewStatus)
			assert.NotEmpty(t, canteen.SourceURL)
			assert.NotEmpty(t, canteen.BuildingOrFloor)
			assert.NotContains(t, canteen.Name, "窗口")
			key := strings.Join([]string{school.School, canteen.Campus, canteen.Name}, "\x00")
			if _, exists := keys[key]; exists {
				t.Fatalf("duplicate canteen key %q", key)
			}
			keys[key] = struct{}{}
		}
		for _, window := range school.Windows {
			windows++
			assert.Equal(t, "A", window.EvidenceLevel)
			assert.Equal(t, "pending_review", window.ReviewStatus)
			assert.NotEmpty(t, window.Canteen)
			assert.NotEmpty(t, window.Floor)
		}
	}
	assert.Equal(t, 30, schools)
	assert.Equal(t, 41, campuses)
	assert.Equal(t, 112, canteens)
	assert.Equal(t, 1, windows)
	assert.Len(t, keys, 112)
}
