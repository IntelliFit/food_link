package foodmeasure

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFromAnyReadsDeclaredMeasurementFromJSONData(t *testing.T) {
	raw := map[string]any{
		"amount": 250.0, "unit": "ml", "basis_amount": 100.0, "basis_unit": "ml",
		"nutrients_per_basis": map[string]any{"calories": 78.4, "protein": 3.8},
	}
	m, ok := FromAny(raw)
	require.True(t, ok)
	assert.Equal(t, Milliliter, m.Unit)
	assert.Equal(t, 250.0, m.Amount)
	_, known := m.Grams()
	assert.False(t, known, "毫升没有换算关系时不折算成克")

	withConversion := map[string]any{
		"amount": 2.0, "unit": "piece", "basis_amount": 100.0, "basis_unit": "g",
		"nutrients_per_basis": map[string]any{"calories": 144.0}, "unit_conversions": map[string]any{"piece": 55.0},
	}
	m, ok = FromAny(withConversion)
	require.True(t, ok)
	grams, known := m.Grams()
	assert.True(t, known)
	assert.Equal(t, 110.0, grams)
	assert.Equal(t, withConversion, m.Map(), "写回条目时保持原来的 JSON 结构")
}

func TestFromAnyTreatsMissingOrInvalidMeasurementAsAbsent(t *testing.T) {
	valid := func() map[string]any {
		return map[string]any{"amount": 250.0, "unit": "ml", "basis_amount": 100.0, "basis_unit": "ml", "nutrients_per_basis": map[string]any{"calories": 78.4}}
	}
	cases := map[string]any{
		"缺失":       nil,
		"不是对象":     "250ml",
		"数量为零":     func() any { m := valid(); m["amount"] = 0.0; return m }(),
		"数量是文字":    func() any { m := valid(); m["amount"] = "250"; return m }(),
		"单位不支持":    func() any { m := valid(); m["unit"] = "cup"; return m }(),
		"缺少营养标示":   func() any { m := valid(); delete(m, "nutrients_per_basis"); return m }(),
		"跨单位却没有换算": func() any { m := valid(); m["unit"] = "piece"; return m }(),
	}
	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			_, ok := FromAny(value)
			assert.False(t, ok)
		})
	}
}

func TestUnitLabel(t *testing.T) {
	assert.Equal(t, "克", Gram.Label())
	assert.Equal(t, "毫升", Milliliter.Label())
	assert.Equal(t, "个", Piece.Label())
	assert.Equal(t, "份", Serving.Label())
}
