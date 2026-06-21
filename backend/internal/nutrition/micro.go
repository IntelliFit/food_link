// Package nutrition 提供营养素相关的共享常量与配置，供首页、统计、分析等模块复用。
package nutrition

import (
	"math"
	"strings"

	"food_link/backend/internal/nutritionagg"
)

// MicroNutrientKind 表示微量元素的评分方向。
type MicroNutrientKind string

const (
	// MicroLower 需要足量的营养素（低于目标扣分）。
	MicroLower MicroNutrientKind = "lower"
	// MicroUpper 需要控制的营养素（高于目标扣分）。
	MicroUpper MicroNutrientKind = "upper"
)

// MicroNutrientConfig 描述一项微量元素的元信息、默认目标与评分权重。
type MicroNutrientConfig struct {
	Key           string            `json:"key"`
	Label         string            `json:"label"`
	Unit          string            `json:"unit"`
	DefaultTarget float64           `json:"default_target"`
	TargetKey     string            `json:"target_key"`
	Kind          MicroNutrientKind `json:"kind"`
	// Weight 扣分权重，上限型默认 1.5，下限型默认 1.0。
	Weight float64 `json:"weight"`
}

// MicroNutrientConfigs 是首页、统计、分析模块共同使用的 21 项微量元素配置。
// 顺序保持与前端展示一致。
var MicroNutrientConfigs = []MicroNutrientConfig{
	{Key: "fiber", Label: "膳食纤维", Unit: "g", DefaultTarget: 25, TargetKey: "fiber_target", Kind: MicroLower, Weight: 1.0},
	{Key: "sugar", Label: "糖", Unit: "g", DefaultTarget: 50, TargetKey: "sugar_target", Kind: MicroUpper, Weight: 1.5},
	{Key: "saturatedFat", Label: "饱和脂肪", Unit: "g", DefaultTarget: 20, TargetKey: "saturated_fat_target", Kind: MicroUpper, Weight: 1.5},
	{Key: "cholesterolMg", Label: "胆固醇", Unit: "mg", DefaultTarget: 300, TargetKey: "cholesterol_mg_target", Kind: MicroUpper, Weight: 1.5},
	{Key: "sodiumMg", Label: "钠", Unit: "mg", DefaultTarget: 2000, TargetKey: "sodium_mg_target", Kind: MicroUpper, Weight: 1.5},
	{Key: "potassiumMg", Label: "钾", Unit: "mg", DefaultTarget: 3500, TargetKey: "potassium_mg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "calciumMg", Label: "钙", Unit: "mg", DefaultTarget: 800, TargetKey: "calcium_mg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "ironMg", Label: "铁", Unit: "mg", DefaultTarget: 12, TargetKey: "iron_mg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "magnesiumMg", Label: "镁", Unit: "mg", DefaultTarget: 330, TargetKey: "magnesium_mg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "zincMg", Label: "锌", Unit: "mg", DefaultTarget: 12.5, TargetKey: "zinc_mg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "vitaminARaeMcg", Label: "维生素A", Unit: "mcg RAE", DefaultTarget: 700, TargetKey: "vitamin_a_rae_mcg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "vitaminCMg", Label: "维生素C", Unit: "mg", DefaultTarget: 100, TargetKey: "vitamin_c_mg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "vitaminDMcg", Label: "维生素D", Unit: "mcg", DefaultTarget: 10, TargetKey: "vitamin_d_mcg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "vitaminEMg", Label: "维生素E", Unit: "mg", DefaultTarget: 14, TargetKey: "vitamin_e_mg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "vitaminKMcg", Label: "维生素K", Unit: "mcg", DefaultTarget: 80, TargetKey: "vitamin_k_mcg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "thiaminMg", Label: "维生素B1", Unit: "mg", DefaultTarget: 1.4, TargetKey: "thiamin_mg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "riboflavinMg", Label: "维生素B2", Unit: "mg", DefaultTarget: 1.4, TargetKey: "riboflavin_mg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "niacinMg", Label: "烟酸", Unit: "mg", DefaultTarget: 15, TargetKey: "niacin_mg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "vitaminB6Mg", Label: "维生素B6", Unit: "mg", DefaultTarget: 1.4, TargetKey: "vitamin_b6_mg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "folateMcg", Label: "叶酸", Unit: "mcg", DefaultTarget: 400, TargetKey: "folate_mcg_target", Kind: MicroLower, Weight: 1.0},
	{Key: "vitaminB12Mcg", Label: "维生素B12", Unit: "mcg", DefaultTarget: 2.4, TargetKey: "vitamin_b12_mcg_target", Kind: MicroLower, Weight: 1.0},
}

