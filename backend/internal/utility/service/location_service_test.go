package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/config"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func mockTiandituResponse() *http.Response {
	body := `{"status":"0","msg":"ok","location":{"lon":116.4,"lat":39.9,"address":"北京市"}}`
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewBufferString(body)),
		Header:     make(http.Header),
	}
}

func TestLocationService_ReverseGeocode_Success(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: "mock-tk"}}
	svc := NewLocationService(cfg)
	svc.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "https", req.URL.Scheme)
		assert.Equal(t, "/geocoder", req.URL.Path)
		return mockTiandituResponse(), nil
	})
	ctx := context.Background()

	result, err := svc.ReverseGeocode(ctx, 39.9, 116.4)
	assert.NoError(t, err)
	assert.NotNil(t, result)
}

func TestLocationService_ReverseGeocode_MissingTK(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: ""}}
	svc := NewLocationService(cfg)
	ctx := context.Background()

	_, err := svc.ReverseGeocode(ctx, 39.9, 116.4)
	assert.Error(t, err)
}

func TestLocationService_ReverseGeocode_HTTPError(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: "mock-tk"}}
	svc := NewLocationService(cfg)
	svc.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})
	ctx := context.Background()

	_, err := svc.ReverseGeocode(ctx, 39.9, 116.4)
	assert.Error(t, err)
}

func TestLocationService_SearchAddress_Success(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: "mock-tk"}}
	svc := NewLocationService(cfg)
	svc.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "https", req.URL.Scheme)
		assert.Equal(t, "/v2/search", req.URL.Path)
		postStr, err := url.QueryUnescape(req.URL.Query().Get("postStr"))
		require.NoError(t, err)
		var payload map[string]any
		require.NoError(t, json.Unmarshal([]byte(postStr), &payload))
		assert.Equal(t, `北京"店`, payload["keyWord"])
		assert.Equal(t, float64(10), payload["count"])
		assert.Equal(t, tiandituDefaultMapBound, payload["mapBound"])
		return mockTiandituResponse(), nil
	})
	ctx := context.Background()

	result, err := svc.SearchAddress(ctx, `北京"店`, 0, nil, nil, nil)
	assert.NoError(t, err)
	assert.NotNil(t, result)
}

func TestLocationService_SearchAddress_UsesCenterRadiusAndCount(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: "mock-tk"}}
	svc := NewLocationService(cfg)
	lon := 116.4
	lat := 39.9
	radiusKM := 2.0
	svc.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		postStr, err := url.QueryUnescape(req.URL.Query().Get("postStr"))
		require.NoError(t, err)
		var payload map[string]any
		require.NoError(t, json.Unmarshal([]byte(postStr), &payload))

		assert.Equal(t, float64(20), payload["count"])
		assert.Equal(t, "116.376514,39.881982,116.423486,39.918018", payload["mapBound"])
		return mockTiandituResponse(), nil
	})
	ctx := context.Background()

	result, err := svc.SearchAddress(ctx, "北京大学", 50, &lon, &lat, &radiusKM)
	assert.NoError(t, err)
	assert.NotNil(t, result)
}

func TestLocationService_SearchAddress_EmptyKeyword(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: "mock-tk"}}
	svc := NewLocationService(cfg)
	ctx := context.Background()

	result, err := svc.SearchAddress(ctx, " ", 0, nil, nil, nil)
	assert.NoError(t, err)
	assert.Equal(t, "", result["keyword"])
	assert.Empty(t, result["pois"])
}

func TestLocationService_SearchAddress_MissingTK(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: ""}}
	svc := NewLocationService(cfg)
	ctx := context.Background()

	_, err := svc.SearchAddress(ctx, "北京", 0, nil, nil, nil)
	assert.Error(t, err)
}

func TestLocationService_SearchAddress_HTTPError(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: "mock-tk"}}
	svc := NewLocationService(cfg)
	svc.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})
	ctx := context.Background()

	_, err := svc.SearchAddress(ctx, "北京", 0, nil, nil, nil)
	assert.Error(t, err)
}

func TestLocationService_SearchAddress_NonJSONProductionReturnsFriendlyAppError(t *testing.T) {
	cfg := &config.Config{
		App:      config.AppConfig{Env: "production"},
		External: config.ExternalConfig{TiandituTK: "mock-tk"},
	}
	svc := NewLocationService(cfg)
	svc.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString("<html>not json</html>")),
			Header:     make(http.Header),
		}, nil
	})
	ctx := context.Background()

	_, err := svc.SearchAddress(ctx, "北京", 0, nil, nil, nil)
	require.Error(t, err)
	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, "位置服务暂时不可用，请稍后重试", appErr.Message)
}

func TestLocationService_SearchAddress_HTTPForbiddenDevelopmentFallback(t *testing.T) {
	cfg := &config.Config{
		App:      config.AppConfig{Env: "development"},
		External: config.ExternalConfig{TiandituTK: "mock-tk"},
	}
	svc := NewLocationService(cfg)
	svc.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusForbidden,
			Body:       io.NopCloser(bytes.NewBufferString(`{"status":"403","msg":"forbidden"}`)),
			Header:     make(http.Header),
		}, nil
	})
	ctx := context.Background()

	result, err := svc.SearchAddress(ctx, "咖啡", 0, nil, nil, nil)
	require.NoError(t, err)
	assert.Equal(t, true, result["fallback"])
	assert.NotEmpty(t, result["pois"])
}
