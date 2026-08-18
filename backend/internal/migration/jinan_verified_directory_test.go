package migration

import (
	"context"
	"strings"
	"testing"

	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJinanVerifiedDiningSeed(t *testing.T) {
	spec := jinanVerifiedDiningSpec
	spec.SeedPath = "../../data/jinan_verified_dining_seed_20260818.json"
	batch, err := loadVerifiedDiningBatch(spec)
	require.NoError(t, err)
	require.Len(t, batch.Schools, 6)

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
	assert.Equal(t, 13, totalCampuses)
	assert.Equal(t, 25, totalCanteens)
	assert.Equal(t, 47, totalFloorRelations)
	assert.Equal(t, 44, totalSources)
}

func TestRetireUnverifiedJinanDining(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE schools (id text PRIMARY KEY, name text NOT NULL);
		CREATE TABLE school_campuses (id text PRIMARY KEY, school_id text NOT NULL, name text NOT NULL);
		CREATE TABLE school_canteens (
			id text PRIMARY KEY, school_id text NOT NULL, campus_id text NOT NULL, name text NOT NULL,
			status text NOT NULL, review_note text, reviewed_at timestamptz, updated_at timestamptz
		);
		CREATE TABLE campus_directory_sources (
			id text PRIMARY KEY, canteen_id text NOT NULL, review_status text NOT NULL, updated_at timestamptz
		);
	`).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO schools VALUES ('sdu', '山东大学');
		INSERT INTO school_campuses VALUES ('hjl', 'sdu', '洪家楼校区'), ('qd', 'sdu', '青岛校区');
		INSERT INTO school_canteens VALUES
			('third', 'sdu', 'hjl', '第三食堂', 'active', NULL, NULL, now()),
			('morning', 'sdu', 'qd', '晨园餐厅', 'active', NULL, NULL, now());
		INSERT INTO campus_directory_sources VALUES
			('src-third', 'third', 'approved', now()),
			('src-morning', 'morning', 'approved', now());
	`).Error)

	require.NoError(t, retireUnverifiedJinanDining(context.Background(), db))
	var thirdStatus, thirdSource, morningStatus, morningSource string
	require.NoError(t, db.Table("school_canteens").Select("status").Where("id = ?", "third").Scan(&thirdStatus).Error)
	require.NoError(t, db.Table("campus_directory_sources").Select("review_status").Where("id = ?", "src-third").Scan(&thirdSource).Error)
	require.NoError(t, db.Table("school_canteens").Select("status").Where("id = ?", "morning").Scan(&morningStatus).Error)
	require.NoError(t, db.Table("campus_directory_sources").Select("review_status").Where("id = ?", "src-morning").Scan(&morningSource).Error)
	assert.Equal(t, "inactive", thirdStatus)
	assert.Equal(t, "rejected", thirdSource)
	assert.Equal(t, "active", morningStatus)
	assert.Equal(t, "approved", morningSource)

	require.NoError(t, retireUnverifiedJinanDining(context.Background(), db))
}
