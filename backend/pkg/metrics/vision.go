package metrics

import (
	"context"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var (
	visionChannelCalls    = mustInstrument(meter.Int64Counter("food_link_vision_channel_calls", metric.WithDescription("Business validated vision channel attempts, including shadows and cancellations.")))
	visionChannelDuration = mustInstrument(meter.Float64Histogram("food_link_vision_channel_duration_seconds", metric.WithUnit("s"), metric.WithExplicitBucketBoundaries(1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 35, 45, 60)))
	visionChannelTokens   = mustInstrument(meter.Int64Counter("food_link_vision_channel_tokens", metric.WithDescription("Reported tokens; canceled requests may still be billed without reporting usage.")))
	visionComparisons     = mustInstrument(meter.Int64Counter("food_link_vision_shadow_comparisons", metric.WithDescription("Exact name agreement is a review signal, not an accuracy label.")))
	analysisPhaseDuration = mustInstrument(meter.Float64Histogram("food_link_analysis_phase_duration_seconds", metric.WithUnit("s"), metric.WithExplicitBucketBoundaries(.01, .1, .5, 1, 2, 4, 6, 8, 10, 15, 20, 30, 60)))
)

func ObserveVisionChannel(ctx context.Context, mode, stage, upstream, model, status string, shadow bool, duration time.Duration, inputTokens, outputTokens int64) {
	attrs := []attribute.KeyValue{attribute.String("execution_mode", normalizeLabel(mode, "unknown")), attribute.String("stage", stage), attribute.String("upstream", upstream), attribute.String("model", model), attribute.String("status", status), attribute.Bool("shadow", shadow)}
	visionChannelCalls.Add(ctx, 1, metric.WithAttributes(attrs...))
	visionChannelDuration.Record(ctx, duration.Seconds(), metric.WithAttributes(attrs...))
	visionChannelTokens.Add(ctx, inputTokens, metric.WithAttributes(append(attrs, attribute.String("direction", "input"))...))
	visionChannelTokens.Add(ctx, outputTokens, metric.WithAttributes(append(attrs, attribute.String("direction", "output"))...))
}

func ObserveVisionComparison(ctx context.Context, mode, model, comparison string) {
	visionComparisons.Add(ctx, 1, metric.WithAttributes(attribute.String("execution_mode", normalizeLabel(mode, "unknown")), attribute.String("model", model), attribute.String("comparison", comparison)))
}

func ObserveAnalysisPhase(ctx context.Context, mode, phase string, duration time.Duration) {
	analysisPhaseDuration.Record(ctx, duration.Seconds(), metric.WithAttributes(attribute.String("execution_mode", mode), attribute.String("phase", phase)))
}
