package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzerepo "food_link/backend/internal/analyze/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	"food_link/backend/internal/taskqueue"
	userservice "food_link/backend/internal/user/service"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
)

const (
	customFocusCreditCost = 1
	customFocusDailyLimit = 3
	customFocusMaxTokens  = 2048
	customFocusTaskType   = "custom_focus"
)

type customFocusCardPayload struct {
	Score       int    `json:"score"`
	Brief       string `json:"brief"`
	Summary     string `json:"summary"`
	Basis       string `json:"basis"`
	Action      string `json:"action"`
	ScoreReason string `json:"score_reason"`
}

type CustomFocusGenerationTask struct {
	TaskID string `json:"task_id"`
	Status string `json:"status"`
}

type customFocusScoringContext struct {
	Category        string
	ScoreKind       string
	Score           int
	Confidence      string
	ScoreReason     string
	Evidence        []string
	MissingEvidence []string
	Rubric          string
}

type preparedCustomFocusGeneration struct {
	Computation     *statsComputation
	FocusLabel      string
	CountToday      int64
	FocusCountToday int64
	CreditsInfo     map[string]any
}

func (s *StatsService) ConfigureCustomFocusTasks(tasks *analyzerepo.TaskRepo, queue taskqueue.Publisher) {
	s.customFocusTasks = tasks
	s.customFocusQueue = queue
}

func (s *StatsService) StartCustomFocusCardGeneration(ctx context.Context, userID, statsRange, focusID string) (*CustomFocusGenerationTask, error) {
	if s.customFocusTasks == nil || s.customFocusQueue == nil {
		return nil, &commonerrors.AppError{Code: 10000, Message: "自定义关注后台任务暂不可用，请稍后重试", HTTPStatus: http.StatusServiceUnavailable}
	}
	prepared, err := s.prepareCustomFocusGeneration(ctx, userID, statsRange, focusID)
	if err != nil {
		return nil, err
	}
	task := &analyzedomain.AnalysisTask{
		UserID:   userID,
		TaskType: customFocusTaskType,
		Status:   "pending",
		Payload: map[string]any{
			"range":       prepared.Computation.StatsRange,
			"focus_id":    strings.TrimSpace(focusID),
			"focus_label": prepared.FocusLabel,
		},
	}
	if err := s.customFocusTasks.CreateTask(ctx, task); err != nil {
		return nil, err
	}
	publishCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := s.customFocusQueue.PublishTask(publishCtx, taskqueue.TaskMessage{TaskID: task.ID, TaskType: task.TaskType}); err != nil {
		_, _ = s.customFocusTasks.FailTask(context.Background(), task.ID, "custom focus task enqueue failed")
		return nil, fmt.Errorf("enqueue custom focus task: %w", err)
	}
	logger.Info(ctx, "自定义健康关注更新任务已提交",
		logger.UserID(userID),
		slog.String("task_id", task.ID),
		slog.String("focus_id", strings.TrimSpace(focusID)),
		slog.String("focus_label", prepared.FocusLabel),
		slog.String("range", prepared.Computation.StatsRange),
	)
	return &CustomFocusGenerationTask{TaskID: task.ID, Status: task.Status}, nil
}

func (s *StatsService) ProcessCustomFocusTask(ctx context.Context, userID, statsRange, focusID string) (map[string]any, error) {
	card, meta, err := s.GenerateCustomFocusCard(ctx, userID, statsRange, focusID)
	if err != nil {
		return nil, err
	}
	result := map[string]any{"card": card}
	for key, value := range meta {
		result[key] = value
	}
	return result, nil
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
	includeCustomFocusScoresInOverall(comp, healthIndex, customCards)
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
	previousScore := customFocusMetaIntPtr(card.Meta, "previous_score")
	scoreChange := customFocusMetaIntPtr(card.Meta, "score_change")
	return RiskCard{
		Key:             customFocusKey(card.FocusID),
		Title:           card.FocusLabel,
		Score:           card.Score,
		Tone:            scoreToTone(card.Score),
		Brief:           card.Brief,
		Summary:         card.Summary,
		Basis:           card.Basis,
		Action:          card.Action,
		Delta:           clampScore(ifElseFloat(needsRefresh, 8, 5)),
		IsCustom:        true,
		NeedsRefresh:    needsRefresh,
		FocusLabel:      card.FocusLabel,
		ScoreKind:       customFocusMetaString(card.Meta, "score_kind"),
		Confidence:      customFocusMetaString(card.Meta, "confidence"),
		ScoreReason:     customFocusMetaString(card.Meta, "score_reason"),
		PreviousScore:   previousScore,
		ScoreChange:     scoreChange,
		ChangeReason:    customFocusMetaString(card.Meta, "change_reason"),
		Evidence:        customFocusMetaStrings(card.Meta, "evidence"),
		MissingEvidence: customFocusMetaStrings(card.Meta, "missing_evidence"),
	}
}

