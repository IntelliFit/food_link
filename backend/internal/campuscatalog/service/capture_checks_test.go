package service

import (
	"testing"

	"food_link/backend/internal/campuscatalog/domain"
)

func capturePassWith(lines [][]string, items ...capturePassItem) *capturePass {
	pass := &capturePass{Items: items}
	for index, imageLines := range lines {
		pass.Images = append(pass.Images, capturePassImage{Index: index, IsMenu: true, Readable: true, Lines: imageLines})
	}
	return pass
}

func dishItem(image int, name string, prices ...float64) capturePassItem {
	return capturePassItem{ImageIndex: image, Name: name, Prices: prices, Kind: "dish"}
}

func findCaptureItem(t *testing.T, items []domain.CaptureItem, name string) domain.CaptureItem {
	t.Helper()
	for _, item := range items {
		if item.Name == name {
			return item
		}
	}
	t.Fatalf("item %q not found in %+v", name, items)
	return domain.CaptureItem{}
}

func assertCaptureStatus(t *testing.T, item domain.CaptureItem, status string, reasons ...string) {
	t.Helper()
	if item.Status != status {
		t.Fatalf("%s status = %s (reasons %v), want %s", item.Name, item.Status, item.Reasons, status)
	}
	for _, want := range reasons {
		found := false
		for _, got := range item.Reasons {
			if got == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("%s reasons = %v, want %s", item.Name, item.Reasons, want)
		}
	}
}

// Mirrors IMG_20260713_182748: a two-column screen the verifier may read as
// one merged row per line.
func TestReconcileCapturePassesTwoColumnMenuPasses(t *testing.T) {
	lines := [][]string{{"紫荆园", "泰式烤猪颈肉 11元 柠檬酸汤鱼 14元", "香茅草烤鸡 8.5元"}}
	primary := capturePassWith(lines, dishItem(0, "泰式烤猪颈肉", 11), dishItem(0, "柠檬酸汤鱼", 14), dishItem(0, "香茅草烤鸡", 8.5))
	verifier := capturePassWith(lines, dishItem(0, "柠檬酸汤鱼", 14), dishItem(0, "泰式烤猪颈肉", 11), dishItem(0, "香茅草烤鸡", 8.5))

	items := reconcileCapturePasses([]string{"asset-1"}, primary, verifier)

	if len(items) != 3 {
		t.Fatalf("items = %d, want 3", len(items))
	}
	for _, item := range items {
		assertCaptureStatus(t, item, domain.CaptureItemPassed)
		if len(item.AssetIDs) != 1 || item.AssetIDs[0] != "asset-1" {
			t.Fatalf("%s assets = %v", item.Name, item.AssetIDs)
		}
	}
}

// Mirrors IMG_20260713_182644: the 6元 belongs to the combo; giving it to an
// option dish must not pass.
func TestReconcileCapturePassesKeepsComboPriceOffOptions(t *testing.T) {
	lines := [][]string{{"两荤一素套餐 6.0元", "炸鸡饭 8.0元", "土豆鸡块 芹菜鸡丁", "麻婆豆腐 宫保鸡丁"}}
	combo := capturePassItem{ImageIndex: 0, Name: "两荤一素套餐", Prices: []float64{6}, Kind: "combo",
		OptionGroups: []domain.CaptureOptionGroup{{Title: "可选菜", Choices: []string{"土豆鸡块", "芹菜鸡丁", "麻婆豆腐", "宫保鸡丁"}}}}
	primary := capturePassWith(lines, combo, dishItem(0, "炸鸡饭", 8), dishItem(0, "土豆鸡块", 6))
	verifier := capturePassWith(lines, combo, dishItem(0, "炸鸡饭", 8))

	items := reconcileCapturePasses([]string{"a"}, primary, verifier)

	assertCaptureStatus(t, findCaptureItem(t, items, "两荤一素套餐"), domain.CaptureItemPassed)
	assertCaptureStatus(t, findCaptureItem(t, items, "炸鸡饭"), domain.CaptureItemPassed)
	assertCaptureStatus(t, findCaptureItem(t, items, "土豆鸡块"), domain.CaptureItemException, domain.ReasonPassesDisagree, domain.ReasonPriceNotGrounded)
}

