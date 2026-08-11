package migration

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGuangzhouVerifiedDiningSeed(t *testing.T) {
	data, err := os.ReadFile("../../data/guangzhou_verified_dining_seed_20260811.json")
	require.NoError(t, err)
	var batches []campusDirectoryPendingResearchSeed
	require.NoError(t, json.Unmarshal(data, &batches))
	require.Len(t, batches, 1)
	assert.Equal(t, guangzhouVerifiedDiningBatchName, batches[0].BatchName)

	schools := 0
	campuses := 0
	canteens := 0
	seen := map[string]struct{}{}
	for _, school := range batches[0].Schools {
		schools++
		campuses += len(school.Campuses)
		for _, canteen := range school.Canteens {
			canteens++
			assert.Equal(t, "A", canteen.EvidenceLevel)
			assert.Equal(t, "official_university", canteen.SourceType)
			assert.NotEmpty(t, strings.TrimSpace(canteen.BuildingOrFloor))
			assert.True(t, strings.HasPrefix(canteen.SourceURL, "https://"))
			key := strings.Join([]string{school.School, canteen.Campus, canteen.Name}, "\x00")
			_, duplicate := seen[key]
			assert.False(t, duplicate, "duplicate Guangzhou hierarchy key: %s", key)
			seen[key] = struct{}{}
		}
	}
	assert.Equal(t, 13, schools)
	assert.Equal(t, 21, campuses)
	assert.Equal(t, 43, canteens)
}

func TestGuangzhouVerifiedSeedExcludesRecencyReviewCandidates(t *testing.T) {
	data, err := os.ReadFile("../../data/guangzhou_verified_dining_seed_20260811.json")
	require.NoError(t, err)
	text := string(data)
	assert.NotContains(t, text, "广州大学")
	assert.NotContains(t, text, "广东金融学院")
	assert.NotContains(t, text, "广东轻工职业技术大学")
	assert.NotContains(t, text, "广州体育学院")
	assert.NotContains(t, text, "candidate_unverified")
}
