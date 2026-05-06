package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/analyze/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupPrecisionTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	db.Exec(`CREATE TABLE precision_sessions (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		status TEXT,
		round_index INTEGER,
		current_task_id TEXT,
		created_at TIMESTAMP
	)`)
	db.Exec(`CREATE TABLE precision_session_rounds (
		id TEXT PRIMARY KEY,
		session_id TEXT,
		round_index INTEGER,
		created_at TIMESTAMP
	)`)
	return db
}

func TestPrecisionRepo_CreateSession(t *testing.T) {
	db := setupPrecisionTestDB(t)
	repo := NewPrecisionRepo(db)
	ctx := context.Background()

	now := time.Now()
	session := &domain.PrecisionSession{
		UserID: "user-1",
		Status: "active",
		RoundIndex: 1,
		CreatedAt: &now,
	}
	err := repo.CreateSession(ctx, session)
	require.NoError(t, err)
	assert.NotEmpty(t, session.ID)
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

	err := repo.UpdateSession(ctx, sessionID, map[string]any{"status": "completed"})
	require.NoError(t, err)

	var status string
	db.Raw("SELECT status FROM precision_sessions WHERE id = ?", sessionID).Scan(&status)
	assert.Equal(t, "completed", status)
}

func TestPrecisionRepo_CreateRound(t *testing.T) {
	db := setupPrecisionTestDB(t)
	repo := NewPrecisionRepo(db)
	ctx := context.Background()

	now := time.Now()
	round := &domain.PrecisionSessionRound{
		SessionID: "session-1",
		RoundIndex: 1,
		CreatedAt: &now,
	}
	err := repo.CreateRound(ctx, round)
	require.NoError(t, err)
	assert.NotEmpty(t, round.ID)
}
