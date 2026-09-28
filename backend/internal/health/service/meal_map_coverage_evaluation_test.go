package service

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	publicrepo "food_link/backend/internal/publicfood/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"github.com/stretchr/testify/require"
)

// Read-only data coverage companion; no extra model calls or user sampling.
func TestMealEvalMapDataCoverage(t *testing.T) {
	if os.Getenv("FOODLINK_EVAL_REAL_USERS") != "1" {
		t.Skip("explicit opt-in")
	}
	cfg, err := config.Load("../../..")
	require.NoError(t, err)
	db, err := database.Open(cfg.Database)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	defer sqlDB.Close()
	tx := mealEvalReadOnly(t, db, cfg.Database.Schema)
	var groups []struct {
		Type         string
		IsCampusFood bool
		Rows         int64
		KnownPrice   int64
		SchoolLinked int64
	}
	require.NoError(t, tx.Raw(`SELECT type,COALESCE(is_campus_food,false) AS is_campus_food,COUNT(*) AS rows,
		COUNT(*) FILTER(WHERE price>0) AS known_price,COUNT(*) FILTER(WHERE school_id IS NOT NULL OR campus_id IS NOT NULL OR canteen_id IS NOT NULL) AS school_linked
		FROM public_food_library WHERE status='published' AND COALESCE(merchant_name,'')<>''
		GROUP BY type,COALESCE(is_campus_food,false) ORDER BY COUNT(*) DESC`).Scan(&groups).Error)
	candidates, err := publicrepo.NewPublicFoodRepo(tx).ListPublishedMapCandidates(context.Background(), "")
	require.NoError(t, err)
	type merchant struct {
		Name                   string
		Food                   string
		Type                   string
		IsCampus               bool
		HasDirectCoordinate    bool
		HasDirectoryCoordinate bool
	}
	var merchants []merchant
	for _, c := range candidates {
		if c.MerchantName != "" && !c.IsCampusFood {
			merchants = append(merchants, merchant{Name: c.MerchantName, Food: c.FoodName, Type: c.Type, IsCampus: c.IsCampusFood,
				HasDirectCoordinate:    c.DirectLatitude != nil && c.DirectLongitude != nil,
				HasDirectoryCoordinate: c.DirectoryCanteenID != "" || c.DirectoryCampusID != "" || c.DirectorySchoolID != ""})
		}
	}
	raw, err := json.Marshal(map[string]any{"merchant_record_groups": groups, "map_candidate_count": len(candidates), "noncampus_flag_merchant_map_records": merchants})
	require.NoError(t, err)
	t.Logf("EVAL_MAP_COVERAGE=%s", raw)
}
