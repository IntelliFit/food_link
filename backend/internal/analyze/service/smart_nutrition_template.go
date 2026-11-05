package service

import (
	"math"
	"regexp"
	"strings"
)

// Mixed dishes are recomputed from a standard recipe adjusted by the photo.
// The cooking method sets the oil: when the model reports the oil as visible
// its grams are kept within the method's usual range; when it cannot see the
// oil (or the dish hides it) the method's default share replaces the guess.
// For a few common dish families the staple share is kept within the range
// of the standard recipe, so one odd split cannot halve or double the rice.
//
// Shares are of the dish weight. The defaults are the medians of the model's
// own splits on 459 dishes (50 photos, 4 runs each, 2026-11-05): stir-fry
// 6.4%, braised 5.2%, deep-fried 15%, dry-fried 12.5%, pan-fried 4.7%, cold
// dressed 4.7%, steamed or boiled 1%. The ranges cover roughly the 10th-90th
// percentiles.

type smartOilRule struct {
	method             string
	pattern            *regexp.Regexp
	defaultShare       float64
	minShare, maxShare float64
}

var smartOilRules = []smartOilRule{
	{"deep_fried", regexp.MustCompile(`(炸|酥肉|油条|锅包|天妇罗|脆皮)`), 0.15, 0.08, 0.25},
	{"dry_fried", regexp.MustCompile(`(干煸|干锅|香锅|水煮鱼|水煮肉|毛血旺|辣子鸡|冒菜)`), 0.12, 0.06, 0.20},
	{"pan_fried", regexp.MustCompile(`(煎|锅贴|烙)`), 0.06, 0.03, 0.15},
	{"braised", regexp.MustCompile(`(红烧|烧|焖|炖|扣肉|东坡|糖醋|鱼香|宫保)`), 0.05, 0.02, 0.10},
	{"stir_fried", regexp.MustCompile(`(炒|爆|溜|熘|回锅)`), 0.065, 0.03, 0.12},
	{"cold_dressed", regexp.MustCompile(`(凉拌|拌|凉菜|口水|沙拉)`), 0.04, 0.01, 0.10},
	{"steamed_boiled", regexp.MustCompile(`(蒸|白灼|白切|清汤|煮|焯|蛋羹)`), 0.01, 0.0, 0.05},
}

// smartDishOilRule picks the first matching method; braised dishes named
// "红烧" never fall through to the stir-fry rule.
func smartDishOilRule(name string) (smartOilRule, bool) {
	for _, rule := range smartOilRules {
		if rule.pattern.MatchString(name) {
			return rule, true
		}
	}
	return smartOilRule{}, false
}

type smartStapleRule struct {
	family             string
	dish               *regexp.Regexp
	staple             *regexp.Regexp
	minShare, maxShare float64
}

// Staple ranges from the same dishes: fried rice median 79% rice, rice
// bowls 72%, fried noodles 76%, egg stir-fries 55% egg, meat stir-fries 19%
// meat. Soup noodles are left alone until the broth rule is decided.
var smartStapleRules = []smartStapleRule{
	{"fried_rice", regexp.MustCompile(`炒饭`), regexp.MustCompile(`(米饭|大米|白饭|饭)$`), 0.55, 0.90},
	{"rice_bowl", regexp.MustCompile(`(盖饭|盖浇饭|拌饭|煲仔饭|烩饭)`), regexp.MustCompile(`(米饭|大米|白饭|饭)$`), 0.40, 0.85},
	{"fried_noodles", regexp.MustCompile(`(炒面|炒粉|炒河粉|炒米粉|炒米线)`), regexp.MustCompile(`(面|面条|河粉|米粉|米线|粉条)$`), 0.50, 0.85},
	{"egg_stir_fry", regexp.MustCompile(`(炒蛋|炒鸡蛋)`), regexp.MustCompile(`^(鸡蛋|蛋|全蛋|蛋液|炒鸡蛋)$`), 0.25, 0.75},
	{"meat_stir_fry", regexp.MustCompile(`(炒肉|肉丝|肉片|小炒肉|回锅肉)`), regexp.MustCompile(`(猪肉|瘦肉|里脊|五花肉|肉片|肉丝|牛肉|鸡肉|羊肉)$`), 0.12, 0.55},
}

