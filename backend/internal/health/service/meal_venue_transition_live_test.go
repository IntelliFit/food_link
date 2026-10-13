package service

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	healthrepo "food_link/backend/internal/health/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
)

// Explicitly opted-in real-model replay. All business reads run in one READ
// ONLY transaction; chat persistence is replaced with memory, billing is nil.
// Configuration is passed privately in the child environment, never logged.
func TestMealVenueTransitionLiveScreenshotConversation(t *testing.T) {
	if os.Getenv("FOODLINK_VENUE_TRANSITION_LIVE") != "1" {
		t.Skip("requires explicit real-model read-only replay")
	}
	v := viper.New()
	v.SetConfigType("json")
	require.NoError(t, v.ReadConfig(strings.NewReader(os.Getenv("FOODLINK_VENUE_TRANSITION_CONFIG"))))
	var cfg config.Config
	require.NoError(t, v.Unmarshal(&cfg))
	userID := os.Getenv("FOODLINK_EVAL_USER_ID")
	require.NotEmpty(t, userID)
	outPath := os.Getenv("FOODLINK_VENUE_TRANSITION_OUTPUT")
	require.True(t, filepath.IsAbs(outPath), "explicit private output path required")
	db, err := database.Open(cfg.Database)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	tx := mealEvalReadOnly(t, db, cfg.Database.Schema)
	var readOnly string
	require.NoError(t, tx.Raw("SHOW transaction_read_only").Scan(&readOnly).Error)
	require.Equal(t, "on", readOnly)
	memory := &mealEvalMemoryRepo{StatsRepo: healthrepo.NewStatsRepo(tx)}
	svc := NewStatsService(memory, nil, &cfg)
	base := svc.client.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	capture := &mealEvalTransport{base: base}
	svc.client.Transport = capture
	turns := []mealEvalTurn{}
	defer func() {
		raw, e := json.MarshalIndent(turns, "", "  ")
		require.NoError(t, e)
		require.NoError(t, os.WriteFile(outPath, raw, 0600))
	}()
	questions := append(append([]string{}, mealVenueScreenshotQuestions...), "推荐其他食堂", "其他的呢")
	for i, q := range questions {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
		input := PetChatInput{Question: q, Range: "month", NewSession: memory.session == nil}
		if memory.session != nil {
			input.SessionID = memory.session.ID
		}
		turn := mealEvalTurn{Question: q, RoutedToHarness: svc.shouldUseCampusDietAgent(ctx, userID, input)}
		capture.mu.Lock()
		capture.replies = nil
		capture.mu.Unlock()
		started := time.Now()
		stream, e := svc.GeneratePetChatStream(ctx, userID, input)
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
		require.True(t, turn.RoutedToHarness, q)
		require.Empty(t, turn.Error, q)
		require.NotNil(t, turn.Result, q)
		require.NotEmpty(t, turn.ModelReplies, "must exercise real model")
		options := turn.Result.Recommendation.Recommendations
		require.NotEmpty(t, options, "%s: %s", q, turn.Answer)
		c := turn.Result.Recommendation.AgentConstraints
		require.NotNil(t, c)
		for _, o := range options {
			candidate := DietRecommendationCandidate{SchoolName: o.SchoolName, CanteenName: o.CanteenName, MerchantName: o.MerchantName}
			if i == 0 {
				require.True(t, domain.MatchesDiningVenue("AI原点社区", candidate), "%+v", candidate)
			} else if i < 4 {
				require.True(t, domain.MatchesDiningVenue("清华大学桃李食堂", candidate), "%+v", candidate)
			} else {
				require.False(t, domain.MatchesDiningVenue("清华大学桃李食堂", candidate), "%+v", candidate)
			}
			require.NotEqual(t, "金针菇", o.Title)
			require.NotEqual(t, "玉米粒炒肉末", o.Title)
			if i == 3 || i == 5 {
				for _, previous := range turns[i-1].Result.Recommendation.Recommendations {
					require.NotEqual(t, normalizeMealVarietyName(previous.Title), normalizeMealVarietyName(o.Title), "other dishes must not repeat a catalog alias")
				}
			}
			t.Logf("TURN=%d venue=%s / %s meal=%s", i+1, o.SchoolName, o.CanteenName, o.Title)
		}
		if i >= 4 {
			require.Contains(t, c.ExcludedCanteens, "清华大学桃李食堂")
		}
		require.NotContains(t, turn.Answer, "菜单数据只有这两样")
		t.Logf("TURN=%d seconds=%.1f agent=%t fallback=%s", i+1, turn.DurationSeconds, turn.Result.AgentUsed, turn.Result.FallbackReason)
	}
	require.False(t, svc.shouldUseCampusDietAgent(context.Background(), userID, PetChatInput{Question: "我想洗澡，热水还是冷水？", SessionID: memory.session.ID}))
}
