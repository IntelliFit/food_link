package migration

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNanyangVerifiedDiningSeed(t *testing.T) {
	spec := nanyangVerifiedDiningSpec
	spec.SeedPath = "../../data/nanyang_verified_dining_seed_20260816.json"
	batch, err := loadVerifiedDiningBatch(spec)
	require.NoError(t, err)
	require.Len(t, batch.Schools, 3)
	totalCampuses := 0
	totalCanteens := 0
	totalFloorRelations := 0
	totalSources := 0
	keys := map[string]struct{}{}
	for _, school := range batch.Schools {
		totalCampuses += len(school.Campuses)
		for _, canteen := range school.Canteens {
			totalCanteens++
			totalFloorRelations += len(strings.Split(canteen.BuildingOrFloor, "、"))
			totalSources += 1 + len(canteen.AdditionalSources)
			assert.Equal(t, "official_university", canteen.SourceType)
			assert.Equal(t, "A", canteen.EvidenceLevel)
			assert.Equal(t, "pending_review", canteen.ReviewStatus)
			assert.True(t, strings.HasPrefix(canteen.SourceURL, "https://"))
			assert.NotEmpty(t, canteen.SourceTitle)
			assert.NotEmpty(t, canteen.SourceOrg)
			assert.NotEmpty(t, canteen.EvidenceExcerpt)
			assert.NotEmpty(t, canteen.BuildingOrFloor)
			for _, source := range canteen.AdditionalSources {
				assert.Equal(t, "official_university", source.SourceType)
				assert.Equal(t, "A", source.EvidenceLevel)
				assert.True(t, strings.HasPrefix(source.SourceURL, "https://"))
				assert.NotEmpty(t, source.SourceTitle)
				assert.NotEmpty(t, source.SourceOrg)
				assert.NotEmpty(t, source.EvidenceExcerpt)
			}
			key := strings.Join([]string{school.School, canteen.Campus, canteen.Name}, "\x00")
			if _, exists := keys[key]; exists {
				t.Fatalf("duplicate canteen key %q", key)
			}
			keys[key] = struct{}{}
		}
	}
	assert.Equal(t, 3, totalCampuses)
	assert.Equal(t, 6, totalCanteens)
	assert.Equal(t, 13, totalFloorRelations)
	assert.Equal(t, 12, totalSources)
}
