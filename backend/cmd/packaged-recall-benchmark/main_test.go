package main

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeBenchmarkStore struct {
	foods      []packagedRef
	resolves   map[string]*resolveOutput
	candidates map[string][]packagedRef
}

func (s fakeBenchmarkStore) FindExpectedFoods(_ context.Context, record benchmarkRecord) ([]packagedRef, error) {
	out := []packagedRef{}
	for _, food := range s.foods {
		if record.ExpectedBrand != "" && food.Brand != record.ExpectedBrand {
			continue
		}
		if record.ExpectedProductContains != "" && !stringsContains(food.ProductName+food.DisplayName, record.ExpectedProductContains) {
			continue
		}
		if record.ExpectedNetWeightG > 0 && food.NetWeightG != record.ExpectedNetWeightG {
			continue
		}
		out = append(out, food)
	}
	return out, nil
}

func (s fakeBenchmarkStore) ResolvePackagedFood(_ context.Context, record benchmarkRecord) (*resolveOutput, error) {
	if resolved, ok := s.resolves[record.Query]; ok {
		return resolved, nil
	}
	return &resolveOutput{Status: "unresolved"}, nil
}

func (s fakeBenchmarkStore) SearchPackagedFood(_ context.Context, query string, limit int) ([]packagedRef, error) {
	candidates := s.candidates[query]
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	return candidates, nil
}

func TestBenchmarkPackagedFuzzyTop1Hit(t *testing.T) {
	cici := packagedRef{ID: "cici-258", Brand: "喜之郎", ProductName: "Cici果粒爽橙汁饮料", NetWeightG: 258, IsActive: true}
	store := fakeBenchmarkStore{
		foods: []packagedRef{cici},
		resolves: map[string]*resolveOutput{
			"喜之郎Cici果冻爽（橙味）": {Food: &cici, Status: "fuzzy", MatchSource: "fuzzy", Score: 0.92},
		},
		candidates: map[string][]packagedRef{"喜之郎Cici果冻爽（橙味）": {cici}},
	}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "喜之郎Cici果冻爽（橙味）", ExpectedBehavior: "match", ExpectedBrand: "喜之郎", ExpectedProductContains: "橙", ExpectedNetWeightG: 258, Category: "known",
	}}, 10)
	require.NoError(t, err)

	assert.Equal(t, 1, report.Summary.MatchPassed)
	assert.Equal(t, 1, report.Summary.FuzzyTop1Hit)
	assert.Equal(t, 1.0, report.Summary.Top1Accuracy)
	assert.Equal(t, "fuzzy_top1_hit", report.Rows[0].FailReason)
}

func TestBenchmarkPackagedNearMiss(t *testing.T) {
	expected := packagedRef{ID: "suntory", Brand: "三得利", ProductName: "纤漾饮荷叶茉莉花味风味饮料", NetContentValue: 500, NetContentUnit: "ml", IsActive: true}
	wrong := packagedRef{ID: "other", Brand: "三得利", ProductName: "乌龙茶饮料", NetContentValue: 500, NetContentUnit: "ml", IsActive: true}
	store := fakeBenchmarkStore{
		foods: []packagedRef{expected, wrong},
		resolves: map[string]*resolveOutput{
			"三得利无糖荷叶茉莉": {Food: &wrong, Status: "fuzzy", Score: 0.8},
		},
		candidates: map[string][]packagedRef{"三得利无糖荷叶茉莉": {wrong, expected}},
	}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "三得利无糖荷叶茉莉", ExpectedBehavior: "match", ExpectedBrand: "三得利", ExpectedProductContains: "纤漾饮",
	}}, 10)
	require.NoError(t, err)

	assert.Equal(t, 1, report.Summary.WrongMatch)
	assert.Equal(t, 1, report.Summary.NearMiss)
	assert.Equal(t, 1, report.Summary.Top3Covered)
	assert.Equal(t, 2, report.Rows[0].ExpectedCandidateRank)
}

func TestBenchmarkPackagedNoMatchFalsePositive(t *testing.T) {
	bread := packagedRef{ID: "bread", Brand: "桃李", ProductName: "豆沙小饼面包", IsActive: true}
	store := fakeBenchmarkStore{
		foods: []packagedRef{bread},
		resolves: map[string]*resolveOutput{
			"面包": {Food: &bread, Status: "fuzzy", Score: 0.5},
		},
		candidates: map[string][]packagedRef{"面包": {bread}},
	}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "面包", ExpectedBehavior: "no_match", Category: "negative",
	}}, 10)
	require.NoError(t, err)

	assert.Equal(t, 1, report.Summary.FalsePositive)
	assert.Equal(t, 0.0, report.Summary.NoMatchPassRate)
	assert.True(t, report.Rows[0].FalsePositive)
	assert.Equal(t, "false_positive", report.Rows[0].FailReason)
}

func TestBenchmarkPackagedNoMatchPass(t *testing.T) {
	store := fakeBenchmarkStore{resolves: map[string]*resolveOutput{}}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "白米饭", ExpectedBehavior: "no_match", Category: "negative",
	}}, 10)
	require.NoError(t, err)

	assert.Equal(t, 1, report.Summary.TrueNoMatch)
	assert.Equal(t, 1.0, report.Summary.NoMatchPassRate)
	assert.Equal(t, "true_no_match", report.Rows[0].FailReason)
}

func TestBenchmarkPackagedInvalidGoldExcluded(t *testing.T) {
	inactive := packagedRef{ID: "old", Brand: "旧品牌", ProductName: "旧商品", IsActive: false}
	store := fakeBenchmarkStore{foods: []packagedRef{inactive}, resolves: map[string]*resolveOutput{}}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "旧商品", ExpectedBehavior: "match", ExpectedBrand: "旧品牌", ExpectedProductContains: "旧商品", Category: "bad",
	}}, 10)
	require.NoError(t, err)

	assert.Equal(t, 1, report.Summary.InvalidGold)
	assert.Equal(t, 0, report.Summary.MatchGold)
	assert.Equal(t, "invalid_gold_not_found_or_inactive", report.Rows[0].FailReason)
}

func TestBuildMarkdownReportExplainsPackagedMetrics(t *testing.T) {
	bread := packagedRef{ID: "bread", Brand: "桃李", ProductName: "豆沙小饼面包", IsActive: true}
	store := fakeBenchmarkStore{
		foods: []packagedRef{bread},
		resolves: map[string]*resolveOutput{
			"面包": {Food: &bread, Status: "fuzzy", Score: 0.5},
		},
		candidates: map[string][]packagedRef{"面包": {bread}},
	}
	report, err := runBenchmark(context.Background(), store, []benchmarkRecord{{
		Line: 2, Query: "面包", ExpectedBehavior: "no_match", Category: "negative",
	}}, 10)
	require.NoError(t, err)

	body := buildMarkdownReport(report)
	assert.Contains(t, body, "包装食物库召回 Benchmark 报告")
	assert.Contains(t, body, "false_positive")
	assert.Contains(t, body, "错 SKU/错规格/错用整包重量")
}

func stringsContains(value, needle string) bool {
	return normalizeFoodName(value) != "" && strings.Contains(normalizeFoodName(value), normalizeFoodName(needle))
}
