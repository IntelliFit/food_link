package service

import "strings"

func normalizeStringSlice(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func setStringPtr[M ~map[string]any](patch M, key string, value *string) {
	if value == nil {
		return
	}
	patch[key] = strings.TrimSpace(*value)
}

func stringPtrFromValue(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func setStringSlicePtr[M ~map[string]any](patch M, key string, value *[]string) {
	if value == nil {
		return
	}
	patch[key] = normalizeStringSlice(*value)
}

func setFloatPtr[M ~map[string]any](patch M, key string, value *float64) {
	if value == nil {
		return
	}
	patch[key] = *value
}

func setBoolPtr[M ~map[string]any](patch M, key string, value *bool) {
	if value == nil {
		return
	}
	patch[key] = *value
}
