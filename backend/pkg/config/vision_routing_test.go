package config

import (
	"testing"

	"github.com/spf13/viper"
)

func TestVisionRoutingLocalConfigKeepsZeroAndFalseValues(t *testing.T) {
	dir := writeTestConfig(t, `worker:
  count: 1
external:
  a6_api_key: "  test-key  "
  a6_base_url: " https://api.a6api.com/v1/ "
  vision_routing:
    a6_shadow_percent: 0
    cost_routing_enabled: false
    a6_independent_upstream: true
    a6_approved_models: [gemini-3-flash-preview, gemini-3.5-flash]
    hedge_min_seconds: 4
    hedge_max_seconds: 5
`)
	cfg, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.External.A6APIKey != "test-key" || cfg.External.A6BaseURL != "https://api.a6api.com/v1" {
		t.Fatal("A6凭证/域名未规范化")
	}
	r := cfg.External.VisionRouting
	if r.A6ShadowPercent != 0 || r.CostRoutingEnabled || !r.A6IndependentUpstream || len(r.A6ApprovedModels) != 2 || r.HedgeMinSeconds != 4 || r.HedgeMaxSeconds != 5 {
		t.Fatalf("routing mismatch: %+v", r)
	}
}

func TestVisionRoutingApolloNestedFieldsAndModels(t *testing.T) {
	v := viper.New()
	setDefaults(v)
	items := []maskedApolloConfigItem{}
	mergeApolloYAMLContent(v, "app-config.yaml", `external:
  a6_api_key: test
  vision_routing:
    a6_shadow_percent: 0
    cost_routing_enabled: true
    a6_independent_upstream: true
    a6_approved_models: [gemini-3-flash-preview, gemini-3.5-flash]
`, &items)
	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		t.Fatal(err)
	}
	r := cfg.External.VisionRouting
	if r.A6ShadowPercent != 0 || !r.CostRoutingEnabled || !r.A6IndependentUpstream || len(r.A6ApprovedModels) != 2 || r.A6ApprovedModels[1] != "gemini-3.5-flash" {
		t.Fatalf("Apollo routing mismatch: %+v", r)
	}
}
