package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"gorm.io/datatypes"
)

func TestNormalizeComparableNameFoldsCulinaryVariant(t *testing.T) {
	assert.Equal(t, normalizeComparableName("酸菜汆白肉"), normalizeComparableName("酸菜氽白肉"))
}

func TestPreferFoodPrioritizesImageThenCanonicalSpelling(t *testing.T) {
	image := "standard-food/pork.jpg"
	assert.True(t, preferFood(foodRow{ID: "image", ImagePath: &image}, foodRow{ID: "no-image"}))
	assert.True(t, preferFood(foodRow{ID: "canonical", CanonicalName: "酸菜汆白肉"}, foodRow{ID: "typo", CanonicalName: "酸菜氽白肉"}))
	assert.True(t, hasImage(foodRow{ImagePaths: datatypes.JSON(`["standard-food/pork-2.jpg"]`)}))
}
