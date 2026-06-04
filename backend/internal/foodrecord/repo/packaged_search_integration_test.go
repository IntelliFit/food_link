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

func TestPackagedFoodSearchIntegrationSuntorySugarfreeDrink(t *testing.T) {
	if os.Getenv("FOOD_LINK_PACKAGED_SEARCH_INTEGRATION") != "1" {
		t.Skip("set FOOD_LINK_PACKAGED_SEARCH_INTEGRATION=1 to query the configured packaged_food_library")
	}
	cfg, err := config.Load("../../..")
	require.NoError(t, err)
	db, err := database.Open(cfg.Database)
	require.NoError(t, err)
	repo := NewFoodNutritionRepo(db)

	rows, err := repo.SearchPackagedFood(context.Background(), "SUNTORY三得利纤漾饮荷叶茉莉花味风味饮料（无糖）", 5)
	require.NoError(t, err)
	for _, row := range rows {
		t.Logf("packaged candidate: id=%s brand=%s name=%s spec=%s weight=%.0fg net_content=%.0f%s kcal=%.2f protein=%.2f carbs=%.2f fat=%.2f", row.ID, row.Brand, row.ProductName, stringPtr(row.SpecText), row.NetWeightG, row.NetContentValue, stringPtr(row.NetContentUnit), row.KcalPer100g, row.ProteinPer100g, row.CarbsPer100g, row.FatPer100g)
	}
	require.NotEmpty(t, rows)
	top := rows[0]
	require.Contains(t, normalizeFoodName(top.Brand+top.ProductName+top.DisplayName), normalizeFoodName("三得利"))
	require.Contains(t, normalizeFoodName(top.ProductName+top.DisplayName), normalizeFoodName("纤漾饮"))
	require.InDelta(t, 500, top.NetContentValue, 0.1)
	require.Equal(t, "ml", stringPtr(top.NetContentUnit))
	require.InDelta(t, 18, top.KcalPer100g, 0.1)
	require.Zero(t, top.ProteinPer100g)
	require.Zero(t, top.CarbsPer100g)
	require.Zero(t, top.FatPer100g)
}
