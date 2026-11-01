package service

import "strings"

const smartNutritionFieldsRule = `
食物库匹配字段（系统会用它查标准食物库，请如实填写）：
- 混合菜（isComposite=true，如炒菜、盖饭、面、汤菜）：输出 components，把本项可食净重拆成主要食材和烹调用油/糖/酱，每项 {"name":"","grams":0,"foodState":""}。name 用标准食材名（如"鸡蛋""番茄""猪里脊""米饭""植物油"），foodState 写熟/生状态，先按原规则独立估好 estimatedWeightGrams，components 只把这个重量按食材拆开，grams 之和等于 estimatedWeightGrams，不要因为拆分去改总重量；用油量按可见油光和做法估计，不要省略。
- 单一食物和包装食品的 components 填 []。`

// withSmartNutritionFields extends the one-call photo schema with the fields
// the smart engine routes on. The model's own nutrients are still required, so
// any item the library cannot match keeps a complete estimate.
//
// components goes after nutrients on purpose: the model writes JSON in order,
// so the weight is estimated first, exactly as in the plain schema, and the
// split only distributes that weight.
func withSmartNutritionFields(prompt string) string {
	if nutrients := strings.Index(prompt, `"nutrients":{`); nutrients >= 0 {
		if end := strings.Index(prompt[nutrients:], `}}]`); end >= 0 {
			at := nutrients + end + 1
			prompt = prompt[:at] + `,"components":[]` + prompt[at:]
		}
	}
	return prompt + smartNutritionFieldsRule
}

// SmartNutritionFieldsRule is appended to precision estimate prompts when a
// precision session runs on the smart engine.
func SmartNutritionFieldsRule() string {
	return smartNutritionFieldsRule
}