// Mirrors IMG_20260713_182623: three price tiers on their own lines.
func TestReconcileCapturePassesPriceTiersOnFollowingLines(t *testing.T) {
	lines := [][]string{{"水果捞套餐", "5元", "8元", "15元", "爆爆珠三选一", "芒果味", "草莓味", "苹果味"}}
	item := capturePassItem{ImageIndex: 0, Name: "水果捞套餐", Prices: []float64{15, 5, 8}, Kind: "combo",
		OptionGroups: []domain.CaptureOptionGroup{{Title: "爆爆珠三选一", Choices: []string{"芒果味", "草莓味", "苹果味"}}}}
	items := reconcileCapturePasses([]string{"a"}, capturePassWith(lines, item), capturePassWith(lines, item))

	got := findCaptureItem(t, items, "水果捞套餐")
	assertCaptureStatus(t, got, domain.CaptureItemPassed)
	if !samePrices(got.Prices, []float64{5, 8, 15}) {
		t.Fatalf("prices = %v", got.Prices)
	}
}

func TestReconcileCapturePassesOptionNotOnPhotoIsException(t *testing.T) {
	lines := [][]string{{"两荤一素套餐 6元", "土豆鸡块"}}
	combo := capturePassItem{ImageIndex: 0, Name: "两荤一素套餐", Prices: []float64{6}, Kind: "combo",
		OptionGroups: []domain.CaptureOptionGroup{{Choices: []string{"土豆鸡块", "红烧肉"}}}}
	items := reconcileCapturePasses([]string{"a"}, capturePassWith(lines, combo), capturePassWith(lines, combo))
	assertCaptureStatus(t, items[0], domain.CaptureItemException, domain.ReasonOptionsUngrounded)
}

func TestReconcileCapturePassesKeepsOnlyWrittenUnits(t *testing.T) {
	lines := [][]string{{"生煎包 2.5元", "牛肉 3元/两"}}
	shengjian := capturePassItem{ImageIndex: 0, Name: "生煎包", Prices: []float64{2.5}, Unit: "份", Kind: "dish"}
	beef := capturePassItem{ImageIndex: 0, Name: "牛肉", Prices: []float64{3}, Unit: "元/两", Kind: "ingredient"}
	bare := capturePassItem{ImageIndex: 0, Name: "生煎包", Prices: []float64{2.5}, Unit: "元", Kind: "dish"}
	items := reconcileCapturePasses([]string{"a"}, capturePassWith(lines, shengjian, beef), capturePassWith(lines, bare, beef))

	got := findCaptureItem(t, items, "生煎包")
	assertCaptureStatus(t, got, domain.CaptureItemPassed)
	if got.PriceUnit != "" {
		t.Fatalf("unwritten unit kept: %q", got.PriceUnit)
	}
	if unit := findCaptureItem(t, items, "牛肉").PriceUnit; unit != "两" {
		t.Fatalf("written unit = %q, want 两", unit)
	}
}

// Mirrors 182852 + 182858: the same 15元 dish on two screens of one window.
func TestReconcileCapturePassesMergesSameDishAcrossPhotos(t *testing.T) {
	lines := [][]string{{"手工虾仁烧麦15元", "肥牛粉丝汤12元"}, {"老上海大馄饨 9元", "手工虾仁烧麦 15元"}}
	primary := capturePassWith(lines, dishItem(0, "手工虾仁烧麦", 15), dishItem(0, "肥牛粉丝汤", 12), dishItem(1, "老上海大馄饨", 9), dishItem(1, "手工虾仁烧麦", 15))
	verifier := capturePassWith(lines, dishItem(0, "手工虾仁烧麦", 15), dishItem(0, "肥牛粉丝汤", 12), dishItem(1, "老上海大馄饨", 9), dishItem(1, "手工虾仁烧麦", 15))

	items := reconcileCapturePasses([]string{"img-a", "img-b"}, primary, verifier)

	if len(items) != 3 {
		t.Fatalf("items = %d, want 3 after merging", len(items))
	}
	got := findCaptureItem(t, items, "手工虾仁烧麦")
	assertCaptureStatus(t, got, domain.CaptureItemPassed)
	if len(got.AssetIDs) != 2 {
		t.Fatalf("merged assets = %v", got.AssetIDs)
	}
}

