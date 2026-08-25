package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
)

func number(value float64) *float64 { return &value }

func validSourceRow(sequence int, name string) sourceRow {
	return sourceRow{
		Sequence: sequence, SearchTerm: name, ActualName: name, Basis: "每100克可食部",
		Kcal: number(100), EnergyKJ: number(418), Carbs: number(20), Protein: number(4), Fat: number(1),
	}
}

func TestBuildCandidatesRejectsCaptureErrorsAndMissingCoreNutrition(t *testing.T) {
	rows := []sourceRow{
		validSourceRow(1, "鸡蛋"),
		{Sequence: 2, SearchTerm: "鸡汤", ActualName: "收藏", Basis: "每100克可食部"},
		func() sourceRow { row := validSourceRow(3, "缺脂肪食物"); row.Fat = nil; return row }(),
	}

	candidates, rejected := buildCandidates(rows, "/tmp/source.xlsx", defaultSource)

	require.Len(t, candidates, 1)
	assert.Equal(t, "鸡蛋", candidates[0].CanonicalName)
	require.Len(t, rejected, 2)
	assert.Contains(t, rejected[0].Reason, "收藏")
	assert.Contains(t, rejected[1].Reason, "禁止按0推断")
}

func TestBuildCandidatesPreservesOptionalMissingFieldsAsEvidence(t *testing.T) {
	row := validSourceRow(1, "白米饭")
	row.Fiber = nil
	row.Sugar = nil
	row.Sodium = number(2)

	candidates, rejected := buildCandidates([]sourceRow{row}, "/tmp/source.xlsx", defaultSource)

	require.Empty(t, rejected)
	require.Len(t, candidates, 1)
	assert.Zero(t, candidates[0].Fiber)
	assert.Equal(t, []string{"糖(g)", "膳食纤维(g)"}, candidates[0].Evidence["missing_fields"])
}

func TestBuildCandidatesRejectsNormalizedDuplicates(t *testing.T) {
	first := validSourceRow(1, "芬达 汽水（酸梅汤味）")
	second := validSourceRow(2, "芬达汽水(酸梅汤味)")

	candidates, rejected := buildCandidates([]sourceRow{first, second}, "/tmp/source.xlsx", defaultSource)

	require.Len(t, candidates, 1)
	require.Len(t, rejected, 1)
	assert.Contains(t, rejected[0].Reason, "重复")
}

func TestSplitCellReference(t *testing.T) {
	column, row := splitCellReference("O1003")
	assert.Equal(t, "O", column)
	assert.Equal(t, 1003, row)
}

func TestImportedRowsRemainInactiveUntilSourceEvidenceIsReviewed(t *testing.T) {
	assert.Equal(t, "unreviewed", defaultQualityTier)
}

func TestApprovedExactAliasIsTreatedAsExistingFood(t *testing.T) {
	conflict := &aliasAuditConflict{FoodID: "existing-food", TargetName: "纯牛奶", MatchStatus: "approved_exact"}

	assert.True(t, isApprovedAliasDuplicate(existingFood{}, false, conflict))
	assert.True(t, isApprovedAliasDuplicate(existingFood{ID: "imported-food"}, true, conflict))
	assert.False(t, isApprovedAliasDuplicate(existingFood{ID: "existing-food"}, true, conflict))
}

func TestUnapprovedAliasDoesNotCauseAutomaticDeduplication(t *testing.T) {
	for _, status := range []string{"candidate_only", "blocked"} {
		conflict := &aliasAuditConflict{FoodID: "other-food", MatchStatus: status}
		assert.False(t, isApprovedAliasDuplicate(existingFood{}, false, conflict), status)
	}
}

