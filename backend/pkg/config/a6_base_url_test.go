package config

import "testing"

func TestNormalizeA6BaseURL(t *testing.T) {
	cases := map[string]string{
		"":                               "",
		" https://api.a6api.com/ ":       "https://api.a6api.vip",
		"https://api.a6api.com/v1/":      "https://api.a6api.vip/v1",
		"https://API.A6API.COM":          "https://api.a6api.vip",
		"https://api.a6api.vip/v1/":      "https://api.a6api.vip/v1",
		"https://proxy.example.com/a6/":  "https://proxy.example.com/a6",
		"https://api.a6api.com.evil.io/": "https://api.a6api.com.evil.io",
	}
	for raw, want := range cases {
		if got := NormalizeA6BaseURL(raw); got != want {
			t.Errorf("NormalizeA6BaseURL(%q) = %q, want %q", raw, got, want)
		}
	}
}
