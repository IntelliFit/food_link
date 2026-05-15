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
