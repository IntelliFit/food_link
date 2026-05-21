package config

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/apolloconfig/agollo/v5"
	apolloConfig "github.com/apolloconfig/agollo/v5/env/config"
	"github.com/spf13/viper"
)

type Config struct {
	ConfigSource string          `mapstructure:"config_source"`
	App          AppConfig       `mapstructure:"app"`
	Log          LogConfig       `mapstructure:"log"`
	Database     DatabaseConfig  `mapstructure:"database"`
	JWT          JWTConfig       `mapstructure:"jwt"`
	OTel         OTelConfig      `mapstructure:"otel"`
	Storage      StorageConfig   `mapstructure:"storage"`
	External     ExternalConfig  `mapstructure:"external"`
	WechatPay    WechatPayConfig `mapstructure:"wechat_pay"`
	Worker       WorkerConfig    `mapstructure:"worker"`
	TaskQueue    TaskQueueConfig `mapstructure:"task_queue"`
	Apollo       ApolloConfig    `mapstructure:"apollo"`
}

type AppConfig struct {
	Name string `mapstructure:"name"`
	Env  string `mapstructure:"env"`
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
}

type LogConfig struct {
	Level    string `mapstructure:"level"`
	Format   string `mapstructure:"format"`
	Output   string `mapstructure:"output"`
	FilePath string `mapstructure:"file_path"`
}

