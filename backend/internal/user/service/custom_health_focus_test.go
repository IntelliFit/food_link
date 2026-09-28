package service

import (
	"context"
	"testing"

	"food_link/backend/internal/auth/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseCustomHealthFocusesExport(t *testing.T) {
	raw := []map[string]any{
		{"id": "f1", "label": "控尿酸", "created_at": "2026-05-26T00:00:00Z"},
	}
	focuses := ParseCustomHealthFocusesExport(raw)
	require.Len(t, focuses, 1)
	assert.Equal(t, "f1", focuses[0].ID)
	assert.Equal(t, "控尿酸", focuses[0].Label)
}

func TestNormalizeCustomHealthFocusLabel(t *testing.T) {
	label, err := normalizeCustomHealthFocusLabel("控尿酸")
	require.NoError(t, err)
	assert.Equal(t, "控尿酸", label)

	_, err = normalizeCustomHealthFocusLabel("A")
	require.Error(t, err)
}

func TestCustomHealthFocusSlotsCanBeReusedAfterRemoval(t *testing.T) {
	db := setupTestDB(t)
	users := repo.NewUserRepo(db)
	svc := NewUserService(users, nil, nil)
	ctx := context.Background()
	user := &repo.User{OpenID: "focus-slot-user"}
	require.NoError(t, users.Create(ctx, user))

	var ids []string
	for _, label := range []string{"控尿酸", "控血糖", "护心脏"} {
		result, err := svc.AddCustomHealthFocus(ctx, user.ID, label)
		require.NoError(t, err)
		ids = append(ids, result.FocusID)
	}
	_, err := svc.AddCustomHealthFocus(ctx, user.ID, "补蛋白")
	require.Error(t, err)

	for _, id := range ids[1:] {
		_, err := svc.RemoveCustomHealthFocus(ctx, user.ID, id)
		require.NoError(t, err)
	}
	focuses, err := svc.GetCustomHealthFocuses(ctx, user.ID)
	require.NoError(t, err)
	require.Len(t, focuses, 1)
	assert.Equal(t, ids[0], focuses[0].ID)

	for i, label := range []string{"补蛋白", "增肌餐"} {
		result, err := svc.AddCustomHealthFocus(ctx, user.ID, label)
		require.NoError(t, err)
		require.Len(t, result.Focuses, i+2)
	}
	focuses, err = svc.GetCustomHealthFocuses(ctx, user.ID)
	require.NoError(t, err)
	require.Len(t, focuses, 3)
	assert.Equal(t, []string{"控尿酸", "补蛋白", "增肌餐"}, []string{focuses[0].Label, focuses[1].Label, focuses[2].Label})
}
