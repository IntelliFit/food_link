package migration

import (
	"context"
	"testing"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

func TestMigrateCampusMapLocationsAddsCoordinateColumns(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, MigrateCampusMapLocations(context.Background(), db))
	require.True(t, db.Migrator().HasColumn(&migrationdo.SchoolDO{}, "Latitude"))
	require.True(t, db.Migrator().HasColumn(&migrationdo.SchoolDO{}, "CoordinateSource"))
	require.True(t, db.Migrator().HasColumn(&migrationdo.SchoolCampusDO{}, "Longitude"))
	require.True(t, db.Migrator().HasColumn(&migrationdo.SchoolCampusDO{}, "CoordinateUpdatedAt"))
	require.True(t, db.Migrator().HasColumn(&migrationdo.SchoolCanteenDO{}, "Latitude"))
	require.True(t, db.Migrator().HasColumn(&migrationdo.SchoolCanteenDO{}, "CoordinateSource"))
}
