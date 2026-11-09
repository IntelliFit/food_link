package app

import (
	"log/slog"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/llmrelay"
)

// configureWanjieRelay sends Wanjie-bound model calls to OpenLux, then A6,
// and reaches Wanjie only when both fail (Wanjie costs the most). It reuses
// the existing OpenLux and A6 credentials; external.wanjie_relay_enabled=false
// turns it off without a deploy.
func configureWanjieRelay(external config.ExternalConfig) {
	llmrelay.Configure(llmrelay.Config{
		Enabled: external.WanjieRelayEnabled,
		Targets: []llmrelay.Target{
			{Name: "openlux", BaseURL: external.OpenLuxBaseURL, APIKey: external.OpenLuxAPIKey, GeminiQuery: "sort=success_rate"},
			{Name: "a6", BaseURL: config.NormalizeA6BaseURL(external.A6BaseURL), APIKey: external.A6APIKey, GoogleKeyHeader: true},
		},
	})
	slog.Info("万界调用改走 OpenLux 和 A6 优先", "enabled", external.WanjieRelayEnabled,
		"openlux_configured", external.OpenLuxAPIKey != "", "a6_configured", external.A6APIKey != "")
}
