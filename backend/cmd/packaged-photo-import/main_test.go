package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordservice "food_link/backend/internal/foodrecord/service"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeApplyPolicy(t *testing.T) {
	assert.Equal(t, applyPolicyAudit, normalizeApplyPolicy(""))
	assert.Equal(t, applyPolicyAudit, normalizeApplyPolicy("audit"))
	assert.Equal(t, applyPolicyBackfillMissing, normalizeApplyPolicy("backfill-missing"))
	assert.Equal(t, applyPolicyReplaceHighConfidence, normalizeApplyPolicy("replace-high-confidence"))
	assert.Empty(t, normalizeApplyPolicy("legacy"))
}

func TestIsTransientVisionError(t *testing.T) {
	assert.True(t, isTransientVisionError(errors.New(`Post "https://yunwu.ai/v1/chat/completions": context deadline exceeded (Client.Timeout exceeded while awaiting headers)`)))
	assert.True(t, isTransientVisionError(errors.New("unexpected EOF")))
	assert.True(t, isTransientVisionError(errors.New("502 Bad Gateway")))
	assert.False(t, isTransientVisionError(errors.New("结构化结果缺少品名")))
}

func TestCompareExtractWithExistingBackfillsMissingPackageFields(t *testing.T) {
	extract := &foodrecordservice.PackagedProductExtractResult{
		Brand:           "桃李",
		ProductName:     "豆沙小饼面包",
		FlavorText:      "红豆沙",
		SpecText:        "净含量:55克",
		NetWeightG:      55,
		SourceImageURLs: []string{"https://example.com/front.jpg"},
		UnitNutritionPer100g: map[string]any{
			"calories": 362.0,
			"protein":  7.2,
			"carbs":    58.0,
			"fat":      9.0,
		},
	}
	existing := &foodrecorddomain.PackagedFood{
		Brand:       "桃李",
		ProductName: "豆沙小饼面包",
	}

	changed, conflicts := compareExtractWithExisting(extract, existing)

	assert.ElementsMatch(t, []string{
		"flavor_text",
		"spec_text",
		"net_weight_g",
		"kcal_per_100g",
		"protein_per_100g",
		"carbs_per_100g",
		"fat_per_100g",
		"source_image_urls",
	}, changed)
	assert.Empty(t, conflicts)
}

func TestCompareExtractWithExistingMarksWeightConflict(t *testing.T) {
	extract := &foodrecordservice.PackagedProductExtractResult{
		Brand:       "士力架",
		ProductName: "士力架花生夹心巧克力",
		SpecText:    "2条装 净含量70克",
		NetWeightG:  70,
	}
	existing := &foodrecorddomain.PackagedFood{
		Brand:       "士力架",
		ProductName: "士力架花生夹心巧克力",
		NetWeightG:  35,
	}

	changed, conflicts := compareExtractWithExisting(extract, existing)

	assert.Contains(t, conflicts, "net_weight_g")
	assert.NotContains(t, changed, "net_weight_g")
}

func TestBuildPatchValuesBackfillDoesNotOverwriteConflicts(t *testing.T) {
	extract := &foodrecordservice.PackagedProductExtractResult{
		FlavorText: "红豆沙",
		SpecText:   "净含量:55克",
		NetWeightG: 55,
	}
	delta := &deltaDecision{
		ChangedFields:  []string{"flavor_text", "spec_text"},
		ConflictFields: []string{"net_weight_g"},
	}

	patch := buildPatchValues(extract, delta, applyPolicyBackfillMissing, foodrecordservice.PackagedImportIngestOptions{})

	assert.Equal(t, "红豆沙", patch["flavor_text"])
	assert.Equal(t, "净含量:55克", patch["spec_text"])
	assert.NotContains(t, patch, "net_weight_g")
}

func TestBuildPatchValuesReplaceHighConfidenceUsesWeightEvidence(t *testing.T) {
	extract := &foodrecordservice.PackagedProductExtractResult{
		SpecText:          "2条装 净含量70克",
		OCRRawText:        "士力架 2条装 净含量70克",
		NetWeightG:        70,
		ExtractConfidence: 0.92,
		FieldConfidence:   map[string]any{"spec_text": 0.9},
	}
	delta := &deltaDecision{ConflictFields: []string{"net_weight_g", "spec_text"}}

	patch := buildPatchValues(extract, delta, applyPolicyReplaceHighConfidence, foodrecordservice.PackagedImportIngestOptions{})

	assert.Equal(t, 70.0, patch["net_weight_g"])
	assert.Equal(t, "2条装 净含量70克", patch["spec_text"])
}

func TestSelectGroupsCanRerunFailedOnly(t *testing.T) {
	groups := []foodrecordservice.PackagedPhotoGroup{
		{ID: "group-001"},
		{ID: "group-002"},
		{ID: "group-003"},
	}
	state := importState{Entries: map[string]stateEntry{
		"group-001": {Status: "error"},
		"group-002": {Status: "ingested"},
		"group-003": {Status: "ready"},
	}}

	selected := selectGroups(groups, state, 0, 0, true, nil)

	assert.Len(t, selected, 1)
	assert.Equal(t, "group-001", selected[0].ID)
}

func TestSelectGroupsRerunErrorsFromIgnoresStateFilter(t *testing.T) {
	groups := []foodrecordservice.PackagedPhotoGroup{
		{ID: "group-001"},
		{ID: "group-002"},
		{ID: "group-003"},
	}
	state := importState{Entries: map[string]stateEntry{
		"group-001": {Status: "ready"},
		"group-002": {Status: "ingested"},
		"group-003": {Status: "ready"},
	}}
	failedGroups := map[string]bool{"group-001": true, "group-002": true}

	selected := selectGroups(groups, state, 0, 0, true, failedGroups)

	require.Len(t, selected, 1)
	assert.Equal(t, "group-001", selected[0].ID)
}

func TestLoadFailedGroupIDsFromResultsJSONL(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "results.jsonl")
	require.NoError(t, os.WriteFile(path, []byte(
		`{"group_id":"group-001","error":"timeout"}`+"\n"+
			`{"group_id":"group-002","error":""}`+"\n"+
			`{"group_id":"group-003","error":"EOF"}`+"\n",
	), 0o644))

	failed, err := loadFailedGroupIDs(path)

	assert.NoError(t, err)
	assert.True(t, failed["group-001"])
	assert.True(t, failed["group-003"])
	assert.False(t, failed["group-002"])
}
