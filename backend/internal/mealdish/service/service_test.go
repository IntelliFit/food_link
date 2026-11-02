package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"food_link/backend/internal/mealdish/domain"
	"food_link/backend/internal/mealdish/repo"
	"food_link/backend/internal/migration"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/storage"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type fakeGeocoder struct{ address string }

func (f fakeGeocoder) ReverseGeocode(context.Context, float64, float64) (map[string]any, error) {
	return map[string]any{"result": map[string]any{"formatted_address": f.address}}, nil
}

type fakeContributor struct{ calls []string }

func (f *fakeContributor) ContributeDishPhoto(_ context.Context, _, itemID string, paths []string) error {
	f.calls = append(f.calls, itemID+"|"+paths[0])
	return nil
}

type fakeRewards struct{ calls int }

func (f *fakeRewards) AwardPublicFoodUpload(context.Context, string, string, map[string]any) (map[string]any, error) {
	f.calls++
	return map[string]any{"awarded": f.calls == 1, "reward_task": map[string]any{"reward_credits": 1}}, nil
}

type fakePublication struct{ docs []map[string]any }

func (f *fakePublication) CheckPublication(_ context.Context, _ string, _ int, doc map[string]any, _ *storage.Client) error {
	f.docs = append(f.docs, doc)
	return nil
}

type fakePrices struct{ calls []string }

func (f *fakePrices) ApplyAgreedPrice(_ context.Context, userID, itemID string, price float64, _ time.Time) error {
	f.calls = append(f.calls, fmt.Sprintf("%s|%s|%.2f", userID, itemID, price))
	return nil
}

type fixture struct {
	db          *gorm.DB
	svc         *Service
	prices      *fakePrices
	contributor *fakeContributor
	rewards     *fakeRewards
	publication *fakePublication
	user        string
	zijing      string
	taoli       string
	shaomai     string
	xiehuang    string
	feiniu      string
}

const zijingLat, zijingLng = 40.0106, 116.3255

func newFixture(t *testing.T) *fixture {
	t.Helper()
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.SchoolDO{}, &migrationdo.SchoolCampusDO{}, &migrationdo.SchoolCanteenDO{},
		&migrationdo.PublicFoodItemDO{}, &migrationdo.CampusFoodCatalogItemDO{}, &migrationdo.AnalysisTaskDO{},
		&migrationdo.UserDO{}, &migrationdo.FoodRecordDO{}, &migrationdo.CanteenCaptureSessionDO{}))
	require.NoError(t, migration.MigrateMealDishTables(context.Background(), db))
	f := &fixture{db: db, prices: &fakePrices{}, contributor: &fakeContributor{}, rewards: &fakeRewards{}, publication: &fakePublication{}, user: uuid.NewString(),
		zijing: uuid.NewString(), taoli: uuid.NewString(), shaomai: uuid.NewString(), xiehuang: uuid.NewString(), feiniu: uuid.NewString()}
	school, campus := uuid.NewString(), uuid.NewString()
	exec := func(sql string, args ...any) { require.NoError(t, db.Exec(sql, args...).Error) }
	exec(`INSERT INTO schools (id, name, status, location_type) VALUES (?, '清华大学', 'active', 'university')`, school)
	exec(`INSERT INTO school_campuses (id, school_id, name, status) VALUES (?, ?, '主校区', 'active')`, campus, school)
	exec(`INSERT INTO school_canteens (id, school_id, campus_id, name, status, latitude, longitude) VALUES (?, ?, ?, '紫荆园', 'active', ?, ?)`, f.zijing, school, campus, zijingLat, zijingLng)
	exec(`INSERT INTO school_canteens (id, school_id, campus_id, name, status) VALUES (?, ?, ?, '桃李园', 'active')`, f.taoli, school, campus)
	dish := func(id, name, window string, price float64, image string) {
		exec(`INSERT INTO public_food_library (id, food_name, canteen_id, window_name, price, price_type, status, image_path, image_paths)
VALUES (?, ?, ?, ?, ?, 'fixed', 'published', NULLIF(?, ''), '[]')`, id, name, f.zijing, window, price, image)
	}
	dish(f.shaomai, "手工虾仁烧麦", "上海风味", 15, "")
	dish(f.xiehuang, "蟹黄包", "上海风味", 13, "")
	dish(f.feiniu, "肥牛粉丝汤", "上海风味", 12, "campus-food/feiniu.jpg")
	dish(uuid.NewString(), "柠檬酸汤鱼", "东南亚风味", 14, "")
	f.svc = New(Deps{Repo: repo.New(db), Geocoder: fakeGeocoder{address: "北京市海淀区清华大学紫荆园"},
		Contributor: f.contributor, Rewards: f.rewards, Publication: f.publication, Prices: f.prices})
	return f
}

