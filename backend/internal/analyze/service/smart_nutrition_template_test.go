package service

import (
	"context"
	"testing"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	"github.com/stretchr/testify/require"
)

func smartTemplateDish(name string, weight, kcal float64, visibility string, components ...[3]any) map[string]any {
	list := make([]any, 0, len(components))
	for _, c := range components {
		list = append(list, map[string]any{"name": c[0], "grams": c[1], "foodState": c[2]})
	}
	extra := map[string]any{"isComposite": true, "components": list}
	if visibility != "" {
		extra["oilVisibility"] = visibility
	}
	return smartItem(name, "cooked", weight, kcal, extra)
}

func dishCalories(item map[string]any) float64 {
	return numberFromAny(mapFromAny(item["nutrients"])["calories"])
}

func TestSmartDishUsesTheMethodDefaultWhenOilIsUnclear(t *testing.T) {
	// 青椒炒肉 200 g: the model guessed 2 g oil it could not see; stir-fry
	// default is 6.5% of the dish (13 g).
	item := smartTemplateDish("青椒炒肉", 200, 260, "unclear",
		[3]any{"青椒", 118.0, "熟"}, [3]any{"猪瘦肉", 80.0, "熟"}, [3]any{"植物油", 2.0, "熟"})
	items := runSmart(t, newSmartLibrary(), item)

	require.Equal(t, "matched_dish_reference", items[0]["smart_match_status"])
	note := mapFromAny(items[0]["dish_template"])
	require.Equal(t, "stir_fried", note["method"])
	require.InDelta(t, 13, numberFromAny(note["oil_grams_after"]), 0.01)
	// The meat share (40%) is inside the meat stir-fry range and stays; the
	// added oil comes out of the pepper.
	want := 107*0.22 + 80*2.00 + 13*8.99
	require.InDelta(t, want, dishCalories(items[0]), 0.5)
}

func TestSmartDishKeepsVisibleOilWithinTheMethodRange(t *testing.T) {
	inRange := smartTemplateDish("炒包菜", 130, 60, "visible", [3]any{"包菜", 122.0, "熟"}, [3]any{"植物油", 8.0, "熟"})
	items := runSmart(t, newSmartLibrary(), inRange)
	require.Nil(t, items[0]["dish_template"], "8 g of 130 g is a normal stir-fry")
	require.InDelta(t, 122*0.24+8*8.99, dishCalories(items[0]), 0.5)

	// 40 g oil in 200 g of stir-fried cabbage is above the 12% ceiling.
	tooMuch := smartTemplateDish("炒包菜", 200, 400, "visible", [3]any{"包菜", 160.0, "熟"}, [3]any{"植物油", 40.0, "熟"})
	items = runSmart(t, newSmartLibrary(), tooMuch)
	note := mapFromAny(items[0]["dish_template"])
	require.InDelta(t, 24, numberFromAny(note["oil_grams_after"]), 0.01)
}

func TestSmartDishAddsDefaultOilWhenTheSplitHasNone(t *testing.T) {
	item := smartTemplateDish("红烧茄子", 200, 150, "unclear", [3]any{"茄子", 195.0, "熟"}, [3]any{"酱油", 5.0, "熟"})
	items := runSmart(t, newSmartLibrary(), item)
	note := mapFromAny(items[0]["dish_template"])
	require.Equal(t, "braised", note["method"])
	require.InDelta(t, 0, numberFromAny(note["oil_grams_before"]), 0.01)
	require.InDelta(t, 10, numberFromAny(note["oil_grams_after"]), 0.01)
	// 190 g left for the eggplant and soy sauce in their 195:5 split; the
	// sauce keeps the model's share of its 4.75 g.
	require.InDelta(t, 185.25*0.24+10*8.99+150*4.75/200, dishCalories(items[0]), 0.5)
}

func TestSmartDishFencesTheStapleShare(t *testing.T) {
	// 300 g fried rice split as 120 g rice is outside the 55-90% range.
	item := smartTemplateDish("鸡蛋炒饭", 300, 520, "visible",
		[3]any{"米饭", 120.0, "熟"}, [3]any{"鸡蛋", 160.0, "熟"}, [3]any{"植物油", 20.0, "熟"})
	items := runSmart(t, newSmartLibrary(), item)
	note := mapFromAny(items[0]["dish_template"])
	require.Equal(t, "fried_rice", note["family"])
	require.InDelta(t, 165, numberFromAny(note["staple_grams_after"]), 0.01)
}

