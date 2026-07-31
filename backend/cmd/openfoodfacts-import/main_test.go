package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func validProductFixture() offProduct {
	return offProduct{
		Code: "3017620422003", ProductName: "Hazelnut cocoa spread", Brands: "Ferrero",
		Quantity: "400 g", ProductQuantity: 400.0, ProductQuantityUnit: "g",
		NutritionData: "on", Completeness: 0.9,
		ImageFrontURL:     "https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.1.400.jpg",
		ImageNutritionURL: "https://images.openfoodfacts.org/images/products/301/762/042/2003/nutrition_en.1.400.jpg",
		IngredientsText:   "sugar, hazelnuts, cocoa",
		Nutriments: map[string]any{
			"energy-kcal_100g": 539.0, "proteins_100g": 6.3,
			"carbohydrates_100g": 57.5, "fat_100g": 30.9,
			"sugars_100g": 56.3, "saturated-fat_100g": 10.6,
			"sodium_100g": 0.042,
		},
	}
}

func TestEvaluateProductAcceptsStrictEvidence(t *testing.T) {
	product := validProductFixture()
	score, reasons, ok := evaluateProduct(product, 0.75)
	require.True(t, ok)
	assert.GreaterOrEqual(t, score, 0.75)
	assert.Contains(t, reasons, "有效GTIN")
	assert.Contains(t, reasons, "含营养标签图片")
}

func TestEvaluateProductRejectsBadGTIN(t *testing.T) {
	product := validProductFixture()
	product.Code = "3017620422004"
	_, reasons, ok := evaluateProduct(product, 0.75)
	assert.False(t, ok)
	assert.Contains(t, reasons, "条码校验失败")
}

func TestEvaluateProductRejectsNutritionContradiction(t *testing.T) {
	product := validProductFixture()
	product.Nutriments["sugars_100g"] = 80.0
	_, reasons, ok := evaluateProduct(product, 0.75)
	assert.False(t, ok)
	assert.Contains(t, reasons, "糖高于总碳水")
}

func TestPackagedInputPreservesAttributionAndConvertsUnits(t *testing.T) {
	product := validProductFixture()
	item := candidate{
		Product: product, QualityScore: 0.93, QualityReasons: []string{"严格门禁"},
		ChineseSearchTerms: []string{"榛子可可酱"}, ChineseCategory: "甜味涂抹酱",
	}
	input := packagedInput(item, "pending")
	assert.Equal(t, openFoodFactsSource, input.Source)
	assert.Equal(t, openFoodFactsIngest, input.IngestMethod)
	assert.Equal(t, "3017620422003", input.Barcode)
	assert.Equal(t, 400.0, input.NetWeightG)
	assert.Equal(t, 42.0, input.SodiumMgPer100g)
	assert.Contains(t, input.SearchText, "榛子可可酱")
	assert.Equal(t, "ODbL 1.0", input.RawLabelPayload["database_license"])
	assert.Equal(t, "CC BY-SA", input.RawLabelPayload["image_license"])
	require.Len(t, input.SourceImageURLs, 2)
}

func TestEvenlySpacedIndices(t *testing.T) {
	assert.Equal(t, []int{0, 3, 6, 9}, evenlySpacedIndices(10, 4))
	assert.Equal(t, []int{0}, evenlySpacedIndices(1, 4))
	assert.Equal(t, 2576, evenlySpacedIndices(10200, 100)[25])
}

func TestParseServingGrams(t *testing.T) {
	assert.Equal(t, 30.0, parseServingGrams("1 serving (30 g)"))
	assert.Equal(t, 25.0, parseServingGrams("每份 25克"))
	assert.Zero(t, parseServingGrams("200 ml"))
}

func TestProductFromCSVMapsStrictImportFields(t *testing.T) {
	header := []string{"code", "product_name", "brands", "quantity", "countries_tags", "categories_tags", "ingredients_text", "image_url", "image_nutrition_url", "completeness", "data_quality_errors_tags", "product_quantity", "last_modified_t", "unique_scans_n", "energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g"}
	columns := map[string]int{}
	for index, name := range header {
		columns[name] = index
	}
	record := []string{"3017620422003", "Hazelnut cocoa spread", "Ferrero", "400 g", "en:france,en:china", "en:spreads", "sugar", "https://images.openfoodfacts.org/front.jpg", "https://images.openfoodfacts.org/nutrition.jpg", "0.91", "", "400", "1780000000", "12345", "539", "6.3", "57.5", "30.9"}
	product := productFromCSV(record, columns)
	assert.True(t, csvRowPassesCoreGate(record, columns, 0.75))
	assert.Equal(t, "g", product.ProductQuantityUnit)
	assert.Equal(t, 12345, product.UniqueScans)
	assert.Contains(t, product.CountriesTags, "en:china")
	assert.Equal(t, "539", product.Nutriments["energy-kcal_100g"])
}
