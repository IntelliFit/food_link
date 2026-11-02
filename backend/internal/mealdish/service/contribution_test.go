package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/mealdish/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// makeActive registers the user ten days ago and logs a meal on each of the
// last seven days.
func (f *fixture) makeActive(t *testing.T, userID string) {
	t.Helper()
	require.NoError(t, f.db.Exec(`INSERT INTO weapp_user (id, openid, create_time) VALUES (?, ?, now() - interval '10 days')`,
		userID, "openid-"+userID).Error)
	for day := 0; day < 7; day++ {
		require.NoError(t, f.db.Exec(`INSERT INTO user_food_records (id, user_id, meal_type, created_at) VALUES (?, ?, 'lunch', now() - make_interval(days => ?))`,
			uuid.NewString(), userID, day).Error)
	}
}

func (f *fixture) taskFor(t *testing.T, userID, status string) string {
	t.Helper()
	id := uuid.NewString()
	require.NoError(t, f.db.Exec(`INSERT INTO analysis_tasks (id, user_id, task_type, status, image_paths, result) VALUES (?, ?, 'food', ?, '["food/analyze/me.jpg"]', '{}')`,
		id, userID, status).Error)
	return id
}

// stalePricedCatalogDish makes 肥牛粉丝汤 (12 元, real photo) a catalog dish
// whose price was set three months ago.
func (f *fixture) stalePricedCatalogDish(t *testing.T) {
	t.Helper()
	require.NoError(t, f.db.Exec(`INSERT INTO campus_food_catalog_items (id, batch_id, organization_name, canteen_name, image_kind) VALUES (?, ?, '清华大学', '紫荆园', 'dish')`,
		f.feiniu, uuid.NewString()).Error)
	require.NoError(t, f.db.Exec(`UPDATE public_food_library SET created_at = now() - interval '90 days' WHERE id = ?`, f.feiniu).Error)
}

func TestRecommendedDishIsOneTapAnswer(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	ignored, err := f.svc.StartPrompt(ctx, f.user, StartInput{TaskID: f.task(t, "processing", ""), RecommendedItemID: uuid.NewString()})
	require.NoError(t, err)
	require.False(t, ignored.Eligible, "an unknown recommended dish is not a canteen signal")

	view, err := f.svc.StartPrompt(ctx, f.user, StartInput{TaskID: f.task(t, "processing", ""),
		RecommendedItemID: f.shaomai, RecommendedKind: domain.RecommendedNavigated})
	require.NoError(t, err)
	require.True(t, view.Eligible, "the home recommendation alone is enough to ask, without location")
	require.Equal(t, f.zijing, view.Canteens[0].ID)
	require.Equal(t, domain.ReasonRecommended, view.Canteens[0].Reason)
	require.Equal(t, "首页推荐 · 你导航过", view.Canteens[0].ReasonText)
	require.Equal(t, "手工虾仁烧麦", view.RecommendedDish.Name)
	require.Equal(t, "紫荆园", view.RecommendedDish.CanteenName)
	require.Equal(t, domain.RecommendedNavigated, view.Prompt.RecommendedKind)
	require.Equal(t, f.shaomai, *view.Prompt.RecommendedItemID)

	confirmed, err := f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepDish, ItemID: f.shaomai, SuggestedItemIDs: []string{f.shaomai}})
	require.NoError(t, err)
	require.Equal(t, 0, *confirmed.Prompt.ItemRank)
	require.Equal(t, 0, *confirmed.Prompt.CanteenRank, "confirming the dish also confirms its canteen")
	require.Nil(t, confirmed.RecommendedDish, "once a dish is chosen the one-tap offer goes away")
}

