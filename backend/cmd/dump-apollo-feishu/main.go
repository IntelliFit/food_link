package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type ApolloConfig struct {
	ConfigServerURL string   `mapstructure:"config_server_url"`
	AppID           string   `mapstructure:"app_id"`
	Cluster         string   `mapstructure:"cluster"`
	Namespaces      []string `mapstructure:"namespaces"`
	AccessKeySecret string   `mapstructure:"access_key_secret"`
	Label           string   `mapstructure:"label"`
}

func main() {
	v := viper.New()
	v.SetConfigName("apollo-config")
	v.SetConfigType("yaml")
	v.AddConfigPath(".")
	if err := v.ReadInConfig(); err != nil {
		fmt.Fprintf(os.Stderr, "读取 apollo-config.yaml 失败: %v\n", err)
		os.Exit(1)
	}
	var apolloCfg ApolloConfig
	if err := v.Sub("apollo").Unmarshal(&apolloCfg); err != nil {
		fmt.Fprintf(os.Stderr, "解析 apollo 配置失败: %v\n", err)
		os.Exit(1)
	}

	if len(apolloCfg.Namespaces) == 0 {
		fmt.Println("namespaces 为空")
		os.Exit(1)
	}

	for _, ns := range apolloCfg.Namespaces {
		fmt.Printf("\n=== Apollo namespace: %s ===\n", ns)
		content, err := fetchRaw(apolloCfg, ns)
		if err != nil {
			fmt.Fprintf(os.Stderr, "拉取失败: %v\n", err)
			continue
		}

		printed := false
		for _, line := range strings.Split(content, "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.Contains(strings.ToLower(trimmed), "feishu") {
				fmt.Println(maskLine(trimmed))
				printed = true
			}
		}
		if !printed {
			fmt.Println("（未找到任何 feishu 相关配置）")
		}
	}
}

func fetchRaw(cfg ApolloConfig, namespace string) (string, error) {
	base, err := url.Parse(strings.TrimRight(cfg.ConfigServerURL, "/") + "/")
	if err != nil {
		return "", err
	}
	rel, err := url.Parse(fmt.Sprintf("configfiles/%s/%s/%s", cfg.AppID, cfg.Cluster, namespace))
	if err != nil {
		return "", err
	}
	resolved := base.ResolveReference(rel)
	if cfg.Label != "" {
		q := resolved.Query()
		q.Set("label", cfg.Label)
		resolved.RawQuery = q.Encode()
	}
	requestURL := resolved.String()

	req, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return "", err
	}
	if cfg.AccessKeySecret != "" {
		timestamp := fmt.Sprint(time.Now().UnixNano() / int64(time.Millisecond))
		pathWithQuery := resolved.Path
		if resolved.RawQuery != "" {
			pathWithQuery += "?" + resolved.RawQuery
		}
		mac := hmac.New(sha1.New, []byte(cfg.AccessKeySecret))
		_, _ = mac.Write([]byte(timestamp + "\n" + pathWithQuery))
		signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))
		req.Header.Set("Authorization", fmt.Sprintf("Apollo %s:%s", cfg.AppID, signature))
		req.Header.Set("Timestamp", timestamp)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	content := strings.TrimSpace(string(body))
	if strings.HasPrefix(content, "content=") {
		content = strings.TrimPrefix(content, "content=")
		content = unescape(content)
	}
	return strings.TrimSpace(content), nil
}

func unescape(s string) string {
	var out strings.Builder
	out.Grow(len(s))
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' || i == len(s)-1 {
			out.WriteByte(s[i])
			continue
		}
		i++
		switch s[i] {
		case 'n':
			out.WriteByte('\n')
		case 'r':
			out.WriteByte('\r')
		case 't':
			out.WriteByte('\t')
		default:
			out.WriteByte(s[i])
		}
	}
	return out.String()
}

func maskLine(line string) string {
	// Mask values that look like URLs or secrets after a colon.
	if idx := strings.Index(line, ":"); idx > 0 {
		key := strings.TrimSpace(line[:idx])
		value := strings.TrimSpace(line[idx+1:])
		lower := strings.ToLower(key)
		if strings.Contains(lower, "secret") || strings.Contains(lower, "key") || strings.Contains(lower, "password") || strings.Contains(lower, "token") {
			return fmt.Sprintf("%s: %s", key, mask(value))
		}
		if strings.HasPrefix(value, "http") {
			return fmt.Sprintf("%s: %s", key, maskURL(value))
		}
	}
	return line
}

func mask(s string) string {
	if len(s) <= 6 {
		return strings.Repeat("*", len(s))
	}
	return s[:2] + strings.Repeat("*", len(s)-4) + s[len(s)-2:]
}

func maskURL(s string) string {
	u, err := url.Parse(s)
	if err != nil {
		return mask(s)
	}
	// mask path-ish token part
	if u.Path != "" {
		parts := strings.Split(u.Path, "/")
		if len(parts) > 0 {
			last := parts[len(parts)-1]
			if len(last) > 8 {
				parts[len(parts)-1] = last[:4] + "****" + last[len(last)-4:]
			}
			u.Path = strings.Join(parts, "/")
		}
	}
	return u.String()
}
