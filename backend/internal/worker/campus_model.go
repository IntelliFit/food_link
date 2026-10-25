package worker

import (
	"context"

	"food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"
)

func (r *Runner) analyzeWithCampusBudget(ctx context.Context, task *domain.AnalysisTask, input analyzeservice.AnalyzeInput, text bool) (map[string]any, error) {
	if campusPublicFoodSourceType(task.Payload) == "campus_public_food" {
		if campus, ok := r.analyze.(interface {
			AnalyzeCampus(context.Context, string, analyzeservice.AnalyzeInput) (map[string]any, error)
			AnalyzeCampusText(context.Context, string, analyzeservice.AnalyzeInput) (map[string]any, error)
		}); ok {
			if text {
				return campus.AnalyzeCampusText(ctx, task.UserID, input)
			}
			return campus.AnalyzeCampus(ctx, task.UserID, input)
		}
	}
	// Alternate runners (including existing test drivers) keep their interface.
	// The production AnalyzeService implements the campus-only methods above.
	if text {
		return r.analyze.AnalyzeText(ctx, task.UserID, input)
	}
	return r.analyze.Analyze(ctx, task.UserID, input)
}
