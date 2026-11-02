package service

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/experiment/domain"
)

type fakeRepo struct {
	visitors    map[string]domain.Visitor
	experiments map[string]domain.Experiment
	assignments []domain.Assignment
	users       map[string]time.Time
	events      []domain.Event
	exposed     []string
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		visitors:    map[string]domain.Visitor{},
		experiments: map[string]domain.Experiment{},
		users:       map[string]time.Time{},
	}
}

func (f *fakeRepo) TouchVisitor(_ context.Context, v domain.Visitor) (domain.Visitor, error) {
	stored, ok := f.visitors[v.AnonID]
	if !ok {
		f.visitors[v.AnonID] = v
		return v, nil
	}
	stored.LastSeenAt = v.LastSeenAt
	if stored.UserID == nil && v.UserID != nil {
		stored.UserID = v.UserID
	}
	f.visitors[v.AnonID] = stored
	return stored, nil
}

func (f *fakeRepo) ListServableExperiments(context.Context) ([]domain.Experiment, error) {
	var out []domain.Experiment
	for _, e := range f.experiments {
		if e.Status != domain.StatusDraft {
			out = append(out, e)
		}
	}
	return out, nil
}

func (f *fakeRepo) FindAssignmentByUser(_ context.Context, key, userID string) (*domain.Assignment, error) {
	for _, a := range f.assignments {
		if a.ExperimentKey == key && a.UserID != nil && *a.UserID == userID {
			copy := a
			return &copy, nil
		}
	}
	return nil, nil
}

func (f *fakeRepo) FindAssignmentByAnon(_ context.Context, key, anonID string) (*domain.Assignment, error) {
	for _, a := range f.assignments {
		if a.ExperimentKey == key && a.AnonID == anonID {
			copy := a
			return &copy, nil
		}
	}
	return nil, nil
}

func (f *fakeRepo) CreateAssignment(_ context.Context, a domain.Assignment) (domain.Assignment, error) {
	f.assignments = append(f.assignments, a)
	return a, nil
}

func (f *fakeRepo) BindAssignment(_ context.Context, id, key, userID string, reason *string) (bool, error) {
	for _, a := range f.assignments {
		if a.ExperimentKey == key && a.UserID != nil && *a.UserID == userID {
			return false, nil
		}
	}
	for i := range f.assignments {
		if f.assignments[i].ID == id && f.assignments[i].UserID == nil {
			u := userID
			f.assignments[i].UserID = &u
			f.assignments[i].ExcludedReason = reason
			return true, nil
		}
	}
	return false, nil
}

func (f *fakeRepo) ExcludeUnboundAnon(_ context.Context, key, anonID, reason string) error {
	for i := range f.assignments {
		a := &f.assignments[i]
		if a.ExperimentKey == key && a.AnonID == anonID && a.UserID == nil && a.ExcludedReason == nil {
			r := reason
			a.ExcludedReason = &r
		}
	}
	return nil
}

func (f *fakeRepo) UserCreatedAt(_ context.Context, userID string) (time.Time, bool, error) {
	t, ok := f.users[userID]
	return t, ok, nil
}

func (f *fakeRepo) MarkExposed(_ context.Context, anonID, _ string, keys []string, _ time.Time) (int64, error) {
	f.exposed = append(f.exposed, anonID+":"+strings.Join(keys, ","))
	return int64(len(keys)), nil
}

func (f *fakeRepo) InsertEvents(_ context.Context, events []domain.Event) error {
	f.events = append(f.events, events...)
	return nil
}

func (f *fakeRepo) ListExperiments(ctx context.Context) ([]domain.Experiment, error) {
	return f.ListServableExperiments(ctx)
}

func (f *fakeRepo) GetExperiment(_ context.Context, key string) (*domain.Experiment, error) {
	e, ok := f.experiments[key]
	if !ok {
		return nil, nil
	}
	return &e, nil
}

func (f *fakeRepo) SaveExperiment(_ context.Context, e domain.Experiment) error {
	f.experiments[e.Key] = e
	return nil
}

func (f *fakeRepo) Summary(context.Context, string) ([]domain.VariantSummary, error) {
	return nil, nil
}

var (
	t0      = time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	started = t0.Add(-time.Hour)
)