func TestSmartReferenceUsesTheCookedRowForCookedComponents(t *testing.T) {
	unit, label, ok := smartReferenceIngredientState("大米", "熟")
	require.True(t, ok)
	require.Equal(t, "大米(熟)", label)
	require.InDelta(t, 116, numberFromAny(unit["calories"]), 0.01, "cooked rice, not raw grain")

	unit, _, _ = smartReferenceIngredientState("大米", "生")
	require.InDelta(t, 346, numberFromAny(unit["calories"]), 0.01)

	unit, label, _ = smartReferenceIngredientState("肉片", "")
	require.Equal(t, "猪瘦肉(熟)", label, "an unstated dish component is cooked")
	require.InDelta(t, 200, numberFromAny(unit["calories"]), 0.01)

	_, label, _ = smartReferenceIngredientState("菠菜", "熟")
	require.Equal(t, "菠菜", label, "vegetables keep one row; their oil is listed apart")
}

func TestSmartStandardPreparedFoodSkipsTheSplit(t *testing.T) {
	library := newSmartLibrary()
	library.foods["卤蛋"] = foodrecorddomain.FoodNutrition{ID: "id-卤蛋", CanonicalName: "卤蛋", FoodState: "cooked", WeightBasis: "as_served", KcalPer100g: 157, ProteinPer100g: 13, CarbsPer100g: 3, FatPer100g: 10, IsActive: true, QualityTier: "legacy_curated"}
	item := smartTemplateDish("卤蛋", 50, 90, "", [3]any{"鸡蛋", 48.0, "熟"}, [3]any{"酱油", 2.0, "熟"})
	items := runSmart(t, library, item)
	require.Equal(t, "single", items[0]["smart_match_kind"])
	require.Equal(t, "卤蛋", items[0]["matched_food_name"])
}

func TestSmartAsksForTheLabelOnlyWhenNothingMatched(t *testing.T) {
	drink := smartItem("某品牌柠檬茶", "packaged", 500, 150, map[string]any{"type": "packaged", "brand": "某品牌"})
	small := smartItem("某品牌硬糖", "packaged", 5, 20, map[string]any{"type": "packaged", "brand": "某品牌"})
	items := runSmart(t, newSmartLibrary(), drink, small)
	require.Equal(t, true, items[0]["ask_package_label"], "a drink whose sugar is unknown")
	require.Nil(t, items[1]["ask_package_label"], "20 kcal of candy is not worth asking")

	labelled := smartItem("某品牌柠檬茶", "packaged", 500, 150, map[string]any{"type": "packaged", "brand": "某品牌",
		"ingredients": map[string]any{"nutritionPer100g": map[string]any{"calories": 30.0, "protein": 0.0, "carbs": 7.5, "fat": 0.0}}})
	items = runSmart(t, newSmartLibrary(), labelled)
	require.Nil(t, items[0]["ask_package_label"], "the label was already read")
}

func TestSmartPackagedHeadIsTheLastNoun(t *testing.T) {
	require.Equal(t, "派", smartPackagedHead("好丽友巧克力味派"))
	require.Equal(t, "酸牛奶", smartPackagedHead("完达山风味酸牛奶"))
	require.Equal(t, "牛奶糖", smartPackagedHead("旺仔牛奶糖"))
	require.Equal(t, "饼干", smartPackagedHead("山姆芝士夹心饼干"))
}

func TestSmartPackagedRejectsCerealForAPieAndMilkForYogurt(t *testing.T) {
	library := newSmartLibrary()
	library.search = []foodrecorddomain.PackagedFood{
		{ID: "cereal", Brand: "好丽友", ProductName: "好丽友 麦片(巧克力味)", DisplayName: "好丽友 麦片(巧克力味)", KcalPer100g: 400, IsActive: true},
		{ID: "milk", Brand: "NB", ProductName: "盒马NB 纯牛奶 250ml", DisplayName: "盒马NB 纯牛奶 250ml", KcalPer100g: 65, IsActive: true},
		{ID: "plain", Brand: "蒙牛", ProductName: "蒙牛 风味酸奶", DisplayName: "蒙牛 风味酸奶", KcalPer100g: 95, IsActive: true},
	}
	s := newSmartService(library)
	pie := smartItem("好丽友巧克力味派", "packaged", 34, 152, map[string]any{"type": "packaged", "brand": "好丽友"})
	yogurt := smartItem("桂花风味酸牛奶", "packaged", 200, 144, map[string]any{"type": "packaged", "brand": "NB"})
	sugarFree := smartItem("0蔗糖风味酸奶", "packaged", 100, 88, map[string]any{"type": "packaged", "brand": "蒙牛"})
	for _, item := range []map[string]any{pie, yogurt, sugarFree} {
		next, status := s.resolveSmartPackaged(context.Background(), item)
		require.Nil(t, next, "%s must not match (%s)", item["name"], status)
	}
}

func TestSmartSauceWithOilIsNotPureOil(t *testing.T) {
	require.False(t, smartIsCookingFat("酱汁(含植物油、淀粉、酱油)"))
	require.False(t, smartIsCookingFat("红油汤汁"))
	require.True(t, smartComponentIsOil("红油"), "the table maps 红油 to plain oil")
	require.True(t, smartComponentIsOil("植物油"))
	require.False(t, smartComponentIsOil("酱汁(含植物油、淀粉、酱油)"))
}
