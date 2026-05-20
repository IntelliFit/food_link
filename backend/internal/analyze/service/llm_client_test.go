package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestDoubaoClient_Analyze_Success(t *testing.T) {
	client := NewDoubaoClient("fake-key", "doubao-seed-2-0-lite-260428")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		var payload map[string]any
		assert.NoError(t, json.NewDecoder(req.Body).Decode(&payload))
		assert.Equal(t, "low", payload["reasoning_effort"])
		messages := payload["messages"].([]any)
		content := messages[0].(map[string]any)["content"].([]any)
		image := content[1].(map[string]any)["image_url"].(map[string]any)
		assert.Equal(t, "https://example.com/img.jpg", image["url"])
		assert.NotContains(t, image, "detail")
		body := `{"choices":[{"message":{"content":"{\"description\":\"test\",\"items\":[{\"name\":\"rice\",\"estimatedWeightGrams\":100,\"nutrients\":{\"calories\":130}}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	result, err := client.Analyze(context.Background(), "test prompt", "https://example.com/img.jpg")
	assert.NoError(t, err)
	assert.Equal(t, "test", result["description"])
}

func TestDoubaoClient_Analyze_HTTPError(t *testing.T) {
	client := NewDoubaoClient("fake-key", "")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})}

	_, err := client.Analyze(context.Background(), "test", "")
	assert.Error(t, err)
}

func TestDoubaoClient_Analyze_StatusError(t *testing.T) {
	client := NewDoubaoClient("fake-key", "")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(bytes.NewBufferString("error")),
			Header:     make(http.Header),
		}, nil
	})}

	_, err := client.Analyze(context.Background(), "test", "")
	assert.Error(t, err)
}

func TestDoubaoClient_Analyze_EmptyChoices(t *testing.T) {
	client := NewDoubaoClient("fake-key", "")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"choices":[]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	_, err := client.Analyze(context.Background(), "test", "")
	assert.Error(t, err)
}

func TestDoubaoClient_AnalyzeWithImagesWebSearch_Success(t *testing.T) {
	client := NewDoubaoClient("fake-key", "doubao-seed-2-0-lite-260428")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "https://ark.cn-beijing.volces.com/api/v3/responses", req.URL.String())
		var body map[string]any
		assert.NoError(t, json.NewDecoder(req.Body).Decode(&body))
		assert.Equal(t, "doubao-seed-2-0-lite-260428", body["model"])
		tools := body["tools"].([]any)
		assert.Equal(t, "web_search", tools[0].(map[string]any)["type"])
		input := body["input"].([]any)
		content := input[0].(map[string]any)["content"].([]any)
		assert.Equal(t, "input_text", content[0].(map[string]any)["type"])
		assert.Equal(t, "input_image", content[1].(map[string]any)["type"])
		assert.NotContains(t, content[1].(map[string]any), "detail")
		response := `{
			"id":"resp_1",
			"model":"doubao-seed-2-0-lite-260428",
			"output_text":"{\"description\":\"轻量识别\",\"items\":[{\"name\":\"龙宫果\",\"estimatedWeightGrams\":45}]}",
			"usage":{"tool_usage":{"web_search":1},"tool_usage_details":{"web_search":{"search_engine":1}}}
		}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(response)),
			Header:     make(http.Header),
		}, nil
	})}

	result, meta, err := client.AnalyzeWithImagesWebSearch(context.Background(), "test prompt", []string{"https://example.com/img.jpg"}, DoubaoWebSearchOptions{MaxKeyword: 2, Limit: 5, MaxToolCalls: 1})

	assert.NoError(t, err)
	assert.Equal(t, "轻量识别", result["description"])
	assert.Equal(t, "resp_1", meta["response_id"])
	assert.NotNil(t, meta["tool_usage"])
}

