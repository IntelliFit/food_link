package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeAliasStore struct {
	foods   []nutritionFoodRow
	aliases []nutritionAliasRow
}

func (s *fakeAliasStore) FindFoodsByCanonical(_ context.Context, canonical string) ([]nutritionFoodRow, error) {
	out := []nutritionFoodRow{}
	for _, food := range s.foods {
		if food.CanonicalName == canonical {
			out = append(out, food)
		}
	}
	return out, nil
}

func (s *fakeAliasStore) FindAliasesByName(_ context.Context, aliasName, normalizedAlias string) ([]nutritionAliasRow, error) {
	out := []nutritionAliasRow{}
	for _, alias := range s.aliases {
		if alias.AliasName == aliasName || normalizeFoodName(alias.AliasName) == normalizedAlias {
			out = append(out, alias)
		}
	}
	return out, nil
}

func (s *fakeAliasStore) InsertAlias(_ context.Context, foodID, aliasName, _ string) error {
	for _, alias := range s.aliases {
		if normalizeFoodName(alias.AliasName) == normalizeFoodName(aliasName) {
			return nil
		}
	}
	var canonical string
	for _, food := range s.foods {
		if food.ID == foodID {
			canonical = food.CanonicalName
			break
		}
	}
	s.aliases = append(s.aliases, nutritionAliasRow{
		ID:            "alias-" + aliasName,
		FoodID:        foodID,
		AliasName:     aliasName,
		CanonicalName: canonical,
	})
	return nil
}

func TestWhitelistDryRunReportsWithoutWriting(t *testing.T) {
	store := &fakeAliasStore{foods: []nutritionFoodRow{{
		ID: "cooked-corn", CanonicalName: "玉米(熟)", KcalPer100g: 96, IsActive: true,
	}}}
	report, err := runWhitelistImport(context.Background(), store, []whitelistRecord{{
		Line: 2, AliasName: "水煮玉米", TargetCanonicalName: "玉米(熟)",
	}}, false)
	require.NoError(t, err)

	assert.Equal(t, 1, report.WouldInsert)
	assert.Equal(t, 0, report.Inserted)
	assert.Empty(t, store.aliases)
	assert.Equal(t, actionWouldInsert, report.Rows[0].Action)
}

func TestWhitelistApplyWritesAndSecondRunIsIdempotent(t *testing.T) {
	store := &fakeAliasStore{foods: []nutritionFoodRow{{
		ID: "rice", CanonicalName: "白米饭", KcalPer100g: 116, IsActive: true,
	}}}
	records := []whitelistRecord{{Line: 2, AliasName: "白饭", TargetCanonicalName: "白米饭"}}

	first, err := runWhitelistImport(context.Background(), store, records, true)
	require.NoError(t, err)
	assert.Equal(t, 1, first.Inserted)
	require.Len(t, store.aliases, 1)
	assert.Equal(t, "rice", store.aliases[0].FoodID)

	second, err := runWhitelistImport(context.Background(), store, records, true)
	require.NoError(t, err)
	assert.Equal(t, 1, second.SkippedExisting)
	assert.Equal(t, actionSkipped, second.Rows[0].Action)
	require.Len(t, store.aliases, 1)
}

func TestWhitelistBlocksAliasPointingToDifferentFood(t *testing.T) {
	store := &fakeAliasStore{
		foods: []nutritionFoodRow{
			{ID: "rice", CanonicalName: "白米饭", KcalPer100g: 116, IsActive: true},
			{ID: "noodle", CanonicalName: "面条", KcalPer100g: 110, IsActive: true},
		},
		aliases: []nutritionAliasRow{{
			ID: "a1", FoodID: "noodle", AliasName: "白饭", CanonicalName: "面条",
		}},
	}
	report, err := runWhitelistImport(context.Background(), store, []whitelistRecord{{
		Line: 2, AliasName: "白饭", TargetCanonicalName: "白米饭",
	}}, true)
	require.NoError(t, err)

	assert.Equal(t, 1, report.Blocked)
	assert.Equal(t, "alias_already_points_to_other_food", report.Rows[0].Reason)
	assert.Len(t, store.aliases, 1)
}

func TestWhitelistBlocksCookedCornToCornSausage(t *testing.T) {
	store := &fakeAliasStore{foods: []nutritionFoodRow{{
		ID: "corn-sausage", CanonicalName: "玉米肠", KcalPer100g: 207, IsActive: true,
	}}}
	report, err := runWhitelistImport(context.Background(), store, []whitelistRecord{{
		Line: 2, AliasName: "煮玉米", TargetCanonicalName: "玉米肠",
	}}, true)
	require.NoError(t, err)

	assert.Equal(t, 1, report.Blocked)
	assert.Equal(t, "unsafe_processed_food_target", report.Rows[0].Reason)
	assert.Empty(t, store.aliases)
}

func TestWhitelistTargetNotFoundOrInactiveBlocked(t *testing.T) {
	store := &fakeAliasStore{foods: []nutritionFoodRow{{
		ID: "inactive", CanonicalName: "老条目", KcalPer100g: 100, IsActive: false,
	}}}
	report, err := runWhitelistImport(context.Background(), store, []whitelistRecord{
		{Line: 2, AliasName: "不存在别名", TargetCanonicalName: "不存在目标"},
		{Line: 3, AliasName: "旧食物", TargetCanonicalName: "老条目"},
	}, true)
	require.NoError(t, err)

	assert.Equal(t, 1, report.TargetNotFound)
	assert.Equal(t, 1, report.Blocked)
	assert.Equal(t, actionTargetNotFound, report.Rows[0].Action)
	assert.Equal(t, "target_inactive_or_missing_kcal", report.Rows[1].Reason)
}

func TestWhitelistBlocksAliasEqualsTargetAndInputFragments(t *testing.T) {
	store := &fakeAliasStore{foods: []nutritionFoodRow{{
		ID: "rice", CanonicalName: "白米饭", KcalPer100g: 116, IsActive: true,
	}}}
	report, err := runWhitelistImport(context.Background(), store, []whitelistRecord{
		{Line: 2, AliasName: "白米饭", TargetCanonicalName: "白米饭"},
		{Line: 3, AliasName: "白米饭摄入量", TargetCanonicalName: "白米饭"},
	}, true)
	require.NoError(t, err)

	require.Len(t, report.Rows, 2)
	assert.Equal(t, "alias_equals_target", report.Rows[0].Reason)
	assert.Equal(t, "alias_looks_like_user_input_fragment", report.Rows[1].Reason)
	assert.Equal(t, 2, report.Blocked)
}
