package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
	apm "food_link/backend/pkg/trace"

	"go.opentelemetry.io/otel/attribute"
)

var (
	ErrCorrectionInstructionsUnclear = errors.New("没能看懂这条纠错说明对应哪道菜，请写明菜名，或直接在纠错清单里修改")
	ErrCorrectionLeavesNoFood        = errors.New("按说明删除后这餐没有剩下食物；如果整餐都没吃，请直接删除这次识别")
)

// 纠错计划写在条目上的标记，由 worker 据此对照原图重估重量或营养。
const (
	CorrectionReestimateWeightKey = "correctionReestimateWeight"
	CorrectionDisputeNutritionKey = "correctionDisputeNutrition"
	CorrectionHintKey             = "correctionHint"
)

const correctionInstructionPrompt = `你负责理解用户对一餐食物的纠错说明，把它转换成对当前清单的修改计划。只返回 JSON。
数据中 instructions 是用户说明；items 是当前清单（index、菜名、重量克数；name_edited/weight_edited 为 true 表示用户已在清单里手动改过该字段）。之后系统会对照原照片重估你标出的菜。
按用户的真实意图修改，理解正常口语、指代（“这个”“那碗”）、简称和省略，不要求固定句式：
- 改名：用户指出菜不对或给出新菜名时输出 name。只更正原料时保留仍适用的做法和形态（例如“羊肉锅”说“这是牛肉”→“牛肉锅”）；给出完整新菜名时用新菜名。名称只写食物名，不带重量、热量或语气词。
- 改重量：用户给出具体重量（克、斤、两、公斤等）时换算成克填 weight_grams 并原样使用。用户没给数字、但说明分量不对（如“没有这么多”“只吃了一半”“可食部分没这么多”“汤没喝”“多算了一倍”）时，填 reestimate_weight=true，hint 写用户对这道菜分量的原话要点，并在 weight_grams 填一个按常见情况估的新克数（必须与原重量不同，仅在没有照片时使用）。“不是X克”“没有X克”里的 X 是旧值，不是新值。
- 改热量：用户明确给出热量或标签数值时输出 calories（千卡），千焦除以4.184。
- 质疑营养：用户认为热量、配料或营养数据不准但没给具体数值（如“油比一般多”“这个是无糖的”“配料表不对”“热量算多了”）时，对那道菜填 dispute_nutrition=true，hint 写用户的理由；能判断原因是菜认错了时改 name 即可。
- 删除：用户说某道菜没吃、不是这餐的或识别多了时，把它的 index 放入 remove。
- 添加：用户说还吃了清单里没有的食物时放入 add，填写 name；给了重量就填 weight_grams，没给就填 reestimate_weight=true，同时在 weight_grams 填常见一份的克数。
- 用户没提到的菜不要改；用户在清单里手动改过的字段，除非说明里再次明确要求，否则保持不变。
- 尽量按最合理的理解执行，不要因为说法不标准而拒绝。只有完全无法判断指的是哪道菜，或说明与这餐食物无关时，才返回 needs_clarification=true。
格式：{"needs_clarification":false,"edits":[{"index":0,"name":"新菜名","weight_grams":300,"calories":450},{"index":1,"weight_grams":250,"reestimate_weight":true,"hint":"可食部分没这么多"},{"index":3,"dispute_nutrition":true,"hint":"油比一般多"}],"remove":[2],"add":[{"name":"冰粉","weight_grams":200,"reestimate_weight":true}]}
edits 每项除 index 外只写需要的字段；没有对应内容时用空数组。
数据：`

