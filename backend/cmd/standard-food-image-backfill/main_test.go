package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadDashScopeAPIKeyFromEnvFile(t *testing.T) {
	t.Setenv("DASHSCOPE_API_KEY", "")
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".env"), []byte("DASHSCOPE_API_KEY=sk-from-env\n"), 0o600))
	assert.Equal(t, "sk-from-env", loadDashScopeAPIKey(dir, ""))
}

func TestLoadDashScopeAPIKeyFromFileOverride(t *testing.T) {
	t.Setenv("DASHSCOPE_API_KEY", "")
	dir := t.TempDir()
	path := filepath.Join(dir, "dashscope-api-key.local")
	require.NoError(t, os.WriteFile(path, []byte("DASHSCOPE_API_KEY=sk-test-key\n"), 0o600))
	assert.Equal(t, "sk-test-key", loadDashScopeAPIKey(dir, path))
}

func TestPickQwenFlashModel(t *testing.T) {
	models := []string{"qwen-max", "qwen3.5-flash-2026-02-23", "qwen-turbo"}
	got, err := pickQwenFlashModel(models, "")
	require.NoError(t, err)
	assert.Equal(t, "qwen3.5-flash-2026-02-23", got)

	got, err = pickQwenFlashModel(models, "qwen3.5-flash")
	require.NoError(t, err)
	assert.Equal(t, "qwen3.5-flash", got)
}

func TestIsPlaceholderAPIKey(t *testing.T) {
	assert.True(t, isPlaceholderAPIKey(""))
	assert.True(t, isPlaceholderAPIKey("在此粘贴你的_Key"))
	assert.False(t, isPlaceholderAPIKey("sk-real-key"))
}

func TestExtractJSONObject(t *testing.T) {
	assert.Equal(t, `{"match":true}`, extractJSONObject("说明：\n```json\n{\"match\":true}\n```"))
	assert.Equal(t, `{"a":1}`, extractJSONObject(`{"a":1}`))
}

func TestBuildObjectKey(t *testing.T) {
	key := buildObjectKey("standard-food/backfill", "food-uuid", "abcdef0123456789", ".jpg")
	assert.Equal(t, "standard-food/backfill/food-uuid/abcdef0123456789.jpg", key)
}

func TestCandidateQueriesDedup(t *testing.T) {
	queries := candidateQueries(foodRow{
		CanonicalName: "苹果",
		Aliases:       "苹果 红富士",
	})
	require.NotEmpty(t, queries)
	seen := map[string]bool{}
	for _, q := range queries {
		assert.False(t, seen[q], "duplicate query %q", q)
		seen[q] = true
	}
	assert.Equal(t, "苹果", queries[0])
	assert.Equal(t, "苹果 美食", queries[1])
}

func TestLooksLikeImageURL(t *testing.T) {
	assert.True(t, looksLikeImageURL("https://example.com/a.JPG?x=1"))
	assert.False(t, looksLikeImageURL("https://example.com/page"))
}

func TestShouldSkip(t *testing.T) {
	state := stateFile{Entries: map[string]stateEntry{
		"a": {Status: "db_updated"},
		"b": {Status: "no_match"},
	}}
	assert.True(t, shouldSkip("a", state, false))
	assert.True(t, shouldSkip("b", state, false))
	assert.False(t, shouldSkip("c", state, false))
	assert.True(t, shouldSkip("c", state, true))
	assert.False(t, shouldSkip("b", state, true))
}

func TestFilterUntriedCandidates(t *testing.T) {
	tried := triedURLSet([]string{"https://a/1.jpg"})
	cands := []imageCandidate{
		{ImageURL: "https://a/1.jpg"},
		{ImageURL: "https://b/2.jpg"},
	}
	out := filterUntriedCandidates(cands, tried)
	require.Len(t, out, 1)
	assert.Equal(t, "https://b/2.jpg", out[0].ImageURL)
}

func TestMergeTriedURLs(t *testing.T) {
	entry := stateEntry{TriedURLs: []string{"https://a/1.jpg"}}
	mergeTriedURLs(&entry, []string{"https://a/1.jpg", "https://b/2.jpg"})
	assert.Len(t, entry.TriedURLs, 2)
}

func TestIsFailureStatus(t *testing.T) {
	assert.True(t, isFailureStatus("no_match"))
	assert.True(t, isFailureStatus("vision_failed"))
	assert.False(t, isFailureStatus("db_updated"))
	assert.False(t, isFailureStatus("dry_run_match"))
}

func TestParseImageDecisionTruncatedJSON(t *testing.T) {
	decision, err := parseImageDecision(`{"food_match":false,"no_watermark":true,"confidence":1.0,"reason":"图片为户外风景`)
	require.NoError(t, err)
	assert.False(t, decision.Match)
	assert.False(t, decision.FoodMatch)
	assert.True(t, decision.NoWatermark)
	assert.InDelta(t, 1.0, decision.Confidence, 0.01)
}

func TestNormalizeImageDecisionBothRequired(t *testing.T) {
	d := imageDecision{FoodMatch: true, NoWatermark: false, Confidence: 0.9}
	normalizeImageDecision(&d)
	assert.False(t, d.Match)
	d = imageDecision{FoodMatch: true, NoWatermark: true, Confidence: 0.9}
	normalizeImageDecision(&d)
	assert.True(t, d.Match)
}

func TestExtensionForContentType(t *testing.T) {
	assert.Equal(t, ".png", extensionForContentType("image/png"))
	assert.Equal(t, ".jpg", extensionForContentType("image/jpeg"))
}
