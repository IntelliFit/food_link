package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/onboarding/domain"
	"food_link/backend/internal/onboarding/service"
	openplatformratelimit "food_link/backend/internal/openplatform/ratelimit"

	"github.com/gin-gonic/gin"
)

type fakeService struct {
	tries     int
	tryUser   string
	savedBy   string
	savedText string
}

func (f *fakeService) Config(context.Context) (domain.Config, error) {
	return domain.DefaultConfig(), nil
}
func (f *fakeService) PublicConfig(context.Context) domain.PublicConfig {
	return domain.DefaultConfig().Public()
}
func (f *fakeService) SaveConfig(_ context.Context, in domain.Config, by string) (service.SaveResult, error) {
	f.savedBy = by
	if len(in.Badges) > 0 {
		f.savedText = in.Badges[0].Text
	}
	return service.SaveResult{Config: in}, nil
}
func (f *fakeService) Stats(context.Context) (domain.Stats, error) {
	return domain.Stats{Users: 1}, nil
}
func (f *fakeService) Try(_ context.Context, userID string, _ service.TryInput) (map[string]any, error) {
	f.tries++
	f.tryUser = userID
	return map[string]any{"items": []any{}}, nil
}

func router(svc *fakeService, userID string, limiter openplatformratelimit.Limiter) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if userID != "" {
			c.Set(authmw.ContextUserIDKey, userID)
		}
		c.Set("admin_username", "ops")
	})
	h := NewOnboardingHandler(svc)
	if limiter != nil {
		h.ConfigureRateLimiter(limiter)
	}
	r.GET("/config", h.PublicConfig)
	r.GET("/stats", h.Stats)
	r.POST("/try", h.Try)
	r.PUT("/admin/config", h.AdminSaveConfig)
	return r
}

func do(r *gin.Engine, method, path, body string) int {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w.Code
}

func TestGuestTryIsRateLimitedPerIP(t *testing.T) {
	svc := &fakeService{}
	r := router(svc, "", openplatformratelimit.NewMemoryLimiter())
	body := `{"anon_id":"anon_handler_1","base64Image":"aGVsbG8="}`
	for i := 0; i < tryPerIPLimit; i++ {
		if code := do(r, http.MethodPost, "/try", body); code != http.StatusOK {
			t.Fatalf("第 %d 次不应被限流: %d", i+1, code)
		}
	}
	if code := do(r, http.MethodPost, "/try", body); code != http.StatusTooManyRequests {
		t.Fatalf("超过每小时上限应返回 429, got %d", code)
	}
	if svc.tries != tryPerIPLimit {
		t.Fatalf("被限流的请求不应进服务层: %d", svc.tries)
	}
}

func TestLoggedInTrySkipsIPLimitAndPassesUser(t *testing.T) {
	svc := &fakeService{}
	r := router(svc, "user-1", openplatformratelimit.NewMemoryLimiter())
	for i := 0; i < tryPerIPLimit+2; i++ {
		if code := do(r, http.MethodPost, "/try", `{"anon_id":"anon_handler_2","base64Image":"aGVsbG8="}`); code != http.StatusOK {
			t.Fatalf("已登录不应被 IP 限流: %d", code)
		}
	}
	if svc.tryUser != "user-1" {
		t.Fatalf("应传入登录用户: %q", svc.tryUser)
	}
}

func TestPublicEndpointsAndAdminSave(t *testing.T) {
	svc := &fakeService{}
	r := router(svc, "", nil)
	if do(r, http.MethodGet, "/config", "") != http.StatusOK || do(r, http.MethodGet, "/stats", "") != http.StatusOK {
		t.Fatal("公开接口应可访问")
	}
	if code := do(r, http.MethodPut, "/admin/config", `{"badges":[{"icon":"shield","text":"内测领先"}]}`); code != http.StatusOK {
		t.Fatalf("保存配置失败: %d", code)
	}
	if svc.savedBy != "ops" || svc.savedText != "内测领先" {
		t.Fatalf("应记录保存人和内容: %+v", svc)
	}
	if code := do(r, http.MethodPut, "/admin/config", `not json`); code != http.StatusBadRequest {
		t.Fatalf("非法请求体应返回 400: %d", code)
	}
	if code := do(r, http.MethodPost, "/try", `{"anon_id":"x","base64Image":"`+strings.Repeat("a", tryBodyLimit)+`"}`); code != http.StatusBadRequest {
		t.Fatalf("超大请求体应返回 400: %d", code)
	}
}