func runningExperiment(audience string) domain.Experiment {
	s := started
	return domain.Experiment{
		Key:       "onboarding_v2",
		Status:    domain.StatusRunning,
		Audience:  audience,
		Variants:  []domain.Variant{{Key: "control", Weight: 50}, {Key: "pet_flow", Weight: 50}},
		Salt:      "onboarding_v2",
		StartedAt: &s,
	}
}

func newTestService(repo *fakeRepo) *Service {
	svc := NewService(repo)
	svc.now = func() time.Time { return t0 }
	return svc
}

func assign(t *testing.T, svc *Service, anonID, userID string) domain.Served {
	t.Helper()
	out, err := svc.Assignments(context.Background(), AssignInput{AnonID: anonID, UserID: userID})
	if err != nil {
		t.Fatalf("Assignments() error = %v", err)
	}
	return out["onboarding_v2"]
}

func TestPickVariantSplitsByWeight(t *testing.T) {
	variants := []domain.Variant{{Key: "control", Weight: 50}, {Key: "new", Weight: 50}}
	counts := map[string]int{}
	for i := 0; i < 20000; i++ {
		counts[PickVariant(variants, Bucket("salt", fmt.Sprintf("anon_%06d", i)))]++
	}
	if share := float64(counts["new"]) / 20000; share < 0.48 || share > 0.52 {
		t.Fatalf("50/50 分组偏差过大: new 占 %.3f", share)
	}
}

func TestPickVariantFallsBackToControl(t *testing.T) {
	zero := []domain.Variant{{Key: "control", Weight: 0}, {Key: "new", Weight: 0}}
	if got := PickVariant(zero, 9999); got != "control" {
		t.Fatalf("权重全为 0 时应回退对照组, got %q", got)
	}
	allControl := []domain.Variant{{Key: "control", Weight: 100}, {Key: "new", Weight: 0}}
	for b := 0; b < bucketCount; b += 97 {
		if got := PickVariant(allControl, b); got != "control" {
			t.Fatalf("100/0 时 bucket %d 不应进入实验组", b)
		}
	}
}

func TestBucketDiffersBySalt(t *testing.T) {
	same := 0
	for i := 0; i < 1000; i++ {
		unit := fmt.Sprintf("anon_%06d", i)
		if (Bucket("a", unit) < 5000) == (Bucket("b", unit) < 5000) {
			same++
		}
	}
	if same < 400 || same > 600 {
		t.Fatalf("不同种子的分组应相互独立, 同组比例 %d/1000", same)
	}
}

func TestAssignmentIsStickyAndTracked(t *testing.T) {
	repo := newFakeRepo()
	repo.experiments["onboarding_v2"] = runningExperiment(domain.AudienceNewUsers)
	svc := newTestService(repo)

	first := assign(t, svc, "anon_sticky_01", "")
	if !first.Tracked {
		t.Fatalf("实验开始后的新访客应计入实验: %+v", first)
	}
	for i := 0; i < 3; i++ {
		if again := assign(t, svc, "anon_sticky_01", ""); again != first {
			t.Fatalf("同一访客分组发生变化: %+v -> %+v", first, again)
		}
	}
	if len(repo.assignments) != 1 {
		t.Fatalf("重复请求不应新增分组记录, got %d", len(repo.assignments))
	}
}

func TestVisitorSeenBeforeStartIsNotEnrolled(t *testing.T) {
	repo := newFakeRepo()
	repo.experiments["onboarding_v2"] = runningExperiment(domain.AudienceNewUsers)
	repo.visitors["anon_oldvisit"] = domain.Visitor{AnonID: "anon_oldvisit", FirstSeenAt: started.Add(-24 * time.Hour)}
	svc := newTestService(repo)

	got := assign(t, svc, "anon_oldvisit", "")
	if got.Tracked || got.Variant != "control" {
		t.Fatalf("实验开始前就来过的访客应走对照组且不计入: %+v", got)
	}
	if len(repo.assignments) != 0 {
		t.Fatal("不计入的访客不应写分组记录")
	}
}

func TestExistingAccountIsNotEnrolled(t *testing.T) {
	repo := newFakeRepo()
	repo.experiments["onboarding_v2"] = runningExperiment(domain.AudienceNewUsers)
	repo.users["user-old"] = started.Add(-30 * 24 * time.Hour)
	svc := newTestService(repo)

	got := assign(t, svc, "anon_olduser", "user-old")
	if got.Tracked || got.Variant != "control" || len(repo.assignments) != 0 {
		t.Fatalf("老用户应走对照组且不写记录: %+v, rows=%d", got, len(repo.assignments))
	}
}

