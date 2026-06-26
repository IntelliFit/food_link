package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	fooddomain "food_link/backend/internal/foodrecord/domain"
	publicdomain "food_link/backend/internal/publicfood/domain"
	utilitydomain "food_link/backend/internal/utility/domain"
	utilityrepo "food_link/backend/internal/utility/repo"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupUtilityTestDB(t *testing.T) (*gorm.DB, *utilityrepo.ManualFoodRepo) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(
		&fooddomain.FoodNutrition{},
		&fooddomain.FoodNutritionAlias{},
		&fooddomain.PackagedFood{},
		&publicdomain.PublicFoodItem{},
		&publicdomain.PublicFoodCollection{},
		&utilitydomain.UserCustomFood{},
	))
	require.NoError(t, db.Exec(`
		CREATE TABLE user_food_records (
			id TEXT PRIMARY KEY,
			user_id TEXT,
			items JSONB,
			record_time TIMESTAMPTZ
		)
	`).Error)
	require.NoError(t, db.Exec(`
		ALTER TABLE public_food_library ALTER COLUMN items TYPE jsonb USING items::jsonb
	`).Error)
	require.NoError(t, db.Exec(`
		ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()
	`).Error)
	return db, utilityrepo.NewManualFoodRepo(db)
}

func TestManualFoodService_Browse(t *testing.T) {
	db, foodRepo := setupUtilityTestDB(t)
	svc := NewManualFoodService(foodRepo)
	ctx := context.Background()

	require.NoError(t, db.Create(&fooddomain.FoodNutrition{
		ID:             "n1",
		CanonicalName:  "香蕉",
		NormalizedName: "香蕉",
		KcalPer100g:    89,
		ProteinPer100g: 1.1,
		CarbsPer100g:   22.8,
		FatPer100g:     0.3,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&publicdomain.PublicFoodItem{
		ID:            "p1",
		UserID:        "u2",
		FoodName:      "香蕉燕麦杯",
		TotalCalories: 260,
		TotalProtein:  9,
		TotalCarbs:    44,
		TotalFat:      6,
		Status:        "published",
	}).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO user_food_records (id, user_id, items, record_time) VALUES
		('r1', 'u1', '[{"name":"香蕉","manual_source":"nutrition_library","manual_source_id":"n1","manual_source_title":"香蕉","manual_portion_label":"100g","intake":100,"nutrients":{"calories":89,"protein":1.1,"carbs":22.8,"fat":0.3}}]', CURRENT_TIMESTAMP)
	`).Error)

	items, err := svc.Browse(ctx, "u1", 0)
	require.NoError(t, err)
	require.NotNil(t, items)
	assert.Len(t, items.RecentItems, 1)
	assert.Len(t, items.NutritionLibrary, 1)
	assert.Len(t, items.PublicLibrary, 1)
}

func TestManualFoodService_Search(t *testing.T) {
	db, foodRepo := setupUtilityTestDB(t)
	svc := NewManualFoodService(foodRepo)
	ctx := context.Background()

	require.NoError(t, db.Create(&fooddomain.FoodNutrition{
		ID:             "n1",
		CanonicalName:  "苹果",
		NormalizedName: "苹果",
		KcalPer100g:    52,
		ProteinPer100g: 0.3,
		CarbsPer100g:   14,
		FatPer100g:     0.2,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&publicdomain.PublicFoodItem{
		ID:            "p1",
		UserID:        "u2",
		FoodName:      "苹果酸奶杯",
		TotalCalories: 220,
		TotalProtein:  8,
		TotalCarbs:    36,
		TotalFat:      4,
		Status:        "published",
	}).Error)

	items, err := svc.Search(ctx, "u1", "苹果", 0)
	require.NoError(t, err)
	assert.Len(t, items, 2)
}

func TestQRCodeService_GenerateQRCode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cgi-bin/stable_token":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"fake-token","expires_in":7200}`))
		case "/wxa/getwxacodeunlimit":
			assert.Equal(t, "fake-token", r.URL.Query().Get("access_token"))
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = w.Write([]byte("jpeg-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := &QRCodeService{
		appID:          "appid",
		secret:         "secret",
		client:         server.Client(),
		stableTokenURL: server.URL + "/cgi-bin/stable_token",
		tokenURL:       server.URL + "/cgi-bin/token",
		qrCodeURL:      server.URL + "/wxa/getwxacodeunlimit",
	}
	ctx := context.Background()

	b64, err := svc.GenerateQRCode(ctx, "scene=123", "pages/index", 430, false, "release")
	require.NoError(t, err)
	assert.Contains(t, b64, "data:image/jpeg;base64,")
}
