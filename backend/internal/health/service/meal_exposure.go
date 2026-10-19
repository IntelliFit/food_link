package service

import (
	"context"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/logger"
	"github.com/google/uuid"
)

// mealExposureIndex answers "on how many different days was this dish put in front
// of the user recently?" from the stored recommendation memory. It matches by
// catalog id, option key and name fingerprint, so a re-imported dish is still
// recognised. Exposure only breaks near-ties between equally healthy options; it
// never lifts a meal outside the nutrition band.
type mealExposureIndex struct {
	shown   map[string]map[string]bool
	skipped map[string]bool
}

// exposureIndex builds the index once per distinct memory and meal; ranking asks for it many times.
func (state *campusDietAgentRunState) exposureIndex() mealExposureIndex {
	key := strings.Join([]string{strconv.Itoa(len(state.PreviewMemory)), state.MealContext.Date, state.MealContext.MealType}, "|")
	if state.exposureCache != nil && state.exposureKey == key {
		return *state.exposureCache
	}
	index := newMealExposureIndex(state)
	state.exposureCache, state.exposureKey = &index, key
	return index
}

func newMealExposureIndex(state *campusDietAgentRunState) mealExposureIndex {
	index := mealExposureIndex{shown: map[string]map[string]bool{}, skipped: map[string]bool{}}
	for _, row := range state.PreviewMemory {
		keys := []string{row.SourceID, row.OptionKey, row.Fingerprint}
		if row.ShownAt != nil || row.SelectedAt != nil {
			for _, key := range keys {
				if key == "" {
					continue
				}
				if index.shown[key] == nil {
					index.shown[key] = map[string]bool{}
				}
				index.shown[key][row.MealDate] = true
			}
		}
		// A dish the user waved away for this very meal stays out of it.
		if row.SkippedAt != nil && row.MealDate == state.MealContext.Date && row.MealType == state.MealContext.MealType {
			for _, key := range keys {
				if key != "" {
					index.skipped[key] = true
				}
			}
		}
	}
	return index
}

func mealExposureKeys(c DietRecommendationCandidate) []string {
	return []string{c.SourceID, mealDecisionHash(c.Source, c.SourceID), mealDecisionHash(mealFingerprint(c))}
}

// shownDays is the number of distinct days on which the dish was recommended.
func (x mealExposureIndex) shownDays(c DietRecommendationCandidate) int {
	days := map[string]bool{}
	for _, key := range mealExposureKeys(c) {
		for day := range x.shown[key] {
			days[day] = true
		}
	}
	return len(days)
}

func (x mealExposureIndex) wasSkipped(c DietRecommendationCandidate) bool {
	for _, key := range mealExposureKeys(c) {
		if x.skipped[key] {
			return true
		}
	}
	return false
}

// loadChatMealMemory reads the recent recommendation memory once per run so a new
// chat does not offer exactly what the home card or an earlier chat just showed.
func (s *StatsService) loadChatMealMemory(ctx context.Context, state *campusDietAgentRunState) {
	if state.ExposureLoaded || state.IsHomePreview || state.ReadOnlyReplay || !campusDietAgentIsSearchIntent(state.Intent) {
		return
	}
	state.ExposureLoaded = true
	s.loadMealPreviewMemory(ctx, state)
}

// recordChatMealExposure remembers what a chat answer put on the user's screen:
// each offered meal and every dish it is made of except the staple. A chat answer is shown the
// moment it is saved, so the rows are stored as already shown. A memory failure
// never fails the chat.
func (s *StatsService) recordChatMealExposure(ctx context.Context, state *campusDietAgentRunState, result *CampusDietAgentResult) {
	repo, ok := s.repo.(mealMemoryRepo)
	if !ok || result == nil || !state.MealContextLoaded || !campusDietAgentIsSearchIntent(state.Intent) || result.Recommendation.NeedsClarification {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	now := time.Now().UTC()
	runID := state.RunID
	if _, err := uuid.Parse(runID); err != nil {
		runID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(runID)).String()
	}
	seen := map[string]bool{}
	rows := []domain.MealRecommendationMemory{}
	// The home card's own selected dish is the card the user came from; recording it as
	// shown elsewhere would make that card re-roll away from it on its next refresh.
	homeSelected := homeSelectedMealID(state)
	add := func(candidate DietRecommendationCandidate) {
		key := mealDecisionHash(candidate.Source, candidate.SourceID)
		if candidate.SourceID == "" || candidate.SourceID == homeSelected || seen[key] {
			return
		}
		seen[key] = true
		shown := now
		rows = append(rows, domain.MealRecommendationMemory{
			ID: uuid.NewSHA1(uuid.NameSpaceOID, []byte(runID+key)).String(), UserID: state.UserID, RunID: runID,
			ContextKey: state.PreviewContextKey, OptionKey: key, SourceID: candidate.SourceID,
			Fingerprint: mealDecisionHash(mealFingerprint(candidate)), Family: mealCandidateFamily(candidate),
			MealDate: state.MealContext.Date, MealType: state.MealContext.MealType,
			EngineVersion: result.Recommendation.DecisionEngineVersion, CreatedAt: now, ShownAt: &shown,
		})
	}
	for _, option := range result.Recommendation.Recommendations {
		if option.Source == "food_record" {
			continue
		}
		add(DietRecommendationCandidate{Source: option.Source, SourceID: option.SourceID, Title: option.Title, Items: option.Items})
		for _, component := range option.MealComponents {
			if mealComboRoleOf(component) != mealRoleStaple { // staples never rotate; keep the memory small
				add(component)
			}
		}
	}
	if len(rows) == 0 {
		return
	}
	if err := repo.SaveMealRecommendationOptions(ctx, rows); err != nil {
		logger.Warn(ctx, "聊天餐食曝光记录暂不可用", logger.UserID(state.UserID), slog.String("agent_run_id", state.RunID), logger.Err(err))
	}
}
