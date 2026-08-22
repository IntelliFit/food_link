package migration

import (
	"testing"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

func TestMigrateUserFoodPhotoAnnotationsCreatesOnlyTargetSchema(t *testing.T) {
	db := testdb.New(t)

	require.NoError(t, MigrateUserFoodPhotoAnnotations(t.Context(), db, "public"))
	require.NoError(t, MigrateUserFoodPhotoAnnotations(t.Context(), db, "public"))

	model := &migrationdo.UserFoodPhotoAnnotationDO{}
	require.True(t, db.Migrator().HasTable(model))
	require.False(t, db.Migrator().HasTable(&migrationdo.UserDO{}), "窄迁移不得创建用户等无关业务表")
	for _, index := range []string{
		"idx_user_food_photo_annotations_identity",
		"idx_user_food_photo_annotations_status",
		"idx_user_food_photo_annotations_labels",
	} {
		require.True(t, db.Migrator().HasIndex(model, index), "缺少标注索引 %s", index)
	}
}