func TestReconcileCapturePassesFlagsSameNameDifferentPrice(t *testing.T) {
	lines := [][]string{{"红烧肉 12元"}, {"红烧肉 15元"}}
	items := reconcileCapturePasses([]string{"a", "b"},
		capturePassWith(lines, dishItem(0, "红烧肉", 12), dishItem(1, "红烧肉", 15)),
		capturePassWith(lines, dishItem(0, "红烧肉", 12), dishItem(1, "红烧肉", 15)))
	if len(items) != 2 {
		t.Fatalf("items = %d", len(items))
	}
	for _, item := range items {
		assertCaptureStatus(t, item, domain.CaptureItemException, domain.ReasonPriceConflict)
	}
}

func TestReconcileCapturePassesWithoutVerifierNeverPasses(t *testing.T) {
	lines := [][]string{{"阳春面 6元"}}
	items := reconcileCapturePasses([]string{"a"}, capturePassWith(lines, dishItem(0, "阳春面", 6)), nil)
	assertCaptureStatus(t, items[0], domain.CaptureItemException, domain.ReasonVerifierFailed)
}

func TestReconcileCapturePassesKeepsVerifierOnlyItemAsException(t *testing.T) {
	lines := [][]string{{"阳春面 6元", "葱油拌面 7元"}}
	items := reconcileCapturePasses([]string{"a"},
		capturePassWith(lines, dishItem(0, "阳春面", 6)),
		capturePassWith(lines, dishItem(0, "阳春面", 6), dishItem(0, "葱油拌面", 7)))
	assertCaptureStatus(t, findCaptureItem(t, items, "阳春面"), domain.CaptureItemPassed)
	assertCaptureStatus(t, findCaptureItem(t, items, "葱油拌面"), domain.CaptureItemException, domain.ReasonMissedByPrimary)
}

func TestReconcileCapturePassesShortNameInsideLongerName(t *testing.T) {
	lines := [][]string{{"鸡排饭 13元", "鸡排 9元"}}
	items := reconcileCapturePasses([]string{"a"},
		capturePassWith(lines, dishItem(0, "鸡排", 9), dishItem(0, "鸡排饭", 13)),
		capturePassWith(lines, dishItem(0, "鸡排", 9), dishItem(0, "鸡排饭", 13)))
	assertCaptureStatus(t, findCaptureItem(t, items, "鸡排"), domain.CaptureItemPassed)
	assertCaptureStatus(t, findCaptureItem(t, items, "鸡排饭"), domain.CaptureItemPassed)
}

// Mirrors IMG_20260713_182744: vertical captions may be transcribed one
// character per line.
func TestReconcileCapturePassesVerticalText(t *testing.T) {
	lines := [][]string{{"马", "来", "奶", "油", "大", "虾", "15", "元"}}
	items := reconcileCapturePasses([]string{"a"},
		capturePassWith(lines, dishItem(0, "马来奶油大虾", 15)),
		capturePassWith(lines, dishItem(0, "马来奶油大虾", 15)))
	assertCaptureStatus(t, items[0], domain.CaptureItemPassed)
}

func TestReconcileCapturePassesAdjacentLineNumbersDoNotFuse(t *testing.T) {
	lines := [][]string{{"小炒肉 15", "8元 青菜"}}
	items := reconcileCapturePasses([]string{"a"},
		capturePassWith(lines, dishItem(0, "小炒肉", 158)),
		capturePassWith(lines, dishItem(0, "小炒肉", 158)))
	assertCaptureStatus(t, items[0], domain.CaptureItemException, domain.ReasonPriceNotGrounded)
}

func TestReconcileCapturePassesKindDisagreementIsException(t *testing.T) {
	lines := [][]string{{"土豆 0.8元"}}
	primary := capturePassWith(lines, dishItem(0, "土豆", 0.8))
	verifier := capturePassWith(lines, capturePassItem{ImageIndex: 0, Name: "土豆", Prices: []float64{0.8}, Kind: "ingredient"})
	items := reconcileCapturePasses([]string{"a"}, primary, verifier)
	assertCaptureStatus(t, items[0], domain.CaptureItemException, domain.ReasonKindDisagree)
}

