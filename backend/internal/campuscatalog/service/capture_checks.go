package service

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"food_link/backend/internal/campuscatalog/domain"
)

// captureMaxPrice bounds a single canteen line item. Anything above it is far
// more likely an OCR merge ("15" + "8元" -> "158") than a real student meal.
const captureMaxPrice = 300.0

// capturePass is one model's reading of the same ordered menu photos.
type capturePass struct {
	Images []capturePassImage
	Items  []capturePassItem
	Model  string
}

type capturePassImage struct {
	Index    int
	IsMenu   bool
	Readable bool
	Lines    []string
	Note     string
}

type capturePassItem struct {
	ImageIndex   int
	Name         string
	PriceText    string
	Prices       []float64
	Unit         string
	Kind         string
	OptionGroups []domain.CaptureOptionGroup
}

// reconcileCapturePasses turns two independent readings into stored items.
// An item passes only when both models list it with the same prices and kind
// and the verifier's own transcription contains its name, prices and options.
// Everything else is kept as an exception instead of being guessed.
func reconcileCapturePasses(assetIDs []string, primary, verifier *capturePass) []domain.CaptureItem {
	if primary == nil {
		return nil
	}
	verifierTexts := map[int]captureImageText{}
	verifierByName := map[string][]int{}
	if verifier != nil {
		for _, image := range verifier.Images {
			verifierTexts[image.Index] = newCaptureImageText(image.Lines)
		}
		for index, item := range verifier.Items {
			key := normalizeCaptureText(item.Name)
			verifierByName[key] = append(verifierByName[key], index)
		}
	}
	matchedVerifier := map[int]bool{}
	items := make([]domain.CaptureItem, 0, len(primary.Items))
	for _, raw := range primary.Items {
		item := newCaptureItem(raw, assetIDs)
		if !validCaptureName(item.Name) {
			item.Reasons = append(item.Reasons, domain.ReasonNameInvalid)
		}
		if !validCapturePrices(item.Prices) {
			item.Reasons = append(item.Reasons, domain.ReasonPriceOutOfRange)
		}
		if verifier == nil {
			item.Reasons = append(item.Reasons, domain.ReasonVerifierFailed)
			items = append(items, finalizeCaptureItem(item))
			continue
		}
		match := findVerifierMatch(raw, verifier.Items, verifierByName, matchedVerifier)
		if match < 0 {
			item.Reasons = append(item.Reasons, domain.ReasonPassesDisagree)
		} else {
			matchedVerifier[match] = true
			other := normalizeCaptureKind(verifier.Items[match].Kind)
			// A primary "ingredient" read as "dish" by the verifier is kept as
			// window price information, which never becomes a public dish, so
			// it needs no review. The reverse could hide a real dish.
			ingredientKept := item.Kind == domain.CaptureKindIngredient && other == domain.CaptureKindDish
			if other != item.Kind && !ingredientKept {
				item.Reasons = append(item.Reasons, domain.ReasonKindDisagree)
			}
		}
		text, ok := verifierTexts[raw.ImageIndex]
		if !ok {
			text = newCaptureImageText(nil)
		}
		item.Reasons = append(item.Reasons, groundCaptureItem(&item, text)...)
		items = append(items, finalizeCaptureItem(item))
	}
	if verifier != nil {
		for index, raw := range verifier.Items {
			if matchedVerifier[index] {
				continue
			}
			item := newCaptureItem(raw, assetIDs)
			item.Reasons = append(item.Reasons, domain.ReasonMissedByPrimary)
			items = append(items, finalizeCaptureItem(item))
		}
	}
	return mergeCaptureDuplicates(flagSelfSelectBoards(items))
}

// A photo where most priced lines cost at most 1.5 元 is almost always a
// self-select add-on board (麻辣烫/香锅 vegetables), whose lines are not
// dishes. Both models were seen calling such lines dishes, so these never
// auto-publish as dishes; the window type or a reviewer decides.
const (
	captureBoardMinItems  = 5
	captureBoardLowPrice  = 1.5
	captureBoardLowShare  = 0.7
	captureSelfSelectMaxP = 3.0
)

