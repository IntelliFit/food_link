package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"food_link/backend/pkg/config"

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

func TestHydrateVisionRuntimeConfigUsesProjectConfig(t *testing.T) {
	t.Setenv("FOOD_IMAGE_VISION_API_KEY", "")
	opts := options{}
	require.NoError(t, applyVisionRuntimeConfig(&opts, config.ExternalConfig{
		DashScopeAPIKey:  "project-key",
		DashScopeBaseURL: "https://dashscope.example.com/compatible-mode/v1/",
	}, false, false))
	assert.Equal(t, "project-key", os.Getenv("FOOD_IMAGE_VISION_API_KEY"))
	assert.Equal(t, "https://dashscope.example.com/compatible-mode/v1", opts.dashscopeBaseURL)
}

func TestHydrateVisionRuntimeConfigPreservesExplicitValues(t *testing.T) {
	t.Setenv("FOOD_IMAGE_VISION_API_KEY", "explicit-key")
	opts := options{}
	require.NoError(t, applyVisionRuntimeConfig(&opts, config.ExternalConfig{
		DashScopeAPIKey:  "project-key",
		DashScopeBaseURL: "https://project.example.com/v1",
	}, true, true))
	assert.Equal(t, "explicit-key", os.Getenv("FOOD_IMAGE_VISION_API_KEY"))
	assert.Empty(t, opts.dashscopeBaseURL)
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

func TestFormatCommonsLicensePreservesNameAndURL(t *testing.T) {
	assert.Equal(t, "CC BY-SA 4.0 | https://creativecommons.org/licenses/by-sa/4.0/",
		formatCommonsLicense("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"))
}

func TestValidateApplyModeRejectsGenericSearchWrites(t *testing.T) {
	for _, provider := range []string{"library", "commons", "bing", "google"} {
		t.Run(provider, func(t *testing.T) {
			err := validateApplyMode(options{apply: true, imageSearch: provider})
			assert.ErrorContains(t, err, "通用 --apply 已禁用")
		})
	}
	assert.ErrorContains(t, validateApplyMode(options{apply: true, localImage: "candidate.jpg"}), "--trust-local-image")
	assert.ErrorContains(t, validateApplyMode(options{
		apply: true, localImage: "candidate.jpg", reviewedApply: true, auditExisting: true,
	}), "--trust-local-image")
}

func TestValidateApplyModeAllowsReviewedWritePaths(t *testing.T) {
	assert.ErrorContains(t, validateApplyMode(options{apply: true, reviewedApply: true}), "--reviewed-allowlist-report")
	assert.NoError(t, validateApplyMode(options{
		apply: true, reviewedApply: true, reviewedAllowlistReport: "reviewed-verification-report.json",
	}))
	assert.NoError(t, validateApplyMode(options{apply: true, libraryReuseApply: true}))
	assert.NoError(t, validateApplyMode(options{apply: true, localImage: "approved.jpg", trustLocal: true}))
	assert.NoError(t, validateApplyMode(options{apply: true, auditExisting: true}))
	assert.NoError(t, validateApplyMode(options{imageSearch: "commons"}))
}

func TestValidateLibraryReuseSnapshot(t *testing.T) {
	item := approvedLibraryReuse{
		FoodID: "target", FoodName: "新鲜草莓", SourceFoodID: "source",
		SourceFoodName: "草莓", ObjectKey: "standard-food/strawberry.jpg",
	}
	valid := libraryReuseSnapshot{
		TargetID: "target", TargetName: "新鲜草莓", TargetImagePaths: "[]",
		TargetActive: true, TargetKcal: 32,
		SourceID: "source", SourceName: "草莓", SourceImagePath: "standard-food/strawberry.jpg",
		SourceImagePaths: "[]",
	}
	require.NoError(t, validateLibraryReuseSnapshot(item, valid))

	changed := valid
	changed.TargetImagePath = "already-filled.jpg"
	assert.ErrorContains(t, validateLibraryReuseSnapshot(item, changed), "filled after review")

	changed = valid
	changed.SourceImagePath = "different.jpg"
	assert.ErrorContains(t, validateLibraryReuseSnapshot(item, changed), "source image changed")
}

func TestLoadApprovedLibraryReuseRequiresExactReviewedMatch(t *testing.T) {
	dir := t.TempDir()
	reportPath := filepath.Join(dir, "success.json")
	allowlistPath := filepath.Join(dir, "allowlist.json")
	decision := &imageDecision{FoodMatch: true, NoWatermark: true, Match: true, Confidence: 0.98}
	report := successSummary{Successes: []successRecord{{
		FoodID: "target", FoodName: "新鲜草莓", SourceFoodID: "source", SourceFoodName: "草莓",
		ObjectKey: "standard-food/strawberry.jpg", Reused: true, Decision: decision,
	}}}
	allowlist := libraryReuseAllowlist{
		ReviewedAt: "2026-08-26T12:00:00+08:00", ReviewedBy: "local-manual-review",
		Entries: []approvedLibraryReuse{{
			FoodID: "target", FoodName: "新鲜草莓", SourceFoodID: "source", SourceFoodName: "草莓",
			ObjectKey: "standard-food/strawberry.jpg",
		}},
	}
	writeJSON := func(path string, value any) {
		data, err := json.Marshal(value)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(path, data, 0o600))
	}
	writeJSON(reportPath, report)
	writeJSON(allowlistPath, allowlist)

	approved, reviewedAt, reviewedBy, err := loadApprovedLibraryReuse(reportPath, allowlistPath)
	require.NoError(t, err)
	require.Len(t, approved, 1)
	assert.Equal(t, allowlist.ReviewedAt, reviewedAt)
	assert.Equal(t, allowlist.ReviewedBy, reviewedBy)

	allowlist.Entries[0].ObjectKey = "standard-food/different.jpg"
	writeJSON(allowlistPath, allowlist)
	_, _, _, err = loadApprovedLibraryReuse(reportPath, allowlistPath)
	assert.ErrorContains(t, err, "人工 allowlist 与审计报告不一致")
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
	assert.Equal(t, "苹果 高清 无水印 实拍", queries[1])
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
		reviewedEntryKey(reviewedKindMissing, "unique"): {
			Kind: reviewedKindMissing, FoodID: "unique", FoodName: "苹果",
			CandidateURL: "https://example.com/unique.jpg", Status: "verified",
		},
	}}
	data, err = json.Marshal(allowlist)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(allowlistPath, data, 0o600))
	candidates, err = loadReviewedCandidates(options{
		reviewedMissingReport: path, reviewedAllowlistReport: allowlistPath, reviewedMinConfidence: 0.95,
	})
	require.NoError(t, err)
	require.Len(t, candidates, 1)

	summary.Successes[0].CandidateURL = "https://example.com/changed-after-review.jpg"
	data, err = json.Marshal(summary)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, data, 0o600))
	candidates, err = loadReviewedCandidates(options{
		reviewedMissingReport: path, reviewedAllowlistReport: allowlistPath, reviewedMinConfidence: 0.95,
	})
	require.NoError(t, err)
	assert.Empty(t, candidates)
}

