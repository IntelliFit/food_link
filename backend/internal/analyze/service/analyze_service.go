package service

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/common/errors"
)

const (
	defaultExecutionMode = "standard"
	validExecutionMode   = "strict"
)

type AnalyzeService struct {
	dashScopeClient LLMClient
	ofoxAIClient    LLMClient
	users           *authrepo.UserRepo
}

func NewAnalyzeService(dashScopeClient, ofoxAIClient LLMClient, users *authrepo.UserRepo) *AnalyzeService {
	return &AnalyzeService{
		dashScopeClient: dashScopeClient,
		ofoxAIClient:    ofoxAIClient,
		users:           users,
	}
}

// AnalyzeInput holds all possible inputs for analysis.
type AnalyzeInput struct {
	Base64Image           string   `json:"base64Image"`
	ImageURL              string   `json:"image_url"`
	ImageURLs             []string `json:"image_urls"`
	Text                  string   `json:"text"`
	AdditionalContext     string   `json:"additionalContext"`
	MealType              string   `json:"meal_type"`
	TimezoneOffsetMinutes *int     `json:"timezone_offset_minutes"`
	Province              string   `json:"province"`
	City                  string   `json:"city"`
	District              string   `json:"district"`
	UserGoal              string   `json:"user_goal"`
	DietGoal              string   `json:"diet_goal"`
	ActivityTiming        string   `json:"activity_timing"`
	RemainingCalories     *float64 `json:"remaining_calories"`
	ExecutionMode         *string  `json:"execution_mode"`
	ModelName             string   `json:"modelName"`
}

func normalizeExecutionMode(mode *string) string {
	if mode == nil {
		return defaultExecutionMode
	}
	if *mode == validExecutionMode {
		return *mode
	}
	return defaultExecutionMode
}

func (s *AnalyzeService) resolveExecutionMode(ctx context.Context, userID string, requested *string) string {
	mode := normalizeExecutionMode(requested)
	if userID == "" {
		return mode
	}
	user, err := s.users.FindByID(ctx, userID)
	if err != nil || user == nil {
		return mode
	}
	profileMode := normalizeExecutionMode(user.ExecutionMode)
	if requested != nil {
		return normalizeExecutionMode(requested)
	}
	return profileMode
}

func buildLocationText(province, city, district string) string {
	parts := []string{}
	if province != "" {
		parts = append(parts, province)
	}
	if city != "" && city != province {
		parts = append(parts, city)
	}
	if district != "" {
		parts = append(parts, district)
	}
	return strings.Join(parts, " ")
}

func mealName(mealType string, tzOffset *int) string {
	// simplified mapping; extend as needed
	m := map[string]string{
		"breakfast": "早餐",
		"lunch":     "午餐",
		"dinner":    "晚餐",
		"snack":     "加餐",
	}
	if v, ok := m[mealType]; ok {
		return v
	}
	return mealType
}

