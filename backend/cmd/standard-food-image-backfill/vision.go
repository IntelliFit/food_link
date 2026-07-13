package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	dashScopeDefaultBaseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
	dashScopeModelHint      = "qwen3.5-flash"
)

type imageDecision struct {
	FoodMatch   bool    `json:"food_match"`
	NoWatermark bool    `json:"no_watermark"`
	Match       bool    `json:"match"`
	Confidence  float64 `json:"confidence"`
	Reason      string  `json:"reason"`
}

type visionClient struct {
	apiKey  string
	baseURL string
	model   string
	http    *http.Client
}

func dashScopeBaseURL(configDir string) string {
	loadBackendEnv(configDir)
	if u := strings.TrimSpace(os.Getenv("DASHSCOPE_BASE_URL")); u != "" {
		return strings.TrimRight(u, "/")
	}
	return dashScopeDefaultBaseURL
}

func loadDashScopeAPIKey(configDir, apiKeyPath string) string {
	loadBackendEnv(configDir)
	if temporary := strings.TrimSpace(os.Getenv("FOOD_IMAGE_VISION_API_KEY")); !isPlaceholderAPIKey(temporary) {
		return strings.TrimPrefix(temporary, "Bearer ")
	}
	if manual := strings.TrimSpace(os.Getenv("DASHSCOPE_API_KEY")); !isPlaceholderAPIKey(manual) {
		return strings.TrimPrefix(manual, "Bearer ")
	}
	path := strings.TrimSpace(apiKeyPath)
	if path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if key, ok := strings.CutPrefix(line, "DASHSCOPE_API_KEY="); ok {
			key = strings.TrimSpace(key)
			key = strings.Trim(key, `"'`)
			if !isPlaceholderAPIKey(key) {
				return key
			}
			continue
		}
		key := strings.Trim(line, `"'`)
		if !isPlaceholderAPIKey(key) {
			return key
		}
	}
	return ""
}

func newVisionClient(configDir, apiKeyPath, baseURL, model string) (*visionClient, error) {
	key := loadDashScopeAPIKey(configDir, apiKeyPath)
	if key == "" {
		return nil, errors.New("未配置 DASHSCOPE_API_KEY，请在 backend/.env 中填写")
	}
	if strings.TrimSpace(baseURL) == "" {
		baseURL = dashScopeBaseURL(configDir)
	} else {
		baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSHandshakeTimeout = 30 * time.Second
	return &visionClient{
		apiKey:  key,
		baseURL: baseURL,
		model:   strings.TrimSpace(model),
		http:    &http.Client{Timeout: 120 * time.Second, Transport: transport},
	}, nil
}

func (c *visionClient) listModels(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("dashscope list models status %d: %s", resp.StatusCode, string(body))
	}
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(parsed.Data))
	for _, item := range parsed.Data {
		id := strings.TrimSpace(item.ID)
		if id != "" {
			out = append(out, id)
		}
	}
	sort.Strings(out)
	return out, nil
}

func pickQwenFlashModel(models []string, requested string) (string, error) {
	requested = strings.TrimSpace(requested)
	if requested != "" {
		for _, id := range models {
			if id == requested {
				return id, nil
			}
		}
		return requested, nil
	}
	preferred := []string{
		"qwen3.5-flash",
		"qwen3.5-flash-2026-02-23",
	}
	for _, want := range preferred {
		for _, id := range models {
			if id == want {
				return id, nil
			}
		}
	}
	var flash []string
	for _, id := range models {
		lower := strings.ToLower(id)
		if strings.Contains(lower, "qwen3.5") && strings.Contains(lower, "flash") {
			flash = append(flash, id)
		}
	}
	if len(flash) > 0 {
		return flash[0], nil
	}
	for _, id := range models {
		lower := strings.ToLower(id)
		if strings.Contains(lower, "qwen3.5-flash") {
			return id, nil
		}
	}
	if len(models) > 0 {
		return "", fmt.Errorf("模型列表中未找到 qwen3.5-flash，共 %d 个模型；请用 --vision-model 指定", len(models))
	}
	return dashScopeModelHint, nil
}

