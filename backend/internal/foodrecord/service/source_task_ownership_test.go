package service

import (
	"context"
	"os"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	foodrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) {
	code := m.Run()
	if err := testdb.Stop(); err != nil && code == 0 {
		code = 1
	}
	os.Exit(code)
}

func TestFoodRecordSourceTaskOwnership(t *testing.T) {
	db := setupServiceTestDB(t)
	records := foodrepo.NewFoodRecordRepo(db)
	tasks := foodrepo.NewAnalysisTaskRepo(db)
	svc := NewFoodRecordService(records, tasks, authrepo.NewUserRepo(db))
	ctx := context.Background()
	yesterday := time.Now().In(chinaTZ).AddDate(0, 0, -1).Format("2006-01-02")
	createTask := func(userID, status string, violated bool) *analyzedomain.AnalysisTask {
		task := &analyzedomain.AnalysisTask{
			ID: uuid.NewString(), UserID: userID, TaskType: "food", Status: status, IsViolated: violated,
			ImagePaths: []string{"https://example.com/" + userID + ".jpg"},
			Payload:    map[string]any{"recorded_on": yesterday},
			Result: map[string]any{"insight": "仅供任务所有者查看的点评", "items": []any{map[string]any{
				"name": "米饭", "nutrients": map[string]any{"calories": 400.0, "protein": 10.0, "fiber": 8.0},
			}}},
		}
		require.NoError(t, db.Create(task).Error)
		return task
	}
	foreign := createTask("other-user", "done", false)
	for _, test := range []struct {
		name string
		task *analyzedomain.AnalysisTask
	}{
		{"他人任务", foreign},
		{"排队任务", createTask("u1", "pending", false)},
		{"运行任务", createTask("u1", "processing", false)},
		{"失败任务", createTask("u1", "failed", false)},
		{"超时任务", createTask("u1", "timed_out", false)},
		{"取消任务", createTask("u1", "cancelled", false)},
		{"违规任务", createTask("u1", "done", true)},
		{"不存在任务", &analyzedomain.AnalysisTask{ID: uuid.NewString()}},
	} {
		t.Run(test.name, func(t *testing.T) {
			record, err := svc.Save(ctx, "u1", SaveFoodRecordInput{MealType: "lunch", SourceTaskID: &test.task.ID})
			require.Error(t, err)
			require.Nil(t, record)
			if test.task == foreign {
				require.ErrorIs(t, err, commonerrors.ErrForbidden)
			}
		})
	}
	var count int64
	require.NoError(t, db.Model(&domain.FoodRecord{}).Count(&count).Error)
	require.Zero(t, count, "无权或未完成任务不得创建记录")

	owned := createTask("u1", "done", false)
	input := SaveFoodRecordInput{
		MealType: "lunch", SourceTaskID: &owned.ID,
		Items: []domain.FoodItem{{Name: "米饭", Weight: 100, Ratio: 100, Intake: 100,
			Nutrients: domain.FoodItemNutrients{Calories: 100, Protein: 1, Carbs: 23, Fat: 1}}},
		TotalCalories: 100, TotalProtein: 1, TotalCarbs: 23, TotalFat: 1,
	}
	first, err := svc.Save(ctx, "u1", input)
	require.NoError(t, err)
	require.Equal(t, yesterday, first.RecordTime.In(chinaTZ).Format("2006-01-02"))
	second, err := svc.Save(ctx, "u1", input)
	require.NoError(t, err)
	require.Equal(t, first.ID, second.ID)
	require.True(t, second.AlreadySaved, "自有完成任务仍只记录一次")
	input.SourceTaskID = nil
	_, err = svc.Save(ctx, "u1", input)
	require.NoError(t, err, "无识别来源的手动记录继续可用")

	// Bypass Save to reproduce a pre-existing foreign-task link. Public reads
	// must not hydrate any image, nutrient or advice from that task.
	now := time.Now()
	legacy := &domain.FoodRecord{
		UserID: "u1", MealType: "lunch", SourceTaskID: &foreign.ID, RecordTime: &now,
		Items: []domain.FoodItem{{Name: "米饭", Weight: 100, Ratio: 100, Intake: 100}},
	}
	require.NoError(t, records.Create(ctx, legacy))
	fetched, err := svc.Get(ctx, "u1", legacy.ID)
	require.NoError(t, err)
	require.Empty(t, fetched.ImagePaths)
	require.Nil(t, fetched.ImagePath)
	require.Zero(t, fetched.Items[0].Nutrients.Calories)
	require.Zero(t, fetched.Items[0].Nutrients.Fiber)
	require.NotContains(t, *fetched.Insight, "仅供任务所有者")
	listed, _, _, err := svc.ListPage(ctx, "u1", "", 20, 0)
	require.NoError(t, err)
	for _, record := range listed {
		if record.ID == legacy.ID {
			require.Empty(t, record.ImagePaths, "列表批量补图也必须校验任务归属")
			require.Zero(t, record.Items[0].Nutrients.Calories)
		}
		if record.ID == first.ID {
			require.Equal(t, owned.ImagePaths, record.ImagePaths, "正常自有任务继续补图")
		}
	}
	date, err := svc.buildRecordTime(ctx, "u1", nil, &foreign.ID)
	require.NoError(t, err)
	require.Equal(t, now.In(chinaTZ).Format("2006-01-02"), date.In(chinaTZ).Format("2006-01-02"), "不得从他人任务继承日期")
}
