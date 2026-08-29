package migration

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFoodNutritionContributionStatementsStayNarrow(t *testing.T) {
	statements := foodNutritionContributionStatements()

	require.Len(t, statements, 8)
	joined := strings.Join(statements, "\n")
	assert.Contains(t, joined, "food_nutrition_contributions_status_check")
	assert.Contains(t, joined, "food_nutrition_contributions_pending_user_name")
	assert.Contains(t, joined, "REFERENCES weapp_user")
	assert.Contains(t, joined, "REFERENCES admin_accounts")
	assert.Contains(t, joined, "REFERENCES food_nutrition_library")
	assert.Contains(t, joined, "REFERENCES user_custom_foods")
	assert.NotContains(t, joined, "DROP TABLE")
	assert.NotContains(t, joined, "food_nutrition_library SET")
}

func TestFoodNutritionContributionVerificationContract(t *testing.T) {
	assert.ElementsMatch(t, []string{
		"weapp_user", "admin_accounts", "food_nutrition_library", "user_custom_foods",
	}, foodNutritionContributionDependencies)
	assert.Len(t, foodNutritionContributionConstraintNames, 7)
	assert.Len(t, foodNutritionContributionIndexNames, 5)
}
