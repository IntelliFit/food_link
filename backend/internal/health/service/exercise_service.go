package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/config"
)

const creditCostExerciseLog = 1

type ExerciseRepo interface {
	CreateExerciseLog(ctx context.Context, log *domain.ExerciseLog) error
	ListExerciseLogsByDate(ctx context.Context, userID string, startDate, endDate string) ([]domain.ExerciseLog, error)
	GetExerciseLogByID(ctx context.Context, userID, logID string) (*domain.ExerciseLog, error)
	DeleteExerciseLog(ctx context.Context, userID, logID string) (int64, error)
	GetDailyCaloriesBurned(ctx context.Context, userID string, recordedOn string) (int64, error)
	GetUserProfile(ctx context.Context, userID string) (*domain.ExerciseUserProfile, error)
	GetLatestWeightRecord(ctx context.Context, userID string) (*domain.BodyWeightRecord, error)
	CreateAnalysisTask(ctx context.Context, task *domain.AnalysisTask) error
}

type ExerciseService struct {
	repo        ExerciseRepo
	creditGuard CreditGuard
	cfg         *config.Config
	client      *http.Client
}

func NewExerciseService(repo ExerciseRepo, cfg ...*config.Config) *ExerciseService {
	var c *config.Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	return &ExerciseService{repo: repo, cfg: c, client: &http.Client{Timeout: 45 * time.Second}}
}

type CreditGuard interface {
	ValidateExerciseCredits(ctx context.Context, userID, recordedOn string) (map[string]any, error)
	ConsumeEarnedCreditsAfterSuccess(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error
}

func (s *ExerciseService) ConfigureCreditGuard(guard CreditGuard) {
	s.creditGuard = guard
}

func (s *ExerciseService) GetDailyCalories(ctx context.Context, userID string, date string) (map[string]any, error) {
	if date == "" {
		date = time.Now().In(chinaTZ).Format("2006-01-02")
	}
	total, err := s.repo.GetDailyCaloriesBurned(ctx, userID, date)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"date":                  date,
		"total_calories_burned": int(total),
	}, nil
}

func (s *ExerciseService) ListLogs(ctx context.Context, userID string, date string) (map[string]any, error) {
	var startDate, endDate string
	if date != "" {
		startDate = date
		endDate = date
	} else {
		startDate = time.Now().In(chinaTZ).Format("2006-01-02")
		endDate = startDate
	}

	logs, err := s.repo.ListExerciseLogsByDate(ctx, userID, startDate, endDate)
	if err != nil {
		return nil, err
	}

	totalCalories := 0
	logItems := make([]map[string]any, 0, len(logs))
	for _, log := range logs {
		calories := 0.0
		if log.CaloriesBurned != nil {
			calories = *log.CaloriesBurned
		}
		totalCalories += int(calories)
		item := map[string]any{
			"id":              log.ID,
			"exercise_desc":   log.ExerciseDesc,
			"calories_burned": calories,
			"recorded_on":     nil,
			"created_at":      nil,
			"ai_reasoning":    nil,
		}
		if log.AIReasoning != nil {
			item["ai_reasoning"] = *log.AIReasoning
		}
		if log.RecordedOn != nil {
			item["recorded_on"] = log.RecordedOn.Format("2006-01-02")
		}
		if log.CreatedAt != nil {
			item["created_at"] = log.CreatedAt.Format(time.RFC3339)
		}
		logItems = append(logItems, item)
	}

	return map[string]any{
		"logs":           logItems,
		"total_calories": totalCalories,
		"count":          len(logs),
	}, nil
}

func (s *ExerciseService) CreateLog(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error) {
	desc := strings.TrimSpace(exerciseDesc)
	if desc == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述不能为空", HTTPStatus: 400}
	}
	if len(desc) > 200 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述过长", HTTPStatus: 400}
	}

	recordedOn := time.Now().In(chinaTZ).Format("2006-01-02")
	var creditsInfo map[string]any
	if s.creditGuard != nil && userID != "" {
		var err error
		creditsInfo, err = s.creditGuard.ValidateExerciseCredits(ctx, userID, recordedOn)
		if err != nil {
			return nil, err
		}
	}
	now := time.Now().UTC()
	profileSnapshot, err := s.BuildExerciseProfileSnapshot(ctx, userID)
	if err != nil {
		return nil, err
	}

	task := &domain.AnalysisTask{
		UserID:    userID,
		TaskType:  "exercise",
		Status:    "pending",
		TextInput: &desc,
		Payload: map[string]any{
			"recorded_on":       recordedOn,
			"profile_snapshot":  profileSnapshot,
			"estimation_source": "go_exercise_worker",
		},
		CreatedAt: &now,
	}
	if creditsInfo != nil {
		if spendPlan, ok := creditsInfo["credit_spend_plan"]; ok {
			task.Payload["credit_usage"] = spendPlan
		}
	}
	if err := s.repo.CreateAnalysisTask(ctx, task); err != nil {
		return nil, err
	}
	if s.creditGuard != nil && creditsInfo != nil {
		_ = s.creditGuard.ConsumeEarnedCreditsAfterSuccess(ctx, userID, creditsInfo, creditCostExerciseLog, "exercise_reward_spend", "exercise:"+task.ID, map[string]any{
			"task_id":   task.ID,
			"task_type": task.TaskType,
		})
	}

	return map[string]any{
		"task_id": task.ID,
		"message": "运动分析任务已提交，请轮询任务状态直至完成",
	}, nil
}

