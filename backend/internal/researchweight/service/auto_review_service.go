package service

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"food_link/backend/internal/researchweight/domain"
	"food_link/backend/pkg/logger"
)

const (
	// autoReviewTimeout bounds one sample's review, model readings included.
	autoReviewTimeout = 2 * time.Minute
	// autoReviewSweepInterval and autoReviewSweepDelay let the sweep pick up
	// samples whose immediate review failed (a restart, a model outage)
	// without racing the review started at submission.
	autoReviewSweepInterval = 2 * time.Minute
	autoReviewSweepDelay    = 3 * time.Minute
	autoReviewSweepBatch    = 20
	// readConcurrency bounds parallel model readings for one sample.
	readConcurrency = 4
)

// AutoReviewSample decides one pending sample automatically. It is a no-op
// when automatic review is off or the sample was already reviewed.
func (s *SampleService) AutoReviewSample(ctx context.Context, id string) (*domain.SampleView, error) {
	if s.reader == nil {
		return nil, badRequest("自动审核未开启")
	}
	sample, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if sample.Status != domain.StatusPending {
		view := s.toView(sample)
		return &view, nil
	}
	evidence, err := s.gatherEvidence(ctx, sample)
	if err != nil {
		return nil, err
	}
	decision := DecideAutoReview(sample, evidence)
	updates := map[string]any{
		"review_note": decision.Note, "reviewed_at": s.now(), "reviewed_by": domain.AutoReviewVersion,
		"review_mode": domain.ReviewModeAuto, "auto_review": &decision,
	}
	if decision.Decision == domain.DecisionReject {
		updates["status"] = domain.StatusRejected
	} else {
		updates["status"], updates["quality_tier"], updates["reward_credits"] = domain.StatusApproved, decision.Tier, decision.Credits
	}
	logger.Info(ctx, "称重科研样本自动审核完成", slog.String("sample_id", id), slog.String("decision", decision.Decision),
		slog.String("tier", decision.Tier), slog.Int("credits", decision.Credits))
	return s.commitReview(ctx, id, domain.AutoReviewVersion, updates)
}

// reviewSoon starts the automatic review of a fresh submission without
// holding up the response; the sweep retries anything that fails here.
func (s *SampleService) reviewSoon(ctx context.Context, id string) {
	if s.reader == nil {
		return
	}
	run := func() {
		reviewCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), autoReviewTimeout)
		defer cancel()
		if _, err := s.AutoReviewSample(reviewCtx, id); err != nil {
			logger.Warn(reviewCtx, "称重科研样本自动审核失败，稍后重试", slog.String("sample_id", id), slog.String("error", err.Error()))
		}
	}
	if s.async != nil {
		s.async(run)
		return
	}
	go run()
}

// RunAutoReview sweeps pending samples until ctx is cancelled.
func (s *SampleService) RunAutoReview(ctx context.Context) {
	if s.reader == nil {
		return
	}
	logger.Info(ctx, "称重科研自动审核巡检已启动", slog.Duration("interval", autoReviewSweepInterval))
	ticker := time.NewTicker(autoReviewSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.SweepAutoReview(ctx)
		}
	}
}

// SweepAutoReview reviews one batch of pending samples older than the sweep
// delay and returns how many it decided.
func (s *SampleService) SweepAutoReview(ctx context.Context) int {
	pending, err := s.repo.PendingForAutoReview(ctx, s.now().Add(-autoReviewSweepDelay), autoReviewSweepBatch)
	if err != nil {
		logger.Error(ctx, "称重科研自动审核巡检读取失败", err)
		return 0
	}
	decided := 0
	for _, sample := range pending {
		reviewCtx, cancel := context.WithTimeout(ctx, autoReviewTimeout)
		_, err := s.AutoReviewSample(reviewCtx, sample.ID)
		cancel()
		if err != nil {
			logger.Warn(ctx, "称重科研样本巡检审核失败", slog.String("sample_id", sample.ID), slog.String("error", err.Error()))
			continue
		}
		decided++
	}
	return decided
}

func (s *SampleService) gatherEvidence(ctx context.Context, sample *domain.Sample) (ReviewEvidence, error) {
	evidence := ReviewEvidence{Readings: map[string][]domain.ScaleReading{}, Duplicates: map[string]bool{}, EvalShowsScale: map[string]bool{}, Now: s.now()}
	keys := make([]string, 0, len(sample.Photos))
	for _, photo := range sample.Photos {
		keys = append(keys, photo.ObjectKey)
	}
	checks, err := s.repo.PhotoChecks(ctx, keys)
	if err != nil {
		return evidence, err
	}
	if err := s.readMissing(ctx, sample, checks, evidence); err != nil {
		return evidence, err
	}
	if err := s.findDuplicates(ctx, sample, checks, evidence); err != nil {
		return evidence, err
	}
	evidence.RewardedToday, err = s.repo.CountRewardedSince(ctx, sample.UserID, s.now().Add(-24*time.Hour))
	return evidence, err
}

