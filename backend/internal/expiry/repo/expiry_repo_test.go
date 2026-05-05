package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/expiry/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open("file::memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.ExpiryItem{}))
	return db
}

func TestExpiryRepo_CreateAndGet(t *testing.T) {
	db := setupTestDB(t)
	r := NewExpiryRepo(db)
	ctx := context.Background()

	name := "apple"
	item := &domain.ExpiryItem{
		UserID:   "user-1",
		Name:     name,
		Category: "fruit",
		Status:   "active",
	}
	err := r.Create(ctx, item)
	require.NoError(t, err)
	assert.NotEmpty(t, item.ID)

	found, err := r.GetByID(ctx, item.ID)
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, "apple", found.Name)
	assert.Equal(t, "active", found.Status)
}

func TestExpiryRepo_ListByUser(t *testing.T) {
	db := setupTestDB(t)
	r := NewExpiryRepo(db)
	ctx := context.Background()

	require.NoError(t, r.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "a", Status: "active"}))
	require.NoError(t, r.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "b", Status: "consumed"}))
	require.NoError(t, r.Create(ctx, &domain.ExpiryItem{UserID: "u2", Name: "c", Status: "active"}))

	items, err := r.ListByUser(ctx, "u1", "", 0)
	require.NoError(t, err)
	assert.Len(t, items, 2)

	activeItems, err := r.ListByUser(ctx, "u1", "active", 0)
	require.NoError(t, err)
	assert.Len(t, activeItems, 1)
	assert.Equal(t, "a", activeItems[0].Name)
}

func TestExpiryRepo_Update(t *testing.T) {
	db := setupTestDB(t)
	r := NewExpiryRepo(db)
	ctx := context.Background()

	item := &domain.ExpiryItem{UserID: "u1", Name: "milk", Status: "active"}
	require.NoError(t, r.Create(ctx, item))

	updated, err := r.Update(ctx, "u1", item.ID, map[string]any{"name": "almond milk"})
	require.NoError(t, err)
	require.NotNil(t, updated)
	assert.Equal(t, "almond milk", updated.Name)

	// wrong user
	notFound, err := r.Update(ctx, "u2", item.ID, map[string]any{"name": "x"})
	require.NoError(t, err)
	assert.Nil(t, notFound)
}

func TestExpiryRepo_CountByStatus(t *testing.T) {
	db := setupTestDB(t)
	r := NewExpiryRepo(db)
	ctx := context.Background()

	require.NoError(t, r.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "a", Status: "active"}))
	require.NoError(t, r.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "b", Status: "active"}))
	require.NoError(t, r.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "c", Status: "expired"}))

	counts, err := r.CountByStatus(ctx, "u1")
	require.NoError(t, err)
	assert.Equal(t, 2, counts["active"])
	assert.Equal(t, 1, counts["expired"])
}

func TestExpiryRepo_ListExpiringSoon(t *testing.T) {
	db := setupTestDB(t)
	r := NewExpiryRepo(db)
	ctx := context.Background()

	today := time.Now()
	future := today.AddDate(0, 0, 3)
	farFuture := today.AddDate(0, 0, 10)

	require.NoError(t, r.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "a", Status: "active", ExpiryDate: &today}))
	require.NoError(t, r.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "b", Status: "active", ExpiryDate: &future}))
	require.NoError(t, r.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "c", Status: "active", ExpiryDate: &farFuture}))
	require.NoError(t, r.Create(ctx, &domain.ExpiryItem{UserID: "u1", Name: "d", Status: "consumed", ExpiryDate: &today}))

	items, err := r.ListExpiringSoon(ctx, "u1", 7, 0)
	require.NoError(t, err)
	assert.Len(t, items, 2)
}
