package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"food_link/backend/internal/auth/repo"
	"food_link/backend/internal/auth/service"
	"food_link/backend/pkg/config"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupLoginTestDB(t *testing.T) (*gorm.DB, *repo.UserRepo) {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&repo.User{}, &repo.UserTrialEntitlement{}))
	return db, repo.NewUserRepo(db)
}

func setupLoginRouter(h *LoginHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/login", h.Login)
	r.POST("/api/app/login/wechat", h.AppWechatLogin)
	r.POST("/api/app/login/password", h.PasswordLogin)
	r.POST("/api/app/register/password", h.PasswordRegister)
	return r
}

func TestLoginHandler_Login(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development"},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := service.NewJWTService("test-secret-key-for-testing-only-min-32-chars", 3600, 86400)
	svc := service.NewLoginService(cfg, userRepo, jwtSvc)
	h := NewLoginHandler(svc)
	r := setupLoginRouter(h)

	body, _ := json.Marshal(map[string]string{"testOpenid": "test_openid_123"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.NotEmpty(t, resp["access_token"])
	assert.Equal(t, "test_openid_123", resp["openid"])
}

func TestLoginHandler_LoginBindError(t *testing.T) {
	h := NewLoginHandler(nil)
	r := setupLoginRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/login", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "请求参数无效", resp["detail"])
}

func TestLoginHandler_LoginServiceError(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App:      config.AppConfig{Env: "production"},
		External: config.ExternalConfig{AppID: "appid", Secret: "secret"},
		JWT:      config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := service.NewJWTService("test-secret-key-for-testing-only-min-32-chars", 3600, 86400)
	svc := service.NewLoginService(cfg, userRepo, jwtSvc)
	h := NewLoginHandler(svc)
	r := setupLoginRouter(h)

	body, _ := json.Marshal(map[string]string{"code": "invalid_code"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.NotEmpty(t, resp["detail"])
}

func TestLoginHandler_AppWechatLoginDevelopmentMock(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development"},
		AppAuth: config.AppAuthConfig{
			DevelopmentMockLogin:      true,
			DevelopmentMockWechatCode: "expo-go-dev-wechat-code",
		},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := service.NewJWTService("test-secret-key-for-testing-only-min-32-chars", 3600, 86400)
	h := NewLoginHandler(service.NewLoginService(cfg, userRepo, jwtSvc))
	r := setupLoginRouter(h)

	body, _ := json.Marshal(map[string]string{"code": "expo-go-dev-wechat-code"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/app/login/wechat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.NotEmpty(t, resp["access_token"])
	assert.Equal(t, "app-wx:mobile-app-dev-openid-default", resp["openid"])
}

func TestLoginHandler_PasswordRegisterAndLogin(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development"},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := service.NewJWTService("test-secret-key-for-testing-only-min-32-chars", 3600, 86400)
	h := NewLoginHandler(service.NewLoginService(cfg, userRepo, jwtSvc))
	r := setupLoginRouter(h)

	registerBody, _ := json.Marshal(map[string]string{"username": "mobileuser", "password": "password123"})
	registerW := httptest.NewRecorder()
	registerReq, _ := http.NewRequest(http.MethodPost, "/api/app/register/password", bytes.NewReader(registerBody))
	registerReq.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(registerW, registerReq)
	assert.Equal(t, http.StatusOK, registerW.Code)

	loginBody, _ := json.Marshal(map[string]string{"username": "mobileuser", "password": "password123"})
	loginW := httptest.NewRecorder()
	loginReq, _ := http.NewRequest(http.MethodPost, "/api/app/login/password", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(loginW, loginReq)
	assert.Equal(t, http.StatusOK, loginW.Code)
}

func TestLoginHandler_PhonePasswordRegisterAndLogin(t *testing.T) {
	_, userRepo := setupLoginTestDB(t)
	cfg := &config.Config{
		App: config.AppConfig{Env: "development"},
		JWT: config.JWTConfig{AccessTokenTTLSeconds: 3600, RefreshTokenTTLSeconds: 86400},
	}
	jwtSvc := service.NewJWTService("test-secret-key-for-testing-only-min-32-chars", 3600, 86400)
	h := NewLoginHandler(service.NewLoginService(cfg, userRepo, jwtSvc))
	r := setupLoginRouter(h)

	registerBody, _ := json.Marshal(map[string]string{"phone": "+86 138-0013-8000", "password": "password123"})
	registerW := httptest.NewRecorder()
	registerReq, _ := http.NewRequest(http.MethodPost, "/api/app/register/password", bytes.NewReader(registerBody))
	registerReq.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(registerW, registerReq)
	assert.Equal(t, http.StatusOK, registerW.Code)

	loginBody, _ := json.Marshal(map[string]string{"phone": "13800138000", "password": "password123"})
	loginW := httptest.NewRecorder()
	loginReq, _ := http.NewRequest(http.MethodPost, "/api/app/login/password", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(loginW, loginReq)
	assert.Equal(t, http.StatusOK, loginW.Code)
}
