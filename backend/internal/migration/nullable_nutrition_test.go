package migration

import (
	"context"
	"food_link/backend/internal/foodrecord/domain"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestMigrateNullableNutritionIsScopedIdempotentAndPreservesZero(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.FoodNutritionDO{}))
	for column := range domain.NutritionFields {
		require.NoError(t, db.Exec(`ALTER TABLE food_nutrition_library ALTER COLUMN "`+column+`" SET DEFAULT 0, ALTER COLUMN "`+column+`" SET NOT NULL`).Error)
	}
	require.NoError(t, db.Exec(`INSERT INTO food_nutrition_library (canonical_name,normalized_name) VALUES ('历史零值','old-zero')`).Error)
	for i := 0; i < 2; i++ {
		require.NoError(t, MigrateNullableNutrition(context.Background(), db, "public"))
	}
	var count int64
	require.NoError(t, db.Raw(`SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='food_nutrition_library' AND column_name LIKE '%per_100g' AND is_nullable='YES' AND column_default IS NULL`).Scan(&count).Error)
	require.Equal(t, int64(25), count)
	var old *float64
	require.NoError(t, db.Raw(`SELECT sugar_per_100g FROM food_nutrition_library WHERE normalized_name='old-zero'`).Scan(&old).Error)
	require.NotNil(t, old)
	require.Equal(t, 0.0, *old)
	require.NoError(t, db.Exec(`INSERT INTO food_nutrition_library (canonical_name,normalized_name) VALUES ('新未知','new-null')`).Error)
	var nulls int64
	require.NoError(t, db.Raw(`SELECT count(*) FROM food_nutrition_library WHERE normalized_name='new-null' AND sugar_per_100g IS NULL`).Scan(&nulls).Error)
	require.Equal(t, int64(1), nulls)
	require.Error(t, MigrateNullableNutrition(context.Background(), db, `public;drop schema public`))
}