// microConfigIndex 按 key 索引的配置表，首次访问时初始化。
var microConfigIndex = buildMicroConfigIndex()

func buildMicroConfigIndex() map[string]MicroNutrientConfig {
	idx := make(map[string]MicroNutrientConfig, len(MicroNutrientConfigs))
	for _, cfg := range MicroNutrientConfigs {
		idx[cfg.Key] = cfg
	}
	return idx
}

// MicroNutrientConfigByKey 返回 key 对应的配置，不存在返回零值。
func MicroNutrientConfigByKey(key string) MicroNutrientConfig {
	return microConfigIndex[key]
}

// MicroNutrientMetrics 返回供 nutritionagg.SumMetrics 使用的微量元素指标列表。
func MicroNutrientMetrics() []nutritionagg.Metric {
	metrics := make([]nutritionagg.Metric, 0, len(MicroNutrientConfigs))
	for _, cfg := range MicroNutrientConfigs {
		aliases := []string{cfg.Key}
		if snake := toSnakeCase(cfg.Key); snake != cfg.Key {
			aliases = append(aliases, snake)
		}
		metrics = append(metrics, nutritionagg.Metric{
			Key:     cfg.Key,
			Aliases: aliases,
		})
	}
	return metrics
}

// MicroNutrientDefaultTargets 返回 key -> 默认每日目标值。
func MicroNutrientDefaultTargets() map[string]float64 {
	targets := make(map[string]float64, len(MicroNutrientConfigs))
	for _, cfg := range MicroNutrientConfigs {
		targets[cfg.Key] = cfg.DefaultTarget
	}
	return targets
}

// MicroNutrientTargetKeyMap 返回 key -> 用户自定义 target key。
func MicroNutrientTargetKeyMap() map[string]string {
	m := make(map[string]string, len(MicroNutrientConfigs))
	for _, cfg := range MicroNutrientConfigs {
		m[cfg.Key] = cfg.TargetKey
	}
	return m
}

// ResolveMicroNutrientTargets 合并默认参考值与用户自定义目标。
// dashboardTargets 来自 user.health_condition["dashboard_targets"]。
func ResolveMicroNutrientTargets(dashboardTargets map[string]any) map[string]float64 {
	if dashboardTargets == nil {
		dashboardTargets = map[string]any{}
	}
	result := MicroNutrientDefaultTargets()
	for _, cfg := range MicroNutrientConfigs {
		if v, ok := dashboardTargets[cfg.TargetKey]; ok && v != nil {
			if f, ok2 := anyToFloat64(v); ok2 && f >= 0 {
				result[cfg.Key] = math.Round(f*10) / 10
			}
		}
	}
	return result
}

// ResolveDailyCalorieTarget 解析每日热量目标，优先级：自定义目标 > TDEE > 默认值 2000。
func ResolveDailyCalorieTarget(dashboardTargets map[string]any, tdee *float64) float64 {
	if dashboardTargets != nil {
		if v, ok := dashboardTargets["calorie_target"]; ok && v != nil {
			if f, ok2 := anyToFloat64(v); ok2 && f > 0 {
				return f
			}
		}
	}
	if tdee != nil && *tdee > 0 {
		return *tdee
	}
	return 2000
}

// anyToFloat64 把 interface{} 转成 float64，兼容 JSON 解码后的 float64/int/各种数值类型。
func anyToFloat64(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int32:
		return float64(n), true
	case int64:
		return float64(n), true
	}
	return 0, false
}

// toSnakeCase 把 camelCase 的 key 转成 snake_case，用于兼容历史数据。
// 例如 "vitaminARaeMcg" -> "vitamin_a_rae_mcg"。
func toSnakeCase(s string) string {
	if s == "" {
		return s
	}
	var out []rune
	for i, r := range s {
		if i > 0 && r >= 'A' && r <= 'Z' {
			out = append(out, '_')
		}
		out = append(out, r)
	}
	return strings.ToLower(string(out))
}
