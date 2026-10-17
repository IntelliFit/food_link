package handler

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"food_link/backend/internal/campuscatalog/domain"
	"food_link/backend/internal/campuscatalog/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type collectorProfileStub struct{ CommunityCatalogService }

func (collectorProfileStub) GetCollectorProfile(context.Context, string) (*service.CollectorProfile, error) {
	return &service.CollectorProfile{
		Applications: []domain.CollectorApplication{{ID: "campus-app", SchoolID: "school"}, {ID: "community-app", VenueType: "community"}},
		ActiveScopes: []domain.CollectorScope{{ID: "campus-scope", SchoolID: "school"}, {ID: "community-scope", VenueType: "community"}},
		CanBatch:     true,
	}, nil
}

func TestCollectorProfileKeepsLegacyCampusView(t *testing.T) {
	for _, tc := range []struct {
		path  string
		count int
	}{{"/profile", 1}, {"/profile?include_venues=1", 2}} {
		router := gin.New()
		router.GET("/profile", NewCommunityHandler(collectorProfileStub{}).CollectorProfile)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", tc.path, nil))
		require.Equal(t, 200, response.Code)
		var result struct {
			Data service.CollectorProfile `json:"data"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
		require.Len(t, result.Data.Applications, tc.count)
		require.Len(t, result.Data.ActiveScopes, tc.count)
		require.True(t, result.Data.CanBatch)
	}
}
