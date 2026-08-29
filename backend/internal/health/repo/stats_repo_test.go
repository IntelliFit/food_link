package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupStatsTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(
		&domain.FoodRecord{},
		&domain.StatsInsight{},
		&domain.StatsUserProfile{},
	))
	require.NoError(t, db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_stats_insights_unique ON ai_stats_insights(user_id, range_type, generated_date)`).Error)
	return db
}

func TestStatsRepo_FoodRecordsForDateRange(t *testing.T) {
	db := setupStatsTestDB(t)
	r := NewStatsRepo(db)
	ctx := context.Background()

	recordTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	record := &domain.FoodRecord{
		UserID:        "user-1",
		MealType:      "lunch",
		TotalCalories: 500,
		TotalProtein:  20,
		TotalCarbs:    60,
		TotalFat:      15,
		RecordTime:    &recordTime,
	}
	err := db.WithContext(ctx).Create(record).Error
	require.NoError(t, err)

	records, err := r.GetFoodRecordsForDateRange(ctx, "user-1",
		time.Date(2024, 6, 14, 0, 0, 0, 0, time.UTC),
		time.Date(2024, 6, 16, 0, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Equal(t, 500.0, records[0].TotalCalories)
}

func TestStatsRepo_GetDietRecommendationCandidatesFiltersCampusSchool(t *testing.T) {
	db := setupStatsTestDB(t)
	require.NoError(t, db.Exec(`CREATE TABLE public_food_library (
		id TEXT PRIMARY KEY, food_name TEXT, description TEXT, total_calories REAL,
		total_protein REAL, total_carbs REAL, total_fat REAL, items TEXT,
		status TEXT, is_campus_food BOOLEAN, school_id TEXT, school_name TEXT,
		campus_id TEXT, campus_name TEXT, canteen_id TEXT, canteen_name TEXT,
		window_id TEXT, window_name TEXT, floor TEXT, price REAL, price_unit TEXT,
		image_path TEXT, published_at TIMESTAMP
	)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO public_food_library
		(id, food_name, total_calories, total_protein, total_carbs, total_fat, items, status, is_campus_food, school_id, school_name, canteen_name, floor, price, price_unit, published_at)
		VALUES
		('pku-dish', '鲈鱼', 420, 36, 12, 18, '[]', 'published', true, 'pku-id', '北京大学', '家园食堂', '3F', 18, '份', CURRENT_TIMESTAMP),
		('pku-dish-2', '鸭架汤', 260, 25, 8, 12, '[]', 'published', true, 'pku-id', '北京大学', '勺园食堂', '1F', 12, '份', CURRENT_TIMESTAMP),
		('thu-dish', '鲑鱼饭', 510, 32, 55, 16, '[]', 'published', true, 'thu-id', '清华大学', '桃李园', '1F', 22, '份', CURRENT_TIMESTAMP)`).Error)

	r := NewStatsRepo(db)
	candidates, err := r.GetDietRecommendationCandidates(context.Background(), "u1", "eat_out", domain.DietRecommendationScope{SchoolID: "pku-id"}, 10)

	require.NoError(t, err)
	require.Len(t, candidates, 2)

	previousOnly, err := r.GetDietRecommendationCandidates(context.Background(), "u1", "eat_out", domain.DietRecommendationScope{
		SchoolID:         "pku-id",
		IncludeSourceIDs: []string{"pku-dish"},
	}, 10)
	require.NoError(t, err)
	require.Len(t, previousOnly, 1)
	assert.Equal(t, "pku-dish", previousOnly[0].SourceID)
	assert.Equal(t, "北京大学", previousOnly[0].SchoolName)
	assert.Equal(t, "家园食堂", previousOnly[0].CanteenName)
	assert.Equal(t, 18.0, previousOnly[0].Price)

	moreCandidates, err := r.GetDietRecommendationCandidates(context.Background(), "u1", "eat_out", domain.DietRecommendationScope{
		SchoolID:         "pku-id",
		ExcludeSourceIDs: []string{"pku-dish"},
	}, 10)
	require.NoError(t, err)
	require.Len(t, moreCandidates, 1)
	assert.Equal(t, "pku-dish-2", moreCandidates[0].SourceID)
}

func TestStatsRepo_SearchCampusDietCandidatesEnforcesSchoolNutritionAndEvidence(t *testing.T) {
	db := setupStatsTestDB(t)
	require.NoError(t, db.Exec(`CREATE TABLE public_food_library (
		id TEXT PRIMARY KEY, food_name TEXT, description TEXT, total_calories REAL,
		total_protein REAL, total_carbs REAL, total_fat REAL, items TEXT,
		status TEXT, is_campus_food BOOLEAN, school_id TEXT, school_name TEXT,
		campus_id TEXT, campus_name TEXT, canteen_id TEXT, canteen_name TEXT,
		window_id TEXT, window_name TEXT, floor TEXT, price REAL, price_unit TEXT,
		image_path TEXT, published_at TIMESTAMP
	)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO public_food_library
		(id, food_name, total_calories, total_protein, total_carbs, total_fat, items, status, is_campus_food, school_id, school_name, canteen_name, floor, window_name, price, price_unit, published_at)
		VALUES
		('thu-chicken', '鸡胸', 286.23, 56.73, 0, 6.59, '[{"name":"鸡胸","amount":183,"unit":"g","nutrition_source_category":"llm_generated","weight_method":"visual_estimate","weight_confidence":0.68,"uncertainty_level":"medium"}]', 'published', true, 'thu-id', '清华大学', '紫荆园', '4F', '健康轻食', 4, '两', CURRENT_TIMESTAMP),
		('thu-rice', '日烧意式鸡排饭', 525, 43.75, 49.7, 16.8, '[]', 'published', true, 'thu-id', '清华大学', '紫荆园', 'B1', '清青披萨', 32, '份', CURRENT_TIMESTAMP),
		('pku-fish', '鲈鱼', 320, 36, 12, 10, '[]', 'published', true, 'pku-id', '北京大学', '家园食堂', '3F', '蒸菜窗口', 18, '份', CURRENT_TIMESTAMP)`).Error)

	limit := 400.0
	r := NewStatsRepo(db)
	candidates, total, err := r.SearchCampusDietCandidates(context.Background(), domain.CampusDietSearchFilter{
		SchoolID: "thu-id", MaxCalories: &limit, SortBy: "protein_density", Limit: 20,
	})

	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, candidates, 1)
	assert.Equal(t, "thu-chicken", candidates[0].SourceID)
	assert.InDelta(t, 286.23, candidates[0].Calories, 0.001)
	assert.Equal(t, "library_estimate", candidates[0].NutritionBasis)
	assert.Equal(t, "visual_estimate", candidates[0].WeightMethod)
	assert.Equal(t, 0.68, candidates[0].WeightConfidence)

	crossSchool, _, err := r.SearchCampusDietCandidates(context.Background(), domain.CampusDietSearchFilter{
		SchoolID: "thu-id", IncludeSourceIDs: []string{"pku-fish"}, Limit: 20,
	})
	require.NoError(t, err)
	assert.Empty(t, crossSchool)

	require.NoError(t, db.Exec(`INSERT INTO public_food_library
		(id, food_name, total_calories, total_protein, total_carbs, total_fat, items, status, is_campus_food, school_id, school_name, canteen_name, floor, window_name, price, price_unit, published_at)
		VALUES
		('thu-budget-meal', '番茄鸡蛋杂粮饭', 390, 24, 48, 11, '[]', 'published', true, 'thu-id', '清华大学', '桃李园', '1F', '家常菜窗口', 18, '份', CURRENT_TIMESTAMP),
		('thu-package', '圆餐盒800', 120, 1, 20, 2, '[]', 'published', true, 'thu-id', '清华大学', '紫荆园', 'B1', '用品窗口', 1, '个', CURRENT_TIMESTAMP),
		('thu-weight-food', '生鲜猪肉', 330, 30, 0, 22, '[]', 'published', true, 'thu-id', '清华大学', '紫荆园', 'B1', '称重窗口', 5, '元/两', CURRENT_TIMESTAMP),
		('thu-piece-food', '烤虾', 80, 8, 2, 4, '[]', 'published', true, 'thu-id', '清华大学', '桃李园', '1F', '烧烤窗口', 2, '元/只', CURRENT_TIMESTAMP)`).Error)
	budget := 20.0
	budgetCandidates, budgetTotal, err := r.SearchCampusDietCandidates(context.Background(), domain.CampusDietSearchFilter{
		SchoolID: "thu-id", MaxPrice: &budget, SortBy: "highest_protein", Limit: 20,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(1), budgetTotal)
	require.Len(t, budgetCandidates, 1)
	assert.Equal(t, "thu-budget-meal", budgetCandidates[0].SourceID)
	assert.Equal(t, "份", budgetCandidates[0].PriceUnit)

	cheapCandidates, _, err := r.SearchCampusDietCandidates(context.Background(), domain.CampusDietSearchFilter{
		SchoolID: "thu-id", SortBy: "lowest_price", Limit: 20,
	})
	require.NoError(t, err)
	require.Len(t, cheapCandidates, 2)
	assert.Equal(t, "thu-budget-meal", cheapCandidates[0].SourceID)
	assert.Equal(t, "thu-rice", cheapCandidates[1].SourceID)
}

func TestStatsRepo_ResolveDietRecommendationSchoolSupportsCommonAliases(t *testing.T) {
	db := setupStatsTestDB(t)
	require.NoError(t, db.Exec(`CREATE TABLE schools (id TEXT PRIMARY KEY, name TEXT, status TEXT)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO schools (id, name, status) VALUES ('pku-id', '北京大学', 'active'), ('thu-id', '清华大学', 'active')`).Error)
	r := NewStatsRepo(db)

	school, err := r.ResolveDietRecommendationSchool(context.Background(), "我是北大学生，今天午餐吃什么？")
	require.NoError(t, err)
	require.NotNil(t, school)
	assert.Equal(t, "pku-id", school.ID)

	school, err = r.ResolveDietRecommendationSchool(context.Background(), "清华学生晚餐推荐")
	require.NoError(t, err)
	require.NotNil(t, school)
	assert.Equal(t, "thu-id", school.ID)
}

func TestStatsRepo_GetExerciseLogsForDateRange(t *testing.T) {
	db := setupStatsTestDB(t)
	r := NewStatsRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Exec(`CREATE TABLE user_exercise_logs (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		exercise_desc TEXT,
		recorded_on TIMESTAMP,
		created_at TIMESTAMP
	)`).Error)

	require.NoError(t, db.Exec(`INSERT INTO user_exercise_logs
		(id, user_id, exercise_desc, recorded_on, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		"ex-in", "user-1", "跑步", "2024-06-15", time.Date(2024, 6, 15, 9, 0, 0, 0, time.UTC)).Error)
	require.NoError(t, db.Exec(`INSERT INTO user_exercise_logs
		(id, user_id, exercise_desc, recorded_on, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		"ex-out", "user-1", "力量训练", "2024-06-13", time.Date(2024, 6, 13, 9, 0, 0, 0, time.UTC)).Error)

	logs, err := r.GetExerciseLogsForDateRange(ctx, "user-1", "2024-06-14", "2024-06-15")
	require.NoError(t, err)
	require.Len(t, logs, 1)
	assert.Equal(t, "ex-in", logs[0].ID)
}

func TestStatsRepo_Insight(t *testing.T) {
	db := setupStatsTestDB(t)
	r := NewStatsRepo(db)
	ctx := context.Background()

	err := r.UpsertInsightCache(ctx, "user-1", "week", "2024-06-15", "fp-1", "Test insight")
	require.NoError(t, err)

	cached, err := r.GetCachedInsight(ctx, "user-1", "week", "2024-06-15")
	require.NoError(t, err)
	require.NotNil(t, cached)
	assert.Equal(t, "Test insight", cached.InsightText)

	err = r.UpsertInsightCache(ctx, "user-1", "week", "2024-06-15", "fp-2", "Updated insight")
	require.NoError(t, err)

	latest, err := r.GetLatestCachedInsight(ctx, "user-1", "week")
	require.NoError(t, err)
	require.NotNil(t, latest)
	assert.Equal(t, "Updated insight", latest.InsightText)
	assert.Equal(t, "fp-2", latest.DataFingerprint)
}

func TestStatsRepo_CountInsightGenerationsToday(t *testing.T) {
	db := setupStatsTestDB(t)
	r := NewStatsRepo(db)
	ctx := context.Background()

	count, err := r.CountInsightGenerationsToday(ctx, "user-1")
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)

	err = r.UpsertInsightCache(ctx, "user-1", "week", "2024-06-15", "fp-1", "Insight 1")
	require.NoError(t, err)
	err = r.UpsertInsightCache(ctx, "user-1", "month", "2024-06-15", "fp-2", "Insight 2")
	require.NoError(t, err)

	count, err = r.CountInsightGenerationsToday(ctx, "user-1")
	require.NoError(t, err)
	assert.Equal(t, int64(2), count)

	count, err = r.CountInsightGenerationsToday(ctx, "user-2")
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)
}
