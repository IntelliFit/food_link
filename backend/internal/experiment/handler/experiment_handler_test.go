package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/experiment/domain"
	"food_link/backend/internal/experiment/service"
	openplatformratelimit "food_link/backend/internal/openplatform/ratelimit"

	"github.com/gin-gonic/gin"
)

type fakeService struct {
	gotAssign service.AssignInput
	gotTrack  []service.EventInput
	gotUser   string
}

func (f *fakeService) Assignments(_ context.Context, in service.AssignInput) (map[string]domain.Served, error) {
	f.gotAssign = in
	return map[string]domain.Served{"onboarding_v2": {Variant: "pet_flow", Tracked: true}}, nil
}

func (f *fakeService) Expose(_ context.Context, _, userID string, keys []string) (int64, error) {
	f.gotUser = userID
	return int64(len(keys)), nil
}

func (f *fakeService) Track(_ context.Context, _, userID string, events []service.EventInput) (service.TrackResult, error) {
	f.gotUser, f.gotTrack = userID, events
	return service.TrackResult{Recorded: len(events)}, nil
}

func (f *fakeService) List(context.Context) ([]domain.Experiment, error) { return nil, nil }

func (f *fakeService) Save(_ context.Context, key string, _ service.SaveInput) (domain.Experiment, error) {
	return domain.Experiment{Key: key}, nil
}

func (f *fakeService) Summary(context.Context, string) ([]domain.VariantSummary, error) {
	return nil, nil
}

func newRouter(svc *fakeService, userID string) *gin.Engine {
	return newLimitedRouter(svc, userID, nil)
}

func newLimitedRouter(svc *fakeService, userID string, limiter openplatformratelimit.Limiter) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if userID != "" {
			c.Set(authmw.ContextUserIDKey, userID)
		}
	})
	h := NewExperimentHandler(svc)
	if limiter != nil {
		h.ConfigureRateLimiter(limiter)
	}
	r.POST("/api/experiments/assignments", h.Assignments)
	r.POST("/api/experiments/exposures", h.Exposures)
	r.POST("/api/app-events", h.Events)
	return r
}

func post(r *gin.Engine, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestAssignmentsPassesLoggedInUser(t *testing.T) {
	svc := &fakeService{}
	w := post(newRouter(svc, "user-1"), "/api/experiments/assignments", `{"anon_id":"anon_handler_1","platform":"ios","app_version":"4.7.0"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	if svc.gotAssign.UserID != "user-1" || svc.gotAssign.AnonID != "anon_handler_1" || svc.gotAssign.AppVersion != "4.7.0" {
		t.Fatalf("请求参数未正确传给服务: %+v", svc.gotAssign)
	}
	var body struct {
		Data struct {
			Assignments map[string]domain.Served `json:"assignments"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if got := body.Data.Assignments["onboarding_v2"]; got.Variant != "pet_flow" || !got.Tracked {
		t.Fatalf("分组结果未返回: %+v", body)
	}
}

func TestGuestRequestsHaveNoUser(t *testing.T) {
	svc := &fakeService{}
	r := newRouter(svc, "")
	if w := post(r, "/api/app-events", `{"anon_id":"anon_handler_2","events":[{"name":"welcome_view","client_ts":1}]}`); w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	if svc.gotUser != "" || len(svc.gotTrack) != 1 || svc.gotTrack[0].Name != "welcome_view" {
		t.Fatalf("游客事件解析错误: user=%q events=%+v", svc.gotUser, svc.gotTrack)
	}
	if w := post(r, "/api/experiments/exposures", `not json`); w.Code != http.StatusBadRequest {
		t.Fatalf("非法请求体应返回 400, got %d", w.Code)
	}
}

func TestOversizedBodyIsRejected(t *testing.T) {
	svc := &fakeService{}
	body := `{"anon_id":"anon_handler_3","platform":"` + strings.Repeat("x", smallBodyLimit) + `"}`
	if w := post(newRouter(svc, ""), "/api/experiments/assignments", body); w.Code != http.StatusBadRequest {
		t.Fatalf("超过上限的请求体应返回 400, got %d", w.Code)
	}
	if svc.gotAssign.AnonID != "" {
		t.Fatal("超限请求不应进入服务层")
	}
}

func TestPerInstallRateLimit(t *testing.T) {
	svc := &fakeService{}
	r := newLimitedRouter(svc, "", openplatformratelimit.NewMemoryLimiter())
	body := `{"anon_id":"anon_handler_4","keys":["onboarding_v2"]}`
	for i := 0; i < perInstallLimit; i++ {
		if w := post(r, "/api/experiments/exposures", body); w.Code != http.StatusOK {
			t.Fatalf("第 %d 次请求不应被限流, got %d", i+1, w.Code)
		}
	}
	if w := post(r, "/api/experiments/exposures", body); w.Code != http.StatusTooManyRequests {
		t.Fatalf("超过单设备上限应返回 429, got %d", w.Code)
	}
	if w := post(r, "/api/experiments/exposures", `{"anon_id":"anon_handler_5","keys":["onboarding_v2"]}`); w.Code != http.StatusOK {
		t.Fatalf("别的设备不应受影响, got %d", w.Code)
	}
}
