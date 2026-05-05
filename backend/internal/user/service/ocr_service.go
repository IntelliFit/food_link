package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/config"
)

type OCRService struct {
	cfg *config.Config
}

func NewOCRService(cfg *config.Config) *OCRService {
	return &OCRService{cfg: cfg}
}

func (s *OCRService) ExtractFromBase64(ctx context.Context, base64Image string) (map[string]any, error) {
	imageData := base64Image
	if idx := strings.Index(imageData, ","); idx != -1 {
		imageData = imageData[idx+1:]
	}
	return s.callDashScope(ctx, fmt.Sprintf("data:image/jpeg;base64,%s", imageData))
}

func (s *OCRService) ExtractFromURL(ctx context.Context, imageURL string) (map[string]any, error) {
	return s.callDashScope(ctx, imageURL)
}

func (s *OCRService) callDashScope(ctx context.Context, imageURL string) (map[string]any, error) {
	apiKey := s.cfg.External.DashscopeAPIKey
	if apiKey == "" {
		return nil, &commonerrors.AppError{Code: 10000, Message: "缺少 DASHSCOPE_API_KEY", HTTPStatus: 500}
	}
	payload := map[string]any{
		"model": "gemini-3-flash-preview",
		"messages": []map[string]any{
			{
				"role": "user",
				"content": []map[string]any{
					{"type": "text", "text": ocrReportPrompt()},
					{"type": "image_url", "image_url": map[string]string{"url": imageURL}},
				},
			},
		},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     0.3,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &commonerrors.AppError{Code: 10000, Message: "OCR 识别服务请求失败", HTTPStatus: 500}
	}
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	choices, ok := result["choices"].([]any)
	if !ok || len(choices) == 0 {
		return nil, &commonerrors.AppError{Code: 10000, Message: "OCR 返回为空", HTTPStatus: 500}
	}
	firstChoice, ok := choices[0].(map[string]any)
	if !ok {
		return nil, &commonerrors.AppError{Code: 10000, Message: "OCR 返回为空", HTTPStatus: 500}
	}
	message, ok := firstChoice["message"].(map[string]any)
	if !ok {
		return nil, &commonerrors.AppError{Code: 10000, Message: "OCR 返回为空", HTTPStatus: 500}
	}
	content, ok := message["content"].(string)
	if !ok || content == "" {
		return nil, &commonerrors.AppError{Code: 10000, Message: "OCR 返回为空", HTTPStatus: 500}
	}
	content = regexp.MustCompile("```json").ReplaceAllString(content, "")
	content = regexp.MustCompile("```").ReplaceAllString(content, "")
	content = strings.TrimSpace(content)
	var extracted map[string]any
	if err := json.Unmarshal([]byte(content), &extracted); err != nil {
		return nil, &commonerrors.AppError{Code: 10000, Message: "OCR 返回格式解析失败", HTTPStatus: 500}
	}
	return extracted, nil
}

func ocrReportPrompt() string {
	return `你是一个专业的 OCR 文字识别助手。请识别这张体检报告或病例截图中的所有文字内容。
任务要求：
1. **仅提取**图片中实际存在的文字，**严禁**进行总结、概括、分析或生成医疗建议。
2. 如果图片中包含指标数据，请精确提取数值和单位。
3. 如果图片中包含诊断结论，请按原文提取。

请严格按以下 JSON 格式返回（若某项图片中不存在则填空数组或空字符串）：
{
  "indicators": [{"name": "项目名称", "value": "测定值", "unit": "单位", "flag": "异常标记(如↑/↓)"}],
  "conclusions": ["诊断结论1(原文)", "诊断结论2(原文)"],
  "suggestions": ["医学建议(仅提取报告原文中的建议，不要自己生成)"],
  "medical_notes": "其他主要文字内容的原文提取"
}
只返回上述 JSON，不要其他说明。`
}
