package service

import (
	"context"
	"strings"
	"testing"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/campuscatalog/domain"
	campusrepo "food_link/backend/internal/campuscatalog/repo"
	"food_link/backend/internal/migration"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// fakeCaptureVision answers per photo: the fake upload puts the photo content
// into the object key, and the response is chosen by that marker.
type fakeCaptureVision struct {
	byMarker map[string]map[string]any
	model    string
}

func (f fakeCaptureVision) AnalyzeWithImagesAndTemperatureMeta(_ context.Context, _ string, urls []string, _ float64) (map[string]any, map[string]any, error) {
	for marker, response := range f.byMarker {
		if len(urls) == 1 && strings.Contains(urls[0], marker) {
			return response, map[string]any{"model": f.model}, nil
		}
	}
	return map[string]any{"images": []any{}, "items": []any{}}, map[string]any{"model": f.model}, nil
}

type fakeCaptureTasks struct{ created []*analyzedomain.AnalysisTask }

func (f *fakeCaptureTasks) CreateTask(_ context.Context, task *analyzedomain.AnalysisTask) error {
	f.created = append(f.created, task)
	return nil
}

func (f *fakeCaptureTasks) FailTask(context.Context, string, string) (bool, error) { return true, nil }

func (f *fakeCaptureTasks) CompleteTask(context.Context, string, map[string]any) (bool, error) {
	return true, nil
}

type fakeCaptureQueue struct{ published []taskqueue.TaskMessage }

func (f *fakeCaptureQueue) PublishTask(_ context.Context, msg taskqueue.TaskMessage) error {
	f.published = append(f.published, msg)
	return nil
}

type fakeCaptureMembership struct{ grants []string }

func (f *fakeCaptureMembership) GrantCaptureMembership(_ context.Context, userID, sourceKey, planCode string, days int, _ map[string]any) error {
	f.grants = append(f.grants, userID+"|"+sourceKey+"|"+planCode)
	return nil
}

func captureLines(lines ...string) []any {
	out := make([]any, 0, len(lines))
	for _, line := range lines {
		out = append(out, line)
	}
	return out
}

// Photo A (content "...-1"/"menu-a") shows three lines, photo B ("...-2"/
// "menu-b") two more. The primary also invents 蟹黄包 on B, which the verifier
// never lists, so it must end up in the exception queue.
func shanghaiMenuVision() *CaptureExtractor {
	item := func(name string, price float64) map[string]any {
		return map[string]any{"image_index": 0, "image": 0, "name": name, "prices": []any{price}, "kind": "dish", "type": "dish"}
	}
	image := func(lines ...string) []any {
		return []any{map[string]any{"index": 0, "is_menu": true, "readable": true, "lines": captureLines(lines...)}}
	}
	linesA := image("老上海大馄饨 9元", "生煎包 2.5元", "手工虾仁烧麦 15元")
	linesB := image("手工虾仁烧麦15元", "肥牛粉丝汤12元")
	primaryA := map[string]any{"images": linesA, "items": []any{item("老上海大馄饨", 9), item("生煎包", 2.5), item("手工虾仁烧麦", 15)}}
	primaryB := map[string]any{"images": linesB, "items": []any{item("手工虾仁烧麦", 15), item("肥牛粉丝汤", 12), item("蟹黄包", 13)}}
	verifierA := map[string]any{"images": linesA, "entries": []any{item("老上海大馄饨", 9), item("生煎包", 2.5), item("手工虾仁烧麦", 15)}}
	verifierB := map[string]any{"images": linesB, "entries": []any{item("手工虾仁烧麦", 15), item("肥牛粉丝汤", 12)}}
	byMarker := func(a, b map[string]any) map[string]map[string]any {
		return map[string]map[string]any{"-menu-photo-1": a, "-menu-a": a, "-menu-photo-2": b, "-menu-b": b}
	}
	return NewCaptureExtractor(fakeCaptureVision{byMarker: byMarker(primaryA, primaryB), model: "primary"},
		fakeCaptureVision{byMarker: byMarker(verifierA, verifierB), model: "verifier"})
}

type captureHarness struct {
	db         *gorm.DB
	svc        *CatalogService
	tasks      *fakeCaptureTasks
	membership *fakeCaptureMembership
}

func newCaptureHarness(t *testing.T) *captureHarness {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.CampusFoodCollectionBatchDO{}, &migrationdo.CampusFoodCatalogItemDO{},
		&migrationdo.CampusFoodRevisionDO{}, &migrationdo.PublicFoodItemDO{}))
	require.NoError(t, migration.MigrateCanteenCaptureTables(context.Background(), db))
	svc := NewCatalogService(campusrepo.NewCatalogRepo(db), nil)
	harness := &captureHarness{db: db, svc: svc, tasks: &fakeCaptureTasks{}, membership: &fakeCaptureMembership{}}
	svc.ConfigureCapture(CaptureDeps{
		Repo: campusrepo.NewCatalogRepo(db), Extractor: shanghaiMenuVision(), Tasks: harness.tasks, Queue: &fakeCaptureQueue{},
		Rules: CaptureRewardRules{WindowCents: 300, PhotoHalfCents: 100, PhotoFullCents: 200, WithdrawMinCents: 500,
			MembershipOptions: []CaptureMembershipOption{{Code: "m7", Title: "7天会员", PlanCode: "light_monthly", Days: 7, CostCents: 300}}},
		Membership: harness.membership,
		Upload: func(_ context.Context, _, prefix, _, _ string, data []byte) (string, error) {
			return prefix + "/" + uuid.NewString() + "-" + string(data) + ".jpg", nil
		},
	})
	return harness
}