func TestReviewedCandidateMatchesAllowlistBindsReviewedIdentity(t *testing.T) {
	candidate := reviewedCandidate{
		Kind: reviewedKindMissing, FoodID: "target", CandidateURL: "https://example.com/a.jpg",
		CandidatePage: "https://example.com/file/a", ReuseObjectKey: "standard-food/a.jpg",
		SourceLabel: "Author", ImageLicense: "CC BY 4.0", SourceFoodID: "source",
		SourceFoodName: "草莓", ExpectedOldImagePath: "old.jpg",
	}
	entry := reviewedImageEntry{
		Kind: candidate.Kind, FoodID: candidate.FoodID, CandidateURL: candidate.CandidateURL,
		CandidatePage: candidate.CandidatePage, ReuseObjectKey: candidate.ReuseObjectKey,
		SourceLabel: candidate.SourceLabel, ImageLicense: candidate.ImageLicense,
		SourceFoodID: candidate.SourceFoodID, SourceFoodName: candidate.SourceFoodName,
		AuditedImagePath: candidate.ExpectedOldImagePath,
	}
	assert.True(t, reviewedCandidateMatchesAllowlist(candidate, entry))

	mutations := map[string]func(*reviewedImageEntry){
		"candidate URL":    func(value *reviewedImageEntry) { value.CandidateURL = "https://example.com/b.jpg" },
		"reuse object key": func(value *reviewedImageEntry) { value.ReuseObjectKey = "standard-food/b.jpg" },
		"source food":      func(value *reviewedImageEntry) { value.SourceFoodID = "other-source" },
		"source label":     func(value *reviewedImageEntry) { value.SourceLabel = "Other Author" },
		"license":          func(value *reviewedImageEntry) { value.ImageLicense = "CC0" },
		"audited image":    func(value *reviewedImageEntry) { value.AuditedImagePath = "different-old.jpg" },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			changed := entry
			mutate(&changed)
			assert.False(t, reviewedCandidateMatchesAllowlist(candidate, changed))
		})
	}
}

func TestSnapshotContainsImage(t *testing.T) {
	assert.True(t, snapshotHasImage(imageDBSnapshot{ImagePaths: `["a.jpg"]`}))
	assert.True(t, snapshotContainsImage(imageDBSnapshot{ImagePath: "a.jpg", ImagePaths: `[]`}, "a.jpg"))
	assert.True(t, snapshotContainsImage(imageDBSnapshot{ImagePaths: `["a.jpg"]`}, "a.jpg"))
	assert.False(t, snapshotContainsImage(imageDBSnapshot{ImagePaths: `["b.jpg"]`}, "a.jpg"))
}
