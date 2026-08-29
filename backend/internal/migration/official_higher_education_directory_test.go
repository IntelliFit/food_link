package migration

import (
	"context"
	"testing"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

func TestOfficialHigherEducationSnapshot2026(t *testing.T) {
	snapshot, err := loadOfficialHigherEducationSnapshot()
	if err != nil {
		t.Fatalf("load official higher education snapshot: %v", err)
	}
	if snapshot.SourceVersion != "2026-06-17" {
		t.Fatalf("source version = %q, want 2026-06-17", snapshot.SourceVersion)
	}
	if got := len(snapshot.Institutions); got != 3196 {
		t.Fatalf("institution count = %d, want 3196", got)
	}
	codes := make(map[string]struct{}, len(snapshot.Institutions))
	regular, adult := 0, 0
	for _, institution := range snapshot.Institutions {
		if err := validateOfficialHigherEducationInstitution(institution); err != nil {
			t.Fatalf("invalid institution %#v: %v", institution, err)
		}
		if _, exists := codes[institution.OfficialCode]; exists {
			t.Fatalf("duplicate official code %q", institution.OfficialCode)
		}
		codes[institution.OfficialCode] = struct{}{}
		switch institution.Kind {
		case "regular":
			regular++
		case "adult":
			adult++
		}
	}
	if regular != 2952 || adult != 244 {
		t.Fatalf("regular/adult = %d/%d, want 2952/244", regular, adult)
	}
}

func TestEnsureOfficialHigherEducationDirectorySkipsLegacyDuplicateWhenCodeClaimed(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.SchoolDO{}))

	snapshot, err := loadOfficialHigherEducationSnapshot()
	require.NoError(t, err)
	require.NotEmpty(t, snapshot.Institutions)
	institution := snapshot.Institutions[0]
	code := institution.OfficialCode

	coded := migrationdo.SchoolDO{
		Name:         institution.Name,
		LocationType: "university",
		OfficialCode: &code,
		Status:       "active",
	}
	legacy := migrationdo.SchoolDO{
		Name:         institution.Name,
		LocationType: "university",
		Status:       "active",
	}
	require.NoError(t, db.Create(&coded).Error)
	require.NoError(t, db.Create(&legacy).Error)

	require.NoError(t, ensureOfficialHigherEducationDirectory(context.Background(), db))

	var legacyAfter migrationdo.SchoolDO
	require.NoError(t, db.First(&legacyAfter, "id = ?", legacy.ID).Error)
	require.Nil(t, legacyAfter.OfficialCode)

	var codedCount int64
	require.NoError(t, db.Model(&migrationdo.SchoolDO{}).
		Where("official_code = ?", code).
		Count(&codedCount).Error)
	require.Equal(t, int64(1), codedCount)
}
