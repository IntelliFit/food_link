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

func TestClaimLeasesAPendingSampleOnceAndCountsAttempts(t *testing.T) {
	repo := setupSampleRepo(t)
	ctx := context.Background()
	sample, _, err := repo.Create(ctx, pendingSample(uuid.NewString(), "client-key-claim"))
	require.NoError(t, err)

	claimed, err := repo.ClaimForAutoReview(ctx, sample.ID, time.Minute, domain.MaxAutoReviewAttempts)
	require.NoError(t, err)
	require.True(t, claimed)
	claimed, err = repo.ClaimForAutoReview(ctx, sample.ID, time.Minute, domain.MaxAutoReviewAttempts)
	require.NoError(t, err)
	require.False(t, claimed, "the lease is held")
	pending, err := repo.PendingForAutoReview(ctx, time.Now().Add(time.Minute), 10)
	require.NoError(t, err)
	require.Empty(t, pending, "a leased sample is not swept")

	require.NoError(t, repo.db.Exec("UPDATE research_weight_samples SET auto_review_lease_until = now() - interval '1 second', auto_review_attempts = ? WHERE id = ?", domain.MaxAutoReviewAttempts, sample.ID).Error)
	claimed, err = repo.ClaimForAutoReview(ctx, sample.ID, time.Minute, domain.MaxAutoReviewAttempts)
	require.NoError(t, err)
	require.False(t, claimed, "attempts used up")
	claimed, err = repo.ClaimForAutoReview(ctx, sample.ID, time.Minute, 0)
	require.NoError(t, err)
	require.True(t, claimed, "an administrator can still re-run it")

	_, err = repo.Review(ctx, sample.ID, map[string]any{"status": domain.StatusApproved, "quality_tier": "B", "reward_credits": 2, "reviewed_at": time.Now().Add(-time.Hour)})
	require.NoError(t, err)
	unpaid, err := repo.UnpaidApproved(ctx, time.Now(), 10)
	require.NoError(t, err)
	require.Len(t, unpaid, 1)
	require.NoError(t, repo.MarkRewarded(ctx, sample.ID))
	unpaid, err = repo.UnpaidApproved(ctx, time.Now(), 10)
	require.NoError(t, err)
	require.Empty(t, unpaid)
}
