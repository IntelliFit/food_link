package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/researchweight/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestPhotoChecksKeepHashesAndStoreReadings(t *testing.T) {
	repo := setupSampleRepo(t)
	ctx, alice, bob := context.Background(), uuid.NewString(), uuid.NewString()
	require.NoError(t, repo.SavePhotoCheck(ctx, &domain.PhotoCheck{ObjectKey: "a/1.jpg", UserID: alice, ContentSHA256: "same"}))
	require.NoError(t, repo.SavePhotoCheck(ctx, &domain.PhotoCheck{ObjectKey: "a/1.jpg", UserID: alice, ContentSHA256: "changed"}))
	require.NoError(t, repo.SavePhotoCheck(ctx, &domain.PhotoCheck{ObjectKey: "b/1.jpg", UserID: bob, ContentSHA256: "same"}))

	grams := 452.0
	require.NoError(t, repo.SaveReadings(ctx, alice, "a/1.jpg", []domain.ScaleReading{{Model: "m", IsScaleDisplay: true, Readable: true, Grams: &grams}}))
	// A photo uploaded before hashes were recorded still gets its readings.
	require.NoError(t, repo.SaveReadings(ctx, alice, "a/old.jpg", []domain.ScaleReading{{Model: "m"}}))

	checks, err := repo.PhotoChecks(ctx, []string{"a/1.jpg", "a/old.jpg", "missing"})
	require.NoError(t, err)
	require.Len(t, checks, 2)
	require.Equal(t, "same", checks["a/1.jpg"].ContentSHA256, "the first hash is kept")
	require.NotNil(t, checks["a/1.jpg"].ReadAt)
	require.InDelta(t, 452, *checks["a/1.jpg"].Readings[0].Grams, 0.01)
	require.Equal(t, "", checks["a/old.jpg"].ContentSHA256)

	reads, err := repo.CountReadsSince(ctx, alice, time.Now().Add(-time.Hour))
	require.NoError(t, err)
	require.EqualValues(t, 2, reads)

	dups, err := repo.SameContentUploads(ctx, []string{"same", ""}, []string{"a/1.jpg"})
	require.NoError(t, err)
	require.Len(t, dups, 1)
	require.Equal(t, "b/1.jpg", dups[0].ObjectKey)
}

func TestAutoReviewIsStoredAndCountedForTheDailyCap(t *testing.T) {
	repo := setupSampleRepo(t)
	ctx, userID := context.Background(), uuid.NewString()
	sample, _, err := repo.Create(ctx, pendingSample(userID, "client-key-auto"))
	require.NoError(t, err)

	pending, err := repo.PendingForAutoReview(ctx, time.Now().Add(time.Minute), 10)
	require.NoError(t, err)
	require.Len(t, pending, 1)

	reviewed, err := repo.Review(ctx, sample.ID, map[string]any{
		"status": domain.StatusApproved, "quality_tier": "A", "reward_credits": 2, "reviewed_at": time.Now(),
		"reviewed_by": domain.AutoReviewVersion, "review_mode": domain.ReviewModeAuto,
		"auto_review": &domain.AutoReview{Version: domain.AutoReviewVersion, Decision: domain.DecisionApprove, Tier: "A", Credits: 2,
			Checks: []domain.AutoCheck{{Name: "reading", Status: domain.CheckPass}}},
	})
	require.NoError(t, err)
	require.Equal(t, domain.ReviewModeAuto, reviewed.ReviewMode)
	require.NotNil(t, reviewed.AutoReview)
	require.Equal(t, "A", reviewed.AutoReview.Tier)
	require.Len(t, reviewed.AutoReview.Checks, 1)
	require.Equal(t, "personal", reviewed.CollectionChannel)

	count, err := repo.CountRewardedSince(ctx, userID, time.Now().Add(-time.Hour))
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
	pending, err = repo.PendingForAutoReview(ctx, time.Now().Add(time.Minute), 10)
	require.NoError(t, err)
	require.Empty(t, pending)
}