func (s *ExerciseService) EstimateCalories(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error) {
	desc := strings.TrimSpace(exerciseDesc)
	if desc == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述不能为空", HTTPStatus: 400}
	}

	profileSnapshot, err := s.BuildExerciseProfileSnapshot(ctx, userID)
	if err != nil {
		return nil, err
	}
	estimate := s.estimateExerciseCalories(ctx, desc, profileSnapshot)
	return map[string]any{
		"estimated_calories": estimate.CaloriesKcal,
		"exercise_desc":      desc,
		"ai_response":        estimate.Raw,
		"reasoning":          estimate.Reasoning,
		"profile_snapshot":   profileSnapshot,
	}, nil
}

func (s *ExerciseService) DeleteLog(ctx context.Context, userID, logID string) error {
	rowsAffected, err := s.repo.DeleteExerciseLog(ctx, userID, logID)
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return commonerrors.ErrNotFound
	}
	return nil
}

func (s *ExerciseService) BuildExerciseProfileSnapshot(ctx context.Context, userID string) (map[string]any, error) {
	snapshot := map[string]any{}
	user, err := s.repo.GetUserProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	latestWeight, err := s.repo.GetLatestWeightRecord(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user != nil {
		if user.Height != nil {
			snapshot["height_cm"] = round1(*user.Height)
		}
		if user.Gender != nil {
			gender := strings.ToLower(strings.TrimSpace(*user.Gender))
			if gender == "male" || gender == "female" {
				snapshot["gender"] = gender
			}
		}
		if user.Birthday != nil && strings.TrimSpace(*user.Birthday) != "" {
			birthday := strings.TrimSpace(*user.Birthday)
			snapshot["birthday"] = birthday
			if age := ageFromBirthday(birthday, time.Now().In(chinaTZ)); age > 0 {
				snapshot["age_years"] = age
			}
		}
		if user.ActivityLevel != nil && strings.TrimSpace(*user.ActivityLevel) != "" {
			snapshot["activity_level"] = strings.TrimSpace(*user.ActivityLevel)
		}
		if user.BMR != nil {
			snapshot["bmr"] = round1(*user.BMR)
		}
		if user.TDEE != nil {
			snapshot["tdee"] = round1(*user.TDEE)
		}
	}
	if latestWeight != nil {
		snapshot["weight_kg"] = round1(latestWeight.WeightKg)
		snapshot["weight_source"] = "latest_weight_record"
		if latestWeight.RecordedOn != nil {
			snapshot["weight_recorded_on"] = latestWeight.RecordedOn.In(chinaTZ).Format("2006-01-02")
		}
	} else if user != nil && user.Weight != nil {
		snapshot["weight_kg"] = round1(*user.Weight)
		snapshot["weight_source"] = "user_profile"
	}
	return snapshot, nil
}

func (s *ExerciseService) ProcessExerciseTask(ctx context.Context, userID, exerciseDesc, recordedOn string, payload map[string]any) (map[string]any, error) {
	desc := strings.TrimSpace(exerciseDesc)
	if desc == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述不能为空", HTTPStatus: 400}
	}
	if recordedOn == "" {
		recordedOn = time.Now().In(chinaTZ).Format("2006-01-02")
	}
	profileSnapshot := mapFromAny(payload["profile_snapshot"])
	if len(profileSnapshot) == 0 {
		var err error
		profileSnapshot, err = s.BuildExerciseProfileSnapshot(ctx, userID)
		if err != nil {
			return nil, err
		}
	}
	estimate := s.estimateExerciseCalories(ctx, desc, profileSnapshot)
	now := time.Now().UTC()
	recordedDate, err := parseChinaDate(recordedOn)
	if err != nil {
		recordedDate = time.Now().In(chinaTZ)
	}
	calories := float64(estimate.CaloriesKcal)
	reasoning := estimate.Reasoning
	log := &domain.ExerciseLog{
		UserID:         userID,
		ExerciseDesc:   desc,
		CaloriesBurned: &calories,
		RecordedOn:     &recordedDate,
		AIReasoning:    &reasoning,
		CreatedAt:      &now,
	}
	if err := s.repo.CreateExerciseLog(ctx, log); err != nil {
		return nil, err
	}
	total, err := s.repo.GetDailyCaloriesBurned(ctx, userID, recordedOn)
	if err != nil {
		return nil, err
	}
	exerciseLog := map[string]any{
		"id":              log.ID,
		"exercise_desc":   log.ExerciseDesc,
		"calories_burned": int(calories),
		"recorded_on":     recordedOn,
		"recorded_at":     now.Format(time.RFC3339),
		"ai_reasoning":    reasoning,
	}
	return map[string]any{
		"exercise_log":       exerciseLog,
		"estimated_calories": estimate.CaloriesKcal,
		"ai_response":        estimate.Raw,
		"reasoning":          reasoning,
		"profile_snapshot":   profileSnapshot,
		"today_total":        total,
	}, nil
}

