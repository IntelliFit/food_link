package service

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	commonerrors "food_link/backend/internal/common/errors"

	"github.com/google/uuid"
)

const customHealthFocusMaxCount = 3

var customHealthFocusBlockedTerms = []string{
	"自杀", "自残", "毒品", "赌博",
}

// CustomHealthFocus 用户自定义健康关注
type CustomHealthFocus struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	CreatedAt string `json:"created_at"`
}

func parseCustomHealthFocuses(raw any) []CustomHealthFocus {
	switch typed := raw.(type) {
	case []CustomHealthFocus:
		return typed
	case []map[string]any:
		out := make([]CustomHealthFocus, 0, len(typed))
		for _, item := range typed {
			id := strings.TrimSpace(fmt.Sprintf("%v", item["id"]))
			label := strings.TrimSpace(fmt.Sprintf("%v", item["label"]))
			createdAt := strings.TrimSpace(fmt.Sprintf("%v", item["created_at"]))
			if id == "" || label == "" || label == "<nil>" {
				continue
			}
			out = append(out, CustomHealthFocus{ID: id, Label: label, CreatedAt: createdAt})
		}
		return out
	case []any:
		out := make([]CustomHealthFocus, 0, len(typed))
		for _, item := range typed {
			out = append(out, parseCustomHealthFocuses(item)...)
		}
		return out
	case map[string]any:
		id := strings.TrimSpace(fmt.Sprintf("%v", typed["id"]))
		label := strings.TrimSpace(fmt.Sprintf("%v", typed["label"]))
		createdAt := strings.TrimSpace(fmt.Sprintf("%v", typed["created_at"]))
		if id == "" || label == "" || label == "<nil>" {
			return nil
		}
		return []CustomHealthFocus{{ID: id, Label: label, CreatedAt: createdAt}}
	default:
		return nil
	}
}

// ParseCustomHealthFocusesExport 供其他包读取 health_condition 中的自定义关注
func ParseCustomHealthFocusesExport(raw any) []CustomHealthFocus {
	focuses := parseCustomHealthFocuses(raw)
	if focuses == nil {
		return []CustomHealthFocus{}
	}
	return focuses
}

func normalizeCustomHealthFocusLabel(label string) (string, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		return "", &commonerrors.AppError{Code: 10002, Message: "关注方向不能为空", HTTPStatus: 400}
	}
	length := utf8.RuneCountInString(label)
	if length < 2 || length > 12 {
		return "", &commonerrors.AppError{Code: 10002, Message: "关注方向需为 2-12 个字", HTTPStatus: 400}
	}
	lower := strings.ToLower(label)
	for _, term := range customHealthFocusBlockedTerms {
		if strings.Contains(label, term) || strings.Contains(lower, term) {
			return "", &commonerrors.AppError{Code: 10002, Message: "关注方向包含不适当内容", HTTPStatus: 400}
		}
	}
	return label, nil
}

func (s *UserService) GetCustomHealthFocuses(ctx context.Context, userID string) ([]CustomHealthFocus, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	return ParseCustomHealthFocusesExport(user.HealthCondition["custom_health_focuses"]), nil
}

func (s *UserService) UpdateCustomHealthFocuses(ctx context.Context, userID string, focuses []CustomHealthFocus) ([]CustomHealthFocus, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	if len(focuses) > customHealthFocusMaxCount {
		return nil, &commonerrors.AppError{Code: 10002, Message: fmt.Sprintf("最多添加 %d 个自定义关注", customHealthFocusMaxCount), HTTPStatus: 400}
	}

	seen := map[string]bool{}
	normalized := make([]CustomHealthFocus, 0, len(focuses))
	for _, focus := range focuses {
		label, err := normalizeCustomHealthFocusLabel(focus.Label)
		if err != nil {
			return nil, err
		}
		id := strings.TrimSpace(focus.ID)
		if id == "" {
			id = uuid.New().String()
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		createdAt := strings.TrimSpace(focus.CreatedAt)
		if createdAt == "" {
			createdAt = time.Now().UTC().Format(time.RFC3339)
		}
		normalized = append(normalized, CustomHealthFocus{
			ID:        id,
			Label:     label,
			CreatedAt: createdAt,
		})
	}

	healthCondition := user.HealthCondition
	if healthCondition == nil {
		healthCondition = map[string]any{}
	}
	items := make([]map[string]any, 0, len(normalized))
	for _, focus := range normalized {
		items = append(items, map[string]any{
			"id":         focus.ID,
			"label":      focus.Label,
			"created_at": focus.CreatedAt,
		})
	}
	healthCondition["custom_health_focuses"] = items
	if _, err := s.users.UpdateFields(ctx, userID, map[string]any{"health_condition": healthCondition}); err != nil {
		return nil, err
	}
	return normalized, nil
}

// AddCustomHealthFocusResult 添加自定义关注结果
type AddCustomHealthFocusResult struct {
	Focuses       []CustomHealthFocus `json:"focuses"`
	FocusID       string              `json:"focus_id"`
	AlreadyExists bool                `json:"already_exists"`
}

func (s *UserService) AddCustomHealthFocus(ctx context.Context, userID, label string) (*AddCustomHealthFocusResult, error) {
	focuses, err := s.GetCustomHealthFocuses(ctx, userID)
	if err != nil {
		return nil, err
	}
	normalizedLabel, err := normalizeCustomHealthFocusLabel(label)
	if err != nil {
		return nil, err
	}
	for _, focus := range focuses {
		if focus.Label == normalizedLabel {
			return &AddCustomHealthFocusResult{
				Focuses:       focuses,
				FocusID:       focus.ID,
				AlreadyExists: true,
			}, nil
		}
	}
	if len(focuses) >= customHealthFocusMaxCount {
		return nil, &commonerrors.AppError{Code: 10002, Message: fmt.Sprintf("最多添加 %d 个自定义关注", customHealthFocusMaxCount), HTTPStatus: 400}
	}
	newFocus := CustomHealthFocus{
		ID:        uuid.New().String(),
		Label:     normalizedLabel,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	focuses = append(focuses, newFocus)
	updated, err := s.UpdateCustomHealthFocuses(ctx, userID, focuses)
	if err != nil {
		return nil, err
	}
	return &AddCustomHealthFocusResult{
		Focuses:       updated,
		FocusID:       newFocus.ID,
		AlreadyExists: false,
	}, nil
}

func (s *UserService) RemoveCustomHealthFocus(ctx context.Context, userID, focusID string) ([]CustomHealthFocus, error) {
	focuses, err := s.GetCustomHealthFocuses(ctx, userID)
	if err != nil {
		return nil, err
	}
	focusID = strings.TrimSpace(focusID)
	next := make([]CustomHealthFocus, 0, len(focuses))
	for _, focus := range focuses {
		if focus.ID != focusID {
			next = append(next, focus)
		}
	}
	return s.UpdateCustomHealthFocuses(ctx, userID, next)
}

// CustomHealthFocusMaxCountExport 导出最大自定义关注数量
func CustomHealthFocusMaxCountExport() int {
	return customHealthFocusMaxCount
}
