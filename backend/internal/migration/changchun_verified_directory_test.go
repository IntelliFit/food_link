package migration

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChangchunVerifiedDiningSeed(t *testing.T) {
	spec := changchunVerifiedDiningSpec
	spec.SeedPath = "../../data/changchun_verified_dining_seed_20260818.json"
	batch, err := loadVerifiedDiningBatch(spec)
	require.NoError(t, err)
	require.Len(t, batch.Schools, 10)

	totalCampuses, totalCanteens, totalFloorRelations, totalSources := 0, 0, 0, 0
	keys := map[string]struct{}{}
	for _, school := range batch.Schools {
		totalCampuses += len(school.Campuses)
		for _, canteen := range school.Canteens {
			totalCanteens++
			totalFloorRelations += strings.Count(canteen.BuildingOrFloor, "、") + 1
			totalSources += 1 + len(canteen.AdditionalSources)
			assert.Equal(t, "official_university", canteen.SourceType)
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
	assert.Equal(t, 15, totalCampuses)
	assert.Equal(t, 25, totalCanteens)
	assert.Equal(t, 54, totalFloorRelations)
	assert.Equal(t, 44, totalSources)
}

func TestChangchunNormalizationTargets(t *testing.T) {
	assert.Equal(t, []string{"自由校区", "净月校区"}, lowerStrings([]string{"自由校区", "净月校区"}))
	assert.Equal(t, []string{"abc", "南岭六餐厅"}, lowerStrings([]string{" ABC ", " 南岭六餐厅 "}))
}
