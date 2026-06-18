package service

import (
	"context"
	"log/slog"
	"math"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/logger"
)

const (
	gooseDuckChickenModel = "gpt-4.1:stable"
)

type GooseDuckChickenInput struct {
	ImageURL          string `json:"image_url"`
	AdditionalContext string `json:"additional_context"`
}

type GooseDuckChickenResult struct {
	Species    string   `json:"species"`
	Label      string   `json:"label"`
	Confidence float64  `json:"confidence"`
	Reason     string   `json:"reason"`
	Evidence   []string `json:"evidence,omitempty"`
}

func (s *AnalyzeService) ClassifyGooseDuckChicken(ctx context.Context, userID string, input GooseDuckChickenInput) (GooseDuckChickenResult, error) {
	imageURL := strings.TrimSpace(input.ImageURL)
	if imageURL == "" {
		return GooseDuckChickenResult{}, &commonerrors.AppError{Code: 10002, Message: "image_url 不能为空", HTTPStatus: 400}
	}

	prompt := buildGooseDuckChickenPrompt(input.AdditionalContext)
	parsed, err := s.RunPrecisionJSONWithImagesNoFallback(ctx, "image", prompt, []string{imageURL}, gooseDuckChickenModel)
	if err != nil {
		return GooseDuckChickenResult{}, err
	}
	result := normalizeGooseDuckChickenResult(parsed)
	logger.Info(ctx, "鹅鸭鸡专线识别完成",
		slog.String("user_id", userID),
		slog.String("species", result.Species),
		slog.Float64("confidence", result.Confidence),
	)
	return result, nil
}

func buildGooseDuckChickenPrompt(additionalContext string) string {
	extra := strings.TrimSpace(additionalContext)
	if extra != "" {
		extra = "\n用户补充线索：" + extra
	}
	return `你是一个只做鹅、鸭、鸡腿/禽肉分类的视觉识别器。
请只根据图片视觉证据判断主体最像以下四类之一：
- goose：鹅腿、烧鹅、烤鹅、鹅肉
- duck：鸭腿、烤鸭、烧鸭、鸭肉
- chicken：鸡腿、烤鸡、炸鸡腿、鸡肉
- unknown：无法判断、不是禽肉、主体不清晰、证据不足

不要输出普通食物分析、热量、营养素、重量或多食物列表。
如果画面里还有水瓶、背景文字、桌面杂物，请忽略它们，只判断主体禽肉。
必须返回 JSON，格式如下：
{
  "species": "goose|duck|chicken|unknown",
  "label": "鹅腿|鸭腿|鸡腿|不确定",
  "confidence": 0.0,
  "reason": "一句中文理由",
  "evidence": ["最多三条视觉证据"]
}` + extra
}

func normalizeGooseDuckChickenResult(parsed map[string]any) GooseDuckChickenResult {
	species := strings.ToLower(strings.TrimSpace(stringFromAny(parsed["species"])))
	switch species {
	case "goose", "duck", "chicken", "unknown":
	default:
		species = inferGooseDuckChickenSpecies(stringFromAny(parsed["label"]), stringFromAny(parsed["reason"]))
	}
	label := strings.TrimSpace(stringFromAny(parsed["label"]))
	if label == "" {
		label = labelForGooseDuckChickenSpecies(species)
	}
	confidence := numberFromAny(parsed["confidence"])
	if math.IsNaN(confidence) || math.IsInf(confidence, 0) {
		confidence = 0
	}
	if confidence > 1 {
		confidence = confidence / 100
	}
	if confidence < 0 {
		confidence = 0
	}
	if confidence > 1 {
		confidence = 1
	}
	reason := strings.TrimSpace(stringFromAny(parsed["reason"]))
	if reason == "" {
		reason = "已根据图片主体的外形、皮色和肉质线索做出判断。"
	}
	return GooseDuckChickenResult{
		Species:    species,
		Label:      label,
		Confidence: confidence,
		Reason:     reason,
		Evidence:   stringSliceFromAny(parsed["evidence"]),
	}
}

func inferGooseDuckChickenSpecies(parts ...string) string {
	text := strings.Join(parts, " ")
	switch {
	case strings.Contains(text, "鹅"):
		return "goose"
	case strings.Contains(text, "鸭"):
		return "duck"
	case strings.Contains(text, "鸡"):
		return "chicken"
	default:
		return "unknown"
	}
}

func labelForGooseDuckChickenSpecies(species string) string {
	switch species {
	case "goose":
		return "鹅腿"
	case "duck":
		return "鸭腿"
	case "chicken":
		return "鸡腿"
	default:
		return "不确定"
	}
}
