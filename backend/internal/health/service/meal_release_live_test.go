package service

import (
	"context"
	"encoding/json"
	"food_link/backend/internal/health/domain"
	healthrepo "food_link/backend/internal/health/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"github.com/stretchr/testify/require"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Opt-in only: real model and read-only user data, in-memory conversation.
func TestMealReleaseCrossCampusLive(t *testing.T) {
	if os.Getenv("FOODLINK_EVAL_REAL_USERS") != "1" {
		t.Skip("explicit opt-in: real user read-only campus conversation")
	}
	cfg, err := config.Load("../../..")
	require.NoError(t, err)
	db, err := database.Open(cfg.Database)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	tx := mealEvalReadOnly(t, db, cfg.Database.Schema)
	userID := os.Getenv("FOODLINK_EVAL_USER_ID")
	require.NotEmpty(t, userID, "explicit user ID is required; nicknames may not be unique")
	var users []struct{ ID string }
	require.NoError(t, tx.Raw("SELECT id FROM weapp_user WHERE id = ? AND nickname = ?", userID, "小马哥").Scan(&users).Error)
	require.Len(t, users, 1)
	user := users[0]
	memory := &mealEvalMemoryRepo{StatsRepo: healthrepo.NewStatsRepo(tx)}
	svc := NewStatsService(memory, nil, cfg)
	base := svc.client.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	capture := &mealEvalTransport{base: base}
	svc.client.Transport = capture
	var school struct{ Latitude, Longitude float64 }
	require.NoError(t, tx.Raw("SELECT latitude,longitude FROM schools WHERE name = ?", "清华大学").Scan(&school).Error)
	require.NotZero(t, school.Latitude)
	turns := []mealEvalTurn{}
	outPath, err := filepath.Abs("../../../../output/meal-agent-eval-20260926/release-cross-campus-20261008.json")
	require.NoError(t, err)
	defer func() {
		raw, _ := json.MarshalIndent(turns, "", "  ")
		_ = os.MkdirAll(filepath.Dir(outPath), 0700)
		_ = os.WriteFile(outPath, raw, 0600)
	}()
	for index, q := range []string{"我现在在清华大学，午餐预算25元，请推荐食堂里可以直接点的一餐。", "我现在来了北大，请换成北京大学食堂的午餐，不要火锅，前面的预算不变。", "预算提高到30元，不吃鸡肉，也不吃花生，换两份选择，还是在北大。", "为什么这次适合我？请确认没有把花生的限制也取消。"} {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		input := PetChatInput{Question: q, Range: "month", NewSession: memory.session == nil, Location: &domain.DietLocation{Latitude: school.Latitude, Longitude: school.Longitude, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}}
		if memory.session != nil {
			input.SessionID = memory.session.ID
		}
		turn := mealEvalTurn{Question: q, LocationProvided: true, RoutedToHarness: svc.shouldUseCampusDietAgent(ctx, user.ID, input)}
		capture.mu.Lock()
		capture.replies = nil
		capture.mu.Unlock()
		started := time.Now()
		stream, e := svc.GeneratePetChatStream(ctx, user.ID, input)
		require.NoError(t, e)
		for chunk := range stream {
			switch chunk.Type {
			case "chunk":
				turn.Answer += chunk.Text
			case "error":
				turn.Error = chunk.Error
			case "diet_result":
				turn.Result = chunk.DietResult
			}
		}
		cancel()
		turn.DurationSeconds = time.Since(started).Seconds()
		capture.mu.Lock()
		turn.ModelReplies = append([]mealEvalReply(nil), capture.replies...)
		capture.mu.Unlock()
		turns = append(turns, turn)
		require.True(t, turn.RoutedToHarness)
		require.Empty(t, turn.Error)
		require.NotNil(t, turn.Result)
		options := turn.Result.Recommendation.Recommendations
		require.NotEmpty(t, options, "%s", turn.Answer)
		wantSchool, budget := "清华大学", 25.0
		if index > 0 {
			wantSchool = "北京大学"
		}
		if index >= 2 {
			budget = 30
			require.LessOrEqual(t, len(options), 2)
		}
		if index == 3 {
			require.ElementsMatch(t, recommendationSourceIDsFromResult(&turns[index-1].Result.Recommendation), recommendationSourceIDsFromResult(&turn.Result.Recommendation), "解释追问不能重新换菜")
			require.NotNil(t, turn.Result.Recommendation.AgentConstraints)
			require.Contains(t, turn.Result.Recommendation.AgentConstraints.AvoidFoods, "花生")
		}
		for _, o := range options {
			require.Equal(t, wantSchool, o.SchoolName)
			require.Greater(t, o.Price, 0.0)
			require.LessOrEqual(t, o.Price, budget)
			require.NotEmpty(t, o.PriceUnit)
			if index > 0 {
				require.NotContains(t, o.Title+o.WindowName, "火锅")
			}
			if index >= 2 {
				require.False(t, mealAvoidFoodMatches("鸡肉", o.Title))
				require.NotContains(t, o.Title, "花生")
			}
		}
		t.Logf("CAMPUS_TURN=%d school=%s options=%d", index+1, wantSchool, len(options))
	}
	t.Logf("Read-only transcript: %s", outPath)
}
