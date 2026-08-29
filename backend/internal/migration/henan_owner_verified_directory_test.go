package migration

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHenanOwnerVerifiedDiningSeed(t *testing.T) {
	data, err := os.ReadFile("../../data/henan_owner_verified_dining_seed_20260826.json")
	require.NoError(t, err)
	var batches []campusDirectoryPendingResearchSeed
	require.NoError(t, json.Unmarshal(data, &batches))
	require.Len(t, batches, 1)
	assert.Equal(t, henanOwnerVerifiedDiningBatchName, batches[0].BatchName)

	campuses := 0
	canteens := 0
	explicitFloors := 0
	primarySources := 0
	seen := map[string]struct{}{}
	for _, school := range batches[0].Schools {
		campuses += len(school.Campuses)
		for _, canteen := range school.Canteens {
			canteens++
			if strings.TrimSpace(canteen.BuildingOrFloor) != "" {
				explicitFloors++
			}
			assert.Equal(t, "D", canteen.EvidenceLevel)
			assert.Equal(t, henanOwnerVerifiedSourceType, canteen.SourceType)
			assert.True(t, strings.HasPrefix(canteen.SourceURL, "owner-confirmation://henan-campus-dining/2026-08-26/"))
			assert.Equal(t, "pending_review", canteen.ReviewStatus)
			assert.Contains(t, canteen.EvidenceExcerpt, "核实状态：已核实")
			assert.NotContains(t, canteen.Name, "未查到")
			primarySources++
			key := strings.Join([]string{school.School, canteen.Campus, canteen.Name}, "\x00")
			_, duplicate := seen[key]
			assert.False(t, duplicate, "duplicate Henan hierarchy key: %s", key)
			seen[key] = struct{}{}
		}
	}
	assert.Len(t, batches[0].Schools, 14)
	assert.Equal(t, 24, campuses)
	assert.Equal(t, 49, canteens)
	assert.Equal(t, 4, explicitFloors)
	assert.Equal(t, 49, primarySources)
}

func TestHenanOwnerVerifiedSeedExcludesUncertainRows(t *testing.T) {
	data, err := os.ReadFile("../../data/henan_owner_verified_dining_seed_20260826.json")
	require.NoError(t, err)
	var batches []campusDirectoryPendingResearchSeed
	require.NoError(t, json.Unmarshal(data, &batches))
	for _, school := range batches[0].Schools {
		for _, canteen := range school.Canteens {
			assert.NotContains(t, canteen.EvidenceExcerpt, "核实状态：基本核实")
			assert.NotContains(t, canteen.EvidenceExcerpt, "核实状态：待核实")
		}
	}
}

func TestHenanOwnerVerifiedSeedNormalizesInlineLabels(t *testing.T) {
	data, err := os.ReadFile("../../data/henan_owner_verified_dining_seed_20260826.json")
	require.NoError(t, err)
	var batches []campusDirectoryPendingResearchSeed
	require.NoError(t, json.Unmarshal(data, &batches))
	require.Len(t, batches, 1)
	batch := &batches[0]
	byName := map[string]campusDirectoryResearchCanteen{}
	for _, school := range batch.Schools {
		for _, canteen := range school.Canteens {
			byName[school.School+"/"+canteen.Name] = canteen
		}
	}
	assert.Equal(t, "三层", byName["河南中医药大学/杏苑餐厅"].BuildingOrFloor)
	assert.Equal(t, []string{"一食堂"}, byName["河南牧业经济学院/醒园"].Aliases)
	assert.Equal(t, "二楼、三楼", byName["河南牧业经济学院/随园"].BuildingOrFloor)
}
