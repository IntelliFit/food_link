package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"food_link/backend/internal/foodmeasure"
	"food_link/backend/internal/utility/domain"
	"github.com/stretchr/testify/require"
)

func TestManualFoodVolumeClientCompatibility(t *testing.T) {
	for _, test := range []struct{ amount, kcal float64 }{{200, 33}, {250, 68.6}} {
		m := &foodmeasure.Measurement{Amount: test.amount, Unit: foodmeasure.Milliliter, BasisAmount: 100, BasisUnit: foodmeasure.Milliliter, NutrientsPerBasis: map[string]float64{"calories": test.kcal}}
		milk := domain.ManualFoodResult{ID: "milk", Source: "packaged_food", Title: "牛奶", DisplayUnit: "ml", PortionLabel: "牛奶", Measurement: m, TotalCalories: test.amount * test.kcal / 100}
		svc := &mockManualFoodService{
			searchItems: []domain.ManualFoodResult{milk}, searchPackagedItems: []domain.ManualFoodResult{milk},
			catalog:     &domain.ManualFoodCatalogResult{Items: []domain.ManualFoodResult{milk}},
			browseItems: &domain.ManualFoodBrowseResult{RecentItems: []domain.ManualFoodResult{milk}},
			customItems: []domain.ManualFoodResult{milk}, saveCustomItem: milk,
		}
		router := setupRouter(NewUtilityHandler(nil, nil, svc))
		for _, path := range []string{"/api/manual-food/search?q=milk", "/api/manual-food/search?q=milk&source=packaged_food", "/api/manual-food/catalog?category=common", "/api/manual-food/browse?limit=20", "/api/manual-food/custom?limit=20"} {
			for _, native := range []bool{false, true} {
				url := path
				if native {
					url += "&measurement_version=1"
				}
				w := httptest.NewRecorder()
				router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, url, nil))
				require.Equal(t, http.StatusOK, w.Code, path)
				var body struct{ Data map[string]json.RawMessage }
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
				var items []domain.ManualFoodResult
				for _, key := range []string{"results", "items", "recent_items"} {
					if raw := body.Data[key]; len(raw) > 0 {
						require.NoError(t, json.Unmarshal(raw, &items))
						break
					}
				}
				require.Len(t, items, 1, path)
				if native {
					require.Zero(t, items[0].DefaultWeightGrams)
				} else {
					require.Equal(t, test.amount, items[0].DefaultWeightGrams)
					// The actual old page formula must produce 400ml / 100ml correctly.
					require.InDelta(t, test.kcal*4, items[0].TotalCalories*400/items[0].DefaultWeightGrams, 1e-8)
				}
				require.Nil(t, items[0].NutrientsPer100g, "volume is not mass")
				require.Equal(t, test.amount, items[0].Measurement.Amount)
			}
		}
		require.Zero(t, svc.catalog.Items[0].DefaultWeightGrams, "response projection must not mutate the native model")
		require.Zero(t, svc.searchItems[0].DefaultWeightGrams)
	}
}
