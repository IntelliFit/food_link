package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	App       AppConfig       `mapstructure:"app"`
	Database  DatabaseConfig  `mapstructure:"database"`
	JWT       JWTConfig       `mapstructure:"jwt"`
	OTel      OTelConfig      `mapstructure:"otel"`
	Storage   StorageConfig   `mapstructure:"storage"`
	External  ExternalConfig  `mapstructure:"external"`
	WechatPay WechatPayConfig `mapstructure:"wechat_pay"`
}

type AppConfig struct {
	Name string `mapstructure:"name"`
	Env  string `mapstructure:"env"`
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
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
	Enabled           bool   `mapstructure:"enabled"`
	CollectorEndpoint string `mapstructure:"collector_endpoint"`
	Insecure          bool   `mapstructure:"insecure"`
	HostName          string `mapstructure:"host_name"`
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
	DashscopeAPIKey string `mapstructure:"dashscope_api_key"`
	AppID           string `mapstructure:"appid"`
	Secret          string `mapstructure:"secret"`
	SupabaseURL     string `mapstructure:"supabase_url"`
	SupabaseKey     string `mapstructure:"supabase_service_role_key"`
	TiandituTK      string `mapstructure:"tianditu_tk"`
	OfoxAIAPIKey    string `mapstructure:"ofoxai_api_key"`
	LLMProvider     string `mapstructure:"llm_provider"`
}

type WechatPayConfig struct {
	MchID                       string `mapstructure:"mchid"`
	NotifyURL                   string `mapstructure:"notify_url"`
	SerialNo                    string `mapstructure:"serial_no"`
	APIV3Key                    string `mapstructure:"api_v3_key"`
	PrivateKey                  string `mapstructure:"private_key"`
	PublicKey                   string `mapstructure:"public_key"`
	ExpirySubscribeTemplateID   string `mapstructure:"expiry_subscribe_template_id"`
	AnalysisSubscribeTemplateID string `mapstructure:"analysis_subscribe_template_id"`
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
	return &cfg, nil
}

func (c *Config) ListenAddr() string {
	return fmt.Sprintf("%s:%d", c.App.Host, c.App.Port)
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("app.name", "food_link-backend")
	v.SetDefault("app.env", "development")
	v.SetDefault("app.host", "0.0.0.0")
	v.SetDefault("app.port", 3010)
	v.SetDefault("database.driver", "postgres")
	v.SetDefault("database.port", 5432)
	v.SetDefault("database.sslmode", "disable")
	v.SetDefault("database.schema", "public")
	v.SetDefault("jwt.access_token_ttl_seconds", int64(36525*24*60*60))
	v.SetDefault("jwt.refresh_token_ttl_seconds", int64(36525*24*60*60))
	v.SetDefault("otel.enabled", false)
	v.SetDefault("otel.insecure", true)
}

func bindLegacyEnv(v *viper.Viper) {
	_ = v.BindEnv("app.port", "PORT")
	_ = v.BindEnv("external.dashscope_api_key", "DASHSCOPE_API_KEY")
	_ = v.BindEnv("external.appid", "APPID")
	_ = v.BindEnv("external.secret", "SECRET")
	_ = v.BindEnv("jwt.secret", "JWT_SECRET_KEY")
	_ = v.BindEnv("external.supabase_url", "SUPABASE_URL")
	_ = v.BindEnv("external.supabase_service_role_key", "SUPABASE_SERVICE_ROLE_KEY")
	_ = v.BindEnv("external.tianditu_tk", "TIANDITU_TK")
	_ = v.BindEnv("external.ofoxai_api_key", "OFOXAI_API_KEY")
	_ = v.BindEnv("external.llm_provider", "LLM_PROVIDER")
	_ = v.BindEnv("wechat_pay.mchid", "WECHAT_PAY_MCHID")
	_ = v.BindEnv("wechat_pay.notify_url", "WECHAT_PAY_NOTIFY_URL")
	_ = v.BindEnv("wechat_pay.serial_no", "WECHAT_PAY_SERIAL_NO")
	_ = v.BindEnv("wechat_pay.api_v3_key", "WECHAT_PAY_API_V3_KEY")
	_ = v.BindEnv("wechat_pay.private_key", "WECHAT_PAY_PRIVATE_KEY")
	_ = v.BindEnv("wechat_pay.public_key", "WECHAT_PAY_PUBLIC_KEY")
	_ = v.BindEnv("wechat_pay.expiry_subscribe_template_id", "EXPIRY_SUBSCRIBE_TEMPLATE_ID")
	_ = v.BindEnv("wechat_pay.analysis_subscribe_template_id", "ANALYSIS_SUBSCRIBE_TEMPLATE_ID")
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
