package repo

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"food_link/backend/internal/utility/domain"
)

// Manual search ranking.
//
// Chinese names put the food itself last ("风味酸奶" is a yogurt, "酸奶土豆泥"
// is mashed potato), so a title that ends with the query names that food and
// one that only starts with it is usually a dish or flavour built on it.
//
// Whether the query names a packaged product decides which source leads:
// "八宝粥" or "薯片" show packaged products first, "米饭" or "包子" show the
// standard foods and canteen dishes first.

var manualBracketPattern = regexp.MustCompile(`[（(【\[][^）)】\]]*[）)】\]]`)

const (
	titleTierExact     = 0 // the title, or an approved alias, is the query
	titleTierQualified = 1 // equal once a bracketed note or pack size is removed: 八宝粥(同茂牌), 馒头 100g
	titleTierHeadNoun  = 2 // a name part ends with the query: 白米饭, 娃哈哈 八宝粥, Happy Egg 鸡蛋
	titleTierModifier  = 3 // the query is a flavour or ingredient: 酸奶土豆泥 for 酸奶
	titleTierNone      = 4 // matched through alias, description or merchant only
)

// packagedCategoryWords are product categories that are packaged even where
// the packaged library still has few rows for them.
var packagedCategoryWords = []string{
	"八宝粥", "火腿肠", "蛋白棒", "能量棒", "罐头", "辣条", "果冻", "泡面", "方便面", "自热火锅", "自热米饭",
	"威化", "蛋卷", "牛肉干", "猪肉脯", "乳酸菌", "养乐多", "苏打水", "气泡水", "矿泉水",
	"功能饮料", "运动饮料", "雪碧", "芬达", "可乐", "薯片", "饼干", "巧克力", "口香糖", "奶片", "棒棒糖",
}

const (
	packagedIntentMinRows = 20
	packagedIntentRatio   = 2
	packagedIntentScanCap = 400
)

