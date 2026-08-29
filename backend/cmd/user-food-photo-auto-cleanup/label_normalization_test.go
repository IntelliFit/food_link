package main

import (
	"testing"

	adminrepo "food_link/backend/internal/admin/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
)

func TestPlanPhotoLabelNormalizationsOnlyChangesRetiredLabels(t *testing.T) {
	rows := []adminrepo.UserFoodPhotoAnnotation{
		{ID: "one", Labels: datatypes.NewJSONSlice([]string{"dessert", "fruit", "packaged_food"})},
		{ID: "two", Labels: datatypes.NewJSONSlice([]string{"snack", "dessert"})},
		{ID: "three", Labels: datatypes.NewJSONSlice([]string{"beverage"})},
	}

	updates, stats, err := planPhotoLabelNormalizations(rows)

	require.NoError(t, err)
	assert.Equal(t, labelNormalizationStats{Total: 3, Changed: 2, DessertMerged: 2, PackagedFoodRemoved: 1}, stats)
	assert.Equal(t, []labelNormalizationUpdate{
		{ID: "one", Labels: []string{"fruit", "snack"}},
		{ID: "two", Labels: []string{"snack"}},
	}, updates)
}
