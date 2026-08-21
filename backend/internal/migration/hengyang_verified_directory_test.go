package migration

import (
	"context"
	"strings"
	"testing"

	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHengyangVerifiedDiningSeed(t *testing.T) {
	spec := hengyangVerifiedDiningSpec
	spec.SeedPath = "../../data/hengyang_verified_dining_seed_20260820.json"
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
	assert.Equal(t, 4, totalCampuses)
	assert.Equal(t, 6, totalCanteens)
	assert.Equal(t, 7, totalFloorRelations)
	assert.Equal(t, 13, totalSources)
}

func TestRetireUnverifiedHengyangDining(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE schools (id text PRIMARY KEY, name text NOT NULL, status text NOT NULL);
		CREATE TABLE school_campuses (
			id text PRIMARY KEY, school_id text NOT NULL, name text NOT NULL, status text NOT NULL
		);
		CREATE TABLE school_canteens (
			id text PRIMARY KEY, school_id text NOT NULL, campus_id text NOT NULL, name text NOT NULL,
			status text NOT NULL, confidence_level text, review_note text,
			reviewed_at timestamptz, updated_at timestamptz
		);
		CREATE TABLE campus_directory_import_batches (id text PRIMARY KEY, name text NOT NULL);
		CREATE TABLE campus_directory_sources (
			id text PRIMARY KEY, batch_id text, canteen_id text, source_url text NOT NULL,
			review_status text NOT NULL, updated_at timestamptz
		);
	`).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO schools VALUES
			('usc', '南华大学', 'active'), ('hynu', '衡阳师范学院', 'active');
		INSERT INTO school_campuses VALUES
			('usc-red', 'usc', '红湘校区', 'active'), ('hynu-east', 'hynu', '东校区', 'active');
		INSERT INTO school_canteens VALUES
			('qiushi', 'usc', 'usc-red', '求是园食堂', 'active', 'A', NULL, now(), now()),
			('boxue', 'usc', 'usc-red', '博学园食堂', 'active', 'A', NULL, now(), now()),
			('new-dining', 'hynu', 'hynu-east', '东校区新食堂', 'active', 'A', NULL, now(), now());
		INSERT INTO campus_directory_import_batches VALUES
			('old-batch', '衡阳高校官方食堂楼层确认集-20260816'),
			('other-batch', '其他高校来源批次');
		INSERT INTO campus_directory_sources VALUES
			('old-qiushi', 'old-batch', 'qiushi', 'https://gwxy.usc.edu.cn/info/1027/7146.htm', 'approved', now()),
			('strong-qiushi', 'other-batch', 'qiushi', 'https://yxy.usc.edu.cn/info/2465/9777.htm', 'approved', now()),
			('old-boxue', 'old-batch', 'boxue', 'https://nic.usc.edu.cn/__local/D/BB/A6/0405D2A46DF844D3B81A45BE430_B9966634_2E0D5D.pdf', 'approved', now()),
			('strong-boxue', 'other-batch', 'boxue', 'https://yjs.usc.edu.cn/info/1359/10577.htm', 'approved', now()),
			('old-new-dining', 'old-batch', 'new-dining', 'https://zcc.hynu.edu.cn/info/1047/12826.htm', 'approved', now()),
			('other-new-dining', 'other-batch', 'new-dining', 'https://example.edu.cn/strong.htm', 'approved', now());
	`).Error)

	require.NoError(t, retireUnverifiedHengyangDining(context.Background(), db))
	for _, id := range []string{"old-qiushi", "old-boxue", "old-new-dining"} {
		var reviewStatus string
		require.NoError(t, db.Table("campus_directory_sources").Select("review_status").Where("id = ?", id).Scan(&reviewStatus).Error)
		assert.Equal(t, "rejected", reviewStatus)
	}
	for _, id := range []string{"strong-qiushi", "strong-boxue", "other-new-dining"} {
		var reviewStatus string
		require.NoError(t, db.Table("campus_directory_sources").Select("review_status").Where("id = ?", id).Scan(&reviewStatus).Error)
		assert.Equal(t, "approved", reviewStatus)
	}
	for _, id := range []string{"qiushi", "boxue"} {
		var status string
		require.NoError(t, db.Table("school_canteens").Select("status").Where("id = ?", id).Scan(&status).Error)
		assert.Equal(t, "active", status)
	}
	var retired struct {
		Status          string
		ConfidenceLevel string
		ReviewNote      string
	}
	require.NoError(t, db.Table("school_canteens").Select("status, confidence_level, review_note").Where("id = ?", "new-dining").Scan(&retired).Error)
	assert.Equal(t, "inactive", retired.Status)
	assert.Equal(t, "B", retired.ConfidenceLevel)
	assert.Contains(t, retired.ReviewNote, "缺履约后正常售餐")

	require.NoError(t, retireUnverifiedHengyangDining(context.Background(), db))
}
