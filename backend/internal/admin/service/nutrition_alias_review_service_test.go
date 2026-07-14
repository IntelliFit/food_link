package service

import (
	"context"
	"testing"

	"food_link/backend/internal/admin/repo"

	"github.com/stretchr/testify/require"
)

type fakeAliasReviewRepo struct {
	item         repo.NutritionAliasCandidate
	created      []repo.CreateNutritionAliasCandidateInput
	reviewCalls  int
	lastAIUpdate repo.AliasAIReviewUpdate
}

func (f *fakeAliasReviewRepo) List(context.Context, repo.ListNutritionAliasCandidatesInput) (*repo.ListNutritionAliasCandidatesResult, error) {
	return &repo.ListNutritionAliasCandidatesResult{Items: []repo.NutritionAliasCandidate{f.item}, Total: 1}, nil
}

func (f *fakeAliasReviewRepo) Get(context.Context, string) (*repo.NutritionAliasCandidate, error) {
	copy := f.item
	return &copy, nil
}

func (f *fakeAliasReviewRepo) Create(_ context.Context, input repo.CreateNutritionAliasCandidateInput) (*repo.NutritionAliasCandidate, error) {
	f.created = append(f.created, input)
	return &repo.NutritionAliasCandidate{ID: "generated", AliasName: input.AliasName, Status: repo.AliasCandidatePending}, nil
}

func (f *fakeAliasReviewRepo) SaveAIReview(_ context.Context, _ string, update repo.AliasAIReviewUpdate) (*repo.NutritionAliasCandidate, error) {
	f.lastAIUpdate = update
	copy := f.item
	copy.Model = &update.Model
	copy.ModelDecision = &update.Decision
	copy.ModelConfidence = &update.Confidence
	copy.ModelReason = &update.Reason
	copy.SuggestedAliases = update.SuggestedAliases
	copy.RuleFlags = update.RuleFlags
	return &copy, nil
}

func (f *fakeAliasReviewRepo) Review(context.Context, string, string, string, string) (*repo.NutritionAliasCandidate, error) {
	f.reviewCalls++
	copy := f.item
	copy.Status = repo.AliasCandidateApproved
	return &copy, nil
}

type fakeAliasAIReviewer struct {
	result map[string]any
}

func (f fakeAliasAIReviewer) Analyze(context.Context, string, string) (map[string]any, error) {
	return f.result, nil
}

func TestNutritionAliasAIReviewNeverPublishesAndGeneratedAliasesStayPending(t *testing.T) {
	reviewRepo := &fakeAliasReviewRepo{item: repo.NutritionAliasCandidate{
		ID: "candidate-1", AliasName: "兰州牛肉拉面", ProposedFoodID: "food-1",
		ProposedCanonicalName: "兰州牛肉面", CarbsPer100g: 18,
		Status: repo.AliasCandidatePending,
	}}
	reviewer := fakeAliasAIReviewer{result: map[string]any{
		"decision": "approve", "confidence": 0.99, "reason": "同一完整食物的常用名称",
		"riskFlags": []any{}, "suggestedAliases": []any{"牛肉拉面", "兰州牛肉面", "兰州牛肉拉面"},
	}}
	svc := NewNutritionAliasReviewService(reviewRepo, reviewer, "deepseek-v4-pro")

	item, generated, err := svc.AIReview(context.Background(), "candidate-1")

	require.NoError(t, err)
	require.Equal(t, repo.AliasCandidatePending, item.Status)
	require.Equal(t, "approve", reviewRepo.lastAIUpdate.Decision)
	require.Equal(t, 1, generated)
	require.Len(t, reviewRepo.created, 1)
	require.Equal(t, "ai_generated", reviewRepo.created[0].Source)
	require.Zero(t, reviewRepo.reviewCalls, "AI 预审不得调用正式审核发布动作")
}

func TestNutritionAliasAIReviewDoesNotGenerateAliasesBelowHighConfidenceThreshold(t *testing.T) {
	reviewRepo := &fakeAliasReviewRepo{item: repo.NutritionAliasCandidate{
		ID: "candidate-1", AliasName: "牛肉拉面", ProposedFoodID: "food-1",
		ProposedCanonicalName: "兰州牛肉面", Status: repo.AliasCandidatePending,
	}}
	reviewer := fakeAliasAIReviewer{result: map[string]any{
		"decision": "approve", "confidence": 0.94, "reason": "可能等价",
		"suggestedAliases": []any{"兰州拉面"},
	}}
	svc := NewNutritionAliasReviewService(reviewRepo, reviewer, "deepseek-v4-pro")

	item, generated, err := svc.AIReview(context.Background(), "candidate-1")

	require.NoError(t, err)
	require.Equal(t, repo.AliasCandidatePending, item.Status)
	require.Zero(t, generated)
	require.Empty(t, reviewRepo.created)
}
