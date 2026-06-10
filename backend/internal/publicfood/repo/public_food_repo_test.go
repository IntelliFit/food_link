package repo

import (
	"context"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/publicfood/domain"

	"github.com/stretchr/testify/require"
	gormsqlite "gorm.io/driver/sqlite"
	"gorm.io/gorm"

	_ "modernc.org/sqlite"
)

func setupPublicFoodRepoTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(gormsqlite.New(gormsqlite.Config{
		DriverName: "sqlite",
		DSN:        ":memory:",
	}), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.PublicFoodItem{}, &analyzedomain.AnalysisTask{}))
	return db
}

func seedPublicFoodItems(t *testing.T, db *gorm.DB) {
	t.Helper()

	now := time.Now().UTC()
	taskID := "task-campus-pending"
	require.NoError(t, db.Create(&analyzedomain.AnalysisTask{
		ID:        taskID,
		UserID:    "user-4",
		TaskType:  "food",
		Status:    "pending",
		CreatedAt: &now,
		UpdatedAt: &now,
	}).Error)
	items := []domain.PublicFoodItem{
		{
			ID:              "campus-1",
			UserID:          "user-1",
			FoodName:        "鸡胸肉套餐",
			Status:          "published",
			IsCampusFood:    true,
			SchoolName:      "北京大学",
			CanteenName:     "学一食堂",
			Floor:           "一层",
			WindowName:      "低脂窗口",
			TotalCalories:   420,
			TotalProtein:    38,
			Price:           16,
			LikeCount:       9,
			CollectionCount: 2,
			PublishedAt:     &now,
			CreatedAt:       &now,
		},
		{
			ID:              "campus-2",
			UserID:          "user-2",
			FoodName:        "番茄牛肉饭",
			Status:          "published",
			IsCampusFood:    true,
			SchoolName:      "北京大学",
			CanteenName:     "家园食堂",
			TotalCalories:   560,
			TotalProtein:    28,
			Price:           18,
			LikeCount:       15,
			CollectionCount: 6,
			PublishedAt:     &now,
			CreatedAt:       &now,
		},
		{
			ID:              "campus-3",
			UserID:          "user-3",
			FoodName:        "清炒虾仁",
			Status:          "published",
			IsCampusFood:    true,
			SchoolName:      "清华大学",
			CanteenName:     "紫荆食堂",
			TotalCalories:   260,
			TotalProtein:    31,
			Price:           22,
			LikeCount:       3,
			CollectionCount: 1,
			PublishedAt:     &now,
			CreatedAt:       &now,
		},
		{
			ID:              "campus-pending",
			UserID:          "user-4",
			FoodName:        "待审核菜品",
			Status:          "published",
			AnalysisTaskID:  &taskID,
			IsCampusFood:    true,
			SchoolName:      "北京大学",
			CanteenName:     "学一食堂",
			Floor:           "一层",
			WindowName:      "低脂窗口",
			TotalCalories:   0,
			TotalProtein:    0,
			Price:           99,
			LikeCount:       0,
			CollectionCount: 0,
			PublishedAt:     &now,
			CreatedAt:       &now,
		},
		{
			ID:                "campus-similar-highlight",
			UserID:            "user-6",
			FoodName:          "低脂牛肉饭",
			Status:            "published",
			IsCampusFood:      true,
			IsCampusHighlight: true,
			SchoolName:        "北京大学",
			CanteenName:       "学一食堂",
			Floor:             "一层",
			WindowName:        "低脂窗口",
			TotalCalories:     480,
			TotalProtein:      20,
			Price:             19,
			LikeCount:         8,
			CollectionCount:   1,
			PublishedAt:       &now,
			CreatedAt:         &now,
		},
		{
			ID:              "normal-1",
			UserID:          "user-5",
			FoodName:        "校外沙拉",
			Status:          "published",
			IsCampusFood:    false,
			TotalCalories:   320,
			TotalProtein:    18,
			Price:           35,
			LikeCount:       20,
			CollectionCount: 7,
			PublishedAt:     &now,
			CreatedAt:       &now,
		},
	}

	require.NoError(t, db.Create(&items).Error)
}

