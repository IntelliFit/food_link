package config

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTestConfig(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("CONFIG_SOURCE=local\n"), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	configPath := filepath.Join(dir, "app-config.yaml")
	if err := os.WriteFile(configPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write app-config.yaml: %v", err)
	}
	return dir
}

func writeNamedTestConfig(t *testing.T, name string, content string) string {
	t.Helper()
	dir := t.TempDir()
	source := "local"
	if name == "apollo-config.yaml" {
		source = "apollo"
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("CONFIG_SOURCE="+source+"\n"), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	configPath := filepath.Join(dir, name)
	if err := os.WriteFile(configPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	return dir
}

func TestLoadReadsLegacyEnvKeys(t *testing.T) {
	t.Setenv("PORT", "3010")
	t.Setenv("DOUBAO_API_KEY", "a")
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

	dir := writeTestConfig(t, `
worker:
  count: 2
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.App.Port != 3010 || cfg.Database.Host != "x" || cfg.Database.Name != "db" || cfg.JWT.Secret != "b" {
		t.Fatalf("legacy env binding failed: %+v", cfg)
	}
	if cfg.Worker.Count != 2 {
		t.Fatalf("worker config should come from app-config.yaml only: %+v", cfg.Worker)
	}
	if cfg.External.OfoxAIBaseURL != "https://proxy.example.com/v1" {
		t.Fatalf("ofox base url env binding failed: %+v", cfg.External)
	}
	if cfg.Storage.CDNHealthReportsBaseURL != "health" {
		t.Fatalf("health reports cdn env binding failed: %+v", cfg.Storage)
	}
}

func TestLoadReadsAppConfigYAML(t *testing.T) {
	dir := writeNamedTestConfig(t, "app-config.yaml", `
app:
  port: 3910
database:
  host: "app-config-db"
worker:
  count: 2
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.ConfigSource != "local" || cfg.App.Port != 3910 || cfg.Database.Host != "app-config-db" || cfg.Worker.Count != 2 {
		t.Fatalf("expected app-config.yaml values, got %+v", cfg)
	}
}

func TestLoadReadsConfigSourceFromProcessEnv(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONFIG_SOURCE", "local")
	if err := os.WriteFile(filepath.Join(dir, "app-config.yaml"), []byte(`
worker:
  count: 2
`), 0o600); err != nil {
		t.Fatalf("write app-config.yaml: %v", err)
	}

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.ConfigSource != "local" || cfg.Worker.Count != 2 {
		t.Fatalf("expected CONFIG_SOURCE env to select local config, got %+v", cfg)
	}
}

func TestLoadRequiresConfigSourceWhenEnvAndDotenvMissing(t *testing.T) {
	dir := t.TempDir()
	_, err := Load(dir)
	if err == nil {
		t.Fatal("expected missing CONFIG_SOURCE to fail")
	}
	if !strings.Contains(err.Error(), "CONFIG_SOURCE") {
		t.Fatalf("expected CONFIG_SOURCE error, got %v", err)
	}
}

func TestLogConfigFileSnapshotOnlyLogsFileKeys(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "apollo-config.yaml")
	if err := os.WriteFile(path, []byte(`
apollo:
  app_id: "food-link"
  cluster: "dev"
  config_server_url: "https://apollo.example.com"
  namespaces:
    - "application"
  access_key_secret: "super-secret-value"
`), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	original := slog.Default()
	slog.SetDefault(logger)
	t.Cleanup(func() {
		slog.SetDefault(original)
	})

	logConfigFileSnapshot("test", path)

	output := buf.String()
	if !strings.Contains(output, "config.file.key_count=5") {
		t.Fatalf("expected only file keys to be counted, got %s", output)
	}
	if strings.Contains(output, "app.port") {
		t.Fatalf("file snapshot should not include default keys, got %s", output)
	}
	if strings.Contains(output, "super-secret-value") {
		t.Fatalf("file snapshot leaked secret value: %s", output)
	}
}

func TestLoadPrefersApolloConfigOverAppConfig(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("CONFIG_SOURCE=apollo\n"), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app-config.yaml"), []byte(`
worker:
  count: 2
`), 0o600); err != nil {
		t.Fatalf("write app-config.yaml: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "apollo-config.yaml"), []byte(`
apollo:
  app_id: "food-link"
  cluster: "dev"
  config_server_url: "http://127.0.0.1:1"
  namespaces:
    - "application"
`), 0o600); err != nil {
		t.Fatalf("write apollo-config.yaml: %v", err)
	}

	_, err := Load(dir)
	if err == nil {
		t.Fatal("expected Apollo request to fail without test server")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "apollo") {
		t.Fatalf("expected Apollo mode, got %v", err)
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

	dir := writeTestConfig(t, `
external:
  deepseek_api_key: "yaml-key"
worker:
  count: 1
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.External.DeepSeekAPIKey != "yaml-key" {
		t.Fatalf("expected yaml deepseek key, got %q", cfg.External.DeepSeekAPIKey)
	}
}

func TestLoadTrimsExternalSecrets(t *testing.T) {
	t.Setenv("DOUBAO_API_KEY", " sk-test ")
	t.Setenv("DOUBAO_WEB_SEARCH_API_KEY", "\tweb-search-key\n")
	t.Setenv("OFOXAI_API_KEY", "\tsk-ofox\n")
	t.Setenv("GEMINI35_API_KEY", "\tsk-gemini35\n")
	t.Setenv("GEMINI35_BASE_URL", "\thttps://yunwu.ai/v1\n")
	t.Setenv("GEMINI35_MODEL", "\tgemini-3.5-flash\n")
	t.Setenv("DEEPSEEK_API_KEY", " deepseek-key ")

	dir := writeTestConfig(t, `
worker:
  count: 1
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.External.DoubaoAPIKey != "sk-test" {
		t.Fatalf("expected trimmed doubao key, got %q", cfg.External.DoubaoAPIKey)
	}
	if cfg.External.DoubaoWebSearchAPIKey != "web-search-key" {
		t.Fatalf("expected trimmed doubao web search key, got %q", cfg.External.DoubaoWebSearchAPIKey)
	}
	if cfg.External.OfoxAIAPIKey != "sk-ofox" {
		t.Fatalf("expected trimmed ofox key, got %q", cfg.External.OfoxAIAPIKey)
	}
	if cfg.External.Gemini35APIKey != "sk-gemini35" {
		t.Fatalf("expected trimmed gemini35 key, got %q", cfg.External.Gemini35APIKey)
	}
	if cfg.External.Gemini35BaseURL != "https://yunwu.ai/v1" {
		t.Fatalf("expected trimmed gemini35 base URL, got %q", cfg.External.Gemini35BaseURL)
	}
	if cfg.External.Gemini35Model != "gemini-3.5-flash" {
		t.Fatalf("expected trimmed gemini35 model, got %q", cfg.External.Gemini35Model)
	}
	if cfg.External.DeepSeekAPIKey != "deepseek-key" {
		t.Fatalf("expected trimmed deepseek key, got %q", cfg.External.DeepSeekAPIKey)
	}
}

func TestLoadPrefersFileExternalKeysOverEnv(t *testing.T) {
	t.Setenv("DOUBAO_API_KEY", "bad-env-key")
	t.Setenv("DOUBAO_WEB_SEARCH_API_KEY", "bad-web-search")
	t.Setenv("OFOXAI_API_KEY", "bad-ofox")
	t.Setenv("GEMINI35_API_KEY", "bad-gemini35")
	t.Setenv("GEMINI35_BASE_URL", "https://bad.example.com")
	t.Setenv("GEMINI35_MODEL", "bad-model")
	t.Setenv("DEEPSEEK_API_KEY", "bad-deepseek")

	dir := writeTestConfig(t, `
app:
  env: "production"
external:
  doubao_api_key: "good-doubao"
  doubao_web_search_api_key: "good-web-search"
  ofoxai_api_key: "good-ofox"
  gemini35_api_key: "good-gemini35"
  gemini35_base_url: "https://good.example.com/v1"
  gemini35_model: "gemini-3.5-flash"
  deepseek_api_key: "good-deepseek"
worker:
  count: 1
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.External.DoubaoAPIKey != "good-doubao" {
		t.Fatalf("expected file doubao key, got %q", cfg.External.DoubaoAPIKey)
	}
	if cfg.External.DoubaoWebSearchAPIKey != "good-web-search" {
		t.Fatalf("expected file doubao web search key, got %q", cfg.External.DoubaoWebSearchAPIKey)
	}
	if cfg.External.OfoxAIAPIKey != "good-ofox" {
		t.Fatalf("expected file ofox key, got %q", cfg.External.OfoxAIAPIKey)
	}
	if cfg.External.Gemini35APIKey != "good-gemini35" {
		t.Fatalf("expected file gemini35 key, got %q", cfg.External.Gemini35APIKey)
	}
	if cfg.External.Gemini35BaseURL != "https://good.example.com/v1" {
		t.Fatalf("expected file gemini35 base URL, got %q", cfg.External.Gemini35BaseURL)
	}
	if cfg.External.Gemini35Model != "gemini-3.5-flash" {
		t.Fatalf("expected file gemini35 model, got %q", cfg.External.Gemini35Model)
	}
	if cfg.External.DeepSeekAPIKey != "good-deepseek" {
		t.Fatalf("expected file deepseek key, got %q", cfg.External.DeepSeekAPIKey)
	}
}

func TestLoadRequiresWorkerCountInConfig(t *testing.T) {
	dir := writeTestConfig(t, `
app:
  env: "development"
`)

	_, err := Load(dir)
	if err == nil {
		t.Fatal("expected missing worker.count to fail")
	}
	if !strings.Contains(err.Error(), "worker.count") {
		t.Fatalf("expected worker.count error, got %v", err)
	}
}

func TestLoadAllowsWorkerCountZero(t *testing.T) {
	dir := writeTestConfig(t, `
worker:
  count: 0
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.Worker.Count != 0 {
		t.Fatalf("expected worker count 0, got %+v", cfg.Worker)
	}
}

func TestLoadOTelDefaultsEnableTraceAndMetricsWhenEnabled(t *testing.T) {
	dir := writeTestConfig(t, `
otel:
  enabled: true
  collector_endpoint: "otel-collector:4317"
worker:
  count: 1
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !cfg.OTel.Enabled || !cfg.OTel.TracesEnabled || !cfg.OTel.MetricsEnabled {
		t.Fatalf("expected otel traces and metrics enabled by default, got %+v", cfg.OTel)
	}
	if cfg.OTel.MetricExportIntervalSeconds != 15 {
		t.Fatalf("expected default metric export interval, got %+v", cfg.OTel)
	}
}

func TestLoadTaskQueueDefaultsToMemory(t *testing.T) {
	dir := writeTestConfig(t, `
worker:
  count: 1
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.TaskQueue.Driver != "memory" {
		t.Fatalf("expected memory queue driver, got %+v", cfg.TaskQueue)
	}
	if cfg.TaskQueue.BufferSize != 1024 {
		t.Fatalf("expected default queue buffer size, got %+v", cfg.TaskQueue)
	}
}

func TestLoadTaskQueueReadsConfigFileOnly(t *testing.T) {
	t.Setenv("TASK_QUEUE_DRIVER", "kafka")

	dir := writeTestConfig(t, `
worker:
  count: 1
task_queue:
  driver: "memory"
  buffer_size: 7
  topic: "local-analysis"
  brokers:
    - "localhost:9092"
  consumer_group: "local-workers"
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.TaskQueue.Driver != "memory" {
		t.Fatalf("expected task queue driver from app-config.yaml, got %+v", cfg.TaskQueue)
	}
	if cfg.TaskQueue.BufferSize != 7 || cfg.TaskQueue.Topic != "local-analysis" || cfg.TaskQueue.ConsumerGroup != "local-workers" {
		t.Fatalf("unexpected task queue config: %+v", cfg.TaskQueue)
	}
	if len(cfg.TaskQueue.Brokers) != 1 || cfg.TaskQueue.Brokers[0] != "localhost:9092" {
		t.Fatalf("unexpected task queue brokers: %+v", cfg.TaskQueue)
	}
}

func TestLoadTaskQueueReadsKafkaConfig(t *testing.T) {
	dir := writeTestConfig(t, `
worker:
  count: 2
task_queue:
  driver: "kafka"
  buffer_size: 1024
  topic: "food-link-analysis-tasks"
  brokers:
    - "kafka-1:9092,kafka-2:9092"
  consumer_group: "food-link-workers"
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.TaskQueue.Driver != "kafka" {
		t.Fatalf("expected kafka queue driver, got %+v", cfg.TaskQueue)
	}
	if len(cfg.TaskQueue.Brokers) != 2 {
		t.Fatalf("unexpected task queue brokers: %+v", cfg.TaskQueue)
	}
	if cfg.TaskQueue.Topic != "food-link-analysis-tasks" || cfg.TaskQueue.ConsumerGroup != "food-link-workers" {
		t.Fatalf("unexpected task queue config: %+v", cfg.TaskQueue)
	}
}

func TestConfigKeyForSecretSupportsPathAndLegacyNames(t *testing.T) {
	cases := map[string]string{
		"external.doubao_api_key": "external.doubao_api_key",
		"database.host":           "database.host",
		"database__host":          "database.host",
		"POSTGRESQL_HOST":         "database.host",
		"TASK_QUEUE_BROKERS":      "task_queue.brokers",
		"worker-count":            "worker_count",
	}
	for input, want := range cases {
		if got := configKeyForSecret(input); got != want {
			t.Fatalf("configKeyForSecret(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestLoadMergesApolloConfig(t *testing.T) {
	var sawConfig bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/configfiles/json/food-link/dev/application":
			sawConfig = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"database.host":"db.example.internal",
				"POSTGRESQL_DATABASE":"food-cloud",
				"JWT_SECRET_KEY":"cloud-jwt",
				"DOUBAO_API_KEY":"cloud-doubao",
				"WORKER_COUNT":"3",
				"TASK_QUEUE_BROKERS":"kafka-1:9092,kafka-2:9092"
			}`))
		case r.Method == http.MethodGet && r.URL.Path == "/services/config":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
		case r.Method == http.MethodGet && r.URL.Path == "/notifications/v2":
			w.WriteHeader(http.StatusNotModified)
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	dir := writeNamedTestConfig(t, "apollo-config.yaml", `
apollo:
  app_id: "food-link"
  cluster: "dev"
  config_server_url: "`+server.URL+`"
  namespaces:
    - "application"
database:
  host: "local-should-not-be-used"
  name: "local-should-not-be-used"
jwt:
  secret: "local-should-not-be-used"
worker:
  count: 1
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !sawConfig {
		t.Fatal("expected Apollo config request")
	}
	if cfg.Database.Host != "db.example.internal" || cfg.Database.Name != "food-cloud" {
		t.Fatalf("expected database config from Apollo, got %+v", cfg.Database)
	}
	if cfg.JWT.Secret != "cloud-jwt" || cfg.External.DoubaoAPIKey != "cloud-doubao" {
		t.Fatalf("expected secrets from Apollo, got jwt=%q external=%+v", cfg.JWT.Secret, cfg.External)
	}
	if cfg.Worker.Count != 3 {
		t.Fatalf("expected worker count from Apollo, got %+v", cfg.Worker)
	}
	if len(cfg.TaskQueue.Brokers) != 2 || cfg.TaskQueue.Brokers[1] != "kafka-2:9092" {
		t.Fatalf("expected normalized kafka brokers from Apollo, got %+v", cfg.TaskQueue.Brokers)
	}
	if cfg.ConfigSource != "apollo" {
		t.Fatalf("expected Apollo config source, got %q", cfg.ConfigSource)
	}
}

func TestLoadMergesApolloYAMLNamespaceFromRawText(t *testing.T) {
	var sawRawConfig bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/configfiles/food-link/dev/app-config.yaml":
			sawRawConfig = true
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte(`content=database\:\n  host\: db-from-raw-yaml\njwt\:\n  secret\: yaml-jwt\nworker\:\n  count\: 3\ntask_queue\:\n  driver\: kafka\n  brokers\:\n    - kafka\:9092\n`))
		case r.Method == http.MethodGet && r.URL.Path == "/configfiles/json/food-link/dev/app-config.yaml":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"task_queue.brokers": "[kafka:9092]"
			}`))
		case r.Method == http.MethodGet && r.URL.Path == "/services/config":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
		case r.Method == http.MethodGet && r.URL.Path == "/notifications/v2":
			w.WriteHeader(http.StatusNotModified)
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	dir := writeNamedTestConfig(t, "apollo-config.yaml", `
apollo:
  app_id: "food-link"
  cluster: "dev"
  config_server_url: "`+server.URL+`"
  namespaces:
    - "app-config.yaml"
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !sawRawConfig {
		t.Fatal("expected raw Apollo configfiles endpoint to be used for YAML namespace")
	}
	if cfg.Database.Host != "db-from-raw-yaml" {
		t.Fatalf("expected database host from raw YAML, got %+v", cfg.Database)
	}
	if len(cfg.TaskQueue.Brokers) != 1 || cfg.TaskQueue.Brokers[0] != "kafka:9092" {
		t.Fatalf("expected brokers from raw YAML list, got %+v", cfg.TaskQueue.Brokers)
	}
}

func TestLoadMergesApolloYAMLContentFromApplicationNamespace(t *testing.T) {
	var sawConfig bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/configfiles/json/food-link/dev/application":
			sawConfig = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"content": "database:\n  host: db-from-yaml\njwt:\n  secret: yaml-jwt\nworker:\n  count: 4\ntask_queue:\n  brokers:\n    - kafka-1:9092,kafka-2:9092\n"
			}`))
		case r.Method == http.MethodGet && r.URL.Path == "/services/config":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
		case r.Method == http.MethodGet && r.URL.Path == "/notifications/v2":
			w.WriteHeader(http.StatusNotModified)
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	dir := writeNamedTestConfig(t, "apollo-config.yaml", `
apollo:
  app_id: "food-link"
  cluster: "dev"
  config_server_url: "`+server.URL+`"
  namespaces:
    - "application"
`)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !sawConfig {
		t.Fatal("expected Apollo config request")
	}
	if cfg.Database.Host != "db-from-yaml" || cfg.JWT.Secret != "yaml-jwt" || cfg.Worker.Count != 4 {
		t.Fatalf("expected config from Apollo YAML content, got %+v", cfg)
	}
	if len(cfg.TaskQueue.Brokers) != 2 || cfg.TaskQueue.Brokers[1] != "kafka-2:9092" {
		t.Fatalf("expected normalized brokers from YAML content, got %+v", cfg.TaskQueue.Brokers)
	}
}

func TestLoadApolloModeDoesNotUseLocalBusinessConfig(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/configfiles/json/food-link/dev/application":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{}`))
		case r.Method == http.MethodGet && r.URL.Path == "/configfiles/json/food-link/dev/application.yaml":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{}`))
		case r.Method == http.MethodGet && r.URL.Path == "/configfiles/json/food-link/dev/application.yml":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{}`))
		case r.Method == http.MethodGet && r.URL.Path == "/services/config":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
		case r.Method == http.MethodGet && r.URL.Path == "/notifications/v2":
			w.WriteHeader(http.StatusNotModified)
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	dir := writeNamedTestConfig(t, "apollo-config.yaml", `
apollo:
  app_id: "food-link"
  cluster: "dev"
  config_server_url: "`+server.URL+`"
  namespaces:
    - "application"
worker:
  count: 7
`)

	_, err := Load(dir)
	if err == nil {
		t.Fatal("expected missing cloud worker.count to fail")
	}
	if !strings.Contains(err.Error(), "apollo returned no config") {
		t.Fatalf("expected empty Apollo config error, got %v", err)
	}
}
