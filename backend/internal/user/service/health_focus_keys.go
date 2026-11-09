package service

import (
	"context"
	"fmt"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
)

// The user's focus ("我在意的") is the steering wheel of the daily nutrition state: up to
// three of the analysis page's focus cards, or custom focuses as "custom:<id>". It is
// kept in health_condition.focus_keys so the engine, the pet and the meal Agent read the
// same choice on every device (it used to live only in the phone's local storage).

const HealthFocusKeyLimit = 3

// HealthFocusCustomPrefix marks a key that points at one of the user's custom focuses.
const HealthFocusCustomPrefix = "custom:"

var builtInHealthFocusKeys = map[string]bool{
	"hypertension": true, "diabetes": true, "cardio": true, "weight": true,
	"colorectal": true, "longevity": true, "micronutrient": true,
}

// ParseHealthFocusKeys reads health_condition.focus_keys, keeping order and dropping
// blanks and duplicates. It does not check the keys still exist.
func ParseHealthFocusKeys(raw any) []string {
	values := []string{}
	switch typed := raw.(type) {
	case []string:
		values = typed
	case []any:
		for _, item := range typed {
			if text, ok := item.(string); ok {
				values = append(values, text)
			}
		}
	}
	out, seen := []string{}, map[string]bool{}
	for _, value := range values {
		key := strings.TrimSpace(value)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, key)
	}
	return out
}

func (s *UserService) GetHealthFocusKeys(ctx context.Context, userID string) ([]string, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	return ParseHealthFocusKeys(user.HealthCondition["focus_keys"]), nil
}

// UpdateHealthFocusKeys replaces the user's focus. Keys must be built-in focus cards or
// existing custom focuses; at most three; an empty list clears the choice.
func (s *UserService) UpdateHealthFocusKeys(ctx context.Context, userID string, keys []string) ([]string, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	normalized := ParseHealthFocusKeys(keys)
	if len(normalized) > HealthFocusKeyLimit {
		return nil, &commonerrors.AppError{Code: 10002, Message: fmt.Sprintf("最多选 %d 项关注", HealthFocusKeyLimit), HTTPStatus: 400}
	}
	custom := map[string]bool{}
	for _, focus := range ParseCustomHealthFocusesExport(user.HealthCondition["custom_health_focuses"]) {
		custom[focus.ID] = true
	}
	for _, key := range normalized {
		id, isCustom := strings.CutPrefix(key, HealthFocusCustomPrefix)
		if !builtInHealthFocusKeys[key] && !(isCustom && custom[id]) {
			return nil, &commonerrors.AppError{Code: 10002, Message: "不认识的关注：" + key, HTTPStatus: 400}
		}
	}
	healthCondition := user.HealthCondition
	if healthCondition == nil {
		healthCondition = map[string]any{}
	}
	healthCondition["focus_keys"] = normalized
	if _, err := s.users.UpdateFields(ctx, userID, map[string]any{"health_condition": healthCondition}); err != nil {
		return nil, err
	}
	return normalized, nil
}