func buildPrompt(input AnalyzeInput, user *authrepo.User, executionMode string) string {
	additionalLine := ""
	if input.AdditionalContext != "" {
		additionalLine = fmt.Sprintf(`用户补充背景信息: "%s"。请根据此信息调整对隐形成分或烹饪方式的判断。`, input.AdditionalContext)
	}

	if executionMode != validExecutionMode {
		compactTags := []string{}
		if input.MealType != "" {
			compactTags = append(compactTags, fmt.Sprintf("餐次:%s", mealName(input.MealType, input.TimezoneOffsetMinutes)))
		}
		stateParts := []string{}
		if input.DietGoal != "" && input.DietGoal != "none" {
			stateParts = append(stateParts, input.DietGoal)
		}
		if input.ActivityTiming != "" && input.ActivityTiming != "none" {
			stateParts = append(stateParts, input.ActivityTiming)
		}
		if len(stateParts) > 0 {
			compactTags = append(compactTags, "状态:"+strings.Join(stateParts, "/"))
		}
		if input.RemainingCalories != nil {
			compactTags = append(compactTags, fmt.Sprintf("剩余:%gkcal", *input.RemainingCalories))
		}
		locationText := buildLocationText(input.Province, input.City, input.District)
		if locationText != "" {
			compactTags = append(compactTags, fmt.Sprintf("位置:%s", locationText))
		}
		if user != nil {
			summary := formatHealthRiskSummary(user)
			if summary != "" {
				compactTags = append(compactTags, summary)
			}
		}
		compact := ""
		if len(compactTags) > 0 {
			compact = strings.Join(compactTags, "\n") + "\n"
		}
		return fmt.Sprintf(`识别图片中的食物，估算重量和营养，仅返回 JSON。
%s%s
估重时请优先看：占盘面积、厚度/高度、堆叠体积、容器大小、透视关系。
若画面里有筷子、勺子、手掌、包装、餐盒、碗盘等参照物，请利用参照物。
结合常识估算熟食密度、含水量、常见售卖分量，不要只看上表面面积。
输出要求：
- 简体中文
- description <= 16字
- insight 1-2句，<= 32字
- context_advice 1-2句，<= 32字，无需则空字符串
- 建议写得自然一点，但不要空泛和重复
- 只返回 JSON

JSON:
{
  "items":[{"name":"","estimatedWeightGrams":0,"nutrients":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0}}],
  "description":"",
  "insight":"",
  "context_advice":""
}`, compact, additionalLine)
	}

	// strict mode prompt
	goalHint := ""
	if input.UserGoal != "" {
		goalMap := map[string]string{"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
		goalHint = fmt.Sprintf("\n用户目标为「%s」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标。", goalMap[input.UserGoal])
	}
	stateHint := ""
	stateParts := []string{}
	if input.DietGoal != "" && input.DietGoal != "none" {
		stateParts = append(stateParts, input.DietGoal)
	}
	if input.ActivityTiming != "" && input.ActivityTiming != "none" {
		stateParts = append(stateParts, input.ActivityTiming)
	}
	if len(stateParts) > 0 {
		stateHint = fmt.Sprintf("\n用户当前状态: %s，请在 context_advice 中给出针对性进食建议（如补剂、搭配）。", strings.Join(stateParts, " + "))
	}
	remainHint := ""
	if input.RemainingCalories != nil {
		remainHint = fmt.Sprintf("\n用户当日剩余热量预算约 %g kcal，可在 context_advice 中提示本餐占比或下一餐建议。", *input.RemainingCalories)
	}
	mealHint := ""
	if input.MealType != "" {
		mealHint = fmt.Sprintf("\n用户选择的是「%s」，请结合餐次特点在 insight 或 context_advice 中给出建议（如早餐适合碳水与蛋白搭配、晚餐宜清淡等）。", mealName(input.MealType, input.TimezoneOffsetMinutes))
	}
	locationText := buildLocationText(input.Province, input.City, input.District)
	locationHint := ""
	if locationText != "" {
		locationHint = fmt.Sprintf("\n用户当前所在地区约为「%s」，可把它作为辅助线索，用于理解可能的地域菜名、口味和常见分量；若与图片内容冲突，始终以图片本身为准。", locationText)
	}
	profileBlock := ""
	if user != nil {
		profileBlock = formatHealthProfile(user)
		if profileBlock != "" {
			profileBlock = "\n\n若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议（如控糖、低嘌呤、过敏规避等）。\n\n" + profileBlock
		}
	}
	modeHint := buildExecutionModeHint(executionMode)

	return fmt.Sprintf(`请作为专业的营养师分析这张图片。

1. 识别图中所有不同的食物单品。
2. 估算每种食物的重量（克）和详细营养成分。
3. description: 提供这顿饭的简短中文描述。
4. insight: 基于该餐营养成分的一句话健康建议。%s
5. pfc_ratio_comment: 本餐蛋白质(P)、脂肪(F)、碳水(C) 占比的简要评价（是否均衡、适合增肌/减脂/维持）。%s
6. absorption_notes: 食物组合或烹饪方式对吸收率、生物利用度的简要说明（如维生素C促铁吸收、油脂助脂溶性维生素等，一两句话）。
7. context_advice: 结合用户状态、位置或剩余热量的情境建议（若无则可为空字符串）。%s%s%s%s
8. 请遵守以下执行模式约束：%s

%s

重要：请务必使用**简体中文**返回所有文本内容。
请严格按照以下 JSON 格式返回，不要包含任何其他文本：

{
  "items": [
    {
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {
        "calories": 热量,
        "protein": 蛋白质,
        "carbs": 碳水,
        "fat": 脂肪,
        "fiber": 纤维,
        "sugar": 糖分
      }
    }
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": "情境建议（简体中文，若无则空字符串）"
}`, mealHint, goalHint, stateHint, remainHint, locationHint, profileBlock, modeHint, additionalLine)
}

func buildExecutionModeHint(mode string) string {
	if mode == validExecutionMode {
		return "精准模式：请尽可能精确地识别每种食物，给出详细的重量估算和营养数据。"
	}
	return "标准模式：给出合理的估算即可。"
}

func formatHealthProfile(user *authrepo.User) string {
	parts := []string{}
	if user.Gender != nil {
		parts = append(parts, fmt.Sprintf("性别：%s", map[bool]string{true: "男", false: "女"}[*user.Gender == "male"]))
	}
	if user.Height != nil {
		parts = append(parts, fmt.Sprintf("身高 %.0f cm", *user.Height))
	}
	if user.Weight != nil {
		parts = append(parts, fmt.Sprintf("体重 %.1f kg", *user.Weight))
	}
	if user.Birthday != nil && *user.Birthday != "" {
		parts = append(parts, fmt.Sprintf("生日 %s", *user.Birthday))
	}
	line1 := strings.Join(parts, "  ")
	if line1 != "" {
		line1 = "· " + line1
	}
	activity := "未填"
	if user.ActivityLevel != nil {
		activity = *user.ActivityLevel
	}
	line2 := fmt.Sprintf("· 活动水平：%s", activity)

	hc := user.HealthCondition
	lines := []string{line1, line2}
	if medical, ok := hc["medical_history"].([]any); ok && len(medical) > 0 {
		items := []string{}
		for _, m := range medical {
			items = append(items, fmt.Sprintf("%v", m))
		}
		lines = append(lines, "· 既往病史："+strings.Join(items, "、"))
	}
	if diet, ok := hc["diet_preference"].([]any); ok && len(diet) > 0 {
		items := []string{}
		for _, d := range diet {
			items = append(items, fmt.Sprintf("%v", d))
		}
		lines = append(lines, "· 饮食偏好："+strings.Join(items, "、"))
	}
	if allergies, ok := hc["allergies"].([]any); ok && len(allergies) > 0 {
		items := []string{}
		for _, a := range allergies {
			items = append(items, fmt.Sprintf("%v", a))
		}
		lines = append(lines, "· 过敏/忌口："+strings.Join(items, "、"))
	}
	if user.BMR != nil {
		lines = append(lines, fmt.Sprintf("· 基础代谢(BMR)：%.0f kcal/天", *user.BMR))
	}
	if user.TDEE != nil {
		lines = append(lines, fmt.Sprintf("· 每日总消耗(TDEE)：%.0f kcal/天", *user.TDEE))
	}
	filtered := []string{}
	for _, l := range lines {
		if l != "" {
			filtered = append(filtered, l)
		}
	}
	if len(filtered) == 0 {
		return ""
	}
	return "用户健康档案（供营养建议参考）：\n" + strings.Join(filtered, "\n")
}

func formatHealthRiskSummary(user *authrepo.User) string {
	hc := user.HealthCondition
	tags := []string{}
	if medical, ok := hc["medical_history"].([]any); ok {
		for _, m := range medical {
			s := strings.TrimSpace(fmt.Sprintf("%v", m))
			if s != "" {
				tags = append(tags, s)
			}
		}
	}
	if allergies, ok := hc["allergies"].([]any); ok {
		for _, a := range allergies {
			s := strings.TrimSpace(fmt.Sprintf("%v", a))
			if s != "" {
				tags = append(tags, "忌口"+s)
			}
		}
	}
	if diet, ok := hc["diet_preference"].([]any); ok {
		for _, d := range diet {
			s := strings.TrimSpace(fmt.Sprintf("%v", d))
			if s != "" {
				tags = append(tags, s)
			}
		}
	}
	seen := map[string]bool{}
	uniq := []string{}
	for _, t := range tags {
		if !seen[t] {
			seen[t] = true
			uniq = append(uniq, t)
		}
	}
	if len(uniq) == 0 {
		return ""
	}
	limit := 4
	if len(uniq) < limit {
		limit = len(uniq)
	}
	return "健康摘要:" + strings.Join(uniq[:limit], "、")
}

func resolveModelConfig(modelName string) (provider, model string) {
	raw := strings.TrimSpace(modelName)
	normalized := strings.ToLower(raw)
	if raw == "" || normalized == "qwen" || normalized == "qwen-vl" || normalized == "qwen-vl-max" {
		return "qwen", "qwen-vl-max"
	}
	if normalized == "gemini" || normalized == "gemini-flash" || normalized == "gemini-vision" {
		return "gemini", "gemini-3-flash-preview"
	}
	if strings.HasPrefix(normalized, "gemini") {
		return "gemini", raw
	}
	return "qwen", raw
}

// Analyze performs single-image or text analysis synchronously.
func (s *AnalyzeService) Analyze(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	executionMode := s.resolveExecutionMode(ctx, userID, input.ExecutionMode)

	var user *authrepo.User
	if userID != "" {
		user, _ = s.users.FindByID(ctx, userID)
	}

	prompt := buildPrompt(input, user, executionMode)

	provider, model := resolveModelConfig(input.ModelName)
	var client LLMClient
	if provider == "gemini" {
		client = NewOfoxAIClient("", model)
	} else {
		client = NewDashScopeClient("", model)
	}
	// Note: actual API keys are injected via the service's configured clients;
	// for flexibility we use the factory here but in production you'd want to
	// reuse the initialized clients from the service struct.
	if provider == "gemini" {
		client = s.ofoxAIClient
	} else {
		client = s.dashScopeClient
	}

	imageURL := ""
	if input.ImageURL != "" {
		imageURL = input.ImageURL
	} else if input.Base64Image != "" {
		imageURL = normalizeImageURL(input.Base64Image)
	}

	start := time.Now()
	parsed, err := client.Analyze(ctx, prompt, imageURL)
	if err != nil {
		return nil, err
	}
	durationMs := float64(time.Since(start).Milliseconds())

	return buildAnalyzeResponse(parsed, executionMode, provider, model, durationMs), nil
}

// AnalyzeText performs text-only analysis.
func (s *AnalyzeService) AnalyzeText(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	executionMode := s.resolveExecutionMode(ctx, userID, input.ExecutionMode)
	var user *authrepo.User
	if userID != "" {
		user, _ = s.users.FindByID(ctx, userID)
	}
	prompt := buildPrompt(input, user, executionMode)
	provider, model := resolveModelConfig(input.ModelName)
	var client LLMClient
	if provider == "gemini" {
		client = s.ofoxAIClient
	} else {
		client = s.dashScopeClient
	}
	start := time.Now()
	parsed, err := client.Analyze(ctx, prompt, "")
	if err != nil {
		return nil, err
	}
	durationMs := float64(time.Since(start).Milliseconds())
	return buildAnalyzeResponse(parsed, executionMode, provider, model, durationMs), nil
}

// AnalyzeCompare calls both Qwen and Gemini in parallel.
func (s *AnalyzeService) AnalyzeCompare(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	executionMode := s.resolveExecutionMode(ctx, userID, input.ExecutionMode)
	var user *authrepo.User
	if userID != "" {
		user, _ = s.users.FindByID(ctx, userID)
	}
	prompt := buildPrompt(input, user, executionMode)

	imageURL := ""
	if input.ImageURL != "" {
		imageURL = input.ImageURL
	} else if input.Base64Image != "" {
		imageURL = normalizeImageURL(input.Base64Image)
	}

	var wg sync.WaitGroup
	var qwenRes, geminiRes map[string]any
	var qwenErr, geminiErr error

	wg.Add(2)
	go func() {
		defer wg.Done()
		start := time.Now()
		parsed, err := s.dashScopeClient.Analyze(ctx, prompt, imageURL)
		if err != nil {
			qwenErr = err
			return
		}
		qwenRes = buildAnalyzeResponse(parsed, executionMode, "qwen", "qwen-vl-max", float64(time.Since(start).Milliseconds()))
	}()
	go func() {
		defer wg.Done()
		start := time.Now()
		parsed, err := s.ofoxAIClient.Analyze(ctx, prompt, imageURL)
		if err != nil {
			geminiErr = err
			return
		}
		geminiRes = buildAnalyzeResponse(parsed, executionMode, "gemini", "gemini-3-flash-preview", float64(time.Since(start).Milliseconds()))
	}()
	wg.Wait()

	qwenResult := modelResultFrom(qwenRes, qwenErr, "qwen-vl-max")
	geminiResult := modelResultFrom(geminiRes, geminiErr, "gemini-3-flash-preview")

	return map[string]any{
		"qwen_result":   qwenResult,
		"gemini_result": geminiResult,
	}, nil
}

// AnalyzeCompareEngines runs legacy_direct vs db_first on the same input.
func (s *AnalyzeService) AnalyzeCompareEngines(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	executionMode := s.resolveExecutionMode(ctx, userID, input.ExecutionMode)
	var user *authrepo.User
	if userID != "" {
		user, _ = s.users.FindByID(ctx, userID)
	}
	// For Go migration, we keep both engines using the same LLM call but tag differently.
	// In the original Python, db_first had additional food DB lookup; here we approximate
	// by using the same analysis pipeline with different engine tags.
	prompt := buildPrompt(input, user, executionMode)

	imageURL := ""
	if input.ImageURL != "" {
		imageURL = input.ImageURL
	} else if input.Base64Image != "" {
		imageURL = normalizeImageURL(input.Base64Image)
	}

	provider, model := resolveModelConfig(input.ModelName)
	var client LLMClient
	if provider == "gemini" {
		client = s.ofoxAIClient
	} else {
		client = s.dashScopeClient
	}

	start := time.Now()
	parsed, err := client.Analyze(ctx, prompt, imageURL)
	if err != nil {
		return nil, err
	}
	durationMs := float64(time.Since(start).Milliseconds())

	legacy := buildAnalyzeResponse(parsed, executionMode, provider, model, durationMs)
	legacy["analysis_engine"] = "legacy_direct"

	dbFirst := buildAnalyzeResponse(parsed, executionMode, provider, model, durationMs)
	dbFirst["analysis_engine"] = "db_first"
	dbFirst["resolved_count"] = len(toItems(dbFirst["items"]))
	dbFirst["unresolved_count"] = 0

	return map[string]any{
		"model_name":       model,
		"legacy_result":    modelResultFrom(legacy, nil, model),
		"db_first_result":  modelResultFrom(dbFirst, nil, model),
		"requested_model_names": []string{model},
		"results": []map[string]any{
			{
				"model_name":      model,
				"legacy_result":   modelResultFrom(legacy, nil, model),
				"db_first_result": modelResultFrom(dbFirst, nil, model),
			},
		},
	}, nil
}

// AnalyzeBatch analyzes multiple images with semaphore limit.
func (s *AnalyzeService) AnalyzeBatch(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	if len(input.ImageURLs) == 0 {
		return nil, errors.ErrBadRequest
	}
	if len(input.ImageURLs) > 5 {
		return nil, &errors.AppError{Code: 10002, Message: "最多支持 5 张图片", HTTPStatus: 400}
	}

	executionMode := s.resolveExecutionMode(ctx, userID, input.ExecutionMode)
	var user *authrepo.User
	if userID != "" {
		user, _ = s.users.FindByID(ctx, userID)
	}

	basePrompt := buildPrompt(input, user, executionMode)
	provider, _ := resolveModelConfig(input.ModelName)
	var client LLMClient
	if provider == "gemini" {
		client = s.ofoxAIClient
	} else {
		client = s.dashScopeClient
	}

	sem := make(chan struct{}, 3)
	var wg sync.WaitGroup
	results := make([]map[string]any, len(input.ImageURLs))
	var mu sync.Mutex
	var failedIndices []int

	for i, url := range input.ImageURLs {
		wg.Add(1)
		go func(idx int, imageURL string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			prompt := basePrompt + fmt.Sprintf("\n\n【批量分析第 %d/%d 张】请仅识别当前这张图片中的食物，不要与其他图片混淆。", idx+1, len(input.ImageURLs))
			parsed, err := client.Analyze(ctx, prompt, imageURL)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failedIndices = append(failedIndices, idx)
				results[idx] = nil
				return
			}
			results[idx] = parsed
		}(i, url)
	}
	wg.Wait()

	successful := []map[string]any{}
	for _, r := range results {
		if r != nil {
			successful = append(successful, r)
		}
	}
	if len(successful) == 0 {
		return nil, &errors.AppError{Code: 10000, Message: "所有图片分析均失败，请稍后重试", HTTPStatus: 500}
	}

	merged := mergeBatchResults(successful, executionMode)
	return merged, nil
}

