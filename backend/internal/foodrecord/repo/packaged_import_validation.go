package repo

import (
	"fmt"
	"math"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
)

// A matching barcode or a legacy product key is not permission to replace a
// known SKU with a contradictory brand, flavor or package amount.
func rejectConflictingPackagedIdentity(existing domain.PackagedFood, input PackagedProductNormalizedFields, flavor string) error {
	conflict := false
	if strings.TrimSpace(existing.Brand) != "" && strings.TrimSpace(input.Brand) != "" {
		matched := normalizeFoodName(existing.Brand) == normalizeFoodName(input.Brand)
		for _, old := range packagedFoodBrandTerms(existing.Brand) {
			for _, next := range packagedFoodBrandTerms(input.Brand) {
				if old == next {
					matched = true
				}
			}
		}
		conflict = !matched
	}
	oldUnit, oldAmount := normalizeContentUnit(derefString(existing.NetContentUnit)), existing.NetContentValue
	if oldAmount <= 0 && existing.NetWeightG > 0 {
		oldAmount, oldUnit = existing.NetWeightG, "g"
	}
	if oldAmount > 0 && input.NetContentValue > 0 {
		conflict = conflict || oldUnit != input.NetContentUnit || math.Abs(oldAmount-input.NetContentValue) > math.Max(0.1, oldAmount*0.01)
	}
	oldFlavor, newFlavor := normalizeFoodName(derefString(existing.FlavorText)), normalizeFoodName(flavor)
	if oldFlavor != "" && newFlavor != "" {
		oldFlavor, newFlavor = strings.TrimSuffix(oldFlavor, "味"), strings.TrimSuffix(newFlavor, "味")
		equivalent := oldFlavor == newFlavor || (runeCount(oldFlavor) >= 2 && runeCount(newFlavor) >= 2 && (strings.Contains(oldFlavor, newFlavor) || strings.Contains(newFlavor, oldFlavor)))
		conflict = conflict || !equivalent
	}
	if conflict {
		return &commonerrors.AppError{Code: 10002, Message: "该条目的品牌、口味或规格与现有商品冲突，请分开录入或通过纠错审核修改", HTTPStatus: 409}
	}
	return nil
}

func rejectProtectedPackagedImport(item domain.PackagedFood) error {
	if _, protected := item.RawLabelPayload["data_cleanup"]; protected {
		return &commonerrors.AppError{Code: 10002, Message: "该食物已有营养核对记录，请通过纠错审核更新，不能由重复导入覆盖", HTTPStatus: 409}
	}
	return nil
}

func ValidatePackagedFoodInput(input PackagedFoodInput) error {
	basis := strings.TrimSpace(input.NutritionBasisUnit)
	if basis == "" {
		// Legacy requests explicitly name their fields per_100g. Retain that
		// contract for mass, but never use it to guess a liquid's label basis.
		if strings.EqualFold(strings.TrimSpace(input.NetContentUnit), "ml") || input.NetContentUnit == "毫升" {
			return fmt.Errorf("液体食品缺少营养计量基准，请确认每100毫升或每100克")
		}
		basis = "100g"
	}
	return domain.ValidateLibraryNutrition(basis, map[string]float64{
		"calories": input.KcalPer100g, "protein": input.ProteinPer100g,
		"carbs": input.CarbsPer100g, "fat": input.FatPer100g,
		"sugar": input.SugarPer100g, "saturatedFat": input.SaturatedFatPer100g,
		"fiber":         input.FiberPer100g,
		"cholesterolMg": input.CholesterolMgPer100g, "sodiumMg": input.SodiumMgPer100g,
		"potassiumMg": input.PotassiumMgPer100g, "calciumMg": input.CalciumMgPer100g,
		"ironMg": input.IronMgPer100g, "magnesiumMg": input.MagnesiumMgPer100g,
		"zincMg": input.ZincMgPer100g, "vitaminARaeMcg": input.VitaminARaeMcgPer100g,
		"vitaminCMg": input.VitaminCMgPer100g, "vitaminDMcg": input.VitaminDMcgPer100g,
		"vitaminEMg": input.VitaminEMgPer100g, "vitaminKMcg": input.VitaminKMcgPer100g,
		"thiaminMg": input.ThiaminMgPer100g, "riboflavinMg": input.RiboflavinMgPer100g,
		"niacinMg": input.NiacinMgPer100g, "vitaminB6Mg": input.VitaminB6MgPer100g,
		"folateMcg": input.FolateMcgPer100g, "vitaminB12Mcg": input.VitaminB12McgPer100g,
	})
}
