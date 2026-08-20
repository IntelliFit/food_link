package migration

import (
	"context"
	"strings"
	"testing"

	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestXiangtanVerifiedDiningSeed(t *testing.T) {
	spec := xiangtanVerifiedDiningSpec
	spec.SeedPath = "../../data/xiangtan_verified_dining_seed_20260820.json"
	batch, err := loadVerifiedDiningBatch(spec)
	require.NoError(t, err)
	require.Len(t, batch.Schools, 3)
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
	assert.Equal(t, 3, totalCampuses)
	assert.Equal(t, 7, totalCanteens)
	assert.Equal(t, 12, totalFloorRelations)
	assert.Equal(t, 15, totalSources)
}

func TestRetireUnverifiedXiangtanDirectory(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE schools (id text PRIMARY KEY, name text NOT NULL, status text NOT NULL);
		CREATE TABLE school_campuses (
			id text PRIMARY KEY, school_id text NOT NULL, name text NOT NULL,
			status text NOT NULL, updated_at timestamptz
		);
		CREATE TABLE school_canteens (
			id text PRIMARY KEY, school_id text NOT NULL, campus_id text NOT NULL, name text NOT NULL,
			status text NOT NULL, review_note text, reviewed_at timestamptz, updated_at timestamptz
		);
		CREATE TABLE campus_directory_sources (
			id text PRIMARY KEY, campus_id text, canteen_id text, review_status text NOT NULL, updated_at timestamptz
		);
	`).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO schools VALUES
			('xtu', '湘潭大学', 'active'), ('xx', '湘潭大学兴湘学院', 'active'),
			('hnie', '湖南工程学院', 'active'), ('hnust', '湖南科技大学', 'active');
		INSERT INTO school_campuses VALUES
			('xtu-main', 'xtu', '校本部', 'active', now()), ('xx-main', 'xx', '校本部', 'active', now()),
			('hnie-north', 'hnie', '北校区', 'active', now()), ('hnust-main', 'hnust', '校本部', 'active', now());
		INSERT INTO school_canteens VALUES
			('north-five', 'xtu', 'xtu-main', '北五餐厅', 'active', NULL, NULL, now()),
			('xingxiang', 'xx', 'xx-main', '兴湘餐厅', 'active', NULL, NULL, now()),
			('xuehai-two', 'hnie', 'hnie-north', '学海二食堂', 'active', NULL, NULL, now()),
			('bazhen', 'hnust', 'hnust-main', '八珍楼', 'active', NULL, NULL, now());
		INSERT INTO campus_directory_sources VALUES
			('src-north-five', 'xtu-main', 'north-five', 'approved', now()),
			('src-xingxiang', 'xx-main', 'xingxiang', 'approved', now()),
			('src-xuehai-two', 'hnie-north', 'xuehai-two', 'approved', now()),
			('src-hnie-campus', 'hnie-north', NULL, 'approved', now()),
			('src-bazhen', 'hnust-main', 'bazhen', 'approved', now());
	`).Error)

	require.NoError(t, retireUnverifiedXiangtanDining(context.Background(), db))
	require.NoError(t, retireUnverifiedXiangtanCampus(context.Background(), db))
	for _, id := range []string{"north-five", "xingxiang", "xuehai-two"} {
		var status string
		require.NoError(t, db.Table("school_canteens").Select("status").Where("id = ?", id).Scan(&status).Error)
		assert.Equal(t, "inactive", status)
	}
	for _, id := range []string{"src-north-five", "src-xingxiang", "src-xuehai-two", "src-hnie-campus"} {
		var status string
		require.NoError(t, db.Table("campus_directory_sources").Select("review_status").Where("id = ?", id).Scan(&status).Error)
		assert.Equal(t, "rejected", status)
	}
	var keptCanteen, keptSource, retiredCampus string
	require.NoError(t, db.Table("school_canteens").Select("status").Where("id = ?", "bazhen").Scan(&keptCanteen).Error)
	require.NoError(t, db.Table("campus_directory_sources").Select("review_status").Where("id = ?", "src-bazhen").Scan(&keptSource).Error)
	require.NoError(t, db.Table("school_campuses").Select("status").Where("id = ?", "hnie-north").Scan(&retiredCampus).Error)
	assert.Equal(t, "active", keptCanteen)
	assert.Equal(t, "approved", keptSource)
	assert.Equal(t, "inactive", retiredCampus)

	require.NoError(t, retireUnverifiedXiangtanDining(context.Background(), db))
	require.NoError(t, retireUnverifiedXiangtanCampus(context.Background(), db))
}