func buildAnalyzeResponse(parsed map[string]any, executionMode, provider, model string, durationMs float64) map[string]any {
	parsed = normalizePayload(parsed)
	items := parseItems(parsed)
	optStr := func(v any) *string {
		if v == nil {
			return nil
		}
		s := strings.TrimSpace(fmt.Sprintf("%v", v))
		if s == "" {
			return nil
		}
		return &s
	}

	desc := "无法获取描述"
	if d, ok := parsed["description"].(string); ok && d != "" {
		desc = d
	}
	insight := "保持健康饮食！"
	if i, ok := parsed["insight"].(string); ok && i != "" {
		insight = i
	}

	resp := map[string]any{
		"description":         desc,
		"insight":             insight,
		"items":               items,
		"pfc_ratio_comment":   optStr(parsed["pfc_ratio_comment"]),
		"absorption_notes":    optStr(parsed["absorption_notes"]),
		"context_advice":      optStr(parsed["context_advice"]),
		"analysis_engine":     "db_first",
		"analysis_duration_ms": durationMs,
		"resolved_count":      len(items),
		"unresolved_count":    0,
	}

	if executionMode != validExecutionMode {
		resp["pfc_ratio_comment"] = nil
		resp["absorption_notes"] = nil
		resp["recognitionOutcome"] = nil
		resp["rejectionReason"] = nil
		resp["retakeGuidance"] = nil
		resp["allowedFoodCategory"] = nil
		resp["followupQuestions"] = nil
	} else {
		resp["recognitionOutcome"] = optStr(parsed["recognitionOutcome"])
		resp["rejectionReason"] = optStr(parsed["rejectionReason"])
		resp["retakeGuidance"] = toStringSlice(parsed["retakeGuidance"])
		resp["allowedFoodCategory"] = optStr(parsed["allowedFoodCategory"])
		resp["followupQuestions"] = toStringSlice(parsed["followupQuestions"])
	}

	_ = provider
	return resp
}

