package service

import (
	"context"
	"errors"
	"testing"
	"time"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	"github.com/stretchr/testify/require"
)

type smartPackageReadLibrary struct{ *smartLibrary }

func (smartPackageReadLibrary) ListPackagedBrands(context.Context) ([]string, error) {
	return []string{"乐事", "百事", "康师傅"}, nil
}

func resetSmartBrandIndex() {
	smartBrandIndex.mu.Lock()
	smartBrandIndex.loadedAt = time.Time{}
	smartBrandIndex.mu.Unlock()
}

func packageReadResult(packages ...map[string]any) map[string]any {
	out := make([]any, len(packages))
	for i, p := range packages {
		out[i] = p
	}
	return map[string]any{"packages": out}
}

func newPackageReadService(t *testing.T, reader *channelFixture, library *smartLibrary) *AnalyzeService {
	t.Helper()
	resetSmartBrandIndex()
	t.Cleanup(resetSmartBrandIndex)
	s := newBalancedRoutingService(t, balancedChannels{
		wanjie:  &channelFixture{err: errors.New("wanjie unused")},
		openlux: reader,
		a6:      &channelFixture{err: errors.New("a6 down")},
	})
	s.ConfigureNutritionResolver(smartPackageReadLibrary{library})
	return s
}

func runPackageRead(t *testing.T, s *AnalyzeService, items ...map[string]any) (map[string]any, []map[string]any) {
	t.Helper()
	resp := s.withSmartPackageReading(standardVisionCtx(), map[string]any{"items": items}, AnalyzeInput{ImageURL: "image"}, defaultExecutionMode)
	resp = s.applySmartNutrition(context.Background(), resp)
	return resp, toItems(resp["items"])
}

func chipLibrary() *smartLibrary {
	library := newSmartLibrary()
	library.search = []foodrecorddomain.PackagedFood{
		{ID: "lays-original", Brand: "乐事", ProductName: "原味薯片", KcalPer100g: 546, ProteinPer100g: 6, CarbsPer100g: 52, FatPer100g: 34, IsActive: true},
	}
	return library
}

func TestSmartPackageReadSetsBrandAndSealedWeightThenMatchesLibrary(t *testing.T) {
	reader := &channelFixture{result: packageReadResult(map[string]any{
		"index": 1, "brand": "乐事", "productName": "原味薯片", "unitNetContent": 25, "unitNetContentUnit": "g", "unitCount": 1, "packageState": "sealed",
	})}
	s := newPackageReadService(t, reader, chipLibrary())

	resp, items := runPackageRead(t, s,
		smartItem("白米饭", "cooked", 150, 174, nil),
		smartItem("薯片", "packaged", 40, 215, map[string]any{"type": "snack"}),
	)
	require.Equal(t, int32(1), reader.calls.Load())
	chips := items[1]
	require.Equal(t, "乐事", chips["brand"])
	require.Equal(t, "package_label", chips["weight_source"])
	require.InDelta(t, 25, numberFromAny(chips["estimatedWeightGrams"]), 0.01, "a sealed package weighs its net content")
	require.Equal(t, "lays-original", chips["packaged_food_id"])
	require.InDelta(t, 546*0.25, numberFromAny(mapFromAny(chips["nutrients"])["calories"]), 0.5)
	require.Equal(t, "matched_exact_state_inferred", items[0]["smart_match_status"], "ordinary items are untouched")
	require.Equal(t, "completed", mapFromAny(resp["smart_package_read"])["status"])
}

func TestSmartPackageReadPrefersReadableNutritionPanel(t *testing.T) {
	reader := &channelFixture{result: packageReadResult(map[string]any{
		"index": 0, "brand": "乐事", "productName": "原味薯片", "unitNetContent": 70, "unitNetContentUnit": "g", "unitCount": 1, "packageState": "opened",
		"nutritionPer100": map[string]any{"energyKJ": 2240, "protein": 6, "fat": 33, "carbs": 53},
	})}
	s := newPackageReadService(t, reader, chipLibrary())

	_, items := runPackageRead(t, s, smartItem("薯片", "packaged", 30, 160, map[string]any{"type": "snack"}))
	chips := items[0]
	require.Equal(t, "ingredient_label", chips["nutrition_source"])
	require.Equal(t, "label_kept", chips["smart_match_status"])
	require.InDelta(t, 30, numberFromAny(chips["estimatedWeightGrams"]), 0.01, "an opened package keeps the photo weight")
	require.InDelta(t, 2240/4.184*0.3, numberFromAny(mapFromAny(chips["nutrients"])["calories"]), 0.5)
}