func (c *visionClient) resolveModel(ctx context.Context, requested string) (string, error) {
	if strings.TrimSpace(requested) != "" && requested != dashScopeModelHint {
		return requested, nil
	}
	models, err := c.listModels(ctx)
	if err != nil {
		if strings.TrimSpace(requested) != "" {
			return requested, nil
		}
		fmt.Fprintf(os.Stderr, "警告: 无法拉取模型列表 (%v)，回退使用 %s\n", err, dashScopeModelHint)
		return dashScopeModelHint, nil
	}
	return pickQwenFlashModel(models, requested)
}

func (c *visionClient) classifyImage(ctx context.Context, foodName string, data []byte, contentType string) (*imageDecision, error) {
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	model := c.model
	if model == "" {
		resolved, err := c.resolveModel(ctx, "")
		if err != nil {
			return nil, err
		}
		model = resolved
		c.model = resolved
	}
	prompt := fmt.Sprintf(
		"请判断图片是否适合作为“%s”的标准展示图。该图来自 Bing 图片搜索「%s」。只返回 JSON，不要 Markdown。格式必须为 {\"food_match\":true/false,\"no_watermark\":true/false,\"confidence\":0到1,\"reason\":\"中文简短原因\"}。food_match：主体应是搜索词所指的食物或常见同类菜品实拍；若搜索凉拌海带丝，深绿/褐绿条状海带凉菜、碗装凉拌海带丝应判 true；仅当明显是无关食物（如皮蛋黄瓜、地图、包装无关商品）才 false。no_watermark：无平台/店铺/版权/大面积水印；少量配料文字可 true。",
		foodName, foodName,
	)
	return c.classifyImageWithPrompt(ctx, prompt, data, contentType)
}

func (c *visionClient) classifyExistingImage(ctx context.Context, foodName string, data []byte, contentType string) (*imageDecision, error) {
	prompt := fmt.Sprintf(
		"你正在审核食物数据库已有图片。请严格判断图片主体是否确实是“%s”，不要因为都是食物就判定匹配。名称中的做法、食材、熟制状态或商品品牌/口味明显不一致时，应判 food_match=false；仅有摆盘、切法或少量常见配料差异可以判 true。图片模糊、主体不可辨认、只有文字/包装且无法确认内容时降低 confidence。只返回 JSON，不要 Markdown。格式必须为 {\"food_match\":true/false,\"no_watermark\":true/false,\"confidence\":0到1,\"reason\":\"中文简短原因\"}。no_watermark 表示没有平台、店铺、版权或大面积水印。",
		foodName,
	)
	return c.classifyImageWithPrompt(ctx, prompt, data, contentType)
}

func (c *visionClient) classifyImageWithPrompt(ctx context.Context, prompt string, data []byte, contentType string) (*imageDecision, error) {
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	if c.isGeminiNative() {
		return c.classifyGeminiNative(ctx, prompt, data, contentType)
	}
	model := c.model
	if model == "" {
		resolved, err := c.resolveModel(ctx, "")
		if err != nil {
			return nil, err
		}
		model = resolved
		c.model = resolved
	}
	payload := map[string]any{
		"model":           model,
		"temperature":     0,
		"max_tokens":      512,
		"response_format": map[string]string{"type": "json_object"},
		"messages": []map[string]any{{
			"role": "user",
			"content": []map[string]any{
				{"type": "text", "text": prompt},
				{"type": "image_url", "image_url": map[string]any{"url": "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(data)}},
			},
		}},
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("dashscope status %d: %s", resp.StatusCode, string(respBody))
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
		return nil, errors.New("dashscope returned no choices")
	}
	return parseImageDecision(parsed.Choices[0].Message.Content)
}

func (c *visionClient) isGeminiNative() bool {
	return strings.Contains(strings.ToLower(c.baseURL), "maas-openapi.wanjiedata.com") &&
		strings.HasPrefix(strings.ToLower(strings.TrimSpace(c.model)), "gemini-")
}

func (c *visionClient) classifyGeminiNative(ctx context.Context, prompt string, data []byte, contentType string) (*imageDecision, error) {
	payload := map[string]any{
		"contents": []map[string]any{{
			"role": "user",
			"parts": []map[string]any{
				{"text": prompt},
				{"inlineData": map[string]string{
					"mimeType": contentType,
					"data":     base64.StdEncoding.EncodeToString(data),
				}},
			},
		}},
		"generationConfig": map[string]any{
			"temperature":      0,
			"maxOutputTokens":  512,
			"responseMimeType": "application/json",
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var resp *http.Response
	for attempt := 0; attempt < 2; attempt++ {
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, geminiVisionEndpoint(c.baseURL, c.model), bytes.NewReader(body))
		if reqErr != nil {
			return nil, reqErr
		}
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err = c.http.Do(req)
		if err == nil && !shouldRetryVisionStatus(resp.StatusCode) {
			break
		}
		if resp != nil {
			io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024))
			resp.Body.Close()
			resp = nil
		}
		if attempt == 0 && (err != nil || shouldRetryVisionStatusCodeFromError(err)) {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(300 * time.Millisecond):
			}
			continue
		}
		if err != nil {
			return nil, err
		}
	}
	if resp == nil {
		if err != nil {
			return nil, err
		}
		return nil, errors.New("gemini vision request failed")
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("gemini vision status %d: %s", resp.StatusCode, string(respBody))
	}
	var parsed struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, err
	}
	for _, candidate := range parsed.Candidates {
		for _, part := range candidate.Content.Parts {
			if strings.TrimSpace(part.Text) != "" {
				return parseImageDecision(part.Text)
			}
		}
	}
	return nil, errors.New("gemini vision returned no text")
}