// detectPackagedIntent reports whether the query names a packaged product:
// a known packaged category, or a name the packaged library carries far more
// often than the standard library and the canteens together.
func (r *ManualFoodRepo) detectPackagedIntent(ctx context.Context, query string) bool {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return false
	}
	for _, word := range packagedCategoryWords {
		if strings.HasSuffix(q, word) {
			return true
		}
	}
	if r == nil || r.db == nil {
		return false
	}
	suffix := "%" + q
	var counts struct {
		Packaged int `gorm:"column:packaged"`
		Standard int `gorm:"column:standard"`
		Canteen  int `gorm:"column:canteen"`
	}
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			(SELECT count(*) FROM (
				SELECT 1 FROM packaged_food_library f
				WHERE f.is_active = TRUE AND f.kcal_per_100g > 0
					AND COALESCE(NULLIF(f.review_status, ''), 'active') = 'active'
					AND (LOWER(COALESCE(f.product_name, '')) LIKE ? OR LOWER(COALESCE(f.display_name, '')) LIKE ?)
				LIMIT ?) p) AS packaged,
			(SELECT count(*) FROM (
				SELECT 1 FROM food_nutrition_library n
				WHERE n.is_active = TRUE AND n.kcal_per_100g > 0
					AND n.quality_tier IN ('authoritative','reviewed_estimate','legacy_curated')
					AND LOWER(n.canonical_name) LIKE ?
				LIMIT ?) s) AS standard,
			(SELECT count(*) FROM (
				SELECT DISTINCT LOWER(COALESCE(p.food_name, '')) FROM public_food_library p
				WHERE p.status = 'published' AND COALESCE(p.availability_status, '') <> 'unknown'
					AND LOWER(COALESCE(p.food_name, '')) LIKE ?
				LIMIT ?) c) AS canteen
	`, suffix, suffix, packagedIntentScanCap, suffix, packagedIntentScanCap, suffix, packagedIntentScanCap).Scan(&counts).Error
	if err != nil {
		// The non-packaged order is the safe default; search still works.
		return false
	}
	return counts.Packaged >= packagedIntentMinRows && counts.Packaged >= packagedIntentRatio*(counts.Standard+counts.Canteen)
}

// manualTitleTier grades how a title relates to the query.
func manualTitleTier(title, query string) int {
	q := strings.ToLower(strings.TrimSpace(query))
	t := strings.ToLower(strings.TrimSpace(title))
	if q == "" || t == "" {
		return titleTierNone
	}
	if t == q {
		return titleTierExact
	}
	core := manualBracketPattern.ReplaceAllString(t, " ")
	core = packagedSpecPattern.ReplaceAllString(core, " ")
	parts := strings.FieldsFunc(core, func(r rune) bool {
		return unicode.IsSpace(r) || r == '/' || r == '·' || r == '|' || r == '，' || r == ','
	})
	if len(parts) == 1 && parts[0] == q {
		return titleTierQualified
	}
	for _, part := range parts {
		if strings.HasSuffix(part, q) || endsWithShapeOf(part, q) {
			return titleTierHeadNoun
		}
	}
	if strings.Contains(t, q) {
		return titleTierModifier
	}
	return titleTierNone
}

// shapeSuffixes only describe the form a food is cut or pressed into:
// 燕麦片 and 鸡胸肉丁 are still oats and chicken breast.
var shapeSuffixes = []string{"片", "粒", "丁", "丝", "块", "段", "条"}

func endsWithShapeOf(part, q string) bool {
	for _, shape := range shapeSuffixes {
		if strings.HasSuffix(part, q+shape) {
			return true
		}
	}
	return false
}

// manualCoreLength is the title length without brackets and pack sizes, a
// stand-in for how generic a standard food is (白米饭 before 温州糯米饭).
func manualCoreLength(title string) int {
	core := manualBracketPattern.ReplaceAllString(strings.TrimSpace(title), "")
	core = packagedSpecPattern.ReplaceAllString(core, "")
	return len([]rune(strings.TrimSpace(core)))
}

func manualResultTier(item domain.ManualFoodResult, query string) int {
	if item.SearchExact {
		return titleTierExact
	}
	if strings.TrimSpace(item.SearchName) != "" {
		return manualTitleTier(item.SearchName, query)
	}
	return manualTitleTier(item.Title, query)
}

// hasLatinLetters marks imported rows such as "Always Fresh 鸡蛋": for the
// same closeness a Chinese-named standard food reads as the generic one.
func hasLatinLetters(s string) bool {
	for _, r := range s {
		if r < unicode.MaxASCII && unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

// isPersonalManualResult: the user's own custom foods, foods they logged
// before (recent and frequent rows carry a usage count) and collected meals.
func isPersonalManualResult(item domain.ManualFoodResult) bool {
	return (item.Source == "custom" && item.CanEdit) || item.UsageCount > 0 || item.Collected
}

// manualSourceRank orders sources for the query's intent. Shared custom foods
// from other users are user contributions and rank with the real meals.
func manualSourceRank(item domain.ManualFoodResult, packagedIntent bool) (group int, rank int) {
	packaged := item.Source == "packaged_food"
	if packagedIntent {
		switch {
		case packaged:
			return 0, 0
		case item.Source == "nutrition_library":
			return 1, 0
		default:
			return 1, 1
		}
	}
	switch {
	case packaged:
		return 1, 0
	case item.Source == "nutrition_library" || (item.Source == "custom" && item.CanEdit):
		return 0, 0
	default:
		return 0, 1
	}
}

// rankManualFoodResults orders merged search results:
//  1. titles that name the searched food (exact, qualified or head noun)
//     before titles that only mention it;
//  2. the user's own foods first;
//  3. the source group that fits the query (packaged products for a packaged
//     query, standard foods and canteen dishes otherwise);
//  4. closeness of the title (exact before qualified before head noun);
//  5. standard before canteen, then each source's own order.
//
// It keeps one canteen row per dish name and, for packaged queries, shows the
// best generic food at position 4 so a user without the package still finds
// it on the first screen.
//
// personalized is false for guests: their "frequent foods" come from every
// user's records, so a usage count there is not their own history.
func rankManualFoodResults(items []domain.ManualFoodResult, query string, packagedIntent bool, personalized bool) []domain.ManualFoodResult {
	type keyed struct {
		item     domain.ManualFoodResult
		tier     int
		relevant int
		personal int
		group    int
		rank     int
		score    float64
	}
	rows := make([]keyed, 0, len(items))
	for _, item := range items {
		tier := manualResultTier(item, query)
		relevant := 1
		if tier <= titleTierHeadNoun {
			relevant = 0
		}
		personal := 1
		if personalized && isPersonalManualResult(item) {
			personal = 0
		}
		group, rank := manualSourceRank(item, packagedIntent)
		rows = append(rows, keyed{item, tier, relevant, personal, group, rank, manualFoodDisplayScore(item, query)})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.relevant != b.relevant {
			return a.relevant < b.relevant
		}
		if a.personal != b.personal {
			return a.personal < b.personal
		}
		if a.relevant == 0 && a.group != b.group {
			return a.group < b.group
		}
		if a.tier != b.tier {
			return a.tier < b.tier
		}
		if a.group != b.group {
			return a.group < b.group
		}
		if a.rank != b.rank {
			return a.rank < b.rank
		}
		if a.item.Source == "nutrition_library" && b.item.Source == "nutrition_library" {
			if la, lb := hasLatinLetters(a.item.Title), hasLatinLetters(b.item.Title); la != lb {
				return !la
			}
			if ca, cb := manualCoreLength(a.item.Title), manualCoreLength(b.item.Title); ca != cb {
				return ca < cb
			}
		}
		if a.item.Source == b.item.Source && a.item.SearchOrder != b.item.SearchOrder {
			return a.item.SearchOrder < b.item.SearchOrder
		}
		if a.score != b.score {
			return a.score > b.score
		}
		if a.item.UsageCount != b.item.UsageCount {
			return a.item.UsageCount > b.item.UsageCount
		}
		if a.item.Title != b.item.Title {
			return a.item.Title < b.item.Title
		}
		if a.item.Source != b.item.Source {
			return a.item.Source < b.item.Source
		}
		return a.item.ID < b.item.ID
	})
	out := make([]domain.ManualFoodResult, 0, len(rows))
	seenCanteen := map[string]bool{}
	for _, row := range rows {
		if row.item.SourceLabel == "校园食堂" && row.personal == 1 {
			key := strings.ToLower(strings.TrimSpace(row.item.Title))
			if seenCanteen[key] {
				continue
			}
			seenCanteen[key] = true
		}
		out = append(out, row.item)
	}
	if packagedIntent {
		out = promoteGenericFood(out, query, 3)
	}
	return out
}

// promoteGenericFood moves the best non-packaged exact or qualified match to
// index pos when it would otherwise sit below it.
func promoteGenericFood(items []domain.ManualFoodResult, query string, pos int) []domain.ManualFoodResult {
	idx := -1
	for i, item := range items {
		if item.Source != "packaged_food" && manualResultTier(item, query) <= titleTierQualified {
			idx = i
			break
		}
	}
	if idx <= pos || pos >= len(items) {
		return items
	}
	generic := items[idx]
	out := make([]domain.ManualFoodResult, 0, len(items))
	out = append(out, items[:pos]...)
	out = append(out, generic)
	out = append(out, items[pos:idx]...)
	out = append(out, items[idx+1:]...)
	return out
}

// appendInSourceOrder records each row's position in its own source's
// ranking before the sources are merged.
func appendInSourceOrder(results []domain.ManualFoodResult, rows []domain.ManualFoodResult) []domain.ManualFoodResult {
	for i := range rows {
		rows[i].SearchOrder = i
	}
	return append(results, rows...)
}