func smartDishStapleRule(name string) (smartStapleRule, bool) {
	for _, rule := range smartStapleRules {
		if rule.dish.MatchString(name) {
			return rule, true
		}
	}
	return smartStapleRule{}, false
}

// smartOilVisibility reads the model's call on whether the oil can be seen.
func smartOilVisibility(item map[string]any) string {
	switch strings.ToLower(strings.TrimSpace(stringFromAny(firstNonNil(item["oilVisibility"], item["oil_visibility"])))) {
	case "visible", "可见", "看得见", "看得到":
		return "visible"
	case "unclear", "not_visible", "hidden", "看不清", "不可见", "看不到":
		return "unclear"
	}
	return ""
}

// smartApplyDishTemplate adjusts a split whose grams already add up to weight.
// It returns the adjusted split and a note of what changed, or nil when the
// template left the split alone.
func smartApplyDishTemplate(item map[string]any, components []smartComponent, weight float64) ([]smartComponent, map[string]any) {
	name := strings.TrimSpace(stringFromAny(item["name"]))
	if weight <= 0 || len(components) == 0 {
		return components, nil
	}
	out := make([]smartComponent, len(components))
	copy(out, components)
	note := map[string]any{}

	oilGrams := 0.0
	for _, component := range out {
		if smartComponentIsOil(component.name) {
			oilGrams += component.grams
		}
	}
	targetOil := oilGrams
	visibility := smartOilVisibility(item)
	if rule, ok := smartDishOilRule(name); ok {
		if visibility == "unclear" {
			targetOil = rule.defaultShare * weight
		} else {
			targetOil = math.Min(math.Max(oilGrams, rule.minShare*weight), rule.maxShare*weight)
		}
		if math.Abs(targetOil-oilGrams) >= 0.5 {
			note["method"] = rule.method
			note["oil_visibility"] = visibility
			note["oil_grams_before"] = round2(oilGrams)
			note["oil_grams_after"] = round2(targetOil)
		} else {
			targetOil = oilGrams
		}
	}

	stapleGrams := 0.0
	stapleRule, hasStaple := smartDishStapleRule(name)
	if hasStaple {
		for _, component := range out {
			if stapleRule.staple.MatchString(component.name) {
				stapleGrams += component.grams
			}
		}
	}
	targetStaple := stapleGrams
	if hasStaple && stapleGrams > 0 {
		targetStaple = math.Min(math.Max(stapleGrams, stapleRule.minShare*weight), stapleRule.maxShare*weight)
		if math.Abs(targetStaple-stapleGrams) >= 0.5 {
			note["family"] = stapleRule.family
			note["staple_grams_before"] = round2(stapleGrams)
			note["staple_grams_after"] = round2(targetStaple)
		} else {
			targetStaple = stapleGrams
		}
	}
	if len(note) == 0 {
		return components, nil
	}

	// Oil and staple take their target; every other ingredient shares the
	// rest of the weight in its original proportions.
	otherGrams := weight - oilGrams - stapleGrams
	room := weight - targetOil - targetStaple
	if otherGrams <= 0 || room <= 0 {
		return components, nil
	}
	isStaple := func(c smartComponent) bool {
		return hasStaple && stapleGrams > 0 && stapleRule.staple.MatchString(c.name)
	}
	for i, component := range out {
		switch {
		case smartComponentIsOil(component.name):
			if oilGrams > 0 {
				out[i].grams = component.grams * targetOil / oilGrams
			}
		case isStaple(component):
			out[i].grams = component.grams * targetStaple / stapleGrams
		default:
			out[i].grams = component.grams * room / otherGrams
		}
	}
	if oilGrams <= 0 && targetOil > 0 {
		out = append(out, smartComponent{name: "植物油", grams: targetOil, state: "熟"})
	}
	return out, note
}