func (f *fixture) task(t *testing.T, status, recognized string) string {
	t.Helper()
	id := uuid.NewString()
	result := `{}`
	if recognized != "" {
		result = `{"items":[{"name":"` + recognized + `"}]}`
	}
	require.NoError(t, f.db.Exec(`INSERT INTO analysis_tasks (id, user_id, task_type, status, image_paths, result) VALUES (?, ?, 'food', ?, '["food/analyze/me.jpg"]', ?)`,
		id, f.user, status, result).Error)
	return id
}

func ptr[T any](v T) *T { return &v }

func TestPromptFlowFromLocationToContributedPhoto(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	taskID := f.task(t, "processing", "")

	view, err := f.svc.StartPrompt(ctx, f.user, StartInput{TaskID: taskID, Latitude: ptr(zijingLat + 0.0003), Longitude: ptr(zijingLng)})
	require.NoError(t, err)
	require.True(t, view.Eligible)
	require.Equal(t, f.zijing, view.Canteens[0].ID)
	require.Equal(t, domain.ReasonNearby, view.Canteens[0].Reason)
	require.NotNil(t, view.Canteens[0].DistanceM)
	require.Contains(t, view.Canteens[0].ReasonText, "定位")
	require.Equal(t, domain.LocationGranted, view.Prompt.LocationStatus)
	again, err := f.svc.StartPrompt(ctx, f.user, StartInput{TaskID: taskID})
	require.NoError(t, err)
	require.Equal(t, view.Prompt.ID, again.Prompt.ID, "one prompt per task")

	view, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepCanteen, CanteenID: f.zijing,
		Latitude: ptr(zijingLat + 0.0002), Longitude: ptr(zijingLng), AccuracyM: ptr(25.0)})
	require.NoError(t, err)
	require.Equal(t, 0, *view.Prompt.CanteenRank)
	var samples int64
	require.NoError(t, f.db.Model(&domain.LocationSample{}).Count(&samples).Error)
	require.Equal(t, int64(1), samples, "a confirmed canteen leaves one anonymous sample")

	dishes, err := f.svc.CanteenDishes(ctx, f.user, f.zijing, taskID)
	require.NoError(t, err)
	require.False(t, dishes.RecognitionReady)
	require.Equal(t, f.feiniu, dishes.Dishes[0].ID, "before recognition, dishes with real photos lead")
	require.Equal(t, "上海风味", dishes.Windows[0].Name)

	require.NoError(t, f.db.Exec(`UPDATE analysis_tasks SET status = 'done', result = '{"items":[{"name":"烧麦"}]}' WHERE id = ?`, taskID).Error)
	dishes, err = f.svc.CanteenDishes(ctx, f.user, f.zijing, taskID)
	require.NoError(t, err)
	require.True(t, dishes.RecognitionReady)
	require.Equal(t, f.shaomai, dishes.Dishes[0].ID)
	require.Equal(t, f.shaomai, dishes.BestDishID)
	require.Equal(t, "15元", dishes.Dishes[0].PriceText)

	suggested := []string{dishes.Dishes[0].ID, dishes.Dishes[1].ID}
	view, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepDish, ItemID: f.shaomai, SuggestedItemIDs: suggested})
	require.NoError(t, err)
	require.Equal(t, domain.GapPhoto, view.Prompt.GapKind, "a dish without a real photo asks for the user's")
	require.Equal(t, 0, *view.Prompt.ItemRank)
	require.Equal(t, 0, *view.Prompt.RecognitionRank)
	require.Equal(t, "手工虾仁烧麦", view.ChosenDish.Name)

	view, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepPhoto, PhotoConsent: ptr(true)})
	require.NoError(t, err)
	require.NotNil(t, view.Prompt.PhotoContributedAt)
	require.Equal(t, 1, view.Prompt.RewardCredits)
	require.Equal(t, []string{f.shaomai + "|food/analyze/me.jpg"}, f.contributor.calls)
	require.Len(t, f.publication.docs, 1, "the photo passes the content check first")

	view, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepPhoto, PhotoConsent: ptr(true)})
	require.NoError(t, err)
	require.Len(t, f.contributor.calls, 1, "a repeated consent does not upload twice")

	result, err := f.svc.PromptForTask(ctx, f.user, taskID)
	require.NoError(t, err)
	require.Equal(t, "手工虾仁烧麦", result.ChosenDish.Name)
	require.Equal(t, "紫荆园", result.ChosenCanteen.Name)
}

