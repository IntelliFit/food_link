package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestAnalysisTask_Struct(t *testing.T) {
	now := time.Now()
	task := AnalysisTask{
		ID:       "task-1",
		UserID:   "user-1",
		TaskType: "food",
		Status:   "pending",
		CreatedAt: &now,
		UpdatedAt: &now,
	}
	assert.Equal(t, "task-1", task.ID)
	assert.Equal(t, "user-1", task.UserID)
	assert.Equal(t, "analysis_tasks", task.TableName())
}

func TestPrecisionSession_Struct(t *testing.T) {
	now := time.Now()
	session := PrecisionSession{
		ID:         "session-1",
		UserID:     "user-1",
		Status:     "active",
		RoundIndex: 1,
		CreatedAt:  &now,
	}
	assert.Equal(t, "session-1", session.ID)
	assert.Equal(t, "precision_sessions", session.TableName())
}

func TestPrecisionSessionRound_Struct(t *testing.T) {
	now := time.Now()
	round := PrecisionSessionRound{
		ID:        "round-1",
		SessionID: "session-1",
		RoundIndex: 1,
		CreatedAt: &now,
	}
	assert.Equal(t, "round-1", round.ID)
	assert.Equal(t, "precision_session_rounds", round.TableName())
}
