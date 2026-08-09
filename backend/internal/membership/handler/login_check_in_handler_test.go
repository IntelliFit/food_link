package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMembershipHandler_ClaimLoginCheckIn(t *testing.T) {
	mockSvc := &mockMembershipService{claimLoginCheckInResult: map[string]any{
		"claimed_today":          true,
		"streak_days":            3,
		"reward_amount":          2,
		"applied":                true,
		"earned_credits_balance": 12,
	}}
	r := setupRouter(NewMembershipHandler(mockSvc))
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/membership/rewards/login-check-in/claim", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	data := resp["data"].(map[string]any)
	assert.Equal(t, true, data["claimed_today"])
	assert.Equal(t, float64(2), data["reward_amount"])
}