func TestPromptNotShownWithoutAnyCanteenSignal(t *testing.T) {
	f := newFixture(t)
	view, err := f.svc.StartPrompt(context.Background(), f.user, StartInput{TaskID: f.task(t, "processing", ""), LocationStatus: domain.LocationDenied})
	require.NoError(t, err)
	require.False(t, view.Eligible)
	var prompts int64
	require.NoError(t, f.db.Model(&domain.Prompt{}).Count(&prompts).Error)
	require.Zero(t, prompts)

	forced, err := f.svc.StartPrompt(context.Background(), f.user, StartInput{TaskID: f.task(t, "processing", ""), Force: true})
	require.NoError(t, err)
	require.True(t, forced.Eligible, "the user can still pick a canteen from the directory")
	require.Empty(t, forced.Canteens)
	picked, err := f.svc.Answer(context.Background(), f.user, forced.Prompt.ID, AnswerInput{Step: domain.StepCanteen, CanteenID: f.zijing})
	require.NoError(t, err)
	require.Equal(t, -1, *picked.Prompt.CanteenRank, "a canteen picked outside the suggestions ranks -1")

	missing, err := f.svc.Answer(context.Background(), f.user, forced.Prompt.ID, AnswerInput{Step: domain.StepSkip, NotListed: true})
	require.NoError(t, err)
	require.Equal(t, domain.StepDish, missing.Prompt.SkipStep)
	require.Equal(t, domain.GapMenu, missing.Prompt.GapKind, "a dish missing from the menu is counted as a menu gap")
}

func TestRecentCanteenAndResultFallbackCandidates(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	first := f.task(t, "processing", "")
	view, err := f.svc.StartPrompt(ctx, f.user, StartInput{TaskID: first, Latitude: ptr(zijingLat), Longitude: ptr(zijingLng)})
	require.NoError(t, err)
	_, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepCanteen, CanteenID: f.zijing})
	require.NoError(t, err)

	second := f.task(t, "done", "蟹黄包")
	view, err = f.svc.StartPrompt(ctx, f.user, StartInput{TaskID: second, Surface: domain.SurfaceResult})
	require.NoError(t, err)
	require.True(t, view.Eligible, "a canteen confirmed before is suggested without location")
	require.Equal(t, domain.ReasonRecent, view.Canteens[0].Reason)
	require.Equal(t, "最近来过 1 次", view.Canteens[0].ReasonText)
	require.Equal(t, domain.SurfaceResult, view.Prompt.Surface)

	result, err := f.svc.PromptForTask(ctx, f.user, second)
	require.NoError(t, err)
	require.Len(t, result.Candidates, 3)
	require.Equal(t, f.xiehuang, result.Candidates[0].ID, "the result page offers what recognition saw first")

	skipped, err := f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepSkip, Surface: domain.SurfaceResult})
	require.NoError(t, err)
	require.NotNil(t, skipped.Prompt.SkippedAt)
	require.Equal(t, domain.StepCanteen, skipped.Prompt.SkipStep)
	require.Empty(t, skipped.Candidates, "after skipping, the result page stops asking")
}

func TestLearnedCoordinatesLocateCanteenWithoutDirectoryPosition(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	near, err := repo.New(f.db).CanteensNear(ctx, 40.0200, 116.3300, 300, 3)
	require.NoError(t, err)
	require.Empty(t, near)
	for _, lat := range []float64{40.0201, 40.0199} {
		require.NoError(t, f.db.Create(&domain.LocationSample{ID: uuid.NewString(), CanteenID: f.taoli, Latitude: lat, Longitude: 116.3300}).Error)
	}
	near, err = repo.New(f.db).CanteensNear(ctx, 40.0200, 116.3300, 300, 3)
	require.NoError(t, err)
	require.Len(t, near, 1)
	require.Equal(t, f.taoli, near[0].ID)
}

func TestSchoolFromAddressSuggestsCanteensWithMenus(t *testing.T) {
	f := newFixture(t)
	// Far from 紫荆园's coordinates, but the address names the university.
	view, err := f.svc.StartPrompt(context.Background(), f.user, StartInput{TaskID: f.task(t, "processing", ""), Latitude: ptr(40.03), Longitude: ptr(116.35)})
	require.NoError(t, err)
	require.True(t, view.Eligible)
	require.Equal(t, f.zijing, view.Canteens[0].ID)
	require.Equal(t, domain.ReasonSchool, view.Canteens[0].Reason)
	for _, canteen := range view.Canteens {
		require.NotEqual(t, f.taoli, canteen.ID, "a canteen with no dishes is not suggested from the address alone")
	}
}