// ResolveCorrectionInstructions translates free text into edits of existing
// items. The nutrition pass remains separate and cannot re-estimate the meal.
func (s *AnalyzeService) ResolveCorrectionInstructions(ctx context.Context, userID string, input AnalyzeInput) ([]map[string]any, error) {
	items := make([]map[string]any, len(input.CorrectionItems))
	for index, item := range input.CorrectionItems {
		items[index] = copyAnyMap(item)
	}
	text := correctionInstructionText(input.AdditionalContext, input.Text)
	if text == "" {
		return items, nil
	}
	if len(items) == 0 || len(items) > 100 {
		return nil, ErrCorrectionInstructionsUnclear
	}
	ctx, span := apm.StartSpan(ctx, "analysis.correction.instructions", attribute.Int("analysis.item_count", len(items)))
	defer span.End()
	client, provider, model := s.runtimePostprocessClient()
	if client == nil {
		metrics.ObserveAlgorithmGate(ctx, "standard", input.AnalysisEngine, "correction_instructions", "unavailable")
		logger.Warn(ctx, "纠错说明解析服务不可用", slog.String("user_id", userID), slog.Int("item_count", len(items)))
		return nil, ErrCorrectionInstructionsUnclear
	}
	rows := make([]map[string]any, 0, len(items))
	for index, item := range items {
		rows = append(rows, map[string]any{
			"index": index, "name": item["name"], "source_name": item["sourceName"],
			"weight_grams": correctionItemWeight(item), "name_edited": item["nameEdited"], "weight_edited": item["weightEdited"],
		})
	}
	data, err := json.Marshal(map[string]any{"instructions": text, "items": rows})
	if err != nil {
		metrics.ObserveAlgorithmGate(ctx, "standard", input.AnalysisEngine, "correction_instructions", "failed")
		apm.RecordError(ctx, err)
		return nil, err
	}
	prompt := correctionInstructionPrompt + string(data)
	callCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	logger.Info(ctx, "开始理解食物纠错说明", slog.String("user_id", userID), slog.Int("item_count", len(items)))
	var resolved []map[string]any
	_, err = analyzeWithJSONParseRetryPolicy(callCtx, "correction_instructions", provider, model, postprocessRetryPolicy, func(inner context.Context) (map[string]any, error) {
		parsed, callErr := analyzePostprocess(inner, client, prompt)
		if callErr != nil {
			return nil, callErr
		}
		resolved, callErr = applyCorrectionInstructionPlan(parsed, items)
		return parsed, callErr
	})
	if err != nil {
		outcome := "failed"
		if errors.Is(err, ErrCorrectionInstructionsUnclear) {
			outcome = "ambiguous"
		}
		metrics.ObserveAlgorithmGate(ctx, "standard", input.AnalysisEngine, "correction_instructions", outcome)
		apm.RecordError(ctx, err)
		logger.Warn(ctx, "食物纠错说明未能落实", slog.String("user_id", userID), slog.Int("item_count", len(items)), logger.Err(err))
		return nil, userFacingCorrectionError(err)
	}
	metrics.ObserveAlgorithmGate(ctx, "standard", input.AnalysisEngine, "correction_instructions", "passed")
	logger.Info(ctx, "食物纠错说明已转换为定向修改", slog.String("user_id", userID), slog.Int("item_count", len(resolved)))
	return resolved, nil
}

func correctionInstructionText(text string, originalTexts ...string) string {
	text = strings.TrimSpace(text)
	originalBlock := ""
	if len(originalTexts) > 0 && strings.TrimSpace(originalTexts[0]) != "" {
		originalBlock = "原始文字记录：" + strings.TrimSpace(originalTexts[0])
		text = strings.TrimSpace(strings.TrimSuffix(text, originalBlock))
	}
	if strings.HasPrefix(text, "上一轮纠错上下文：") {
		// Legacy text clients prepend the previous context (including its own
		// generated lines) before the current note, then append original text.
		if originalBlock == "" {
			if index := strings.LastIndex(text, "\n原始文字记录："); index >= 0 {
				text = text[:index]
			}
		}
		if originalBlock != "" && strings.Contains(text, originalBlock) {
			index := strings.LastIndex(text, originalBlock)
			text = text[index+len(originalBlock):]
		} else {
			boundary := strings.LastIndex(text, "原始文字记录：")
			if boundary < 0 {
				boundary = 0
			}
			if index := strings.Index(text[boundary:], "\n"); index >= 0 {
				text = text[boundary+index+1:]
			} else {
				return ""
			}
		}
	}
	var lines []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "用户在列表中做了以下修改：") || strings.HasPrefix(line, "原始文字记录：") {
			continue
		}
		lines = append(lines, line)
	}
	text = strings.TrimSpace(strings.Join(lines, "\n"))
	if text == "用户发起了二次纠错，请结合原始内容重新分析。" {
		return ""
	}
	return text
}

