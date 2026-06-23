package repo

import (
	"context"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	frienddomain "food_link/backend/internal/friend/domain"
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
	require.NoError(t, db.AutoMigrate(&domain.PublicFoodItem{}, &domain.PublicFoodComment{}, &analyzedomain.AnalysisTask{}, &frienddomain.UserBlock{}))
	require.NoError(t, db.Exec(`CREATE TABLE weapp_user (
		id TEXT PRIMARY KEY,
		nickname TEXT,
		avatar TEXT
	)`).Error)
	require.NoError(t, db.Exec(`CREATE TABLE schools (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		province TEXT,
		city TEXT,
		level TEXT,
		is_985 INTEGER,
		is_211 INTEGER,
		status TEXT NOT NULL DEFAULT 'active',
		logo_url TEXT,
		created_at TEXT
	)`).Error)
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

	rows, err := r.ListSimilarCampusFoods(ctx, *item, 10, "")

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

	rows, err := r.ListRelatedCampusFeeds(ctx, *item, 10, "")

	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "campus-similar-highlight", rows[0].ID)
	require.Equal(t, "低脂牛肉饭", rows[0].FoodName)
}

func TestPublicFoodRepo_ListCommentsBuildsReplyTree(t *testing.T) {
	db := setupPublicFoodRepoTestDB(t)
	seedPublicFoodItems(t, db)
	r := NewPublicFoodRepo(db)
	ctx := context.Background()
	now := time.Now().UTC()
	later := now.Add(time.Minute)
	require.NoError(t, db.Exec(`INSERT INTO weapp_user (id, nickname, avatar) VALUES
		('user-1', '小马', ''),
		('user-2', '同学A', ''),
		('user-3', '同学B', '')`).Error)
	parentID := "comment-parent"
	require.NoError(t, db.Create(&domain.PublicFoodComment{
		ID:            parentID,
		UserID:        "user-1",
		LibraryItemID: "campus-1",
		Content:       "这个窗口不错",
		CreatedAt:     &now,
	}).Error)
	require.NoError(t, db.Create(&domain.PublicFoodComment{
		ID:              "comment-reply",
		UserID:          "user-2",
		LibraryItemID:   "campus-1",
		ParentCommentID: &parentID,
		ReplyToUserID:   ptrStringForTest("user-1"),
		Content:         "我也觉得",
		CreatedAt:       &later,
	}).Error)

	rows, err := r.ListComments(ctx, "campus-1", 10, "")

	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, parentID, rows[0].ID)
	require.Equal(t, "小马", rows[0].Nickname)
	require.Len(t, rows[0].Replies, 1)
	require.Equal(t, "comment-reply", rows[0].Replies[0].ID)
	require.Equal(t, "同学A", rows[0].Replies[0].Nickname)
	require.Equal(t, "小马", rows[0].Replies[0].ReplyToNickname)
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

func TestPublicFoodRepo_ListPublishedCampusUsesRedirectTaskStatus(t *testing.T) {
	db := setupPublicFoodRepoTestDB(t)
	r := NewPublicFoodRepo(db)
	ctx := context.Background()
	now := time.Now().UTC()
	planTaskID := "task-campus-plan-done"
	aggregateTaskID := "task-campus-aggregate-pending"
	require.NoError(t, db.Create(&analyzedomain.AnalysisTask{
		ID:       aggregateTaskID,
		UserID:   "user-1",
		TaskType: "precision_aggregate",
		Status:   "pending",
	}).Error)
	require.NoError(t, db.Create(&analyzedomain.AnalysisTask{
		ID:       planTaskID,
		UserID:   "user-1",
		TaskType: "precision_plan",
		Status:   "done",
		Result:   map[string]any{"redirectTaskId": aggregateTaskID},
	}).Error)
	require.NoError(t, db.Create(&domain.PublicFoodItem{
		ID:             "campus-redirect",
		UserID:         "user-1",
		FoodName:       "待聚合套餐",
		Status:         "published",
		Type:           "campus",
		IsCampusFood:   true,
		AnalysisTaskID: &planTaskID,
		SchoolName:     "北京大学",
		CanteenName:    "学一食堂",
		PublishedAt:    &now,
		CreatedAt:      &now,
	}).Error)

	rows, err := r.ListPublished(ctx, ListFilter{Type: "campus", Limit: 10})

	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "pending", rows[0].AnalysisStatus)
	item, err := r.GetItem(ctx, "campus-redirect")
	require.NoError(t, err)
	require.NotNil(t, item)
	require.Equal(t, "pending", item.AnalysisStatus)
}

func TestPublicFoodRepo_UpdateNutritionFromAnalysisUsesItemCalorieFallback(t *testing.T) {
	db := setupPublicFoodRepoTestDB(t)
	r := NewPublicFoodRepo(db)
	ctx := context.Background()
	item := &domain.PublicFoodItem{
		ID:           "campus-calorie-fallback",
		UserID:       "user-1",
		FoodName:     "鸡腿饭",
		Status:       "published",
		Type:         "campus",
		IsCampusFood: true,
	}
	require.NoError(t, r.CreateItem(ctx, item))

	err := r.UpdateNutritionFromAnalysis(ctx, item.ID, map[string]any{
		"description": "鸡腿饭",
		"items": []map[string]any{
			{"name": "鸡腿", "calorie": 240.0, "protein": 28.0, "carbs": 0.0, "fat": 12.0},
			{"name": "米饭", "calories": 260.0, "protein": 5.0, "carbohydrates": 56.0, "fat": 0.6},
		},
	})

	require.NoError(t, err)
	var saved domain.PublicFoodItem
	require.NoError(t, db.Where("id = ?", item.ID).First(&saved).Error)
	require.Equal(t, 500.0, saved.TotalCalories)
	require.Equal(t, 33.0, saved.TotalProtein)
	require.Equal(t, 56.0, saved.TotalCarbs)
	require.InEpsilon(t, 12.6, saved.TotalFat, 0.001)
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

func TestPublicFoodRepo_GetItemReturnsSchoolLogoURL(t *testing.T) {
	db := setupPublicFoodRepoTestDB(t)
	seedPublicFoodItems(t, db)
	r := NewPublicFoodRepo(db)
	ctx := context.Background()

	// Seed a school with logo_url matching the campus-1 item's school_name
	require.NoError(t, db.Exec(`INSERT INTO schools (id, name, status, logo_url) VALUES ('sch-1', '北京大学', 'active', 'school-badges/sch-1/abc.png')`).Error)

	item, err := r.GetItem(ctx, "campus-1")
	require.NoError(t, err)
	require.NotNil(t, item)
	require.Equal(t, "北京大学", item.SchoolName)
	require.Equal(t, "school-badges/sch-1/abc.png", item.SchoolLogoURL)
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

func ptrStringForTest(value string) *string {
	return &value
}
