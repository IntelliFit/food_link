package handler

import (
	"context"
	"food_link/backend/internal/admin/domain"
	"food_link/backend/internal/admin/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

type analyticsAuthStub struct{ account *domain.AdminAccount }

func (s *analyticsAuthStub) Login(context.Context, string, string) (*service.LoginResult, error) {
	return &service.LoginResult{Account: s.account}, nil
}
func (s *analyticsAuthStub) GetActiveAccount(context.Context, string) (*domain.AdminAccount, error) {
	return s.account, nil
}
func TestAnalyticsRoleDeniesAllManagementRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, role := range []string{domain.RoleAdmin, domain.RoleAnalyticsViewer, "", "unknown"} {
		t.Run(role, func(t *testing.T) {
			account := &domain.AdminAccount{ID: "test", Role: role, PasswordHash: "hash"}
			h := NewAuthHandler(&analyticsAuthStub{account})
			r := gin.New()
			success := func(c *gin.Context) { c.Status(200) }
			r.GET("/api/admin/analytics", h.AdminAuth(), success)
			r.GET("/api/admin/feedback", h.AdminAuth(), success)
			r.POST("/api/admin/analytics", h.AdminAuth(), success)
			for _, tc := range []struct{ method, path string }{{"GET", "/api/admin/analytics"}, {"GET", "/api/admin/feedback"}, {"POST", "/api/admin/analytics"}} {
				req := httptest.NewRequest(tc.method, tc.path, nil)
				req.AddCookie(&http.Cookie{Name: adminSessionCookieName, Value: adminSessionToken(account)})
				w := httptest.NewRecorder()
				r.ServeHTTP(w, req)
				want := 403
				if role == domain.RoleAdmin || (role == domain.RoleAnalyticsViewer && tc.method == "GET" && tc.path == "/api/admin/analytics") {
					want = 200
				}
				require.Equal(t, want, w.Code, tc.path)
			}
			// A database role change applies even while the old session cookie remains valid.
			account.Role = domain.RoleAnalyticsViewer
			req := httptest.NewRequest("GET", "/api/admin/feedback", nil)
			req.AddCookie(&http.Cookie{Name: adminSessionCookieName, Value: adminSessionToken(account)})
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			require.Equal(t, 403, w.Code)
		})
	}
}
func TestAnalyticsRequiresSession(t *testing.T) {
	r := gin.New()
	r.GET("/api/admin/analytics", NewAuthHandler(&analyticsAuthStub{}).AdminAuth(), func(c *gin.Context) { c.Status(200) })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/api/admin/analytics", nil))
	require.Equal(t, 401, w.Code)
}
