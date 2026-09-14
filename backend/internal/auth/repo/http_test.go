package repo

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSimpleJSONGet_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "value1", r.URL.Query().Get("key1"))
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"result": "ok"})
	}))
	defer server.Close()

	ctx := context.Background()
	var result map[string]string
	err := simpleJSONGet(ctx, server.URL, map[string]string{"key1": "value1"}, &result)
	require.NoError(t, err)
	assert.Equal(t, "ok", result["result"])
}

func TestSimpleJSONGet_BadStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	ctx := context.Background()
	var result map[string]string
	err := simpleJSONGet(ctx, server.URL, nil, &result)
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrWechatUpstreamUnavailable)
	assert.Contains(t, err.Error(), "HTTP 500")
}

func TestSimpleJSONGet_InvalidEndpoint(t *testing.T) {
	ctx := context.Background()
	var result map[string]string
	err := simpleJSONGet(ctx, "://invalid-url", nil, &result)
	require.Error(t, err)
}

func TestSimpleJSONGet_TimeoutIsSanitizedAndRetryable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(80 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]string{"result": "late"})
	}))
	defer server.Close()

	client := &http.Client{Timeout: 20 * time.Millisecond}
	var result map[string]string
	err := simpleJSONGetWithClient(context.Background(), client, server.URL+"?secret=must-not-leak", nil, &result)

	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrWechatUpstreamUnavailable))
	assert.NotContains(t, err.Error(), "must-not-leak")
}
