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
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"food_link/backend/internal/auth/repo"
	"food_link/backend/pkg/config"
)

func setupBindPhoneTestDB(t *testing.T) (*gorm.DB, *repo.UserRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&repo.User{}))
	return db, repo.NewUserRepo(db)
}

func mockPhoneNumberResponse() *http.Response {
	body := `{"errcode":0,"phone_info":{"purePhoneNumber":"13800138000","phoneNumber":"+86 13800138000"}}`
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewBufferString(body)),
		Header:     make(http.Header),
	}
}

func mockAccessTokenResponse() *http.Response {
	body := `{"access_token":"mock_token"}`
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewBufferString(body)),
		Header:     make(http.Header),
	}
}

func TestBindPhoneService_BindPhone_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		if bytes.Contains([]byte(req.URL.String()), []byte("stable_token")) {
			return mockAccessTokenResponse(), nil
		}
		return mockPhoneNumberResponse(), nil
	})
	defer patches.Reset()

	_, userRepo := setupBindPhoneTestDB(t)
	cfg := &config.Config{External: config.ExternalConfig{AppID: "appid", Secret: "secret"}}
	svc := NewBindPhoneService(cfg, userRepo)
	ctx := context.Background()

	user := &repo.User{OpenID: "o1"}
	require.NoError(t, userRepo.Create(ctx, user))

	result, err := svc.BindPhone(ctx, user.ID, BindPhoneInput{PhoneCode: "code123"})
	require.NoError(t, err)
	assert.Equal(t, "13800138000", result.Telephone)
}

func TestBindPhoneService_BindPhone_EmptyCode(t *testing.T) {
	_, userRepo := setupBindPhoneTestDB(t)
	cfg := &config.Config{}
	svc := NewBindPhoneService(cfg, userRepo)
	ctx := context.Background()

	_, err := svc.BindPhone(ctx, "user1", BindPhoneInput{PhoneCode: ""})
	assert.Error(t, err)
}

func TestBindPhoneService_BindPhone_APIError(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		if bytes.Contains([]byte(req.URL.String()), []byte("stable_token")) {
			return mockAccessTokenResponse(), nil
		}
		body := `{"errcode":40001,"errmsg":"invalid code"}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})
	defer patches.Reset()

	_, userRepo := setupBindPhoneTestDB(t)
	cfg := &config.Config{External: config.ExternalConfig{AppID: "appid", Secret: "secret"}}
	svc := NewBindPhoneService(cfg, userRepo)
	ctx := context.Background()

	_, err := svc.BindPhone(ctx, "user1", BindPhoneInput{PhoneCode: "badcode"})
	assert.Error(t, err)
}

func TestBindPhoneService_BindPhone_HTTPError(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})
	defer patches.Reset()

	_, userRepo := setupBindPhoneTestDB(t)
	cfg := &config.Config{External: config.ExternalConfig{AppID: "appid", Secret: "secret"}}
	svc := NewBindPhoneService(cfg, userRepo)
	ctx := context.Background()

	_, err := svc.BindPhone(ctx, "user1", BindPhoneInput{PhoneCode: "code"})
	assert.Error(t, err)
}

func TestBindPhoneService_BindPhone_StatusError(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(bytes.NewBufferString("error")),
			Header:     make(http.Header),
		}, nil
	})
	defer patches.Reset()

	_, userRepo := setupBindPhoneTestDB(t)
	cfg := &config.Config{External: config.ExternalConfig{AppID: "appid", Secret: "secret"}}
	svc := NewBindPhoneService(cfg, userRepo)
	ctx := context.Background()

	_, err := svc.BindPhone(ctx, "user1", BindPhoneInput{PhoneCode: "code"})
	assert.Error(t, err)
}

func TestBindPhoneService_BindPhone_EmptyPhone(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		if bytes.Contains([]byte(req.URL.String()), []byte("stable_token")) {
			return mockAccessTokenResponse(), nil
		}
		body := `{"errcode":0,"phone_info":{}}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})
	defer patches.Reset()

	_, userRepo := setupBindPhoneTestDB(t)
	cfg := &config.Config{External: config.ExternalConfig{AppID: "appid", Secret: "secret"}}
	svc := NewBindPhoneService(cfg, userRepo)
	ctx := context.Background()

	_, err := svc.BindPhone(ctx, "user1", BindPhoneInput{PhoneCode: "code"})
	assert.Error(t, err)
}

func TestBindPhoneService_GetAccessToken_EmptyToken(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		body := `{"errcode":0}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})
	defer patches.Reset()

	_, userRepo := setupBindPhoneTestDB(t)
	cfg := &config.Config{External: config.ExternalConfig{AppID: "appid", Secret: "secret"}}
	svc := NewBindPhoneService(cfg, userRepo)
	ctx := context.Background()

	_, err := svc.BindPhone(ctx, "user1", BindPhoneInput{PhoneCode: "code"})
	assert.Error(t, err)
}
