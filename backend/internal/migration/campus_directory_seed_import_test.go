package migration

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestInspectCampusDirectoryResearchSeed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "seed.json")
	data := `[{"batch_name":"测试批次","region":"山西省","schools":[{"school":"测试大学","review_status":"active","campuses":[{"name":"主校区"}],"canteens":[{"campus":"主校区","name":"一食堂","review_status":"active"},{"campus":"主校区","name":"待核食堂"}],"windows":[{"campus":"主校区","canteen":"一食堂","name":"面食窗口","review_status":"active"},{"campus":"主校区","canteen":"一食堂","name":"待核窗口"}],"dishes":[{"campus":"主校区","canteen":"一食堂","name":"面条"},{"campus":"主校区","canteen":"一食堂","name":"饺子"}]}]}]`
	require.NoError(t, os.WriteFile(path, []byte(data), 0o600))

	stats, err := InspectCampusDirectoryResearchSeed(path)
	require.NoError(t, err)
	require.Equal(t, CampusDirectorySeedStats{
		Batches: 1, Schools: 1, Campuses: 1, Canteens: 2,
		ActiveCanteens: 1, PendingCanteens: 1,
		Windows: 2, ActiveWindows: 1, PendingWindows: 1,
		Dishes: 2,
	}, stats)
}

func TestInspectCampusDirectoryResearchSeedRejectsInvalidJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "seed.json")
	require.NoError(t, os.WriteFile(path, []byte(`{"broken":`), 0o600))

	_, err := InspectCampusDirectoryResearchSeed(path)
	require.Error(t, err)
}

func TestExplicitUnresolvedCanteenPlaceholderName(t *testing.T) {
	require.True(t, isExplicitUnresolvedCanteenPlaceholderName("学生食堂（官方未提供专名）"))
	require.True(t, isExplicitUnresolvedCanteenPlaceholderName("食堂（专名待核）"))
	require.False(t, isExplicitUnresolvedCanteenPlaceholderName("第一学生食堂"))
}
