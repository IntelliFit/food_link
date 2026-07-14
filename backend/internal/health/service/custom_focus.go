package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	userservice "food_link/backend/internal/user/service"

	"github.com/google/uuid"
)

const (
	customFocusCreditCost = 1
	customFocusDailyLimit = 3
	customFocusMaxTokens  = 2048
)

type customFocusCardPayload struct {
	Score   int    `json:"score"`
	Brief   string `json:"brief"`
	Summary string `json:"summary"`
	Basis   string `json:"basis"`
	Action  string `json:"action"`
}

func parseCustomHealthFocusesFromProfile(user *domain.StatsUserProfile) []userservice.CustomHealthFocus {
	if user == nil || len(user.HealthCondition) == 0 {
		return nil
	}
	return userservice.ParseCustomHealthFocusesExport(user.HealthCondition["custom_health_focuses"])
}

func (s *StatsService) attachCustomRiskCards(ctx context.Context, comp *statsComputation, healthIndex *HealthIndex) error {
	if healthIndex == nil || comp == nil || comp.User == nil {
		return nil
	}
	focuses := parseCustomHealthFocusesFromProfile(comp.User)
	usedToday := 0
	if count, err := s.repo.CountCustomFocusGenerationsToday(ctx, comp.User.ID); err == nil && count > 0 {
		usedToday = int(count)
	}
	healthIndex.CustomFocusMeta = &CustomFocusMeta{
		MaxFocuses:     userservice.CustomHealthFocusMaxCountExport(),
		GenerateCost:   customFocusCreditCost,
		DailyLimit:     customFocusDailyLimit,
		UsedToday:      usedToday,
		RemainingToday: maxInt(0, customFocusDailyLimit-usedToday),
	}
	if len(focuses) == 0 {
		healthIndex.CustomRiskCards = []RiskCard{}
		return nil
	}

	cachedCards, err := s.repo.GetCustomFocusCards(ctx, comp.User.ID, comp.StatsRange)
	if err != nil {
		return err
	}
	cachedByFocus := map[string]domain.CustomFocusCard{}
	for _, card := range cachedCards {
		cachedByFocus[card.FocusID] = card
	}

	customCards := make([]RiskCard, 0, len(focuses))
	for _, focus := range focuses {
		key := customFocusKey(focus.ID)
		healthIndex.AllRiskOptions = append(healthIndex.AllRiskOptions, RiskOption{
			Key:      key,
			Title:    focus.Label,
			Short:    shortCustomFocusLabel(focus.Label),
			IsCustom: true,
		})
		cached, ok := cachedByFocus[focus.ID]
		if !ok {
			continue
		}
		needsRefresh := cached.DataFingerprint != comp.DataFingerprint
		customCards = append(customCards, domainCustomFocusToRiskCard(cached, needsRefresh))
	}
	healthIndex.CustomRiskCards = customCards
	return nil
}

func customFocusKey(focusID string) string {
	return "custom:" + strings.TrimSpace(focusID)
}

func shortCustomFocusLabel(label string) string {
	label = strings.TrimSpace(label)
	runes := []rune(label)
	if len(runes) <= 4 {
		return label
	}
	return string(runes[:4])
}

func domainCustomFocusToRiskCard(card domain.CustomFocusCard, needsRefresh bool) RiskCard {
	return RiskCard{
		Key:          customFocusKey(card.FocusID),
		Title:        card.FocusLabel,
		Score:        card.Score,
		Tone:         scoreToTone(card.Score),
		Brief:        card.Brief,
		Summary:      card.Summary,
		Basis:        card.Basis,
		Action:       card.Action,
		Delta:        clampScore(ifElseFloat(needsRefresh, 8, 5)),
		IsCustom:     true,
		NeedsRefresh: needsRefresh,
		FocusLabel:   card.FocusLabel,
	}
}

