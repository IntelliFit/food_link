package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRoundPackagedFoodInputNutrients(t *testing.T) {
	input := &PackagedFoodInput{
		KcalPer100g:              460.00000001,
		ProteinPer100g:           7.3456789,
		CarbsPer100g:             52.123456,
		FatPer100g:               22.98765,
		FiberPer100g:             1.255,
		SugarPer100g:             31.499999,
		SaturatedFatPer100g:      5.555,
		CholesterolMgPer100g:     0.0,
		SodiumMgPer100g:          315.7,
		PotassiumMgPer100g:       120.3,
		CalciumMgPer100g:         45.6,
		IronMgPer100g:            2.34,
		MagnesiumMgPer100g:       18.9,
		ZincMgPer100g:            0.76,
		VitaminARaeMcgPer100g:    0.12345,
		VitaminCMgPer100g:        0.0,
		VitaminDMcgPer100g:       0.009,
		VitaminEMgPer100g:        0.98765,
		VitaminKMcgPer100g:       1.23456,
		ThiaminMgPer100g:         0.055,
		RiboflavinMgPer100g:      0.066,
		NiacinMgPer100g:          0.077,
		VitaminB6MgPer100g:       0.088,
		FolateMcgPer100g:         0.099,
		VitaminB12McgPer100g:     0.011,
	}

	roundPackagedFoodInputNutrients(input)

	assert.Equal(t, 460.0, input.KcalPer100g)
	assert.Equal(t, 7.3, input.ProteinPer100g)
	assert.Equal(t, 52.1, input.CarbsPer100g)
	assert.Equal(t, 23.0, input.FatPer100g)
	assert.Equal(t, 1.3, input.FiberPer100g)
	assert.Equal(t, 31.5, input.SugarPer100g)
	assert.Equal(t, 5.6, input.SaturatedFatPer100g)
	assert.Equal(t, 0.0, input.CholesterolMgPer100g)
	assert.Equal(t, 316.0, input.SodiumMgPer100g)
	assert.Equal(t, 120.0, input.PotassiumMgPer100g)
	assert.Equal(t, 46.0, input.CalciumMgPer100g)
	assert.Equal(t, 2.0, input.IronMgPer100g)
	assert.Equal(t, 19.0, input.MagnesiumMgPer100g)
	assert.Equal(t, 1.0, input.ZincMgPer100g)
	assert.Equal(t, 0.12, input.VitaminARaeMcgPer100g)
	assert.Equal(t, 0.0, input.VitaminCMgPer100g)
	assert.Equal(t, 0.01, input.VitaminDMcgPer100g)
	assert.Equal(t, 0.99, input.VitaminEMgPer100g)
	assert.Equal(t, 1.23, input.VitaminKMcgPer100g)
	assert.Equal(t, 0.06, input.ThiaminMgPer100g)
	assert.Equal(t, 0.07, input.RiboflavinMgPer100g)
	assert.Equal(t, 0.08, input.NiacinMgPer100g)
	assert.Equal(t, 0.09, input.VitaminB6MgPer100g)
	assert.Equal(t, 0.1, input.FolateMcgPer100g)
	assert.Equal(t, 0.01, input.VitaminB12McgPer100g)
}

func TestRoundPackagedNutritionMap(t *testing.T) {
	in := map[string]any{
		"calories":       460.00000001,
		"protein":        7.3456789,
		"carbs":          52.123456,
		"fat":            22.98765,
		"sodiumMg":       315.7,
		"vitaminCMg":     0.98765,
		"unknownField":   "keep",
	}

	out := RoundPackagedNutritionMap(in)

	assert.Equal(t, 460.0, out["calories"])
	assert.Equal(t, 7.3, out["protein"])
	assert.Equal(t, 52.1, out["carbs"])
	assert.Equal(t, 23.0, out["fat"])
	assert.Equal(t, 316.0, out["sodiumMg"])
	assert.Equal(t, 0.99, out["vitaminCMg"])
	assert.Equal(t, "keep", out["unknownField"])
}