func shouldRetryVisionStatus(status int) bool {
	return status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500
}

func shouldRetryVisionStatusCodeFromError(err error) bool {
	if err == nil {
		return false
	}
	var netErr net.Error
	return errors.As(err, &netErr) && (netErr.Timeout() || netErr.Temporary())
}

func geminiVisionEndpoint(baseURL, model string) string {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	if err != nil {
		return strings.TrimRight(baseURL, "/") + "/v1beta/models/" + url.PathEscape(model) + ":generateContent"
	}
	path := strings.TrimRight(parsed.Path, "/")
	path = strings.TrimSuffix(path, "/v1beta")
	path = strings.TrimSuffix(path, "/v1")
	parsed.Path = path + "/v1beta/models/" + url.PathEscape(model) + ":generateContent"
	parsed.RawQuery = ""
	return parsed.String()
}

func classifyFoodImage(ctx context.Context, configDir, apiKeyPath, baseURL, model, foodName string, data []byte, contentType string) (*imageDecision, error) {
	client, err := newVisionClient(configDir, apiKeyPath, baseURL, model)
	if err != nil {
		return nil, err
	}
	decision, err := client.classifyImage(ctx, foodName, data, contentType)
	if err == nil {
		return decision, nil
	}
	if strings.Contains(err.Error(), "parse vision decision") {
		if retry, retryErr := client.classifyImage(ctx, foodName, data, contentType); retryErr == nil {
			return retry, nil
		}
	}
	return nil, err
}

func runTestAPI(ctx context.Context, opts options) error {
	client, err := newVisionClient(opts.configDir, opts.visionAPIKeyPath, opts.dashscopeBaseURL, opts.model)
	if err != nil {
		return err
	}
	fmt.Printf("DashScope base_url=%s\n", client.baseURL)

	models, listErr := client.listModels(ctx)
	if listErr != nil {
		fmt.Fprintf(os.Stderr, "拉取模型列表失败: %v\n", listErr)
	} else {
		fmt.Printf("可用模型数量: %d\n", len(models))
		var flashModels []string
		for _, id := range models {
			lower := strings.ToLower(id)
			if strings.Contains(lower, "qwen3.5") && strings.Contains(lower, "flash") {
				flashModels = append(flashModels, id)
			}
		}
		if len(flashModels) > 0 {
			fmt.Println("qwen3.5-flash 系列:")
			for _, id := range flashModels {
				fmt.Printf("  - %s\n", id)
			}
		}
	}

	resolved, err := client.resolveModel(ctx, opts.model)
	if err != nil {
		return err
	}
	client.model = resolved
	fmt.Printf("选用模型: %s\n", resolved)

	foodName := strings.TrimSpace(opts.demoFood)
	if foodName == "" {
		foodName = "凉拌海带丝"
	}
	fmt.Printf("Bing 取图验证: %s\n", foodName)
	candidates := searchBingImages(foodName, 8, 0)
	if len(candidates) == 0 {
		return errors.New("Bing 未返回候选图")
	}
	fmt.Printf("候选图数量: %d，使用首张: %s\n", len(candidates), candidates[0].ImageURL)

	img, err := downloadCandidateHTTP(ctx, candidates[0], "bing")
	if err != nil {
		return fmt.Errorf("下载候选图失败: %w", err)
	}
	fmt.Printf("已下载 %d 字节 (%s)\n", len(img.Data), img.ContentType)

	decision, err := client.classifyImage(ctx, foodName, img.Data, img.ContentType)
	if err != nil {
		return fmt.Errorf("视觉判定失败: %w", err)
	}
	encoded, _ := json.MarshalIndent(decision, "", "  ")
	fmt.Println("判定结果:")
	fmt.Println(string(encoded))
	if decision.Match && decision.Confidence >= opts.threshold {
		fmt.Printf("API 验证通过: match=true confidence=%.2f >= threshold=%.2f\n", decision.Confidence, opts.threshold)
		return nil
	}
	fmt.Printf("API 可用但未达阈值: match=%v confidence=%.2f threshold=%.2f\n", decision.Match, decision.Confidence, opts.threshold)
	return nil
}

