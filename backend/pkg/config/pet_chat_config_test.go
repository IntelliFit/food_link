package config

import "testing"

func TestLoadReadsPetChatDeepSeekSettingsFromEnv(t *testing.T) {
	t.Setenv("DEEPSEEK_OFFICIAL_API_KEY", "\tsk-official\n")
	t.Setenv("DEEPSEEK_OFFICIAL_BASE_URL", " https://api.deepseek.com/ ")
	t.Setenv("PET_CHAT_LLM_PROVIDER", " Qwen ")

	cfg, err := Load(writeTestConfig(t, "worker:\n  count: 1\n"))
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.External.DeepSeekOfficialAPIKey != "sk-official" {
		t.Fatalf("expected trimmed official key, got %q", cfg.External.DeepSeekOfficialAPIKey)
	}
	if cfg.External.DeepSeekOfficialBaseURL != "https://api.deepseek.com" {
		t.Fatalf("expected trimmed official base URL, got %q", cfg.External.DeepSeekOfficialBaseURL)
	}
	if cfg.External.PetChatLLMProvider != "qwen" {
		t.Fatalf("expected normalized provider, got %q", cfg.External.PetChatLLMProvider)
	}
}

func TestLoadReadsPetChatDeepSeekSettingsFromYAML(t *testing.T) {
	t.Setenv("DEEPSEEK_OFFICIAL_API_KEY", "")
	t.Setenv("PET_CHAT_LLM_PROVIDER", "")

	cfg, err := Load(writeTestConfig(t, `
worker:
  count: 1
external:
  deepseek_official_api_key: "yaml-official"
  pet_chat_llm_provider: "deepseek"
`))
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.External.DeepSeekOfficialAPIKey != "yaml-official" {
		t.Fatalf("expected yaml official key, got %q", cfg.External.DeepSeekOfficialAPIKey)
	}
	if cfg.External.PetChatLLMProvider != "deepseek" {
		t.Fatalf("expected yaml provider, got %q", cfg.External.PetChatLLMProvider)
	}
}
