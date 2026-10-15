package domain

import (
	"regexp"
	"strings"
)

const NutritionStateEvidenceVersion = "source-description-state-v1"

type NutritionStateMetadata struct {
	FoodState         string   `json:"food_state"`
	WeightBasis       string   `json:"weight_basis"`
	PreparationMethod string   `json:"preparation_method"`
	StateTags         []string `json:"state_tags"`
}

type NutritionStateQuery struct {
	FoodState   string
	WeightBasis string
	SkinState   string
	BoneState   string
	Preparation string
}

var nutritionDescriptionWord = regexp.MustCompile(`^[a-z]+(?:-[a-z]+)*$`)

// InferAuthoritativeNutritionState extracts explicit words in the original
// source description. It never infers state from calories, protein or a model.
func InferAuthoritativeNutritionState(name, source string) (NutritionStateMetadata, bool) {
	out := NutritionStateMetadata{StateTags: []string{}}
	if !strings.Contains(source, "美国农业部") && !strings.Contains(strings.ToLower(source), "usda") {
		return out, false
	}
	words := map[string]bool{}
	for _, segment := range strings.Split(strings.ToLower(name), ",") {
		word := strings.TrimSpace(segment)
		// USDA source descriptions express the food's state as a descriptor.
		// A phrase such as "from raw kernels" only describes an ingredient.
		if nutritionDescriptionWord.MatchString(word) {
			words[word] = true
		}
	}
	raw := words["raw"] || words["uncooked"]
	cooked := words["cooked"] || words["boiled"] || words["steamed"] || words["roasted"] || words["baked"] || words["fried"] || words["broiled"] || words["stewed"] || words["braised"]
	if raw && cooked {
		return out, false
	}
	switch {
	case words["dehydrated"] || words["dried"] || words["freeze-dried"]:
		out.FoodState, out.WeightBasis, out.PreparationMethod = "dehydrated", "dry", "dehydrated"
	case cooked:
		out.FoodState, out.WeightBasis, out.PreparationMethod = "cooked", "cooked_edible", "cooked"
		for _, method := range []string{"fried", "roasted", "baked", "broiled", "boiled", "steamed", "braised", "stewed"} {
			if words[method] {
				out.PreparationMethod = method
				break
			}
		}
		if out.PreparationMethod == "fried" {
			out.FoodState = "fried"
		}
		if out.PreparationMethod == "roasted" || out.PreparationMethod == "baked" || out.PreparationMethod == "broiled" {
			out.FoodState = "baked"
		}
	case raw:
		out.FoodState, out.WeightBasis, out.PreparationMethod = "raw", "raw_edible", "raw"
		lower := strings.ToLower(strings.TrimSpace(name))
		for _, prefix := range []string{"rice,", "oats,", "oat bran,", "pasta,", "macaroni,", "noodles,"} {
			if strings.HasPrefix(lower, prefix) {
				out.WeightBasis = "dry_raw"
				break
			}
		}
	default:
		return out, false
	}
	lower := strings.ToLower(name)
	if strings.Contains(lower, "meat only") || strings.Contains(lower, "skinless") {
		out.StateTags = append(out.StateTags, "skinless")
	}
	if strings.Contains(lower, "meat and skin") || strings.Contains(lower, "with skin") {
		out.StateTags = append(out.StateTags, "with_skin")
	}
	if strings.Contains(lower, "boneless") || strings.Contains(lower, "meat only") || strings.Contains(lower, "meat and skin") {
		out.StateTags = append(out.StateTags, "boneless")
	}
	return out, true
}

func HasExplicitNutritionState(food FoodNutrition) bool {
	states := map[string]bool{"raw": true, "fresh": true, "cooked": true, "baked": true, "roasted": true, "fried": true, "dry": true, "dehydrated": true, "hydrated": true, "liquid": true, "packaged": true}
	bases := map[string]bool{"raw": true, "raw_edible": true, "dry_raw": true, "dry": true, "cooked": true, "cooked_edible": true, "as_served": true, "package_net": true}
	return states[strings.TrimSpace(food.FoodState)] && bases[strings.TrimSpace(food.WeightBasis)]
}
