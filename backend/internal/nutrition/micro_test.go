package nutrition

import (
	"testing"
)

func TestMicroNutrientConfigsCount(t *testing.T) {
	if len(MicroNutrientConfigs) != 21 {
		t.Fatalf("expected 21 micronutrient configs, got %d", len(MicroNutrientConfigs))
	}
}

func TestMicroNutrientConfigByKey(t *testing.T) {
	cfg := MicroNutrientConfigByKey("sodiumMg")
	if cfg.Key != "sodiumMg" {
		t.Fatalf("expected sodiumMg config, got %s", cfg.Key)
	}
	if cfg.Kind != MicroUpper {
		t.Fatalf("expected sodiumMg to be upper-limit, got %s", cfg.Kind)
	}
	if cfg.DefaultTarget != 2000 {
		t.Fatalf("expected sodiumMg default target 2000, got %f", cfg.DefaultTarget)
	}

	cfg = MicroNutrientConfigByKey("calciumMg")
	if cfg.Kind != MicroLower {
		t.Fatalf("expected calciumMg to be lower-target, got %s", cfg.Kind)
	}

	cfg = MicroNutrientConfigByKey("not_exists")
	if cfg.Key != "" {
		t.Fatalf("expected zero value for missing key, got %+v", cfg)
	}
}

func TestResolveMicroNutrientTargets(t *testing.T) {
	dashboard := map[string]any{
		"sodium_mg_target": 1500,
		"calcium_mg_target": 1000,
		"vitamin_c_mg_target": 200,
	}
	targets := ResolveMicroNutrientTargets(dashboard)

	if targets["sodiumMg"] != 1500 {
		t.Fatalf("expected sodiumMg target 1500, got %f", targets["sodiumMg"])
	}
	if targets["calciumMg"] != 1000 {
		t.Fatalf("expected calciumMg target 1000, got %f", targets["calciumMg"])
	}
	if targets["vitaminCMg"] != 200 {
		t.Fatalf("expected vitaminCMg target 200, got %f", targets["vitaminCMg"])
	}
	// 未自定义的应使用默认值
	if targets["fiber"] != 25 {
		t.Fatalf("expected fiber default target 25, got %f", targets["fiber"])
	}
}

func TestResolveDailyCalorieTarget(t *testing.T) {
	tdee := 2200.0

	// 优先使用自定义目标
	custom := map[string]any{"calorie_target": 1800.0}
	if got := ResolveDailyCalorieTarget(custom, &tdee); got != 1800 {
		t.Fatalf("expected 1800 from custom target, got %f", got)
	}

	// 无自定义时使用 TDEE
	if got := ResolveDailyCalorieTarget(nil, &tdee); got != 2200 {
		t.Fatalf("expected 2200 from TDEE, got %f", got)
	}

	// 无自定义也无 TDEE 时使用默认值 2000
	if got := ResolveDailyCalorieTarget(nil, nil); got != 2000 {
		t.Fatalf("expected 2000 default, got %f", got)
	}
}

func TestMicroNutrientMetrics(t *testing.T) {
	metrics := MicroNutrientMetrics()
	if len(metrics) != 21 {
		t.Fatalf("expected 21 metrics, got %d", len(metrics))
	}
	for _, m := range metrics {
		if m.Key == "" {
			t.Fatal("metric key should not be empty")
		}
		if len(m.Aliases) == 0 {
			t.Fatalf("metric %s should have at least one alias", m.Key)
		}
	}
}
