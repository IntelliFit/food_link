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

	"food_link/backend/pkg/config"
)

func mockTiandituResponse() *http.Response {
	body := `{"status":"0","msg":"ok","location":{"lon":116.4,"lat":39.9,"address":"北京市"}}`
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewBufferString(body)),
		Header:     make(http.Header),
	}
}

func TestLocationService_ReverseGeocode_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return mockTiandituResponse(), nil
	})
	defer patches.Reset()

	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: "mock-tk"}}
	svc := NewLocationService(cfg)
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
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})
	defer patches.Reset()

	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: "mock-tk"}}
	svc := NewLocationService(cfg)
	ctx := context.Background()

	_, err := svc.ReverseGeocode(ctx, 39.9, 116.4)
	assert.Error(t, err)
}

func TestLocationService_SearchAddress_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return mockTiandituResponse(), nil
	})
	defer patches.Reset()

	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: "mock-tk"}}
	svc := NewLocationService(cfg)
	ctx := context.Background()

	result, err := svc.SearchAddress(ctx, "北京")
	assert.NoError(t, err)
	assert.NotNil(t, result)
}

func TestLocationService_SearchAddress_MissingTK(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: ""}}
	svc := NewLocationService(cfg)
	ctx := context.Background()

	_, err := svc.SearchAddress(ctx, "北京")
	assert.Error(t, err)
}

func TestLocationService_SearchAddress_HTTPError(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})
	defer patches.Reset()

	cfg := &config.Config{External: config.ExternalConfig{TiandituTK: "mock-tk"}}
	svc := NewLocationService(cfg)
	ctx := context.Background()

	_, err := svc.SearchAddress(ctx, "北京")
	assert.Error(t, err)
}
