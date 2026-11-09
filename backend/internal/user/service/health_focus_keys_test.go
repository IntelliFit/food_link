package service

import (
	"context"
	"testing"

	"food_link/backend/internal/auth/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseHealthFocusKeysKeepsOrderAndDropsDuplicates(t *testing.T) {
	assert.Equal(t, []string{"hypertension", "custom:f1"}, ParseHealthFocusKeys([]any{" hypertension", "", "custom:f1", "hypertension", 3}))
	assert.Empty(t, ParseHealthFocusKeys(nil))
}

// The focus is saved on the server: up to three built-in cards or the user's own custom
// focuses, nothing else.
func TestUpdateHealthFocusKeys(t *testing.T) {
	db := setupTestDB(t)
	users := repo.NewUserRepo(db)
	svc := NewUserService(users, nil, nil)
	ctx := context.Background()
	user := &repo.User{OpenID: "focus-keys-user"}
	require.NoError(t, users.Create(ctx, user))
	custom, err := svc.AddCustomHealthFocus(ctx, user.ID, "控尿酸")
	require.NoError(t, err)

	keys, err := svc.UpdateHealthFocusKeys(ctx, user.ID, []string{"hypertension", "custom:" + custom.FocusID, "hypertension", "diabetes"})
	require.NoError(t, err)
	assert.Equal(t, []string{"hypertension", "custom:" + custom.FocusID, "diabetes"}, keys)
	stored, err := svc.GetHealthFocusKeys(ctx, user.ID)
	require.NoError(t, err)
	assert.Equal(t, keys, stored)
	focuses, err := svc.GetCustomHealthFocuses(ctx, user.ID)
	require.NoError(t, err)
	assert.Len(t, focuses, 1, "custom focuses are kept")

	_, err = svc.UpdateHealthFocusKeys(ctx, user.ID, []string{"hypertension", "diabetes", "cardio", "weight"})
	require.Error(t, err)
	_, err = svc.UpdateHealthFocusKeys(ctx, user.ID, []string{"custom:not-mine"})
	require.Error(t, err)
	_, err = svc.UpdateHealthFocusKeys(ctx, user.ID, []string{"skin"})
	require.Error(t, err)

	keys, err = svc.UpdateHealthFocusKeys(ctx, user.ID, nil)
	require.NoError(t, err)
	assert.Empty(t, keys)
}
