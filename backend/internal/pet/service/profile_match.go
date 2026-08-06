package service

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"food_link/backend/internal/pet/repo"
)

const (
	petProfileMatchVersion = 4

	builtinAvatarJianwen01ID   = "jianwen-01"
	builtinAvatarHuatuo01ID    = "huatuo-01"
	builtinAvatarTaijiXiaoziID = "taiji-xiaozi-01"
	builtinAvatarType          = "builtin_person"

	archetypeSteadyCaregiver = "steady_caregiver"
	archetypeEnergeticBuddy  = "energetic_buddy"
	archetypeGentleHealer    = "gentle_healer"
	archetypeProteinGuardian = "protein_guardian"
	archetypeLightLifestyle  = "light_lifestyle"
)

type AppearanceCandidate struct {
	ID              string   `json:"id"`
	PetSeed         string   `json:"pet_seed"`
	Name            string   `json:"name"`
	Color           string   `json:"color"`
	Shape           string   `json:"shape"`
	Pattern         string   `json:"pattern"`
	Accessory       string   `json:"accessory"`
	Personality     string   `json:"personality"`
	Archetype       string   `json:"archetype"`
	Style           string   `json:"style"`
	Score           int      `json:"score"`
	MatchReasons    []string `json:"match_reasons,omitempty"`
	AvatarType      string   `json:"avatar_type,omitempty"`
	BuiltinAvatarID string   `json:"builtin_avatar_id,omitempty"`
}

type profileMatch struct {
	Version     int
	Fingerprint string
	Archetype   string
	Reasons     []string
	Candidates  []AppearanceCandidate
}

type archetypeAppearancePreference struct {
	Colors        []string
	Shapes        []string
	Patterns      []string
	Accessories   []string
	Personalities []string
}

var archetypePreferences = map[string]archetypeAppearancePreference{
	archetypeSteadyCaregiver: {
		Colors:        []string{"mint", "aqua", "cream", "matcha", "peach"},
		Shapes:        []string{"round", "puff", "bean", "drop"},
		Patterns:      []string{"pattern-0", "pattern-1", "pattern-2", "pattern-3"},
		Accessories:   []string{"leaf", "sprout", "scarf", "bow", "halo"},
		Personalities: []string{"gentle", "focused", "energetic"},
	},
	archetypeEnergeticBuddy: {
		Colors:        []string{"sunny", "aqua", "mint", "peach", "matcha"},
		Shapes:        []string{"puff", "bean", "round", "drop"},
		Patterns:      []string{"pattern-0", "pattern-1", "pattern-2", "pattern-3"},
		Accessories:   []string{"sprout", "bow", "scarf", "leaf", "halo"},
		Personalities: []string{"energetic", "sporty", "focused"},
	},
	archetypeGentleHealer: {
		Colors:        []string{"cream", "peach", "mint", "aqua", "berry"},
		Shapes:        []string{"round", "bean", "puff"},
		Patterns:      []string{"pattern-0", "pattern-2", "pattern-1"},
		Accessories:   []string{"leaf", "halo", "bow", "sprout", "scarf"},
		Personalities: []string{"gentle", "focused", "snacky"},
	},
	archetypeProteinGuardian: {
		Colors:        []string{"matcha", "aqua", "sunny", "mint", "cream"},
		Shapes:        []string{"puff", "round", "bean"},
		Patterns:      []string{"pattern-0", "pattern-3", "pattern-1", "pattern-2"},
		Accessories:   []string{"scarf", "sprout", "leaf", "bow", "halo"},
		Personalities: []string{"focused", "sporty", "energetic"},
	},
	archetypeLightLifestyle: {
		Colors:        []string{"mint", "cream", "peach", "matcha", "aqua"},
		Shapes:        []string{"bean", "round", "puff", "drop"},
		Patterns:      []string{"pattern-0", "pattern-1", "pattern-2", "pattern-3"},
		Accessories:   []string{"leaf", "sprout", "bow", "halo", "scarf"},
		Personalities: []string{"gentle", "energetic", "focused"},
	},
}

func buildProfileMatch(userID string, profile *repo.UserProfile) profileMatch {
	fingerprint := profileFingerprint(profile)
	archetype, reasons := inferArchetype(profile)
	candidates := buildAppearanceCandidates(userID, fingerprint, archetype, reasons)
	return profileMatch{
		Version:     petProfileMatchVersion,
		Fingerprint: fingerprint,
		Archetype:   archetype,
		Reasons:     reasons,
		Candidates:  candidates,
	}
}

