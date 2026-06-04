package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeBenchmarkStore struct {
	foods      []foodRef
	resolves   map[string]*resolveOutput
	candidates map[string][]candidateOutput
}

func (s fakeBenchmarkStore) FindExpectedFoods(_ context.Context, canonical string) ([]foodRef, error) {
	out := []foodRef{}
	for _, food := range s.foods {
		if food.CanonicalName == canonical {
			out = append(out, food)
		}
	}
	return out, nil
}

func (s fakeBenchmarkStore) ResolveFood(_ context.Context, query string) (*resolveOutput, error) {
	if resolved, ok := s.resolves[query]; ok {
		return resolved, nil
	}
	return &resolveOutput{Status: "unresolved"}, nil
}

func (s fakeBenchmarkStore) SearchCandidates(_ context.Context, query string, limit int) ([]candidateOutput, error) {
	candidates := s.candidates[query]
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	return candidates, nil
}

func TestBenchmarkExactCanonicalHit(t *testing.T) {
	rice := foodRef{ID: "rice", CanonicalName: "白米饭", KcalPer100g: 116, IsActive: true}
	store := fakeBenchmarkStore{
		foods: []foodRef{rice},
		resolves: map[string]*resolveOutput{
			"白米饭": {Food: &rice, Status: "exact_canonical", MatchSource: "canonical", Score: 1},
		},
		candidates: map[string][]candidateOutput{"白米饭": {{Food: rice, MatchSource: "canonical", Score: 0.99}}},
	}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "白米饭", ExpectedCanonicalName: "白米饭", Category: "rice",
	}}, 10)
	require.NoError(t, err)

	assert.Equal(t, 1, report.Summary.Passed)
	assert.Equal(t, 1, report.Summary.ExactCanonicalHit)
	assert.Equal(t, 1.0, report.Summary.Top1Accuracy)
	assert.Equal(t, "exact_canonical_hit", report.Rows[0].FailReason)
}

func TestBenchmarkExactAliasHit(t *testing.T) {
	corn := foodRef{ID: "corn", CanonicalName: "玉米(熟)", KcalPer100g: 96, IsActive: true}
	store := fakeBenchmarkStore{
		foods: []foodRef{corn},
		resolves: map[string]*resolveOutput{
			"水煮玉米": {Food: &corn, Status: "exact_alias", MatchSource: "alias", Score: 1},
		},
		candidates: map[string][]candidateOutput{"水煮玉米": {{Food: corn, MatchSource: "alias", Score: 0.9}}},
	}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "水煮玉米", ExpectedCanonicalName: "玉米(熟)", Category: "corn",
	}}, 10)
	require.NoError(t, err)

	assert.Equal(t, 1, report.Summary.Passed)
	assert.Equal(t, 1, report.Summary.ExactAliasHit)
	assert.Equal(t, 1.0, report.Summary.Top3Recall)
}

func TestBenchmarkFuzzyTop1Hit(t *testing.T) {
	egg := foodRef{ID: "egg", CanonicalName: "鸡蛋", KcalPer100g: 139, IsActive: true}
	store := fakeBenchmarkStore{
		foods: []foodRef{egg},
		resolves: map[string]*resolveOutput{
			"煮鸡蛋": {Food: &egg, Status: "fuzzy", MatchSource: "canonical", Score: 0.82},
		},
		candidates: map[string][]candidateOutput{"煮鸡蛋": {{Food: egg, MatchSource: "canonical", Score: 0.82}}},
	}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "煮鸡蛋", ExpectedCanonicalName: "鸡蛋", Category: "egg",
	}}, 10)
	require.NoError(t, err)

	assert.Equal(t, 1, report.Summary.Passed)
	assert.Equal(t, 1, report.Summary.FuzzyTop1Hit)
	assert.Equal(t, "fuzzy_top1_hit", report.Rows[0].FailReason)
}