func TestPreLoginAssignmentExcludedWhenAccountIsOld(t *testing.T) {
	repo := newFakeRepo()
	repo.experiments["onboarding_v2"] = runningExperiment(domain.AudienceNewUsers)
	repo.users["user-old"] = started.Add(-30 * 24 * time.Hour)
	svc := newTestService(repo)

	anon := findAnonInVariant(t, "pet_flow")
	if got := assign(t, svc, anon, ""); got.Variant != "pet_flow" || !got.Tracked {
		t.Fatalf("登录前应进入实验组: %+v", got)
	}
	got := assign(t, svc, anon, "user-old")
	if got.Tracked || got.Variant != "control" {
		t.Fatalf("登录后发现是老用户，应排除并回到对照组: %+v", got)
	}
	a := repo.assignments[0]
	if a.ExcludedReason == nil || *a.ExcludedReason != domain.ExcludedExistingUser || a.UserID == nil {
		t.Fatalf("分组记录应绑定账号并标记排除原因: %+v", a)
	}
}

func TestPreLoginAssignmentKeptForNewAccount(t *testing.T) {
	repo := newFakeRepo()
	repo.experiments["onboarding_v2"] = runningExperiment(domain.AudienceNewUsers)
	repo.users["user-new"] = t0
	svc := newTestService(repo)

	anon := findAnonInVariant(t, "pet_flow")
	assign(t, svc, anon, "")
	got := assign(t, svc, anon, "user-new")
	if got.Variant != "pet_flow" || !got.Tracked {
		t.Fatalf("新注册账号应保留登录前的分组: %+v", got)
	}
	// The same account on a second phone keeps its first variant.
	other := findAnonInVariant(t, "control")
	if got := assign(t, svc, other, "user-new"); got.Variant != "pet_flow" || !got.Tracked {
		t.Fatalf("同一账号换手机应沿用原分组: %+v", got)
	}
	if len(repo.assignments) != 1 {
		t.Fatalf("换手机不应新增分组记录, got %d", len(repo.assignments))
	}
}

func TestReinstallBeforeLoginIsCountedOnce(t *testing.T) {
	repo := newFakeRepo()
	repo.experiments["onboarding_v2"] = runningExperiment(domain.AudienceNewUsers)
	repo.users["user-new"] = t0
	svc := newTestService(repo)

	first := findAnonInVariant(t, "pet_flow")
	assign(t, svc, first, "")
	assign(t, svc, first, "user-new")

	// Reinstall: a fresh install id is enrolled before login...
	reinstall := findAnonInVariant(t, "control")
	if got := assign(t, svc, reinstall, ""); !got.Tracked {
		t.Fatalf("登录前看不出是老账号，应先正常分组: %+v", got)
	}
	// ...and retired once the account turns out to already be enrolled.
	got := assign(t, svc, reinstall, "user-new")
	if got.Variant != "pet_flow" || !got.Tracked {
		t.Fatalf("登录后应回到账号原来的分组: %+v", got)
	}
	var retired *domain.Assignment
	for i := range repo.assignments {
		if repo.assignments[i].AnonID == reinstall {
			retired = &repo.assignments[i]
		}
	}
	if retired == nil || retired.ExcludedReason == nil || *retired.ExcludedReason != domain.ExcludedDuplicateUnit {
		t.Fatalf("重装产生的分组应标记为重复设备: %+v", retired)
	}
}

func TestSecondAccountOnSharedPhoneIsUntracked(t *testing.T) {
	repo := newFakeRepo()
	repo.experiments["onboarding_v2"] = runningExperiment(domain.AudienceAll)
	svc := newTestService(repo)

	assign(t, svc, "anon_shared_1", "user-a")
	got := assign(t, svc, "anon_shared_1", "user-b")
	if got.Tracked {
		t.Fatalf("共用手机的第二个账号不应计入: %+v", got)
	}
}