func TestReconcileCapturePassesKeepsBracketVariantAsOneItem(t *testing.T) {
	lines := [][]string{{"如意蒸（汤）饺 10元"}}
	items := reconcileCapturePasses([]string{"a"},
		capturePassWith(lines, dishItem(0, "如意蒸（汤）饺", 10)),
		capturePassWith(lines, dishItem(0, "如意蒸(汤)饺", 10)))
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	assertCaptureStatus(t, items[0], domain.CaptureItemPassed)
	if items[0].Note == "" {
		t.Fatal("bracket variant note missing")
	}
}

func TestReconcileCapturePassesRejectsInvalidValues(t *testing.T) {
	lines := [][]string{{"12345 6元", "豪华大餐 888元"}}
	items := reconcileCapturePasses([]string{"a"},
		capturePassWith(lines, dishItem(0, "12345", 6), dishItem(0, "豪华大餐", 888)),
		capturePassWith(lines, dishItem(0, "12345", 6), dishItem(0, "豪华大餐", 888)))
	assertCaptureStatus(t, findCaptureItem(t, items, "12345"), domain.CaptureItemException, domain.ReasonNameInvalid)
	assertCaptureStatus(t, findCaptureItem(t, items, "豪华大餐"), domain.CaptureItemException, domain.ReasonPriceOutOfRange)
}

// Mirrors IMG_20260713_182720_1: when the primary reads a self-select price
// list as ingredients and the verifier calls them dishes, the safe reading
// (ingredient, never a public dish) wins without a review.
func TestReconcileCapturePassesPrimaryIngredientWins(t *testing.T) {
	lines := [][]string{{"土豆 0.8元", "西兰花 1.0元"}}
	primary := capturePassWith(lines, capturePassItem{ImageIndex: 0, Name: "土豆", Prices: []float64{0.8}, Kind: "ingredient"})
	verifier := capturePassWith(lines, dishItem(0, "土豆", 0.8))
	items := reconcileCapturePasses([]string{"a"}, primary, verifier)
	assertCaptureStatus(t, items[0], domain.CaptureItemPassed)
	if items[0].Kind != domain.CaptureKindIngredient {
		t.Fatalf("kind = %s, want ingredient", items[0].Kind)
	}
}

// Mirrors IMG_20260713_182720_1 when both models call the add-on prices
// dishes: the board rule stops them, the self-select window type keeps them.
func TestSelfSelectBoardIsNeverPublishedAsDishes(t *testing.T) {
	lines := [][]string{{"土豆 0.8元", "大白菜 0.8元", "生菜 0.8元", "青笋 1.0元", "西兰花 1.0元", "腐竹 1.0元"}}
	names := map[string]float64{"土豆": 0.8, "大白菜": 0.8, "生菜": 0.8, "青笋": 1, "西兰花": 1, "腐竹": 1}
	passItems := []capturePassItem{}
	for name, price := range names {
		passItems = append(passItems, dishItem(0, name, price))
	}
	items := reconcileCapturePasses([]string{"a"}, capturePassWith(lines, passItems...), capturePassWith(lines, passItems...))
	for _, item := range items {
		assertCaptureStatus(t, item, domain.CaptureItemException, domain.ReasonSelfSelectSuspect)
	}
	for _, item := range applyCaptureServiceMode(items, "self_select") {
		assertCaptureStatus(t, item, domain.CaptureItemPassed)
		if item.Kind != domain.CaptureKindIngredient {
			t.Fatalf("%s kind = %s, want ingredient", item.Name, item.Kind)
		}
	}
}

func TestCheapBreakfastLinesAreNotTreatedAsBoardBelowThreshold(t *testing.T) {
	lines := [][]string{{"肉包 2元", "菜包 1.5元", "豆浆 1.5元", "油条 2元", "鸡蛋 1元"}}
	passItems := []capturePassItem{dishItem(0, "肉包", 2), dishItem(0, "菜包", 1.5), dishItem(0, "豆浆", 1.5), dishItem(0, "油条", 2), dishItem(0, "鸡蛋", 1)}
	items := reconcileCapturePasses([]string{"a"}, capturePassWith(lines, passItems...), capturePassWith(lines, passItems...))
	for _, item := range items {
		assertCaptureStatus(t, item, domain.CaptureItemPassed)
	}
}
