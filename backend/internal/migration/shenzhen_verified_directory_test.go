package migration

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShenzhenVerifiedDiningSeed(t *testing.T) {
	spec := shenzhenVerifiedDiningSpec
	spec.SeedPath = "../../data/shenzhen_verified_dining_seed_20260816.json"
	batch, err := loadVerifiedDiningBatch(spec)
	require.NoError(t, err)
	require.Len(t, batch.Schools, 5)
	total := 0
	keys := map[string]struct{}{}
	for _, school := range batch.Schools {
		for _, canteen := range school.Canteens {
			total++
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
	assert.Equal(t, 35, total)
}
