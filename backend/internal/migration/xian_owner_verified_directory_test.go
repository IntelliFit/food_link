package migration

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestXianOwnerVerifiedDiningSeed(t *testing.T) {
	data, err := os.ReadFile("../../data/xian_owner_verified_dining_seed_20260811.json")
	require.NoError(t, err)
	var batches []campusDirectoryPendingResearchSeed
	require.NoError(t, json.Unmarshal(data, &batches))
	require.Len(t, batches, 1)
	assert.Equal(t, xianOwnerVerifiedDiningBatchName, batches[0].BatchName)

	schools := 0
	campuses := 0
	canteens := 0
	explicitFloors := 0
	seen := map[string]struct{}{}
	for _, school := range batches[0].Schools {
		schools++
		campuses += len(school.Campuses)
		for _, canteen := range school.Canteens {
			canteens++
			if strings.TrimSpace(canteen.BuildingOrFloor) != "" {
				explicitFloors++
			}
			assert.Equal(t, "D", canteen.EvidenceLevel)
			assert.Equal(t, "user_verified_owner_approved_compilation", canteen.SourceType)
			assert.True(t, strings.HasPrefix(canteen.SourceURL, "owner-confirmation://xian-campus-dining/2026-08-11/"))
			assert.NotContains(t, canteen.EvidenceExcerpt, "confidence=warn")
			key := strings.Join([]string{school.School, canteen.Campus, canteen.Name}, "\x00")
			_, duplicate := seen[key]
			assert.False(t, duplicate, "duplicate Xi'an hierarchy key: %s", key)
			seen[key] = struct{}{}
		}
	}
	assert.Equal(t, 10, schools)
	assert.Equal(t, 16, campuses)
	assert.Equal(t, 48, canteens)
	assert.Equal(t, 22, explicitFloors)
}

func TestXianOwnerVerifiedSeedDoesNotContainUncertainRows(t *testing.T) {
	data, err := os.ReadFile("../../data/xian_owner_verified_dining_seed_20260811.json")
	require.NoError(t, err)
	text := string(data)
	assert.NotContains(t, text, "数量待确认")
	assert.NotContains(t, text, "可能已拆除")
	assert.NotContains(t, text, "需核实")
	assert.NotContains(t, text, "食堂待确认")
}
