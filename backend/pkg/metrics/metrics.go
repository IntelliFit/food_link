package metrics

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const meterName = "food_link/backend"

var meter = otel.Meter(meterName)

var (
	httpRequests = mustInstrument(meter.Int64Counter(
		"food_link_http_requests",
		metric.WithDescription("Total HTTP requests handled by the Go backend."),
	))
	httpRequestDuration = mustInstrument(meter.Float64Histogram(
		"food_link_http_request_duration_seconds",
		metric.WithDescription("HTTP request duration in seconds."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60),
	))
	httpRequestSize = mustInstrument(meter.Int64Histogram(
		"food_link_http_request_size_bytes",
		metric.WithDescription("HTTP request body size in bytes when Content-Length is available."),
		metric.WithUnit("By"),
		metric.WithExplicitBucketBoundaries(0, 512, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216),
	))
	httpResponseSize = mustInstrument(meter.Int64Histogram(
		"food_link_http_response_size_bytes",
		metric.WithDescription("HTTP response size in bytes when reported by Gin."),
		metric.WithUnit("By"),
		metric.WithExplicitBucketBoundaries(0, 512, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216),
	))
	httpInFlight = mustInstrument(meter.Int64ObservableGauge(
		"food_link_http_in_flight_requests",
		metric.WithDescription("Currently executing HTTP requests by method."),
	))

	dbUp = mustInstrument(meter.Int64ObservableGauge(
		"food_link_db_up",
		metric.WithDescription("Database connection status checked at collection time, 1 means ping succeeded."),
	))
	dbOpenConnections = mustInstrument(meter.Int64ObservableGauge(
		"food_link_db_open_connections",
		metric.WithDescription("Number of established database connections."),
	))
	dbInUseConnections = mustInstrument(meter.Int64ObservableGauge(
		"food_link_db_in_use_connections",
		metric.WithDescription("Number of database connections currently in use."),
	))
	dbIdleConnections = mustInstrument(meter.Int64ObservableGauge(
		"food_link_db_idle_connections",
		metric.WithDescription("Number of idle database connections."),
	))
	dbMaxOpenConnections = mustInstrument(meter.Int64ObservableGauge(
		"food_link_db_max_open_connections",
		metric.WithDescription("Configured maximum number of open database connections."),
	))
	dbWaitCount = mustInstrument(meter.Int64ObservableCounter(
		"food_link_db_wait_count",
		metric.WithDescription("Total number of waits for a database connection."),
	))
	dbWaitDuration = mustInstrument(meter.Float64ObservableCounter(
		"food_link_db_wait_duration_seconds",
		metric.WithDescription("Total time blocked waiting for a database connection."),
		metric.WithUnit("s"),
	))
	dbOperations = mustInstrument(meter.Int64Counter(
		"food_link_db_operations",
		metric.WithDescription("Total GORM database operations by operation/table/status."),
	))
	dbOperationDuration = mustInstrument(meter.Float64Histogram(
		"food_link_db_operation_duration_seconds",
		metric.WithDescription("GORM database operation duration in seconds."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
	))
	dbPing = mustInstrument(meter.Int64Counter(
		"food_link_db_ping",
		metric.WithDescription("Total explicit database ping checks."),
	))
	dbPingDuration = mustInstrument(meter.Float64Histogram(
		"food_link_db_ping_duration_seconds",
		metric.WithDescription("Explicit database ping duration in seconds."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
	))

	taskQueueInfo = mustInstrument(meter.Int64ObservableGauge(
		"food_link_task_queue_info",
		metric.WithDescription("Task queue configuration info. Value is always 1 for the active queue."),
	))
	taskQueueComponentUp = mustInstrument(meter.Int64ObservableGauge(
		"food_link_task_queue_component_up",
		metric.WithDescription("Task queue component status, 1 means last observed operation was healthy."),
	))
	taskQueuePublish = mustInstrument(meter.Int64Counter(
		"food_link_task_queue_publish",
		metric.WithDescription("Total task queue publish attempts."),
	))
	taskQueuePublishDuration = mustInstrument(meter.Float64Histogram(
		"food_link_task_queue_publish_duration_seconds",
		metric.WithDescription("Task queue publish duration in seconds."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
	))
	taskQueueDeliveries = mustInstrument(meter.Int64Counter(
		"food_link_task_queue_deliveries",
		metric.WithDescription("Total task queue deliveries emitted to workers."),
	))
	taskQueueDeliveryAge = mustInstrument(meter.Float64Histogram(
		"food_link_task_queue_delivery_age_seconds",
		metric.WithDescription("Age of a task queue message when delivered to a worker."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1800),
	))
	taskQueueSettled = mustInstrument(meter.Int64Counter(
		"food_link_task_queue_settled",
		metric.WithDescription("Total task queue delivery settlement attempts by outcome."),
	))
	taskQueueDepth = mustInstrument(meter.Int64ObservableGauge(
		"food_link_task_queue_depth",
		metric.WithDescription("Current in-process queue depth where available. Kafka backlog should be read from Kafka exporter."),
	))

	workerConfigured = mustInstrument(meter.Int64ObservableGauge(
		"food_link_worker_configured",
		metric.WithDescription("Configured embedded worker concurrency."),
	))
	workerLoopsActive = mustInstrument(meter.Int64ObservableGauge(
		"food_link_worker_loops_active",
		metric.WithDescription("Currently active worker subscription loops."),
	))
	workerTaskClaims = mustInstrument(meter.Int64Counter(
		"food_link_worker_task_claims",
		metric.WithDescription("Total worker task claim outcomes."),
	))
	workerTasksActive = mustInstrument(meter.Int64ObservableGauge(
		"food_link_worker_tasks_active",
		metric.WithDescription("Currently processing worker tasks."),
	))
	workerTaskDuration = mustInstrument(meter.Float64Histogram(
		"food_link_worker_task_duration_seconds",
		metric.WithDescription("Worker task processing duration in seconds."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(0.1, 0.5, 1, 2.5, 5, 10, 20, 30, 60, 120, 180, 300, 600),
	))
	workerLeaseHeartbeats = mustInstrument(meter.Int64Counter(
		"food_link_worker_lease_heartbeats",
		metric.WithDescription("Total worker task lease heartbeat outcomes."),
	))
	workerRecoveredTasks = mustInstrument(meter.Int64Counter(
		"food_link_worker_recovered_tasks",
		metric.WithDescription("Total recovery-loop candidate/published/failed task counts."),
	))

	llmCalls = mustInstrument(meter.Int64Counter(
		"food_link_llm_calls",
		metric.WithDescription("Total external LLM calls used by food/exercise analysis."),
	))
	llmCallDuration = mustInstrument(meter.Float64Histogram(
		"food_link_llm_call_duration_seconds",
		metric.WithDescription("External LLM call duration in seconds."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 45, 60, 90, 120),
	))
	llmRetries = mustInstrument(meter.Int64Counter(
		"food_link_llm_retries",
		metric.WithDescription("Total same-task LLM retries."),
	))
	foodAnalysis = mustInstrument(meter.Int64Counter(
		"food_link_food_analysis",
		metric.WithDescription("Total food analysis attempts."),
	))
	foodAnalysisDuration = mustInstrument(meter.Float64Histogram(
		"food_link_food_analysis_duration_seconds",
		metric.WithDescription("Food analysis total duration in seconds."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(0.5, 1, 2.5, 5, 10, 20, 30, 45, 60, 90, 120, 180),
	))
	foodAnalysisItems = mustInstrument(meter.Int64Histogram(
		"food_link_food_analysis_items",
		metric.WithDescription("Number of food items returned by one analysis."),
		metric.WithUnit("{item}"),
		metric.WithExplicitBucketBoundaries(0, 1, 2, 3, 5, 8, 13, 21),
	))
	nutritionResolveItems = mustInstrument(meter.Int64Counter(
		"food_link_nutrition_resolve_items",
		metric.WithDescription("Total food items by nutrition resolution outcome."),
	))
	nutritionResolveDuration = mustInstrument(meter.Float64Histogram(
		"food_link_nutrition_resolve_duration_seconds",
		metric.WithDescription("DB-first nutrition resolution duration in seconds."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30),
	))
	exerciseAnalysis = mustInstrument(meter.Int64Counter(
		"food_link_exercise_analysis",
		metric.WithDescription("Total exercise analysis attempts."),
	))
	exerciseAnalysisDuration = mustInstrument(meter.Float64Histogram(
		"food_link_exercise_analysis_duration_seconds",
		metric.WithDescription("Exercise analysis duration in seconds."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(0.1, 0.5, 1, 2.5, 5, 10, 20, 30, 45, 60, 90, 120),
	))
)

var (
	httpInFlightStore         = newGaugeStore()
	taskQueueInfoStore        = newGaugeStore()
	taskQueueComponentUpStore = newGaugeStore()
	taskQueueDepthStore       = newGaugeStore()
	workerConfiguredStore     = newGaugeStore()
	workerLoopsActiveStore    = newGaugeStore()
	workerTasksActiveStore    = newGaugeStore()
	defaultDBRegistry         = newDBRegistry()

	asyncRegistration = mustRegistration(meter.RegisterCallback(
		observeAsyncMetrics,
		httpInFlight,
		dbUp,
		dbOpenConnections,
		dbInUseConnections,
		dbIdleConnections,
		dbMaxOpenConnections,
		dbWaitCount,
		dbWaitDuration,
		taskQueueInfo,
		taskQueueComponentUp,
		taskQueueDepth,
		workerConfigured,
		workerLoopsActive,
		workerTasksActive,
	))
)

func ObserveHTTP(method, route string, statusCode int, duration time.Duration, requestBytes, responseBytes int64) {
	ctx := context.Background()
	method = normalizeLabel(method, "unknown")
	route = normalizeRoute(route)
	status := strconv.Itoa(statusCode)
	attrs := metric.WithAttributes(
		attribute.String("method", method),
		attribute.String("route", route),
		attribute.String("status", status),
	)
	httpRequests.Add(ctx, 1, attrs)
	httpRequestDuration.Record(ctx, duration.Seconds(), attrs)
	if requestBytes >= 0 {
		httpRequestSize.Record(ctx, requestBytes, metric.WithAttributes(
			attribute.String("method", method),
			attribute.String("route", route),
		))
	}
	if responseBytes >= 0 {
		httpResponseSize.Record(ctx, responseBytes, attrs)
	}
}

func IncHTTPInFlight(method string) {
	method = normalizeLabel(method, "unknown")
	httpInFlightStore.add(method, 1, attribute.String("method", method))
}

func DecHTTPInFlight(method string) {
	method = normalizeLabel(method, "unknown")
	httpInFlightStore.add(method, -1, attribute.String("method", method))
}

func ObserveDBOperation(operation, table, status string, duration time.Duration) {
	ctx := context.Background()
	operation = normalizeLabel(operation, "unknown")
	table = normalizeTable(table)
	status = normalizeLabel(status, "unknown")
	attrs := metric.WithAttributes(
		attribute.String("operation", operation),
		attribute.String("table", table),
		attribute.String("status", status),
	)
	dbOperations.Add(ctx, 1, attrs)
	dbOperationDuration.Record(ctx, duration.Seconds(), attrs)
}

func ObserveDBPing(driver, status string, duration time.Duration) {
	ctx := context.Background()
	driver = normalizeLabel(driver, "unknown")
	status = normalizeLabel(status, "unknown")
	attrs := metric.WithAttributes(attribute.String("driver", driver), attribute.String("status", status))
	dbPing.Add(ctx, 1, attrs)
	dbPingDuration.Record(ctx, duration.Seconds(), attrs)
}

func RegisterDatabase(name string, db *sql.DB) {
	defaultDBRegistry.set(name, db)
}

func SetTaskQueueInfo(driver, topic, consumerGroup string) {
	driver = normalizeLabel(driver, "unknown")
	topic = normalizeLabel(topic, "none")
	consumerGroup = normalizeLabel(consumerGroup, "none")
	taskQueueInfoStore.set(gaugeKey(driver, topic, consumerGroup), 1,
		attribute.String("driver", driver),
		attribute.String("topic", topic),
		attribute.String("consumer_group", consumerGroup),
	)
}

func SetTaskQueueComponentUp(driver, component string, up bool) {
	driver = normalizeLabel(driver, "unknown")
	component = normalizeLabel(component, "unknown")
	value := int64(0)
	if up {
		value = 1
	}
	taskQueueComponentUpStore.set(gaugeKey(driver, component), value,
		attribute.String("driver", driver),
		attribute.String("component", component),
	)
}

func ObserveTaskQueuePublish(driver, taskType, status string, duration time.Duration) {
	ctx := context.Background()
	driver = normalizeLabel(driver, "unknown")
	taskType = normalizeLabel(taskType, "unknown")
	status = normalizeLabel(status, "unknown")
	attrs := metric.WithAttributes(
		attribute.String("driver", driver),
		attribute.String("task_type", taskType),
		attribute.String("status", status),
	)
	taskQueuePublish.Add(ctx, 1, attrs)
	taskQueuePublishDuration.Record(ctx, duration.Seconds(), attrs)
}

func ObserveTaskQueueDelivery(driver, taskType string, age time.Duration) {
	ctx := context.Background()
	driver = normalizeLabel(driver, "unknown")
	taskType = normalizeLabel(taskType, "unknown")
	attrs := metric.WithAttributes(attribute.String("driver", driver), attribute.String("task_type", taskType))
	taskQueueDeliveries.Add(ctx, 1, attrs)
	if age >= 0 {
		taskQueueDeliveryAge.Record(ctx, age.Seconds(), attrs)
	}
}

func ObserveTaskQueueSettlement(driver, taskType, outcome string) {
	taskQueueSettled.Add(context.Background(), 1, metric.WithAttributes(
		attribute.String("driver", normalizeLabel(driver, "unknown")),
		attribute.String("task_type", normalizeLabel(taskType, "unknown")),
		attribute.String("outcome", normalizeLabel(outcome, "unknown")),
	))
}

func SetTaskQueueDepth(driver, queue string, depth int) {
	driver = normalizeLabel(driver, "unknown")
	queue = normalizeLabel(queue, "default")
	taskQueueDepthStore.set(gaugeKey(driver, queue), int64(depth),
		attribute.String("driver", driver),
		attribute.String("queue", queue),
	)
}

func SetWorkerConfigured(queueDriver string, count int) {
	queueDriver = normalizeLabel(queueDriver, "unknown")
	workerConfiguredStore.set(queueDriver, int64(count), attribute.String("queue_driver", queueDriver))
}

func IncWorkerLoop(queueDriver string) {
	queueDriver = normalizeLabel(queueDriver, "unknown")
	workerLoopsActiveStore.add(queueDriver, 1, attribute.String("queue_driver", queueDriver))
}

func DecWorkerLoop(queueDriver string) {
	queueDriver = normalizeLabel(queueDriver, "unknown")
	workerLoopsActiveStore.add(queueDriver, -1, attribute.String("queue_driver", queueDriver))
}

func ObserveWorkerTaskClaim(taskType, outcome string) {
	workerTaskClaims.Add(context.Background(), 1, metric.WithAttributes(
		attribute.String("task_type", normalizeLabel(taskType, "unknown")),
		attribute.String("outcome", normalizeLabel(outcome, "unknown")),
	))
}

func IncWorkerTask(taskType string) {
	taskType = normalizeLabel(taskType, "unknown")
	workerTasksActiveStore.add(taskType, 1, attribute.String("task_type", taskType))
}

func DecWorkerTask(taskType string) {
	taskType = normalizeLabel(taskType, "unknown")
	workerTasksActiveStore.add(taskType, -1, attribute.String("task_type", taskType))
}

func ObserveWorkerTask(taskType, status string, duration time.Duration) {
	workerTaskDuration.Record(context.Background(), duration.Seconds(), metric.WithAttributes(
		attribute.String("task_type", normalizeLabel(taskType, "unknown")),
		attribute.String("status", normalizeLabel(status, "unknown")),
	))
}

func ObserveWorkerLeaseHeartbeat(taskType, status string) {
	workerLeaseHeartbeats.Add(context.Background(), 1, metric.WithAttributes(
		attribute.String("task_type", normalizeLabel(taskType, "unknown")),
		attribute.String("status", normalizeLabel(status, "unknown")),
	))
}

func AddWorkerRecoveredTasks(taskType, status string, count int) {
	if count <= 0 {
		return
	}
	workerRecoveredTasks.Add(context.Background(), int64(count), metric.WithAttributes(
		attribute.String("task_type", normalizeLabel(taskType, "unknown")),
		attribute.String("status", normalizeLabel(status, "unknown")),
	))
}

func ObserveLLMCall(stage, provider, model, status string, duration time.Duration) {
	ctx := context.Background()
	stage = normalizeLabel(stage, "unknown")
	provider = normalizeLabel(provider, "unknown")
	model = normalizeLabel(model, "unknown")
	status = normalizeLabel(status, "unknown")
	attrs := metric.WithAttributes(
		attribute.String("stage", stage),
		attribute.String("provider", provider),
		attribute.String("model", model),
		attribute.String("status", status),
	)
	llmCalls.Add(ctx, 1, attrs)
	llmCallDuration.Record(ctx, duration.Seconds(), attrs)
}

func ObserveLLMRetry(stage, provider, model, reason string) {
	llmRetries.Add(context.Background(), 1, metric.WithAttributes(
		attribute.String("stage", normalizeLabel(stage, "unknown")),
		attribute.String("provider", normalizeLabel(provider, "unknown")),
		attribute.String("model", normalizeLabel(model, "unknown")),
		attribute.String("reason", normalizeLabel(reason, "unknown")),
	))
}

func ObserveFoodAnalysis(source, provider, model, status string, duration time.Duration, itemCount int) {
	ctx := context.Background()
	source = normalizeLabel(source, "unknown")
	provider = normalizeLabel(provider, "unknown")
	model = normalizeLabel(model, "unknown")
	status = normalizeLabel(status, "unknown")
	attrs := metric.WithAttributes(
		attribute.String("source", source),
		attribute.String("provider", provider),
		attribute.String("model", model),
		attribute.String("status", status),
	)
	foodAnalysis.Add(ctx, 1, attrs)
	foodAnalysisDuration.Record(ctx, duration.Seconds(), attrs)
	if itemCount >= 0 {
		foodAnalysisItems.Record(ctx, int64(itemCount), metric.WithAttributes(
			attribute.String("source", source),
			attribute.String("provider", provider),
			attribute.String("model", model),
		))
	}
}

func AddNutritionResolveItems(engine, status string, count int) {
	if count <= 0 {
		return
	}
	nutritionResolveItems.Add(context.Background(), int64(count), metric.WithAttributes(
		attribute.String("engine", normalizeLabel(engine, "unknown")),
		attribute.String("status", normalizeLabel(status, "unknown")),
	))
}

func ObserveNutritionResolve(engine, status string, duration time.Duration) {
	nutritionResolveDuration.Record(context.Background(), duration.Seconds(), metric.WithAttributes(
		attribute.String("engine", normalizeLabel(engine, "unknown")),
		attribute.String("status", normalizeLabel(status, "unknown")),
	))
}

func ObserveExerciseAnalysis(stage, source, status string, duration time.Duration) {
	ctx := context.Background()
	stage = normalizeLabel(stage, "unknown")
	source = normalizeLabel(source, "unknown")
	status = normalizeLabel(status, "unknown")
	attrs := metric.WithAttributes(
		attribute.String("stage", stage),
		attribute.String("source", source),
		attribute.String("status", status),
	)
	exerciseAnalysis.Add(ctx, 1, attrs)
	exerciseAnalysisDuration.Record(ctx, duration.Seconds(), attrs)
}

type gaugeValue struct {
	value int64
	attrs []attribute.KeyValue
}

type gaugeStore struct {
	mu     sync.RWMutex
	values map[string]gaugeValue
}

func newGaugeStore() *gaugeStore {
	return &gaugeStore{values: map[string]gaugeValue{}}
}

func (s *gaugeStore) set(key string, value int64, attrs ...attribute.KeyValue) {
	s.mu.Lock()
	s.values[key] = gaugeValue{value: value, attrs: cloneAttrs(attrs)}
	s.mu.Unlock()
}

func (s *gaugeStore) add(key string, delta int64, attrs ...attribute.KeyValue) {
	s.mu.Lock()
	current := s.values[key]
	current.value += delta
	if current.attrs == nil {
		current.attrs = cloneAttrs(attrs)
	}
	s.values[key] = current
	s.mu.Unlock()
}

func (s *gaugeStore) snapshot() []gaugeValue {
	s.mu.RLock()
	out := make([]gaugeValue, 0, len(s.values))
	for _, value := range s.values {
		out = append(out, gaugeValue{value: value.value, attrs: cloneAttrs(value.attrs)})
	}
	s.mu.RUnlock()
	return out
}

type dbTarget struct {
	name string
	db   *sql.DB
}

type dbRegistry struct {
	mu      sync.RWMutex
	targets map[string]dbTarget
}

func newDBRegistry() *dbRegistry {
	return &dbRegistry{targets: map[string]dbTarget{}}
}

func (r *dbRegistry) set(name string, db *sql.DB) {
	if db == nil {
		return
	}
	name = normalizeLabel(name, "default")
	r.mu.Lock()
	r.targets[name] = dbTarget{name: name, db: db}
	r.mu.Unlock()
}

func (r *dbRegistry) snapshot() []dbTarget {
	r.mu.RLock()
	out := make([]dbTarget, 0, len(r.targets))
	for _, target := range r.targets {
		out = append(out, target)
	}
	r.mu.RUnlock()
	return out
}

func observeAsyncMetrics(ctx context.Context, observer metric.Observer) error {
	observeGaugeStore(observer, httpInFlight, httpInFlightStore)
	observeDatabases(ctx, observer)
	observeGaugeStore(observer, taskQueueInfo, taskQueueInfoStore)
	observeGaugeStore(observer, taskQueueComponentUp, taskQueueComponentUpStore)
	observeGaugeStore(observer, taskQueueDepth, taskQueueDepthStore)
	observeGaugeStore(observer, workerConfigured, workerConfiguredStore)
	observeGaugeStore(observer, workerLoopsActive, workerLoopsActiveStore)
	observeGaugeStore(observer, workerTasksActive, workerTasksActiveStore)
	return nil
}

func observeGaugeStore(observer metric.Observer, instrument metric.Int64Observable, store *gaugeStore) {
	for _, value := range store.snapshot() {
		observer.ObserveInt64(instrument, value.value, metric.WithAttributes(value.attrs...))
	}
}

func observeDatabases(ctx context.Context, observer metric.Observer) {
	for _, target := range defaultDBRegistry.snapshot() {
		attrs := metric.WithAttributes(attribute.String("database", target.name))
		stats := target.db.Stats()
		up := int64(0)
		pingCtx, cancel := contextWithTimeout(ctx, 500*time.Millisecond)
		if err := target.db.PingContext(pingCtx); err == nil {
			up = 1
		}
		cancel()
		observer.ObserveInt64(dbUp, up, attrs)
		observer.ObserveInt64(dbOpenConnections, int64(stats.OpenConnections), attrs)
		observer.ObserveInt64(dbInUseConnections, int64(stats.InUse), attrs)
		observer.ObserveInt64(dbIdleConnections, int64(stats.Idle), attrs)
		observer.ObserveInt64(dbMaxOpenConnections, int64(stats.MaxOpenConnections), attrs)
		observer.ObserveInt64(dbWaitCount, stats.WaitCount, attrs)
		observer.ObserveFloat64(dbWaitDuration, stats.WaitDuration.Seconds(), attrs)
	}
}

func contextWithTimeout(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if parent == nil {
		parent = context.Background()
	}
	return context.WithTimeout(parent, timeout)
}

func gaugeKey(parts ...string) string {
	return strings.Join(parts, "\x00")
}

func cloneAttrs(attrs []attribute.KeyValue) []attribute.KeyValue {
	out := make([]attribute.KeyValue, len(attrs))
	copy(out, attrs)
	return out
}

func mustInstrument[T any](instrument T, err error) T {
	if err != nil {
		panic(err)
	}
	return instrument
}

func mustRegistration(registration metric.Registration, err error) metric.Registration {
	if err != nil {
		panic(err)
	}
	return registration
}

func normalizeRoute(route string) string {
	route = strings.TrimSpace(route)
	if route == "" {
		return "unmatched"
	}
	return route
}

func normalizeTable(table string) string {
	table = strings.TrimSpace(table)
	if table == "" {
		return "unknown"
	}
	if len(table) > 80 {
		return table[:80]
	}
	return table
}

func normalizeLabel(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "<nil>" {
		return fallback
	}
	if len(value) > 120 {
		return value[:120]
	}
	return value
}
