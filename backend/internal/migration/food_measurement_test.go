package migration

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFoodMeasurementMigrationIsAdditiveAndRepeatable(t *testing.T) {
	db := testdb.New(t)
	t.Cleanup(func() { require.NoError(t, testdb.Stop()) })
	require.NoError(t, db.Exec(`CREATE TABLE user_custom_foods (id text PRIMARY KEY, default_weight_grams numeric NOT NULL, nutrients_per_100g jsonb NOT NULL); INSERT INTO user_custom_foods VALUES ('legacy-g', 150, '{"calories":80}')`).Error)
	ctx := context.Background()
	before, err := InspectFoodMeasurements(ctx, db, "public")
	require.NoError(t, err)
	assert.False(t, before.ColumnExists)
	for i := 0; i < 2; i++ {
		after, migrateErr := MigrateFoodMeasurements(ctx, db, "public")
		require.NoError(t, migrateErr)
		assert.True(t, after.ColumnExists)
		assert.Equal(t, "jsonb", after.ColumnType)
	}
	var row struct {
		Weight          float64
		Calories        float64
		MeasurementNull bool
	}
	require.NoError(t, db.Raw(`SELECT default_weight_grams AS weight, (nutrients_per_100g->>'calories')::float8 AS calories, measurement IS NULL AS measurement_null FROM user_custom_foods WHERE id='legacy-g'`).Scan(&row).Error)
	assert.Equal(t, 150.0, row.Weight)
	assert.Equal(t, 80.0, row.Calories)
	assert.True(t, row.MeasurementNull)
}
