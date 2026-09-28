package repo

import (
	"context"
	"testing"

	healthdomain "food_link/backend/internal/health/domain"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPetRepo_SumEditableWaterByDateExcludesDerivedFoodWater(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`
		CREATE TABLE user_water_logs (
			id text PRIMARY KEY,
			user_id text NOT NULL,
			recorded_on date NOT NULL,
			amount_ml integer NOT NULL,
			source_type text NOT NULL
		)
	`).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO user_water_logs (id, user_id, recorded_on, amount_ml, source_type) VALUES
			('manual', 'user-1', DATE '2026-09-28', 300, ?),
			('imported', 'user-1', DATE '2026-09-28', 200, ?),
			('legacy-food', 'user-1', DATE '2026-09-28', 450, ?),
			('food-cache', 'user-1', DATE '2026-09-28', 550, ?),
			('other-day', 'user-1', DATE '2026-09-27', 999, ?),
			('other-user', 'user-2', DATE '2026-09-28', 999, ?)
	`,
		healthdomain.ManualWaterSourceType,
		healthdomain.ImportedWaterSourceType,
		healthdomain.LegacyFoodWaterSourceType,
		healthdomain.FoodRecordWaterSourcePrefix+"record-1",
		healthdomain.ManualWaterSourceType,
		healthdomain.ManualWaterSourceType,
	).Error)

	total, err := NewPetRepo(db).SumEditableWaterByDate(context.Background(), "user-1", "2026-09-28")

	require.NoError(t, err)
	assert.Equal(t, 500, total)
}