type ExerciseEstimate struct {
	CaloriesKcal int
	Raw          string
	Reasoning    string
	Source       string
}

type exerciseMetRule struct {
	keywords []string
	met      float64
	label    string
}

var (
	exerciseSegmentSplitRe = regexp.MustCompile(`[\r\n;；。]+`)
	exerciseMinuteRe       = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(分钟|min)`)
	exerciseHourRe         = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(小时|h|hour)`)
	exerciseJSONFenceRe    = regexp.MustCompile("(?s)```json?\\s*\\n?|```")
	exerciseJSONObjRe      = regexp.MustCompile(`(?s)\{.*\}`)
	exerciseMetRules       = []exerciseMetRule{
		{[]string{"跳绳"}, 11.0, "跳绳"},
		{[]string{"跑步", "慢跑", "晨跑"}, 8.3, "跑步"},
		{[]string{"冲刺"}, 11.5, "冲刺跑"},
		{[]string{"骑车", "骑行", "单车", "cycle"}, 6.8, "骑行"},
		{[]string{"游泳", "swim"}, 8.0, "游泳"},
		{[]string{"俯卧撑", "引体", "臂屈伸"}, 8.0, "徒手力量训练"},
		{[]string{"深蹲", "硬拉", "卧推"}, 6.0, "力量训练"},
		{[]string{"瑜伽"}, 3.0, "瑜伽"},
		{[]string{"拉伸", "放松"}, 2.3, "拉伸"},
		{[]string{"步行", "走路", "快走"}, 3.8, "步行"},
	}
)

func (s *ExerciseService) estimateExerciseCalories(ctx context.Context, desc string, profileSnapshot map[string]any) ExerciseEstimate {
	segments := splitExerciseSegments(desc)
	if shouldEstimateBySegments(desc, segments) {
		total := 0
		rows := make([]map[string]any, 0, len(segments))
		for _, segment := range segments {
			estimate := s.estimateSingleExerciseCalories(ctx, segment, profileSnapshot)
			total += estimate.CaloriesKcal
			rows = append(rows, map[string]any{
				"segment":       segment,
				"calories_kcal": estimate.CaloriesKcal,
				"reasoning":     estimate.Reasoning,
				"source":        estimate.Source,
			})
		}
		reasoningParts := []string{}
		for _, row := range rows {
			reasoningParts = append(reasoningParts, fmt.Sprintf("%s≈%dkcal", trimRunes(fmt.Sprintf("%v", row["segment"]), 16), row["calories_kcal"]))
		}
		reasoning := "分项估算：" + strings.Join(reasoningParts, "；")
		if len([]rune(reasoning)) > 200 {
			reasoning = trimRunes(reasoning, 200) + "..."
		}
		rawBytes, _ := json.Marshal(map[string]any{"segments": rows, "calories_kcal": total, "reasoning": reasoning})
		return ExerciseEstimate{CaloriesKcal: total, Raw: string(rawBytes), Reasoning: reasoning, Source: "segmented"}
	}
	return s.estimateSingleExerciseCalories(ctx, desc, profileSnapshot)
}

func (s *ExerciseService) estimateSingleExerciseCalories(ctx context.Context, desc string, profileSnapshot map[string]any) ExerciseEstimate {
	if estimate, ok := s.estimateExerciseCaloriesWithLLM(ctx, desc, profileSnapshot); ok {
		return estimate
	}
	return ruleEstimateExerciseCalories(desc, profileSnapshot)
}

