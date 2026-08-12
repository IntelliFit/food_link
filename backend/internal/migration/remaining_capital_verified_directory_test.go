package migration

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRemainingCapitalVerifiedDiningSeed(t *testing.T) {
	data, err := os.ReadFile("../../data/remaining_capital_verified_dining_seed_20260812.json")
	require.NoError(t, err)
	var batches []campusDirectoryPendingResearchSeed
	require.NoError(t, json.Unmarshal(data, &batches))
	require.Len(t, batches, 1)
	assert.Equal(t, remainingCapitalVerifiedDiningBatchName, batches[0].BatchName)

	campuses := 0
	canteens := 0
	keys := map[string]struct{}{}
	for _, school := range batches[0].Schools {
		campuses += len(school.Campuses)
		for _, canteen := range school.Canteens {
			canteens++
			assert.Equal(t, "A", canteen.EvidenceLevel)
			assert.Equal(t, "pending_review", canteen.ReviewStatus)
			assert.True(t, strings.HasPrefix(canteen.SourceURL, "https://"))
			assert.NotEmpty(t, canteen.BuildingOrFloor)
			key := strings.Join([]string{school.School, canteen.Campus, canteen.Name}, "\x00")
			if _, exists := keys[key]; exists {
				t.Fatalf("duplicate canteen key %q", key)
			}
			keys[key] = struct{}{}
		}
	}
	assert.Contains(t, batches[0].Region, "23个省会")
	assert.Len(t, batches[0].Schools, 53)
	assert.Equal(t, 73, campuses)
	assert.Equal(t, 179, canteens)
	assert.Len(t, keys, 179)
}
