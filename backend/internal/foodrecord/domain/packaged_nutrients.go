package domain

// PackagedLabelNutrients keeps the normalized per-100 label data, including
// micronutrients, when reconstructing a snapshot for a legacy volume client.
func (p PackagedFood) PackagedLabelNutrients() map[string]float64 {
	return map[string]float64{
		"calories": p.KcalPer100g, "protein": p.ProteinPer100g, "carbs": p.CarbsPer100g, "fat": p.FatPer100g,
		"fiber": p.FiberPer100g, "sugar": p.SugarPer100g, "saturatedFat": p.SaturatedFatPer100g,
		"cholesterolMg": p.CholesterolMgPer100g, "sodium_mg": p.SodiumMgPer100g,
		"potassiumMg": p.PotassiumMgPer100g, "calciumMg": p.CalciumMgPer100g,
		"ironMg": p.IronMgPer100g, "magnesiumMg": p.MagnesiumMgPer100g, "zincMg": p.ZincMgPer100g,
		"vitaminARaeMcg": p.VitaminARaeMcgPer100g, "vitaminCMg": p.VitaminCMgPer100g,
		"vitaminDMcg": p.VitaminDMcgPer100g, "vitaminEMg": p.VitaminEMgPer100g, "vitaminKMcg": p.VitaminKMcgPer100g,
		"thiaminMg": p.ThiaminMgPer100g, "riboflavinMg": p.RiboflavinMgPer100g, "niacinMg": p.NiacinMgPer100g,
		"vitaminB6Mg": p.VitaminB6MgPer100g, "folateMcg": p.FolateMcgPer100g, "vitaminB12Mcg": p.VitaminB12McgPer100g,
	}
}
