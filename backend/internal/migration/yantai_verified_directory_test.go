package migration

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestYantaiVerifiedDiningSeed(t *testing.T) {
	spec := yantaiVerifiedDiningSpec
	spec.SeedPath = "../../data/yantai_verified_dining_seed_20260816.json"
	batch, err := loadVerifiedDiningBatch(spec)
	require.NoError(t, err)
	require.Len(t, batch.Schools, 5)
	totalCampuses := 0
	totalCanteens := 0
	keys := map[string]struct{}{}
	for _, school := range batch.Schools {
		totalCampuses += len(school.Campuses)
		for _, canteen := range school.Canteens {
			totalCanteens++
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
	assert.Equal(t, 6, totalCampuses)
	assert.Equal(t, 6, totalCanteens)
}
