package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"food_link/backend/internal/researchweight/domain"

	"github.com/stretchr/testify/require"
)

// --- fake repo: photo checks -------------------------------------------------

func (f *fakeRepo) checksMap() map[string]domain.PhotoCheck {
	if f.checks == nil {
		f.checks = map[string]domain.PhotoCheck{}
	}
	return f.checks
}
func (f *fakeRepo) SavePhotoCheck(_ context.Context, check *domain.PhotoCheck) error {
	if _, exists := f.checksMap()[check.ObjectKey]; !exists {
		f.checksMap()[check.ObjectKey] = *check
	}
	return nil
}
func (f *fakeRepo) PhotoChecks(_ context.Context, keys []string) (map[string]domain.PhotoCheck, error) {
	result := map[string]domain.PhotoCheck{}
	for _, key := range keys {
		if check, ok := f.checksMap()[key]; ok {
			result[key] = check
		}
	}
	return result, nil
}
func (f *fakeRepo) SaveReadings(_ context.Context, userID, key string, readings []domain.ScaleReading) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	check := f.checksMap()[key]
	now := time.Now()
	check.ObjectKey, check.Readings, check.ReadAt = key, readings, &now
	if check.UserID == "" {
		check.UserID = userID
	}
	f.checksMap()[key] = check
	f.savedReadings++
	return nil
}
func (f *fakeRepo) CountReadsSince(context.Context, string, time.Time) (int64, error) {
	return f.reads, nil
}
func (f *fakeRepo) SameContentUploads(_ context.Context, hashes, ownKeys []string) ([]domain.PhotoCheck, error) {
	var rows []domain.PhotoCheck
	for key, check := range f.checksMap() {
		if check.ContentSHA256 == "" || containsString(ownKeys, key) || !containsString(hashes, check.ContentSHA256) {
			continue
		}
		rows = append(rows, check)
	}
	return rows, nil
}
func (f *fakeRepo) CountRewardedSince(context.Context, string, time.Time) (int64, error) {
	return f.rewardedToday, nil
}
func (f *fakeRepo) ClaimForAutoReview(_ context.Context, id string, _ time.Duration, maxAttempts int) (bool, error) {
	if f.leased == nil {
		f.leased = map[string]bool{}
	}
	sample := f.samples[id]
	if sample == nil || sample.Status != domain.StatusPending || f.leased[id] || (maxAttempts > 0 && sample.AutoReviewAttempts >= maxAttempts) {
		return false, nil
	}
	sample.AutoReviewAttempts++
	if f.holdLeases {
		f.leased[id] = true
	}
	return true, nil
}
func (f *fakeRepo) UnpaidApproved(_ context.Context, _ time.Time, _ int) ([]domain.Sample, error) {
	var items []domain.Sample
	for _, sample := range f.samples {
		if sample.Status == domain.StatusApproved && sample.RewardCredits > 0 && sample.RewardedAt == nil {
			items = append(items, *sample)
		}
	}
	return items, nil
}
func (f *fakeRepo) PendingForAutoReview(_ context.Context, before time.Time, limit int) ([]domain.Sample, error) {
	var items []domain.Sample
	for _, sample := range f.samples {
		if sample.Status == domain.StatusPending && (sample.CreatedAt == nil || !sample.CreatedAt.After(before)) && len(items) < limit {
			items = append(items, *sample)
		}
	}
	return items, nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// --- decision table ----------------------------------------------------------

func readingOf(value, unit, model string) domain.ScaleReading {
	reading := ParseScaleReading(display(value, unit))
	reading.Model = model
	return reading
}

func both(value string) []domain.ScaleReading {
	return []domain.ScaleReading{readingOf(value, "g", "gemini"), readingOf(value, "g", "qwen")}
}

// builtWhole is the whole-dish sample from wholeInput: tare 312.4, gross 905.3.
func builtWhole(t *testing.T) *domain.Sample {
	t.Helper()
	sample, err := BuildSample("u1", wholeInput(), keyOf, nil, time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	created := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	sample.CreatedAt = &created
	return sample
}

func wholeEvidence(tare, gross []domain.ScaleReading) ReviewEvidence {
	return ReviewEvidence{
		Readings: map[string][]domain.ScaleReading{
			"research-weight/u1/t.jpg": tare, "research-weight/u1/g.jpg": gross,
		},
		Duplicates: map[string]bool{}, EvalShowsScale: map[string]bool{},
		Now: time.Date(2026, 10, 28, 12, 1, 0, 0, time.UTC),
	}
}

func TestDecideAutoReviewGradesByReadingEvidence(t *testing.T) {
	cases := []struct {
		name     string
		tare     []domain.ScaleReading
		gross    []domain.ScaleReading
		decision string
		tier     string
		credits  int
	}{
		{"both models confirm every reading", both("312.4"), both("905.3"), domain.DecisionApprove, "A", 2},
		{"kg display within its step", both("312.4"), []domain.ScaleReading{readingOf("0.905", "kg", "gemini"), readingOf("905.3", "g", "qwen")}, domain.DecisionApprove, "A", 2},
		{"one model unavailable", both("312.4"), []domain.ScaleReading{readingOf("905.3", "g", "gemini"), {Error: "timeout"}}, domain.DecisionApprove, "B", 2},
		{"models split", both("312.4"), []domain.ScaleReading{readingOf("905.3", "g", "gemini"), readingOf("965.3", "g", "qwen")}, domain.DecisionApprove, "B", 2},
		{"display unreadable", both("312.4"), []domain.ScaleReading{{IsScaleDisplay: true}, {IsScaleDisplay: true}}, domain.DecisionApprove, "C", 0},
		{"unconfirmed mismatch", both("312.4"), []domain.ScaleReading{readingOf("700", "g", "gemini"), readingOf("760", "g", "qwen")}, domain.DecisionApprove, "C", 0},
		{"both models read another number", both("312.4"), both("705.3"), domain.DecisionReject, "", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			review := DecideAutoReview(builtWhole(t), wholeEvidence(tc.tare, tc.gross))
			require.Equal(t, tc.decision, review.Decision)
			require.Equal(t, tc.tier, review.Tier)
			require.Equal(t, tc.credits, review.Credits)
			require.NotEmpty(t, review.Note)
			require.Equal(t, domain.AutoReviewVersion, review.Version)
		})
	}
}

func TestDecideAutoReviewLowersForEvalPhotoProblems(t *testing.T) {
	ev := wholeEvidence(both("312.4"), both("905.3"))
	sample := builtWhole(t)
	sample.Photos[3].Source = "album"
	review := DecideAutoReview(sample, ev)
	require.Equal(t, "C", review.Tier)
	require.Contains(t, review.Note, "相册")

	sample = builtWhole(t)
	ev.EvalShowsScale = map[string]bool{"research-weight/u1/top.jpg": true}
	review = DecideAutoReview(sample, ev)
	require.Equal(t, "C", review.Tier)
	require.Contains(t, review.Note, "秤的读数")

	sample = builtWhole(t)
	ev.EvalShowsScale = map[string]bool{}
	old := time.Date(2026, 10, 25, 4, 0, 0, 0, time.UTC).Format(time.RFC3339)
	sample.Photos[2].CapturedAt = old
	review = DecideAutoReview(sample, ev)
	require.Equal(t, "B", review.Tier)
}

func TestDecideAutoReviewRejectsDuplicatesAndCapsDailyCredits(t *testing.T) {
	ev := wholeEvidence(both("312.4"), both("905.3"))
	ev.Duplicates = map[string]bool{"research-weight/u1/top.jpg": true}
	review := DecideAutoReview(builtWhole(t), ev)
	require.Equal(t, domain.DecisionReject, review.Decision)
	require.Contains(t, review.Note, "完全相同")

	ev.Duplicates = map[string]bool{}
	ev.RewardedToday = domain.DailyRewardedLimit
	review = DecideAutoReview(builtWhole(t), ev)
	require.Equal(t, domain.DecisionApprove, review.Decision)
	require.Equal(t, "A", review.Tier)
	require.Zero(t, review.Credits)
	require.Contains(t, review.Note, "不再计分")
}

func TestDecideAutoReviewChecksEveryContainerOfAMultiMeal(t *testing.T) {
	library := Library{"c1": savedContainerFor("u1")}
	sample, err := BuildSample("u1", multiInput(), keyOf, library, time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	gross := func(name string) string { return "research-weight/u1/" + name }
	ev := ReviewEvidence{
		Readings: map[string][]domain.ScaleReading{
			gross("g0.jpg"): both("265"), gross("g1.jpg"): both("412.3"), gross("g2.jpg"): both("330"),
			gross("t0.jpg"): both("18"), gross("z2.jpg"): both("0"),
		},
		Now: time.Date(2026, 10, 28, 12, 1, 0, 0, time.UTC),
	}
	review := DecideAutoReview(sample, ev)
	require.Equal(t, domain.DecisionApprove, review.Decision)
	// The saved container's photo has no stored reading, and the empty box
	// photo predates the meal photo: both cap the tier at B.
	require.Equal(t, "B", review.Tier)
	require.Equal(t, DefaultRewardCredits(sample), review.Credits)

	ev.Readings[gross("g1.jpg")] = both("512.3")
	review = DecideAutoReview(sample, ev)
	require.Equal(t, domain.DecisionReject, review.Decision)
	require.Contains(t, review.Note, "第2盒连盒读数")
}

// --- service flow ------------------------------------------------------------

func newAutoReviewService(primary, verifier *fakeVision) (*SampleService, *fakeRepo, *fakeRewards) {
	svc, repo, rewards := newTestService()
	svc.ConfigureAutoReview(NewScaleReader(primary, verifier))
	svc.async = func(run func()) { run() }
	return svc, repo, rewards
}

// routedVision answers by image URL so one fake can play a model reading
// several photos.
type routedVision struct {
	model   string
	replies map[string]map[string]any
	calls   int
}

func (r *routedVision) AnalyzeWithImagesAndTemperatureMeta(_ context.Context, _ string, urls []string, _ float64) (map[string]any, map[string]any, error) {
	r.calls++
	if reply, ok := r.replies[urls[0]]; ok {
		return reply, map[string]any{"model": r.model}, nil
	}
	return map[string]any{"is_scale_display": false, "readable": false}, map[string]any{"model": r.model}, nil
}

func wholeReplies(gross string) map[string]map[string]any {
	return map[string]map[string]any{
		"https://cdn.test/research-weight/u1/t.jpg": display("312.4", "g"),
		"https://cdn.test/research-weight/u1/g.jpg": display(gross, "g"),
	}
}

func TestSubmitIsReviewedAutomaticallyAndPaid(t *testing.T) {
	svc, repo, rewards := newTestService()
	primary := &routedVision{model: "gemini", replies: wholeReplies("905.3")}
	verifier := &routedVision{model: "qwen", replies: wholeReplies("905.3")}
	svc.ConfigureAutoReview(&ScaleReader{primary: primary, verifier: verifier, timeout: time.Second})
	svc.async = func(run func()) { run() }

	view, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	saved := repo.samples[view.ID]
	require.Equal(t, domain.StatusApproved, saved.Status)
	require.Equal(t, "A", *saved.QualityTier)
	require.Equal(t, domain.ReviewModeAuto, saved.ReviewMode)
	require.Equal(t, []int{2}, rewards.calls)
	// Two scale photos read by both models; two evaluation photos by one.
	require.Equal(t, 4, primary.calls)
	require.Equal(t, 2, verifier.calls)

	// A second review of the same sample changes nothing and pays nothing.
	_, err = svc.AutoReviewSample(context.Background(), view.ID)
	require.NoError(t, err)
	require.Equal(t, []int{2}, rewards.calls)
}

func TestReadScaleStoresReadingsAndReusesThem(t *testing.T) {
	primary := &fakeVision{model: "gemini", reply: display("905.3", "g")}
	verifier := &fakeVision{model: "qwen", reply: display("905", "g")}
	svc, repo, _ := newAutoReviewService(primary, verifier)
	view, err := svc.ReadScale(context.Background(), "u1", "https://cdn.test/research-weight/u1/g.jpg", 1)
	require.NoError(t, err)
	require.Equal(t, domain.AgreementAgree, view.Agreement)
	require.InDelta(t, 905.3, *view.Grams, 0.01)
	require.Contains(t, view.Message, "905.3 g")

	_, err = svc.ReadScale(context.Background(), "u1", "https://cdn.test/research-weight/u1/g.jpg", 1)
	require.NoError(t, err)
	require.Equal(t, 1, primary.calls, "a photo is read once")
	require.Equal(t, 1, repo.savedReadings)

	_, err = svc.ReadScale(context.Background(), "u1", "https://cdn.test/research-weight/u2/g.jpg", 1)
	require.ErrorContains(t, err, "食探上传")

	repo.reads = DailyScaleReadLimit
	_, err = svc.ReadScale(context.Background(), "u1", "https://cdn.test/research-weight/u1/new.jpg", 1)
	require.ErrorContains(t, err, "次数已用完")
}

func TestReadScaleExplainsWhatToFix(t *testing.T) {
	svc, _, _ := newAutoReviewService(&fakeVision{reply: map[string]any{"is_scale_display": true, "readable": true, "value": "250", "unit": "ml"}}, nil)
	view, err := svc.ReadScale(context.Background(), "u1", "https://cdn.test/research-weight/u1/ml.jpg", 1)
	require.NoError(t, err)
	require.Equal(t, domain.AgreementUnreadable, view.Agreement)
	require.Contains(t, view.Message, "毫升")
}

func TestAutoReviewRejectsAPhotoAnotherUserUploaded(t *testing.T) {
	svc, repo, rewards := newTestService()
	replies := wholeReplies("905.3")
	svc.ConfigureAutoReview(&ScaleReader{primary: &routedVision{replies: replies}, verifier: &routedVision{replies: replies}, timeout: time.Second})
	svc.async = func(func()) {} // review later, by hand
	repo.checksMap()["research-weight/u2/stolen.jpg"] = domain.PhotoCheck{ObjectKey: "research-weight/u2/stolen.jpg", UserID: "u2", ContentSHA256: "abc"}
	repo.checksMap()["research-weight/u1/top.jpg"] = domain.PhotoCheck{ObjectKey: "research-weight/u1/top.jpg", UserID: "u1", ContentSHA256: "abc"}

	view, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	require.Equal(t, domain.StatusPending, repo.samples[view.ID].Status)
	reviewed, err := svc.AutoReviewSample(context.Background(), view.ID)
	require.NoError(t, err)
	require.Equal(t, domain.StatusRejected, reviewed.Status)
	require.Empty(t, rewards.calls)
}

func TestSweepPicksUpPendingSamples(t *testing.T) {
	svc, repo, _ := newTestService()
	replies := wholeReplies("905.3")
	svc.ConfigureAutoReview(&ScaleReader{primary: &routedVision{replies: replies}, verifier: &routedVision{replies: replies}, timeout: time.Second})
	svc.async = func(func()) {} // the immediate review "failed"
	view, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	created := svc.now().Add(-10 * time.Minute)
	repo.samples[view.ID].CreatedAt = &created
	require.Equal(t, 1, svc.SweepAutoReview(context.Background()))
	require.Equal(t, domain.StatusApproved, repo.samples[view.ID].Status)
}

func TestAutoReviewIsOffWithoutAReader(t *testing.T) {
	svc, repo, _ := newTestService()
	view, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	require.Equal(t, domain.StatusPending, repo.samples[view.ID].Status)
	_, err = svc.AutoReviewSample(context.Background(), view.ID)
	require.ErrorContains(t, err, "未开启")
	_, err = svc.ReadScale(context.Background(), "u1", "https://cdn.test/research-weight/u1/g.jpg", 1)
	require.ErrorContains(t, err, "手动填写")
}

type fakeAttributor struct {
	result *SampleAttribution
	err    error
	inputs []SubmitInput
}

func (f *fakeAttributor) AttributeSample(_ context.Context, _ string, input SubmitInput) (*SampleAttribution, error) {
	f.inputs = append(f.inputs, input)
	return f.result, f.err
}

func TestSubmitCarriesTheContributorsCampaign(t *testing.T) {
	svc, repo, _ := newTestService()
	station, dish := "33333333-0000-0000-0000-000000000001", "44444444-0000-0000-0000-000000000001"
	attributor := &fakeAttributor{result: &SampleAttribution{CampaignID: "c-1", Channel: "campus_station", StationSessionID: &station, CatalogItemID: &dish}}
	svc.ConfigureCampaigns(attributor)
	input := wholeInput()
	input.StationSessionID = station
	view, err := svc.Submit(context.Background(), "u1", input)
	require.NoError(t, err)
	saved := repo.samples[view.ID]
	require.Equal(t, "c-1", *saved.CampaignID)
	require.Equal(t, "campus_station", saved.CollectionChannel)
	require.Equal(t, dish, *saved.CatalogItemID)
	require.Equal(t, station, attributor.inputs[0].StationSessionID)

	attributor.result = nil
	input.ClientKey = "sample-key-0002"
	input.Photos = []PhotoInput{photo(domain.RoleTareScale, "t2.jpg"), photo(domain.RoleGrossScale, "g2.jpg"), photo(domain.RoleEvalTop, "top2.jpg")}
	view, err = svc.Submit(context.Background(), "u1", input)
	require.NoError(t, err)
	require.Equal(t, "personal", repo.samples[view.ID].CollectionChannel)
	require.Nil(t, repo.samples[view.ID].CampaignID)

	attributor.err = errors.New("称重日不属于你参加的活动")
	input.ClientKey = "sample-key-0003"
	input.Photos = []PhotoInput{photo(domain.RoleTareScale, "t3.jpg"), photo(domain.RoleGrossScale, "g3.jpg"), photo(domain.RoleEvalTop, "top3.jpg")}
	_, err = svc.Submit(context.Background(), "u1", input)
	require.ErrorContains(t, err, "称重日")
}

func TestModelOutageKeepsTheSamplePendingAndIsNotCached(t *testing.T) {
	svc, repo, rewards := newTestService()
	svc.ConfigureAutoReview(NewScaleReader(&fakeVision{err: errors.New("upstream 503")}, &fakeVision{err: errors.New("timeout")}))
	svc.async = func(run func()) { run() }

	view, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	require.Equal(t, domain.StatusPending, repo.samples[view.ID].Status, "an outage is not evidence")
	require.Zero(t, repo.savedReadings)
	require.Empty(t, rewards.calls)

	reading, err := svc.ReadScale(context.Background(), "u1", "https://cdn.test/research-weight/u1/g.jpg", 1)
	require.NoError(t, err)
	require.Equal(t, domain.AgreementUnreadable, reading.Agreement)
	require.Contains(t, reading.Message, "暂时不可用")
	require.Zero(t, repo.savedReadings, "a failed reading is asked again next time")

	// After a day the sample is graded with what there is instead of waiting forever.
	old := svc.now().Add(-25 * time.Hour)
	repo.samples[view.ID].CreatedAt = &old
	reviewed, err := svc.AutoReviewSample(context.Background(), view.ID)
	require.NoError(t, err)
	require.Equal(t, domain.StatusApproved, reviewed.Status)
	require.Equal(t, "C", *reviewed.QualityTier)
}

func TestReviewWaitsForAnotherReplicasLease(t *testing.T) {
	svc, repo, _ := newTestService()
	replies := wholeReplies("905.3")
	svc.ConfigureAutoReview(&ScaleReader{primary: &routedVision{replies: replies}, verifier: &routedVision{replies: replies}, timeout: time.Second})
	svc.async = func(func()) {}
	view, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	repo.leased = map[string]bool{view.ID: true}

	same, err := svc.AutoReviewSample(context.Background(), view.ID)
	require.NoError(t, err)
	require.Equal(t, domain.StatusPending, same.Status, "the replica holding the lease decides")
	_, err = svc.RerunAutoReview(context.Background(), view.ID)
	require.ErrorContains(t, err, "正在自动审核")

	repo.leased = map[string]bool{}
	repo.samples[view.ID].AutoReviewAttempts = domain.MaxAutoReviewAttempts
	same, err = svc.AutoReviewSample(context.Background(), view.ID)
	require.NoError(t, err)
	require.Equal(t, domain.StatusPending, same.Status, "a sample out of attempts waits for an administrator")
	rerun, err := svc.RerunAutoReview(context.Background(), view.ID)
	require.NoError(t, err)
	require.Equal(t, domain.StatusApproved, rerun.Status)
}

func TestSweepPaysApprovalsWhoseRewardFailed(t *testing.T) {
	svc, repo, rewards := newTestService()
	replies := wholeReplies("905.3")
	svc.ConfigureAutoReview(&ScaleReader{primary: &routedVision{replies: replies}, verifier: &routedVision{replies: replies}, timeout: time.Second})
	svc.async = func(run func()) { run() }
	rewards.failNext = true
	view, err := svc.Submit(context.Background(), "u1", wholeInput())
	require.NoError(t, err)
	require.Equal(t, domain.StatusApproved, repo.samples[view.ID].Status)
	require.Nil(t, repo.samples[view.ID].RewardedAt)
	require.Empty(t, rewards.calls)

	svc.SweepAutoReview(context.Background())
	require.Equal(t, []int{2}, rewards.calls)
	require.NotNil(t, repo.samples[view.ID].RewardedAt)
	svc.SweepAutoReview(context.Background())
	require.Equal(t, []int{2}, rewards.calls, "paid once")
}
