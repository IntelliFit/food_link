package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"food_link/backend/internal/auth/repo"
	userrepo "food_link/backend/internal/user/repo"
)

func TestUserService_HealthProfileOnboardingStatusCompatibility(t *testing.T) {
	db := setupTestDB(t)

	users := repo.NewUserRepo(db)
	svc := NewUserService(users, userrepo.NewHealthDocumentRepo(db), userrepo.NewModeSwitchLogRepo(db), nil)
	ctx := context.Background()
	user := &repo.User{OpenID: "onboarding-status-user"}
	require.NoError(t, users.Create(ctx, user))

	skipped := "skipped"
	result, err := svc.UpdateHealthProfile(ctx, user.ID, UpdateHealthProfileInput{OnboardingStatus: &skipped})
	require.NoError(t, err)
	assert.Equal(t, onboardingStatusSkipped, result["onboarding_status"])
	assert.Equal(t, true, result["onboarding_completed"])

	persisted, err := users.FindByID(ctx, user.ID)
	require.NoError(t, err)
	require.NotNil(t, persisted)
	require.NotNil(t, persisted.OnboardingStatus)
	assert.Equal(t, onboardingStatusSkipped, *persisted.OnboardingStatus)

	result, err = svc.UpdateHealthProfile(ctx, user.ID, UpdateHealthProfileInput{})
	require.NoError(t, err)
	assert.Equal(t, onboardingStatusCompleted, result["onboarding_status"])
	assert.Equal(t, true, result["onboarding_completed"])
}
