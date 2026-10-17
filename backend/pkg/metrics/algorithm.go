package metrics

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var algorithmGates = mustInstrument(meter.Int64Counter("food_link_algorithm_gates", metric.WithDescription("Algorithm contract gate outcomes; these measure checks, not nutritional accuracy.")))
var algorithmResultItems = mustInstrument(meter.Int64Counter("food_link_algorithm_result_items", metric.WithDescription("Persisted result items and reported quality conditions; child tasks must be separated from final results.")))

// IDs, food names and raw instructions must never become metric labels.
func ObserveAlgorithmGate(ctx context.Context, mode, engine, gate, outcome string) {
	algorithmGates.Add(ctx, 1, metric.WithAttributes(
		attribute.String("execution_mode", boundedAlgorithmLabel(mode, "fast", "standard", "strict", "strict_separate", "strict_video", "standard_web_search", "strict_web_search", "standard_packaged_experiment", "lite", "fast_web_search")),
		attribute.String("analysis_engine", boundedAlgorithmLabel(engine, "ai_direct", "legacy_direct", "db_first", "ai_then_db_exact", "db_candidates_ai")),
		attribute.String("gate", boundedAlgorithmLabel(gate, "correction_instructions", "correction_effect", "precision_identity", "precision_refinement", "nutrition_fallback", "micronutrient_fields", "resolved_nutrition", "task_outcome")),
		attribute.String("outcome", boundedAlgorithmLabel(outcome, "passed", "rejected", "ambiguous", "unavailable", "failed", "done")),
	))
}

func ObserveAlgorithmResult(ctx context.Context, mode, engine, taskType, condition string, count int) {
	if count <= 0 {
		return
	}
	algorithmResultItems.Add(ctx, int64(count), metric.WithAttributes(
		attribute.String("execution_mode", boundedAlgorithmLabel(mode, "fast", "standard", "strict", "strict_separate", "strict_video", "standard_web_search", "strict_web_search", "standard_packaged_experiment", "lite", "fast_web_search")),
		attribute.String("analysis_engine", boundedAlgorithmLabel(engine, "ai_direct", "legacy_direct", "db_first", "ai_then_db_exact", "db_candidates_ai")),
		attribute.String("task_type", boundedAlgorithmLabel(taskType, "food", "food_text", "precision_plan", "precision_item_estimate", "precision_aggregate")),
		attribute.String("condition", boundedAlgorithmLabel(condition, "total", "unresolved", "missing_weight", "missing_state")),
	))
}

func boundedAlgorithmLabel(value string, allowed ...string) string {
	for _, candidate := range allowed {
		if value == candidate {
			return value
		}
	}
	return "other"
}