// readMissing reads every scale and evaluation photo that has no stored
// reading yet (an older client, or a reading call that never happened) and
// fills the evidence. Saved-container photos are not read again here.
func (s *SampleService) readMissing(ctx context.Context, sample *domain.Sample, checks map[string]domain.PhotoCheck, evidence ReviewEvidence) error {
	type job struct {
		photo domain.Photo
		eval  bool
	}
	var jobs []job
	for _, photo := range sample.Photos {
		eval := isEvalRole(photo.Role)
		if _, scale := expectedReading(sample, photo); !scale && !eval {
			continue
		}
		if check, ok := checks[photo.ObjectKey]; ok && check.ReadAt != nil {
			s.useReadings(photo, check.Readings, eval, evidence)
			continue
		}
		if photo.Source == domain.PhotoSourceLibrary {
			continue
		}
		jobs = append(jobs, job{photo: photo, eval: eval})
	}
	results := make([][]domain.ScaleReading, len(jobs))
	limit := make(chan struct{}, readConcurrency)
	var wg sync.WaitGroup
	for index, item := range jobs {
		wg.Add(1)
		go func(index int, item job) {
			defer wg.Done()
			limit <- struct{}{}
			defer func() { <-limit }()
			url := s.accessURL(item.photo.ObjectKey)
			if item.eval {
				results[index] = []domain.ScaleReading{s.reader.ReadPrimary(ctx, url)}
				return
			}
			results[index] = s.reader.Read(ctx, url)
		}(index, item)
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return err
	}
	for index, item := range jobs {
		if err := s.repo.SaveReadings(ctx, sample.UserID, item.photo.ObjectKey, results[index]); err != nil {
			return err
		}
		s.useReadings(item.photo, results[index], item.eval, evidence)
	}
	return nil
}

func (s *SampleService) useReadings(photo domain.Photo, readings []domain.ScaleReading, eval bool, evidence ReviewEvidence) {
	if !eval {
		evidence.Readings[photo.ObjectKey] = readings
		return
	}
	for _, reading := range readings {
		if reading.IsScaleDisplay && reading.Readable {
			evidence.EvalShowsScale[photo.ObjectKey] = true
		}
	}
}

// findDuplicates marks photos whose bytes match another upload that backs a
// different contributor's photo, or one of this contributor's earlier
// samples. Empty-container photos may repeat and are skipped.
func (s *SampleService) findDuplicates(ctx context.Context, sample *domain.Sample, checks map[string]domain.PhotoCheck, evidence ReviewEvidence) error {
	byHash := map[string][]string{}
	ownKeys := make([]string, 0, len(sample.Photos))
	for _, photo := range sample.Photos {
		ownKeys = append(ownKeys, photo.ObjectKey)
		if isTareRole(photo.Role) || photo.Source == domain.PhotoSourceLibrary {
			continue
		}
		if check, ok := checks[photo.ObjectKey]; ok && check.ContentSHA256 != "" {
			byHash[check.ContentSHA256] = append(byHash[check.ContentSHA256], photo.ObjectKey)
		}
	}
	if len(byHash) == 0 {
		return nil
	}
	hashes := make([]string, 0, len(byHash))
	for hash := range byHash {
		hashes = append(hashes, hash)
	}
	others, err := s.repo.SameContentUploads(ctx, hashes, ownKeys)
	if err != nil {
		return err
	}
	var ownOthers []string
	for _, other := range others {
		if other.UserID != sample.UserID {
			for _, key := range byHash[other.ContentSHA256] {
				evidence.Duplicates[key] = true
			}
			continue
		}
		ownOthers = append(ownOthers, other.ObjectKey)
	}
	if len(ownOthers) == 0 {
		return nil
	}
	// The same person re-uploading a photo only matters when the earlier
	// copy already backs one of their samples.
	used, err := s.repo.UsedPhotoKeys(ctx, sample.UserID, ownOthers)
	if err != nil {
		return err
	}
	usedSet := map[string]bool{}
	for _, key := range used {
		usedSet[key] = true
	}
	for _, other := range others {
		if other.UserID == sample.UserID && usedSet[other.ObjectKey] {
			for _, key := range byHash[other.ContentSHA256] {
				evidence.Duplicates[key] = true
			}
		}
	}
	return nil
}
