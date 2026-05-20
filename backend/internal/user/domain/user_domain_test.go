package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestUserHealthDocument_Struct(t *testing.T) {
	now := time.Now()
	doc := UserHealthDocument{
		ID:           "doc-1",
		UserID:       "user-1",
		DocumentType: "report",
		CreatedAt:    &now,
	}
	assert.Equal(t, "doc-1", doc.ID)
	assert.Equal(t, "user_health_documents", doc.TableName())
}

func TestUserModeSwitchLog_Struct(t *testing.T) {
	now := time.Now()
	log := UserModeSwitchLog{
		ID:        "log-1",
		UserID:    "user-1",
		FromMode:  "easy",
		ToMode:    "strict",
		ChangedBy: "user",
		CreatedAt: &now,
	}
	assert.Equal(t, "log-1", log.ID)
	assert.Equal(t, "user_mode_switch_logs", log.TableName())
}

func TestDailyNutritionTarget_Struct(t *testing.T) {
	now := time.Now()
	target := DailyNutritionTarget{
		ID:            "target-1",
		UserID:        "user-1",
		TargetDate:    now,
		CalorieTarget: 1800,
		ProteinTarget: 100,
		CarbsTarget:   200,
		FatTarget:     60,
		Source:        "user_manual",
	}
	assert.Equal(t, "target-1", target.ID)
	assert.Equal(t, "user_daily_nutrition_targets", target.TableName())
}

func TestAnalysisTask_Struct(t *testing.T) {
	now := time.Now()
	task := AnalysisTask{
		ID:        "task-1",
		UserID:    "user-1",
		TaskType:  "health_report",
		Status:    "pending",
		CreatedAt: &now,
	}
	assert.Equal(t, "task-1", task.ID)
	assert.Equal(t, "analysis_tasks", task.TableName())
}
