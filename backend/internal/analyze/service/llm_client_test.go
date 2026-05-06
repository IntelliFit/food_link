package service

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"reflect"
	"testing"

	. "github.com/agiledragon/gomonkey/v2"
	"github.com/stretchr/testify/assert"
)

func TestDashScopeClient_Analyze_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"{\"description\":\"test\",\"items\":[{\"name\":\"rice\",\"estimatedWeightGrams\":100,\"nutrients\":{\"calories\":130}}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})
	defer patches.Reset()

	client := NewDashScopeClient("fake-key", "qwen-vl-max")
	result, err := client.Analyze(context.Background(), "test prompt", "https://example.com/img.jpg")
	assert.NoError(t, err)
	assert.Equal(t, "test", result["description"])
}

func TestDashScopeClient_Analyze_HTTPError(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})
	defer patches.Reset()

	client := NewDashScopeClient("fake-key", "")
	_, err := client.Analyze(context.Background(), "test", "")
	assert.Error(t, err)
}

func TestDashScopeClient_Analyze_StatusError(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(bytes.NewBufferString("error")),
			Header:     make(http.Header),
		}, nil
	})
	defer patches.Reset()

	client := NewDashScopeClient("fake-key", "")
	_, err := client.Analyze(context.Background(), "test", "")
	assert.Error(t, err)
}

func TestDashScopeClient_Analyze_EmptyChoices(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		body := `{"choices":[]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})
	defer patches.Reset()

	client := NewDashScopeClient("fake-key", "")
	_, err := client.Analyze(context.Background(), "test", "")
	assert.Error(t, err)
}

func TestOfoxAIClient_Analyze_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"{\"description\":\"test\",\"items\":[{\"name\":\"rice\",\"estimatedWeightGrams\":100,\"nutrients\":{\"calories\":130}}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})
	defer patches.Reset()

	client := NewOfoxAIClient("fake-key", "gemini-3-flash-preview")
	result, err := client.Analyze(context.Background(), "test prompt", "https://example.com/img.jpg")
	assert.NoError(t, err)
	assert.Equal(t, "test", result["description"])
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
