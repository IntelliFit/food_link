package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadKimiAPIKeyFromEnvFile(t *testing.T) {
	t.Setenv("KIMI_API_KEY", "")
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".env"), []byte("KIMI_API_KEY=sk-from-env\n"), 0o600))
	assert.Equal(t, "sk-from-env", loadKimiAPIKey(dir, ""))
}

func TestLoadKimiAPIKeyFromFileOverride(t *testing.T) {
	t.Setenv("KIMI_API_KEY", "")
	dir := t.TempDir()
	path := filepath.Join(dir, "kimi-api-key.local")
	require.NoError(t, os.WriteFile(path, []byte("KIMI_API_KEY=sk-test-key\n"), 0o600))
	assert.Equal(t, "sk-test-key", loadKimiAPIKey(dir, path))
}

func TestIsPlaceholderAPIKey(t *testing.T) {
	assert.True(t, isPlaceholderAPIKey(""))
	assert.True(t, isPlaceholderAPIKey("在此粘贴你的_Kimi_API_Key"))
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

func TestIsFailureStatus(t *testing.T) {
	assert.True(t, isFailureStatus("no_match"))
	assert.False(t, isFailureStatus("db_updated"))
	assert.False(t, isFailureStatus("dry_run_match"))
}

func TestParseKimiDecisionTruncatedJSON(t *testing.T) {
	decision, err := parseKimiDecision(`{"food_match":false,"no_watermark":true,"confidence":1.0,"reason":"图片为户外风景`)
	require.NoError(t, err)
	assert.False(t, decision.Match)
	assert.False(t, decision.FoodMatch)
	assert.True(t, decision.NoWatermark)
	assert.InDelta(t, 1.0, decision.Confidence, 0.01)
}

func TestNormalizeKimiDecisionBothRequired(t *testing.T) {
	d := kimiDecision{FoodMatch: true, NoWatermark: false, Confidence: 0.9}
	normalizeKimiDecision(&d)
	assert.False(t, d.Match)
	d = kimiDecision{FoodMatch: true, NoWatermark: true, Confidence: 0.9}
	normalizeKimiDecision(&d)
	assert.True(t, d.Match)
}

func TestExtensionForContentType(t *testing.T) {
	assert.Equal(t, ".png", extensionForContentType("image/png"))
	assert.Equal(t, ".jpg", extensionForContentType("image/jpeg"))
}
