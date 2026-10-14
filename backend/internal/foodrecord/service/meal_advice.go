package service

import (
	"context"
	"fmt"
	"math"
	"strings"

	"food_link/backend/internal/foodrecord/domain"
)

// 点评仅使用已记录的食物和摄入量；缺少模型点评时明确返回营养数据点评。
func generatedRecordAdvice(record *domain.FoodRecord) (string, string, string, string) {
	protein, carbs, fat := record.TotalProtein, record.TotalCarbs, record.TotalFat
	energy := protein*4 + carbs*4 + fat*9
	if energy <= 0 {
		return "营养点评：当前营养数据不足，暂无法评价本餐搭配。", "营养数据不足，暂无法计算供能比例。", "按实际食用顺序记录即可。", "点评需要完整的食物与营养数据。"
	}
	p, c, f := protein*4/energy*100, carbs*4/energy*100, fat*9/energy*100
	notes := []string{}
	if p < 15 {
		notes = append(notes, "蛋白质供能占比较低")
	}
	if f > 35 {
		notes = append(notes, "脂肪供能占比较高")
	}
	if c > 65 {
		notes = append(notes, "碳水供能占比较高")
	}
	if len(notes) == 0 {
		notes = append(notes, "三大营养素供能比例较均衡")
	}
	insight := fmt.Sprintf("营养点评：本餐记录%.1f kcal、蛋白质%.1fg；%s。", record.TotalCalories, protein, strings.Join(notes, "，"))
	ratio := fmt.Sprintf("按供能计算：蛋白质约%.0f%%、碳水约%.0f%%、脂肪约%.0f%%。", p, c, f)
	vegetables, proteins, staples := []string{}, []string{}, []string{}
	for _, item := range record.Items {
		if item.Intake <= 0 && item.Ratio <= 0 {
			continue
		}
		name := strings.TrimSpace(item.Name)
		switch {
		case containsMealWord(name, "蔬菜", "青菜", "西兰花", "菠菜", "白菜", "黄瓜", "番茄", "生菜", "苹果", "香蕉", "橙"):
			vegetables = append(vegetables, name)
		case containsMealWord(name, "鸡蛋", "水煮蛋", "肉", "鱼", "虾", "豆腐", "牛奶", "蛋白"):
			proteins = append(proteins, name)
		case containsMealWord(name, "饭", "面", "粥", "包", "饼", "馒头", "土豆", "燕麦"):
			staples = append(staples, name)
		}
	}
	orderParts := []string{}
	for _, names := range [][]string{vegetables, proteins, staples} {
		if len(names) > 0 {
			orderParts = append(orderParts, names[0])
		}
	}
	order := "本餐按实际食用顺序、放慢速度进食即可。"
	if len(orderParts) > 1 {
		order = "可先吃" + strings.Join(orderParts, "，再吃") + "。"
	}
	absorption := "本餐按实际摄入量计算；包装标示或自定义数据有误时，先修正营养数据。"
	return insight, ratio, order, absorption
}

func containsMealWord(name string, words ...string) bool {
	for _, word := range words {
		if strings.Contains(name, word) {
			return true
		}
	}
	return false
}

func assignAdviceIfEmpty(target **string, value string) {
	if *target == nil || strings.TrimSpace(**target) == "" {
		*target = &value
	}
}

func fillGeneratedRecordAdvice(record *domain.FoodRecord) {
	insight, ratio, order, absorption := generatedRecordAdvice(record)
	if record.Insight != nil && strings.HasPrefix(strings.TrimSpace(*record.Insight), "手动记录") {
		record.Insight = nil
	}
	assignAdviceIfEmpty(&record.Insight, insight)
	assignAdviceIfEmpty(&record.PFCRatioComment, ratio)
	assignAdviceIfEmpty(&record.EatingOrderAdvice, order)
	assignAdviceIfEmpty(&record.AbsorptionNotes, absorption)
	record.AdviceSource = "nutrition_summary"
	if record.SourceTaskID != nil && record.Insight != nil && !strings.HasPrefix(*record.Insight, "营养点评：") {
		record.AdviceSource = "analysis"
	}
}

func (s *FoodRecordService) hydrateRecordAdvice(ctx context.Context, record *domain.FoodRecord) {
	if record == nil {
		return
	}
	if record.SourceTaskID != nil && s.taskRepo != nil && (record.Insight == nil || !strings.HasPrefix(*record.Insight, "营养点评：")) {
		task, err := s.taskRepo.GetByID(ctx, *record.SourceTaskID)
		if err == nil && task != nil && task.UserID == record.UserID && taskAdviceMatchesRecord(task.Result, record) {
			for key, target := range map[string]**string{"insight": &record.Insight, "pfc_ratio_comment": &record.PFCRatioComment, "absorption_notes": &record.AbsorptionNotes, "context_advice": &record.ContextAdvice, "eating_order_advice": &record.EatingOrderAdvice} {
				if value, ok := task.Result[key].(string); ok && strings.TrimSpace(value) != "" {
					assignAdviceIfEmpty(target, value)
				}
			}
			fillGeneratedRecordAdvice(record)
			record.AdviceSource = "analysis"
			return
		}
		if err == nil && task != nil && task.UserID == record.UserID && !taskAdviceMatchesRecord(task.Result, record) {
			record.Insight, record.PFCRatioComment, record.AbsorptionNotes, record.ContextAdvice, record.EatingOrderAdvice = nil, nil, nil, nil, nil
		}
	}
	fillGeneratedRecordAdvice(record)
}

func taskAdviceMatchesRecord(result map[string]any, record *domain.FoodRecord) bool {
	items := anyItems(result["items"])
	if len(items) != len(record.Items) {
		return false
	}
	for i, item := range items {
		name, _ := item["name"].(string)
		if normalizeRecordFoodName(name) != normalizeRecordFoodName(record.Items[i].Name) {
			return false
		}
		weight := positiveNumberFromAny(item["weight"], item["weight_grams"])
		if math.Abs(weight-record.Items[i].Weight) > 0.1 {
			return false
		}
		intake := positiveNumberFromAny(item["intake"])
		if intake <= 0 {
			intake = weight
		}
		if math.Abs(intake-record.Items[i].Intake) > 0.1 {
			return false
		}
	}
	return true
}
