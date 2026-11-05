package service

import (
	"context"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"food_link/backend/pkg/logger"
)

// Asking the vision model to read brand fields made it report whole-package
// weights, so the brand is instead recognised inside the item name the model
// already writes ("金百味咸鸭蛋"), using the brands of the packaged library.

type packagedBrandLister interface {
	ListPackagedBrands(context.Context) ([]string, error)
}

type smartBrandKey struct {
	key   string
	brand string
}

const smartBrandIndexTTL = time.Hour

var smartBrandIndex struct {
	mu       sync.Mutex
	loadedAt time.Time
	keys     []smartBrandKey
}

// smartBrandStopKeys are brand fragments that are ordinary food words.
var smartBrandStopKeys = map[string]bool{"食品": true, "原味": true, "有机": true, "牌": true, "有限公司": true, "零食": true, "饮料": true, "牛奶": true, "酸奶": true, "面包": true, "饼干": true, "坚果": true}

func (s *AnalyzeService) smartKnownBrands(ctx context.Context) []smartBrandKey {
	lister, ok := s.nutrition.(packagedBrandLister)
	if !ok {
		return nil
	}
	smartBrandIndex.mu.Lock()
	defer smartBrandIndex.mu.Unlock()
	if time.Since(smartBrandIndex.loadedAt) < smartBrandIndexTTL {
		return smartBrandIndex.keys
	}
	brands, err := lister.ListPackagedBrands(ctx)
	if err != nil {
		logger.Warn(ctx, "包装食品品牌列表读取失败，本次不识别品牌", logger.Err(err))
		return smartBrandIndex.keys
	}
	smartBrandIndex.keys = smartBuildBrandKeys(brands)
	smartBrandIndex.loadedAt = time.Now()
	logger.Info(ctx, "包装食品品牌列表已加载", slog.Int("brand_count", len(brands)), slog.Int("key_count", len(smartBrandIndex.keys)))
	return smartBrandIndex.keys
}

// smartBuildBrandKeys indexes every brand by its whole key and by each part
// ("乐事（Lay's）" -> "乐事lays", "乐事", "lays"), longest first.
func smartBuildBrandKeys(brands []string) []smartBrandKey {
	seen := map[string]bool{}
	keys := []smartBrandKey{}
	add := func(key, brand string) {
		if runeCount(key) < 2 || seen[key] || smartBrandStopKeys[key] || smartPackagedHead(key) == key {
			return
		}
		seen[key] = true
		keys = append(keys, smartBrandKey{key: key, brand: brand})
	}
	for _, brand := range brands {
		brand = strings.TrimSpace(brand)
		add(smartTextKey(brand), brand)
		for _, part := range strings.FieldsFunc(brand, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '\'' }) {
			add(smartTextKey(part), brand)
		}
	}
	sort.SliceStable(keys, func(i, j int) bool { return runeCount(keys[i].key) > runeCount(keys[j].key) })
	return keys
}

// smartDetectBrand finds a known brand at the start of the name, or anywhere
// in it when the brand is at least three characters long.
func smartDetectBrand(name string, keys []smartBrandKey) (string, string) {
	nameKey := smartTextKey(name)
	for _, key := range keys {
		if strings.HasPrefix(nameKey, key.key) && runeCount(nameKey) > runeCount(key.key) {
			return key.brand, key.key
		}
	}
	for _, key := range keys {
		if runeCount(key.key) >= 3 && strings.Contains(nameKey, key.key) && nameKey != key.key {
			return key.brand, key.key
		}
	}
	return "", ""
}

// smartDetectBrandedProduct finds a known brand followed by a product kind,
// so "百事可乐" qualifies and "皇冠梨" does not. Such an item is only treated
// as packaged once the package reading confirms the brand: "康师傅牛肉面" can
// be a restaurant bowl.
func smartDetectBrandedProduct(name string, keys []smartBrandKey) (string, string) {
	brand, key := smartDetectBrand(name, keys)
	if brand == "" || smartPackagedHead(strings.Replace(smartTextKey(name), key, "", 1)) == "" {
		return "", ""
	}
	return brand, key
}

// smartWithDetectedBrands returns copies of packaged items with the brand and
// product name taken from the item name when the model did not supply them.
func (s *AnalyzeService) smartWithDetectedBrands(ctx context.Context, items []map[string]any) []map[string]any {
	var keys []smartBrandKey
	out := make([]map[string]any, len(items))
	for index, item := range items {
		out[index] = item
		if !smartLooksPackaged(item) || smartPackagedField(item, "brand", "brandName") != "" {
			continue
		}
		if keys == nil {
			keys = s.smartKnownBrands(ctx)
			if keys == nil {
				keys = []smartBrandKey{}
			}
		}
		name := stringFromAny(item["name"])
		brand, key := smartDetectBrand(name, keys)
		if brand == "" {
			continue
		}
		next := copyAnyMap(item)
		next["brand"] = brand
		next["brand_source"] = "name"
		if smartPackagedField(item, "productName", "product_name") == "" {
			if product := smartStripBrandKey(name, key); product != "" {
				next["productName"] = product
			}
		}
		out[index] = next
	}
	return out
}

// smartStripBrandKey removes the brand from the start of a name, comparing
// letters and digits only so "T.O.GETHER黑浓咖啡" also loses its brand.
func smartStripBrandKey(name, key string) string {
	matched := []rune{}
	target := []rune(key)
	for index, r := range name {
		if len(matched) == len(target) {
			return strings.TrimSpace(name[index:])
		}
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			continue
		}
		if unicode.ToLower(r) != target[len(matched)] {
			return name
		}
		matched = append(matched, unicode.ToLower(r))
	}
	return name
}
