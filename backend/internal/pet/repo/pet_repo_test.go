package repo

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	healthdomain "food_link/backend/internal/health/domain"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) {
	code := m.Run()
	if err := testdb.Stop(); err != nil && code == 0 {
		code = 1
	}
	os.Exit(code)
}

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

func TestPetRepo_ProfileUpgradeDoesNotOverwriteConcurrentAvatar(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.Exec(`CREATE TABLE user_pets (
		id text PRIMARY KEY, user_id text NOT NULL, name text NOT NULL,
		meta jsonb, updated_at timestamptz
	)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO user_pets (id,user_id,name,meta) VALUES
		('pet-1','user-1','牛来','{"profile_match_version":5}'),
		('null-meta','user-1','旧伙伴',NULL),
		('json-null-meta','user-1','旧伙伴','null'::jsonb)`).Error)
	repository := NewPetRepo(db)
	ctx := context.Background()
	expected := map[string]any{"profile_match_version": 5}
	// A photo selection commits between the upgrade's read and its write.
	require.NoError(t, db.Exec(`UPDATE user_pets SET meta='{"avatar_type":"pixel_self","pixel_avatar_key":"photos/custom.png"}' WHERE id='pet-1'`).Error)
	applied, err := repository.UpdatePetIfMetaUnchanged(ctx, "user-1", "pet-1", expected, map[string]any{"meta": map[string]any{"builtin_avatar_id": "jianwen-01"}, "name": "覆盖名字"})
	require.NoError(t, err)
	assert.False(t, applied)
	var row struct {
		Name string
		Meta json.RawMessage
	}
	require.NoError(t, db.Table("user_pets").Where("id = ?", "pet-1").Take(&row).Error)
	assert.Equal(t, "牛来", row.Name)
	assert.JSONEq(t, `{"avatar_type":"pixel_self","pixel_avatar_key":"photos/custom.png"}`, string(row.Meta))
	for _, id := range []string{"null-meta", "json-null-meta"} {
		applied, err = repository.UpdatePetIfMetaUnchanged(ctx, "other-user", id, nil, map[string]any{"meta": map[string]any{"builtin_avatar_id": "jianwen-01"}})
		require.NoError(t, err)
		assert.False(t, applied)
		applied, err = repository.UpdatePetIfMetaUnchanged(ctx, "user-1", id, nil, map[string]any{"meta": map[string]any{"builtin_avatar_id": "jianwen-01"}})
		require.NoError(t, err)
		assert.True(t, applied)
		applied, err = repository.UpdatePetIfMetaUnchanged(ctx, "user-1", id, nil, map[string]any{"meta": map[string]any{"builtin_avatar_id": "huatuo-01"}})
		require.NoError(t, err)
		assert.False(t, applied, "an already upgraded snapshot is stale")
	}
}