func TestBenchmarkNearMissWhenExpectedInTopKButTop1Wrong(t *testing.T) {
	rice := foodRef{ID: "rice", CanonicalName: "白米饭", KcalPer100g: 116, IsActive: true}
	noodle := foodRef{ID: "noodle", CanonicalName: "面条", KcalPer100g: 110, IsActive: true}
	store := fakeBenchmarkStore{
		foods: []foodRef{rice, noodle},
		resolves: map[string]*resolveOutput{
			"米饭面": {Food: &noodle, Status: "fuzzy", MatchSource: "canonical", Score: 0.91},
		},
		candidates: map[string][]candidateOutput{
			"米饭面": {
				{Food: noodle, MatchSource: "canonical", Score: 0.91},
				{Food: rice, MatchSource: "canonical", Score: 0.77},
			},
		},
	}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "米饭面", ExpectedCanonicalName: "白米饭", Category: "rice",
	}}, 10)
	require.NoError(t, err)

	assert.Equal(t, 0, report.Summary.Passed)
	assert.Equal(t, 1, report.Summary.WrongMatch)
	assert.Equal(t, 1, report.Summary.NearMiss)
	assert.Equal(t, 1, report.Summary.Top3Covered)
	assert.True(t, report.Rows[0].NearMiss)
	assert.Equal(t, 2, report.Rows[0].ExpectedCandidateRank)
}

func TestBenchmarkWrongExactAliasIsFlagged(t *testing.T) {
	corn := foodRef{ID: "corn", CanonicalName: "玉米(熟)", KcalPer100g: 96, IsActive: true}
	sausage := foodRef{ID: "sausage", CanonicalName: "玉米肠", KcalPer100g: 207, IsActive: true}
	store := fakeBenchmarkStore{
		foods: []foodRef{corn, sausage},
		resolves: map[string]*resolveOutput{
			"煮玉米": {Food: &sausage, Status: "exact_alias", MatchSource: "alias", Score: 1},
		},
		candidates: map[string][]candidateOutput{"煮玉米": {
			{Food: sausage, MatchSource: "alias", Score: 0.99},
			{Food: corn, MatchSource: "alias", Score: 0.88},
		}},
	}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "煮玉米", ExpectedCanonicalName: "玉米(熟)", Category: "corn",
	}}, 10)
	require.NoError(t, err)

	assert.Equal(t, 1, report.Summary.WrongMatch)
	assert.Equal(t, 1, report.Summary.WrongExactAlias)
	assert.Equal(t, 1, report.Summary.ProcessedMismatch)
	assert.Equal(t, "wrong_exact_alias", report.Rows[0].FailReason)
	assert.True(t, report.Rows[0].WrongExactAlias)
	assert.True(t, report.Rows[0].ProcessedMismatch)
}

func TestBenchmarkInvalidGoldExcludedFromRates(t *testing.T) {
	inactive := foodRef{ID: "old", CanonicalName: "旧条目", KcalPer100g: 100, IsActive: false}
	store := fakeBenchmarkStore{
		foods:    []foodRef{inactive},
		resolves: map[string]*resolveOutput{},
	}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{
		{Line: 2, Query: "不存在", ExpectedCanonicalName: "不存在目标", Category: "bad"},
		{Line: 3, Query: "旧条目", ExpectedCanonicalName: "旧条目", Category: "bad"},
	}, 10)
	require.NoError(t, err)

	assert.Equal(t, 2, report.Summary.InvalidGold)
	assert.Equal(t, 0, report.Summary.ValidGold)
	assert.Equal(t, 0.0, report.Summary.Top1Accuracy)
	assert.Equal(t, "invalid_gold_not_found_or_inactive", report.Rows[0].FailReason)
	assert.Equal(t, "invalid_gold_not_found_or_inactive", report.Rows[1].FailReason)
}

func TestBuildBenchmarkMarkdownReportExplainsMetricsAndExamples(t *testing.T) {
	rice := foodRef{ID: "rice", CanonicalName: "白米饭", KcalPer100g: 116, IsActive: true}
	rawRice := foodRef{ID: "raw-rice", CanonicalName: "Rice, white, long grain, unenriched, raw", KcalPer100g: 365, IsActive: true}
	store := fakeBenchmarkStore{
		foods: []foodRef{rice, rawRice},
		resolves: map[string]*resolveOutput{
			"白米": {Food: &rawRice, Status: "exact_alias", MatchSource: "alias", Score: 1},
		},
		candidates: map[string][]candidateOutput{
			"白米": {
				{Food: rawRice, MatchSource: "alias", Score: 0.9},
				{Food: rice, MatchSource: "alias", Score: 0.8},
			},
		},
	}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "白米", ExpectedCanonicalName: "白米饭", Category: "rice",
	}}, 10)
	require.NoError(t, err)

	body := buildBenchmarkMarkdownReport(report)
	assert.Contains(t, body, "valid_gold")
	assert.Contains(t, body, "不是命中正确数")
	assert.Contains(t, body, "高风险：强别名错配")
	assert.Contains(t, body, "白米")
	assert.Contains(t, body, "代表性说明")
}
