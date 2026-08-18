package migration

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
)

func TestCountApprovedVerifiedDiningSourcesReusesEarlierBatchEvidence(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE campus_directory_sources (
			id text PRIMARY KEY,
			batch_id text,
			canteen_id text,
			source_url text NOT NULL,
			evidence_level text,
			review_status text NOT NULL
		)
	`).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO campus_directory_sources
			(id, batch_id, canteen_id, source_url, evidence_level, review_status)
		VALUES
			('approved-old', 'older-batch', 'canteen-1', 'https://example.edu/dining', 'A', 'approved'),
			('pending-new', 'current-batch', 'canteen-1', 'https://example.edu/dining', 'A', 'pending_review'),
			('other-canteen', 'current-batch', 'canteen-2', 'https://example.edu/dining', 'A', 'approved')
	`).Error)

	count, err := countApprovedVerifiedDiningSources(context.Background(), db, "canteen-1", "https://example.edu/dining")
	require.NoError(t, err)
	require.Equal(t, int64(1), count)
}