func (s *StatsService) GenerateCustomFocusCard(ctx context.Context, userID, statsRange, focusID string) (*RiskCard, map[string]any, error) {
	statsRange = normalizeStatsRange(statsRange)
	focusID = strings.TrimSpace(focusID)
	if focusID == "" {
		return nil, nil, &commonerrors.AppError{Code: 10002, Message: "focus_id 不能为空", HTTPStatus: 400}
	}

	comp, err := s.buildStatsComputation(ctx, userID, statsRange, 2000, 0)
	if err != nil {
		return nil, nil, err
	}
	if comp.User == nil {
		return nil, nil, commonerrors.ErrNotFound
	}
	if comp.RecordedDays < healthIndexMinRecordedDays {
		return nil, nil, &commonerrors.AppError{Code: 10002, Message: "连续记录两天以上后再生成自定义关注卡片", HTTPStatus: 400}
	}

	focuses := parseCustomHealthFocusesFromProfile(comp.User)
	var focusLabel string
	for _, focus := range focuses {
		if focus.ID == focusID {
			focusLabel = focus.Label
			break
		}
	}
	if focusLabel == "" {
		return nil, nil, &commonerrors.AppError{Code: 10002, Message: "未找到该自定义关注", HTTPStatus: 404}
	}

	countToday, err := s.repo.CountCustomFocusGenerationsToday(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	if countToday >= customFocusDailyLimit {
		return nil, nil, &commonerrors.AppError{Code: 10005, Message: "今日自定义关注生成次数已达上限，请明天再试", HTTPStatus: 429}
	}
	focusCountToday, err := s.repo.CountCustomFocusGenerationsTodayForFocus(ctx, userID, focusID)
	if err != nil {
		return nil, nil, err
	}
	if focusCountToday >= 1 {
		return nil, nil, &commonerrors.AppError{Code: 10005, Message: "该关注方向今日已刷新过，请明天再试", HTTPStatus: 429}
	}

	var creditsInfo map[string]any
	if s.creditGuard != nil {
		creditsInfo, err = s.creditGuard.ValidateStatsInsightCredits(ctx, userID)
		if err != nil {
			return nil, nil, err
		}
	}

	payload, err := s.generateCustomFocusCardPayload(ctx, comp, focusLabel)
	if err != nil {
		payload = fallbackCustomFocusCardPayload(comp, focusLabel)
	}

	today := time.Now().In(chinaTZ).Format("2006-01-02")
	generatedDate, _ := time.ParseInLocation("2006-01-02", today, chinaTZ)
	card := domain.CustomFocusCard{
		ID:              uuid.New().String(),
		UserID:          userID,
		FocusID:         focusID,
		RangeType:       comp.StatsRange,
		GeneratedDate:   generatedDate,
		DataFingerprint: comp.DataFingerprint,
		FocusLabel:      focusLabel,
		Score:           payload.Score,
		Brief:           payload.Brief,
		Summary:         payload.Summary,
		Basis:           payload.Basis,
		Action:          payload.Action,
	}
	if err := s.repo.UpsertCustomFocusCard(ctx, card); err != nil {
		return nil, nil, err
	}
	if s.creditGuard != nil && creditsInfo != nil {
		sourceKey := fmt.Sprintf("custom_focus:%s:%s:%s:%d", comp.StatsRange, focusID, today, focusCountToday+1)
		if err := s.creditGuard.ConsumeEarnedCreditsAfterSuccess(ctx, userID, creditsInfo, customFocusCreditCost, "custom_focus_reward_spend", sourceKey, map[string]any{
			"range":       comp.StatsRange,
			"focus_id":    focusID,
			"focus_label": focusLabel,
		}); err != nil {
			return nil, nil, err
		}
	}

	riskCard := domainCustomFocusToRiskCard(card, false)
	meta := map[string]any{
		"card":                         riskCard,
		"custom_focus_daily_limit":     customFocusDailyLimit,
		"custom_focus_used_today":      int(countToday) + 1,
		"custom_focus_remaining_today": maxInt(0, customFocusDailyLimit-int(countToday)-1),
	}
	return &riskCard, meta, nil
}

func (s *StatsService) generateCustomFocusCardPayload(ctx context.Context, comp *statsComputation, focusLabel string) (*customFocusCardPayload, error) {
	llm := s.preferredTextLLM()
	apiKey := llm.APIKey
	baseURL := llm.BaseURL
	if apiKey == "" {
		return fallbackCustomFocusCardPayload(comp, focusLabel), nil
	}

	body := map[string]any{
		"model": llm.Model,
		"messages": []map[string]string{
			{"role": "user", "content": buildCustomFocusCardPrompt(comp, focusLabel)},
		},
		"temperature": 0.4,
		"max_tokens":  customFocusMaxTokens,
		"stream":      false,
	}
	bodyBytes, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("文本模型 API 错误: %d %s", resp.StatusCode, extractDeepSeekError(respBody))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("文本模型返回了空响应")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	return parseCustomFocusCardPayload(content, comp, focusLabel)
}

func buildCustomFocusCardPrompt(comp *statsComputation, focusLabel string) string {
	healthIndex := computeHealthIndex(comp, comp.StatsRange)
	anchor := ""
	if healthIndex != nil {
		for _, card := range healthIndex.RiskCards {
			if card.Key == "hypertension" || card.Key == "diabetes" || card.Key == "cardio" || card.Key == "weight" {
				anchor += fmt.Sprintf("- %s：%d 分\n", card.Title, card.Score)
			}
		}
	}
	statsText := fmt.Sprintf(`统计周期：%s
日均摄入：%.0f kcal，TDEE：%d kcal
宏量占比：蛋白质 %.1f%%、碳水 %.1f%%、脂肪 %.1f%%
已记录 %d 天`,
		comp.StatsRange,
		comp.AvgCaloriesPerDay,
		comp.TDEE,
		comp.MacroPercent["protein"],
		comp.MacroPercent["carbs"],
		comp.MacroPercent["fat"],
		comp.RecordedDays,
	)
	return fmt.Sprintf(`你是一位专业的营养师。请根据用户饮食统计，为自定义关注方向「%s」生成一张健康参考卡片。

%s

四项核心规则分：
%s
%s

要求：
1. 只输出 JSON 对象，不要 Markdown，不要代码块。
2. 字段：score(0-100整数)、brief(<=20字)、summary(<=80字)、basis(<=80字)、action(<=60字)。
3. score 应参考四项核心规则分，结合该关注方向做趋势性判断，不要给出医学诊断。
4. 若证据不足，score 取 55-70，并在 basis 中说明证据不足。`,
		focusLabel,
		formatStatsHealthProfile(comp.User, latestWeightFromBodyMetrics(comp.BodyMetrics)),
		anchor,
		statsText,
	)
}

func parseCustomFocusCardPayload(content string, comp *statsComputation, focusLabel string) (*customFocusCardPayload, error) {
	content = strings.TrimSpace(content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start >= 0 && end > start {
		content = content[start : end+1]
	}
	var payload customFocusCardPayload
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return nil, err
	}
	payload.Score = clampScore(float64(payload.Score))
	payload.Brief = strings.TrimSpace(payload.Brief)
	payload.Summary = strings.TrimSpace(payload.Summary)
	payload.Basis = strings.TrimSpace(payload.Basis)
	payload.Action = strings.TrimSpace(payload.Action)
	if payload.Brief == "" || payload.Summary == "" || payload.Basis == "" || payload.Action == "" {
		return fallbackCustomFocusCardPayload(comp, focusLabel), nil
	}
	return &payload, nil
}

func fallbackCustomFocusCardPayload(comp *statsComputation, focusLabel string) *customFocusCardPayload {
	healthIndex := computeHealthIndex(comp, comp.StatsRange)
	score := 65
	if healthIndex != nil && healthIndex.OverallScore > 0 {
		score = healthIndex.OverallScore
	}
	return &customFocusCardPayload{
		Score:   score,
		Brief:   "趋势参考已生成",
		Summary: fmt.Sprintf("基于你近期的饮食记录，「%s」方向还需要更多连续记录来形成稳定判断。", focusLabel),
		Basis:   fmt.Sprintf("已记录 %d 天，日均摄入 %.0f kcal。", comp.RecordedDays, comp.AvgCaloriesPerDay),
		Action:  "先保持连续记录，再根据卡片建议做小步调整。",
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
