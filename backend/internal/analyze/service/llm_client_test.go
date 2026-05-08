package service

import (
	"bytes"
	"context"
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

func TestDashScopeClient_Analyze_Success(t *testing.T) {
	client := NewDashScopeClient("fake-key", "qwen-vl-max")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
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

func TestDashScopeClient_Analyze_HTTPError(t *testing.T) {
	client := NewDashScopeClient("fake-key", "")
	client.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})}

	_, err := client.Analyze(context.Background(), "test", "")
	assert.Error(t, err)
}

func TestDashScopeClient_Analyze_StatusError(t *testing.T) {
	client := NewDashScopeClient("fake-key", "")
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

func TestDashScopeClient_Analyze_EmptyChoices(t *testing.T) {
	client := NewDashScopeClient("fake-key", "")
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

func TestParseLLMJSON_WithFences(t *testing.T) {
	jsonStr := "```json\n{\"name\":\"apple\"}\n```"
	result, err := parseLLMJSON(jsonStr)
	assert.NoError(t, err)
	assert.Equal(t, "apple", result["name"])
}

func TestParseLLMJSON_InvalidJSON(t *testing.T) {
	_, err := parseLLMJSON("not json")
	assert.Error(t, err)
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
