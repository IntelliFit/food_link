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

type supplementLabelVisionStub struct {
	imageURLs []string
	result    map[string]any
}

func (s *supplementLabelVisionStub) AnalyzeWithImagesAndTemperature(_ context.Context, _ string, imageURLs []string, _ float64) (map[string]any, error) {
	s.imageURLs = append([]string(nil), imageURLs...)
	return s.result, nil
}

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

func TestSupplementService_RecognizeLabelAcceptsMultiImageFunctionalComponents(t *testing.T) {
	svc, _ := setupSupplementService(t)
	vision := &supplementLabelVisionStub{result: map[string]any{
		"name":          "深海鱼油维生素D3",
		"brand":         "测试品牌",
		"serving_label": "2粒",
		"components": []any{
			map[string]any{"name": "维生素D3", "category": "nutrient", "amount": 1000, "unit": "IU", "nutrient_key": "vitamin_d"},
			map[string]any{"code": "epa", "name": "EPA", "category": "functional", "amount": 360, "unit": "mg", "nutrient_key": "vitaminDMcg"},
			map[string]any{"code": "dha", "name": "DHA", "category": "functional", "amount": 240, "unit": "mg"},
		},
		"confidence": 0.93,
	}}
	svc.ConfigureLabelVisionClient(vision)

	result, err := svc.RecognizeLabel(context.Background(), []string{" https://example.com/front.jpg ", "https://example.com/facts.jpg"})
	require.NoError(t, err)
	require.Len(t, vision.imageURLs, 2)
	require.Len(t, result.Components, 3)
	assert.Equal(t, "vitaminDMcg", result.Components[0].NutrientKey)
	assert.Equal(t, 25.0, result.Components[0].Amount)
	assert.Equal(t, "mcg", result.Components[0].Unit)
	assert.Equal(t, domain.ComponentCategoryFunctional, result.Components[1].Category)
	assert.Empty(t, result.Components[1].NutrientKey)
	assert.Equal(t, "2粒", result.ServingLabel)
}

func TestSupplementService_RecognizeLabelRejectsMoreThanThreeImages(t *testing.T) {
	svc, _ := setupSupplementService(t)
	_, err := svc.RecognizeLabel(context.Background(), []string{"1", "2", "3", "4"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "最多上传 3 张")
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

func TestSupplementService_UpdatePersistsComponentsAndDailySchedule(t *testing.T) {
	svc, _ := setupSupplementService(t)
	ctx := context.Background()
	item, err := svc.Create(ctx, "u1", UpsertInput{
		Name: "辅酶Q10复合片", DefaultServings: 1, ServingLabel: "1粒",
		ImageURLs: []string{"https://example.com/coq10-front.jpg", "https://example.com/coq10-facts.jpg"},
		Components: []domain.Component{
			{Code: "coq10", Name: "辅酶Q10", Category: "functional", Amount: 100, Unit: "mg", Form: "ubiquinone"},
			{Code: "calcium", Name: "钙", Category: "nutrient", Amount: 50, Unit: "mg", NutrientKey: "calciumMg", Form: "calcium carbonate and calcium phosphate"},
		}, LabelConfirmed: true,
	})
	require.NoError(t, err)
	assert.False(t, item.ScheduleEnabled)

	scheduleTime := "08:30"
	updated, err := svc.Update(ctx, "u1", item.ID, UpsertInput{
		Name: "辅酶Q10复合片", DefaultServings: 1, ServingLabel: "1粒",
		ScheduleEnabled: true, ScheduleTime: &scheduleTime,
		Components: []domain.Component{
			{Code: "coq10", Name: "辅酶Q10", Category: "functional", Amount: 100, Unit: "mg", Form: "ubiquinone"},
			{Code: "calcium", Name: "钙", Category: "nutrient", Amount: 50, Unit: "mg", NutrientKey: "calciumMg", Form: "calcium carbonate and calcium phosphate"},
		}, LabelConfirmed: true,
	})
	require.NoError(t, err)
	assert.True(t, updated.ScheduleEnabled)
	require.NotNil(t, updated.ScheduleTime)
	assert.Equal(t, "08:30", *updated.ScheduleTime)
	assert.Empty(t, updated.ScheduleDays)
	require.Len(t, updated.Components, 2)
	require.Len(t, updated.ImageURLs, 2)
	assert.Equal(t, "https://example.com/coq10-front.jpg", updated.ImageURLs[0])
	require.NotNil(t, updated.ImageURL)
	assert.Equal(t, updated.ImageURLs[0], *updated.ImageURL)
	assert.Equal(t, "calciumMg", updated.Components[1].NutrientKey)
	assert.Equal(t, "calcium carbonate and calcium phosphate", updated.Components[1].Form)

	reloaded, err := svc.List(ctx, "u1", "active")
	require.NoError(t, err)
	require.Len(t, reloaded, 1)
	assert.True(t, reloaded[0].ScheduleEnabled)
	assert.Empty(t, reloaded[0].ScheduleDays)
	require.Len(t, reloaded[0].Components, 2)
	require.Len(t, reloaded[0].ImageURLs, 2)
	assert.Equal(t, "https://example.com/coq10-facts.jpg", reloaded[0].ImageURLs[1])
	assert.Equal(t, "辅酶Q10", reloaded[0].Components[0].Name)
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
