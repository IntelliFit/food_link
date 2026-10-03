package service

import (
	"encoding/json"
	"math"
	"strings"

	"food_link/backend/internal/common/errors"
)

// ParseSingleItemCorrection validates the immutable meal snapshot before charging.
// The index addresses exactly one item; the other maps are kept as supplied.
func ParseSingleItemCorrection(previous map[string]any, corrections []map[string]any, index int) ([]map[string]any, string, float64, error) {
	invalid := &errors.AppError{Code: 10002, Message: "单项重算需要完整原餐和一个有效的食物名称、重量", HTTPStatus: 400}
	raw, err := json.Marshal(previous["items"])
	if err != nil {
		return nil, "", 0, invalid
	}
	var items []map[string]any
	if err := json.Unmarshal(raw, &items); err != nil || len(items) == 0 || len(items) > 100 || index < 0 || index >= len(items) || len(corrections) != 1 {
		return nil, "", 0, invalid
	}
	for _, item := range items {
		if item == nil {
			return nil, "", 0, invalid
		}
	}
	raw, err = json.Marshal(corrections[0])
	if err != nil {
		return nil, "", 0, invalid
	}
	var target struct {
		Name   string  `json:"name"`
		Weight float64 `json:"weight"`
	}
	if err := json.Unmarshal(raw, &target); err != nil {
		return nil, "", 0, invalid
	}
	name := strings.TrimSpace(target.Name)
	if name == "" || len([]rune(name)) > 200 || target.Weight <= 0 || target.Weight > 100000 || math.IsNaN(target.Weight) || math.IsInf(target.Weight, 0) {
		return nil, "", 0, invalid
	}
	return items, name, target.Weight, nil
}
