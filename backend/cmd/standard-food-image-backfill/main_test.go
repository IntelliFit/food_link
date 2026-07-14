package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadDashScopeAPIKeyFromEnvFile(t *testing.T) {
	t.Setenv("FOOD_IMAGE_VISION_API_KEY", "")
	t.Setenv("DASHSCOPE_API_KEY", "")
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".env"), []byte("DASHSCOPE_API_KEY=sk-from-env\n"), 0o600))
	assert.Equal(t, "sk-from-env", loadDashScopeAPIKey(dir, ""))
}

func TestLoadDashScopeAPIKeyFromFileOverride(t *testing.T) {
	t.Setenv("FOOD_IMAGE_VISION_API_KEY", "")
	t.Setenv("DASHSCOPE_API_KEY", "")
	dir := t.TempDir()
	path := filepath.Join(dir, "dashscope-api-key.local")
	require.NoError(t, os.WriteFile(path, []byte("DASHSCOPE_API_KEY=sk-test-key\n"), 0o600))
	assert.Equal(t, "sk-test-key", loadDashScopeAPIKey(dir, path))
}

func TestLoadTemporaryFoodImageVisionAPIKeyTakesPriority(t *testing.T) {
	t.Setenv("FOOD_IMAGE_VISION_API_KEY", "sk-temporary")
	t.Setenv("DASHSCOPE_API_KEY", "sk-configured")
	assert.Equal(t, "sk-temporary", loadDashScopeAPIKey(t.TempDir(), ""))
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

func TestGeminiVisionEndpoint(t *testing.T) {
	assert.Equal(t,
		"https://maas-openapi.wanjiedata.com/api/v1beta/models/gemini-3-flash-preview:generateContent",
		geminiVisionEndpoint("https://maas-openapi.wanjiedata.com/api/v1", "gemini-3-flash-preview"),
	)
}

func TestExistingImageAuditStatus(t *testing.T) {
	assert.Equal(t, "mismatch", existingImageAuditStatus(&imageDecision{FoodMatch: false, Confidence: 0.9}))
	assert.Equal(t, "uncertain", existingImageAuditStatus(&imageDecision{FoodMatch: false, Confidence: 0.7}))
	assert.Equal(t, "match", existingImageAuditStatus(&imageDecision{FoodMatch: true, Confidence: 0.9}))
}

func TestShouldSkipExistingImageAudit(t *testing.T) {
	assert.True(t, shouldSkipExistingImageAudit(existingImageAuditEntry{Status: "match"}))
	assert.True(t, shouldSkipExistingImageAudit(existingImageAuditEntry{Status: "mismatch"}))
	assert.False(t, shouldSkipExistingImageAudit(existingImageAuditEntry{Status: "uncertain"}))
	assert.False(t, shouldSkipExistingImageAudit(existingImageAuditEntry{Status: "vision_failed"}))
}

func TestCheckpointUsesGlobalProcessedCount(t *testing.T) {
	checkpointEvery := 5
	var checkpoints []int64
	for current := int64(1); current <= 12; current++ {
		if shouldCheckpoint(current, checkpointEvery) {
			checkpoints = append(checkpoints, current)
		}
	}
	assert.Equal(t, []int64{5, 10}, checkpoints)
}

func TestLoadReviewedCandidatesRequiresHighConfidenceAndUniqueURL(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "missing.json")
	decision := &imageDecision{FoodMatch: true, NoWatermark: true, Match: true, Confidence: 0.96}
	summary := successSummary{Successes: []successRecord{
		{FoodID: "unique", FoodName: "苹果", CandidateURL: "https://example.com/unique.jpg", Decision: decision},
		{FoodID: "duplicate-a", FoodName: "土豆片", CandidateURL: "https://example.com/shared.jpg", Decision: decision},
		{FoodID: "duplicate-b", FoodName: "油菜", CandidateURL: "https://example.com/shared.jpg", Decision: decision},
		{FoodID: "low", FoodName: "低置信", CandidateURL: "https://example.com/low.jpg", Decision: &imageDecision{FoodMatch: true, NoWatermark: true, Match: true, Confidence: 0.9}},
	}}
	data, err := json.Marshal(summary)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, data, 0o600))

	candidates, err := loadReviewedCandidates(options{reviewedMissingReport: path, reviewedMinConfidence: 0.95})
	require.NoError(t, err)
	require.Len(t, candidates, 1)
	assert.Equal(t, "unique", candidates[0].FoodID)

	allowlistPath := filepath.Join(dir, "allowlist.json")
	allowlist := reviewedImageReport{Entries: map[string]reviewedImageEntry{
		reviewedEntryKey(reviewedKindMissing, "unique"): {Kind: reviewedKindMissing, FoodID: "unique", Status: "verified"},
	}}
	data, err = json.Marshal(allowlist)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(allowlistPath, data, 0o600))
	candidates, err = loadReviewedCandidates(options{
		reviewedMissingReport: path, reviewedAllowlistReport: allowlistPath, reviewedMinConfidence: 0.95,
	})
	require.NoError(t, err)
	require.Len(t, candidates, 1)
}

func TestSnapshotContainsImage(t *testing.T) {
	assert.True(t, snapshotHasImage(imageDBSnapshot{ImagePaths: `["a.jpg"]`}))
	assert.True(t, snapshotContainsImage(imageDBSnapshot{ImagePath: "a.jpg", ImagePaths: `[]`}, "a.jpg"))
	assert.True(t, snapshotContainsImage(imageDBSnapshot{ImagePaths: `["a.jpg"]`}, "a.jpg"))
	assert.False(t, snapshotContainsImage(imageDBSnapshot{ImagePaths: `["b.jpg"]`}, "a.jpg"))
}
