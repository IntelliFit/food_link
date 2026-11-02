package migration

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
)

// The production table already exists with the first set of columns; the
// migration must add the tier, recommendation and price columns to it.
func TestMigrateMealDishAddsColumnsToTheExistingTable(t *testing.T) {
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, db.Exec(`CREATE TABLE meal_dish_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, analysis_task_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`).Error)
	require.NoError(t, db.Exec(`INSERT INTO meal_dish_prompts (user_id, analysis_task_id) VALUES (gen_random_uuid(), gen_random_uuid())`).Error)

	require.NoError(t, MigrateMealDish(ctx, db, "public"))
	require.NoError(t, MigrateMealDish(ctx, db, "public"))

	var cohort, kind string
	require.NoError(t, db.Raw(`SELECT cohort, price_answer_kind FROM meal_dish_prompts`).Row().Scan(&cohort, &kind))
	require.Equal(t, "regular", cohort, "existing rows default to the regular cohort")
	require.Equal(t, "", kind)

	insert := `INSERT INTO meal_dish_prompts (user_id, analysis_task_id, cohort, recommended_kind, price_answer_kind, price_answer)
VALUES (gen_random_uuid(), gen_random_uuid(), ?, ?, ?, 14.5)`
	require.NoError(t, db.Exec(insert, "active", "navigated", "changed").Error)
	require.Error(t, db.Exec(insert, "vip", "", "").Error, "unknown cohort")
	require.Error(t, db.Exec(insert, "regular", "clicked", "").Error, "unknown recommendation kind")
	require.Error(t, db.Exec(insert, "regular", "", "maybe").Error, "unknown price answer")
}
