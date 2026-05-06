package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestBodyWeightRecord_Struct(t *testing.T) {
	now := time.Now()
	record := BodyWeightRecord{
		ID:       "r-1",
		UserID:   "user-1",
		WeightKg: 70.5,
		RecordedOn: &now,
		CreatedAt:  &now,
	}
	assert.Equal(t, "r-1", record.ID)
	assert.Equal(t, "user_weight_records", record.TableName())
}

func TestBodyWaterLog_Struct(t *testing.T) {
	now := time.Now()
	log := BodyWaterLog{
		ID:       "w-1",
		UserID:   "user-1",
		AmountMl: 500,
		RecordedOn: &now,
		CreatedAt:  &now,
	}
	assert.Equal(t, "w-1", log.ID)
	assert.Equal(t, "user_water_logs", log.TableName())
}

func TestExerciseLog_Struct(t *testing.T) {
	now := time.Now()
	calories := 300.0
	duration := 30
	log := ExerciseLog{
		ID:             "e-1",
		UserID:         "user-1",
		ExerciseDesc:   "Running",
		CaloriesBurned: &calories,
		DurationMin:    &duration,
		RecordedOn:     &now,
		CreatedAt:      &now,
	}
	assert.Equal(t, "e-1", log.ID)
	assert.Equal(t, "user_exercise_logs", log.TableName())
}

func TestStatsInsight_Struct(t *testing.T) {
	now := time.Now()
	insight := StatsInsight{
		ID:        "s-1",
		UserID:    "user-1",
		Content:   "test insight",
		DateRange: "2024-01-01 to 2024-01-07",
		CreatedAt: &now,
	}
	assert.Equal(t, "s-1", insight.ID)
	assert.Equal(t, "user_stats_insights", insight.TableName())
}

func TestFoodRecord_Struct(t *testing.T) {
	now := time.Now()
	record := FoodRecord{
		ID:            "f-1",
		UserID:        "user-1",
		MealType:      "lunch",
		TotalCalories: 500,
		RecordTime:    &now,
	}
	assert.Equal(t, "f-1", record.ID)
	assert.Equal(t, "user_food_records", record.TableName())
}

func TestAnalysisTask_Struct(t *testing.T) {
	now := time.Now()
	task := AnalysisTask{
		ID:       "t-1",
		UserID:   "user-1",
		TaskType: "health_report",
		Status:   "done",
		CreatedAt: &now,
	}
	assert.Equal(t, "t-1", task.ID)
	assert.Equal(t, "analysis_tasks", task.TableName())
}

func TestBodyMetricSettings_Struct(t *testing.T) {
	settings := BodyMetricSettings{
		UserID:      "user-1",
		WaterGoalMl: 2000,
	}
	assert.Equal(t, "user-1", settings.UserID)
	assert.Equal(t, "user_body_metric_settings", settings.TableName())
}