func inferArchetype(profile *repo.UserProfile) (string, []string) {
	text := profileText(profile)
	scores := map[string]int{
		archetypeSteadyCaregiver: 3,
		archetypeEnergeticBuddy:  0,
		archetypeGentleHealer:    0,
		archetypeProteinGuardian: 0,
		archetypeLightLifestyle:  0,
	}

	if hasAny(text, "muscle", "protein", "增肌", "力量", "高蛋白") {
		scores[archetypeProteinGuardian] += 5
	}
	if hasAny(text, "very_active", "active", "sport", "运动", "健身", "跑步") {
		scores[archetypeEnergeticBuddy] += 4
	}
	if hasAny(text, "fat_loss", "lose", "减脂", "减重", "控糖", "低脂", "轻食") {
		scores[archetypeLightLifestyle] += 4
	}
	if hasAny(text, "allerg", "medical", "hypertension", "diabetes", "过敏", "病", "血糖", "血压", "脂肪肝", "报告") {
		scores[archetypeGentleHealer] += 4
	}
	if hasAny(text, "maintain", "规律", "稳定", "早睡", "none") {
		scores[archetypeSteadyCaregiver] += 2
	}
	if hasAny(text, "night_owl", "熬夜", "夜猫") {
		scores[archetypeGentleHealer] += 1
		scores[archetypeSteadyCaregiver] += 1
	}

	archetype := archetypeSteadyCaregiver
	best := -1
	keys := []string{
		archetypeLightLifestyle,
		archetypeProteinGuardian,
		archetypeEnergeticBuddy,
		archetypeGentleHealer,
		archetypeSteadyCaregiver,
	}
	for _, key := range keys {
		if scores[key] > best {
			best = scores[key]
			archetype = key
		}
	}
	return archetype, matchReasonsForArchetype(archetype, profile)
}

func matchReasonsForArchetype(archetype string, profile *repo.UserProfile) []string {
	reasons := []string{}
	switch archetype {
	case archetypeProteinGuardian:
		reasons = append(reasons, "你的目标更重视力量或蛋白补足，它会更像认真守护型伙伴")
	case archetypeEnergeticBuddy:
		reasons = append(reasons, "你的活动水平更高，它会更偏元气陪伴和运动提醒")
	case archetypeGentleHealer:
		reasons = append(reasons, "你的健康关注项较多，它会更偏温柔复盘和轻提醒")
	case archetypeLightLifestyle:
		reasons = append(reasons, "你的目标偏轻盈管理，它会陪你稳住热量和记录节奏")
	default:
		reasons = append(reasons, "你的资料更适合稳定陪伴型节奏，它会少打扰但常出现")
	}
	if profile != nil {
		if value := stringPtr(profile.DietGoal); value != "" {
			reasons = append(reasons, fmt.Sprintf("当前饮食目标是 %s，外观和文案会轻微向这个节奏靠拢", value))
		} else if value := healthString(profile.HealthCondition, "daily_life_activity_level"); value != "" {
			reasons = append(reasons, fmt.Sprintf("日常活动水平是 %s，所以它会更贴近你的生活强度", value))
		}
	}
	reasons = append(reasons, "性别只作为很弱的辅助信号，不会直接决定颜色、动物或名字")
	if len(reasons) > 3 {
		return reasons[:3]
	}
	return reasons
}

func buildAppearanceCandidates(userID, fingerprint, archetype string, reasons []string) []AppearanceCandidate {
	styles := []string{"pretty", "quirky", "stable"}
	candidates := make([]AppearanceCandidate, 0, len(styles)+1)
	for _, style := range styles {
		// seed 不包含版本号，保证同画像同原型下的外观只由画像决定，
		// 后端算法版本升级不会导致已生成的颜色/形状等自动变化。
		seed := fmt.Sprintf("pet:%s:%s:%s:%s", userID, fingerprint, archetype, style)
		candidate := candidateFromSeed(seed, archetype, style, reasons)
		candidates = append(candidates, candidate)
	}
	candidates = append(candidates, builtinAppearanceCandidates()...)
	return candidates
}

