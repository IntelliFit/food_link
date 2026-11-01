package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/mealdish/domain"
	"food_link/backend/internal/mealdish/repo"
	migrationdo "food_link/backend/internal/migration/do"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestFunnelCountsWhatThePromptDid(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	require.NoError(t, f.db.AutoMigrate(&migrationdo.FoodRecordDO{}))
	record := func(taskID string) {
		require.NoError(t, f.db.Exec(`INSERT INTO user_food_records (id, user_id, meal_type, source_task_id) VALUES (?, ?, 'lunch', ?)`,
			uuid.NewString(), f.user, taskID).Error)
	}

	linked := f.task(t, "processing", "")
	view, err := f.svc.StartPrompt(ctx, f.user, StartInput{TaskID: linked, Latitude: ptr(zijingLat), Longitude: ptr(zijingLng)})
	require.NoError(t, err)
	_, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepCanteen, CanteenID: f.zijing,
		Latitude: ptr(zijingLat), Longitude: ptr(zijingLng), AccuracyM: ptr(20.0)})
	require.NoError(t, err)
	require.NoError(t, f.db.Exec(`UPDATE analysis_tasks SET status = 'done', result = '{"items":[{"name":"烧麦"}]}' WHERE id = ?`, linked).Error)
	_, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepDish, ItemID: f.shaomai, SuggestedItemIDs: []string{f.shaomai}})
	require.NoError(t, err)
	_, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepPhoto, PhotoConsent: ptr(true)})
	require.NoError(t, err)
	record(linked)

	skipped := f.task(t, "done", "蟹黄包")
	view, err = f.svc.StartPrompt(ctx, f.user, StartInput{TaskID: skipped})
	require.NoError(t, err)
	_, err = f.svc.Answer(ctx, f.user, view.Prompt.ID, AnswerInput{Step: domain.StepSkip})
	require.NoError(t, err)

	record(f.task(t, "done", "米饭"))

	now := time.Now()
	funnel, err := repo.New(f.db).Funnel(ctx, now.Add(-time.Hour), now.Add(time.Hour))
	require.NoError(t, err)
	require.Equal(t, repo.PromptStats{
		Prompts: 2, PromptUsers: 1, WaitPrompts: 2, Located: 1, WithSuggestions: 2,
		CanteenAnswered: 1, CanteenTop1: 1, CanteenTop3: 1, LocatedAnswered: 1, LocatedCanteenTop1: 1,
		DishAnswered: 1, ItemTop1: 1, ItemTop4: 1, RecognitionRanked: 1, RecognitionTop1: 1, RecognitionTop3: 1,
		SkippedAtCanteen: 1, PhotoAsked: 1, PhotoConsented: 1, PhotoContributed: 1, RewardCredits: 1,
		MedianCanteenSec: funnel.MedianCanteenSec, MedianDishSec: funnel.MedianDishSec,
		LinkedCanteens: 1, LinkedDishes: 1, PhotoDishes: 1, LinkingUsers: 1,
	}, funnel.PromptStats)
	require.Equal(t, repo.TaskStats{PhotoTasks: 3, PhotoTaskUsers: 1, DoneTasks: 3, RecordedTasks: 2, PromptedDoneTasks: 2, PromptedRecordedTasks: 1},
		funnel.TaskStats)
	require.Equal(t, repo.SampleStats{CanteensWithSamples: 1}, funnel.SampleStats, "one sample is not yet a learned position")
	require.Empty(t, funnel.MenuGapCanteens)
	require.Equal(t, []repo.CohortStats{{Cohort: domain.CohortRegular, Prompts: 2, DishAnswered: 1, PromptedDoneTasks: 2, PromptedRecordedTasks: 1}},
		funnel.Cohorts)
}

func TestFunnelCountsRecommendationHitsAndPriceAnswers(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	f.stalePricedCatalogDish(t)
	second := uuid.NewString()
	f.makeActive(t, f.user)
	f.makeActive(t, second)
	for _, userID := range []string{f.user, second} {
		view, err := f.svc.StartPrompt(ctx, userID, StartInput{TaskID: f.taskFor(t, userID, "processing"),
			RecommendedItemID: f.feiniu, RecommendedKind: domain.RecommendedNavigated})
		require.NoError(t, err)
		_, err = f.svc.Answer(ctx, userID, view.Prompt.ID, AnswerInput{Step: domain.StepDish, ItemID: f.feiniu, SuggestedItemIDs: []string{f.feiniu}})
		require.NoError(t, err)
		_, err = f.svc.Answer(ctx, userID, view.Prompt.ID, AnswerInput{Step: domain.StepPrice, PriceKind: domain.PriceChanged, Price: ptr(14.0)})
		require.NoError(t, err)
	}
	missed, err := f.svc.StartPrompt(ctx, f.user, StartInput{TaskID: f.task(t, "processing", ""), RecommendedItemID: f.feiniu})
	require.NoError(t, err)
	_, err = f.svc.Answer(ctx, f.user, missed.Prompt.ID, AnswerInput{Step: domain.StepDish, ItemID: f.shaomai})
	require.NoError(t, err)

	now := time.Now()
	funnel, err := repo.New(f.db).Funnel(ctx, now.Add(-time.Hour), now.Add(time.Hour))
	require.NoError(t, err)
	require.Equal(t, int64(3), funnel.Recommended)
	require.Equal(t, int64(3), funnel.RecommendedAnswered)
	require.Equal(t, int64(2), funnel.RecommendedHit, "the third user picked another dish")
	require.Equal(t, int64(2), funnel.RecommendedStrong)
	require.Equal(t, int64(2), funnel.RecommendedStrongHit)
	require.Equal(t, int64(2), funnel.PriceAsked)
	require.Equal(t, int64(2), funnel.PriceChanged)
	require.Equal(t, int64(1), funnel.PriceApplied, "only the second agreeing answer wrote the price back")
	require.Equal(t, []repo.CohortStats{{Cohort: domain.CohortActive, Prompts: 3, DishAnswered: 3, PriceAsked: 2, PriceAnswered: 2}}, funnel.Cohorts)
}
