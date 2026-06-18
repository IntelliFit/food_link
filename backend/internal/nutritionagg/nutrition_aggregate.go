package nutritionagg

import (
	"encoding/json"
	"strconv"
)

type Metric struct {
	Key     string
	Aliases []string
}

func SumMetrics(items []map[string]any, metrics []Metric) map[string]float64 {
	totals := make(map[string]float64, len(metrics))
	for _, metric := range metrics {
		if metric.Key == "" {
			continue
		}
		totals[metric.Key] = 0
	}
	for _, item := range items {
		factor := intakeFactor(item)
		for _, metric := range metrics {
			if metric.Key == "" {
				continue
			}
			if value, ok := metricValue(item, metric.Aliases); ok && value > 0 {
				totals[metric.Key] += value * factor
			}
		}
	}
	return totals
}

func intakeFactor(item map[string]any) float64 {
	if ratio, ok := numberFromAny(item["ratio"]); ok && ratio >= 0 {
		if ratio > 100 {
			ratio = 100
		}
		return ratio / 100
	}
	intake, intakeOK := numberFromAny(item["intake"])
	weight, weightOK := numberFromAny(item["weight"])
	if intakeOK && weightOK && weight > 0 {
		if intake < 0 {
			return 0
		}
		if intake > weight {
			intake = weight
		}
		return intake / weight
	}
	return 1
}

func metricValue(item map[string]any, aliases []string) (float64, bool) {
	for _, alias := range aliases {
		if value, ok := numberFromAny(item[alias]); ok {
			return value, true
		}
	}
	nutrients, _ := item["nutrients"].(map[string]any)
	for _, alias := range aliases {
		if value, ok := numberFromAny(nutrients[alias]); ok {
			return value, true
		}
	}
	return 0, false
}

func numberFromAny(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int8:
		return float64(typed), true
	case int16:
		return float64(typed), true
	case int32:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case uint:
		return float64(typed), true
	case uint8:
		return float64(typed), true
	case uint16:
		return float64(typed), true
	case uint32:
		return float64(typed), true
	case uint64:
		return float64(typed), true
	case json.Number:
		n, err := typed.Float64()
		return n, err == nil
	case string:
		n, err := strconv.ParseFloat(typed, 64)
		return n, err == nil
	default:
		return 0, false
	}
}