func flagSelfSelectBoards(items []domain.CaptureItem) []domain.CaptureItem {
	priced, low := map[string]int{}, map[string]int{}
	for _, item := range items {
		if item.Kind == domain.CaptureKindCombo || len(item.Prices) == 0 || len(item.AssetIDs) == 0 {
			continue
		}
		asset := item.AssetIDs[0]
		priced[asset]++
		if item.Prices[len(item.Prices)-1] <= captureBoardLowPrice {
			low[asset]++
		}
	}
	for index := range items {
		item := &items[index]
		if item.Kind != domain.CaptureKindDish || len(item.AssetIDs) == 0 {
			continue
		}
		asset := item.AssetIDs[0]
		if priced[asset] >= captureBoardMinItems && float64(low[asset]) >= captureBoardLowShare*float64(priced[asset]) {
			item.Reasons = uniqueStrings(append(item.Reasons, domain.ReasonSelfSelectSuspect))
			item.Status = domain.CaptureItemException
		}
	}
	return items
}

// applyCaptureServiceMode uses the window type the collector picked. In a
// self-select window cheap lines are add-on prices: they are kept as window
// information instead of being reviewed or published as dishes.
func applyCaptureServiceMode(items []domain.CaptureItem, serviceMode string) []domain.CaptureItem {
	if serviceMode != "self_select" {
		return items
	}
	for index := range items {
		item := &items[index]
		if item.Kind != domain.CaptureKindDish || len(item.Prices) == 0 || item.Prices[len(item.Prices)-1] > captureSelfSelectMaxP {
			continue
		}
		item.Kind = domain.CaptureKindIngredient
		remaining := []string{}
		for _, reason := range item.Reasons {
			if reason != domain.ReasonSelfSelectSuspect && reason != domain.ReasonKindDisagree {
				remaining = append(remaining, reason)
			}
		}
		item.Reasons = remaining
		if len(remaining) == 0 {
			item.Status = domain.CaptureItemPassed
		}
	}
	return items
}

func newCaptureItem(raw capturePassItem, assetIDs []string) domain.CaptureItem {
	item := domain.CaptureItem{
		Kind:         normalizeCaptureKind(raw.Kind),
		Name:         strings.TrimSpace(raw.Name),
		PriceText:    strings.TrimSpace(raw.PriceText),
		Prices:       sortedPrices(raw.Prices),
		PriceUnit:    normalizeCaptureUnit(raw.Unit),
		OptionGroups: cleanOptionGroups(raw.OptionGroups),
		Source:       domain.CaptureSourceModel,
	}
	if raw.ImageIndex >= 0 && raw.ImageIndex < len(assetIDs) {
		item.AssetIDs = []string{assetIDs[raw.ImageIndex]}
	}
	if strings.ContainsAny(item.Name, "（(") {
		item.Note = "菜名含括号，可能是同价的不同做法，按原文保留"
	}
	return item
}

func finalizeCaptureItem(item domain.CaptureItem) domain.CaptureItem {
	item.Reasons = uniqueStrings(item.Reasons)
	item.Key = captureItemKey(item.Name, item.Prices)
	if len(item.Reasons) == 0 {
		item.Status = domain.CaptureItemPassed
	} else {
		item.Status = domain.CaptureItemException
	}
	return item
}

func findVerifierMatch(raw capturePassItem, verifierItems []capturePassItem, byName map[string][]int, used map[int]bool) int {
	candidates := byName[normalizeCaptureText(raw.Name)]
	prices := sortedPrices(raw.Prices)
	for _, pass := range []bool{true, false} {
		for _, index := range candidates {
			if used[index] {
				continue
			}
			other := verifierItems[index]
			if pass && other.ImageIndex != raw.ImageIndex {
				continue
			}
			if samePrices(prices, sortedPrices(other.Prices)) {
				return index
			}
		}
	}
	return -1
}

// groundCaptureItem checks the item against the verifier's transcription of
// its own photo: the name must be there, its prices must be the numbers that
// follow the name, and combo choices must be written somewhere on the photo.
// A unit is kept only when it is written next to the price.
func groundCaptureItem(item *domain.CaptureItem, text captureImageText) []string {
	reasons := []string{}
	name := normalizeCaptureText(item.Name)
	ends := text.findAll(name)
	if name == "" || len(ends) == 0 {
		reasons = append(reasons, domain.ReasonNameNotGrounded)
		item.PriceUnit = ""
	} else {
		// A short name can also occur inside a longer one ("鸡排" in "鸡排饭"),
		// so any occurrence followed by the right prices grounds the item.
		priceGrounded, unitGrounded := len(item.Prices) == 0, item.PriceUnit == ""
		for _, end := range ends {
			found, segment := text.pricesAfter(end)
			if len(item.Prices) > 0 && pricesSubset(item.Prices, found) {
				priceGrounded = true
				if item.PriceUnit != "" && strings.Contains(segment, normalizeCaptureText(item.PriceUnit)) {
					unitGrounded = true
				}
			}
		}
		if !priceGrounded {
			reasons = append(reasons, domain.ReasonPriceNotGrounded)
		}
		if !unitGrounded {
			item.PriceUnit = ""
		}
	}
	for _, group := range item.OptionGroups {
		for _, choice := range group.Choices {
			if text.find(normalizeCaptureText(choice)) < 0 {
				reasons = append(reasons, domain.ReasonOptionsUngrounded)
				break
			}
		}
	}
	return reasons
}

