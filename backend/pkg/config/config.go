package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	App       AppConfig       `mapstructure:"app"`
	Log       LogConfig       `mapstructure:"log"`
	Database  DatabaseConfig  `mapstructure:"database"`
	JWT       JWTConfig       `mapstructure:"jwt"`
	OTel      OTelConfig      `mapstructure:"otel"`
	Storage   StorageConfig   `mapstructure:"storage"`
	External  ExternalConfig  `mapstructure:"external"`
	WechatPay WechatPayConfig `mapstructure:"wechat_pay"`
	Worker    WorkerConfig    `mapstructure:"worker"`
	TaskQueue TaskQueueConfig `mapstructure:"task_queue"`
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
	AppID          string `mapstructure:"appid"`
	Secret         string `mapstructure:"secret"`
	SupabaseURL    string `mapstructure:"supabase_url"`
	SupabaseKey    string `mapstructure:"supabase_service_role_key"`
	TiandituTK     string `mapstructure:"tianditu_tk"`
	OfoxAIAPIKey   string `mapstructure:"ofoxai_api_key"`
	OfoxAIBaseURL  string `mapstructure:"ofoxai_base_url"`
	LLMProvider    string `mapstructure:"llm_provider"`
	DeepSeekAPIKey string `mapstructure:"deepseek_api_key"`
	DoubaoAPIKey   string `mapstructure:"doubao_api_key"`
	DoubaoBaseURL  string `mapstructure:"doubao_base_url"`
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

func Load(baseDir string) (*Config, error) {
	v := viper.New()
	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(baseDir)
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	setDefaults(v)
	bindLegacyEnv(v)

	if err := v.ReadInConfig(); err != nil {
		var notFound viper.ConfigFileNotFoundError
		if !strings.Contains(err.Error(), "Not Found") && !strings.Contains(err.Error(), "not found") {
			return nil, err
		}
		_ = notFound
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}
	trimExternalConfig(&cfg.External)
	if err := applyConfigFileOnlyValues(v, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func applyConfigFileOnlyValues(v *viper.Viper, cfg *Config) error {
	if v.ConfigFileUsed() == "" {
		return fmt.Errorf("worker.count must be set in config.yaml")
	}
	fileV := viper.New()
	fileV.SetConfigFile(v.ConfigFileUsed())
	if err := fileV.ReadInConfig(); err != nil {
		return err
	}
	if !fileV.IsSet("worker.count") {
		return fmt.Errorf("worker.count must be set in config.yaml")
	}
	var fileCfg Config
	if err := fileV.Unmarshal(&fileCfg); err != nil {
		return err
	}
	trimExternalConfig(&fileCfg.External)
	if fileCfg.External.DoubaoAPIKey != "" {
		cfg.External.DoubaoAPIKey = fileCfg.External.DoubaoAPIKey
	}
	if fileCfg.External.DoubaoBaseURL != "" {
		cfg.External.DoubaoBaseURL = fileCfg.External.DoubaoBaseURL
	}
	if fileCfg.External.OfoxAIAPIKey != "" {
		cfg.External.OfoxAIAPIKey = fileCfg.External.OfoxAIAPIKey
	}
	if fileCfg.External.DeepSeekAPIKey != "" {
		cfg.External.DeepSeekAPIKey = fileCfg.External.DeepSeekAPIKey
	}
	if fileCfg.Worker.Count < 0 {
		return fmt.Errorf("worker.count must be greater than or equal to 0")
	}
	workerCfg := defaultWorkerConfig()
	if fileV.IsSet("worker.id") {
		workerCfg.ID = fileCfg.Worker.ID
	}
	workerCfg.Count = fileCfg.Worker.Count
	if fileV.IsSet("worker.poll_interval_seconds") {
		workerCfg.PollIntervalSeconds = fileCfg.Worker.PollIntervalSeconds
	}
	cfg.Worker = workerCfg
	taskQueueCfg := defaultTaskQueueConfig()
	if fileV.IsSet("task_queue.driver") {
		taskQueueCfg.Driver = strings.TrimSpace(fileCfg.TaskQueue.Driver)
	}
	if fileV.IsSet("task_queue.buffer_size") {
		taskQueueCfg.BufferSize = fileCfg.TaskQueue.BufferSize
	}
	if fileV.IsSet("task_queue.topic") {
		taskQueueCfg.Topic = strings.TrimSpace(fileCfg.TaskQueue.Topic)
	}
	if fileV.IsSet("task_queue.brokers") {
		taskQueueCfg.Brokers = normalizeCSV(fileCfg.TaskQueue.Brokers)
	}
	if fileV.IsSet("task_queue.consumer_group") {
		taskQueueCfg.ConsumerGroup = strings.TrimSpace(fileCfg.TaskQueue.ConsumerGroup)
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
	cfg.LLMProvider = strings.TrimSpace(cfg.LLMProvider)
	cfg.DeepSeekAPIKey = strings.TrimSpace(cfg.DeepSeekAPIKey)
	cfg.DoubaoAPIKey = strings.TrimSpace(cfg.DoubaoAPIKey)
	cfg.DoubaoBaseURL = strings.TrimSpace(cfg.DoubaoBaseURL)
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
	_ = v.BindEnv("external.llm_provider", "LLM_PROVIDER")
	_ = v.BindEnv("external.deepseek_api_key", "DEEPSEEK_API_KEY")
	_ = v.BindEnv("external.doubao_api_key", "DOUBAO_API_KEY")
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