func (h *captureHarness) openSession(t *testing.T, userID, window string) *CaptureSessionView {
	t.Helper()
	view, err := h.svc.CreateCaptureSession(context.Background(), userID, CaptureSessionInput{
		ClientSessionKey: uuid.NewString(), VenueType: "community", OrganizationName: "测试园区",
		CanteenName: "一食堂", Floor: "1楼", WindowName: window,
	})
	require.NoError(t, err)
	return view
}

func (h *captureHarness) upload(t *testing.T, userID, sessionID, kind, itemKey, dishName, content string) *domain.CaptureAsset {
	t.Helper()
	asset, err := h.svc.UploadCaptureAsset(context.Background(), userID, sessionID,
		CaptureAssetInput{Kind: kind, ItemKey: itemKey, DishName: dishName}, "a.jpg", "image/jpeg", []byte(content))
	require.NoError(t, err)
	return asset
}

func (h *captureHarness) extract(t *testing.T, userID, sessionID string) *CaptureSessionView {
	t.Helper()
	view, err := h.svc.StartCaptureExtraction(context.Background(), userID, sessionID)
	require.NoError(t, err)
	require.Equal(t, domain.CaptureStatusExtracting, view.Session.Status)
	task := h.tasks.created[len(h.tasks.created)-1]
	_, err = h.svc.ProcessCaptureExtractionTask(context.Background(), task.ID, task.Payload)
	require.NoError(t, err)
	view, err = h.svc.GetCaptureSession(context.Background(), userID, sessionID)
	require.NoError(t, err)
	return view
}

func captureItemByName(t *testing.T, items []CaptureItemView, name string) CaptureItemView {
	t.Helper()
	for _, item := range items {
		if item.Name == name {
			return item
		}
	}
	t.Fatalf("item %s missing", name)
	return CaptureItemView{}
}