func TestOverrideAndStoppedServeWithoutTracking(t *testing.T) {
	repo := newFakeRepo()
	e := runningExperiment(domain.AudienceAll)
	winner := "pet_flow"
	e.OverrideVariant = &winner
	repo.experiments[e.Key] = e
	svc := newTestService(repo)

	if got := assign(t, svc, "anon_override", ""); got.Variant != "pet_flow" || got.Tracked {
		t.Fatalf("强制分组应全员下发且不计入: %+v", got)
	}
	e.OverrideVariant = nil
	e.Status = domain.StatusStopped
	repo.experiments[e.Key] = e
	if got := assign(t, svc, "anon_stopped", ""); got.Variant != "control" || got.Tracked {
		t.Fatalf("已结束且无强制分组时应回到对照组: %+v", got)
	}
	if len(repo.assignments) != 0 {
		t.Fatal("强制分组或已结束时不应写分组记录")
	}
}

func TestDraftExperimentIsNotServed(t *testing.T) {
	repo := newFakeRepo()
	e := runningExperiment(domain.AudienceAll)
	e.Status = domain.StatusDraft
	repo.experiments[e.Key] = e
	svc := newTestService(repo)

	out, err := svc.Assignments(context.Background(), AssignInput{AnonID: "anon_draft_01"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := out[e.Key]; ok {
		t.Fatal("草稿实验不应下发")
	}
}

func TestAssignmentsRejectsBadAnonID(t *testing.T) {
	svc := newTestService(newFakeRepo())
	for _, id := range []string{"", "short", "has space in it", strings.Repeat("a", 129)} {
		if _, err := svc.Assignments(context.Background(), AssignInput{AnonID: id}); err == nil {
			t.Fatalf("访客标识 %q 应被拒绝", id)
		}
	}
}

func TestSaveStampsStartAndLocksSplit(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(repo)
	ctx := context.Background()
	in := SaveInput{
		Status:   domain.StatusDraft,
		Audience: domain.AudienceNewUsers,
		Variants: []domain.Variant{{Key: "control", Weight: 50}, {Key: "pet_flow", Weight: 50}},
	}
	saved, err := svc.Save(ctx, "onboarding_v2", in)
	if err != nil {
		t.Fatal(err)
	}
	if saved.StartedAt != nil || saved.Salt != "onboarding_v2" {
		t.Fatalf("草稿不应有开始时间，种子默认取实验标识: %+v", saved)
	}

	in.Status = domain.StatusRunning
	saved, err = svc.Save(ctx, "onboarding_v2", in)
	if err != nil || saved.StartedAt == nil || !saved.StartedAt.Equal(t0) {
		t.Fatalf("开始实验应记录开始时间: %+v, err=%v", saved, err)
	}

	weights := in
	weights.Variants = []domain.Variant{{Key: "control", Weight: 90}, {Key: "pet_flow", Weight: 10}}
	if _, err := svc.Save(ctx, "onboarding_v2", weights); err != nil {
		t.Fatalf("开始后应允许调整权重: %v", err)
	}

	audience := in
	audience.Audience = domain.AudienceAll
	if _, err := svc.Save(ctx, "onboarding_v2", audience); err == nil {
		t.Fatal("开始后不应允许修改实验人群")
	}

	reorder := in
	reorder.Variants = []domain.Variant{{Key: "pet_flow", Weight: 50}, {Key: "control", Weight: 50}}
	if _, err := svc.Save(ctx, "onboarding_v2", reorder); err == nil {
		t.Fatal("开始后不应允许重排分组")
	}
	resalt := in
	resalt.Salt = "other"
	if _, err := svc.Save(ctx, "onboarding_v2", resalt); err == nil {
		t.Fatal("开始后不应允许修改种子")
	}

	in.Status = domain.StatusStopped
	saved, err = svc.Save(ctx, "onboarding_v2", in)
	if err != nil || saved.EndedAt == nil {
		t.Fatalf("结束实验应记录结束时间: %+v, err=%v", saved, err)
	}
	in.Status = domain.StatusRunning
	if _, err := svc.Save(ctx, "onboarding_v2", in); err == nil {
		t.Fatal("已结束的实验不应重新开始")
	}
}

func TestSaveRejectsInvalidDefinitions(t *testing.T) {
	svc := newTestService(newFakeRepo())
	base := SaveInput{
		Status:   domain.StatusDraft,
		Audience: domain.AudienceAll,
		Variants: []domain.Variant{{Key: "control", Weight: 50}, {Key: "b", Weight: 50}},
	}
	missing := "nope"
	cases := map[string]func(SaveInput) (string, SaveInput){
		"bad key":     func(in SaveInput) (string, SaveInput) { return "Bad-Key", in },
		"one variant": func(in SaveInput) (string, SaveInput) { in.Variants = in.Variants[:1]; return "exp_one", in },
		"dup variant": func(in SaveInput) (string, SaveInput) {
			in.Variants = []domain.Variant{{Key: "a", Weight: 1}, {Key: "a", Weight: 1}}
			return "exp_dup", in
		},
		"zero weights": func(in SaveInput) (string, SaveInput) {
			in.Variants = []domain.Variant{{Key: "a"}, {Key: "b"}}
			return "exp_zero", in
		},
		"bad status":   func(in SaveInput) (string, SaveInput) { in.Status = "paused"; return "exp_status", in },
		"bad override": func(in SaveInput) (string, SaveInput) { in.OverrideVariant = &missing; return "exp_override", in },
		"bad audience": func(in SaveInput) (string, SaveInput) { in.Audience = "vip"; return "exp_audience", in },
		"heavy weight": func(in SaveInput) (string, SaveInput) {
			in.Variants = []domain.Variant{{Key: "a", Weight: 101}, {Key: "b", Weight: 1}}
			return "exp_heavy", in
		},
	}
	for name, mutate := range cases {
		key, in := mutate(base)
		if _, err := svc.Save(context.Background(), key, in); err == nil {
			t.Fatalf("%s: 应被拒绝", name)
		}
	}
}

func TestTrackValidatesBatches(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(repo)
	ctx := context.Background()

	res, err := svc.Track(ctx, "anon_events_1", "", []EventInput{
		{Name: "welcome_view", ClientTS: t0.UnixMilli()},
		{Name: "persona_pick", Props: map[string]any{"persona": "student"}, ClientTS: 1},
		{Name: "Bad Name"},
		{Name: "big_props", Props: map[string]any{"blob": strings.Repeat("x", maxEventPropsBytes)}},
		{Name: "srv.onboarding_try"},
	})
	if err != nil || res.Recorded != 2 || res.Rejected != 3 {
		t.Fatalf("合法事件应写入、不合规事件单独丢弃: %+v err=%v", res, err)
	}
	if repo.events[0].ClientAt == nil || repo.events[1].ClientAt != nil {
		t.Fatalf("应只保留可信的客户端时间: %+v", repo.events)
	}
	if repo.events[1].Props["persona"] != "student" || repo.events[0].Props == nil {
		t.Fatalf("事件属性未正确保存: %+v", repo.events)
	}

	tooMany := make([]EventInput, maxEventsPerBatch+1)
	for i := range tooMany {
		tooMany[i] = EventInput{Name: "x_view"}
	}
	bad := map[string][]EventInput{
		"empty":    nil,
		"too many": tooMany,
	}
	for name, events := range bad {
		if _, err := svc.Track(ctx, "anon_events_1", "", events); err == nil {
			t.Fatalf("%s: 应被拒绝", name)
		}
	}
}

func TestExposeValidatesKeys(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(repo)
	ctx := context.Background()
	if _, err := svc.Expose(ctx, "anon_expose_1", "", []string{"onboarding_v2"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Expose(ctx, "anon_expose_1", "", nil); err == nil {
		t.Fatal("空实验列表应被拒绝")
	}
	if _, err := svc.Expose(ctx, "anon_expose_1", "", []string{"BAD"}); err == nil {
		t.Fatal("非法实验标识应被拒绝")
	}
}

// findAnonInVariant returns an anon id that hashes into the wanted arm of the
// 50/50 onboarding_v2 split, so tests do not depend on a lucky id.
func findAnonInVariant(t *testing.T, variant string) string {
	t.Helper()
	variants := runningExperiment(domain.AudienceAll).Variants
	for i := 0; i < 1000; i++ {
		id := fmt.Sprintf("anon_find_%04d", i)
		if PickVariant(variants, Bucket("onboarding_v2", id)) == variant {
			return id
		}
	}
	t.Fatalf("找不到落在 %s 的访客标识", variant)
	return ""
}
