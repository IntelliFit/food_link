package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/campuscatalog/domain"
	"food_link/backend/internal/migration"
	"food_link/backend/pkg/testdb"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestVenueCollectorMigrationAndAuthorization(t *testing.T) {
	t.Cleanup(func() { require.NoError(t, testdb.Stop()) })
	db := testdb.New(t)
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	ctx := context.Background()
	// Start with the old mandatory-school columns and a real legacy grant.
	require.NoError(t, db.Exec(`CREATE TABLE campus_collector_scopes (id uuid PRIMARY KEY, user_id uuid NOT NULL, school_id uuid NOT NULL, granted_by_admin_id uuid NOT NULL);
		CREATE TABLE campus_collector_applications (id uuid PRIMARY KEY, user_id uuid NOT NULL, school_id uuid NOT NULL)`).Error)
	legacyID, userID, schoolID, adminID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	require.NoError(t, db.Exec("INSERT INTO campus_collector_scopes (id,user_id,school_id,granted_by_admin_id) VALUES (?,?,?,?)", legacyID, userID, schoolID, adminID).Error)
	require.NoError(t, migration.MigrateCanteenCollectorScopes(ctx, db))
	require.NoError(t, migration.MigrateCanteenCollectorScopes(ctx, db))
	var legacy domain.CollectorScope
	require.NoError(t, db.First(&legacy, "id = ?", legacyID).Error)
	require.Equal(t, schoolID, legacy.SchoolID)
	require.Equal(t, "university", legacy.VenueType)
	r := NewCatalogRepo(db)
	allowed, err := r.HasActiveCollectorScope(ctx, userID, schoolID, "", "", time.Now())
	require.NoError(t, err)
	require.True(t, allowed)

	now := time.Now()
	application := &domain.CollectorApplication{ID: uuid.NewString(), UserID: userID, VenueType: "community", OrganizationName: "AI原点社区", ScopeCanteenName: "原点食堂", Status: "pending", CreatedAt: &now, UpdatedAt: &now}
	require.NoError(t, r.CreateCollectorApplication(ctx, application))
	found, err := r.FindVenueCollectorApplication(ctx, userID, "community", "北京AI原点社区", "原点食堂")
	require.NoError(t, err)
	require.Equal(t, application.ID, found.ID)
	expires := now.Add(time.Hour)
	_, scope, err := r.ReviewCollectorApplication(ctx, application.ID, adminID, "approved", "", &expires, now)
	require.NoError(t, err)
	require.Empty(t, scope.SchoolID)
	for _, tc := range []struct {
		venue, organization, canteen string
		at                           time.Time
		want                         bool
	}{
		{"community", "北京AI原点社区", "原点食堂", now, true},
		{"community", "AI原点社区", "另一食堂", now, false},
		{"community", "其他社区", "原点食堂", now, false},
		{"office_park", "AI原点社区", "原点食堂", now, false},
		{"community", "AI原点社区", "原点食堂", expires, false},
	} {
		got, err := r.HasActiveVenueCollectorScope(ctx, userID, tc.venue, tc.organization, tc.canteen, tc.at)
		require.NoError(t, err)
		require.Equal(t, tc.want, got, tc)
	}
	// Whole-organization grants work for any of its canteens, not other venues.
	require.NoError(t, db.Model(scope).Update("scope_canteen_name", "").Error)
	allowed, err = r.HasActiveVenueCollectorScope(ctx, userID, "community", "AI原点社区", "另一食堂", now)
	require.NoError(t, err)
	require.True(t, allowed)
	require.NoError(t, db.Model(scope).Update("status", "revoked").Error)
	allowed, err = r.HasActiveVenueCollectorScope(ctx, userID, "community", "AI原点社区", "原点食堂", now)
	require.NoError(t, err)
	require.False(t, allowed)
}