// mergeCaptureDuplicates joins the same dish read from overlapping photos and
// flags the same name with different prices as a conflict for a human or the
// local agent to decide.
func mergeCaptureDuplicates(items []domain.CaptureItem) []domain.CaptureItem {
	byName := map[string][]int{}
	order := []string{}
	for index, item := range items {
		name := normalizeCaptureText(item.Name)
		if _, ok := byName[name]; !ok {
			order = append(order, name)
		}
		byName[name] = append(byName[name], index)
	}
	merged := make([]domain.CaptureItem, 0, len(items))
	for _, name := range order {
		group := byName[name]
		distinct := []domain.CaptureItem{}
		for _, index := range group {
			item := items[index]
			joined := false
			for d := range distinct {
				if samePrices(distinct[d].Prices, item.Prices) {
					distinct[d] = joinCaptureItems(distinct[d], item)
					joined = true
					break
				}
			}
			if !joined {
				distinct = append(distinct, item)
			}
		}
		if len(distinct) > 1 && name != "" {
			for d := range distinct {
				distinct[d].Reasons = uniqueStrings(append(distinct[d].Reasons, domain.ReasonPriceConflict))
				distinct[d].Status = domain.CaptureItemException
			}
		}
		merged = append(merged, distinct...)
	}
	return merged
}

func joinCaptureItems(a, b domain.CaptureItem) domain.CaptureItem {
	winner, other := a, b
	if a.Status != domain.CaptureItemPassed && b.Status == domain.CaptureItemPassed {
		winner, other = b, a
	}
	winner.AssetIDs = uniqueStrings(append(append([]string{}, winner.AssetIDs...), other.AssetIDs...))
	if winner.PriceUnit == "" {
		winner.PriceUnit = other.PriceUnit
	}
	return winner
}

// captureImageText indexes one photo's transcription. Lines are joined with a
// separator so numbers on adjacent lines never fuse, while names are matched
// on the compact text so vertical or wrapped names still match.
type captureImageText struct {
	separated []rune
	compact   []rune
	position  []int
}

const captureLineSeparator = '|'

func newCaptureImageText(lines []string) captureImageText {
	parts := make([]string, 0, len(lines))
	for _, line := range lines {
		if normalized := normalizeCaptureText(line); normalized != "" {
			parts = append(parts, normalized)
		}
	}
	separated := []rune(strings.Join(parts, string(captureLineSeparator)))
	text := captureImageText{separated: separated}
	for index, r := range separated {
		if r == captureLineSeparator {
			continue
		}
		text.compact = append(text.compact, r)
		text.position = append(text.position, index)
	}
	return text
}

// find returns the separated-text index just after the first occurrence of
// needle, or -1.
func (t captureImageText) find(needle string) int {
	ends := t.findAll(needle)
	if len(ends) == 0 {
		return -1
	}
	return ends[0]
}

// findAll returns the separated-text index just after every occurrence of
// needle in the compact text.
func (t captureImageText) findAll(needle string) []int {
	target := []rune(needle)
	if len(target) == 0 || len(target) > len(t.compact) {
		return nil
	}
	ends := []int{}
	for start := 0; start+len(target) <= len(t.compact); start++ {
		match := true
		for offset, r := range target {
			if t.compact[start+offset] != r {
				match = false
				break
			}
		}
		if match {
			ends = append(ends, t.position[start+len(target)-1]+1)
		}
	}
	return ends
}

// pricesAfter reads the price tokens that directly follow a name and stops at
// the next word, so a two-column row "A 11元 B 14元" gives A only 11.
func (t captureImageText) pricesAfter(start int) ([]float64, string) {
	prices := []float64{}
	var segment strings.Builder
	runes := t.separated
	index := start
	for index < len(runes) && len(prices) < 6 {
		r := runes[index]
		switch {
		case unicode.IsDigit(r):
			number := []rune{}
			for index < len(runes) && (unicode.IsDigit(runes[index]) || (runes[index] == '.' && len(number) > 0)) {
				number = append(number, runes[index])
				index++
			}
			value, err := strconv.ParseFloat(strings.TrimSuffix(string(number), "."), 64)
			if err == nil {
				prices = append(prices, value)
			}
			segment.WriteString(string(number))
		case isCapturePriceFiller(r):
			segment.WriteRune(r)
			index++
		case isCaptureUnitRune(r):
			segment.WriteRune(r)
			index++
		default:
			return prices, segment.String()
		}
	}
	return prices, segment.String()
}

