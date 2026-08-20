package migration

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShijiazhuangVerifiedDiningSeed(t *testing.T) {
	spec := shijiazhuangVerifiedDiningSpec
	spec.SeedPath = "../../data/shijiazhuang_verified_dining_seed_20260818.json"
	batch, err := loadVerifiedDiningBatch(spec)
	require.NoError(t, err)
	require.Len(t, batch.Schools, 7)
	totalCampuses, totalCanteens, totalFloorRelations, totalSources := 0, 0, 0, 0
	keys := map[string]struct{}{}
	for _, school := range batch.Schools {
		totalCampuses += len(school.Campuses)
		for _, canteen := range school.Canteens {
			totalCanteens++
			totalFloorRelations += strings.Count(canteen.BuildingOrFloor, "、") + 1
			totalSources += 1 + len(canteen.AdditionalSources)
			assert.Equal(t, "A", canteen.EvidenceLevel)
			assert.Equal(t, "pending_review", canteen.ReviewStatus)
			assert.True(t, strings.HasPrefix(canteen.SourceURL, "https://"))
			assert.NotEmpty(t, canteen.SourceTitle)
			assert.NotEmpty(t, canteen.SourceOrg)
			assert.NotEmpty(t, canteen.EvidenceExcerpt)
			assert.NotEmpty(t, canteen.BuildingOrFloor)
			key := strings.Join([]string{school.School, canteen.Campus, canteen.Name}, "\x00")
			if _, exists := keys[key]; exists {
				t.Fatalf("duplicate canteen key %q", key)
			}
			keys[key] = struct{}{}
		}
	}
	assert.Equal(t, 7, totalCampuses)
	assert.Equal(t, 10, totalCanteens)
	assert.Equal(t, 17, totalFloorRelations)
	assert.Equal(t, 25, totalSources)
}

func TestShijiazhuangDiningParentMerges(t *testing.T) {
	require.Len(t, shijiazhuangDiningParentMerges, 3)
	assert.Equal(t, "主食堂", shijiazhuangDiningParentMerges[0].Canonical)
	assert.True(t, shijiazhuangDiningParentMerges[0].Active)
	assert.Equal(t, "西食堂", shijiazhuangDiningParentMerges[1].Canonical)
	assert.False(t, shijiazhuangDiningParentMerges[1].Active)
	assert.Equal(t, "餐饮中心", shijiazhuangDiningParentMerges[2].Canonical)
	assert.True(t, shijiazhuangDiningParentMerges[2].Active)
}