func TestDoubaoClient_AnalyzeWithImagesWebSearch_ToolNotOpen(t *testing.T) {
	client := NewDoubaoClient("fake-key", "doubao-seed-2-0-lite-260428")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"error":{"code":"ToolNotOpen","message":"Your account has not activated web search. You may activate it at https://console.volcengine.com/"}}`
		return &http.Response{
			StatusCode: http.StatusNotFound,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})}

	_, _, err := client.AnalyzeWithImagesWebSearch(context.Background(), "test prompt", []string{"https://example.com/img.jpg"}, DoubaoWebSearchOptions{})

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "doubao web search tool not activated")
	assert.NotContains(t, err.Error(), "ToolNotOpen")
	assert.NotContains(t, err.Error(), "volcengine.com")
}

func TestOfoxAIClient_Analyze_Success(t *testing.T) {
	client := NewOfoxAIClient("fake-key", "gemini-3-flash-preview")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "https://api.ofox.ai/v1/chat/completions", req.URL.String())
		body := `{"choices":[{"message":{"content":"{\"description\":\"test\",\"items\":[{\"name\":\"rice\",\"estimatedWeightGrams\":100,\"nutrients\":{\"calories\":130}}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	result, err := client.Analyze(context.Background(), "test prompt", "https://example.com/img.jpg")
	assert.NoError(t, err)
	assert.Equal(t, "test", result["description"])
}

func TestOfoxAIClient_Analyze_CustomBaseURL(t *testing.T) {
	client := NewOfoxAIClient("fake-key", "gemini-3-flash-preview", "https://proxy.example.com/v1/")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "https://proxy.example.com/v1/chat/completions", req.URL.String())
		return nil, errors.New("stop after url assertion")
	})}

	_, err := client.Analyze(context.Background(), "test prompt", "https://example.com/img.jpg")
	assert.Error(t, err)
}

func TestOfoxAIClient_Analyze_HTMLResponse(t *testing.T) {
	client := NewOfoxAIClient("fake-key", "gemini-3-flash-preview")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString("<html><head><title>Ofox AI</title></head><body>home</body></html>")),
			Header:     http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
		}, nil
	})}

	_, err := client.Analyze(context.Background(), "test prompt", "https://example.com/img.jpg")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "returned html instead of json")
	assert.False(t, strings.Contains(err.Error(), "<html"))
}

func TestDeepSeekNutritionEstimator_Analyze_Success(t *testing.T) {
	client := NewDeepSeekNutritionEstimator("fake-key", "", "")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "https://api.deepseek.com/chat/completions", req.URL.String())
		body := `{"choices":[{"message":{"content":"{\"description\":\"文字记录\",\"items\":[{\"name\":\"米饭\",\"estimatedWeightGrams\":100}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	result, err := client.Analyze(context.Background(), "test prompt", "")
	assert.NoError(t, err)
	assert.Equal(t, "文字记录", result["description"])
}

func TestDeepSeekNutritionEstimator_Analyze_MissingKey(t *testing.T) {
	client := NewDeepSeekNutritionEstimator("", "", "")
	_, err := client.Analyze(context.Background(), "test prompt", "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "DEEPSEEK_API_KEY")
}

func TestParseLLMJSON_WithFences(t *testing.T) {
	jsonStr := "```json\n{\"name\":\"apple\"}\n```"
	result, err := parseLLMJSON(jsonStr)
	assert.NoError(t, err)
	assert.Equal(t, "apple", result["name"])
}

func TestParseLLMJSON_ArrayPayload(t *testing.T) {
	result, err := parseLLMJSON(`[{"name":"apple"},{"name":"banana"}]`)
	assert.NoError(t, err)
	items, ok := result["items"].([]any)
	assert.True(t, ok)
	assert.Len(t, items, 2)
}

func TestParseLLMJSON_InvalidJSON(t *testing.T) {
	_, err := parseLLMJSON("not json")
	assert.Error(t, err)
	assert.True(t, IsLLMJSONParseError(err))
	assert.Contains(t, err.Error(), "parse llm json failed")
}

func TestNormalizePayload_Map(t *testing.T) {
	result := normalizePayload(map[string]any{"name": "apple"})
	assert.Equal(t, "apple", result["name"])
}

func TestNormalizePayload_ArrayWithName(t *testing.T) {
	result := normalizePayload([]any{map[string]any{"name": "apple"}, map[string]any{"name": "banana"}})
	items, ok := result["items"].([]any)
	assert.True(t, ok)
	assert.Len(t, items, 2)
}

func TestNormalizePayload_Invalid(t *testing.T) {
	result := normalizePayload("string")
	assert.Empty(t, result)
}

func TestNormalizeImageURL(t *testing.T) {
	assert.Equal(t, "data:image/jpeg;base64,abc", normalizeImageURL("data:image/png;base64,abc"))
	assert.Equal(t, "https://example.com/img.jpg", normalizeImageURL("https://example.com/img.jpg"))
}
