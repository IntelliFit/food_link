package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/community/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func (m *mockCommunityService) FoodContributionLeaderboard(_ context.Context, _, period string) (*service.ContributionLeaderboardResult, error) {
	return &service.ContributionLeaderboardResult{Period: period, List: []service.ContributionLeaderboardItem{}}, nil
}

type contributionServiceSpy struct {
	mockCommunityService
	viewer, period string
}

func (s *contributionServiceSpy) FoodContributionLeaderboard(_ context.Context, viewer, period string) (*service.ContributionLeaderboardResult, error) {
	s.viewer, s.period = viewer, period
	return &service.ContributionLeaderboardResult{Period: period, List: []service.ContributionLeaderboardItem{{UserID: viewer, ContributionCount: 3, IsMe: true}}}, nil
}

func TestFoodContributionLeaderboardHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, query := range []string{"", "?period=all"} {
		svc := &contributionServiceSpy{}
		router := gin.New()
		router.Use(func(c *gin.Context) { c.Set(authmw.ContextUserIDKey, "viewer") })
		router.GET("/ranking", NewCommunityHandler(svc).FoodContributionLeaderboard)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/ranking"+query, nil))
		require.Equal(t, http.StatusOK, w.Code)
		require.Equal(t, "viewer", svc.viewer)
		if query == "" {
			require.Equal(t, "month", svc.period)
		} else {
			require.Equal(t, "all", svc.period)
		}
		require.Contains(t, w.Body.String(), `"contribution_count":3`)
	}
}