func TestCaptureFlowPublishesPassedItemsAndRecordsWindowReward(t *testing.T) {
	h := newCaptureHarness(t)
	ctx := context.Background()
	userID := uuid.NewString()
	session := h.openSession(t, userID, "上海风味")

	first := h.upload(t, userID, session.Session.ID, "menu", "", "", "menu-photo-1")
	again := h.upload(t, userID, session.Session.ID, "menu", "", "", "menu-photo-1")
	require.Equal(t, first.ID, again.ID, "same photo twice must not create a second asset")
	h.upload(t, userID, session.Session.ID, "menu", "", "", "menu-photo-2")

	view := h.extract(t, userID, session.Session.ID)
	require.Equal(t, domain.CaptureStatusExtracted, view.Session.Status)
	require.Len(t, view.Items, 5, "the two 烧麦 lines merge")
	require.Equal(t, domain.CaptureItemException, captureItemByName(t, view.Items, "蟹黄包").Status)
	require.Equal(t, CaptureRewardEligible, view.Reward.Status)
	require.Equal(t, int64(300), view.Reward.AmountCents)

	shengjian := captureItemByName(t, view.Items, "生煎包")
	h.upload(t, userID, session.Session.ID, "dish", shengjian.Key, "", "dish-shengjian")
	h.upload(t, userID, session.Session.ID, "dish", "", "葱油拌面", "dish-congyou")

	submitted, err := h.svc.SubmitCaptureSession(ctx, userID, session.Session.ID)
	require.NoError(t, err)
	require.Equal(t, domain.CaptureStatusSubmitted, submitted.Session.Status)
	require.Equal(t, 5, submitted.Session.PublishedItemCount)
	require.Equal(t, 1, submitted.Session.ExceptionItemCount)
	require.Equal(t, domain.CaptureExceptionPending, submitted.Session.ExceptionStatus)
	require.Equal(t, CaptureRewardConfirmed, submitted.Reward.Status)
	require.Equal(t, int64(300), submitted.Reward.AmountCents, "2 of 6 items photographed earns no bonus")

	var items []domain.CatalogItem
	require.NoError(t, h.db.Where("source_channel = ?", captureSourceChannel).Find(&items).Error)
	require.Len(t, items, 5)
	byName := map[string]domain.CatalogItem{}
	for _, item := range items {
		byName[item.Name] = item
		require.Equal(t, "published", item.Status)
		require.Empty(t, item.PriceUnit, "a bare 元 must not become 元/份")
	}
	require.Equal(t, "dish", byName["生煎包"].EntryType)
	require.Len(t, byName["生煎包"].ImagePaths, 1)
	require.Equal(t, "menu_item", byName["老上海大馄饨"].EntryType)
	require.Empty(t, byName["老上海大馄饨"].ImagePaths, "menu photos are evidence, not dish photos")
	require.NotNil(t, byName["老上海大馄饨"].Price)
	require.Equal(t, 9.0, *byName["老上海大馄饨"].Price)
	var revision domain.Revision
	require.NoError(t, h.db.Where("catalog_item_id = ?", byName["老上海大馄饨"].ID).First(&revision).Error)
	require.NotEmpty(t, revision.EvidenceImagePaths, "menu photo kept as revision evidence")

	again2, err := h.svc.SubmitCaptureSession(ctx, userID, session.Session.ID)
	require.NoError(t, err)
	require.Equal(t, 5, again2.Session.PublishedItemCount)
	var count int64
	require.NoError(t, h.db.Model(&domain.CatalogItem{}).Where("source_channel = ?", captureSourceChannel).Count(&count).Error)
	require.Equal(t, int64(5), count, "re-submit must not duplicate items")
}

func TestCaptureFlowPaysEachWindowOnceAndRejectsReusedPhotos(t *testing.T) {
	h := newCaptureHarness(t)
	ctx := context.Background()
	alice, bob := uuid.NewString(), uuid.NewString()

	first := h.openSession(t, alice, "上海风味")
	h.upload(t, alice, first.Session.ID, "menu", "", "", "menu-a")
	h.extract(t, alice, first.Session.ID)
	_, err := h.svc.SubmitCaptureSession(ctx, alice, first.Session.ID)
	require.NoError(t, err)

	sameWindow := h.openSession(t, bob, "上海风味窗口")
	h.upload(t, bob, sameWindow.Session.ID, "menu", "", "", "menu-b")
	view := h.extract(t, bob, sameWindow.Session.ID)
	require.Equal(t, CaptureRewardWindowTaken, view.Reward.Status, "window key ignores the 窗口 suffix")
	view, err = h.svc.SubmitCaptureSession(ctx, bob, sameWindow.Session.ID)
	require.NoError(t, err)
	require.Equal(t, CaptureRewardWindowTaken, view.Reward.Status)
	require.Zero(t, view.Reward.AmountCents)

	reused := h.openSession(t, bob, "东南亚风味")
	h.upload(t, bob, reused.Session.ID, "menu", "", "", "menu-a")
	h.extract(t, bob, reused.Session.ID)
	view, err = h.svc.SubmitCaptureSession(ctx, bob, reused.Session.ID)
	require.NoError(t, err)
	require.Equal(t, CaptureRewardRejected, view.Reward.Status)

	windows, err := h.svc.ListCapturedWindows(ctx, "community", "", "测试园区", "一食堂")
	require.NoError(t, err)
	require.Len(t, windows, 2)
}