func TestAuditApprovesConsistentImportedFood(t *testing.T) {
	candidate := importCandidate{
		Sequence: 1, CanonicalName: "鸡蛋（煮）", NormalizedName: normalizeName("鸡蛋（煮）"),
		Kcal: 151, Protein: 12.1, Carbs: 3.1, Fat: 10.5,
		Evidence: datatypes.JSONMap{"search_term": "鸡蛋（煮）", "missing_fields": []string{"糖(g)"}},
	}
	food := persistedAuditFood{
		ID: "food-1", CanonicalName: candidate.CanonicalName, NormalizedName: candidate.NormalizedName,
		Kcal: candidate.Kcal, Protein: candidate.Protein, Carbs: candidate.Carbs, Fat: candidate.Fat,
	}

	entry := classifyAuditFood(food, candidate, nil)

	assert.Equal(t, "approved", entry.Decision)
	assert.Empty(t, entry.ReasonCodes)
	assert.Equal(t, []string{"糖(g)"}, entry.MissingFields)
}

func TestAuditHoldsSearchTitleIdentityMismatch(t *testing.T) {
	candidate := importCandidate{
		Sequence: 610, CanonicalName: "辣夫人 滕椒馍片", NormalizedName: normalizeName("辣夫人 滕椒馍片"),
		Kcal: 354, Protein: 8, Carbs: 62, Fat: 8,
		Evidence: datatypes.JSONMap{"search_term": "云南鬼鸡"},
	}
	food := persistedAuditFood{
		ID: "food-610", CanonicalName: candidate.CanonicalName, NormalizedName: candidate.NormalizedName,
		Kcal: candidate.Kcal, Protein: candidate.Protein, Carbs: candidate.Carbs, Fat: candidate.Fat,
	}

	entry := classifyAuditFood(food, candidate, nil)

	assert.Equal(t, "needs_user_review", entry.Decision)
	assert.Contains(t, entry.ReasonCodes, "search_title_identity_mismatch")
}

func TestAuditHoldsAmbiguousTitleAndAliasConflict(t *testing.T) {
	candidate := importCandidate{
		Sequence: 212, CanonicalName: "面 (没有)", NormalizedName: normalizeName("面 (没有)"),
		Kcal: 100, Protein: 4, Carbs: 20, Fat: 1,
		Evidence: datatypes.JSONMap{"search_term": "面 (没有)"},
	}
	food := persistedAuditFood{
		ID: "food-212", CanonicalName: candidate.CanonicalName, NormalizedName: candidate.NormalizedName,
		Kcal: candidate.Kcal, Protein: candidate.Protein, Carbs: candidate.Carbs, Fat: candidate.Fat,
	}
	conflict := &aliasAuditConflict{FoodID: "other-food", TargetName: "面条", MatchStatus: "approved_exact"}

	entry := classifyAuditFood(food, candidate, conflict)

	assert.Equal(t, "needs_user_review", entry.Decision)
	assert.Contains(t, entry.ReasonCodes, "short_split_title_ambiguous")
	assert.Contains(t, entry.ReasonCodes, "alias_owned_by_other_food")
	assert.Equal(t, "other-food", entry.ConflictFoodID)
}

func TestAuditHoldsPhysicallyImpossibleMacronutrientTotal(t *testing.T) {
	candidate := importCandidate{
		Sequence: 1, CanonicalName: "异常食物", NormalizedName: normalizeName("异常食物"),
		Kcal: 500, Protein: 50, Carbs: 50, Fat: 10,
		Evidence: datatypes.JSONMap{"search_term": "异常食物"},
	}
	food := persistedAuditFood{
		ID: "food-1", CanonicalName: candidate.CanonicalName, NormalizedName: candidate.NormalizedName,
		Kcal: candidate.Kcal, Protein: candidate.Protein, Carbs: candidate.Carbs, Fat: candidate.Fat,
	}

	entry := classifyAuditFood(food, candidate, nil)

	assert.Equal(t, "needs_user_review", entry.Decision)
	assert.Contains(t, entry.ReasonCodes, "macronutrients_exceed_100g")
}
