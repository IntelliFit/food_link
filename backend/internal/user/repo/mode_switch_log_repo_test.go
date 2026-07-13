package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/user/domain"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupModeSwitchLogTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)
	db.Exec(`CREATE TABLE user_mode_switch_logs (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		from_mode TEXT,
		to_mode TEXT,
		changed_by TEXT,
		reason_code TEXT,
		created_at TIMESTAMP
	)`)
	return db
}

func TestModeSwitchLogRepo_Create(t *testing.T) {
	db := setupModeSwitchLogTestDB(t)
	repo := NewModeSwitchLogRepo(db)
	ctx := context.Background()

	now := time.Now()
	log := &domain.UserModeSwitchLog{
		UserID:    "user-1",
		FromMode:  "easy",
		ToMode:    "strict",
		ChangedBy: "user",
		CreatedAt: &now,
	}
	err := repo.Create(ctx, log)
	require.NoError(t, err)
	assert.NotEmpty(t, log.ID)
}

func TestModeSwitchLogRepo_Create_WithID(t *testing.T) {
	db := setupModeSwitchLogTestDB(t)
	repo := NewModeSwitchLogRepo(db)
	ctx := context.Background()

	now := time.Now()
	log := &domain.UserModeSwitchLog{
		ID:        "log-1",
		UserID:    "user-1",
		FromMode:  "easy",
		ToMode:    "strict",
		ChangedBy: "user",
		CreatedAt: &now,
	}
	err := repo.Create(ctx, log)
	require.NoError(t, err)
	assert.Equal(t, "log-1", log.ID)
}