// applyCorrectionInstructionPlan trusts the model's reading of the note and
// only checks that the plan is structurally sound. It no longer matches numbers
// in the note against the plan: that rejected ordinary phrasing such as
// "没有400克" and every correction that gives no number at all.
func applyCorrectionInstructionPlan(parsed map[string]any, items []map[string]any) ([]map[string]any, error) {
	invalid := func(reason string) error {
		return &LLMJSONParseError{Err: fmt.Errorf("纠错说明修改计划格式无效：%s", reason)}
	}
	clarify, exists := parsed["needs_clarification"].(bool)
	if !exists {
		return nil, invalid("缺少 needs_clarification")
	}
	if clarify {
		return nil, ErrCorrectionInstructionsUnclear
	}
	edits, ok := correctionPlanRows(parsed["edits"], true)
	if !ok {
		return nil, invalid("edits")
	}
	adds, ok := correctionPlanRows(parsed["add"], false)
	if !ok {
		return nil, invalid("add")
	}
	removed := map[int]bool{}
	if raw, exists := parsed["remove"]; exists && raw != nil {
		list, ok := raw.([]any)
		if !ok {
			return nil, invalid("remove")
		}
		for _, value := range list {
			index, ok := correctionPlanIndex(value, len(items))
			if !ok || removed[index] {
				return nil, invalid("remove")
			}
			removed[index] = true
		}
	}
	out := make([]map[string]any, len(items))
	for index, item := range items {
		out[index] = copyAnyMap(item)
	}
	edited := map[int]bool{}
	for _, edit := range edits {
		index, ok := correctionPlanIndex(edit["index"], len(items))
		if !ok || edited[index] || removed[index] || len(edit) < 2 {
			return nil, invalid("edits.index")
		}
		edited[index] = true
		for key := range edit {
			if key != "index" && !correctionPlanItemKeys[key] {
				return nil, invalid("edits." + key)
			}
		}
		if err := applyCorrectionEdit(out[index], edit); err != nil {
			return nil, invalid(err.Error())
		}
	}
	resolved := make([]map[string]any, 0, len(out)+len(adds))
	for index, item := range out {
		if !removed[index] {
			resolved = append(resolved, item)
		}
	}
	nextID := correctionNextItemID(items)
	for _, add := range adds {
		for key := range add {
			if !correctionPlanItemKeys[key] || key == "dispute_nutrition" {
				return nil, invalid("add." + key)
			}
		}
		if _, hasWeight := add["weight_grams"]; !hasWeight {
			return nil, invalid("add.weight_grams")
		}
		// 新增项没有 sourceItemId，用新编号避免被按同名配对到原清单的菜。
		item := map[string]any{"itemId": nextID, "nameEdited": true, "nutritionEdited": false}
		nextID++
		if err := applyCorrectionEdit(item, add); err != nil {
			return nil, invalid(err.Error())
		}
		item["weightEdited"] = true
		if strings.TrimSpace(stringFromAny(item["name"])) == "" {
			return nil, invalid("add.name")
		}
		resolved = append(resolved, item)
	}
	if len(resolved) == 0 {
		return nil, ErrCorrectionLeavesNoFood
	}
	return resolved, nil
}

func correctionPlanRows(raw any, required bool) ([]map[string]any, bool) {
	if raw == nil {
		return nil, !required
	}
	switch rows := raw.(type) {
	case []map[string]any:
		return rows, true
	case []any:
		out := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			edit, ok := row.(map[string]any)
			if !ok {
				return nil, false
			}
			out = append(out, edit)
		}
		return out, true
	default:
		return nil, false
	}
}

func correctionPlanIndex(raw any, count int) (int, bool) {
	value, ok := finiteNutritionNumber(raw)
	if !ok || value != math.Trunc(value) || value < 0 || value >= float64(count) {
		return 0, false
	}
	return int(value), true
}

