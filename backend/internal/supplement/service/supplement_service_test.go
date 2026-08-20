package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/supplement/domain"
	"food_link/backend/internal/supplement/repo"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupSupplementService(t *testing.T) (*SupplementService, *repo.SupplementRepo) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&domain.SupplementCatalogItem{}, &domain.UserSupplement{}, &domain.SupplementIntake{}))
	r := repo.NewSupplementRepo(db)
	return NewSupplementService(r), r
}

func TestSupplementService_ListCatalogFiltersSharedTemplates(t *testing.T) {
	catalogDB := testdb.New(t)
	require.NoError(t, catalogDB.AutoMigrate(&domain.SupplementCatalogItem{}))
	require.NoError(t, catalogDB.Create(&domain.SupplementCatalogItem{
		ID: "catalog-d3", Name: "维生素D3", Category: "vitamin", SearchTerms: "维D vitamin d",
		ServingLabel: "1粒", Status: "active", SortOrder: 1,
		Components: []domain.Component{{Code: "vitamin_d", Name: "维生素D", Category: "nutrient", Amount: 25, Unit: "mcg", NutrientKey: "vitaminDMcg"}},
	}).Error)
	catalogSvc := NewSupplementService(repo.NewSupplementRepo(catalogDB))

	items, err := catalogSvc.ListCatalog(context.Background(), "维D")
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, "维生素D3", items[0].Name)
	assert.Equal(t, "vitaminDMcg", items[0].Components[0].NutrientKey)
}

func TestSupplementService_RecordAndAggregateDashboard(t *testing.T) {
	svc, _ := setupSupplementService(t)
	ctx := context.Background()
	schedule := "22:30"
	item, err := svc.Create(ctx, "u1", UpsertInput{
		Name: "甘氨酸镁", DefaultServings: 1, ServingLabel: "2粒", ScheduleEnabled: true, ScheduleTime: &schedule,
		Components: []domain.Component{
			{Code: "magnesium", Name: "镁", Category: "nutrient", Amount: 200, Unit: "mg", NutrientKey: "magnesiumMg"},
			{Code: "glycine", Name: "甘氨酸", Category: "functional", Amount: 1200, Unit: "mg"},
		}, LabelConfirmed: true,
	})
	require.NoError(t, err)
	takenAt := time.Date(2026, 8, 12, 22, 30, 0, 0, time.FixedZone("Asia/Shanghai", 8*60*60))
	intake, err := svc.Record(ctx, "u1", item.ID, RecordInput{TakenAt: &takenAt, IdempotencyKey: "quick-1"})
	require.NoError(t, err)
	assert.Equal(t, 1.0, intake.Servings)

	result, err := svc.Dashboard(ctx, "u1", "2026-08-12")
	require.NoError(t, err)
	assert.Equal(t, 1, result.PlannedCount)
	assert.Equal(t, 1, result.CompletedCount)
	assert.Equal(t, 200.0, result.NutrientTotals["magnesiumMg"])
	require.Len(t, result.FunctionalComponents, 1)
	assert.Equal(t, "甘氨酸", result.FunctionalComponents[0].Name)
	assert.Equal(t, 1200.0, result.FunctionalComponents[0].Amount)
}

func TestSupplementService_RecordIsIdempotent(t *testing.T) {
	svc, _ := setupSupplementService(t)
	ctx := context.Background()
	item, err := svc.Create(ctx, "u1", UpsertInput{
		Name: "维生素D3", DefaultServings: 1, ServingLabel: "1粒", ScheduleEnabled: true,
		Components: []domain.Component{{Code: "vitamin_d", Name: "维生素D", Category: "nutrient", Amount: 25, Unit: "mcg", NutrientKey: "vitaminDMcg"}},
	})
	require.NoError(t, err)
	first, err := svc.Record(ctx, "u1", item.ID, RecordInput{IdempotencyKey: "same-key"})
	require.NoError(t, err)
	second, err := svc.Record(ctx, "u1", item.ID, RecordInput{IdempotencyKey: "same-key"})
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
}

func TestSupplementService_RejectsFunctionalNutrientMapping(t *testing.T) {
	svc, _ := setupSupplementService(t)
	_, err := svc.Create(context.Background(), "u1", UpsertInput{
		Name: "肌酸", Components: []domain.Component{{Code: "creatine", Name: "肌酸", Category: "functional", Amount: 5, Unit: "g", NutrientKey: "vitaminDMcg"}},
	})
	require.NoError(t, err)
	items, err := svc.List(context.Background(), "u1", "active")
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Empty(t, items[0].Components[0].NutrientKey)
}
