package repo

import (
	"context"
	"testing"

	"food_link/backend/internal/foodrecord/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupFoodNutritionTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	db.Exec(`CREATE TABLE food_nutrition_library (
		id TEXT PRIMARY KEY,
		canonical_name TEXT,
		kcal_per_100g REAL,
		protein_per_100g REAL,
		carbs_per_100g REAL,
		fat_per_100g REAL,
		fiber_per_100g REAL,
		sugar_per_100g REAL,
		sodium_mg_per_100g REAL,
		is_active BOOLEAN
	)`)
	db.Exec(`CREATE TABLE food_nutrition_aliases (
		id TEXT PRIMARY KEY,
		food_id TEXT,
		alias_name TEXT
	)`)
	db.Exec(`CREATE TABLE food_unresolved_logs (
		id TEXT PRIMARY KEY,
		raw_name TEXT,
		normalized_name TEXT,
		hit_count INTEGER
	)`)
	return db
}

func TestFoodNutritionRepo_Search(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	// Insert test data
	db.Exec(`INSERT INTO food_nutrition_library (id, canonical_name, kcal_per_100g, is_active) VALUES (?, ?, ?, ?)`,
		"food-1", "Apple", 52, true)

	results, err := repo.Search(ctx, "apple", 5)
	require.NoError(t, err)
	assert.NotNil(t, results)
}

func TestFoodNutritionRepo_Search_DefaultLimit(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	results, err := repo.Search(ctx, "test", 0)
	require.NoError(t, err)
	assert.NotNil(t, results)
}

func TestFoodNutritionRepo_GetUnresolvedTop(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	// Insert test data
	db.Exec(`INSERT INTO food_unresolved_logs (id, raw_name, normalized_name, hit_count) VALUES (?, ?, ?, ?)`,
		"log-1", "Unknown Food", "unknownfood", 10)

	results, err := repo.GetUnresolvedTop(ctx, 10)
	require.NoError(t, err)
	assert.NotNil(t, results)
}

func TestFoodNutritionRepo_GetUnresolvedTop_DefaultLimit(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	results, err := repo.GetUnresolvedTop(ctx, 0)
	require.NoError(t, err)
	assert.NotNil(t, results)
}

func TestFoodNutritionRepo_LogUnresolved_New(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	err := repo.LogUnresolved(ctx, "New Food Item")
	require.NoError(t, err)

	var count int64
	db.Model(&domain.FoodUnresolvedLog{}).Count(&count)
	assert.Equal(t, int64(1), count)
}

func TestFoodNutritionRepo_LogUnresolved_Existing(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	// Insert existing
	db.Exec(`INSERT INTO food_unresolved_logs (id, raw_name, normalized_name, hit_count) VALUES (?, ?, ?, ?)`,
		"log-1", "New Food Item", "newfooditem", 5)

	err := repo.LogUnresolved(ctx, "New Food Item")
	require.NoError(t, err)

	var hitCount int
	db.Raw("SELECT hit_count FROM food_unresolved_logs WHERE id = ?", "log-1").Scan(&hitCount)
	assert.Equal(t, 6, hitCount)
}

func TestFoodNutritionRepo_LogUnresolved_Empty(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	err := repo.LogUnresolved(ctx, "")
	require.NoError(t, err)
}

func TestNormalizeUnresolvedName(t *testing.T) {
	assert.Equal(t, "apple", normalizeUnresolvedName("Apple"))
	assert.Equal(t, "applepie", normalizeUnresolvedName("  Apple Pie  "))
	assert.Equal(t, "", normalizeUnresolvedName(""))
	assert.Equal(t, "food123", normalizeUnresolvedName("Food 123"))
}