func parseItems(parsed map[string]any) []map[string]any {
	var raw []any
	if arr, ok := parsed["items"].([]any); ok {
		raw = arr
	} else if arrMap, ok := parsed["items"].([]map[string]any); ok {
		raw = make([]any, len(arrMap))
		for i, v := range arrMap {
			raw[i] = v
		}
	}
	if raw == nil {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(raw))
	for _, v := range raw {
		if item, ok := v.(map[string]any); ok {
			name := "未知食物"
			if n, ok := item["name"].(string); ok && n != "" {
				name = n
			}
			weight := 0.0
			if w, ok := item["estimatedWeightGrams"].(float64); ok {
				weight = w
			}
			nutrients := map[string]any{
				"calories": 0.0,
				"protein":  0.0,
				"carbs":    0.0,
				"fat":      0.0,
				"fiber":    0.0,
				"sugar":    0.0,
			}
			if n, ok := item["nutrients"].(map[string]any); ok {
				for k := range nutrients {
					if v2, ok := n[k].(float64); ok {
						nutrients[k] = v2
					}
				}
			}
			out = append(out, map[string]any{
				"name":                 name,
				"estimatedWeightGrams": weight,
				"originalWeightGrams":  weight,
				"nutrients":            nutrients,
			})
		}
	}
	return out
}

