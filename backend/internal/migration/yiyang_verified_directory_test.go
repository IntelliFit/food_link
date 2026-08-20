package migration

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestYiyangVerifiedDiningSeed(t *testing.T) {
	spec := yiyangVerifiedDiningSpec
	spec.SeedPath = "../../data/yiyang_verified_dining_seed_20260820.json"
	batch, err := loadVerifiedDiningBatch(spec)
	require.NoError(t, err)
	require.Len(t, batch.Schools, 2)

	totalCampuses, totalCanteens, totalFloorRelations, totalSources := 0, 0, 0, 0
	keys := map[string]struct{}{}
	for _, school := range batch.Schools {
		totalCampuses += len(school.Campuses)
		for _, canteen := range school.Canteens {
			totalCanteens++
			totalFloorRelations += strings.Count(canteen.BuildingOrFloor, "、") + 1
			totalSources += 1 + len(canteen.AdditionalSources)
			assert.Contains(t, []string{"official_university", "official_government"}, canteen.SourceType)
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
			for _, source := range canteen.AdditionalSources {
				assert.Contains(t, []string{"official_university", "official_government"}, source.SourceType)
				assert.Equal(t, "A", source.EvidenceLevel)
				assert.True(t, strings.HasPrefix(source.SourceURL, "https://"))
				assert.NotEmpty(t, source.SourceTitle)
				assert.NotEmpty(t, source.SourceOrg)
				assert.NotEmpty(t, source.EvidenceExcerpt)
			}
		}
	}
	assert.Equal(t, 2, totalCampuses)
	assert.Equal(t, 6, totalCanteens)
	assert.Equal(t, 10, totalFloorRelations)
	assert.Equal(t, 13, totalSources)
}
