package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/logger"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"log/slog"
	"strings"
	"time"
)

type mealMemoryRepo interface {
	ListMealRecommendationMemory(context.Context, string, time.Time) ([]domain.MealRecommendationMemory, error)
	SaveMealRecommendationOptions(context.Context, []domain.MealRecommendationMemory) error
	RecordMealRecommendationFeedback(context.Context, string, string, []string, string, time.Time) error
}

type MealRecommendationFeedbackInput struct {
	RunID      string   `json:"run_id"`
	OptionKeys []string `json:"option_keys"`
	Action     string   `json:"action"`
}

func mealDecisionHash(parts ...string) string {
	b, _ := json.Marshal(parts)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func mealPreviewContextKey(state *campusDietAgentRunState) string {
	// Full records matter: equal calories on different meals must still invalidate the snapshot.
	b, _ := json.Marshal(struct {
		Meal            campusDietAgentMealContext
		School          domain.DietRecommendationSchool
		Campus          string
		Location        *domain.DietLocation
		Records         []domain.FoodRecord
		ExplicitSchools []domain.DietRecommendationSchool
		Constraints     CampusDietRecommendationConstraints
	}{state.MealContext, state.School, state.CampusID, nil, state.HistoryRecords, state.ExplicitSchools, state.Constraints})
	location := ""
	if state.Location != nil {
		// Do not include captured_at: a new GPS fix at the same place is not a new diet state.
		location = roundedMealLocation(state.Location)
	}
	return mealDecisionHash(state.EngineVersion, dietMealSelectionPolicyVersion, string(b), location)
}

func (s *StatsService) loadMealPreviewMemory(ctx context.Context, state *campusDietAgentRunState) {
	state.PreviewContextKey = mealPreviewContextKey(state)
	if repo, ok := s.repo.(mealMemoryRepo); ok {
		rows, err := repo.ListMealRecommendationMemory(ctx, state.UserID, time.Now().AddDate(0, 0, -7))
		if err != nil {
			logger.Warn(ctx, "餐食推荐反馈读取失败，使用无反馈排序", logger.UserID(state.UserID), logger.Err(err))
			return
		}
		state.PreviewMemory = rows
	}
}

func (s *StatsService) saveMealPreviewOptions(ctx context.Context, state *campusDietAgentRunState, result *DietRecommendationResult) {
	repo, ok := s.repo.(mealMemoryRepo)
	if !ok || len(result.Recommendations) == 0 {
		return
	}
	keys := []string{state.UserID, state.PreviewContextKey}
	for _, option := range result.Recommendations {
		keys = append(keys, option.Source+":"+option.SourceID)
	}
	runID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(strings.Join(keys, "|"))).String()
	rows := make([]domain.MealRecommendationMemory, 0, len(result.Recommendations))
	for _, option := range result.Recommendations {
		key := mealDecisionHash(option.Source, option.SourceID)
		candidate := DietRecommendationCandidate{Title: option.Title, Items: option.Items, Source: option.Source, SourceID: option.SourceID}
		rows = append(rows, domain.MealRecommendationMemory{ID: uuid.NewSHA1(uuid.NameSpaceOID, []byte(runID+key)).String(), UserID: state.UserID, RunID: runID, ContextKey: state.PreviewContextKey, OptionKey: key, SourceID: option.SourceID, Fingerprint: mealDecisionHash(mealFingerprint(candidate)), Family: mealCandidateFamily(candidate), MealDate: state.MealContext.Date, MealType: state.MealContext.MealType, EngineVersion: result.DecisionEngineVersion, CreatedAt: time.Now().UTC()})
	}
	if err := repo.SaveMealRecommendationOptions(ctx, rows); err != nil {
		logger.Warn(ctx, "餐食推荐反馈暂不可用", logger.UserID(state.UserID), logger.Err(err))
		return
	}
	result.RecommendationID = runID
	for i := range result.Recommendations {
		result.Recommendations[i].OptionKey = rows[i].OptionKey
	}
}

func (s *StatsService) RecordMealRecommendationFeedback(ctx context.Context, userID string, input MealRecommendationFeedbackInput) error {
	if userID == "" {
		return commonerrors.ErrUnauthorized
	}
	if _, err := uuid.Parse(input.RunID); err != nil {
		return commonerrors.ErrBadRequest
	}
	if input.Action != "shown" && input.Action != "skip" && input.Action != "selected" {
		return commonerrors.ErrBadRequest
	}
	if len(input.OptionKeys) == 0 || len(input.OptionKeys) > 3 {
		return commonerrors.ErrBadRequest
	}
	seen := map[string]bool{}
	for _, key := range input.OptionKeys {
		if len(key) != 64 || seen[key] {
			return commonerrors.ErrBadRequest
		}
		if _, err := hex.DecodeString(key); err != nil {
			return commonerrors.ErrBadRequest
		}
		seen[key] = true
	}
	repo, ok := s.repo.(mealMemoryRepo)
	if !ok {
		return commonerrors.ErrNotImplemented
	}
	err := repo.RecordMealRecommendationFeedback(ctx, userID, input.RunID, input.OptionKeys, input.Action, time.Now().UTC())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return commonerrors.ErrNotFound
	}
	if err != nil {
		logger.Error(ctx, "餐食推荐反馈保存失败", err, logger.UserID(userID))
		return err
	}
	logger.Info(ctx, "餐食推荐反馈已保存", logger.UserID(userID), slog.String("action", input.Action), slog.Int("option_count", len(input.OptionKeys)))
	return nil
}