func builtinAppearanceCandidates() []AppearanceCandidate {
	return []AppearanceCandidate{
		{
			ID:              "builtin:" + builtinAvatarJianwen01ID,
			PetSeed:         "builtin:" + builtinAvatarJianwen01ID,
			Name:            "健文伙伴",
			Color:           "mint",
			Shape:           "round",
			Pattern:         "pattern-0",
			Accessory:       "scarf",
			Personality:     "focused",
			Archetype:       archetypeSteadyCaregiver,
			Style:           "classic",
			Score:           96,
			MatchReasons:    []string{"项目内置的经典像素伙伴，可直接使用且不依赖在线生成"},
			AvatarType:      builtinAvatarType,
			BuiltinAvatarID: builtinAvatarJianwen01ID,
		},
		{
			ID:              "builtin:" + builtinAvatarHuatuo01ID,
			PetSeed:         "builtin:" + builtinAvatarHuatuo01ID,
			Name:            "华佗",
			Color:           "matcha",
			Shape:           "round",
			Pattern:         "pattern-0",
			Accessory:       "leaf",
			Personality:     "gentle",
			Archetype:       archetypeGentleHealer,
			Style:           "classic",
			Score:           96,
			MatchReasons:    []string{"外科圣手，擅长活血化瘀，是内置的养生伙伴"},
			AvatarType:      builtinAvatarType,
			BuiltinAvatarID: builtinAvatarHuatuo01ID,
		},
		{
			ID:              "builtin:" + builtinAvatarTaijiXiaoziID,
			PetSeed:         "builtin:" + builtinAvatarTaijiXiaoziID,
			Name:            "太极小子",
			Color:           "cream",
			Shape:           "bean",
			Pattern:         "pattern-2",
			Accessory:       "halo",
			Personality:     "focused",
			Archetype:       archetypeSteadyCaregiver,
			Style:           "classic",
			Score:           96,
			MatchReasons:    []string{"阴阳平衡、动静结合，是内置的太极养生伙伴"},
			AvatarType:      builtinAvatarType,
			BuiltinAvatarID: builtinAvatarTaijiXiaoziID,
		},
	}
}

func candidateFromSeed(seed, archetype, style string, reasons []string) AppearanceCandidate {
	pref := archetypePreferences[archetype]
	if len(pref.Colors) == 0 {
		pref = archetypePreferences[archetypeSteadyCaregiver]
	}
	appearance := petAppearance{
		Name:        appearanceFromSeed(seed).Name,
		Color:       pickWeighted(seed+":color", styleValues(pref.Colors, style, "color")),
		Shape:       pickWeighted(seed+":shape", styleValues(pref.Shapes, style, "shape")),
		Pattern:     pickWeighted(seed+":pattern", styleValues(pref.Patterns, style, "pattern")),
		Accessory:   pickWeighted(seed+":accessory", styleValues(pref.Accessories, style, "accessory")),
		Personality: pickWeighted(seed+":personality", pref.Personalities),
	}
	appearance, score := guardAppearance(appearance, style)
	return AppearanceCandidate{
		ID:           stableCandidateID(seed),
		PetSeed:      seed,
		Name:         appearance.Name,
		Color:        appearance.Color,
		Shape:        appearance.Shape,
		Pattern:      appearance.Pattern,
		Accessory:    appearance.Accessory,
		Personality:  appearance.Personality,
		Archetype:    archetype,
		Style:        style,
		Score:        score,
		MatchReasons: reasons,
	}
}

func styleValues(values []string, style, slot string) []string {
	result := append([]string{}, values...)
	switch style {
	case "pretty":
		if slot == "pattern" {
			result = prependUnique(result, "pattern-0", "pattern-1", "pattern-2")
		}
		if slot == "accessory" {
			result = prependUnique(result, "leaf", "sprout", "bow")
		}
		if slot == "shape" {
			result = prependUnique(result, "round", "puff", "bean")
		}
	case "quirky":
		if slot == "color" {
			result = append(result, "grape", "berry", "sunny")
		}
		if slot == "shape" {
			result = append(result, "drop", "bean")
		}
		if slot == "accessory" {
			result = append(result, "halo", "bow", "scarf")
		}
	case "stable":
		if slot == "pattern" {
			result = prependUnique(result, "pattern-0", "pattern-2", "pattern-3")
		}
		if slot == "accessory" {
			result = prependUnique(result, "leaf", "scarf", "sprout")
		}
	}
	return result
}