func TestSmartPackageReadIgnoresPanelThatContradictsItself(t *testing.T) {
	require.Nil(t, smartLabelPer100(map[string]any{"energyKcal": 120, "protein": 6, "fat": 33, "carbs": 53}))
	require.Nil(t, smartLabelPer100(map[string]any{"energyKcal": 0, "protein": 0, "fat": 0, "carbs": 0}))
	require.NotNil(t, smartLabelPer100(map[string]any{"energyKJ": 180, "protein": 0, "fat": 0, "carbs": 10.6}), "a cola panel has only carbohydrate")
}

func TestSmartPackageReadKeepsItemsWhenReadFails(t *testing.T) {
	reader := &channelFixture{err: errors.New("openlux down")}
	s := newPackageReadService(t, reader, chipLibrary())

	resp, items := runPackageRead(t, s, smartItem("薯片", "packaged", 40, 215, map[string]any{"type": "snack"}))
	require.Equal(t, "failed", mapFromAny(resp["smart_package_read"])["status"])
	require.InDelta(t, 40, numberFromAny(items[0]["estimatedWeightGrams"]), 0.01)
	require.Equal(t, "packaged_without_brand", items[0]["smart_match_status"])
}

func TestSmartPackageReadSkipsMealsWithoutPackagedFood(t *testing.T) {
	reader := &channelFixture{result: packageReadResult()}
	s := newPackageReadService(t, reader, chipLibrary())

	resp, _ := runPackageRead(t, s, smartItem("白米饭", "cooked", 150, 174, nil), smartItem("皇冠梨", "raw", 200, 90, nil))
	require.Zero(t, reader.calls.Load(), "皇冠 is a brand but 梨 is not a packaged product kind")
	require.Nil(t, resp["smart_package_read"])
}

func TestSmartPackageReadRejectsImplausibleLabelWeight(t *testing.T) {
	reading := smartPackageReading{net: 1500, unit: "g", count: 1, state: "sealed"}
	_, ok := smartSealedPackageWeight(reading, 30)
	require.False(t, ok, "a family-pack net content is not what one photo shows")
	weight, ok := smartSealedPackageWeight(smartPackageReading{net: 330, unit: "ml", count: 2, state: "sealed"}, 500)
	require.True(t, ok)
	require.InDelta(t, 660, weight, 0.01)
}

func TestSmartBrandedNameNeedsPackageConfirmation(t *testing.T) {
	keys := smartBuildBrandKeys([]string{"百事", "Danisa 皇冠"})
	brand, _ := smartDetectBrandedProduct("百事可乐", keys)
	require.Equal(t, "百事", brand)
	brand, _ = smartDetectBrandedProduct("皇冠梨", keys)
	require.Empty(t, brand)

	// The reader sees no package, so the restaurant-style item stays ordinary.
	reader := &channelFixture{result: packageReadResult(map[string]any{"index": 0, "brand": "", "packageState": "unknown"})}
	s := newPackageReadService(t, reader, chipLibrary())
	_, items := runPackageRead(t, s, smartItem("百事可乐", "liquid", 330, 140, nil))
	require.Equal(t, int32(1), reader.calls.Load())
	require.Empty(t, items[0]["brand"])
	require.NotEqual(t, string(smartKindPackaged), items[0]["smart_match_kind"])
}

func TestSmartPackagedRejectsDryNoodlesForCookedBowl(t *testing.T) {
	library := newSmartLibrary()
	library.search = []foodrecorddomain.PackagedFood{
		{ID: "ksf-noodle", Brand: "康师傅", ProductName: "红烧牛肉面", KcalPer100g: 411, IsActive: true},
	}
	items := runSmart(t, library, smartItem("康师傅红烧牛肉面", "cooked", 600, 540, map[string]any{"type": "snack", "brand": "康师傅", "productName": "红烧牛肉面"}))
	require.Equal(t, "packaged_density_mismatch", items[0]["smart_match_status"])
	require.InDelta(t, 540, numberFromAny(mapFromAny(items[0]["nutrients"])["calories"]), 0.01)
}