var correctionPlanItemKeys = map[string]bool{
	"name": true, "weight_grams": true, "calories": true, "reestimate_weight": true, "dispute_nutrition": true, "hint": true,
}

// applyCorrectionEdit writes one change onto item, which must be a private copy.
func applyCorrectionEdit(item, edit map[string]any) error {
	weightEditedInList := boolFromAny(item["weightEdited"]) && !boolFromAny(item[CorrectionReestimateWeightKey])
	nutritionLockedInList := correctionNutritionLocked(item)
	reestimate, err := correctionPlanBool(edit, "reestimate_weight")
	if err != nil {
		return err
	}
	dispute, err := correctionPlanBool(edit, "dispute_nutrition")
	if err != nil {
		return err
	}
	if raw, exists := edit["hint"]; exists {
		hint, valid := raw.(string)
		if !valid {
			return fmt.Errorf("hint")
		}
		if hint = strings.TrimSpace(hint); hint != "" {
			runes := []rune(hint)
			if len(runes) > 200 {
				hint = string(runes[:200])
			}
			item[CorrectionHintKey] = hint
		}
	}
	// 用户在清单里亲手改过的重量和营养以清单为准，不再对照照片改回去。
	if reestimate && !weightEditedInList {
		item[CorrectionReestimateWeightKey] = true
	}
	if dispute && !nutritionLockedInList {
		item[CorrectionDisputeNutritionKey] = true
	}
	if raw, exists := edit["name"]; exists {
		name, valid := raw.(string)
		name = strings.TrimSpace(name)
		if !valid || name == "" || len([]rune(name)) > 100 {
			return fmt.Errorf("name")
		}
		if name != stringFromAny(item["name"]) {
			// 改名后旧营养不再适用，除非用户已在清单里手填了完整营养。
			item["nutritionEdited"] = correctionNutritionLocked(item)
			item["name"], item["nameEdited"] = name, true
		}
	}
	if raw, exists := edit["weight_grams"]; exists {
		weight, valid := finiteNutritionNumber(raw)
		if !valid || weight <= 0 || weight > 100000 {
			return fmt.Errorf("weight_grams")
		}
		if math.Abs(weight-correctionItemWeight(item)) > 0.001 {
			item["weight"], item["estimatedWeightGrams"], item["weightEdited"] = weight, weight, true
		}
	}
	if raw, exists := edit["calories"]; exists {
		calories, valid := finiteNutritionNumber(raw)
		if !valid || calories <= 0 || calories > 100000 {
			return fmt.Errorf("calories")
		}
		item["correctionCalories"] = math.Round(calories*100) / 100
	}
	return nil
}

func correctionPlanBool(edit map[string]any, key string) (bool, error) {
	raw, exists := edit[key]
	if !exists || raw == nil {
		return false, nil
	}
	value, valid := raw.(bool)
	if !valid {
		return false, fmt.Errorf("%s", key)
	}
	return value, nil
}

func correctionNextItemID(items []map[string]any) int {
	maxID := 0.0
	for _, item := range items {
		for _, key := range []string{"itemId", "sourceItemId", "id"} {
			if value, ok := finiteNutritionNumber(item[key]); ok && value > maxID {
				maxID = value
			}
		}
	}
	return int(math.Floor(maxID)) + 1
}

func correctionItemWeight(item map[string]any) float64 {
	if weight, valid := finiteNutritionNumber(item["weight"]); valid && weight > 0 {
		return weight
	}
	return nutritionWeightFromItem(item)
}

func correctionNutritionLocked(item map[string]any) bool {
	if !boolFromAny(item["nutritionEdited"]) {
		return false
	}
	nutrients := mapFromAny(item["nutrients"])
	for _, key := range []string{"calories", "protein", "carbs", "fat"} {
		value, valid := finiteNutritionNumber(nutrients[key])
		if !valid || value < 0 {
			return false
		}
	}
	return true
}

// 重试后模型计划仍无效时，提示用户补充说明，而不是暴露“parse llm json failed”。
func userFacingCorrectionError(err error) error {
	var parseErr *LLMJSONParseError
	if errors.As(err, &parseErr) {
		return ErrCorrectionInstructionsUnclear
	}
	return err
}
