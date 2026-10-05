package service

import (
	"encoding/json"
	"math"
	"strings"
)

// Reuse the ordinary photo context/rules, expanding only its output schema.
// Text, precision planning and domestic rapid-mode prompts remain unchanged.
func combinedOrdinaryPhotoPrompt(prompt string) string {
	nutrients := map[string]any{"calories": 0, "protein": 0, "carbs": 0, "fat": 0}
	for _, key := range preciseMicronutrientKeys {
		nutrients[key] = 0
	}
	schema, _ := json.Marshal(nutrients)
	prompt = strings.Replace(prompt, `"nutrients":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0}`, `"nutrients":`+string(schema), 1)
	prompt = strings.Replace(prompt, `"estimatedWeightGrams":0`, `"grossWeightGrams":0,"hasInedibleParts":false,"ediblePortionRatio":100,"ediblePortionReason":"","recognitionEvidence":"","estimatedWeightGrams":0`, 1)
	return prompt + `
一次完成识别、估重、可食部及完整营养，不输出推理过程。
先根据实际可见形状、纹理、结构辨认食物，再估营养。包装文字、颜色和常见搭配只能辅助，不得替代实物证据；遮挡或相似食物无法区分时用保守名称，在 assumptions/uncertaintyNotes 明示不确定性，不编造食材。
recognitionEvidence 简述可见结构证据。grossWeightGrams 是食物含骨/壳/核的毛重，不含袋子、包装和容器；estimatedWeightGrams 是可食净重，两者必须满足 净重=毛重*ediblePortionRatio/100。hasInedibleParts 必须为布尔值，说明骨/壳/核等是否不可食，ediblePortionReason 简述依据，无不可食部分填100。可食比例不得因营养数值倒推。
nutrients 全部是本项可食净重对应的整份总量，不是每100克。必须完整给出示例中所有字段；热量kcal，protein/carbs/fat/fiber/sugar/saturatedFat用g，后缀Mg用mg，后缀Mcg用µg。微量营养依据实际食物、配料和烹饪状态估算，示例的0只是类型占位，不得机械填0；确实不含的可填0，无法估算的字段不要伪造，用 uncertaintyNotes 说明，系统会补全缺项。
`
}

func finiteNutritionNumber(value any) (float64, bool) {
	var n float64
	switch v := value.(type) {
	case float64:
		n = v
	case float32:
		n = float64(v)
	case int:
		n = float64(v)
	case json.Number:
		var err error
		n, err = v.Float64()
		if err != nil {
			return 0, false
		}
	default:
		return 0, false
	}
	return n, !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0
}

func validVisualEdiblePortion(item map[string]any) bool {
	gross, grossOK := finiteNutritionNumber(item["grossWeightGrams"])
	net, netOK := finiteNutritionNumber(item["estimatedWeightGrams"])
	ratio, ratioOK := finiteNutritionNumber(item["ediblePortionRatio"])
	parts, partsOK := item["hasInedibleParts"].(bool)
	reason, _ := item["ediblePortionReason"].(string)
	if !grossOK || !netOK || !ratioOK || !partsOK || gross <= 0 || net <= 0 || ratio <= 0 || ratio > 100 || strings.TrimSpace(reason) == "" {
		return false
	}
	if (parts && ratio >= 99.5) || (!parts && ratio < 99.5) {
		return false
	}
	return math.Abs(net-gross*ratio/100) <= math.Max(1, net*0.03)
}