func includeCustomFocusScoresInOverall(comp *statsComputation, healthIndex *HealthIndex, cards []RiskCard) {
	if comp == nil || healthIndex == nil || len(cards) == 0 || healthIndex.OverallScore <= 0 {
		return
	}
	coreCount := 4
	if len(comp.MicronutrientDaily) > 0 {
		coreCount = 5
	}
	projectedDelta := healthIndex.ProjectedScore - healthIndex.OverallScore
	total := healthIndex.OverallScore * coreCount
	for _, card := range cards {
		total += card.Score
	}
	healthIndex.OverallScore = clampScore(float64(total) / float64(coreCount+len(cards)))
	healthIndex.ProjectedScore = clampScore(float64(healthIndex.OverallScore + projectedDelta))
	healthIndex.OverallTrendLabel = scoreToLabel(healthIndex.OverallScore)
	healthIndex.OverviewCopy = scoreToTrendCopy(healthIndex.OverallScore)
}

func customFocusMetaString(meta map[string]any, key string) string {
	if len(meta) == 0 {
		return ""
	}
	value, ok := meta[key]
	if !ok || value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprintf("%v", value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func customFocusMetaIntPtr(meta map[string]any, key string) *int {
	if len(meta) == 0 {
		return nil
	}
	var value int
	switch typed := meta[key].(type) {
	case int:
		value = typed
	case int64:
		value = int(typed)
	case float64:
		value = int(math.Round(typed))
	case json.Number:
		parsed, err := typed.Int64()
		if err != nil {
			return nil
		}
		value = int(parsed)
	default:
		return nil
	}
	return &value
}

func customFocusMetaStrings(meta map[string]any, key string) []string {
	if len(meta) == 0 {
		return nil
	}
	var values []string
	switch typed := meta[key].(type) {
	case []string:
		values = typed
	case []any:
		for _, item := range typed {
			values = append(values, fmt.Sprintf("%v", item))
		}
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" && value != "<nil>" {
			out = append(out, value)
		}
	}
	return out
}

func (s *StatsService) GenerateCustomFocusCard(ctx context.Context, userID, statsRange, focusID string) (*RiskCard, map[string]any, error) {
	prepared, err := s.prepareCustomFocusGeneration(ctx, userID, statsRange, focusID)
	if err != nil {
		return nil, nil, err
	}
	comp := prepared.Computation
	focusLabel := prepared.FocusLabel
	countToday := prepared.CountToday
	focusCountToday := prepared.FocusCountToday
	creditsInfo := prepared.CreditsInfo

	previousCard, err := s.repo.GetCustomFocusCard(ctx, userID, comp.StatsRange, strings.TrimSpace(focusID))
	if err != nil {
		return nil, nil, err
	}
	scoring := buildCustomFocusScoringContext(comp, focusLabel)
	payload, err := s.generateCustomFocusCardPayload(ctx, comp, focusLabel, scoring, previousCard)
	if err != nil {
		payload = fallbackCustomFocusCardPayloadWithScoring(comp, focusLabel, scoring)
	}
	payload.Score = scoring.Score
	if payload.ScoreReason == "" {
		payload.ScoreReason = scoring.ScoreReason
	}

	previousScore, scoreChange, changeReason := customFocusChange(previousCard, comp.DataFingerprint, scoring)
	today := time.Now().In(chinaTZ).Format("2006-01-02")
	generatedDate, _ := time.ParseInLocation("2006-01-02", today, chinaTZ)
	card := domain.CustomFocusCard{
		ID:              uuid.New().String(),
		UserID:          userID,
		FocusID:         strings.TrimSpace(focusID),
		RangeType:       comp.StatsRange,
		GeneratedDate:   generatedDate,
		DataFingerprint: comp.DataFingerprint,
		FocusLabel:      focusLabel,
		Score:           payload.Score,
		Brief:           payload.Brief,
		Summary:         payload.Summary,
		Basis:           payload.Basis,
		Action:          payload.Action,
		Meta: map[string]any{
			"score_kind":       scoring.ScoreKind,
			"confidence":       scoring.Confidence,
			"score_reason":     payload.ScoreReason,
			"change_reason":    changeReason,
			"evidence":         scoring.Evidence,
			"missing_evidence": scoring.MissingEvidence,
		},
	}
	if previousScore != nil {
		card.Meta["previous_score"] = *previousScore
	}
	if scoreChange != nil {
		card.Meta["score_change"] = *scoreChange
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
	logger.Info(ctx, "自定义健康关注更新完成",
		logger.UserID(userID),
		slog.String("focus_id", strings.TrimSpace(focusID)),
		slog.String("focus_label", focusLabel),
		slog.String("range", comp.StatsRange),
		slog.Int("score", riskCard.Score),
		slog.String("confidence", riskCard.Confidence),
	)
	return &riskCard, meta, nil
}

func (s *StatsService) prepareCustomFocusGeneration(ctx context.Context, userID, statsRange, focusID string) (*preparedCustomFocusGeneration, error) {
	statsRange = normalizeStatsRange(statsRange)
	focusID = strings.TrimSpace(focusID)
	if focusID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "focus_id 不能为空", HTTPStatus: 400}
	}

	comp, err := s.buildStatsComputation(ctx, userID, statsRange, 2000, 0)
	if err != nil {
		return nil, err
	}
	if comp.User == nil {
		return nil, commonerrors.ErrNotFound
	}
	if comp.RecordedDays < healthIndexMinRecordedDays {
		return nil, &commonerrors.AppError{Code: 10002, Message: "连续记录两天以上后再生成自定义关注卡片", HTTPStatus: 400}
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
		return nil, &commonerrors.AppError{Code: 10002, Message: "未找到该自定义关注", HTTPStatus: 404}
	}

	countToday, err := s.repo.CountCustomFocusGenerationsToday(ctx, userID)
	if err != nil {
		return nil, err
	}
	if countToday >= customFocusDailyLimit {
		return nil, &commonerrors.AppError{Code: 10005, Message: "今日自定义关注生成次数已达上限，请明天再试", HTTPStatus: 429}
	}
	focusCountToday, err := s.repo.CountCustomFocusGenerationsTodayForFocus(ctx, userID, focusID)
	if err != nil {
		return nil, err
	}
	if focusCountToday >= 1 {
		return nil, &commonerrors.AppError{Code: 10005, Message: "该关注方向今日已刷新过，请明天再试", HTTPStatus: 429}
	}

	var creditsInfo map[string]any
	if s.creditGuard != nil {
		creditsInfo, err = s.creditGuard.ValidateStatsInsightCredits(ctx, userID)
		if err != nil {
			return nil, err
		}
	}
	return &preparedCustomFocusGeneration{
		Computation:     comp,
		FocusLabel:      focusLabel,
		CountToday:      countToday,
		FocusCountToday: focusCountToday,
		CreditsInfo:     creditsInfo,
	}, nil
}