func isCapturePriceFiller(r rune) bool {
	return r == captureLineSeparator || r == ':' || r == '.' || r == '-' || r == '/' || r == '¥' || r == '~' || r == '*' || r == ','
}

// isCaptureUnitRune lists the characters that may sit between or after prices
// without starting a new menu line: currency, units and "起".
func isCaptureUnitRune(r rune) bool {
	return strings.ContainsRune("元块份两个斤克碗杯笼串只盒位例起gkml", r)
}

func normalizeCaptureText(value string) string {
	var builder strings.Builder
	for _, r := range value {
		switch {
		case r >= 0xFF01 && r <= 0xFF5E:
			r -= 0xFEE0
		case r == 0x3000:
			continue
		case r == '【' || r == '〔':
			r = '['
		case r == '】' || r == '〕':
			r = ']'
		case r == '￥':
			r = '¥'
		case r == '·' || r == '•' || r == '、' || r == '　':
			continue
		}
		if unicode.IsSpace(r) {
			continue
		}
		builder.WriteRune(unicode.ToLower(r))
	}
	return builder.String()
}

func normalizeCaptureKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case domain.CaptureKindCombo, "set", "set_meal", "package":
		return domain.CaptureKindCombo
	case domain.CaptureKindIngredient, "self_select", "raw":
		return domain.CaptureKindIngredient
	default:
		return domain.CaptureKindDish
	}
}

// normalizeCaptureUnit drops the bare currency: "元" says nothing about the
// quantity, so only a real unit such as 份 or 100g survives.
func normalizeCaptureUnit(unit string) string {
	unit = strings.TrimSpace(unit)
	unit = strings.TrimPrefix(unit, "元")
	unit = strings.TrimPrefix(unit, "/")
	unit = strings.TrimPrefix(unit, "每")
	unit = strings.TrimSpace(unit)
	if unit == "元" || unit == "块" {
		return ""
	}
	return unit
}

func cleanOptionGroups(groups []domain.CaptureOptionGroup) []domain.CaptureOptionGroup {
	cleaned := []domain.CaptureOptionGroup{}
	for _, group := range groups {
		choices := []string{}
		for _, choice := range group.Choices {
			if trimmed := strings.TrimSpace(choice); trimmed != "" {
				choices = append(choices, trimmed)
			}
		}
		if len(choices) > 0 {
			cleaned = append(cleaned, domain.CaptureOptionGroup{Title: strings.TrimSpace(group.Title), Choices: choices})
		}
	}
	return cleaned
}

func validCaptureName(name string) bool {
	runes := []rune(strings.TrimSpace(name))
	if len(runes) == 0 || len(runes) > 40 {
		return false
	}
	for _, r := range runes {
		if unicode.Is(unicode.Han, r) || unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

func validCapturePrices(prices []float64) bool {
	for _, price := range prices {
		if price <= 0 || price > captureMaxPrice || math.IsNaN(price) {
			return false
		}
	}
	return true
}

func sortedPrices(prices []float64) []float64 {
	out := append([]float64{}, prices...)
	sort.Float64s(out)
	return out
}

func samePrices(a, b []float64) bool {
	if len(a) != len(b) {
		return false
	}
	for index := range a {
		if math.Abs(a[index]-b[index]) > 0.001 {
			return false
		}
	}
	return true
}

func pricesSubset(want, found []float64) bool {
	if len(found) == 0 {
		return false
	}
	for _, price := range want {
		ok := false
		for _, candidate := range found {
			if math.Abs(price-candidate) <= 0.001 {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

func captureItemKey(name string, prices []float64) string {
	parts := []string{normalizeCaptureText(name)}
	for _, price := range prices {
		parts = append(parts, strconv.FormatFloat(price, 'f', -1, 64))
	}
	sum := sha1.Sum([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:])[:12]
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func formatCapturePrices(prices []float64) string {
	parts := make([]string, 0, len(prices))
	for _, price := range prices {
		parts = append(parts, fmt.Sprintf("%s元", strconv.FormatFloat(price, 'f', -1, 64)))
	}
	return strings.Join(parts, " / ")
}