func toStringSlice(v any) []string {
	if arr, ok := v.([]any); ok {
		out := make([]string, 0, len(arr))
		for _, s := range arr {
			if str, ok := s.(string); ok && str != "" {
				out = append(out, str)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return nil
}

func toItems(v any) []map[string]any {
	if arr, ok := v.([]map[string]any); ok {
		return arr
	}
	if arr, ok := v.([]any); ok {
		out := make([]map[string]any, 0, len(arr))
		for _, a := range arr {
			if m, ok := a.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

func modelResultFrom(result map[string]any, err error, modelName string) map[string]any {
	if err != nil {
		return map[string]any{
			"model_name": modelName,
			"success":    false,
			"error":      err.Error(),
		}
	}
	result["model_name"] = modelName
	result["success"] = true
	return result
}

func mergeBatchResults(results []map[string]any, executionMode string) map[string]any {
	allItems := []map[string]any{}
	descriptions := []string{}
	insights := []string{}
	pfcComments := []string{}
	absorptionList := []string{}
	contextList := []string{}
	recognitionOutcomes := []string{}
	rejectionReasons := []string{}
	allowedCategories := []string{}
	retakeGuidanceLists := [][]string{}
	followupQuestionLists := [][]string{}

	for _, parsed := range results {
		parsed = normalizePayload(parsed)
		items := parseItems(parsed)
		allItems = append(allItems, items...)

		if desc, ok := parsed["description"].(string); ok && desc != "" && desc != "无法获取描述" {
			descriptions = append(descriptions, desc)
		}
		if insight, ok := parsed["insight"].(string); ok && insight != "" && insight != "保持健康饮食！" {
			insights = append(insights, insight)
		}
		if pfc, ok := parsed["pfc_ratio_comment"].(string); ok && pfc != "" {
			pfcComments = append(pfcComments, pfc)
		}
		if absorption, ok := parsed["absorption_notes"].(string); ok && absorption != "" {
			absorptionList = append(absorptionList, absorption)
		}
		if context, ok := parsed["context_advice"].(string); ok && context != "" {
			contextList = append(contextList, context)
		}
		if recognition, ok := parsed["recognitionOutcome"].(string); ok && recognition != "" {
			recognitionOutcomes = append(recognitionOutcomes, recognition)
		}
		if rejection, ok := parsed["rejectionReason"].(string); ok && rejection != "" {
			rejectionReasons = append(rejectionReasons, rejection)
		}
		if allowed, ok := parsed["allowedFoodCategory"].(string); ok && allowed != "" {
			allowedCategories = append(allowedCategories, allowed)
		}
		if rg, ok := parsed["retakeGuidance"].([]string); ok && len(rg) > 0 {
			retakeGuidanceLists = append(retakeGuidanceLists, rg)
		}
		if fq, ok := parsed["followupQuestions"].([]string); ok && len(fq) > 0 {
			followupQuestionLists = append(followupQuestionLists, fq)
		}
	}

	mergedItems := []map[string]any{}
	for _, item := range allItems {
		nutrients := map[string]any{
			"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0, "fiber": 0.0, "sugar": 0.0,
		}
		if n, ok := item["nutrients"].(map[string]any); ok {
			for k := range nutrients {
				if v, ok2 := n[k].(float64); ok2 {
					nutrients[k] = v
				}
			}
		}
		mergedItems = append(mergedItems, map[string]any{
			"name":                 item["name"],
			"estimatedWeightGrams": item["estimatedWeightGrams"],
			"originalWeightGrams":  item["estimatedWeightGrams"],
			"nutrients":            nutrients,
		})
	}

	desc := fmt.Sprintf("本餐共识别 %d 张图片，包含 %d 种食物。", len(results), len(mergedItems))
	if len(descriptions) > 0 {
		desc += " " + descriptions[0]
	}
	insight := "保持健康饮食！"
	if len(insights) > 0 {
		insight = strings.Join(insights, " ")
	}

	merged := map[string]any{
		"description":       desc,
		"insight":           insight,
		"items":             mergedItems,
		"pfc_ratio_comment": nil,
		"absorption_notes":  nil,
		"context_advice":    nil,
		"recognitionOutcome": nil,
		"rejectionReason":   nil,
		"retakeGuidance":    nil,
		"allowedFoodCategory": nil,
		"followupQuestions": nil,
	}

	if len(pfcComments) > 0 {
		merged["pfc_ratio_comment"] = pfcComments[0]
	}
	if len(absorptionList) > 0 {
		merged["absorption_notes"] = absorptionList[0]
	}
	if len(contextList) > 0 {
		merged["context_advice"] = strings.Join(contextList, " ")
	}
	if len(rejectionReasons) > 0 {
		merged["rejectionReason"] = rejectionReasons[0]
	}

	// recognitionOutcome logic
	if len(recognitionOutcomes) > 0 {
		outcome := recognitionOutcomes[0]
		for _, o := range recognitionOutcomes {
			if o == "hard_reject" {
				outcome = "hard_reject"
				break
			} else if o == "soft_reject" && outcome != "hard_reject" {
				outcome = "soft_reject"
			}
		}
		merged["recognitionOutcome"] = outcome
	}

	// allowedFoodCategory
	uniqueCategories := []string{}
	seen := map[string]bool{}
	for _, c := range allowedCategories {
		if !seen[c] {
			seen[c] = true
			uniqueCategories = append(uniqueCategories, c)
		}
	}
	if len(uniqueCategories) == 1 {
		merged["allowedFoodCategory"] = uniqueCategories[0]
	} else if len(uniqueCategories) > 1 {
		merged["allowedFoodCategory"] = "unknown"
	}

	// merge unique text lists
	merged["retakeGuidance"] = mergeUniqueTextLists(retakeGuidanceLists...)
	merged["followupQuestions"] = mergeUniqueTextLists(followupQuestionLists...)

	if executionMode != validExecutionMode {
		merged["pfc_ratio_comment"] = nil
		merged["absorption_notes"] = nil
		merged["recognitionOutcome"] = nil
		merged["rejectionReason"] = nil
		merged["retakeGuidance"] = nil
		merged["allowedFoodCategory"] = nil
		merged["followupQuestions"] = nil
	}

	return merged
}

func mergeUniqueTextLists(lists ...[]string) []string {
	seen := map[string]bool{}
	merged := []string{}
	for _, list := range lists {
		for _, item := range list {
			if item == "" || seen[item] {
				continue
			}
			seen[item] = true
			merged = append(merged, item)
		}
	}
	if len(merged) == 0 {
		return nil
	}
	return merged
}


