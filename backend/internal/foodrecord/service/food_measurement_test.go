package service

import (
	"context"
	"encoding/json"
	"testing"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/foodmeasure"
	"food_link/backend/internal/foodrecord/domain"
	foodrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/testdb"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMeasuredFoodRecordRoundTrip(t *testing.T) {
	db := setupServiceTestDB(t)
	t.Cleanup(func() { require.NoError(t, testdb.Stop()) })
	r := foodrepo.NewFoodRecordRepo(db)
	svc := NewFoodRecordService(r, foodrepo.NewAnalysisTaskRepo(db), authrepo.NewUserRepo(db))
	milk := domain.FoodItem{Name: "牛奶", Ratio: 100, Weight: 250, Measurement: &foodmeasure.Measurement{
		Amount: 250, Unit: foodmeasure.Milliliter, BasisAmount: 100, BasisUnit: foodmeasure.Milliliter,
		NutrientsPerBasis: map[string]float64{"calories": 60, "protein": 3, "carbs": 5, "fat": 3},
	}}
	egg := domain.FoodItem{Name: "鸡蛋", Ratio: 100, Measurement: &foodmeasure.Measurement{
		Amount: 2, Unit: foodmeasure.Piece, BasisAmount: 1, BasisUnit: foodmeasure.Piece,
		NutrientsPerBasis: map[string]float64{"calories": 80, "protein": 6, "carbs": 1, "fat": 6},
		UnitConversions:   map[foodmeasure.Unit]float64{foodmeasure.Gram: 1.0 / 55},
	}}
	ctx := context.Background()
	// A client that ignores a newly shared volume/count food must not be able
	// to persist its own 100g fallback as a genuine mass.
	require.NoError(t, db.Exec(`CREATE TABLE user_custom_foods (id uuid PRIMARY KEY, user_id text, status text, public_status text, measurement jsonb)`).Error)
	customID := uuid.NewString()
	encodedMeasure, err := json.Marshal(milk.Measurement)
	require.NoError(t, err)
	require.NoError(t, db.Exec(`INSERT INTO user_custom_foods VALUES (?, ?, 'active', 'published', ?::jsonb)`, customID, "unit-user", string(encodedMeasure)).Error)
	customSource := "custom"
	milk.ManualSource, milk.ManualSourceID = &customSource, &customID
	oldClientMilk := milk
	oldClientMilk.Measurement = nil
	oldClientMilk.Nutrients = domain.FoodItemNutrients{Calories: 150}
	_, err = svc.Save(ctx, "unit-user", SaveFoodRecordInput{MealType: "breakfast", Items: []domain.FoodItem{oldClientMilk}})
	require.ErrorContains(t, err, "数量单位")

	customVolumeLabel := "250ml"
	oldClientMilk.ManualPortionLabel = &customVolumeLabel
	oldClientMilk.Weight, oldClientMilk.Intake, oldClientMilk.Ratio = 100, 100, 100
	customVolume, err := svc.Save(ctx, "unit-user", SaveFoodRecordInput{MealType: "breakfast", Items: []domain.FoodItem{oldClientMilk}, TotalCalories: 150, TotalWeightGrams: 100})
	require.NoError(t, err)
	assert.Equal(t, 60.0, customVolume.TotalCalories, "old custom-volume input is not an entire 250ml carton")
	assert.Zero(t, customVolume.TotalWeightGrams)
	assert.Equal(t, 100.0, customVolume.Items[0].Measurement.Amount)
	oldClientMilk.ManualPortionLabel = nil

	require.NoError(t, db.AutoMigrate(&domain.PackagedFood{}))
	packageID, packageSource := uuid.NewString(), "packaged_food"
	require.NoError(t, db.Exec(`INSERT INTO packaged_food_library (id, nutrition_basis_unit) VALUES (?, '100ml')`, packageID).Error)
	oldClientMilk.ManualSource, oldClientMilk.ManualSourceID = &packageSource, &packageID
	_, err = svc.Save(ctx, "unit-user", SaveFoodRecordInput{MealType: "breakfast", Items: []domain.FoodItem{oldClientMilk}})
	require.ErrorContains(t, err, "数量单位")

	// Actual old-page payload from the incident: a numeric ml quantity carried
	// in weight, an explicit ml label, and incorrectly scaled client totals.
	label := "200ml"
	oldClientMilk.ManualPortionLabel = &label
	oldClientMilk.Weight = 400
	oldClientMilk.Intake = 400
	oldClientMilk.Ratio = 100
	oldClientMilk.Nutrients = domain.FoodItemNutrients{Calories: 264}
	require.NoError(t, db.Exec(`UPDATE packaged_food_library SET is_active=TRUE, review_status='active', kcal_per_100g=33, protein_per_100g=3.3, calcium_mg_per_100g=100 WHERE id=?`, packageID).Error)
	legacyVolume, err := svc.Save(ctx, "unit-user", SaveFoodRecordInput{MealType: "breakfast", Items: []domain.FoodItem{oldClientMilk}, TotalCalories: 264, TotalWeightGrams: 400})
	require.NoError(t, err)
	assert.Equal(t, 132.0, legacyVolume.TotalCalories)
	assert.Zero(t, legacyVolume.TotalWeightGrams)
	assert.Equal(t, 400.0, legacyVolume.Items[0].Measurement.Amount)
	assert.Equal(t, 400.0, legacyVolume.Items[0].Nutrients.CalciumMg)
	assert.Zero(t, legacyVolume.Items[0].Weight)
	legacyReadback, err := r.GetByID(ctx, legacyVolume.ID)
	require.NoError(t, err)
	assert.Equal(t, foodmeasure.Milliliter, legacyReadback.Items[0].Measurement.Unit)
	assert.Equal(t, 132.0, legacyReadback.TotalCalories)
	legacyEdit := oldClientMilk
	legacyEdit.Weight, legacyEdit.Intake, legacyEdit.Ratio = 200, 100, 50
	_, err = svc.Update(ctx, "unit-user", legacyVolume.ID, UpdateFoodRecordInput{Items: []domain.FoodItem{legacyEdit}})
	require.NoError(t, err)
	legacyEdited, err := r.GetByID(ctx, legacyVolume.ID)
	require.NoError(t, err)
	assert.Equal(t, 33.0, legacyEdited.TotalCalories, "200ml at 50% intake is 33kcal")
	assert.Zero(t, legacyEdited.TotalWeightGrams)
	assert.Equal(t, 200.0, legacyEdited.Items[0].Measurement.Amount)

	badLabel := "400g"
	oldClientMilk.ManualPortionLabel = &badLabel
	_, err = svc.Save(ctx, "unit-user", SaveFoodRecordInput{MealType: "breakfast", Items: []domain.FoodItem{oldClientMilk}})
	require.ErrorContains(t, err, "数量单位", "a mass-labelled payload cannot be silently converted")

	legacyID := uuid.NewString()
	require.NoError(t, db.Exec(`INSERT INTO user_custom_foods VALUES (?, ?, 'active', 'private', NULL)`, legacyID, "unit-user").Error)
	legacyGramItem := domain.FoodItem{Name: "米饭", Weight: 100, Ratio: 100, ManualSource: &customSource, ManualSourceID: &legacyID, Nutrients: domain.FoodItemNutrients{Calories: 130}}
	_, err = svc.Save(ctx, "unit-user", SaveFoodRecordInput{MealType: "lunch", Items: []domain.FoodItem{legacyGramItem}})
	require.NoError(t, err, "旧的全g自定义食物继续可以录餐")

	record, err := svc.Save(ctx, "unit-user", SaveFoodRecordInput{
		MealType: "breakfast", Items: []domain.FoodItem{milk, egg}, TotalCalories: 999, TotalWeightGrams: 999,
	})
	require.NoError(t, err)
	assert.Equal(t, 310.0, record.TotalCalories)
	assert.Equal(t, 110, record.TotalWeightGrams, "不能把250ml计入克重")
	stored, err := r.GetByID(ctx, record.ID)
	require.NoError(t, err)
	require.Len(t, stored.Items, 2)
	assert.Equal(t, foodmeasure.Milliliter, stored.Items[0].Measurement.Unit)
	assert.Equal(t, 0.0, stored.Items[0].Weight)
	assert.InDelta(t, 110, stored.Items[1].Weight, 1e-8)

	stored.Items[0].Measurement.Amount = 500
	stored.Items[0].Ratio = 50
	_, err = svc.Update(ctx, "unit-user", record.ID, UpdateFoodRecordInput{Items: stored.Items})
	require.NoError(t, err)
	updated, err := r.GetByID(ctx, record.ID)
	require.NoError(t, err)
	assert.Equal(t, 310.0, updated.TotalCalories, "500ml的一半仍是150kcal，加2个鸡蛋160kcal")
	assert.Equal(t, 110, updated.TotalWeightGrams)
	assert.Equal(t, 500.0, updated.Items[0].Measurement.Amount)
	assert.Equal(t, 300.0, updated.Items[0].Nutrients.Calories)

	legacy := append([]domain.FoodItem(nil), updated.Items...)
	legacy[0].Measurement = nil
	legacy[0].Weight = 500
	_, err = svc.Update(ctx, "unit-user", record.ID, UpdateFoodRecordInput{Items: legacy})
	require.Error(t, err, "旧客户端不能把毫升记录静默改写成克")
	unchanged, err := r.GetByID(ctx, record.ID)
	require.NoError(t, err)
	assert.Equal(t, foodmeasure.Milliliter, unchanged.Items[0].Measurement.Unit)
}