func (s *ExerciseService) estimateExerciseCaloriesWithLLM(ctx context.Context, desc string, profileSnapshot map[string]any) (ExerciseEstimate, bool) {
	apiKey := ""
	if s.cfg != nil {
		apiKey = strings.TrimSpace(s.cfg.External.OfoxAIAPIKey)
	}
	if apiKey == "" {
		return ExerciseEstimate{}, false
	}
	userPrompt := "用户运动描述：" + compactExerciseDesc(desc)
	if profileText := formatExerciseProfileSnapshot(profileSnapshot); profileText != "" {
		userPrompt += "\n\n" + profileText + "\n\n请结合这些真实信息估算；只有缺失字段才允许合理假设。"
	}
	body := map[string]any{
		"model": "google/gemini-3.1-flash-lite-preview",
		"messages": []map[string]string{
			{
				"role":    "system",
				"content": "你是运动热量估算助手。只输出 JSON 对象，不要 markdown。格式为 {\"reasoning\":\"一句简短中文\",\"calories_kcal\":123}。reasoning 不超过 80 个汉字。",
			},
			{"role": "user", "content": userPrompt},
		},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     0.25,
		"max_tokens":      320,
	}
	bodyBytes, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.ofox.ai/v1/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return ExerciseEstimate{}, false
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return ExerciseEstimate{}, false
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ExerciseEstimate{}, false
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil || len(parsed.Choices) == 0 {
		return ExerciseEstimate{}, false
	}
	raw := strings.TrimSpace(parsed.Choices[0].Message.Content)
	estimate, err := parseExerciseEstimateJSON(raw)
	if err != nil {
		return ExerciseEstimate{}, false
	}
	estimate.Raw = raw
	estimate.Source = "llm"
	return estimate, true
}

func parseExerciseEstimateJSON(raw string) (ExerciseEstimate, error) {
	cleaned := strings.TrimSpace(exerciseJSONFenceRe.ReplaceAllString(raw, ""))
	if match := exerciseJSONObjRe.FindString(cleaned); match != "" {
		cleaned = match
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(cleaned), &payload); err != nil {
		return ExerciseEstimate{}, err
	}
	calories := intFromAny(payload["calories_kcal"])
	if calories <= 0 {
		calories = intFromAny(payload["calories"])
	}
	if calories <= 0 {
		calories = intFromAny(payload["kcal"])
	}
	if calories <= 0 {
		return ExerciseEstimate{}, fmt.Errorf("missing calories_kcal")
	}
	reasoning := strings.TrimSpace(fmt.Sprintf("%v", payload["reasoning"]))
	if reasoning == "" || reasoning == "<nil>" {
		reasoning = "基于运动类型、时长和用户画像估算"
	}
	return ExerciseEstimate{CaloriesKcal: clampInt(calories, 1, 5000), Reasoning: reasoning}, nil
}

func ruleEstimateExerciseCalories(desc string, profileSnapshot map[string]any) ExerciseEstimate {
	minutes, hasDuration := extractDurationMinutes(desc)
	met, label := pickExerciseMET(desc)
	weight := 70.0
	if v, ok := floatFromAny(profileSnapshot["weight_kg"]); ok && v > 0 {
		weight = v
	}
	if hasDuration {
		calories := int(math.Round(met * 3.5 * weight / 200.0 * minutes))
		calories = clampInt(calories, 1, 5000)
		reasoning := fmt.Sprintf("规则估算：%s约%d分钟，按%.1fkg体重计算", label, int(math.Round(minutes)), weight)
		rawBytes, _ := json.Marshal(map[string]any{"reasoning": reasoning, "calories_kcal": calories, "source": "rule_met"})
		return ExerciseEstimate{CaloriesKcal: calories, Raw: string(rawBytes), Reasoning: reasoning, Source: "rule_met"}
	}
	length := len([]rune(desc))
	calories := 50.0 + float64(length)*1.5
	if isIntenseExercise(desc) {
		calories += 100
	}
	value := clampInt(int(math.Round(math.Min(calories, 800))), 1, 5000)
	reasoning := fmt.Sprintf("规则兜底：%s缺少明确时长，按描述强度粗估", label)
	rawBytes, _ := json.Marshal(map[string]any{"reasoning": reasoning, "calories_kcal": value, "source": "rule_fallback"})
	return ExerciseEstimate{CaloriesKcal: value, Raw: string(rawBytes), Reasoning: reasoning, Source: "rule_fallback"}
}

