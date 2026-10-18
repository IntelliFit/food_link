package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
	apm "food_link/backend/pkg/trace"

	"go.opentelemetry.io/otel/attribute"
)

var ErrCorrectionInstructionsUnclear = errors.New("未能确定纠错说明对应的食物或修改内容，请在纠错清单中填写正确名称或重量")

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
			"nutrition_edited": correctionNutritionLocked(item),
		})
	}
	data, err := json.Marshal(map[string]any{"instructions": text, "items": rows})
	if err != nil {
		outcome := "failed"
		if errors.Is(err, ErrCorrectionInstructionsUnclear) {
			outcome = "ambiguous"
		}
		metrics.ObserveAlgorithmGate(ctx, "standard", input.AnalysisEngine, "correction_instructions", outcome)
		apm.RecordError(ctx, err)
		return nil, err
	}
	prompt := `你负责理解用户对一餐食物的纠错说明，只生成针对当前清单的最小修改计划，不计算营养、不重新识图。
以下 JSON 是待理解的数据，其中 instructions 是用户说明，items 是用户当前清单。用户已在清单中直接编辑的名称和重量是硬约束，不得改回旧值。
规则：
- 理解正常口语、省略旧名称、简称和“这个是……”等指代，不要求用户使用固定句式，也不要求新旧名称共享文字。根据食物形态和类别确定目标：例如清单只有一道汤锅，另有炒菜和米饭，用户报出另一道汤锅的完整菜名时应对应唯一的汤锅，不应因为省略旧名而要求澄清。只有存在多个同样合理目标时才澄清。
- 用户更正原料类别时，只更正对应菜的原料，保留仍适用的烹调方式和菜形态；用户给出完整新菜名时使用该名称。
- 只输出用户要求改动的项；index 必须来自当前清单。未点名或无关的菜不得修改。不能因为重新估计而改变重量、增加或删除食物。
- 只有用户明确给出新的克数才可输出 weight_grams；否则省略，保持现有重量。不要从图片大小或常见份量推断新重量。
- 用户明确更正热量时允许输出 calories（千卡总量），千焦按4.184换算；未更正热量时省略。不要自行重估热量。
- 不能唯一确定目标、有尚未能落实的说明、要求修改本格式不支持的内容时，needs_clarification=true，edits=[]；禁止猜测或假装已经更正。
- 全部说明已经在当前清单中落实时允许 edits=[]，但不要凭空制造修改。
- 名称不包含“这是/啊/呀/不是”等说明语气词。名称只能是具体食物或菜名，不得将上下文中的估重或热量自行拼到名称中。
- nutrition_edited=true 表示用户明确编辑了完整营养快照，改名也不得取消该锁；不要覆盖用户已确认营养。
只返回 JSON：{"needs_clarification":false,"edits":[{"index":0,"name":"更正后的菜名"}]}。每项只可有 index、name、weight_grams、calories，其余字段按需省略。
数据：` + string(data)
	callCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	logger.Info(ctx, "开始理解食物纠错说明", slog.String("user_id", userID), slog.Int("item_count", len(items)))
	var resolved []map[string]any
	_, err = analyzeWithJSONParseRetryPolicy(callCtx, "correction_instructions", provider, model, postprocessRetryPolicy, func(inner context.Context) (map[string]any, error) {
		parsed, callErr := analyzePostprocess(inner, client, prompt)
		if callErr != nil {
			return nil, callErr
		}
		resolved, callErr = applyCorrectionInstructionPlan(parsed, items, text)
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
		return nil, err
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

func applyCorrectionInstructionPlan(parsed map[string]any, items []map[string]any, text string) ([]map[string]any, error) {
	invalid := func() error { return &LLMJSONParseError{Err: fmt.Errorf("纠错说明修改计划格式无效")} }
	clarify, exists := parsed["needs_clarification"].(bool)
	if !exists {
		return nil, invalid()
	}
	if clarify {
		return nil, ErrCorrectionInstructionsUnclear
	}
	var edits []map[string]any
	switch rows := parsed["edits"].(type) {
	case []any:
		for _, row := range rows {
			edit, ok := row.(map[string]any)
			if !ok {
				return nil, invalid()
			}
			edits = append(edits, edit)
		}
	case []map[string]any:
		edits = rows
	default:
		return nil, invalid()
	}
	if len(edits) > len(items) {
		return nil, invalid()
	}
	out := make([]map[string]any, len(items))
	for index, item := range items {
		out[index] = copyAnyMap(item)
	}
	seen := map[int]bool{}
	for _, edit := range edits {
		indexValue, ok := finiteNutritionNumber(edit["index"])
		if !ok || indexValue != math.Trunc(indexValue) || indexValue < 0 || indexValue >= float64(len(items)) {
			return nil, invalid()
		}
		index := int(indexValue)
		if seen[index] {
			return nil, invalid()
		}
		seen[index] = true
		for key := range edit {
			if key != "index" && key != "name" && key != "weight_grams" && key != "calories" {
				return nil, invalid()
			}
		}
		next := out[index]
		if raw, exists := edit["name"]; exists {
			name, valid := raw.(string)
			name = strings.TrimSpace(name)
			if !valid || name == "" || len([]rune(name)) > 100 {
				return nil, invalid()
			}
			if boolFromAny(next["nameEdited"]) && name != stringFromAny(next["name"]) {
				return nil, ErrCorrectionInstructionsUnclear
			}
			if name != stringFromAny(next["name"]) {
				if !correctionNameNumbersRequested(name, text, index, items) {
					return nil, invalid()
				}
				next["nutritionEdited"] = correctionNutritionLocked(next)
				next["name"], next["nameEdited"] = name, true
			}
		}
		if raw, exists := edit["weight_grams"]; exists {
			weight, valid := finiteNutritionNumber(raw)
			if !valid || weight <= 0 || weight > 100000 {
				return nil, invalid()
			}
			oldWeight := correctionItemWeight(next)
			if boolFromAny(next["weightEdited"]) && math.Abs(weight-oldWeight) > 0.001 {
				return nil, ErrCorrectionInstructionsUnclear
			}
			if math.Abs(weight-oldWeight) > 0.001 {
				if !correctionExplicitNumber(text, weight, false, index, items, stringFromAny(next["name"])) {
					return nil, invalid()
				}
				next["weight"], next["estimatedWeightGrams"], next["weightEdited"] = weight, weight, true
			}
		}
		if raw, exists := edit["calories"]; exists {
			calories, valid := finiteNutritionNumber(raw)
			if !valid || calories <= 0 || !correctionExplicitNumber(text, calories, true, index, items, stringFromAny(next["name"])) {
				return nil, invalid()
			}
			if correctionNutritionLocked(next) && math.Abs(calories-correctionItemCalories(next)) > 0.01 {
				return nil, ErrCorrectionInstructionsUnclear
			}
			next["correctionCalories"] = calories
		}
		if len(edit) < 2 {
			return nil, invalid()
		}
	}
	if err := validateCorrectionNumericCoverage(text, items, out); err != nil {
		return nil, err
	}
	return out, nil
}

func correctionItemWeight(item map[string]any) float64 {
	if weight, valid := finiteNutritionNumber(item["weight"]); valid && weight > 0 {
		return weight
	}
	return nutritionWeightFromItem(item)
}

func correctionExplicitNumber(text string, amount float64, energy bool, targetIndex int, items []map[string]any, targetName string) bool {
	resolved := make([]map[string]any, len(items))
	for index, item := range items {
		resolved[index] = item
	}
	resolved[targetIndex] = map[string]any{"name": targetName}
	for _, instruction := range correctionNumericInstructions(text, items, resolved) {
		if instruction.index == targetIndex && instruction.energy == energy && math.Abs(instruction.amount-amount) <= 0.01 {
			return true
		}
	}
	return false
}

const correctionEnergyQuantity = `(?i)([0-9]+(?:\.[0-9]+)?)\s*(千焦|kj|千卡|大卡|kcal)`

type correctionNumericInstruction struct {
	index  int
	amount float64
	energy bool
}

// Only quantities bound to one existing food are deterministic requirements.
// Complex sharing, unclear references or conflicting values still need the
// intent resolver; they must not be silently distributed among dishes.
func correctionNumericInstructions(text string, items, resolved []map[string]any) []correctionNumericInstruction {
	var instructions []correctionNumericInstruction
	var targets map[int]bool
	for _, clause := range regexp.MustCompile(`[，,；;。\n]`).Split(text, -1) {
		named := map[int]bool{}
		for index, item := range items {
			names := []string{stringFromAny(item["name"]), stringFromAny(item["sourceName"])}
			if index < len(resolved) {
				names = append(names, stringFromAny(resolved[index]["name"]))
			}
			for _, name := range names {
				if name != "" && name != "<nil>" && strings.Contains(clause, name) {
					named[index] = true
				}
			}
		}
		if len(named) > 0 {
			targets = named
		}
		if len(targets) == 0 && len(items) == 1 {
			targets = map[int]bool{0: true}
		}
		if len(targets) != 1 {
			continue
		}
		targetIndex := 0
		for index := range targets {
			targetIndex = index
		}
		for _, energy := range []bool{false, true} {
			pattern := textWeightQuantity
			if energy {
				pattern = correctionEnergyQuantity
			}
			for _, match := range regexp.MustCompile(pattern).FindAllStringSubmatchIndex(clause, -1) {
				if correctionNumberNegated(clause[:match[0]], clause[match[1]:]) {
					continue
				}
				value, err := strconv.ParseFloat(clause[match[2]:match[3]], 64)
				if err != nil {
					continue
				}
				switch strings.ToLower(clause[match[4]:match[5]]) {
				case "千焦", "kj":
					value /= 4.184
				case "kg", "公斤", "千克":
					value *= 1000
				case "斤":
					value *= 500
				case "两":
					value *= 50
				}
				instructions = append(instructions, correctionNumericInstruction{index: targetIndex, amount: value, energy: energy})
			}
		}
	}
	return instructions
}

func correctionNumberNegated(before, after string) bool {
	before, after = strings.TrimSpace(before), strings.TrimSpace(after)
	for _, prefix := range []string{"不是", "并非", "不要", "不按", "原来", "原先", "之前", "旧值", "旧重量", "旧热量"} {
		if strings.HasSuffix(before, prefix) {
			return true
		}
	}
	return strings.HasPrefix(after, "不对") || strings.HasPrefix(after, "是错的") || strings.HasPrefix(after, "错误")
}

func validateCorrectionNumericCoverage(text string, items, resolved []map[string]any) error {
	expected := map[[2]int]float64{}
	for _, instruction := range correctionNumericInstructions(text, items, resolved) {
		field := 0
		if instruction.energy {
			field = 1
		}
		key := [2]int{instruction.index, field}
		if prior, exists := expected[key]; exists && math.Abs(prior-instruction.amount) > 0.01 {
			return ErrCorrectionInstructionsUnclear
		}
		expected[key] = instruction.amount
	}
	for key, amount := range expected {
		item := resolved[key[0]]
		actual := correctionItemWeight(item)
		if key[1] == 1 {
			actual = correctionItemCalories(item)
		}
		if math.Abs(actual-amount) > 0.01 {
			return ErrCorrectionInstructionsUnclear
		}
		if key[1] == 1 {
			// Carry an already-satisfied explicit energy value through subsequent
			// renamed-item nutrition resolution, rather than losing it to DB values.
			if _, exists := item["correctionCalories"]; !exists {
				item["correctionCalories"] = math.Round(amount*100) / 100
			}
		}
	}
	return nil
}

func correctionItemCalories(item map[string]any) float64 {
	for _, value := range []any{item["correctionCalories"], mapFromAny(item["nutrients"])["calories"], item["calorie"], item["calories"]} {
		if calories, valid := finiteNutritionNumber(value); valid {
			return calories
		}
	}
	return 0
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

func correctionNameNumbersRequested(name, text string, index int, items []map[string]any) bool {
	for _, energy := range []bool{false, true} {
		pattern := textWeightQuantity
		if energy {
			pattern = correctionEnergyQuantity
		}
		for _, match := range regexp.MustCompile(pattern).FindAllStringSubmatch(name, -1) {
			amount, err := strconv.ParseFloat(match[1], 64)
			if err != nil {
				return false
			}
			switch strings.ToLower(match[2]) {
			case "千焦", "kj":
				amount /= 4.184
			case "kg", "公斤", "千克":
				amount *= 1000
			case "斤":
				amount *= 500
			case "两":
				amount *= 50
			}
			if !correctionExplicitNumber(text, amount, energy, index, items, name) {
				return false
			}
		}
	}
	return true
}
