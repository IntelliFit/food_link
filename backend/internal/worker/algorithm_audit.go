package worker

import (
	"context"
	"log/slog"
	"math"
	"reflect"
	"strings"

	"food_link/backend/internal/analyze/domain"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
	apm "food_link/backend/pkg/trace"

	"go.opentelemetry.io/otel/attribute"
)

type algorithmResultSummary struct {
	items, previous, changed, unresolved, missingWeight, missingState int
	sources                                                           map[string]int
}

func summarizeAlgorithmResult(task *domain.AnalysisTask, result map[string]any) algorithmResultSummary {
	items := extractItems(result["items"])
	if len(items) == 0 {
		if item := mapFromAny(result["item"]); len(item) > 0 {
			items = []map[string]any{item}
		}
	}
	previous := extractItems(mapFromAny(task.Payload["previousResult"])["items"])
	summary := algorithmResultSummary{items: len(items), previous: len(previous), sources: map[string]int{}}
	for _, item := range items {
		weight, _ := firstPositiveFloat(item, "estimatedWeightGrams", "weight")
		if weight <= 0 {
			summary.missingWeight++
		}
		if isUnresolvedNutrition(item) {
			summary.unresolved++
		}
		state := firstNonEmptyString(item, "foodState", "food_state")
		basis := firstNonEmptyString(item, "weightBasis", "weight_basis")
		if state == "" || state == "unknown" || basis == "" || basis == "unknown" {
			summary.missingState++
		}
		source := firstNonEmptyString(item, "nutrition_source", "nutrition_source_category")
		if source == "" {
			source = "unreported"
		}
		switch {
		case strings.HasPrefix(source, "library_"):
			source = "library"
		case source == "ai_direct", source == "legacy_direct", source == "qwen_generated", source == "gemini_generated", source == "deepseek_generated", source == "user_correction_context", source == "unreported", source == "unresolved":
		default:
			source = "other"
		}
		summary.sources[source]++
	}
	// nil means no result was persisted (e.g. failed correction), not that all
	// previous items were deleted. Compare identity before array position so a
	// deletion or reordering does not turn every following item into a change.
	if result != nil && len(previous) > 0 {
		summary.changed = countAlgorithmItemChanges(previous, items)
	}
	return summary
}

func countAlgorithmItemChanges(previous, current []map[string]any) int {
	used := make([]bool, len(previous))
	changed, unmatched := 0, 0
	for _, item := range current {
		match := -1
		id := firstNonEmptyString(item, "itemId", "sourceItemId", "item_key")
		for index, old := range previous {
			if used[index] {
				continue
			}
			oldID := firstNonEmptyString(old, "itemId", "sourceItemId", "item_key")
			if (id != "" && oldID == id) || (id == "" && normalizeScopedName(firstNonEmptyString(item, "name")) == normalizeScopedName(firstNonEmptyString(old, "name"))) {
				match = index
				break
			}
		}
		if match < 0 {
			unmatched++
			continue
		}
		used[match] = true
		old := previous[match]
		weight, _ := firstPositiveFloat(item, "estimatedWeightGrams", "weight")
		oldWeight, _ := firstPositiveFloat(old, "estimatedWeightGrams", "weight")
		if normalizeScopedName(firstNonEmptyString(item, "name")) != normalizeScopedName(firstNonEmptyString(old, "name")) || math.Abs(weight-oldWeight) > 0.001 || !reflect.DeepEqual(mapFromAny(item["nutrients"]), mapFromAny(old["nutrients"])) {
			changed++
		}
	}
	removed := 0
	for _, matched := range used {
		if !matched {
			removed++
		}
	}
	// Without stable IDs a rename is indistinguishable from a remove/add pair.
	// Count that pair once. This is an execution difference, not semantic truth.
	if removed > unmatched {
		unmatched = removed
	}
	return changed + unmatched
}

// Emit only after the attempt's terminal state is persisted. Success here is
// completion of checks, not a claim that a photo's food or nutrition is correct.
func recordAlgorithmOutcome(ctx context.Context, task *domain.AnalysisTask, result map[string]any, outcome string) {
	if task == nil || (task.TaskType != "food" && task.TaskType != "food_text" && !strings.HasPrefix(task.TaskType, "precision_")) {
		return
	}
	summary := summarizeAlgorithmResult(task, result)
	mode := firstNonEmptyString(task.Payload, "execution_mode")
	engine := firstNonEmptyString(result, "analysis_engine")
	if engine == "" {
		engine = firstNonEmptyString(task.Payload, "analysis_engine")
	}
	metrics.ObserveAlgorithmGate(ctx, mode, engine, "task_outcome", outcome)
	metrics.ObserveAlgorithmResult(ctx, mode, engine, task.TaskType, "total", summary.items)
	metrics.ObserveAlgorithmResult(ctx, mode, engine, task.TaskType, "unresolved", summary.unresolved)
	metrics.ObserveAlgorithmResult(ctx, mode, engine, task.TaskType, "missing_weight", summary.missingWeight)
	metrics.ObserveAlgorithmResult(ctx, mode, engine, task.TaskType, "missing_state", summary.missingState)
	attrs := []attribute.KeyValue{
		attribute.String("analysis.audit_version", "1"), attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.execution_mode", mode), attribute.String("analysis.engine", engine),
		attribute.String("analysis.outcome", outcome), attribute.Int("analysis.item_count", summary.items),
		attribute.Int("analysis.previous_item_count", summary.previous), attribute.Int("analysis.changed_item_count", summary.changed),
		attribute.Int("analysis.unresolved_count", summary.unresolved), attribute.Int("analysis.missing_weight_count", summary.missingWeight),
		attribute.Int("analysis.missing_state_count", summary.missingState),
	}
	apm.SetAttributes(ctx, attrs...)
	apm.AddEvent(ctx, "食物算法执行摘要", attrs...)
	logger.Info(ctx, "食物算法执行摘要", slog.String("audit_version", "1"), slog.String("task_id", task.ID),
		slog.String("attempt_id", stringPtrValue(task.AttemptID)), slog.String("task_type", task.TaskType),
		slog.String("execution_mode", mode), slog.String("analysis_engine", engine), slog.String("outcome", outcome),
		slog.String("model", firstNonEmptyString(result, "model_name")), slog.Int("item_count", summary.items),
		slog.Int("previous_item_count", summary.previous), slog.Int("changed_item_count", summary.changed),
		slog.Int("unresolved_count", summary.unresolved), slog.Int("missing_weight_count", summary.missingWeight),
		slog.Int("missing_state_count", summary.missingState), slog.Any("nutrition_sources", summary.sources))
}