func splitExerciseSegments(desc string) []string {
	parts := exerciseSegmentSplitRe.Split(strings.TrimSpace(desc), -1)
	segments := []string{}
	for _, part := range parts {
		cleaned := strings.Trim(part, " \t,，.。;；")
		if len([]rune(cleaned)) >= 4 {
			segments = append(segments, cleaned)
		}
	}
	if len(segments) > 8 {
		return segments[:8]
	}
	return segments
}

func shouldEstimateBySegments(desc string, segments []string) bool {
	if len(segments) < 2 {
		return false
	}
	if strings.ContainsAny(desc, "\r\n;；。") {
		return true
	}
	if len([]rune(desc)) >= 80 {
		return true
	}
	return strings.Count(desc, "：")+strings.Count(desc, ":") >= 2
}

func compactExerciseDesc(desc string) string {
	segments := splitExerciseSegments(desc)
	if len(segments) == 0 {
		return strings.TrimSpace(desc)
	}
	out := make([]string, 0, len(segments))
	for _, segment := range segments {
		out = append(out, trimRunes(strings.ReplaceAll(segment, " ", ""), 60))
	}
	return strings.Join(out, "；")
}

func extractDurationMinutes(desc string) (float64, bool) {
	total := 0.0
	for _, match := range exerciseHourRe.FindAllStringSubmatch(desc, -1) {
		if len(match) > 1 {
			total += floatFromString(match[1]) * 60
		}
	}
	for _, match := range exerciseMinuteRe.FindAllStringSubmatch(desc, -1) {
		if len(match) > 1 {
			total += floatFromString(match[1])
		}
	}
	return total, total > 0
}

func pickExerciseMET(desc string) (float64, string) {
	lower := strings.ToLower(desc)
	for _, rule := range exerciseMetRules {
		for _, keyword := range rule.keywords {
			if strings.Contains(lower, strings.ToLower(keyword)) {
				return rule.met, rule.label
			}
		}
	}
	return 5.0, "一般运动"
}

func isIntenseExercise(desc string) bool {
	lower := strings.ToLower(desc)
	for _, keyword := range []string{"跑步", "游泳", "跳绳", "hiit", "高强度", "sprint", "run", "swim", "cycle"} {
		if strings.Contains(lower, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

func formatExerciseProfileSnapshot(snapshot map[string]any) string {
	if len(snapshot) == 0 {
		return ""
	}
	lines := []string{}
	if weight, ok := floatFromAny(snapshot["weight_kg"]); ok {
		lines = append(lines, fmt.Sprintf("- 体重：%.1f kg", weight))
	}
	if height, ok := floatFromAny(snapshot["height_cm"]); ok {
		lines = append(lines, fmt.Sprintf("- 身高：%.1f cm", height))
	}
	if gender := strings.TrimSpace(fmt.Sprintf("%v", snapshot["gender"])); gender == "male" || gender == "female" {
		label := "男"
		if gender == "female" {
			label = "女"
		}
		lines = append(lines, "- 性别："+label)
	}
	if age := intFromAny(snapshot["age_years"]); age > 0 {
		lines = append(lines, fmt.Sprintf("- 年龄：%d 岁", age))
	}
	if activity := strings.TrimSpace(fmt.Sprintf("%v", snapshot["activity_level"])); activity != "" && activity != "<nil>" {
		lines = append(lines, "- 日常活动水平："+activity)
	}
	if bmr, ok := floatFromAny(snapshot["bmr"]); ok {
		lines = append(lines, fmt.Sprintf("- BMR：%.1f kcal/天", bmr))
	}
	if tdee, ok := floatFromAny(snapshot["tdee"]); ok {
		lines = append(lines, fmt.Sprintf("- TDEE：%.1f kcal/天", tdee))
	}
	if len(lines) == 0 {
		return ""
	}
	return "已知用户真实档案：\n" + strings.Join(lines, "\n")
}

func mapFromAny(value any) map[string]any {
	switch v := value.(type) {
	case map[string]any:
		return v
	default:
		return map[string]any{}
	}
}

func floatFromAny(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case int32:
		return float64(v), true
	case json.Number:
		n, err := v.Float64()
		return n, err == nil
	default:
		return 0, false
	}
}

func intFromAny(value any) int {
	if f, ok := floatFromAny(value); ok {
		return int(f)
	}
	return 0
}

func floatFromString(value string) float64 {
	var parsed float64
	_, _ = fmt.Sscanf(value, "%f", &parsed)
	return parsed
}

func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func trimRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func ageFromBirthday(birthday string, now time.Time) int {
	date, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(birthday), chinaTZ)
	if err != nil {
		return 0
	}
	age := now.Year() - date.Year()
	if now.YearDay() < date.YearDay() {
		age--
	}
	return age
}
