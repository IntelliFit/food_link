package migration

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	communityrepo "food_link/backend/internal/community/repo"
	"food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupOfficialAccountDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&do.UserDO{}, &do.UserCirclePostDO{}))
	require.NoError(t, MigrateFeedPrivacySchema(context.Background(), db, "public"))
	return db
}

func countRows(t *testing.T, db *gorm.DB, table string) int64 {
	t.Helper()
	var n int64
	require.NoError(t, db.Table(table).Count(&n).Error)
	return n
}

func TestSeedOfficialAccountPreviewWritesNothing(t *testing.T) {
	db := setupOfficialAccountDB(t)

	result, err := SeedOfficialAccount(context.Background(), db, "public", OfficialAccountOptions{})

	require.NoError(t, err)
	assert.True(t, result.SchemaReady)
	assert.False(t, result.AccountExists)
	assert.False(t, result.Applied)
	assert.Equal(t, len(officialAccountPosts), result.PostsPending)
	assert.Zero(t, countRows(t, db, "weapp_user"))
	assert.Zero(t, countRows(t, db, "user_circle_posts"))
}

func TestSeedOfficialAccountApplyIsRepeatable(t *testing.T) {
	db := setupOfficialAccountDB(t)
	ctx := context.Background()

	first, err := SeedOfficialAccount(ctx, db, "public", OfficialAccountOptions{Apply: true})
	require.NoError(t, err)
	assert.True(t, first.AccountCreated)
	assert.Equal(t, len(officialAccountPosts), first.PostsCreated)

	second, err := SeedOfficialAccount(ctx, db, "public", OfficialAccountOptions{Apply: true})
	require.NoError(t, err)
	assert.False(t, second.AccountCreated)
	assert.True(t, second.AccountExists)
	assert.Zero(t, second.PostsCreated)
	assert.Equal(t, len(officialAccountPosts), second.PostsExisting)
	assert.Equal(t, int64(1), countRows(t, db, "weapp_user"))
}

func TestSeedOfficialAccountPrivacyPostOnlyWhenAsked(t *testing.T) {
	db := setupOfficialAccountDB(t)
	ctx := context.Background()
	privacyPosts := func() int64 {
		var n int64
		require.NoError(t, db.Table("user_circle_posts").Where("id = ?", officialPostID(officialAccountPrivacyPost.key)).Count(&n).Error)
		return n
	}

	_, err := SeedOfficialAccount(ctx, db, "public", OfficialAccountOptions{Apply: true})
	require.NoError(t, err)
	assert.Zero(t, privacyPosts())

	result, err := SeedOfficialAccount(ctx, db, "public", OfficialAccountOptions{Apply: true, PrivacyPost: true})
	require.NoError(t, err)
	assert.Equal(t, 1, result.PostsCreated)
	assert.Equal(t, int64(1), privacyPosts())
}

func TestSeedOfficialAccountRefusesATakenNickname(t *testing.T) {
	db := setupOfficialAccountDB(t)
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id, openid, nickname) VALUES ('11111111-1111-4111-8111-111111111111', 'someone', ' 食探官方 ')`).Error)

	_, err := SeedOfficialAccount(context.Background(), db, "public", OfficialAccountOptions{Apply: true})

	require.Error(t, err)
	assert.Equal(t, int64(0), countRowsWhereOfficial(t, db))
	assert.Zero(t, countRows(t, db, "user_circle_posts"))
}

func countRowsWhereOfficial(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var n int64
	require.NoError(t, db.Table("weapp_user").Where("id = ?", officialAccountID()).Count(&n).Error)
	return n
}

func TestSeedOfficialAccountNeedsSchemaOnlyToApply(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&do.UserCirclePostDO{}))
	require.NoError(t, db.Exec(`CREATE TABLE weapp_user (id uuid PRIMARY KEY, openid text, nickname text)`).Error)
	ctx := context.Background()

	preview, err := SeedOfficialAccount(ctx, db, "public", OfficialAccountOptions{})
	require.NoError(t, err)
	assert.False(t, preview.SchemaReady)

	_, err = SeedOfficialAccount(ctx, db, "public", OfficialAccountOptions{Apply: true})
	assert.Error(t, err)
}

func TestOfficialAccountStaysPublicThroughTheFlipAndReachesGuests(t *testing.T) {
	db := setupOfficialAccountDB(t)
	ctx := context.Background()
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id, openid, nickname, public_records) VALUES ('11111111-1111-4111-8111-111111111111', 'someone', '普通用户', TRUE)`).Error)
	_, err := SeedOfficialAccount(ctx, db, "public", OfficialAccountOptions{Apply: true})
	require.NoError(t, err)

	flip, err := FlipUnconsentedRecordsToPrivate(ctx, db, "public", true)
	require.NoError(t, err)
	assert.Equal(t, int64(1), flip.Flipped, "only the ordinary account is flipped")

	rows, err := communityrepo.NewFeedRepo(db).ListPublicFeed(ctx, nil, communityrepo.FeedTargetCirclePost, "", "", "", "latest", 20, nil)
	require.NoError(t, err)
	require.Len(t, rows, len(officialAccountPosts))
	assert.Equal(t, officialPostID("intro"), rows[0].ID, "the introduction stays on top")
}

func TestOfficialPostsFitTheComposerLimitsAndRenderAsPlainText(t *testing.T) {
	for _, post := range append([]officialPost{officialAccountPrivacyPost}, officialAccountPosts...) {
		assert.NotEmpty(t, post.key)
		assert.LessOrEqual(t, utf8.RuneCountInString(post.title), 120, post.key)
		assert.LessOrEqual(t, utf8.RuneCountInString(post.body), 2000, post.key)
		assert.False(t, strings.Contains(post.body, "**"), "the feed does not render markdown: %s", post.key)
	}
}