type DatabaseConfig struct {
	Driver   string `mapstructure:"driver"`
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Name     string `mapstructure:"name"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	SSLMode  string `mapstructure:"sslmode"`
	Schema   string `mapstructure:"schema"`
}

type JWTConfig struct {
	Secret                 string `mapstructure:"secret"`
	AccessTokenTTLSeconds  int64  `mapstructure:"access_token_ttl_seconds"`
	RefreshTokenTTLSeconds int64  `mapstructure:"refresh_token_ttl_seconds"`
}

type OTelConfig struct {
	Enabled                     bool    `mapstructure:"enabled"`
	TracesEnabled               bool    `mapstructure:"traces_enabled"`
	MetricsEnabled              bool    `mapstructure:"metrics_enabled"`
	CollectorEndpoint           string  `mapstructure:"collector_endpoint"`
	Insecure                    bool    `mapstructure:"insecure"`
	MetricExportIntervalSeconds float64 `mapstructure:"metric_export_interval_seconds"`
}

type StorageConfig struct {
	COSRegion               string `mapstructure:"cos_region"`
	COSSecretID             string `mapstructure:"cos_secret_id"`
	COSSecretKey            string `mapstructure:"cos_secret_key"`
	COSFoodImagesBucket     string `mapstructure:"food_images_bucket"`
	COSHealthReportsBucket  string `mapstructure:"health_reports_bucket"`
	COSUserAvatarsBucket    string `mapstructure:"user_avatars_bucket"`
	COSIconBucket           string `mapstructure:"icon_bucket"`
	CDNFoodImagesBaseURL    string `mapstructure:"food_images_cdn_base_url"`
	CDNUserAvatarsBaseURL   string `mapstructure:"user_avatars_cdn_base_url"`
	CDNHealthReportsBaseURL string `mapstructure:"health_reports_cdn_base_url"`
	CDNIconBaseURL          string `mapstructure:"icon_cdn_base_url"`
}

type ExternalConfig struct {
	AppID                 string `mapstructure:"appid"`
	Secret                string `mapstructure:"secret"`
	SupabaseURL           string `mapstructure:"supabase_url"`
	SupabaseKey           string `mapstructure:"supabase_service_role_key"`
	TiandituTK            string `mapstructure:"tianditu_tk"`
	OfoxAIAPIKey          string `mapstructure:"ofoxai_api_key"`
	OfoxAIBaseURL         string `mapstructure:"ofoxai_base_url"`
	Gemini35APIKey        string `mapstructure:"gemini35_api_key"`
	Gemini35BaseURL       string `mapstructure:"gemini35_base_url"`
	Gemini35Model         string `mapstructure:"gemini35_model"`
	LLMProvider           string `mapstructure:"llm_provider"`
	DeepSeekAPIKey        string `mapstructure:"deepseek_api_key"`
	DoubaoAPIKey          string `mapstructure:"doubao_api_key"`
	DoubaoWebSearchAPIKey string `mapstructure:"doubao_web_search_api_key"`
	DoubaoBaseURL         string `mapstructure:"doubao_base_url"`
}

type WechatPayConfig struct {
	MchID                     string `mapstructure:"mchid"`
	NotifyURL                 string `mapstructure:"notify_url"`
	SerialNo                  string `mapstructure:"serial_no"`
	APIV3Key                  string `mapstructure:"api_v3_key"`
	PrivateKey                string `mapstructure:"private_key"`
	PublicKey                 string `mapstructure:"public_key"`
	ExpirySubscribeTemplateID string `mapstructure:"expiry_subscribe_template_id"`
}

type WorkerConfig struct {
	ID                  string  `mapstructure:"id"`
	Count               int     `mapstructure:"count"`
	PollIntervalSeconds float64 `mapstructure:"poll_interval_seconds"`
}

type TaskQueueConfig struct {
	Driver        string   `mapstructure:"driver"`
	BufferSize    int      `mapstructure:"buffer_size"`
	Topic         string   `mapstructure:"topic"`
	Brokers       []string `mapstructure:"brokers"`
	ConsumerGroup string   `mapstructure:"consumer_group"`
}

type ApolloConfig struct {
	AppID            string   `mapstructure:"app_id"`
	Cluster          string   `mapstructure:"cluster"`
	ConfigServerURL  string   `mapstructure:"config_server_url"`
	Namespaces       []string `mapstructure:"namespaces"`
	AccessKeySecret  string   `mapstructure:"access_key_secret"`
	BackupConfigPath string   `mapstructure:"backup_config_path"`
	EnableBackup     bool     `mapstructure:"enable_backup"`
	MustStart        bool     `mapstructure:"must_start"`
	Label            string   `mapstructure:"label"`
	SyncTimeoutSec   int      `mapstructure:"sync_timeout_seconds"`
}

func Load(baseDir string) (*Config, error) {
	slog.Info("开始加载后端配置", slog.String("config.base_dir", baseDir))
	source, err := readConfigSource(baseDir)
	if err != nil {
		return nil, err
	}
	slog.Info("配置源已确定", slog.String("config.source", source))

	v := viper.New()
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	setDefaults(v)
	v.Set("config_source", source)
	switch source {
	case "local":
		configPath := filepath.Join(baseDir, "app-config.yaml")
		if err := readYAMLConfigFile(v, configPath); err != nil {
			return nil, err
		}
		logConfigFileSnapshot("本地配置文件已读取", configPath)
		v.Set("config_source", source)
		bindLegacyEnv(v)
		if err := applyLocalConfigOverrides(v); err != nil {
			return nil, err
		}
	case "apollo":
		bootstrap := viper.New()
		setDefaults(bootstrap)
		bootstrap.Set("config_source", source)
		configPath := filepath.Join(baseDir, "apollo-config.yaml")
		if err := readYAMLConfigFile(bootstrap, configPath); err != nil {
			return nil, err
		}
		logConfigFileSnapshot("Apollo 启动配置文件已读取", configPath)
		bootstrap.Set("config_source", source)
		cloudV, err := loadApolloConfig(context.Background(), bootstrap)
		if err != nil {
			return nil, err
		}
		v = cloudV
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}
	cfg.ConfigSource = source
	trimExternalConfig(&cfg.External)
	if err := applyConfigFileOnlyValues(v, &cfg); err != nil {
		return nil, err
	}
	logConfigSnapshot("后端配置解析完成", strings.TrimSpace(v.GetString("config_file_used")), v)
	return &cfg, nil
}

func readConfigSource(baseDir string) (string, error) {
	if source := normalizeConfigSource(os.Getenv("CONFIG_SOURCE")); source != "" {
		if source != "local" && source != "apollo" {
			return "", fmt.Errorf("CONFIG_SOURCE must be local or apollo, got %q", source)
		}
		slog.Info("CONFIG_SOURCE 已从进程环境变量读取", slog.String("config.source", source))
		return source, nil
	}

	sourceV := viper.New()
	envPath := filepath.Join(baseDir, ".env")
	sourceV.SetConfigFile(envPath)
	sourceV.SetConfigType("env")
	if err := sourceV.ReadInConfig(); err != nil {
		if isConfigNotFound(err) || os.IsNotExist(err) {
			return "", fmt.Errorf("CONFIG_SOURCE must be set in the process environment or .env")
		}
		return "", err
	}
	source := normalizeConfigSource(sourceV.GetString("CONFIG_SOURCE"))
	if source == "" {
		return "", fmt.Errorf("CONFIG_SOURCE must be set to local or apollo in .env")
	}
	if source != "local" && source != "apollo" {
		return "", fmt.Errorf("CONFIG_SOURCE must be local or apollo, got %q", source)
	}
	slog.Info("CONFIG_SOURCE 已从 .env 文件读取",
		slog.String("config.env_file", envPath),
		slog.String("config.source", source),
	)
	return source, nil
}

func readYAMLConfigFile(v *viper.Viper, path string) error {
	reader := viper.New()
	reader.SetConfigFile(path)
	reader.SetConfigType("yaml")
	if err := reader.ReadInConfig(); err != nil {
		if isConfigNotFound(err) {
			return fmt.Errorf("%s must exist", filepath.Base(path))
		}
		return err
	}
	v.Set("config_file_used", path)
	return v.MergeConfigMap(reader.AllSettings())
}

func isConfigNotFound(err error) bool {
	var notFound viper.ConfigFileNotFoundError
	if errors.As(err, &notFound) {
		return true
	}
	return strings.Contains(err.Error(), "Not Found") || strings.Contains(err.Error(), "not found")
}

func normalizeConfigSource(source string) string {
	source = strings.TrimSpace(strings.ToLower(source))
	return source
}

func applyLocalConfigOverrides(v *viper.Viper) error {
	configFile := strings.TrimSpace(v.GetString("config_file_used"))
	if configFile == "" {
		return nil
	}
	fileV := viper.New()
	fileV.SetConfigFile(configFile)
	if err := fileV.ReadInConfig(); err != nil {
		return err
	}
	var fileCfg Config
	if err := fileV.Unmarshal(&fileCfg); err != nil {
		return err
	}
	trimExternalConfig(&fileCfg.External)
	if fileCfg.External.DoubaoAPIKey != "" {
		v.Set("external.doubao_api_key", fileCfg.External.DoubaoAPIKey)
	}
	if fileCfg.External.DoubaoWebSearchAPIKey != "" {
		v.Set("external.doubao_web_search_api_key", fileCfg.External.DoubaoWebSearchAPIKey)
	}
	if fileCfg.External.DoubaoBaseURL != "" {
		v.Set("external.doubao_base_url", fileCfg.External.DoubaoBaseURL)
	}
	if fileCfg.External.OfoxAIAPIKey != "" {
		v.Set("external.ofoxai_api_key", fileCfg.External.OfoxAIAPIKey)
	}
	if fileCfg.External.Gemini35APIKey != "" {
		v.Set("external.gemini35_api_key", fileCfg.External.Gemini35APIKey)
	}
	if fileCfg.External.Gemini35BaseURL != "" {
		v.Set("external.gemini35_base_url", fileCfg.External.Gemini35BaseURL)
	}
	if fileCfg.External.Gemini35Model != "" {
		v.Set("external.gemini35_model", fileCfg.External.Gemini35Model)
	}
	if fileCfg.External.DeepSeekAPIKey != "" {
		v.Set("external.deepseek_api_key", fileCfg.External.DeepSeekAPIKey)
	}
	if fileV.IsSet("worker.id") {
		v.Set("worker.id", fileCfg.Worker.ID)
	}
	if fileV.IsSet("worker.count") {
		v.Set("worker.count", fileCfg.Worker.Count)
	}
	if fileV.IsSet("worker.poll_interval_seconds") {
		v.Set("worker.poll_interval_seconds", fileCfg.Worker.PollIntervalSeconds)
	}
	if fileV.IsSet("task_queue.driver") {
		v.Set("task_queue.driver", strings.TrimSpace(fileCfg.TaskQueue.Driver))
	}
	if fileV.IsSet("task_queue.buffer_size") {
		v.Set("task_queue.buffer_size", fileCfg.TaskQueue.BufferSize)
	}
	if fileV.IsSet("task_queue.topic") {
		v.Set("task_queue.topic", strings.TrimSpace(fileCfg.TaskQueue.Topic))
	}
	if fileV.IsSet("task_queue.brokers") {
		v.Set("task_queue.brokers", normalizeCSV(fileCfg.TaskQueue.Brokers))
	}
	if fileV.IsSet("task_queue.consumer_group") {
		v.Set("task_queue.consumer_group", strings.TrimSpace(fileCfg.TaskQueue.ConsumerGroup))
	}
	return nil
}

func loadApolloConfig(_ context.Context, bootstrap *viper.Viper) (*viper.Viper, error) {
	var cfg ApolloConfig
	if err := bootstrap.UnmarshalKey("apollo", &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal apollo config: %w", err)
	}
	trimApolloConfig(&cfg)
	if cfg.AppID == "" {
		return nil, fmt.Errorf("apollo.app_id must be set")
	}
	if cfg.Cluster == "" {
		return nil, fmt.Errorf("apollo.cluster must be set")
	}
	if cfg.ConfigServerURL == "" {
		return nil, fmt.Errorf("apollo.config_server_url must be set")
	}
	if len(cfg.Namespaces) == 0 {
		return nil, fmt.Errorf("apollo.namespaces must contain at least one namespace")
	}
	if cfg.SyncTimeoutSec <= 0 {
		cfg.SyncTimeoutSec = 5
	}

	namespaceText := strings.Join(cfg.Namespaces, ",")
	clientConfig := &apolloConfig.AppConfig{
		AppID:             cfg.AppID,
		Cluster:           cfg.Cluster,
		IP:                cfg.ConfigServerURL,
		NamespaceName:     namespaceText,
		Secret:            cfg.AccessKeySecret,
		BackupConfigPath:  cfg.BackupConfigPath,
		IsBackupConfig:    cfg.EnableBackup,
		MustStart:         cfg.MustStart,
		Label:             cfg.Label,
		SyncServerTimeout: cfg.SyncTimeoutSec,
	}
	slog.Info("准备连接 Apollo",
		slog.String("apollo.config_server_url", cfg.ConfigServerURL),
		slog.String("apollo.app_id", cfg.AppID),
		slog.String("apollo.cluster", cfg.Cluster),
		slog.String("apollo.namespaces", namespaceText),
		slog.Bool("apollo.enable_backup", cfg.EnableBackup),
		slog.Bool("apollo.must_start", cfg.MustStart),
	)
	client, err := agollo.StartWithConfig(func() (*apolloConfig.AppConfig, error) {
		return clientConfig, nil
	})
	if err != nil {
		return nil, fmt.Errorf("apollo start: %w", err)
	}
	defer client.Close()

	cloudV := viper.New()
	cloudV.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	setDefaults(cloudV)
	cloudV.Set("config_source", "apollo")
	cloudV.Set("apollo", cfg)

	items := make([]maskedApolloConfigItem, 0)
	for _, namespace := range cfg.Namespaces {
		appendApolloNamespaceConfig(client, cloudV, namespace, &items)
	}
	if len(items) == 0 {
		return nil, fmt.Errorf(
			"apollo returned no config: app_id=%s cluster=%s namespaces=%s; check whether the namespace exists, the config has been published, and access_key_secret is correct",
			cfg.AppID,
			cfg.Cluster,
			strings.Join(cfg.Namespaces, ","),
		)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Namespace != items[j].Namespace {
			return items[i].Namespace < items[j].Namespace
		}
		return items[i].Key < items[j].Key
	})
	slog.Info("Apollo 配置已拉取",
		slog.Int("apollo.config_count", len(items)),
		slog.Any("apollo.configs", items),
	)
	logConfigSnapshot("Apollo 配置已映射为后端配置键", "", cloudV)
	return cloudV, nil
}

func appendApolloNamespaceConfig(client agollo.Client, cloudV *viper.Viper, namespace string, items *[]maskedApolloConfigItem) int {
	cache := client.GetConfigCache(namespace)
	if cache == nil {
		slog.Warn("Apollo namespace 未返回配置缓存",
			slog.String("apollo.namespace", namespace),
		)
		return 0
	}
	loaded := 0
	cache.Range(func(key, value any) bool {
		keyText := fmt.Sprint(key)
		valueText := fmt.Sprint(value)
		if strings.EqualFold(keyText, "content") && looksLikeYAMLConfig(valueText) {
			for yamlKey, yamlValue := range parseApolloYAMLContent(valueText) {
				if mappedKey := configKeyForSecret(yamlKey); mappedKey != "" {
					yamlValueText := fmt.Sprint(yamlValue)
					cloudV.Set(mappedKey, yamlValueText)
					*items = append(*items, maskedApolloConfigItem{
						Namespace: namespace,
						Key:       yamlKey,
						MappedKey: mappedKey,
						Value:     maskValue(yamlValueText),
					})
					loaded++
				}
			}
			return true
		}
		if mappedKey := configKeyForSecret(keyText); mappedKey != "" {
			cloudV.Set(mappedKey, valueText)
			*items = append(*items, maskedApolloConfigItem{
				Namespace: namespace,
				Key:       keyText,
				MappedKey: mappedKey,
				Value:     maskValue(valueText),
			})
			loaded++
		}
		return true
	})
	return loaded
}

func looksLikeYAMLConfig(content string) bool {
	content = strings.TrimSpace(content)
	return strings.Contains(content, "\n") && strings.Contains(content, ":")
}

func parseApolloYAMLContent(content string) map[string]any {
	reader := viper.New()
	reader.SetConfigType("yaml")
	if err := reader.ReadConfig(bytes.NewBufferString(content)); err != nil {
		slog.Warn("Apollo content YAML 解析失败",
			slog.String("error", err.Error()),
		)
		return nil
	}
	return flattenSettings(reader.AllSettings())
}

type maskedConfigKV struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type maskedApolloConfigItem struct {
	Namespace string `json:"namespace"`
	Key       string `json:"key"`
	MappedKey string `json:"mapped_key"`
	Value     string `json:"value"`
}

func logConfigSnapshot(message, path string, v *viper.Viper) {
	if v == nil {
		return
	}
	attrs := maskedSettingsAttrs("config", v.AllSettings())
	if strings.TrimSpace(path) != "" {
		attrs = append(attrs, slog.String("config.file", path))
	}
	slog.LogAttrs(context.Background(), slog.LevelInfo, message, attrs...)
}

func logConfigFileSnapshot(message, path string) {
	fileV := viper.New()
	fileV.SetConfigFile(path)
	if err := fileV.ReadInConfig(); err != nil {
		slog.Warn("配置文件日志快照读取失败",
			slog.String("config.file", path),
			slog.String("error", err.Error()),
		)
		return
	}
	attrs := maskedSettingsAttrs("config.file", fileV.AllSettings())
	attrs = append(attrs, slog.String("config.file", path))
	slog.LogAttrs(context.Background(), slog.LevelInfo, message, attrs...)
}

func maskedSettingsAttrs(prefix string, settings map[string]any) []slog.Attr {
	flat := flattenSettings(settings)
	return []slog.Attr{
		slog.Int(prefix+".key_count", len(flat)),
		slog.Any(prefix+".keys", maskSettings(settings)),
	}
}

func maskSettings(settings map[string]any) []maskedConfigKV {
	flat := flattenSettings(settings)
	out := make([]maskedConfigKV, 0, len(flat))
	for _, key := range sortedKeys(flat) {
		out = append(out, maskedConfigKV{Key: key, Value: maskValue(fmt.Sprint(flat[key]))})
	}
	return out
}

func flattenSettings(settings map[string]any) map[string]any {
	out := map[string]any{}
	flattenValue("", settings, out)
	return out
}

func flattenValue(prefix string, value any, out map[string]any) {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			next := key
			if prefix != "" {
				next = prefix + "." + key
			}
			flattenValue(next, child, out)
		}
	case map[any]any:
		for key, child := range typed {
			keyText := fmt.Sprint(key)
			next := keyText
			if prefix != "" {
				next = prefix + "." + keyText
			}
			flattenValue(next, child, out)
		}
	case []string:
		out[prefix] = strings.Join(typed, ",")
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			parts = append(parts, fmt.Sprint(item))
		}
		out[prefix] = strings.Join(parts, ",")
	default:
		out[prefix] = typed
	}
}

func sortedKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		if strings.TrimSpace(key) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func maskValue(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = strings.ReplaceAll(value, "\r", "")
	value = strings.ReplaceAll(value, "\n", "\\n")
	runes := []rune(value)
	if len(runes) <= 2 {
		return strings.Repeat("*", len(runes))
	}
	if len(runes) <= 8 {
		return string(runes[:1]) + strings.Repeat("*", len(runes)-2) + string(runes[len(runes)-1:])
	}
	return string(runes[:3]) + strings.Repeat("*", 6) + string(runes[len(runes)-3:])
}

func configKeyForSecret(secretKey string) string {
	key := strings.TrimSpace(secretKey)
	if key == "" {
		return ""
	}
	normalized := strings.ToLower(strings.ReplaceAll(key, "__", "."))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	if strings.Contains(normalized, ".") {
		return normalized
	}
	if mapped, ok := cloudConfigKeyAliases[strings.ToUpper(key)]; ok {
		return mapped
	}
	return normalized
}

var cloudConfigKeyAliases = map[string]string{
	"PORT":                                "app.port",
	"APPID":                               "external.appid",
	"SECRET":                              "external.secret",
	"JWT_SECRET_KEY":                      "jwt.secret",
	"SUPABASE_URL":                        "external.supabase_url",
	"SUPABASE_SERVICE_ROLE_KEY":           "external.supabase_service_role_key",
	"TIANDITU_TK":                         "external.tianditu_tk",
	"OFOXAI_API_KEY":                      "external.ofoxai_api_key",
	"OFOXAI_BASE_URL":                     "external.ofoxai_base_url",
	"OFOX_BASE_URL":                       "external.ofoxai_base_url",
	"GEMINI35_API_KEY":                    "external.gemini35_api_key",
	"GEMINI35_BASE_URL":                   "external.gemini35_base_url",
	"GEMINI35_MODEL":                      "external.gemini35_model",
	"LLM_PROVIDER":                        "external.llm_provider",
	"DEEPSEEK_API_KEY":                    "external.deepseek_api_key",
	"DOUBAO_API_KEY":                      "external.doubao_api_key",
	"DOUBAO_WEB_SEARCH_API_KEY":           "external.doubao_web_search_api_key",
	"DOUBAO_BASE_URL":                     "external.doubao_base_url",
	"WECHAT_PAY_MCHID":                    "wechat_pay.mchid",
	"WECHAT_PAY_NOTIFY_URL":               "wechat_pay.notify_url",
	"WECHAT_PAY_SERIAL_NO":                "wechat_pay.serial_no",
	"WECHAT_PAY_API_V3_KEY":               "wechat_pay.api_v3_key",
	"WECHAT_PAY_PRIVATE_KEY":              "wechat_pay.private_key",
	"WECHAT_PAY_PUBLIC_KEY":               "wechat_pay.public_key",
	"EXPIRY_SUBSCRIBE_TEMPLATE_ID":        "wechat_pay.expiry_subscribe_template_id",
	"COS_REGION":                          "storage.cos_region",
	"COS_SECRET_ID":                       "storage.cos_secret_id",
	"COS_SECRET_KEY":                      "storage.cos_secret_key",
	"COS_FOOD_IMAGES_BUCKET":              "storage.food_images_bucket",
	"COS_HEALTH_REPORTS_BUCKET":           "storage.health_reports_bucket",
	"COS_USER_AVATARS_BUCKET":             "storage.user_avatars_bucket",
	"COS_ICON_BUCKET":                     "storage.icon_bucket",
	"CDN_FOOD_IMAGES_BASE_URL":            "storage.food_images_cdn_base_url",
	"CDN_USER_AVATARS_BASE_URL":           "storage.user_avatars_cdn_base_url",
	"CDN_HEALTH_REPORTS_BASE_URL":         "storage.health_reports_cdn_base_url",
	"CDN_ICON_BASE_URL":                   "storage.icon_cdn_base_url",
	"POSTGRESQL_HOST":                     "database.host",
	"POSTGRESQL_PORT":                     "database.port",
	"POSTGRESQL_USER":                     "database.user",
	"POSTGRESQL_PASSWORD":                 "database.password",
	"POSTGRESQL_DATABASE":                 "database.name",
	"POSTGRESQL_SSLMODE":                  "database.sslmode",
	"POSTGRESQL_SCHEMA":                   "database.schema",
	"WORKER_COUNT":                        "worker.count",
	"WORKER_POLL_INTERVAL_SECONDS":        "worker.poll_interval_seconds",
	"TASK_QUEUE_DRIVER":                   "task_queue.driver",
	"TASK_QUEUE_BUFFER_SIZE":              "task_queue.buffer_size",
	"TASK_QUEUE_TOPIC":                    "task_queue.topic",
	"TASK_QUEUE_BROKERS":                  "task_queue.brokers",
	"TASK_QUEUE_CONSUMER_GROUP":           "task_queue.consumer_group",
	"OTEL_ENABLED":                        "otel.enabled",
	"OTEL_TRACES_ENABLED":                 "otel.traces_enabled",
	"OTEL_METRICS_ENABLED":                "otel.metrics_enabled",
	"OTEL_COLLECTOR_ENDPOINT":             "otel.collector_endpoint",
	"OTEL_INSECURE":                       "otel.insecure",
	"OTEL_METRIC_EXPORT_INTERVAL_SECONDS": "otel.metric_export_interval_seconds",
}

func applyConfigFileOnlyValues(v *viper.Viper, cfg *Config) error {
	if !v.IsSet("worker.count") {
		return fmt.Errorf("worker.count must be set in app-config.yaml or Apollo")
	}
	if cfg.Worker.Count < 0 {
		return fmt.Errorf("worker.count must be greater than or equal to 0")
	}
	workerCfg := defaultWorkerConfig()
	if v.IsSet("worker.id") {
		workerCfg.ID = cfg.Worker.ID
	}
	workerCfg.Count = cfg.Worker.Count
	if v.IsSet("worker.poll_interval_seconds") {
		workerCfg.PollIntervalSeconds = cfg.Worker.PollIntervalSeconds
	}
	cfg.Worker = workerCfg
	taskQueueCfg := defaultTaskQueueConfig()
	if v.IsSet("task_queue.driver") {
		taskQueueCfg.Driver = strings.TrimSpace(cfg.TaskQueue.Driver)
	}
	if v.IsSet("task_queue.buffer_size") {
		taskQueueCfg.BufferSize = cfg.TaskQueue.BufferSize
	}
	if v.IsSet("task_queue.topic") {
		taskQueueCfg.Topic = strings.TrimSpace(cfg.TaskQueue.Topic)
	}
	if v.IsSet("task_queue.brokers") {
		taskQueueCfg.Brokers = normalizeCSV(cfg.TaskQueue.Brokers)
	}
	if v.IsSet("task_queue.consumer_group") {
		taskQueueCfg.ConsumerGroup = strings.TrimSpace(cfg.TaskQueue.ConsumerGroup)
	}
	if taskQueueCfg.BufferSize <= 0 {
		return fmt.Errorf("task_queue.buffer_size must be greater than 0")
	}
	cfg.TaskQueue = taskQueueCfg
	return nil
}

func defaultWorkerConfig() WorkerConfig {
	return WorkerConfig{
		PollIntervalSeconds: 2.0,
	}
}

func defaultTaskQueueConfig() TaskQueueConfig {
	return TaskQueueConfig{
		Driver:        "memory",
		BufferSize:    1024,
		Topic:         "food-link-analysis-tasks",
		ConsumerGroup: "food-link-workers",
	}
}

func trimExternalConfig(cfg *ExternalConfig) {
	cfg.AppID = strings.TrimSpace(cfg.AppID)
	cfg.Secret = strings.TrimSpace(cfg.Secret)
	cfg.SupabaseURL = strings.TrimSpace(cfg.SupabaseURL)
	cfg.SupabaseKey = strings.TrimSpace(cfg.SupabaseKey)
	cfg.TiandituTK = strings.TrimSpace(cfg.TiandituTK)
	cfg.OfoxAIAPIKey = strings.TrimSpace(cfg.OfoxAIAPIKey)
	cfg.OfoxAIBaseURL = strings.TrimSpace(cfg.OfoxAIBaseURL)
	cfg.Gemini35APIKey = strings.TrimSpace(cfg.Gemini35APIKey)
	cfg.Gemini35BaseURL = strings.TrimSpace(cfg.Gemini35BaseURL)
	cfg.Gemini35Model = strings.TrimSpace(cfg.Gemini35Model)
	cfg.LLMProvider = strings.TrimSpace(cfg.LLMProvider)
	cfg.DeepSeekAPIKey = strings.TrimSpace(cfg.DeepSeekAPIKey)
	cfg.DoubaoAPIKey = strings.TrimSpace(cfg.DoubaoAPIKey)
	cfg.DoubaoWebSearchAPIKey = strings.TrimSpace(cfg.DoubaoWebSearchAPIKey)
	cfg.DoubaoBaseURL = strings.TrimSpace(cfg.DoubaoBaseURL)
}

func trimApolloConfig(cfg *ApolloConfig) {
	cfg.AppID = strings.TrimSpace(cfg.AppID)
	cfg.Cluster = strings.TrimSpace(cfg.Cluster)
	cfg.ConfigServerURL = strings.TrimRight(strings.TrimSpace(cfg.ConfigServerURL), "/")
	cfg.AccessKeySecret = strings.TrimSpace(cfg.AccessKeySecret)
	cfg.BackupConfigPath = strings.TrimSpace(cfg.BackupConfigPath)
	cfg.Label = strings.TrimSpace(cfg.Label)
	cfg.Namespaces = normalizeCSV(cfg.Namespaces)
	if len(cfg.Namespaces) == 0 {
		cfg.Namespaces = []string{"application"}
	}
}

func normalizeCSV(values []string) []string {
	out := []string{}
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}

func (c *Config) ListenAddr() string {
	return fmt.Sprintf("%s:%d", c.App.Host, c.App.Port)
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("app.name", "food_link-backend")
	v.SetDefault("app.env", "development")
	v.SetDefault("app.host", "0.0.0.0")
	v.SetDefault("app.port", 3010)
	v.SetDefault("log.level", "info")
	v.SetDefault("log.format", "json")
	v.SetDefault("log.output", "stdout")
	v.SetDefault("log.file_path", "logs/food-link-backend.log")
	v.SetDefault("database.driver", "postgres")
	v.SetDefault("database.port", 5432)
	v.SetDefault("database.sslmode", "disable")
	v.SetDefault("database.schema", "public")
	v.SetDefault("jwt.access_token_ttl_seconds", int64(36525*24*60*60))
	v.SetDefault("jwt.refresh_token_ttl_seconds", int64(36525*24*60*60))
	v.SetDefault("otel.enabled", false)
	v.SetDefault("otel.traces_enabled", true)
	v.SetDefault("otel.metrics_enabled", true)
	v.SetDefault("otel.insecure", true)
	v.SetDefault("otel.metric_export_interval_seconds", 15.0)
	v.SetDefault("worker.poll_interval_seconds", 2.0)
	v.SetDefault("task_queue.driver", "memory")
	v.SetDefault("task_queue.buffer_size", 1024)
	v.SetDefault("task_queue.topic", "food-link-analysis-tasks")
	v.SetDefault("task_queue.consumer_group", "food-link-workers")
	// Apollo bootstrap defaults keep apollo-config.yaml focused on values that
	// differ per deployment. Add fields to the YAML only when an environment
	// needs to override these.
	v.SetDefault("apollo.app_id", "food-link")
	v.SetDefault("apollo.cluster", "dev")
	v.SetDefault("apollo.namespaces", []string{"application"})
	v.SetDefault("apollo.enable_backup", true)
	v.SetDefault("apollo.backup_config_path", "logs/apollo-cache")
	v.SetDefault("apollo.must_start", true)
	v.SetDefault("apollo.sync_timeout_seconds", 5)
}

func bindLegacyEnv(v *viper.Viper) {
	_ = v.BindEnv("app.port", "PORT")
	_ = v.BindEnv("external.appid", "APPID")
	_ = v.BindEnv("external.secret", "SECRET")
	_ = v.BindEnv("jwt.secret", "JWT_SECRET_KEY")
	_ = v.BindEnv("external.supabase_url", "SUPABASE_URL")
	_ = v.BindEnv("external.supabase_service_role_key", "SUPABASE_SERVICE_ROLE_KEY")
	_ = v.BindEnv("external.tianditu_tk", "TIANDITU_TK")
	_ = v.BindEnv("external.ofoxai_api_key", "OFOXAI_API_KEY")
	_ = v.BindEnv("external.ofoxai_base_url", "OFOXAI_BASE_URL", "OFOX_BASE_URL")
	_ = v.BindEnv("external.gemini35_api_key", "GEMINI35_API_KEY")
	_ = v.BindEnv("external.gemini35_base_url", "GEMINI35_BASE_URL")
	_ = v.BindEnv("external.gemini35_model", "GEMINI35_MODEL")
	_ = v.BindEnv("external.llm_provider", "LLM_PROVIDER")
	_ = v.BindEnv("external.deepseek_api_key", "DEEPSEEK_API_KEY")
	_ = v.BindEnv("external.doubao_api_key", "DOUBAO_API_KEY")
	_ = v.BindEnv("external.doubao_web_search_api_key", "DOUBAO_WEB_SEARCH_API_KEY")
	_ = v.BindEnv("external.doubao_base_url", "DOUBAO_BASE_URL")
	_ = v.BindEnv("wechat_pay.mchid", "WECHAT_PAY_MCHID")
	_ = v.BindEnv("wechat_pay.notify_url", "WECHAT_PAY_NOTIFY_URL")
	_ = v.BindEnv("wechat_pay.serial_no", "WECHAT_PAY_SERIAL_NO")
	_ = v.BindEnv("wechat_pay.api_v3_key", "WECHAT_PAY_API_V3_KEY")
	_ = v.BindEnv("wechat_pay.private_key", "WECHAT_PAY_PRIVATE_KEY")
	_ = v.BindEnv("wechat_pay.public_key", "WECHAT_PAY_PUBLIC_KEY")
	_ = v.BindEnv("wechat_pay.expiry_subscribe_template_id", "EXPIRY_SUBSCRIBE_TEMPLATE_ID")
	_ = v.BindEnv("storage.cos_region", "COS_REGION")
	_ = v.BindEnv("storage.cos_secret_id", "COS_SECRET_ID")
	_ = v.BindEnv("storage.cos_secret_key", "COS_SECRET_KEY")
	_ = v.BindEnv("storage.food_images_bucket", "COS_FOOD_IMAGES_BUCKET")
	_ = v.BindEnv("storage.health_reports_bucket", "COS_HEALTH_REPORTS_BUCKET")
	_ = v.BindEnv("storage.user_avatars_bucket", "COS_USER_AVATARS_BUCKET")
	_ = v.BindEnv("storage.icon_bucket", "COS_ICON_BUCKET")
	_ = v.BindEnv("storage.food_images_cdn_base_url", "CDN_FOOD_IMAGES_BASE_URL")
	_ = v.BindEnv("storage.user_avatars_cdn_base_url", "CDN_USER_AVATARS_BASE_URL")
	_ = v.BindEnv("storage.health_reports_cdn_base_url", "CDN_HEALTH_REPORTS_BASE_URL")
	_ = v.BindEnv("storage.icon_cdn_base_url", "CDN_ICON_BASE_URL")
	_ = v.BindEnv("database.host", "POSTGRESQL_HOST")
	_ = v.BindEnv("database.port", "POSTGRESQL_PORT")
	_ = v.BindEnv("database.user", "POSTGRESQL_USER")
	_ = v.BindEnv("database.password", "POSTGRESQL_PASSWORD")
	_ = v.BindEnv("database.name", "POSTGRESQL_DATABASE")
}