func TestActiveUserIsAskedThePriceAndTwoAgreeingAnswersWriteItBack(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.stalePricedCatalogDish(t)
	second := uuid.NewString()
	f.makeActive(t, f.user)
	f.makeActive(t, second)

	answerDish := func(userID string) *PromptView {
		view, err := f.svc.StartPrompt(ctx, userID, StartInput{TaskID: f.taskFor(t, userID, "processing"), RecommendedItemID: f.feiniu})
		require.NoError(t, err)
		require.Equal(t, domain.CohortActive, view.Prompt.Cohort)
		view, err = f.svc.Answer(ctx, userID, view.Prompt.ID, AnswerInput{Step: domain.StepDish, ItemID: f.feiniu, SuggestedItemIDs: []string{f.feiniu}})
		require.NoError(t, err)
		return view
	}

	first := answerDish(f.user)
	require.Equal(t, domain.GapNone, first.Prompt.GapKind, "the dish has a real photo, so no photo question")
	require.NotNil(t, first.Prompt.PriceAskedAt)
	require.Equal(t, 12.0, *first.PriceAsk.CurrentPrice)
	require.Equal(t, "12元", first.PriceAsk.PriceText)

	answered, err := f.svc.Answer(ctx, f.user, first.Prompt.ID, AnswerInput{Step: domain.StepPrice, PriceKind: domain.PriceChanged, Price: ptr(14.0)})
	require.NoError(t, err)
	require.Equal(t, domain.PriceChanged, answered.Prompt.PriceAnswerKind)
	require.Equal(t, 14.0, *answered.Prompt.PriceAnswer)
	require.Nil(t, answered.PriceAsk)
	require.Empty(t, f.prices.calls, "one user's answer never changes the catalog")

	again := answerDish(f.user)
	require.Nil(t, again.Prompt.PriceAskedAt, "at most one price question a day")

	other := answerDish(second)
	agreed, err := f.svc.Answer(ctx, second, other.Prompt.ID, AnswerInput{Step: domain.StepPrice, PriceKind: domain.PriceChanged, Price: ptr(14.0)})
	require.NoError(t, err)
	require.Equal(t, []string{second + "|" + f.feiniu + "|14.00"}, f.prices.calls, "two users agreeing writes the price back")
	require.NotNil(t, agreed.Prompt.PriceAppliedAt)
}

func TestPriceQuestionOnlyForActiveUsersAndNeverWithThePhotoQuestion(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.stalePricedCatalogDish(t)

	view, err := f.svc.StartPrompt(ctx, f.user, StartInput{TaskID: f.task(t, "processing", ""), RecommendedItemID: f.feiniu})
	require.NoError(t, err)
	require.Equal(t, domain.CohortRegular, view.Prompt.Cohort, "a user with no history is regular")
	view, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepDish, ItemID: f.feiniu})
	require.NoError(t, err)
	require.Nil(t, view.Prompt.PriceAskedAt)

	active := uuid.NewString()
	f.makeActive(t, active)
	view, err = f.svc.StartPrompt(ctx, active, StartInput{TaskID: f.taskFor(t, active, "processing"), RecommendedItemID: f.shaomai})
	require.NoError(t, err)
	view, err = f.svc.Answer(ctx, active, view.Prompt.ID, AnswerInput{Step: domain.StepDish, ItemID: f.shaomai})
	require.NoError(t, err)
	require.Equal(t, domain.GapPhoto, view.Prompt.GapKind)
	require.Nil(t, view.Prompt.PriceAskedAt, "one extra question per meal: the photo goes first")

	_, err = f.svc.Answer(ctx, active, view.Prompt.ID, AnswerInput{Step: domain.StepPrice, PriceKind: domain.PriceSame})
	require.Error(t, err, "a price answer without a price question is refused")
}

func TestSkippingThePriceKeepsTheLink(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.stalePricedCatalogDish(t)
	f.makeActive(t, f.user)
	view, err := f.svc.StartPrompt(ctx, f.user, StartInput{TaskID: f.task(t, "processing", ""), RecommendedItemID: f.feiniu})
	require.NoError(t, err)
	view, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepDish, ItemID: f.feiniu})
	require.NoError(t, err)
	require.Equal(t, domain.StepPrice, currentStep(view.Prompt))

	view, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepPrice, PriceKind: domain.PriceSkipped})
	require.NoError(t, err)
	require.Equal(t, domain.PriceSkipped, view.Prompt.PriceAnswerKind)
	require.Nil(t, view.Prompt.SkippedAt, "skipping the price does not undo the dish link")
	require.Equal(t, "肥牛粉丝汤", view.ChosenDish.Name)
	require.WithinDuration(t, time.Now(), *view.Prompt.PriceAnsweredAt, time.Minute)
}