func guardAppearance(appearance petAppearance, style string) (petAppearance, int) {
	score := 78
	if appearance.Pattern == "pattern-0" {
		score += 8
	}
	if appearance.Pattern == "pattern-1" || appearance.Pattern == "pattern-2" {
		score += 5
	}
	if appearance.Pattern == "pattern-4" {
		score -= 14
	}
	if appearance.Accessory == "leaf" || appearance.Accessory == "sprout" {
		score += 7
	}
	if appearance.Accessory == "bow" {
		score += 5
	}
	if appearance.Accessory == "cap" {
		score -= 8
	}
	if appearance.Accessory == "star" || appearance.Accessory == "drop" {
		score -= 4
	}
	if appearance.Shape == "drop" {
		score -= 4
	}
	if appearance.Color == "grape" && appearance.Pattern == "pattern-4" {
		score -= 10
	}
	if appearance.Shape == "drop" && appearance.Pattern == "pattern-4" {
		score -= 8
	}
	if appearance.Pattern == "pattern-4" && appearance.Accessory == "cap" {
		score -= 8
	}
	if style != "quirky" && score < 78 {
		appearance.Pattern = "pattern-0"
		if appearance.Accessory == "cap" || appearance.Accessory == "star" || appearance.Accessory == "drop" {
			appearance.Accessory = "leaf"
		}
		score = 88
	}
	if style == "quirky" && score < 70 {
		appearance.Pattern = "pattern-2"
		if appearance.Accessory == "cap" || appearance.Accessory == "star" {
			appearance.Accessory = "halo"
		}
		if appearance.Accessory == "drop" {
			appearance.Accessory = "bow"
		}
		score = 74
	}
	if score > 96 {
		score = 96
	}
	return appearance, score
}

func profileFingerprint(profile *repo.UserProfile) string {
	if profile == nil {
		return "anonymous"
	}
	parts := []string{
		"gender=" + stringPtr(profile.Gender),
		"birthday=" + formatProfileDate(profile.Birthday),
		"activity_level=" + stringPtr(profile.ActivityLevel),
		"diet_goal=" + stringPtr(profile.DietGoal),
	}
	for _, key := range []string{"daily_life_activity_level", "diet_preference", "medical_history", "allergies", "routine_type"} {
		parts = append(parts, key+"="+healthFingerprintValue(profile.HealthCondition, key))
	}
	sort.Strings(parts)
	sum := sha1.Sum([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:])[:16]
}

func profileText(profile *repo.UserProfile) string {
	if profile == nil {
		return ""
	}
	values := []string{
		stringPtr(profile.Gender),
		stringPtr(profile.ActivityLevel),
		stringPtr(profile.DietGoal),
	}
	for _, key := range []string{"daily_life_activity_level", "diet_preference", "medical_history", "allergies", "routine_type", "health_notes", "report_extract"} {
		values = append(values, healthFingerprintValue(profile.HealthCondition, key))
	}
	return strings.ToLower(strings.Join(values, " "))
}

func healthFingerprintValue(values map[string]any, key string) string {
	if len(values) == 0 {
		return ""
	}
	value := values[key]
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case []string:
		return strings.Join(v, ",")
	case []any:
		parts := make([]string, 0, len(v))
		for _, item := range v {
			parts = append(parts, strings.TrimSpace(fmt.Sprint(item)))
		}
		sort.Strings(parts)
		return strings.Join(parts, ",")
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		return strings.Join(keys, ",")
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func healthString(values map[string]any, key string) string {
	return healthFingerprintValue(values, key)
}

func hasAny(text string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(text, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}

func pickWeighted(seed string, values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[stableHash(seed)%uint32(len(values))]
}

func prependUnique(values []string, preferred ...string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values)+len(preferred))
	for _, value := range preferred {
		if !seen[value] {
			result = append(result, value)
			seen[value] = true
		}
	}
	for _, value := range values {
		if !seen[value] {
			result = append(result, value)
			seen[value] = true
		}
	}
	return result
}

func stableCandidateID(seed string) string {
	sum := sha1.Sum([]byte(seed))
	return "cand_" + hex.EncodeToString(sum[:])[:12]
}

func stringPtr(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func formatProfileDate(value *time.Time) string {
	if value == nil || value.IsZero() {
		return ""
	}
	return value.Format("2006-01-02")
}