var (
	reVisionFoodMatch   = regexp.MustCompile(`"food_match"\s*:\s*(true|false)`)
	reVisionNoWatermark = regexp.MustCompile(`"no_watermark"\s*:\s*(true|false)`)
	reVisionMatch       = regexp.MustCompile(`"match"\s*:\s*(true|false)`)
	reVisionConfidence  = regexp.MustCompile(`"confidence"\s*:\s*([0-9.]+)`)
	reVisionReason      = regexp.MustCompile(`"reason"\s*:\s*"((?:\\.|[^"\\])*)"`)
)

func parseImageDecision(raw string) (*imageDecision, error) {
	content := extractJSONObject(raw)
	var decision imageDecision
	if jsonErr := json.Unmarshal([]byte(content), &decision); jsonErr == nil {
		normalizeImageDecision(&decision)
		return &decision, nil
	}
	if parts := reVisionFoodMatch.FindStringSubmatch(content); len(parts) == 2 {
		decision.FoodMatch = parts[1] == "true"
	}
	if parts := reVisionNoWatermark.FindStringSubmatch(content); len(parts) == 2 {
		decision.NoWatermark = parts[1] == "true"
	}
	if parts := reVisionMatch.FindStringSubmatch(content); len(parts) == 2 {
		decision.Match = parts[1] == "true"
	}
	if !decision.FoodMatch && !decision.NoWatermark && !decision.Match {
		return nil, fmt.Errorf("parse vision decision %q: invalid json", raw)
	}
	if confParts := reVisionConfidence.FindStringSubmatch(content); len(confParts) == 2 {
		fmt.Sscanf(confParts[1], "%f", &decision.Confidence)
	}
	if reasonParts := reVisionReason.FindStringSubmatch(content); len(reasonParts) == 2 {
		decision.Reason = strings.ReplaceAll(reasonParts[1], `\"`, `"`)
	}
	if decision.Reason == "" {
		decision.Reason = "模型返回不完整，按不匹配处理"
	}
	normalizeImageDecision(&decision)
	return &decision, nil
}

func normalizeImageDecision(decision *imageDecision) {
	clampImageDecision(decision)
	if decision.FoodMatch || decision.NoWatermark {
		decision.Match = decision.FoodMatch && decision.NoWatermark
		return
	}
	decision.FoodMatch = decision.Match
	decision.NoWatermark = decision.Match
}

func clampImageDecision(decision *imageDecision) {
	if decision.Confidence < 0 {
		decision.Confidence = 0
	}
	if decision.Confidence > 1 {
		decision.Confidence = 1
	}
}

func ensureVisionModel(ctx context.Context, opts *options) error {
	if strings.TrimSpace(opts.model) != "" && opts.model != dashScopeModelHint {
		return nil
	}
	client, err := newVisionClient(opts.configDir, opts.visionAPIKeyPath, opts.dashscopeBaseURL, "")
	if err != nil {
		return err
	}
	resolved, err := client.resolveModel(ctx, opts.model)
	if err != nil {
		return err
	}
	opts.model = resolved
	fmt.Fprintf(os.Stderr, "vision_model=%s\n", resolved)
	return nil
}

// 兼容旧 results.jsonl 中的 kimiDecision 字段名。
type kimiDecision = imageDecision

func parseKimiDecision(raw string) (*imageDecision, error) {
	return parseImageDecision(raw)
}

func normalizeKimiDecision(decision *imageDecision) {
	normalizeImageDecision(decision)
}

func clampKimiDecision(decision *imageDecision) {
	clampImageDecision(decision)
}
