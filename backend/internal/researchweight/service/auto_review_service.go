package service

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"food_link/backend/internal/researchweight/domain"
	"food_link/backend/pkg/logger"
)

const (
	// autoReviewTimeout bounds one sample's review, model readings included.
	// Readings are saved as they finish, so a timeout keeps the progress.
	autoReviewTimeout = 4 * time.Minute
	// autoReviewLease is how long a replica owns a sample it is reviewing.
	autoReviewLease = 5 * time.Minute
	// autoReviewSweepInterval and autoReviewSweepDelay let the sweep pick up
	// samples whose immediate review failed (a restart, a model outage)
	// without racing the review started at submission.
	autoReviewSweepInterval = 2 * time.Minute
	autoReviewSweepDelay    = 3 * time.Minute
	autoReviewSweepBatch    = 20
	// readConcurrency bounds parallel model readings for one sample.
	readConcurrency = 4
)

// errReadingsUnavailable keeps a sample pending while the reading models are
// down, instead of grading its photos as unreadable.
var errReadingsUnavailable = errors.New("称重科研读秤模型暂时不可用")

// AutoReviewSample decides one pending sample automatically (the immediate
// review and the sweep). It does nothing when another replica holds the
// sample or its attempts are used up.
func (s *SampleService) AutoReviewSample(ctx context.Context, id string) (*domain.SampleView, error) {
	return s.autoReview(ctx, id, domain.MaxAutoReviewAttempts)
}

// RerunAutoReview is an administrator asking for the review again; it
// ignores the attempt limit but still waits for another replica's lease.
func (s *SampleService) RerunAutoReview(ctx context.Context, id string) (*domain.SampleView, error) {
	return s.autoReview(ctx, id, 0)
}

func (s *SampleService) autoReview(ctx context.Context, id string, maxAttempts int) (*domain.SampleView, error) {
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
	claimed, err := s.repo.ClaimForAutoReview(ctx, id, autoReviewLease, maxAttempts)
	if err != nil {
		return nil, err
	}
	if !claimed {
		if maxAttempts <= 0 {
			return nil, badRequest("这条样本正在自动审核，请稍后刷新")
		}
		view := s.toView(sample)
		return &view, nil
	}
	unlock := s.lockUser(sample.UserID)
	defer unlock()
	evidence, err := s.gatherEvidence(ctx, sample)
	if errors.Is(err, errReadingsUnavailable) {
		return nil, badRequest("读秤模型暂时不可用，稍后会自动重试")
	}
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

// lockUser serialises one contributor's reviews in this process: the daily
// reward count and the approval must not interleave with another review of
// the same person.
func (s *SampleService) lockUser(userID string) func() {
	value, _ := s.userLocks.LoadOrStore(userID, &sync.Mutex{})
	mutex := value.(*sync.Mutex)
	mutex.Lock()
	return mutex.Unlock
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

// RunAutoReview sweeps pending and unpaid samples until ctx is cancelled.
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
// delay, retries unpaid approvals, and returns how many samples it decided.
func (s *SampleService) SweepAutoReview(ctx context.Context) int {
	cutoff := s.now().Add(-autoReviewSweepDelay)
	s.retryUnpaid(ctx, cutoff)
	pending, err := s.repo.PendingForAutoReview(ctx, cutoff, autoReviewSweepBatch)
	if err != nil {
		logger.Error(ctx, "称重科研自动审核巡检读取失败", err)
		return 0
	}
	decided := 0
	for _, sample := range pending {
		reviewCtx, cancel := context.WithTimeout(ctx, autoReviewTimeout)
		view, err := s.AutoReviewSample(reviewCtx, sample.ID)
		cancel()
		if err != nil {
			logger.Warn(ctx, "称重科研样本巡检审核失败", slog.String("sample_id", sample.ID), slog.String("error", err.Error()))
			continue
		}
		if view != nil && view.Status != domain.StatusPending {
			decided++
		}
	}
	return decided
}

func (s *SampleService) retryUnpaid(ctx context.Context, cutoff time.Time) {
	unpaid, err := s.repo.UnpaidApproved(ctx, cutoff, autoReviewSweepBatch)
	if err != nil {
		logger.Error(ctx, "称重科研未发积分样本读取失败", err)
		return
	}
	for index := range unpaid {
		if err := s.payReward(ctx, &unpaid[index]); err != nil {
			logger.Warn(ctx, "称重科研样本补发积分失败", slog.String("sample_id", unpaid[index].ID), slog.String("error", err.Error()))
		}
	}
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

type readJob struct {
	photo    domain.Photo
	eval     bool
	readings []domain.ScaleReading
	failed   bool
	err      error
}

// readMissing reads every scale and evaluation photo that has no stored
// reading yet (an older client, or a reading call that never happened),
// saving each as soon as it is read. Photos no model could answer for keep
// the sample pending, until ReadingGiveUpAfter has passed.
func (s *SampleService) readMissing(ctx context.Context, sample *domain.Sample, checks map[string]domain.PhotoCheck, evidence ReviewEvidence) error {
	var jobs []*readJob
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
		jobs = append(jobs, &readJob{photo: photo, eval: eval})
	}
	limit := make(chan struct{}, readConcurrency)
	var wg sync.WaitGroup
	for _, job := range jobs {
		wg.Add(1)
		go func(job *readJob) {
			defer wg.Done()
			limit <- struct{}{}
			defer func() { <-limit }()
			url := s.accessURL(job.photo.ObjectKey)
			if job.eval {
				job.readings = []domain.ScaleReading{s.reader.ReadPrimary(ctx, url)}
			} else {
				job.readings = s.reader.Read(ctx, url)
			}
			if readingsFailed(job.readings) {
				job.failed = true
				return
			}
			job.err = s.repo.SaveReadings(ctx, sample.UserID, job.photo.ObjectKey, job.readings)
		}(job)
	}
	wg.Wait()
	submitted := s.now()
	if sample.CreatedAt != nil {
		submitted = *sample.CreatedAt
	}
	giveUp := s.now().Sub(submitted) >= domain.ReadingGiveUpAfter
	unavailable := false
	for _, job := range jobs {
		if job.err != nil {
			return job.err
		}
		if job.failed && !giveUp {
			unavailable = true
			continue
		}
		s.useReadings(job.photo, job.readings, job.eval, evidence)
	}
	if unavailable {
		return errReadingsUnavailable
	}
	return ctx.Err()
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
