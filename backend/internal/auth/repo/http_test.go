package repo

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

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
	assert.Contains(t, err.Error(), "unexpected status: 500")
}

func TestSimpleJSONGet_InvalidEndpoint(t *testing.T) {
	ctx := context.Background()
	var result map[string]string
	err := simpleJSONGet(ctx, "://invalid-url", nil, &result)
	require.Error(t, err)
}
