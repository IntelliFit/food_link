package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
