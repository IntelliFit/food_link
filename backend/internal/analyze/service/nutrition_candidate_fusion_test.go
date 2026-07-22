package service

import (
	"context"
	"errors"
	"testing"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeNutritionSemanticRetriever struct {
	queries [][]string
	limit   int
	rows    [][]foodrecordrepo.SearchCandidate
	err     error
}

func (f *fakeNutritionSemanticRetriever) SearchCandidates(_ context.Context, queries []string, limit int) ([][]foodrecordrepo.SearchCandidate, error) {
	f.queries = append(f.queries, append([]string(nil), queries...))
	f.limit = limit
	return f.rows, f.err
}

func nutritionCandidate(id, name, source string, score float64) foodrecordrepo.SearchCandidate {
	return foodrecordrepo.SearchCandidate{
		Food: foodrecorddomain.FoodNutrition{
			ID:            id,
			CanonicalName: name,
			IsActive:      true,
		},
		MatchSource: source,
		Score:       score,
	}
}

func TestMergeNutritionCandidateRecallKeepsLexicalAndEmbeddingCandidates(t *testing.T) {
	lexical := []foodrecordrepo.SearchCandidate{
		nutritionCandidate("chips", "薯片（烧烤味）", "canonical", 0.86),
	}
	embedding := []foodrecordrepo.SearchCandidate{
		nutritionCandidate("fries", "炸薯条", "embedding_candidate", 0.91),
	}

	merged := mergeNutritionCandidateRecall(lexical, embedding, 5)

	require.Len(t, merged, 2)
	ids := []string{merged[0].Food.ID, merged[1].Food.ID}
	assert.ElementsMatch(t, []string{"chips", "fries"}, ids)
	assert.Contains(t, []string{merged[0].MatchSource, merged[1].MatchSource}, "embedding_candidate")
}

func TestMergeNutritionCandidateRecallRewardsCrossChannelAgreement(t *testing.T) {
	lexical := []foodrecordrepo.SearchCandidate{
		nutritionCandidate("beef", "牛肉", "canonical", 0.90),
		nutritionCandidate("beef-noodles", "牛肉面", "canonical", 0.82),
	}
	embedding := []foodrecordrepo.SearchCandidate{
		nutritionCandidate("beef-noodles", "牛肉面", "embedding_candidate", 0.94),
		nutritionCandidate("noodles", "汤面", "embedding_candidate", 0.88),
	}

	merged := mergeNutritionCandidateRecall(lexical, embedding, 5)

	require.Len(t, merged, 3)
	assert.Equal(t, "beef-noodles", merged[0].Food.ID)
	assert.Equal(t, "hybrid_candidate", merged[0].MatchSource)
	assert.Greater(t, merged[0].Score, merged[1].Score)
}

func TestMergeNutritionCandidateRecallPreservesLexicalCandidatesWhenEmbeddingUnavailable(t *testing.T) {
	lexical := []foodrecordrepo.SearchCandidate{
		nutritionCandidate("tofu", "豆腐", "canonical", 0.88),
	}

	merged := mergeNutritionCandidateRecall(lexical, nil, 5)

	require.Len(t, merged, 1)
	assert.Equal(t, lexical[0], merged[0])
}

func TestAnalyzeServiceApplyDBFirstRunsEmbeddingAlongsideLexicalCandidates(t *testing.T) {
	resolver := newFakeAnalyzeNutritionResolver()
	resolver.searchCandidates = map[string][]foodrecordrepo.SearchCandidate{
		"薯条": {
			nutritionCandidate("chips", "薯片（烧烤味）", "canonical", 0.86),
		},
	}
	semantic := &fakeNutritionSemanticRetriever{
		rows: [][]foodrecordrepo.SearchCandidate{{
			nutritionCandidate("fries", "炸薯条", "embedding_candidate", 0.91),
		}},
	}
	fallback := &fakeNutritionFallbackEstimator{rows: map[int]map[string]any{}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureNutritionResolver(resolver)
	svc.ConfigureNutritionSemanticRetriever(semantic)
	svc.ConfigureNutritionFallbackEstimator(fallback)

	items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{{
		"name":                 "薯条",
		"type":                 "dish",
		"estimatedWeightGrams": 110.0,
	}}, "")

	require.Len(t, items, 1)
	require.Len(t, semantic.queries, 1)
	assert.Equal(t, []string{"薯条"}, semantic.queries[0])
	assert.Equal(t, resolveFoodCandidateLimit, semantic.limit)
}

func TestAnalyzeServiceApplyDBFirstKeepsFallbackWhenEmbeddingFails(t *testing.T) {
	resolver := newFakeAnalyzeNutritionResolver()
	resolver.searchCandidates = map[string][]foodrecordrepo.SearchCandidate{
		"薯条": {
			nutritionCandidate("chips", "薯片（烧烤味）", "canonical", 0.86),
		},
	}
	semantic := &fakeNutritionSemanticRetriever{err: errors.New("embedding unavailable")}
	fallback := &fakeNutritionFallbackEstimator{rows: map[int]map[string]any{}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureNutritionResolver(resolver)
	svc.ConfigureNutritionSemanticRetriever(semantic)
	svc.ConfigureNutritionFallbackEstimator(fallback)

	items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{{
		"name":                 "薯条",
		"type":                 "dish",
		"estimatedWeightGrams": 110.0,
	}}, "")

	require.Len(t, items, 1)
	require.Len(t, semantic.queries, 1)
	assert.Equal(t, "薯条", semantic.queries[0][0])
}

func TestStrictNutritionReuseDecisionRejectsExplicitNone(t *testing.T) {
	decision := &foodCandidateReuseDecision{
		ReuseExisting:            false,
		SelectedCandidateIndex:   -1,
		IdentityEquivalent:       false,
		PreparationEquivalent:    false,
		CompositionEquivalent:    false,
		NutritionBasisEquivalent: false,
		Confidence:               0.99,
	}

	assert.False(t, isStrictNutritionReuseDecision(decision))
}