func (s *StatsService) generateCustomFocusCardPayload(ctx context.Context, comp *statsComputation, focusLabel string, scoring customFocusScoringContext, previous *domain.CustomFocusCard) (*customFocusCardPayload, error) {
	llm := s.preferredTextLLM()
	apiKey := llm.APIKey
	baseURL := llm.BaseURL
	if apiKey == "" {
		return fallbackCustomFocusCardPayloadWithScoring(comp, focusLabel, scoring), nil
	}

	body := map[string]any{
		"model": llm.Model,
		"messages": []map[string]string{
			{"role": "user", "content": buildCustomFocusCardPrompt(comp, focusLabel, scoring, previous)},
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
	return parseCustomFocusCardPayloadWithScoring(content, comp, focusLabel, scoring)
}

func buildCustomFocusCardPrompt(comp *statsComputation, focusLabel string, scoring customFocusScoringContext, previous *domain.CustomFocusCard) string {
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
	previousBlock := "这是首次生成，没有上一次卡片。"
	if previous != nil {
		previousBlock = fmt.Sprintf("上一次：%d 分；依据：%s", previous.Score, strings.TrimSpace(previous.Basis))
	}
	return fmt.Sprintf(`你是一位专业的营养师。请根据结构化证据，为自定义关注方向「%s」生成一张健康参考卡片。

%s

四项核心规则分：
%s
%s

目标专项评分规则：
%s

本次结构化证据：
%s

缺失证据：
%s

上一次卡片：
%s

要求：
1. 只输出 JSON 对象，不要 Markdown，不要代码块。
2. 字段：score(0-100整数)、brief(<=20字)、summary(<=100字)、basis(<=120字)、action(<=80字)、score_reason(<=80字)。
3. score 必须填写系统结构化规则分 %d；不要自行改分。文案只解释证据、缺口和可行动建议。
4. 这是“饮食与记录支持度”，不是力量、皮肤状态或疾病风险的直接测量，不要给医学诊断。
5. 只解释本次证据，不推测未提供的数据变化。`,
		focusLabel,
		formatStatsHealthProfile(comp.User, latestWeightFromBodyMetrics(comp.BodyMetrics)),
		anchor,
		statsText,
		scoring.Rubric,
		strings.Join(scoring.Evidence, "\n"),
		strings.Join(scoring.MissingEvidence, "、"),
		previousBlock,
		scoring.Score,
	)
}

func parseCustomFocusCardPayload(content string, comp *statsComputation, focusLabel string) (*customFocusCardPayload, error) {
	return parseCustomFocusCardPayloadWithScoring(content, comp, focusLabel, buildCustomFocusScoringContext(comp, focusLabel))
}

func parseCustomFocusCardPayloadWithScoring(content string, comp *statsComputation, focusLabel string, scoring customFocusScoringContext) (*customFocusCardPayload, error) {
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
	payload.Score = scoring.Score
	payload.Brief = strings.TrimSpace(payload.Brief)
	payload.Summary = strings.TrimSpace(payload.Summary)
	payload.Basis = strings.TrimSpace(payload.Basis)
	payload.Action = strings.TrimSpace(payload.Action)
	payload.ScoreReason = strings.TrimSpace(payload.ScoreReason)
	if payload.Brief == "" || payload.Summary == "" || payload.Basis == "" || payload.Action == "" {
		return fallbackCustomFocusCardPayloadWithScoring(comp, focusLabel, scoring), nil
	}
	if payload.ScoreReason == "" {
		payload.ScoreReason = scoring.ScoreReason
	}
	return &payload, nil
}

func fallbackCustomFocusCardPayload(comp *statsComputation, focusLabel string) *customFocusCardPayload {
	return fallbackCustomFocusCardPayloadWithScoring(comp, focusLabel, buildCustomFocusScoringContext(comp, focusLabel))
}

func fallbackCustomFocusCardPayloadWithScoring(comp *statsComputation, focusLabel string, scoring customFocusScoringContext) *customFocusCardPayload {
	return &customFocusCardPayload{
		Score:       scoring.Score,
		Brief:       "结构化趋势参考已生成",
		Summary:     fmt.Sprintf("这是「%s」的饮食与记录支持度，不代表该目标的真实生理状态。", focusLabel),
		Basis:       strings.Join(scoring.Evidence, "；"),
		Action:      "先补齐缺失记录，再结合持续趋势做小步调整。",
		ScoreReason: scoring.ScoreReason,
	}
}

func buildCustomFocusScoringContext(comp *statsComputation, focusLabel string) customFocusScoringContext {
	context := customFocusScoringContext{
		Category:   "general",
		ScoreKind:  "diet_and_record_support",
		Score:      60,
		Confidence: "low",
		Rubric:     "以核心健康规则分、记录完整度和与目标相关的可用证据综合计算。",
	}
	if comp == nil {
		context.ScoreReason = "缺少可用统计数据，当前只能提供低置信度参考。"
		context.MissingEvidence = []string{"饮食统计", "健康档案", "目标专项记录"}
		return context
	}

	normalizedLabel := strings.ToLower(strings.TrimSpace(focusLabel))
	switch {
	case containsAnyText(normalizedLabel, "力量", "增肌", "肌肉", "抗阻", "健身", "爆发力"):
		return buildStrengthFocusScoring(comp)
	case containsAnyText(normalizedLabel, "皮肤", "肤色", "痘", "眼袋", "黑眼圈", "皱纹", "面部", "脸部"):
		return buildSkinFocusScoring(comp)
	default:
		healthIndex := computeHealthIndex(comp, comp.StatsRange)
		if healthIndex != nil && healthIndex.OverallScore > 0 {
			context.Score = healthIndex.OverallScore
		}
		context.Evidence = []string{
			fmt.Sprintf("已记录 %d 天，日均摄入 %.0f kcal", comp.RecordedDays, comp.AvgCaloriesPerDay),
			fmt.Sprintf("蛋白质 %.1f%%、碳水 %.1f%%、脂肪 %.1f%%", comp.MacroPercent["protein"], comp.MacroPercent["carbs"], comp.MacroPercent["fat"]),
		}
		context.MissingEvidence = []string{"该自定义目标的专项量表或直接测量"}
		if comp.RecordedDays >= 5 {
			context.Confidence = "medium"
		}
		context.ScoreReason = fmt.Sprintf("当前 %d 分来自核心饮食规则和记录完整度，缺少该目标的直接测量。", context.Score)
		return context
	}
}

func buildStrengthFocusScoring(comp *statsComputation) customFocusScoringContext {
	days := math.Max(1, float64(comp.RecordedDays))
	avgProtein := comp.TotalProtein / days
	weight := customFocusCurrentWeight(comp)
	proteinScore := 55.0
	evidence := []string{}
	missing := []string{}
	if weight > 0 {
		proteinPerKg := avgProtein / weight
		proteinScore = strengthProteinAdequacyScore(proteinPerKg)
		evidence = append(evidence, fmt.Sprintf("日均蛋白质 %.1fg（约 %.2fg/kg）", avgProtein, proteinPerKg))
	} else {
		proteinScore = clampHealthIndexFloat(35+avgProtein/90*55, 25, 90)
		evidence = append(evidence, fmt.Sprintf("日均蛋白质 %.1fg", avgProtein))
		missing = append(missing, "当前体重，无法计算蛋白质 g/kg")
	}

	energyRatio := 0.0
	if comp.TDEE > 0 {
		energyRatio = comp.AvgCaloriesPerDay / float64(comp.TDEE)
	}
	energyScore := strengthEnergyAdequacyScore(energyRatio)
	evidence = append(evidence, fmt.Sprintf("日均摄入 %.0f kcal / 日常消耗估算 %d kcal（%.0f%%）", comp.AvgCaloriesPerDay, comp.TDEE, energyRatio*100))

	trainingScore := 35.0
	strengthSessions := 0
	if summary := comp.ExerciseSummary; summary != nil && summary.SessionCount > 0 {
		for _, entry := range summary.RecentEntries {
			if containsAnyText(strings.ToLower(entry.Title), "力量", "抗阻", "举铁", "深蹲", "硬拉", "卧推", "俯卧撑", "引体", "哑铃", "杠铃") {
				strengthSessions++
			}
		}
		trainingScore = clampHealthIndexFloat(40+float64(summary.LoggedDays)*10+float64(strengthSessions)*8, 40, 95)
		evidence = append(evidence, fmt.Sprintf("本期运动 %d 次/%d 天，共 %d 分钟；近期抗阻线索 %d 次", summary.SessionCount, summary.LoggedDays, summary.TotalDurationMin, strengthSessions))
	} else {
		evidence = append(evidence, "本期没有运动训练记录")
		missing = append(missing, "抗阻训练频率、组数、负重和动作进展")
	}

	routineKnown := comp.User != nil && statsRoutineText(comp.User.HealthCondition["routine_type"]) != ""
	recoveryScore := 55.0
	if routineKnown {
		recoveryScore = 72
		evidence = append(evidence, "已填写作息习惯")
	} else {
		missing = append(missing, "作息习惯")
	}
	missing = append(missing, "实际睡眠时长与恢复质量", "围度或力量训练成绩")

	dataScore := 35.0
	if comp.RecordedDays >= 5 {
		dataScore += 20
	}
	if weight > 0 {
		dataScore += 15
	}
	if comp.ExerciseSummary != nil && comp.ExerciseSummary.SessionCount > 0 {
		dataScore += 20
	}
	if routineKnown {
		dataScore += 10
	}
	dataScore = math.Min(100, dataScore)

	score := clampScore(proteinScore*0.30 + energyScore*0.25 + trainingScore*0.25 + recoveryScore*0.10 + dataScore*0.10)
	confidence := "low"
	if comp.RecordedDays >= 5 && weight > 0 && comp.ExerciseSummary != nil && comp.ExerciseSummary.SessionCount > 0 {
		confidence = "medium"
	}
	if confidence == "medium" && strengthSessions >= 2 && routineKnown {
		confidence = "high"
	}
	return customFocusScoringContext{
		Category:        "strength",
		ScoreKind:       "diet_and_record_support",
		Score:           score,
		Confidence:      confidence,
		ScoreReason:     fmt.Sprintf("力量目标支持度由蛋白质30%%、能量25%%、训练25%%、恢复10%%、数据完整度10%%加权得到 %d 分。", score),
		Evidence:        evidence,
		MissingEvidence: dedupeCustomFocusStrings(missing),
		Rubric:          "力量目标固定权重：蛋白质充足度30%，能量可用性25%，抗阻训练证据25%，作息恢复10%，数据完整度10%。",
	}
}

func buildSkinFocusScoring(comp *statsComputation) customFocusScoringContext {
	days := math.Max(1, float64(comp.RecordedDays))
	avgProtein := comp.TotalProtein / days
	weight := customFocusCurrentWeight(comp)
	proteinScore := clampHealthIndexFloat(30+avgProtein/80*65, 25, 95)
	proteinEvidence := fmt.Sprintf("日均蛋白质 %.1fg", avgProtein)
	if weight > 0 {
		proteinPerKg := avgProtein / weight
		proteinScore = strengthProteinAdequacyScore(proteinPerKg)
		proteinEvidence = fmt.Sprintf("日均蛋白质 %.1fg（约 %.2fg/kg）", avgProtein, proteinPerKg)
	}
	energyRatio := 0.0
	if comp.TDEE > 0 {
		energyRatio = comp.AvgCaloriesPerDay / float64(comp.TDEE)
	}
	energyScore := strengthEnergyAdequacyScore(energyRatio)
	proteinEnergyScore := (proteinScore + energyScore) / 2

	micronutrientScore := 50.0
	missing := []string{"皮肤状态、持续时间和主观变化记录"}
	evidence := []string{
		proteinEvidence,
		fmt.Sprintf("日均摄入 %.0f kcal / 日常消耗估算 %d kcal（%.0f%%）", comp.AvgCaloriesPerDay, comp.TDEE, energyRatio*100),
	}
	if len(comp.MicronutrientDaily) > 0 {
		microScore, _, _, _, _ := computeMicronutrientScore(comp)
		micronutrientScore = float64(microScore)
		evidence = append(evidence, fmt.Sprintf("日均维生素A %.0fmcg RAE、维生素C %.1fmg、铁 %.1fmg", comp.MicronutrientDaily["vitaminARaeMcg"], comp.MicronutrientDaily["vitaminCMg"], comp.MicronutrientDaily["ironMg"]))
	} else {
		missing = append(missing, "维生素A/C、铁等微量营养记录")
	}

	hydrationScore := 50.0
	if body := comp.BodyMetrics; body != nil && body.WaterRecordedDays > 0 && body.WaterGoalMl > 0 {
		waterRatio := body.AvgDailyWaterMl / float64(body.WaterGoalMl)
		hydrationScore = clampHealthIndexFloat(waterRatio*100, 25, 100)
		evidence = append(evidence, fmt.Sprintf("饮水记录 %d 天，日均 %.0fml / 目标 %dml", body.WaterRecordedDays, body.AvgDailyWaterMl, body.WaterGoalMl))
	} else {
		missing = append(missing, "连续饮水记录")
	}

	sodiumScore := 70.0
	if sodium := comp.MicronutrientDaily["sodiumMg"]; sodium > 0 {
		sodiumScore = clampHealthIndexFloat(95-math.Max(0, sodium-2300)/23, 20, 95)
		evidence = append(evidence, fmt.Sprintf("日均钠约 %.0fmg", sodium))
	} else {
		missing = append(missing, "钠摄入记录")
	}

	directScore := 45.0
	hasDirectEvidence := customFocusHasDirectSkinEvidence(comp.User)
	if hasDirectEvidence {
		directScore = 75
		evidence = append(evidence, "健康档案中存在皮肤相关直接描述")
	} else {
		missing = append(missing, "皮肤照片或量表等直接证据")
	}

	score := clampScore(proteinEnergyScore*0.25 + micronutrientScore*0.30 + hydrationScore*0.20 + sodiumScore*0.10 + directScore*0.15)
	confidence := "low"
	if comp.RecordedDays >= 5 && len(comp.MicronutrientDaily) > 0 && comp.BodyMetrics != nil && comp.BodyMetrics.WaterRecordedDays >= 3 {
		confidence = "medium"
	}
	if confidence == "medium" && hasDirectEvidence {
		confidence = "high"
	}
	return customFocusScoringContext{
		Category:        "skin",
		ScoreKind:       "diet_and_record_support",
		Score:           score,
		Confidence:      confidence,
		ScoreReason:     fmt.Sprintf("皮肤目标支持度由能量与蛋白25%%、微量营养30%%、饮水20%%、钠10%%、直接证据15%%加权得到 %d 分。", score),
		Evidence:        evidence,
		MissingEvidence: dedupeCustomFocusStrings(missing),
		Rubric:          "皮肤目标固定权重：能量与蛋白25%，微量营养30%，饮水20%，钠摄入10%，皮肤直接证据15%。",
	}
}

func strengthProteinAdequacyScore(proteinPerKg float64) float64 {
	switch {
	case proteinPerKg <= 0:
		return 25
	case proteinPerKg <= 0.8:
		return 25 + proteinPerKg/0.8*35
	case proteinPerKg <= 1.2:
		return 60 + (proteinPerKg-0.8)/0.4*25
	case proteinPerKg <= 1.6:
		return 85 + (proteinPerKg-1.2)/0.4*15
	default:
		return 100
	}
}

func strengthEnergyAdequacyScore(ratio float64) float64 {
	switch {
	case ratio <= 0:
		return 30
	case ratio < 0.7:
		return clampHealthIndexFloat(20+ratio/0.7*15, 20, 35)
	case ratio < 0.9:
		return 35 + (ratio-0.7)/0.2*50
	case ratio <= 1.1:
		return 95
	default:
		return clampHealthIndexFloat(95-(ratio-1.1)*100, 45, 95)
	}
}

func customFocusCurrentWeight(comp *statsComputation) float64 {
	if comp == nil {
		return 0
	}
	if latest := latestWeightFromBodyMetrics(comp.BodyMetrics); latest != nil && latest.Value > 0 {
		return latest.Value
	}
	if comp.User != nil && comp.User.Weight != nil && *comp.User.Weight > 0 {
		return *comp.User.Weight
	}
	return 0
}

func customFocusHasDirectSkinEvidence(user *domain.StatsUserProfile) bool {
	if user == nil || len(user.HealthCondition) == 0 {
		return false
	}
	selected := map[string]any{}
	for _, key := range []string{"medical_history", "health_report_extract", "report_extract", "medical_notes", "symptoms"} {
		if value, ok := user.HealthCondition[key]; ok {
			selected[key] = value
		}
	}
	raw, _ := json.Marshal(selected)
	return containsAnyText(strings.ToLower(string(raw)), "皮肤", "肤色", "痘", "眼袋", "黑眼圈", "皱纹", "面部", "脸部")
}

func customFocusChange(previous *domain.CustomFocusCard, fingerprint string, scoring customFocusScoringContext) (*int, *int, string) {
	if previous == nil {
		return nil, nil, "首次生成，暂无历史对比。"
	}
	previousScore := previous.Score
	delta := scoring.Score - previous.Score
	if previous.DataFingerprint == fingerprint {
		return &previousScore, &delta, fmt.Sprintf("本次使用的数据快照与上次一致；按同一结构化规则复评，分数%s。", customFocusScoreChangeText(delta))
	}
	return &previousScore, &delta, fmt.Sprintf("数据快照已更新；%s；按同一结构化规则复评，分数%s。", scoring.ScoreReason, customFocusScoreChangeText(delta))
}

func customFocusScoreChangeText(delta int) string {
	switch {
	case delta > 0:
		return fmt.Sprintf("上升 %d 分", delta)
	case delta < 0:
		return fmt.Sprintf("下降 %d 分", -delta)
	default:
		return "保持不变"
	}
}

func containsAnyText(text string, candidates ...string) bool {
	for _, candidate := range candidates {
		if strings.Contains(text, strings.ToLower(candidate)) {
			return true
		}
	}
	return false
}

func dedupeCustomFocusStrings(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
