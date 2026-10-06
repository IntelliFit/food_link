package service

import (
	"context"
	"errors"
	"food_link/backend/internal/admin/domain"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"testing"
	"time"
)

type analyticsRepoStub struct {
	calls int
	fail  bool
	rows  map[string]domain.AnalyticsDay
}

func (r *analyticsRepoStub) StartedAt(context.Context) (time.Time, error) {
	if r.fail {
		return time.Time{}, errors.New("database unavailable")
	}
	return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), nil
}
func (r *analyticsRepoStub) Record(context.Context, string, time.Time) error { return nil }
func (r *analyticsRepoStub) ComputeDay(_ context.Context, d, _, now time.Time) (domain.AnalyticsDay, error) {
	r.calls++
	return domain.AnalyticsDay{Day: d.Format("2006-01-02"), UpdatedAt: now}, nil
}
func (r *analyticsRepoStub) SaveDay(_ context.Context, d domain.AnalyticsDay) error {
	r.rows[d.Day] = d
	return nil
}
func (r *analyticsRepoStub) Days(context.Context, time.Time, time.Time) ([]domain.AnalyticsDay, error) {
	return []domain.AnalyticsDay{}, nil
}
func (r *analyticsRepoStub) PayingUsers(context.Context, time.Time, time.Time) (int64, error) {
	return 2, nil
}
func (r *analyticsRepoStub) ActivePaidMembers(context.Context, time.Time) (int64, error) {
	return 1, nil
}
func TestAnalyticsCacheExpirationAndMidnight(t *testing.T) {
	r := &analyticsRepoStub{rows: map[string]domain.AnalyticsDay{}}
	s := NewAnalyticsService(r)
	now := time.Date(2026, 10, 6, 15, 58, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	first, err := s.Overview(context.Background(), 7)
	require.NoError(t, err)
	require.Equal(t, "2026-10-06", first.Today.Day)
	calls := r.calls
	_, err = s.Overview(context.Background(), 7)
	require.NoError(t, err)
	require.Equal(t, calls, r.calls)
	now = now.Add(3 * time.Minute)
	next, err := s.Overview(context.Background(), 7)
	require.NoError(t, err)
	require.Equal(t, "2026-10-07", next.Today.Day)
	require.Greater(t, r.calls, calls)
	calls = r.calls
	now = now.Add(6 * time.Minute)
	_, err = s.Overview(context.Background(), 7)
	require.NoError(t, err)
	require.Greater(t, r.calls, calls)
	_, err = s.Overview(context.Background(), 365)
	require.Error(t, err)
}
func TestAnalyticsDoesNotCacheFailedQueries(t *testing.T) {
	r := &analyticsRepoStub{fail: true, rows: map[string]domain.AnalyticsDay{}}
	s := NewAnalyticsService(r)
	_, err := s.Overview(context.Background(), 7)
	require.Error(t, err)
	require.Empty(t, s.cache)
	r.fail = false
	_, err = s.Overview(context.Background(), 7)
	require.NoError(t, err)
}
func TestAnalyticsMiddlewareNeverChangesBusinessResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		path, id string
		status   int
		tracked  bool
	}{{"/api/home/dashboard", "u", 200, true}, {"/api/home/dashboard", "u", 500, false}, {"/api/home/dashboard", "", 200, false}, {"/api/analyze/tasks/:id", "u", 200, false}, {"/api/messages/unread-count", "u", 200, false}} {
		s := NewAnalyticsService(nil)
		r := gin.New()
		r.Use(s.Middleware())
		r.GET(tc.path, func(c *gin.Context) { c.Set("user_id", tc.id); c.String(tc.status, "unchanged") })
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
		require.Equal(t, tc.status, w.Code)
		require.Equal(t, "unchanged", w.Body.String())
		require.Equal(t, tc.tracked, len(s.queue) > 0)
	}
	// Backpressure must not delay or fail a user's request.
	s := NewAnalyticsService(nil)
	for len(s.queue) < cap(s.queue) {
		s.queue <- analyticsUse{}
	}
	r := gin.New()
	r.Use(s.Middleware())
	r.GET("/api/home/dashboard", func(c *gin.Context) { c.Set("user_id", "u"); c.String(200, "unchanged") })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/api/home/dashboard", nil))
	require.Equal(t, 200, w.Code)
}
