package service

import (
	"encoding/json"
	"food_link/backend/internal/foodrecord/domain"
	foodrepo "food_link/backend/internal/foodrecord/repo"
	"strings"
)

func validateActivePackagedImport(item *domain.PackagedFood) error {
	if !item.IsActive || (item.ReviewStatus != "" && item.ReviewStatus != "active") {
		return nil
	}
	str := func(v *string) string {
		if v == nil {
			return ""
		}
		return *v
	}
	return foodrepo.ValidatePackagedFoodInput(foodrepo.PackagedFoodInput{
		NutritionBasisUnit: str(item.NutritionBasisUnit), NetContentUnit: str(item.NetContentUnit),
		KcalPer100g: item.KcalPer100g, ProteinPer100g: item.ProteinPer100g, CarbsPer100g: item.CarbsPer100g, FatPer100g: item.FatPer100g,
		SugarPer100g: item.SugarPer100g, SaturatedFatPer100g: item.SaturatedFatPer100g, FiberPer100g: item.FiberPer100g,
		CholesterolMgPer100g: item.CholesterolMgPer100g, SodiumMgPer100g: item.SodiumMgPer100g,
		PotassiumMgPer100g: item.PotassiumMgPer100g, CalciumMgPer100g: item.CalciumMgPer100g,
		IronMgPer100g: item.IronMgPer100g, MagnesiumMgPer100g: item.MagnesiumMgPer100g,
		ZincMgPer100g: item.ZincMgPer100g, VitaminARaeMcgPer100g: item.VitaminARaeMcgPer100g,
		VitaminCMgPer100g: item.VitaminCMgPer100g, VitaminDMcgPer100g: item.VitaminDMcgPer100g,
		VitaminEMgPer100g: item.VitaminEMgPer100g, VitaminKMcgPer100g: item.VitaminKMcgPer100g,
		ThiaminMgPer100g: item.ThiaminMgPer100g, RiboflavinMgPer100g: item.RiboflavinMgPer100g,
		NiacinMgPer100g: item.NiacinMgPer100g, VitaminB6MgPer100g: item.VitaminB6MgPer100g,
		FolateMcgPer100g: item.FolateMcgPer100g, VitaminB12McgPer100g: item.VitaminB12McgPer100g,
	})
}

func validatePackagedImportPatch(current *domain.PackagedFood, patch map[string]any) error {
	check := false
	for key, value := range patch {
		if strings.HasSuffix(key, "_per_100g") || key == "nutrition_basis_unit" || key == "net_content_unit" || (key == "is_active" && value == true) || (key == "review_status" && value == "active") {
			check = true
		}
	}
	if !check {
		return nil
	}
	base, err := json.Marshal(current)
	if err != nil {
		return err
	}
	var merged map[string]any
	if err = json.Unmarshal(base, &merged); err != nil {
		return err
	}
	for key, value := range patch {
		merged[key] = value
	}
	encoded, err := json.Marshal(merged)
	if err != nil {
		return err
	}
	var item domain.PackagedFood
	if err = json.Unmarshal(encoded, &item); err != nil {
		return err
	}
	return validateActivePackagedImport(&item)
}