func TestCaptureEarningsRedeemOnceAndRespectBalance(t *testing.T) {
	h := newCaptureHarness(t)
	ctx := context.Background()
	userID := uuid.NewString()
	session := h.openSession(t, userID, "上海风味")
	h.upload(t, userID, session.Session.ID, "menu", "", "", "menu-a")
	h.extract(t, userID, session.Session.ID)
	_, err := h.svc.SubmitCaptureSession(ctx, userID, session.Session.ID)
	require.NoError(t, err)

	earnings, err := h.svc.GetCaptureEarnings(ctx, userID)
	require.NoError(t, err)
	require.Equal(t, int64(300), earnings.Totals.Available)

	_, err = h.svc.RequestCaptureWithdrawal(ctx, userID, 300, "w1")
	require.ErrorContains(t, err, "至少")

	earnings, err = h.svc.RedeemCaptureMembership(ctx, userID, "m7", "r1")
	require.NoError(t, err)
	require.Zero(t, earnings.Totals.Available)
	_, err = h.svc.RedeemCaptureMembership(ctx, userID, "m7", "r1")
	require.NoError(t, err, "a retried request is not charged twice")
	require.Len(t, h.membership.grants, 2, "grant is re-sent with the same source key, which the membership repo dedupes")
	require.Equal(t, h.membership.grants[0], h.membership.grants[1])
	_, err = h.svc.RedeemCaptureMembership(ctx, userID, "m7", "r2")
	require.ErrorContains(t, err, "不足")
}

func TestCaptureRewardIsPendingUntilAmountsArePublished(t *testing.T) {
	h := newCaptureHarness(t)
	h.svc.capture.rules = CaptureRewardRules{}
	ctx := context.Background()
	userID := uuid.NewString()
	session := h.openSession(t, userID, "上海风味")
	h.upload(t, userID, session.Session.ID, "menu", "", "", "menu-a")
	h.extract(t, userID, session.Session.ID)
	view, err := h.svc.SubmitCaptureSession(ctx, userID, session.Session.ID)
	require.NoError(t, err)
	require.Equal(t, CaptureRewardRatePending, view.Reward.Status)
	require.False(t, view.Reward.RatesPublished)

	h.svc.capture.rules = CaptureRewardRules{WindowCents: 250}
	released, err := h.svc.ReleaseRatePendingCaptureRewards(ctx, 100)
	require.NoError(t, err)
	require.Equal(t, 1, released)
	earnings, err := h.svc.GetCaptureEarnings(ctx, userID)
	require.NoError(t, err)
	require.Equal(t, int64(250), earnings.Totals.Available)
}

func TestCaptureExceptionsResolvedByLocalAgent(t *testing.T) {
	h := newCaptureHarness(t)
	ctx := context.Background()
	userID := uuid.NewString()
	session := h.openSession(t, userID, "上海风味")
	h.upload(t, userID, session.Session.ID, "menu", "", "", "menu-a")
	h.upload(t, userID, session.Session.ID, "menu", "", "", "menu-b")
	h.extract(t, userID, session.Session.ID)
	_, err := h.svc.SubmitCaptureSession(ctx, userID, session.Session.ID)
	require.NoError(t, err)

	cases, err := h.svc.ListCaptureExceptions(ctx, 10)
	require.NoError(t, err)
	require.Len(t, cases, 1)
	var key string
	for _, item := range cases[0].Session.Extraction.Items {
		if item.Status == domain.CaptureItemException {
			key = item.Key
		}
	}
	require.NotEmpty(t, key)

	result, err := h.svc.ResolveCaptureExceptions(ctx, session.Session.ID, "claude-local",
		[]CaptureResolution{{Key: key, Action: "publish", Prices: []float64{13}}})
	require.NoError(t, err)
	require.Equal(t, 1, result.Published)
	require.Equal(t, domain.CaptureExceptionResolved, result.ExceptionStatus)

	cases, err = h.svc.ListCaptureExceptions(ctx, 10)
	require.NoError(t, err)
	require.Empty(t, cases)
	var count int64
	require.NoError(t, h.db.Model(&domain.CatalogItem{}).Where("source_channel = ? AND name = ?", captureSourceChannel, "蟹黄包").Count(&count).Error)
	require.Equal(t, int64(1), count)
}

func TestRunCaptureExtractionNowProcessesTheSessionsTask(t *testing.T) {
	h := newCaptureHarness(t)
	ctx := context.Background()
	userID := uuid.NewString()
	session := h.openSession(t, userID, "上海风味")
	h.upload(t, userID, session.Session.ID, "menu", "", "", "menu-a")
	_, err := h.svc.StartCaptureExtraction(ctx, userID, session.Session.ID)
	require.NoError(t, err)

	result, err := h.svc.RunCaptureExtractionNow(ctx, session.Session.ID)
	require.NoError(t, err)
	require.Equal(t, 3, result["passed"])
	view, err := h.svc.GetCaptureSession(ctx, userID, session.Session.ID)
	require.NoError(t, err)
	require.Equal(t, domain.CaptureStatusExtracted, view.Session.Status)

	_, err = h.svc.RunCaptureExtractionNow(ctx, session.Session.ID)
	require.ErrorContains(t, err, "不在识别中")
}
