package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/analyze/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"

	"food_link/backend/pkg/testdb"

	"gorm.io/gorm"
)

func setupPrecisionTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)
	db.Exec(`CREATE TABLE precision_sessions (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		source_type TEXT,
		execution_mode TEXT,
		status TEXT,
		round_index INTEGER,
		latest_inputs TEXT,
		pending_requirements TEXT,
		reference_objects TEXT,
		split_plan TEXT,
		latest_planner_result TEXT,
		final_result TEXT,
		current_task_id TEXT,
		last_error TEXT,
		created_at TIMESTAMP,
		updated_at TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE precision_session_rounds (
		id TEXT PRIMARY KEY,
		session_id TEXT,
		round_index INTEGER,
		actor_role TEXT,
		input_payload TEXT,
		planner_result TEXT,
		created_at TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE precision_item_estimates (
		id TEXT PRIMARY KEY,
		session_id TEXT,
		round_index INTEGER,
		item_index INTEGER,
		item_key TEXT,
		item_name TEXT,
		status TEXT,
		payload TEXT,
		result TEXT,
		source_task_id TEXT,
		error_message TEXT,
		created_at TIMESTAMP,
		updated_at TIMESTAMP
	)`)
	return db
}

func TestPrecisionRepo_CreateSession(t *testing.T) {
	db := setupPrecisionTestDB(t)
	repo := NewPrecisionRepo(db)
	ctx := context.Background()

	now := time.Now()
	session := &domain.PrecisionSession{
		UserID:     "user-1",
		Status:     "active",
		RoundIndex: 1,
		CreatedAt:  &now,
	}
	err := repo.CreateSession(ctx, session)
	require.NoError(t, err)
	assert.NotEmpty(t, session.ID)
	assert.Equal(t, "experimental", session.ExecutionMode)
	assert.Equal(t, []any{}, session.PendingRequirements)
	assert.Equal(t, []any{}, session.ReferenceObjects)
	assert.NotNil(t, session.CreatedAt)
	assert.NotNil(t, session.UpdatedAt)
}

func TestPrecisionRepo_GetSessionByID(t *testing.T) {
	db := setupPrecisionTestDB(t)
	repo := NewPrecisionRepo(db)
	ctx := context.Background()

	// Not found
	session, err := repo.GetSessionByID(ctx, "nonexistent")
	require.NoError(t, err)
	assert.Nil(t, session)

	// Create and find
	now := time.Now()
	sessionID := "session-1"
	db.Exec(`INSERT INTO precision_sessions (id, user_id, status, round_index, created_at) VALUES (?, ?, ?, ?, ?)`,
		sessionID, "user-1", "active", 1, now)

	session, err = repo.GetSessionByID(ctx, sessionID)
	require.NoError(t, err)
	require.NotNil(t, session)
	assert.Equal(t, "active", session.Status)
}

func TestPrecisionRepo_UpdateSession(t *testing.T) {
	db := setupPrecisionTestDB(t)
	repo := NewPrecisionRepo(db)
	ctx := context.Background()

	now := time.Now()
	sessionID := "session-1"
	db.Exec(`INSERT INTO precision_sessions (id, user_id, status, round_index, created_at) VALUES (?, ?, ?, ?, ?)`,
		sessionID, "user-1", "active", 1, now)

	err := repo.UpdateSession(ctx, sessionID, map[string]any{"status": "done"})
	require.NoError(t, err)

	var status string
	db.Raw("SELECT status FROM precision_sessions WHERE id = ?", sessionID).Scan(&status)
	assert.Equal(t, "done", status)
}

func TestNormalizePrecisionJSONUpdates(t *testing.T) {
	updates := normalizePrecisionJSONUpdates(map[string]any{
		"pending_requirements":  []any{},
		"reference_objects":     nil,
		"latest_planner_result": map[string]any{"ok": true, "items": []any{}},
		"status":                "estimating",
	}, map[string]any{
		"pending_requirements":  []any{},
		"reference_objects":     []any{},
		"latest_planner_result": nil,
	})

	assert.JSONEq(t, `[]`, string(updates["pending_requirements"].(datatypes.JSON)))
	assert.JSONEq(t, `[]`, string(updates["reference_objects"].(datatypes.JSON)))
	assert.JSONEq(t, `{"ok":true,"items":[]}`, string(updates["latest_planner_result"].(datatypes.JSON)))
	assert.Equal(t, "estimating", updates["status"])
}

func TestPrecisionRepo_CreateRound(t *testing.T) {
	db := setupPrecisionTestDB(t)
	repo := NewPrecisionRepo(db)
	ctx := context.Background()

	now := time.Now()
	round := &domain.PrecisionSessionRound{
		SessionID:  "session-1",
		RoundIndex: 1,
	}
	err := repo.CreateRound(ctx, round)
	require.NoError(t, err)
	assert.NotEmpty(t, round.ID)
	assert.Equal(t, map[string]any{}, round.InputPayload)
	assert.NotNil(t, round.CreatedAt)
	_ = now
}

func TestPrecisionRepo_CreateItemEstimateDefaults(t *testing.T) {
	db := setupPrecisionTestDB(t)
	repo := NewPrecisionRepo(db)
	ctx := context.Background()

	estimate := &domain.PrecisionItemEstimate{
		SessionID:  "session-1",
		RoundIndex: 1,
		ItemIndex:  0,
		ItemKey:    "item-0",
		ItemName:   "rice",
	}
	err := repo.CreateItemEstimate(ctx, estimate)
	require.NoError(t, err)
	assert.NotEmpty(t, estimate.ID)
	assert.Equal(t, "pending", estimate.Status)
	assert.Equal(t, map[string]any{}, estimate.Payload)
	assert.NotNil(t, estimate.CreatedAt)
	assert.NotNil(t, estimate.UpdatedAt)
}