func TestSmartLibraryBrandUsesNameWhenPackageSpellingDiffers(t *testing.T) {
	keys := smartBuildBrandKeys([]string{"可口可乐", "特仑苏"})
	require.Equal(t, "可口可乐", smartLibraryBrand(smartPackageReading{brand: "Coke"}, "可口可乐", keys))
	require.Equal(t, "特仑苏", smartLibraryBrand(smartPackageReading{brand: "特仑苏", product: "纯牛奶"}, "牛奶", keys))
	require.Equal(t, "完达山", smartLibraryBrand(smartPackageReading{brand: "完达山"}, "纯牛奶", keys), "an unknown brand is kept as read")
	require.Empty(t, smartLibraryBrand(smartPackageReading{}, "可口可乐", keys), "the name alone never makes a brand")
}

func TestSmartBrandedPackagedMissFallsBackToGenericRow(t *testing.T) {
	library := newSmartLibrary()
	library.foods["牛奶(全脂)"] = foodrecorddomain.FoodNutrition{ID: "milk", CanonicalName: "牛奶(全脂)", KcalPer100g: 65, ProteinPer100g: 3.2, CarbsPer100g: 4.8, FatPer100g: 3.6, IsActive: true, QualityTier: "legacy_curated", Source: "项目内置初始营养数据"}
	items := runSmart(t, library, smartItem("特仑苏纯牛奶", "liquid", 250, 180, map[string]any{"type": "snack", "brand": "特仑苏", "productName": "纯牛奶"}))
	require.Equal(t, string(smartKindSingle), items[0]["smart_match_kind"])
	require.Equal(t, "milk", items[0]["matched_food_id"], "the product name finds the generic row")
	require.Equal(t, "特仑苏纯牛奶", items[0]["name"])
}

func TestSmartSealedWeightSnapsToWholePackagesNearThePhoto(t *testing.T) {
	weight, ok := smartSealedPackageWeight(smartPackageReading{net: 190, unit: "ml", count: 2, state: "sealed"}, 195)
	require.True(t, ok)
	require.InDelta(t, 190, weight, 0.01, "two cartons in view, one drunk")
	_, ok = smartSealedPackageWeight(smartPackageReading{net: 400, unit: "g", count: 1, state: "sealed"}, 80)
	require.False(t, ok, "a sealed bread bag is not the two slices eaten")
	weight, ok = smartSealedPackageWeight(smartPackageReading{net: 25, unit: "g", count: 1, state: "sealed"}, 50)
	require.True(t, ok)
	require.InDelta(t, 25, weight, 0.01, "a small pack the photo overestimated")
}

func TestSmartPackageLabelWeightKeepsEdibleRatio(t *testing.T) {
	item := smartItem("去皮鸭腿", "cooked", 90, 230, map[string]any{"type": "snack", "grossWeightGrams": 120.0})
	next, applied := applySmartPackageReading(item, smartPackageReading{net: 132, unit: "g", count: 1, state: "sealed"})
	require.Contains(t, applied, "weight")
	require.InDelta(t, 132, numberFromAny(next["grossWeightGrams"]), 0.01)
	require.InDelta(t, 99, numberFromAny(next["estimatedWeightGrams"]), 0.01, "the bone share from the photo is kept")
}

func TestSmartPackagedFallbackNeverDropsQualifiers(t *testing.T) {
	library := newSmartLibrary()
	library.foods["牛奶(全脂)"] = foodrecorddomain.FoodNutrition{ID: "milk", CanonicalName: "牛奶(全脂)", KcalPer100g: 65, IsActive: true, QualityTier: "legacy_curated", Source: "项目内置初始营养数据"}
	items := runSmart(t, library, smartItem("脱脂纯牛奶", "liquid", 250, 85, map[string]any{"type": "snack", "brand": "三元", "productName": "纯牛奶"}))
	require.NotEqual(t, "milk", items[0]["matched_food_id"], "skim milk must not become whole milk")
	require.Equal(t, []string{"特仑苏纯牛奶", "纯牛奶"}, smartPackagedFallbackNames(map[string]any{"name": "特仑苏纯牛奶", "brand": "特仑苏"}))
}
