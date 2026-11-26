package repo

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCompactPackagedQueryParts(t *testing.T) {
	cases := []struct {
		query          string
		required, spec []string
	}{
		{"旺旺仙贝52g", []string{"旺旺仙贝"}, []string{"52g"}},
		{"可口可乐 330ml", []string{"可口可乐"}, []string{"330ml"}},
		{"旺旺 仙贝", []string{"旺旺", "仙贝"}, []string{}},
		{"oreo奥利奥夹心饼干97g", []string{"oreo", "奥利奥夹心饼干"}, []string{"97g"}},
		{"伊利纯牛奶250毫升", []string{"伊利纯牛奶"}, []string{"250毫升"}},
	}
	for _, tc := range cases {
		required, spec := compactPackagedQueryParts(tc.query)
		require.Equal(t, tc.required, required, tc.query)
		require.Equal(t, tc.spec, spec, tc.query)
	}
	for _, unchanged := range []string{"", "仙贝", "Alpenliebe", "52g"} {
		required, _ := compactPackagedQueryParts(unchanged)
		require.Empty(t, required, "a query that would not change must not trigger the retry: %q", unchanged)
	}
}

func TestManualPackagedSearchSplitsCompactQueryOnlyWhenNothingMatches(t *testing.T) {
	db := setupTestDB(t)
	insert := func(id, name, spec string) {
		require.NoError(t, db.Exec(`INSERT INTO packaged_food_library (id,product_name,normalized_name,spec_text,kcal_per_100g,is_active) VALUES (?,?,?,?,500,true)`, id, name, name, spec).Error)
	}
	insert("00000000-0000-0000-0000-000000000201", "旺旺仙贝", "52g")
	insert("00000000-0000-0000-0000-000000000202", "旺旺仙贝", "112g")
	insert("00000000-0000-0000-0000-000000000203", "旺旺雪饼", "84g")
	r := NewManualFoodRepo(db, nil)

	items, err := r.searchPackagedLibrary(context.Background(), "旺旺仙贝52g", 20)
	require.NoError(t, err)
	require.Len(t, items, 2, "both sizes of the product are found, the other product is not")
	require.Equal(t, "00000000-0000-0000-0000-000000000201", items[0].ID, "the stated size ranks first")

	split, err := r.searchPackagedLibrary(context.Background(), "旺旺 仙贝", 20)
	require.NoError(t, err)
	require.Len(t, split, 2, "every name part must match")

	plain, err := r.searchPackagedLibrary(context.Background(), "旺旺", 20)
	require.NoError(t, err)
	require.Len(t, plain, 3, "queries that already match keep the original behaviour")
}