func TestPublicFoodRepo_ListSimilarCampusFoods(t *testing.T) {
	db := setupPublicFoodRepoTestDB(t)
	seedPublicFoodItems(t, db)
	r := NewPublicFoodRepo(db)
	ctx := context.Background()

	item, err := r.GetItem(ctx, "campus-1")
	require.NoError(t, err)
	require.NotNil(t, item)

	rows, err := r.ListSimilarCampusFoods(ctx, *item, 10)

	require.NoError(t, err)
	require.NotEmpty(t, rows)
	require.Equal(t, "campus-similar-highlight", rows[0].ID)
	require.Equal(t, "北京大学", rows[0].SchoolName)
	require.Equal(t, "学一食堂", rows[0].CanteenName)
}

func TestPublicFoodRepo_ListRelatedCampusFeeds(t *testing.T) {
	db := setupPublicFoodRepoTestDB(t)
	seedPublicFoodItems(t, db)
	r := NewPublicFoodRepo(db)
	ctx := context.Background()

	item, err := r.GetItem(ctx, "campus-1")
	require.NoError(t, err)
	require.NotNil(t, item)

	rows, err := r.ListRelatedCampusFeeds(ctx, *item, 10)

	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "campus-similar-highlight", rows[0].ID)
	require.Equal(t, "低脂牛肉饭", rows[0].FoodName)
}

func TestPublicFoodRepo_ListPublishedCampusIncludesAnalysisStatus(t *testing.T) {
	db := setupPublicFoodRepoTestDB(t)
	seedPublicFoodItems(t, db)
	r := NewPublicFoodRepo(db)
	ctx := context.Background()
	isCampus := true

	rows, err := r.ListPublished(ctx, ListFilter{
		IsCampusFood: &isCampus,
		SchoolName:   "北京大学",
		CanteenName:  "学一食堂",
		SortBy:       "hot",
		Limit:        10,
	})

	require.NoError(t, err)
	var pending *domain.PublicFoodItem
	for i := range rows {
		if rows[i].ID == "campus-pending" {
			pending = &rows[i]
		}
	}
	require.NotNil(t, pending)
	require.Equal(t, "pending", pending.AnalysisStatus)
	require.Empty(t, pending.AnalysisError)
}

func TestPublicFoodRepo_ListPublishedCampusFilters(t *testing.T) {
	db := setupPublicFoodRepoTestDB(t)
	seedPublicFoodItems(t, db)
	r := NewPublicFoodRepo(db)
	ctx := context.Background()
	isCampus := true

	rows, err := r.ListPublished(ctx, ListFilter{
		IsCampusFood: &isCampus,
		SchoolName:   "北京大学",
		CanteenName:  "学一食堂",
		Limit:        10,
	})

	require.NoError(t, err)
	var analyzed *domain.PublicFoodItem
	for i := range rows {
		if rows[i].ID == "campus-1" {
			analyzed = &rows[i]
		}
	}
	require.NotNil(t, analyzed)
	require.True(t, analyzed.IsCampusFood)
	require.Equal(t, "published", analyzed.Status)
}

func TestPublicFoodRepo_ListPublishedCampusSorts(t *testing.T) {
	db := setupPublicFoodRepoTestDB(t)
	seedPublicFoodItems(t, db)
	r := NewPublicFoodRepo(db)
	ctx := context.Background()
	isCampus := true

	tests := []struct {
		name     string
		sortBy   string
		firstID  string
		secondID string
	}{
		{name: "hot", sortBy: "hot", firstID: "campus-2", secondID: "campus-1"},
		{name: "high protein", sortBy: "high_protein", firstID: "campus-1", secondID: "campus-3"},
		{name: "low calorie", sortBy: "low_calorie", firstID: "campus-3", secondID: "campus-1"},
		{name: "value", sortBy: "value", firstID: "campus-1", secondID: "campus-2"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rows, err := r.ListPublished(ctx, ListFilter{
				IsCampusFood: &isCampus,
				SortBy:       tt.sortBy,
				Limit:        10,
			})

			require.NoError(t, err)
			require.GreaterOrEqual(t, len(rows), 2)
			require.Equal(t, tt.firstID, rows[0].ID)
			require.Equal(t, tt.secondID, rows[1].ID)
		})
	}
}

func TestPublicFoodRepo_ListPublishedCampusLimitOffset(t *testing.T) {
	db := setupPublicFoodRepoTestDB(t)
	seedPublicFoodItems(t, db)
	r := NewPublicFoodRepo(db)
	ctx := context.Background()
	isCampus := true

	rows, err := r.ListPublished(ctx, ListFilter{
		IsCampusFood: &isCampus,
		SortBy:       "hot",
		Limit:        1,
		Offset:       1,
	})

	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "campus-1", rows[0].ID)
}
