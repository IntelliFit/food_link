package foodmeasure

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNativeMeasurement(t *testing.T) {
	cases := []struct {
		name  string
		m     Measurement
		kcal  float64
		grams float64
		known bool
	}{
		{"mass", Measurement{Amount: 150, Unit: Gram, BasisAmount: 100, BasisUnit: Gram, NutrientsPerBasis: map[string]float64{"calories": 80}}, 120, 150, true},
		{"volume", Measurement{Amount: 250, Unit: Milliliter, BasisAmount: 100, BasisUnit: Milliliter, NutrientsPerBasis: map[string]float64{"calories": 60}}, 150, 0, false},
		{"count", Measurement{Amount: 2, Unit: Piece, BasisAmount: 1, BasisUnit: Piece, NutrientsPerBasis: map[string]float64{"calories": 80}}, 160, 0, false},
		{"serving", Measurement{Amount: 1, Unit: Serving, BasisAmount: 100, BasisUnit: Milliliter, NutrientsPerBasis: map[string]float64{"calories": 60}, UnitConversions: map[Unit]float64{Serving: 250}}, 150, 0, false},
		{"evidenced_mass", Measurement{Amount: 2, Unit: Piece, BasisAmount: 100, BasisUnit: Gram, NutrientsPerBasis: map[string]float64{"calories": 200}, UnitConversions: map[Unit]float64{Piece: 50}}, 200, 100, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, tc.m.Validate())
			totals, err := tc.m.Totals()
			require.NoError(t, err)
			assert.InDelta(t, tc.kcal, totals["calories"], 0.0001)
			grams, known := tc.m.Grams()
			assert.Equal(t, tc.known, known)
			assert.Equal(t, tc.grams, grams)
			_, known = tc.m.Convert(1, Milliliter, Gram)
			if tc.m.Unit == Milliliter {
				assert.False(t, known)
			}
		})
	}
}

func TestMeasurementRejectsUnprovenAndInvalidConversions(t *testing.T) {
	m := Measurement{Amount: 2, Unit: Piece, BasisAmount: 100, BasisUnit: Gram, NutrientsPerBasis: map[string]float64{"calories": 100}}
	require.Error(t, m.Validate())
	m.UnitConversions = map[Unit]float64{Piece: 30, Gram: 2}
	require.Error(t, m.Validate())
	m.UnitConversions = map[Unit]float64{Piece: 30}
	m.NutrientsPerBasis["calories"] = math.NaN()
	require.Error(t, m.Validate())
	m.NutrientsPerBasis["calories"] = 100
	m.Amount = math.Inf(1)
	require.Error(t, m.Validate())
}

func TestMeasurementScalesMicronutrientsAndCloneIsIndependent(t *testing.T) {
	m := Measurement{Amount: 250, Unit: Milliliter, BasisAmount: 100, BasisUnit: Milliliter, NutrientsPerBasis: map[string]float64{"calories": 60, "sodium_mg": 40}, UnitConversions: map[Unit]float64{Serving: 250}}
	totals, err := m.Totals()
	require.NoError(t, err)
	assert.Equal(t, 100.0, totals["sodium_mg"])
	copy := m.Clone()
	copy.NutrientsPerBasis["sodium_mg"] = 999
	copy.UnitConversions[Serving] = 10
	assert.Equal(t, 40.0, m.NutrientsPerBasis["sodium_mg"])
	assert.Equal(t, 250.0, m.UnitConversions[Serving])
}

func TestMeasurementConvertsToGramsOnlyWithExplicitRelation(t *testing.T) {
	m := Measurement{Amount: 1, Unit: Serving, BasisAmount: 100, BasisUnit: Milliliter, NutrientsPerBasis: map[string]float64{"calories": 60}, UnitConversions: map[Unit]float64{Serving: 250, Gram: 1 / 1.03}}
	require.NoError(t, m.Validate())
	grams, known := m.Grams()
	require.True(t, known)
	assert.InDelta(t, 257.5, grams, 0.0001)
	delete(m.UnitConversions, Gram)
	_, known = m.Grams()
	assert.False(t, known)
}
