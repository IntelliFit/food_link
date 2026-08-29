package service

import (
	"context"
	"testing"

	"food_link/backend/internal/search/repo"

	"github.com/stretchr/testify/require"
)

type mockSearchRepo struct {
	contentRows []repo.ContentRow
}

func (m *mockSearchRepo) SearchContent(ctx context.Context, currentUserID, keyword string, offset, limit int) ([]repo.ContentRow, error) {
	return m.contentRows, nil
}

func (m *mockSearchRepo) SearchUsers(ctx context.Context, currentUserID, keyword string, offset, limit int) ([]repo.UserRow, error) {
	return nil, nil
}

func (m *mockSearchRepo) GetUserProfiles(ctx context.Context, userIDs []string) (map[string]*repo.UserProfileRow, error) {
	return map[string]*repo.UserProfileRow{
		"user-1": {
			ID:       "user-1",
			Nickname: "测试用户",
			Avatar:   "",
		},
	}, nil
}

func (m *mockSearchRepo) GetFriendIDs(ctx context.Context, userID string) (map[string]bool, error) {
	return map[string]bool{}, nil
}

func (m *mockSearchRepo) CountContent(ctx context.Context, currentUserID, keyword string) (int64, error) {
	return 0, nil
}

func (m *mockSearchRepo) CountUsers(ctx context.Context, currentUserID, keyword string) (int64, error) {
	return 0, nil
}

func (m *mockSearchRepo) GetLikesForTargets(ctx context.Context, targets []repo.LikeTarget, currentUserID string) (map[string]*repo.TargetLikeInfo, error) {
	return map[string]*repo.TargetLikeInfo{}, nil
}

func (m *mockSearchRepo) CountCommentsForTargets(ctx context.Context, targets []repo.LikeTarget) (map[string]int64, error) {
	return map[string]int64{}, nil
}

func TestSearchContentEnrichesFoodRecordDisplayFields(t *testing.T) {
	entryType := "food_library"
	sourceTaskID := "task-123"
	recipeID := "recipe-123"
	mealType := "lunch"
	dietGoal := "fat_loss"
	itemsJSON := `[
		{
			"name": "白米饭",
			"manual_source": "nutrition_library",
			"manual_source_id": "food-1",
			"manual_source_title": "白米饭",
			"image_paths": ["https://cdn.example.com/rice-1.jpg", "https://cdn.example.com/rice-2.jpg"],
			"nutrients": { "calories": 228 }
		}
	]`
	imagePathsJSON := `["https://cdn.example.com/meal-1.jpg","https://cdn.example.com/meal-2.jpg"]`

	svc := NewSearchService(&mockSearchRepo{
		contentRows: []repo.ContentRow{
			{
				TargetType:   "food_record",
				TargetID:     "record-1",
				UserID:       "user-1",
				Description:  "白米饭午餐",
				ImagePaths:   &imagePathsJSON,
				MealType:     &mealType,
				DietGoal:     &dietGoal,
				EntryType:    &entryType,
				SourceTaskID: &sourceTaskID,
				RecipeID:     &recipeID,
				Items:        &itemsJSON,
			},
		},
	}, nil)

	results, hasMore, err := svc.SearchContent(context.Background(), "viewer-1", "白米饭", 0, 20)
	require.NoError(t, err)
	require.False(t, hasMore)
	require.Len(t, results, 1)

	result := results[0]
	require.Equal(t, "food_library", *result.EntryType)
	require.Equal(t, "task-123", *result.SourceTaskID)
	require.Equal(t, "recipe-123", *result.RecipeID)
	require.Len(t, result.Items, 1)
	require.Len(t, result.ManualItems, 1)
	require.Equal(t, "白米饭", result.ManualItems[0].ManualSourceTitle)
	require.Equal(t, "常用食物", result.ManualItems[0].SourceLabel)
	require.Equal(t, "https://cdn.example.com/rice-1.jpg", result.ManualItems[0].ImagePath)
	require.Equal(t, []string{
		"https://cdn.example.com/meal-1.jpg",
		"https://cdn.example.com/meal-2.jpg",
		"https://cdn.example.com/rice-1.jpg",
		"https://cdn.example.com/rice-2.jpg",
	}, result.ImagePaths)
}

func TestSearchContentBackfillsFoodRecordImageFromManualItems(t *testing.T) {
	entryType := "food_library"
	itemsJSON := `[
		{
			"name": "鸡蛋",
			"manual_source": "nutrition_library",
			"manual_source_id": "food-2",
			"manual_source_title": "鸡蛋",
			"image_path": "https://cdn.example.com/egg.jpg",
			"nutrients": { "calories": 78 }
		}
	]`

	svc := NewSearchService(&mockSearchRepo{
		contentRows: []repo.ContentRow{
			{
				TargetType:  "food_record",
				TargetID:    "record-2",
				UserID:      "user-1",
				Description: "手动记录：鸡蛋",
				EntryType:   &entryType,
				Items:       &itemsJSON,
			},
		},
	}, nil)

	results, hasMore, err := svc.SearchContent(context.Background(), "viewer-1", "鸡蛋", 0, 20)
	require.NoError(t, err)
	require.False(t, hasMore)
	require.Len(t, results, 1)

	require.NotNil(t, results[0].ImagePath)
	require.Equal(t, "https://cdn.example.com/egg.jpg", *results[0].ImagePath)
	require.Equal(t, []string{"https://cdn.example.com/egg.jpg"}, results[0].ImagePaths)
}

func TestSearchContentHidesInternalExerciseItems(t *testing.T) {
	exerciseItemsJSON := `[
		{
			"name": "杠铃深蹲",
			"duration_min": 18,
			"sets": 4,
			"reps": 8,
			"intensity": "high",
			"met": 6,
			"calories_kcal": 126
		}
	]`
	durationMin := 18
	calories := 126.0

	svc := NewSearchService(&mockSearchRepo{
		contentRows: []repo.ContentRow{
			{
				TargetType:     "exercise_log",
				TargetID:       "exercise-1",
				UserID:         "user-1",
				Description:    "力量训练",
				CaloriesBurned: &calories,
				DurationMin:    &durationMin,
				ExerciseItems:  &exerciseItemsJSON,
			},
		},
	}, nil)

	results, hasMore, err := svc.SearchContent(context.Background(), "viewer-1", "训练", 0, 20)
	require.NoError(t, err)
	require.False(t, hasMore)
	require.Len(t, results, 1)
	require.Empty(t, results[0].ExerciseItems)
	require.Equal(t, durationMin, *results[0].DurationMin)
}
