package service

import (
	"context"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	foodrepo "food_link/backend/internal/foodrecord/repo"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestSaveRejectsCorrectionOfAlreadyRecordedMeal(t *testing.T) {
	db := setupServiceTestDB(t)
	svc := NewFoodRecordService(foodrepo.NewFoodRecordRepo(db), foodrepo.NewAnalysisTaskRepo(db), authrepo.NewUserRepo(db))
	ctx := context.Background()
	yesterday := time.Now().In(chinaTZ).AddDate(0, 0, -1).Format("2006-01-02")
	createTask := func(userID string, payload map[string]any) *analyzedomain.AnalysisTask {
		payload["recorded_on"] = yesterday
		task := &analyzedomain.AnalysisTask{ID: uuid.NewString(), UserID: userID, TaskType: "food", Status: "done", Payload: payload,
			Result: map[string]any{"items": []any{map[string]any{"name": "牛肉锅"}}}}
		require.NoError(t, db.Create(task).Error)
		return task
	}
	save := func(userID string, task *analyzedomain.AnalysisTask) (*domain.FoodRecord, error) {
		return svc.Save(ctx, userID, SaveFoodRecordInput{
			MealType: "dinner", SourceTaskID: &task.ID,
			Items: []domain.FoodItem{{Name: "牛肉锅", Weight: 500, Ratio: 100, Intake: 500,
				Nutrients: domain.FoodItemNutrients{Calories: 600, Protein: 60, Carbs: 20, Fat: 31}}},
			TotalCalories: 600, TotalProtein: 60, TotalCarbs: 20, TotalFat: 31,
		})
	}
	countRecords := func(userID string) int64 {
		var count int64
		require.NoError(t, db.Model(&domain.FoodRecord{}).Where("user_id = ?", userID).Count(&count).Error)
		return count
	}

	original := createTask("u1", map[string]any{})
	_, err := save("u1", original)
	require.NoError(t, err)
	corrected := createTask("u1", map[string]any{"correction_source_task_id": original.ID, "correction_root_task_id": original.ID})
	record, err := save("u1", corrected)
	require.Nil(t, record)
	var appErr *commonerrors.AppError
	require.ErrorAs(t, err, &appErr)
	require.Equal(t, 409, appErr.HTTPStatus)
	require.Contains(t, appErr.Message, "记录详情")
	require.EqualValues(t, 1, countRecords("u1"), "已记录的餐纠错后不能再新建第二条摄入")

	// 记录挂在中间一轮纠错上（A 未记录、B 已记录），第三轮 C 仍须拦住。
	rootOnly := createTask("u2", map[string]any{})
	middle := createTask("u2", map[string]any{"correction_source_task_id": rootOnly.ID, "correction_root_task_id": rootOnly.ID})
	_, err = save("u2", middle)
	require.NoError(t, err)
	third := createTask("u2", map[string]any{"correction_source_task_id": middle.ID, "correction_root_task_id": rootOnly.ID})
	_, err = save("u2", third)
	require.ErrorAs(t, err, &appErr)
	require.EqualValues(t, 1, countRecords("u2"))

	// 原餐从未记录时，纠错结果照常保存。
	unrecorded := createTask("u3", map[string]any{})
	correctedOnce := createTask("u3", map[string]any{"correction_source_task_id": unrecorded.ID, "correction_root_task_id": unrecorded.ID})
	saved, err := save("u3", correctedOnce)
	require.NoError(t, err)
	require.NotNil(t, saved)
	require.EqualValues(t, 1, countRecords("u3"))

	// 他人任务不能被拿来判断或泄露“已记录”状态。
	foreignOriginal := createTask("other", map[string]any{})
	_, err = save("other", foreignOriginal)
	require.NoError(t, err)
	spoofed := createTask("u4", map[string]any{"correction_source_task_id": foreignOriginal.ID, "correction_root_task_id": foreignOriginal.ID})
	_, err = save("u4", spoofed)
	require.NoError(t, err, "只按本人记录判断，不受他人记录影响")
}
