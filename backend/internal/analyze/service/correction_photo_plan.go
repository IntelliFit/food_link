package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"food_link/backend/pkg/logger"
)

const correctionPhotoPlanTimeout = 50 * time.Second

var ErrCorrectionPhotoPlanUnavailable = errors.New("暂时没能结合照片理解这条纠错，请稍后重试，或直接在纠错清单里修改")

const correctionPhotoPlanPreamble = `你能看到这餐的原照片。用户的纠错说明只看文字定不下来，请对照照片理解：
- 用户说漏了、少了食物但没说是什么时，从照片里找出清单里还没有的食物放入 add：name 写照片中看到的具体食物，weight_grams 按照片估可食部分重量。
- 用户说多识别了、某样不是却没说哪样时，对照照片把照片里不存在的清单项放入 remove。
- 指代不清（“这个”“那碗”）时按照片判断对应哪道菜。
- 你能看到照片，重量直接按照片估，不要填 reestimate_weight。
- 照片里也确实找不到对应内容时，才返回 needs_clarification=true。
以下是通用规则：
`

// correctionNeedsPhoto reports whether the text-only reading gave up: it asked
// for clarification or kept returning plans that do not fit the list.
func correctionNeedsPhoto(err error) bool {
	var parseErr *LLMJSONParseError
	return errors.Is(err, ErrCorrectionInstructionsUnclear) || errors.As(err, &parseErr)
}

func correctionImageURLs(input AnalyzeInput) []string {
	var urls []string
	for _, url := range input.ImageURLs {
		if url = strings.TrimSpace(url); url != "" {
			urls = append(urls, url)
		}
	}
	if len(urls) == 0 && strings.TrimSpace(input.ImageURL) != "" {
		urls = append(urls, strings.TrimSpace(input.ImageURL))
	}
	return urls
}

// runCorrectionPhotoPlan is the vision call; tests replace it.
var runCorrectionPhotoPlan = func(s *AnalyzeService, ctx context.Context, prompt string, imageURLs []string, model string) (map[string]any, error) {
	return s.RunPrecisionJSONWithImagesTemperatureNoFallback(ctx, "image", prompt, imageURLs, model, 0.1)
}

// resolveCorrectionInstructionsWithPhoto reads the note again together with
// the meal photo, so "漏了一样" or "这个" can be resolved from what is visible.
func (s *AnalyzeService) resolveCorrectionInstructionsWithPhoto(ctx context.Context, userID string, input AnalyzeInput, items []map[string]any, data string) ([]map[string]any, error) {
	model := s.SelectFoodImageModel("strict", "correction:"+userID)
	prompt := correctionPhotoPlanPreamble + correctionInstructionPrompt + data
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		callCtx, cancel := context.WithTimeout(ctx, correctionPhotoPlanTimeout)
		parsed, err := runCorrectionPhotoPlan(s, callCtx, prompt, correctionImageURLs(input), model)
		cancel()
		if err != nil {
			logger.Warn(ctx, "结合照片理解纠错说明失败", slog.String("user_id", userID), slog.String("model", model), logger.Err(err))
			return nil, ErrCorrectionPhotoPlanUnavailable
		}
		resolved, err := applyCorrectionInstructionPlan(parsed, items)
		if err == nil {
			logger.Info(ctx, "已结合照片理解纠错说明", slog.String("user_id", userID), slog.String("model", model), slog.Int("item_count", len(resolved)))
			return resolved, nil
		}
		lastErr = err
		var parseErr *LLMJSONParseError
		if !errors.As(err, &parseErr) {
			break
		}
	}
	return nil, lastErr
}
