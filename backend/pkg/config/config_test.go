package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadReadsLegacyEnvKeys(t *testing.T) {
	t.Setenv("PORT", "3010")
	t.Setenv("DASHSCOPE_API_KEY", "a")
	t.Setenv("APPID", "a")
	t.Setenv("SECRET", "a")
	t.Setenv("JWT_SECRET_KEY", "b")
	t.Setenv("SUPABASE_URL", "c")
	t.Setenv("SUPABASE_SERVICE_ROLE_KEY", "d")
	t.Setenv("TIANDITU_TK", "e")
	t.Setenv("OFOXAI_API_KEY", "f")
	t.Setenv("OFOXAI_BASE_URL", "https://proxy.example.com/v1")
	t.Setenv("LLM_PROVIDER", "g")
	t.Setenv("WECHAT_PAY_MCHID", "h")
	t.Setenv("WECHAT_PAY_NOTIFY_URL", "i")
	t.Setenv("WECHAT_PAY_SERIAL_NO", "j")
	t.Setenv("WECHAT_PAY_API_V3_KEY", "k")
	t.Setenv("WECHAT_PAY_PRIVATE_KEY", "l")
	t.Setenv("WECHAT_PAY_PUBLIC_KEY", "m")
	t.Setenv("EXPIRY_SUBSCRIBE_TEMPLATE_ID", "n")
	t.Setenv("ANALYSIS_SUBSCRIBE_TEMPLATE_ID", "o")
	t.Setenv("COS_REGION", "p")
	t.Setenv("COS_FOOD_IMAGES_BUCKET", "q")
	t.Setenv("COS_HEALTH_REPORTS_BUCKET", "r")
	t.Setenv("COS_USER_AVATARS_BUCKET", "s")
	t.Setenv("COS_ICON_BUCKET", "t")
	t.Setenv("CDN_FOOD_IMAGES_BASE_URL", "u")
	t.Setenv("CDN_USER_AVATARS_BASE_URL", "v")
	t.Setenv("CDN_HEALTH_REPORTS_BASE_URL", "health")
	t.Setenv("CDN_ICON_BASE_URL", "w")
	t.Setenv("POSTGRESQL_HOST", "x")
	t.Setenv("POSTGRESQL_PORT", "5432")
	t.Setenv("POSTGRESQL_USER", "y")
	t.Setenv("POSTGRESQL_PASSWORD", "z")
	t.Setenv("POSTGRESQL_DATABASE", "db")

	cfg, err := Load(".")
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.App.Port != 3010 || cfg.Database.Host != "x" || cfg.Database.Name != "db" || cfg.JWT.Secret != "b" {
		t.Fatalf("legacy env binding failed: %+v", cfg)
	}
	if cfg.External.OfoxAIBaseURL != "https://proxy.example.com/v1" {
		t.Fatalf("ofox base url env binding failed: %+v", cfg.External)
	}
	if cfg.Storage.CDNHealthReportsBaseURL != "health" {
		t.Fatalf("health reports cdn env binding failed: %+v", cfg.Storage)
	}
}

func TestLoadReadsDeepSeekFromYAML(t *testing.T) {
	oldKey, hadKey := os.LookupEnv("DEEPSEEK_API_KEY")
	_ = os.Unsetenv("DEEPSEEK_API_KEY")
	t.Cleanup(func() {
		if hadKey {
			_ = os.Setenv("DEEPSEEK_API_KEY", oldKey)
		} else {
			_ = os.Unsetenv("DEEPSEEK_API_KEY")
		}
	})

	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	content := []byte(`
external:
  deepseek_api_key: "yaml-key"
`)
	if err := os.WriteFile(configPath, content, 0o600); err != nil {
		t.Fatalf("write config.yaml: %v", err)
	}

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.External.DeepSeekAPIKey != "yaml-key" {
		t.Fatalf("expected yaml deepseek key, got %q", cfg.External.DeepSeekAPIKey)
	}
}

func TestLoadTrimsExternalSecrets(t *testing.T) {
	t.Setenv("DASHSCOPE_API_KEY", " sk-test ")
	t.Setenv("OFOXAI_API_KEY", "\tsk-ofox\n")
	t.Setenv("DEEPSEEK_API_KEY", " deepseek-key ")

	cfg, err := Load(".")
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.External.DashscopeAPIKey != "sk-test" {
		t.Fatalf("expected trimmed dashscope key, got %q", cfg.External.DashscopeAPIKey)
	}
	if cfg.External.OfoxAIAPIKey != "sk-ofox" {
		t.Fatalf("expected trimmed ofox key, got %q", cfg.External.OfoxAIAPIKey)
	}
	if cfg.External.DeepSeekAPIKey != "deepseek-key" {
		t.Fatalf("expected trimmed deepseek key, got %q", cfg.External.DeepSeekAPIKey)
	}
}

func TestLoadPrefersFileExternalKeysOverEnv(t *testing.T) {
	t.Setenv("DASHSCOPE_API_KEY", "bad-env-key")
	t.Setenv("OFOXAI_API_KEY", "bad-ofox")
	t.Setenv("DEEPSEEK_API_KEY", "bad-deepseek")

	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	content := []byte(`
app:
  env: "production"
external:
  dashscope_api_key: "good-dashscope"
  ofoxai_api_key: "good-ofox"
  deepseek_api_key: "good-deepseek"
`)
	if err := os.WriteFile(configPath, content, 0o600); err != nil {
		t.Fatalf("write config.yaml: %v", err)
	}

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.External.DashscopeAPIKey != "good-dashscope" {
		t.Fatalf("expected file dashscope key, got %q", cfg.External.DashscopeAPIKey)
	}
	if cfg.External.OfoxAIAPIKey != "good-ofox" {
		t.Fatalf("expected file ofox key, got %q", cfg.External.OfoxAIAPIKey)
	}
	if cfg.External.DeepSeekAPIKey != "good-deepseek" {
		t.Fatalf("expected file deepseek key, got %q", cfg.External.DeepSeekAPIKey)
	}
}
