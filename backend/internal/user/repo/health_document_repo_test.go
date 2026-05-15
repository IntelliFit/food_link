package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/user/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupHealthDocumentTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	db.Exec(`CREATE TABLE user_health_documents (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		document_type TEXT,
		image_url TEXT,
		extracted_content TEXT,
		create_time TIMESTAMP
	)`)
	return db
}

func TestHealthDocumentRepo_Create(t *testing.T) {
	db := setupHealthDocumentTestDB(t)
	repo := NewHealthDocumentRepo(db)
	ctx := context.Background()

	now := time.Now()
	doc := &domain.UserHealthDocument{
		UserID:       "user-1",
		DocumentType: "report",
		CreatedAt:    &now,
	}
	err := repo.Create(ctx, doc)
	require.NoError(t, err)
	assert.NotEmpty(t, doc.ID)
}

func TestHealthDocumentRepo_Create_WithID(t *testing.T) {
	db := setupHealthDocumentTestDB(t)
	repo := NewHealthDocumentRepo(db)
	ctx := context.Background()

	now := time.Now()
	doc := &domain.UserHealthDocument{
		ID:           "doc-1",
		UserID:       "user-1",
		DocumentType: "report",
		CreatedAt:    &now,
	}
	err := repo.Create(ctx, doc)
	require.NoError(t, err)
	assert.Equal(t, "doc-1", doc.ID)
}
