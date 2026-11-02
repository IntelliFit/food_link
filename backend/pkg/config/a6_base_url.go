package config

import (
	"net/url"
	"strings"
)

const (
	// A6APIHost replaced api.a6api.com in A6's 2026-10-29 domain notice.
	A6APIHost        = "api.a6api.vip"
	DefaultA6BaseURL = "https://" + A6APIHost
	a6LegacyAPIHost  = "api.a6api.com"
)

// NormalizeA6BaseURL trims the URL and moves the retired host to the current
// one. The retired host is unreachable from production, so a stale config value
// must not keep the channel down.
func NormalizeA6BaseURL(raw string) string {
	base := strings.TrimRight(strings.TrimSpace(raw), "/")
	parsed, err := url.Parse(base)
	if err != nil || !strings.EqualFold(parsed.Hostname(), a6LegacyAPIHost) {
		return base
	}
	parsed.Host = A6APIHost
	return parsed.String()
}
