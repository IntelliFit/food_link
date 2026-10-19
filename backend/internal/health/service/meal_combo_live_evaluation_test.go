package service

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"github.com/stretchr/testify/require"
)

// Read-only menu evaluation: published campus menus only, no user data, no model
// calls and no writes (the whole run is a read-only transaction). It answers
// "does server-side assembly find real same-canteen meals on the real catalogue?"
//
//	FOODLINK_EVAL_MENUS=1 go test ./internal/health/service -run TestMealEvalCombosOnRealMenus -v
//
// FOODLINK_EVAL_SCHOOLS (default 2) and FOODLINK_EVAL_CANTEENS (default 3) bound
// the scan, which pages through the remote catalogue.
func TestMealEvalCombosOnRealMenus(t *testing.T) {
	if os.Getenv("FOODLINK_EVAL_MENUS") != "1" {
		t.Skip("explicit opt-in: read-only published-menu evaluation")
	}
	cfg, err := config.Load("../../..")
	require.NoError(t, err)
	db, err := database.Open(cfg.Database)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	defer sqlDB.Close()
	tx := mealEvalReadOnly(t, db, cfg.Database.Schema)

	schoolLimit, canteenLimit := mealEvalIntEnv("FOODLINK_EVAL_SCHOOLS", 2), mealEvalIntEnv("FOODLINK_EVAL_CANTEENS", 3)
	var schools []struct {
		ID    string
		Name  string
		Items int64
	}
	require.NoError(t, tx.Raw(`SELECT CAST(school_id AS TEXT) AS id, MAX(school_name) AS name, COUNT(*) AS items
		FROM public_food_library WHERE status='published' AND COALESCE(is_campus_food,false)=true AND school_id IS NOT NULL
		GROUP BY school_id ORDER BY COUNT(*) DESC LIMIT ?`, schoolLimit).Scan(&schools).Error)
	require.NotEmpty(t, schools)

	type comboRow struct {
		Title    string   `json:"title"`
		Price    float64  `json:"price"`
		Calories float64  `json:"kcal"`
		Protein  float64  `json:"protein"`
		Fit      float64  `json:"health_fit"`
		Buy      []string `json:"buy_at"`
		Single   bool     `json:"single_meal,omitempty"`
	}
	type mealReport struct {
		MealType string     `json:"meal_type"`
		Scored   int        `json:"assemblies_scored"`
		Reason   string     `json:"reason,omitempty"`
		Combos   []comboRow `json:"combos"`
		Millis   int64      `json:"elapsed_ms"`
	}
	type canteenReport struct {
		School        string              `json:"school"`
		Canteen       string              `json:"canteen"`
		MenuItems     int                 `json:"menu_items"`
		PricedServing int                 `json:"priced_serving_items"`
		RoleCounts    map[string]int      `json:"role_counts_of_priced_items"`
		RoleSamples   map[string][]string `json:"role_samples"`
		Meals         []mealReport        `json:"meals"`
	}
	var reports []canteenReport
	for _, school := range schools {
		var canteens []struct {
			Name   string
			Items  int64
			Priced int64
		}
		require.NoError(t, tx.Raw(`SELECT canteen_name AS name, COUNT(*) AS items, COUNT(*) FILTER (WHERE price > 0) AS priced
			FROM public_food_library WHERE status='published' AND COALESCE(is_campus_food,false)=true AND CAST(school_id AS TEXT)=? AND COALESCE(canteen_name,'')<>''
			GROUP BY canteen_name ORDER BY COUNT(*) FILTER (WHERE price > 0) DESC, COUNT(*) DESC LIMIT ?`, school.ID, canteenLimit).Scan(&canteens).Error)
		for _, canteen := range canteens {
			var rows []struct {
				ID, Title, Description, CanteenID, CanteenName, WindowID, WindowName, Floor, PriceUnit string
				Calories, Protein, Carbs, Fat, Price                                                   float64
			}
			// One lean query per canteen: the paged catalogue scan is far too slow over this link.
			require.NoError(t, tx.Raw(`SELECT CAST(id AS TEXT) AS id, COALESCE(NULLIF(food_name,''), NULLIF(description,''), '校园餐') AS title,
				COALESCE(description,'') AS description, COALESCE(total_calories,0) AS calories, COALESCE(total_protein,0) AS protein, COALESCE(total_carbs,0) AS carbs, COALESCE(total_fat,0) AS fat,
				COALESCE(CAST(canteen_id AS TEXT),'') AS canteen_id, COALESCE(canteen_name,'') AS canteen_name, COALESCE(CAST(window_id AS TEXT),'') AS window_id,
				COALESCE(window_name,'') AS window_name, COALESCE(floor,'') AS floor, COALESCE(price,0) AS price, COALESCE(price_unit,'') AS price_unit
				FROM public_food_library WHERE status='published' AND COALESCE(is_campus_food,false)=true AND CAST(school_id AS TEXT)=? AND canteen_name=?
				AND COALESCE(food_name,'') !~* '(餐盒|打包盒|包装盒|纸袋|塑料袋|餐具|筷子|勺子|吸管|杯盖|餐巾)' ORDER BY id LIMIT 2000`, school.ID, canteen.Name).Scan(&rows).Error)
			state := newComboTestState()
			state.School = domain.DietRecommendationSchool{ID: school.ID, Name: school.Name}
			pool := make([]DietRecommendationCandidate, 0, len(rows))
			for _, r := range rows {
				pool = append(pool, DietRecommendationCandidate{
					Source: "public_food_library", SourceID: r.ID, Title: r.Title, Description: r.Description, Calories: r.Calories, Protein: r.Protein, Carbs: r.Carbs, Fat: r.Fat,
					IsCampusFood: true, SchoolID: school.ID, SchoolName: school.Name, CanteenID: r.CanteenID, CanteenName: r.CanteenName, WindowID: r.WindowID, WindowName: r.WindowName,
					Floor: r.Floor, Price: r.Price, PriceUnit: r.PriceUnit, NutritionBasis: "library_record",
					Items: []DietRecommendationFoodItem{{Name: r.Title, Amount: "1份", Source: "public_food_library", SourceID: r.ID}},
				})
			}

			report := canteenReport{School: school.Name, Canteen: canteen.Name, MenuItems: len(pool), RoleCounts: map[string]int{}, RoleSamples: map[string][]string{}}
			for _, c := range pool {
				if !mealKnownServing(c) || c.Calories <= 0 {
					continue
				}
				report.PricedServing++
				role := string(mealComboRoleOf(c))
				report.RoleCounts[role]++
				if len(report.RoleSamples[role]) < 14 {
					report.RoleSamples[role] = append(report.RoleSamples[role], c.Title)
				}
			}
			for _, mealType := range []string{"breakfast", "lunch", "dinner"} {
				state := newComboTestState()
				state.School = domain.DietRecommendationSchool{ID: school.ID, Name: school.Name}
				state.Constraints.MealType = mealType
				state.MealContext.MealType = mealType
				started := time.Now()
				found := searchMealOptions(state, pool, 6, true)
				meal := mealReport{MealType: mealType, Scored: found.Considered, Reason: found.Reason, Millis: time.Since(started).Milliseconds()}
				for _, combo := range found.Combos {
					meal.Combos = append(meal.Combos, comboRow{Title: combo.Plan.Title, Price: combo.Plan.Price, Calories: combo.Plan.Calories, Protein: combo.Plan.Protein, Fit: combo.HealthFit, Buy: combo.Windows, Single: combo.Single})
				}
				report.Meals = append(report.Meals, meal)
			}
			reports = append(reports, report)
		}
	}
	raw, err := json.MarshalIndent(reports, "", " ")
	require.NoError(t, err)
	t.Logf("EVAL_COMBOS=%s", strings.TrimSpace(string(raw)))
}

func mealEvalIntEnv(name string, fallback int) int {
	value := 0
	for _, r := range os.Getenv(name) {
		if r < '0' || r > '9' {
			return fallback
		}
		value = value*10 + int(r-'0')
	}
	if value <= 0 {
		return fallback
	}
	return value
}
