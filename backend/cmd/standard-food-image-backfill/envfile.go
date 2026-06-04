package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var backendEnvLoaded sync.Once

func loadBackendEnv(configDir string) {
	backendEnvLoaded.Do(func() {
		dir := strings.TrimSpace(configDir)
		if dir == "" {
			dir = "."
		}
		for _, name := range []string{".env", ".env.local"} {
			applyEnvFile(filepath.Join(dir, name))
		}
	})
}

func applyEnvFile(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		val = strings.Trim(val, `"'`)
		if key == "" {
			continue
		}
		if os.Getenv(key) != "" {
			continue
		}
		os.Setenv(key, val)
	}
}

func isPlaceholderAPIKey(key string) bool {
	key = strings.TrimSpace(key)
	if key == "" {
		return true
	}
	placeholders := []string{
		"在此粘贴",
		"your_",
		"sk-...",
		"<",
	}
	lower := strings.ToLower(key)
	for _, p := range placeholders {
		if strings.Contains(lower, strings.ToLower(p)) {
			return true
		}
	}
	return false
}
