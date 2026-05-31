package repo

import (
	"context"
	"os"
	"testing"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"github.com/stretchr/testify/require"
)

func TestPackagedFoodSearchIntegrationCiciOrange(t *testing.T) {
	if os.Getenv("FOOD_LINK_PACKAGED_SEARCH_INTEGRATION") != "1" {
		t.Skip("set FOOD_LINK_PACKAGED_SEARCH_INTEGRATION=1 to query the configured packaged_food_library")
	}
	cfg, err := config.Load("../../..")
	require.NoError(t, err)
	db, err := database.Open(cfg.Database)
	require.NoError(t, err)
	repo := NewFoodNutritionRepo(db)

	rows, err := repo.SearchPackagedFood(context.Background(), "喜之郎Cici果冻爽（橙味）", 5)
	require.NoError(t, err)
	for _, row := range rows {
		t.Logf("packaged candidate: id=%s brand=%s name=%s flavor=%s spec=%s weight=%.0fg", row.ID, row.Brand, row.ProductName, stringPtr(row.FlavorText), stringPtr(row.SpecText), row.NetWeightG)
	}
	require.NotEmpty(t, rows)
	require.Equal(t, "喜之郎", rows[0].Brand)
	require.Contains(t, normalizeFoodName(rows[0].ProductName+stringPtr(rows[0].FlavorText)), normalizeFoodName("橙"))
	require.InDelta(t, 258, rows[0].NetWeightG, 0.1)
}
