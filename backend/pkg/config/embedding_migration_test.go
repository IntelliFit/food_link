package config

import "testing"

func TestNutritionEmbeddingLegacyEndpointUsesConfiguredPair(t *testing.T) {
	for _, tc := range []struct{ name, base, newBase, newKey, wantBase, wantKey string }{
		{"migrated", "https://yunwu.ai/v1", "https://api.openlux.ai/v1", "new-key", "https://api.openlux.ai/v1", "new-key"},
		{"custom", "https://custom.example/v1", "https://api.openlux.ai/v1", "new-key", "https://custom.example/v1", "old-key"},
		{"missing-key", "https://yunwu.ai/v1", "https://api.openlux.ai/v1", "", "https://yunwu.ai/v1", "old-key"},
		{"untrusted-host", "https://yunwu.ai/v1", "https://unknown.example/v1", "new-key", "https://yunwu.ai/v1", "old-key"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := ExternalConfig{NutritionEmbeddingEnabled: true, NutritionEmbeddingBaseURL: tc.base, NutritionEmbeddingAPIKey: "old-key", OpenLuxBaseURL: tc.newBase, OpenLuxAPIKey: tc.newKey, NutritionEmbeddingModel: "text-embedding-3-large", NutritionEmbeddingDimensions: 1024}
			trimExternalConfig(&c)
			if c.NutritionEmbeddingBaseURL != tc.wantBase || c.NutritionEmbeddingAPIKey != tc.wantKey {
				t.Fatal("endpoint and credential pairing mismatch")
			}
			if c.NutritionEmbeddingDimensions != 1024 || c.NutritionEmbeddingModel != "text-embedding-3-large" {
				t.Fatal("embedding index contract changed")
			}
		})
	}
}
