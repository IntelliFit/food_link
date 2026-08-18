package migration

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQingdaoUniversityVerifiedDiningSeed(t *testing.T) {
	spec := qingdaoUniversityVerifiedDiningSpec
	spec.SeedPath = "../../data/qingdao_university_verified_dining_seed_20260816.json"
	batch, err := loadVerifiedDiningBatch(spec)
	require.NoError(t, err)
	require.Len(t, batch.Schools, 1)
	assert.Equal(t, "青岛大学", batch.Schools[0].School)
	assert.Len(t, batch.Schools[0].Campuses, 2)
	assert.Len(t, batch.Schools[0].Canteens, 7)
	keys := map[string]struct{}{}
	parents := map[string]string{}
	for _, canteen := range batch.Schools[0].Canteens {
		assert.Equal(t, "A", canteen.EvidenceLevel)
		assert.Equal(t, "pending_review", canteen.ReviewStatus)
		assert.True(t, strings.HasPrefix(canteen.SourceURL, "https://houqin.qdu.edu.cn/"))
		assert.NotEmpty(t, canteen.BuildingOrFloor)
		key := strings.Join([]string{canteen.Campus, canteen.Name}, "\x00")
		if _, exists := keys[key]; exists {
			t.Fatalf("duplicate canteen key %q", key)
		}
		keys[key] = struct{}{}
		parents[canteen.Name] = canteen.BuildingOrFloor
	}
	assert.Equal(t, "二楼、三楼", parents["浩园餐厅"])
	assert.Equal(t, "一楼、二楼、三楼", parents["莘园餐厅"])
	assert.Equal(t, "一楼、二楼", parents["滢园餐厅"])
	assert.Equal(t, "一楼、二楼", parents["泓园餐厅"])
	assert.NotContains(t, parents, "莘园餐厅一楼食堂")
}

func TestVerifiedDiningCanteenNamesIncludesCanonicalAndAliases(t *testing.T) {
	names := verifiedDiningCanteenNames(campusDirectoryResearchCanteen{
		Name:    "莘园餐厅",
		Aliases: []string{"莘园餐厅一楼食堂", "莘园餐厅", "莘园餐厅二楼食堂"},
	})
	assert.Equal(t, []string{"莘园餐厅", "莘园餐厅一楼食堂", "莘园餐厅二楼食堂"}, names)
}
