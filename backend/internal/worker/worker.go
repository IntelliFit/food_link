package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"food_link/backend/internal/analyze/domain"
	analyzerepo "food_link/backend/internal/analyze/repo"
	analyzeservice "food_link/backend/internal/analyze/service"
	authrepo "food_link/backend/internal/auth/repo"
	expiryservice "food_link/backend/internal/expiry/service"
	healthservice "food_link/backend/internal/health/service"
	publicfoodrepo "food_link/backend/internal/publicfood/repo"
	"food_link/backend/internal/taskqueue"
	userdomain "food_link/backend/internal/user/domain"
	userrepo "food_link/backend/internal/user/repo"
	userservice "food_link/backend/internal/user/service"
	"food_link/backend/pkg/metrics"
	"food_link/backend/pkg/storage"
	apm "food_link/backend/pkg/trace"

	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
)

const (
	precisionPlanModelName   = "doubao"
	precisionWeightModelName = "ofox-gemini"
	precisionRefineEnabled   = true
	precisionRefineTimeout   = 25 * time.Second
	taskLeaseDuration        = 5 * time.Minute
	taskLeaseExtendEvery     = 30 * time.Second
	taskRecoveryInterval     = 30 * time.Second
	taskRecoveryBatchSize    = 200
)

var errTaskAttemptLost = errors.New("task attempt no longer owns task")

var supportedTaskTypes = []string{
	"food",
	"food_text",
	"precision_plan",
	"precision_item_estimate",
	"precision_aggregate",
	"public_food_library_text",
	"exercise",
	"health_report",
	"expiry_recognize",
	"expiry_notification",
}

func SupportedTaskTypes() []string {
	return append([]string(nil), supportedTaskTypes...)
}

type Runner struct {
	tasks      *analyzerepo.TaskRepo
	precision  *analyzerepo.PrecisionRepo
	publicFood *publicfoodrepo.PublicFoodRepo
	analyze    *analyzeservice.AnalyzeService
	ocr        *userservice.OCRService
	healthDocs *userrepo.HealthDocumentRepo
	users      *authrepo.UserRepo
	expiry     *expiryservice.Recognizer
	notifier   *expiryservice.NotificationWorker
	exercise   *healthservice.ExerciseService
	queue      taskqueue.Queue
	log        *zap.Logger
	storage    *storage.Client
	credit     CreditGuard
}

type CreditGuard interface {
	RefundEarnedCreditsAfterTaskFailure(ctx context.Context, userID string, creditsInfo map[string]any, cost int, spendReason, spendSourceKey, refundReason, refundSourceKey string, meta map[string]any) error
}

type Options struct {
	WorkerID         string
	TaskTypes        []string
	PollInterval     time.Duration
	WorkerCount      int
	LeaseDuration    time.Duration
	RecoveryInterval time.Duration
	QueueDriver      string
}

func NewRunner(
	tasks *analyzerepo.TaskRepo,
	precision *analyzerepo.PrecisionRepo,
	publicFood *publicfoodrepo.PublicFoodRepo,
	analyze *analyzeservice.AnalyzeService,
	ocr *userservice.OCRService,
	healthDocs *userrepo.HealthDocumentRepo,
	users *authrepo.UserRepo,
	expiry *expiryservice.Recognizer,
	notifier *expiryservice.NotificationWorker,
	exercise *healthservice.ExerciseService,
	taskQueue taskqueue.Queue,
	log *zap.Logger,
	storageClient ...*storage.Client,
) *Runner {
	if log == nil {
		log = zap.NewNop()
	}
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &Runner{
		tasks:      tasks,
		precision:  precision,
		publicFood: publicFood,
		analyze:    analyze,
		ocr:        ocr,
		healthDocs: healthDocs,
		users:      users,
		expiry:     expiry,
		notifier:   notifier,
		exercise:   exercise,
		queue:      taskQueue,
		log:        log,
		storage:    client,
	}
}

func (r *Runner) ConfigureCreditGuard(guard CreditGuard) {
	r.credit = guard
}

func (r *Runner) Run(ctx context.Context, opts Options) error {
	taskTypes := normalizeTaskTypes(opts.TaskTypes)
	if len(taskTypes) == 0 {
		taskTypes = SupportedTaskTypes()
	}
	if opts.PollInterval <= 0 {
		opts.PollInterval = 2 * time.Second
	}
	if opts.WorkerCount <= 0 {
		opts.WorkerCount = 1
	}
	if opts.WorkerID == "" {
		opts.WorkerID = "worker-0"
	}
	if opts.LeaseDuration <= 0 {
		opts.LeaseDuration = taskLeaseDuration
	}
	if opts.RecoveryInterval <= 0 {
		opts.RecoveryInterval = taskRecoveryInterval
	}
	queueDriver := strings.TrimSpace(opts.QueueDriver)
	if queueDriver == "" {
		queueDriver = "unknown"
	}
	if r.queue == nil {
		return fmt.Errorf("worker task queue is not initialized")
	}
	metrics.SetWorkerConfigured(queueDriver, opts.WorkerCount)

	r.log.Info("worker started",
		zap.String("worker_id", opts.WorkerID),
		zap.Strings("task_types", taskTypes),
		zap.Duration("poll_interval", opts.PollInterval),
		zap.Int("worker_count", opts.WorkerCount),
		zap.Duration("lease_duration", opts.LeaseDuration),
		zap.Duration("recovery_interval", opts.RecoveryInterval),
		zap.String("task_queue_driver", queueDriver),
	)

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		r.recoverLoop(ctx, taskTypes, opts.RecoveryInterval)
	}()
	for i := 0; i < opts.WorkerCount; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			r.runLoop(ctx, fmt.Sprintf("%s-%d", opts.WorkerID, index), taskTypes, opts.PollInterval, opts.LeaseDuration, queueDriver)
		}(i)
	}
	<-ctx.Done()
	wg.Wait()
	return ctx.Err()
}

func (r *Runner) runLoop(ctx context.Context, workerID string, taskTypes []string, pollInterval, leaseDuration time.Duration, queueDriver string) {
	metrics.IncWorkerLoop(queueDriver)
	defer metrics.DecWorkerLoop(queueDriver)
	backoff := time.Second
	for ctx.Err() == nil {
		deliveries, err := r.queue.Subscribe(ctx, taskqueue.SubscribeOptions{TaskTypes: taskTypes})
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			r.log.Error("worker subscribe task queue failed", zap.String("worker_id", workerID), zap.Error(err))
			sleepContext(ctx, backoff)
			continue
		}
		func() {
			defer func() {
				if recovered := recover(); recovered != nil {
					r.log.Error("worker loop panic recovered",
						zap.String("worker_id", workerID),
						zap.Any("panic", recovered),
					)
				}
			}()
			r.loop(ctx, workerID, taskTypes, deliveries, pollInterval, leaseDuration)
		}()
		if ctx.Err() != nil {
			return
		}
		r.log.Warn("worker loop exited unexpectedly; restarting subscription", zap.String("worker_id", workerID))
		sleepContext(ctx, backoff)
	}
}

func (r *Runner) loop(ctx context.Context, workerID string, taskTypes []string, deliveries <-chan taskqueue.Delivery, pollInterval, leaseDuration time.Duration) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	idleCount := 0
	for {
		select {
		case <-ctx.Done():
			r.log.Info("worker loop stopped", zap.String("worker_id", workerID))
			return
		case delivery, ok := <-deliveries:
			if !ok {
				r.log.Info("worker task queue closed", zap.String("worker_id", workerID))
				return
			}
			idleCount = 0
			r.handleDelivery(ctx, workerID, taskTypes, leaseDuration, delivery)
		case <-ticker.C:
			if handlesTaskType(taskTypes, "expiry_notification") || handlesTaskType(taskTypes, "food_expiry_notification_job") {
				handled, err := r.processExpiryNotification(ctx, workerID)
				if err != nil {
					r.log.Error("process expiry notification failed", zap.String("worker_id", workerID), zap.Error(err))
					continue
				}
				if handled {
					idleCount = 0
					continue
				}
			}
			idleCount++
			if idleCount%30 == 0 {
				r.log.Info("worker idle", zap.String("worker_id", workerID), zap.Strings("task_types", taskTypes))
			}
		}
	}
}

func (r *Runner) handleDelivery(ctx context.Context, workerID string, taskTypes []string, leaseDuration time.Duration, delivery taskqueue.Delivery) {
	msg := delivery.Message
	ctx = msg.Context(ctx)
	settled := false
	ackDelivery := func() error {
		settled = true
		return delivery.Ack(ctx)
	}
	nackDelivery := func(err error) error {
		settled = true
		return delivery.Nack(ctx, err)
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			err := fmt.Errorf("task queue delivery panic: %v", recovered)
			r.log.Error("task queue delivery panic recovered",
				zap.String("worker_id", workerID),
				zap.String("task_id", msg.TaskID),
				zap.String("task_type", msg.TaskType),
				zap.Any("panic", recovered),
			)
			apm.RecordError(ctx, err,
				attribute.String("worker.id", workerID),
				attribute.String("analysis.task_id", msg.TaskID),
				attribute.String("analysis.task_type", msg.TaskType),
				attribute.String("analysis.stage", "delivery_panic"),
			)
			if !settled {
				_ = nackDelivery(err)
			}
		}
	}()
	ctx, span := apm.StartSpan(ctx, "task_queue.delivery",
		attribute.String("worker.id", workerID),
		attribute.String("analysis.task_id", strings.TrimSpace(msg.TaskID)),
		attribute.String("analysis.task_type", strings.TrimSpace(msg.TaskType)),
		attribute.String("messaging.operation", "receive"),
	)
	defer span.End()
	apm.AddEvent(ctx, "task queue delivery received",
		attribute.String("worker.id", workerID),
		attribute.String("analysis.task_id", strings.TrimSpace(msg.TaskID)),
		attribute.String("analysis.task_type", strings.TrimSpace(msg.TaskType)),
	)
	if strings.TrimSpace(msg.TaskID) == "" {
		r.log.Warn("task queue delivery missing task id", zap.String("worker_id", workerID), zap.String("task_type", msg.TaskType))
		apm.AddEvent(ctx, "task queue delivery missing task id", attribute.String("analysis.task_type", strings.TrimSpace(msg.TaskType)))
		_ = ackDelivery()
		return
	}
	if !handlesTaskType(taskTypes, msg.TaskType) {
		r.log.Warn("task queue delivery skipped because worker does not handle task type",
			zap.String("worker_id", workerID),
			zap.String("task_id", msg.TaskID),
			zap.String("task_type", msg.TaskType),
		)
		apm.AddEvent(ctx, "task queue delivery skipped",
			attribute.String("worker.id", workerID),
			attribute.String("analysis.task_id", msg.TaskID),
			attribute.String("analysis.task_type", msg.TaskType),
			attribute.String("reason", "task_type_not_subscribed"),
		)
		_ = ackDelivery()
		return
	}
	apm.AddEvent(ctx, "analysis task claim started",
		attribute.String("worker.id", workerID),
		attribute.String("analysis.task_id", msg.TaskID),
		attribute.String("analysis.task_type", msg.TaskType),
	)
	claim, err := r.tasks.ClaimTaskByID(ctx, analyzerepo.ClaimTaskOptions{
		TaskID:        msg.TaskID,
		TaskTypes:     taskTypes,
		WorkerID:      workerID,
		LeaseDuration: leaseDuration,
	})
	if err != nil {
		r.log.Error("claim queued task failed",
			zap.String("worker_id", workerID),
			zap.String("task_id", msg.TaskID),
			zap.String("task_type", msg.TaskType),
			zap.Error(err),
		)
		apm.RecordError(ctx, err,
			attribute.String("worker.id", workerID),
			attribute.String("analysis.task_id", msg.TaskID),
			attribute.String("analysis.task_type", msg.TaskType),
			attribute.String("analysis.stage", "claim"),
		)
		apm.AddEvent(ctx, "analysis task claim failed",
			attribute.String("worker.id", workerID),
			attribute.String("analysis.task_id", msg.TaskID),
			attribute.String("analysis.task_type", msg.TaskType),
		)
		metrics.ObserveWorkerTaskClaim(msg.TaskType, "error")
		_ = nackDelivery(err)
		return
	}
	task := claim.Task
	if task == nil {
		metrics.ObserveWorkerTaskClaim(msg.TaskType, string(claim.Outcome))
		r.log.Info("queued task skipped because it is no longer pending or not allowed",
			zap.String("worker_id", workerID),
			zap.String("task_id", msg.TaskID),
			zap.String("task_type", msg.TaskType),
			zap.String("claim_outcome", string(claim.Outcome)),
		)
		apm.AddEvent(ctx, "analysis task claim skipped",
			attribute.String("worker.id", workerID),
			attribute.String("analysis.task_id", msg.TaskID),
			attribute.String("analysis.task_type", msg.TaskType),
			attribute.String("reason", string(claim.Outcome)),
		)
		_ = ackDelivery()
		return
	}
	if claim.Outcome != analyzerepo.ClaimOutcomeClaimed {
		metrics.ObserveWorkerTaskClaim(task.TaskType, string(claim.Outcome))
		r.log.Info("queued task skipped after claim check",
			zap.String("worker_id", workerID),
			zap.String("task_id", task.ID),
			zap.String("task_type", task.TaskType),
			zap.String("task_status", task.Status),
			zap.String("claim_outcome", string(claim.Outcome)),
			zap.Stringp("attempt_id", task.AttemptID),
			zap.Timep("lease_until", task.LeaseUntil),
		)
		apm.AddEvent(ctx, "analysis task claim skipped",
			attribute.String("worker.id", workerID),
			attribute.String("analysis.task_id", task.ID),
			attribute.String("analysis.task_type", task.TaskType),
			attribute.String("analysis.task_status", task.Status),
			attribute.String("reason", string(claim.Outcome)),
		)
		_ = ackDelivery()
		return
	}
	metrics.ObserveWorkerTaskClaim(task.TaskType, "claimed")
	r.log.Info("task claimed",
		zap.String("worker_id", workerID),
		zap.String("task_id", task.ID),
		zap.String("task_type", task.TaskType),
		zap.Stringp("attempt_id", task.AttemptID),
		zap.Int("attempt_count", task.AttemptCount),
		zap.Timep("lease_until", task.LeaseUntil),
		zap.String("source", "task_queue"),
	)
	apm.SetAttributes(ctx,
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
		attribute.String("analysis.user_id", task.UserID),
		attribute.String("analysis.attempt_id", stringPtrValue(task.AttemptID)),
	)
	apm.AddEvent(ctx, "analysis task claimed",
		attribute.String("worker.id", workerID),
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
		attribute.String("analysis.user_id", task.UserID),
		attribute.String("analysis.attempt_id", stringPtrValue(task.AttemptID)),
	)
	if err := r.process(ctx, workerID, task, leaseDuration); err != nil {
		r.log.Error("queued task processing did not reach persisted terminal state",
			zap.String("worker_id", workerID),
			zap.String("task_id", task.ID),
			zap.String("task_type", task.TaskType),
			zap.Stringp("attempt_id", task.AttemptID),
			zap.Error(err),
		)
		apm.RecordError(ctx, err,
			attribute.String("worker.id", workerID),
			attribute.String("analysis.task_id", task.ID),
			attribute.String("analysis.task_type", task.TaskType),
			attribute.String("analysis.attempt_id", stringPtrValue(task.AttemptID)),
			attribute.String("analysis.stage", "process_or_terminal_update"),
		)
		_ = nackDelivery(err)
		return
	}
	if err := ackDelivery(); err != nil {
		r.log.Error("ack queued task failed",
			zap.String("worker_id", workerID),
			zap.String("task_id", task.ID),
			zap.String("task_type", task.TaskType),
			zap.Error(err),
		)
		apm.RecordError(ctx, err,
			attribute.String("worker.id", workerID),
			attribute.String("analysis.task_id", task.ID),
			attribute.String("analysis.task_type", task.TaskType),
			attribute.String("analysis.stage", "ack"),
		)
	}
}

func (r *Runner) processExpiryNotification(ctx context.Context, workerID string) (bool, error) {
	if r.notifier == nil {
		return false, nil
	}
	jobCtx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	recovered, err := r.notifier.RecoverStaleProcessingJobs(jobCtx, 10*time.Minute)
	if err != nil {
		return false, err
	}
	if recovered > 0 {
		r.log.Warn("expiry notification stale processing jobs recovered",
			zap.String("worker_id", workerID),
			zap.Int64("job_count", recovered),
		)
	}
	handled, err := r.notifier.ProcessNext(jobCtx)
	if handled {
		r.log.Info("expiry notification job processed", zap.String("worker_id", workerID))
	}
	return handled, err
}

func (r *Runner) enqueueTask(ctx context.Context, task *domain.AnalysisTask) error {
	if r.queue == nil || task == nil || task.Status != "pending" {
		return nil
	}
	apm.AddEvent(ctx, "worker child task queue publish started",
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
	)
	publishCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := r.queue.PublishTask(publishCtx, taskqueue.TaskMessage{TaskID: task.ID, TaskType: task.TaskType}); err != nil {
		r.log.Error("worker failed to enqueue child task",
			zap.String("task_id", task.ID),
			zap.String("task_type", task.TaskType),
			zap.Error(err),
		)
		apm.RecordError(ctx, err,
			attribute.String("analysis.task_id", task.ID),
			attribute.String("analysis.task_type", task.TaskType),
			attribute.String("analysis.stage", "child_enqueue"),
		)
		return fmt.Errorf("enqueue child task %s: %w", task.ID, err)
	}
	r.log.Info("worker enqueued child task",
		zap.String("task_id", task.ID),
		zap.String("task_type", task.TaskType),
	)
	apm.AddEvent(ctx, "worker child task queue publish completed",
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
	)
	return nil
}

func (r *Runner) recoverLoop(ctx context.Context, taskTypes []string, interval time.Duration) {
	if interval <= 0 {
		interval = taskRecoveryInterval
	}
	r.recoverQueueTasks(ctx, taskTypes)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.recoverQueueTasks(ctx, taskTypes)
		}
	}
}

func (r *Runner) recoverQueueTasks(ctx context.Context, taskTypes []string) {
	if r.queue == nil || r.tasks == nil {
		return
	}
	taskTypes = analysisQueueTaskTypes(taskTypes)
	if len(taskTypes) == 0 {
		return
	}
	recoverCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tasks, err := r.tasks.ListRecoverableTasks(recoverCtx, taskTypes, taskRecoveryBatchSize, time.Now())
	if err != nil {
		r.log.Error("recover queued analysis tasks failed", zap.Error(err))
		apm.RecordError(recoverCtx, err, attribute.String("analysis.stage", "queue_recovery"))
		return
	}
	if len(tasks) == 0 {
		return
	}
	published := 0
	for _, task := range tasks {
		if task.ID == "" || task.TaskType == "" {
			continue
		}
		metrics.AddWorkerRecoveredTasks(task.TaskType, "candidate", 1)
		publishCtx, publishCancel := context.WithTimeout(ctx, 2*time.Second)
		err := r.queue.PublishTask(publishCtx, taskqueue.TaskMessage{TaskID: task.ID, TaskType: task.TaskType})
		publishCancel()
		if err != nil {
			metrics.AddWorkerRecoveredTasks(task.TaskType, "publish_failed", 1)
			r.log.Error("recover queued analysis task publish failed",
				zap.String("task_id", task.ID),
				zap.String("task_type", task.TaskType),
				zap.String("status", task.Status),
				zap.Timep("lease_until", task.LeaseUntil),
				zap.Error(err),
			)
			apm.RecordError(ctx, err,
				attribute.String("analysis.task_id", task.ID),
				attribute.String("analysis.task_type", task.TaskType),
				attribute.String("analysis.stage", "queue_recovery_publish"),
			)
			continue
		}
		metrics.AddWorkerRecoveredTasks(task.TaskType, "published", 1)
		published++
	}
	if published > 0 {
		r.log.Info("recover queued analysis tasks published",
			zap.Int("task_count", published),
			zap.Int("candidate_count", len(tasks)),
		)
	}
}

func (r *Runner) startLeaseHeartbeat(ctx context.Context, cancel context.CancelFunc, workerID string, task *domain.AnalysisTask, leaseDuration time.Duration) func() {
	if r.tasks == nil || task == nil || task.ID == "" {
		return func() {}
	}
	attemptID := stringPtrValue(task.AttemptID)
	if attemptID == "" {
		return func() {}
	}
	if leaseDuration <= 0 {
		leaseDuration = taskLeaseDuration
	}
	interval := taskLeaseExtendEvery
	if leaseDuration/3 > 0 && leaseDuration/3 < interval {
		interval = leaseDuration / 3
	}
	if interval <= 0 {
		interval = taskLeaseExtendEvery
	}
	done := make(chan struct{})
	var once sync.Once
	stop := func() {
		once.Do(func() { close(done) })
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-done:
				return
			case <-ticker.C:
				leaseUntil := time.Now().Add(leaseDuration)
				extendCtx, extendCancel := context.WithTimeout(context.Background(), 5*time.Second)
				ok, err := r.tasks.ExtendTaskLease(extendCtx, task.ID, attemptID, workerID, leaseUntil)
				extendCancel()
				if err != nil {
					metrics.ObserveWorkerLeaseHeartbeat(task.TaskType, "error")
					r.log.Error("task lease heartbeat failed",
						zap.String("worker_id", workerID),
						zap.String("task_id", task.ID),
						zap.String("task_type", task.TaskType),
						zap.String("attempt_id", attemptID),
						zap.Error(err),
					)
					continue
				}
				if !ok {
					metrics.ObserveWorkerLeaseHeartbeat(task.TaskType, "lost")
					r.log.Warn("task lease heartbeat lost ownership",
						zap.String("worker_id", workerID),
						zap.String("task_id", task.ID),
						zap.String("task_type", task.TaskType),
						zap.String("attempt_id", attemptID),
					)
					cancel()
					return
				}
				metrics.ObserveWorkerLeaseHeartbeat(task.TaskType, "success")
				task.LeaseUntil = &leaseUntil
			}
		}
	}()
	return stop
}

func (r *Runner) process(ctx context.Context, workerID string, task *domain.AnalysisTask, leaseDuration time.Duration) error {
	start := time.Now()
	taskStatus := "done"
	metrics.IncWorkerTask(task.TaskType)
	defer func() {
		metrics.DecWorkerTask(task.TaskType)
		metrics.ObserveWorkerTask(task.TaskType, taskStatus, time.Since(start))
	}()
	taskCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	stopHeartbeat := r.startLeaseHeartbeat(taskCtx, cancel, workerID, task, leaseDuration)
	defer stopHeartbeat()
	taskCtx, span := apm.StartSpan(taskCtx, "analysis.task.process",
		attribute.String("worker.id", workerID),
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
		attribute.String("analysis.user_id", task.UserID),
		attribute.String("analysis.task_status", task.Status),
		attribute.String("analysis.attempt_id", stringPtrValue(task.AttemptID)),
	)
	defer span.End()

	r.log.Info("task processing started",
		zap.String("worker_id", workerID),
		zap.String("task_id", task.ID),
		zap.String("task_type", task.TaskType),
		zap.String("status", task.Status),
	)
	apm.AddEvent(taskCtx, "task processing started",
		attribute.String("worker.id", workerID),
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
		attribute.String("analysis.task_status", task.Status),
	)

	var err error
	switch task.TaskType {
	case "food":
		err = r.processFood(taskCtx, task)
	case "food_text":
		err = r.processFoodText(taskCtx, task)
	case "precision_plan":
		err = r.processPrecisionPlan(taskCtx, task)
	case "precision_item_estimate":
		err = r.processPrecisionItemEstimate(taskCtx, task)
	case "precision_aggregate":
		err = r.processPrecisionAggregate(taskCtx, task)
	case "public_food_library_text":
		err = r.processPublicFoodModeration(taskCtx, task)
	case "exercise":
		err = r.processExercise(taskCtx, task)
	case "health_report":
		err = r.processHealthReport(taskCtx, task)
	case "expiry_recognize":
		err = r.processExpiryRecognize(taskCtx, task)
	default:
		err = fmt.Errorf("unsupported worker task_type: %s", task.TaskType)
	}
	if err != nil {
		if errors.Is(err, errTaskAttemptLost) {
			taskStatus = "attempt_lost"
			r.log.Warn("task attempt lost before completion; acknowledging stale delivery",
				zap.String("worker_id", workerID),
				zap.String("task_id", task.ID),
				zap.String("task_type", task.TaskType),
				zap.Stringp("attempt_id", task.AttemptID),
			)
			apm.AddEvent(taskCtx, "task attempt lost",
				attribute.String("worker.id", workerID),
				attribute.String("analysis.task_id", task.ID),
				attribute.String("analysis.task_type", task.TaskType),
				attribute.String("analysis.attempt_id", stringPtrValue(task.AttemptID)),
			)
			return nil
		}
		failCtx, failCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer failCancel()
		if failErr := r.failTask(failCtx, task, err); failErr != nil {
			if errors.Is(failErr, errTaskAttemptLost) {
				taskStatus = "attempt_lost"
				apm.AddEvent(taskCtx, "task attempt lost while writing failure",
					attribute.String("worker.id", workerID),
					attribute.String("analysis.task_id", task.ID),
					attribute.String("analysis.task_type", task.TaskType),
					attribute.String("analysis.attempt_id", stringPtrValue(task.AttemptID)),
				)
				return nil
			}
			taskStatus = "terminal_update_error"
			apm.RecordError(taskCtx, failErr,
				attribute.String("worker.id", workerID),
				attribute.String("analysis.task_id", task.ID),
				attribute.String("analysis.task_type", task.TaskType),
				attribute.String("analysis.attempt_id", stringPtrValue(task.AttemptID)),
				attribute.String("analysis.stage", "fail_task"),
			)
			return failErr
		}
		taskStatus = "failed"
		apm.RecordError(taskCtx, err,
			attribute.String("worker.id", workerID),
			attribute.String("analysis.task_id", task.ID),
			attribute.String("analysis.task_type", task.TaskType),
			attribute.String("analysis.attempt_id", stringPtrValue(task.AttemptID)),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		apm.AddEvent(taskCtx, "task processing failed",
			attribute.String("worker.id", workerID),
			attribute.String("analysis.task_id", task.ID),
			attribute.String("analysis.task_type", task.TaskType),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		r.log.Warn("task processing finished with error",
			zap.String("worker_id", workerID),
			zap.String("task_id", task.ID),
			zap.String("task_type", task.TaskType),
			zap.Duration("duration", time.Since(start)),
			zap.Error(err),
		)
		return nil
	}
	apm.SetAttributes(taskCtx, apm.DurationMS("analysis.duration_ms", time.Since(start)))
	apm.AddEvent(taskCtx, "task processing completed",
		attribute.String("worker.id", workerID),
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	r.log.Info("task processed",
		zap.String("worker_id", workerID),
		zap.String("task_id", task.ID),
		zap.String("task_type", task.TaskType),
		zap.Duration("duration", time.Since(start)),
	)
	return nil
}

func (r *Runner) processFood(ctx context.Context, task *domain.AnalysisTask) error {
	ctx, span := apm.StartSpan(ctx, "analysis.task.food",
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
		attribute.String("analysis.user_id", task.UserID),
	)
	defer span.End()
	r.normalizeTaskImages(task, "food-images")
	if done, err := r.completeCorrectionTask(ctx, task, "", 0, nil); done || err != nil {
		if err != nil {
			apm.RecordError(ctx, err, attribute.String("analysis.stage", "correction"))
		}
		return err
	}
	input := analyzeInputFromTask(task)
	if input.ImageURL == "" && len(input.ImageURLs) == 0 {
		err := fmt.Errorf("food task missing image_url/image_paths")
		apm.RecordError(ctx, err, attribute.String("analysis.stage", "validate_input"))
		return err
	}
	start := time.Now()
	apm.AddEvent(ctx, "food task analyze started",
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.user_id", task.UserID),
		attribute.String("analysis.model_name", stringFromMap(task.Payload, "modelName")),
		attribute.String("analysis.execution_mode", stringFromMap(task.Payload, "execution_mode")),
		attribute.String("analysis.engine", stringFromMap(task.Payload, "analysis_engine")),
		attribute.Int("analysis.image_count", taskImageCount(task)),
	)
	r.log.Info("food task analyze started",
		zap.String("task_id", task.ID),
		zap.String("user_id", task.UserID),
		zap.String("model_name", stringFromMap(task.Payload, "modelName")),
		zap.String("execution_mode", stringFromMap(task.Payload, "execution_mode")),
		zap.String("analysis_engine", stringFromMap(task.Payload, "analysis_engine")),
		zap.Int("image_count", taskImageCount(task)),
	)
	result, err := r.analyze.Analyze(ctx, task.UserID, input)
	if err != nil {
		apm.RecordError(ctx, err,
			attribute.String("analysis.stage", "food_analyze"),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		apm.AddEvent(ctx, "food task analyze failed",
			attribute.String("analysis.task_id", task.ID),
			attribute.String("analysis.user_id", task.UserID),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		r.log.Warn("food task analyze failed",
			zap.String("task_id", task.ID),
			zap.String("user_id", task.UserID),
			zap.Duration("duration", time.Since(start)),
			zap.Error(err),
		)
		return err
	}
	apm.AddEvent(ctx, "food task analyze result ready",
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.user_id", task.UserID),
		attribute.String("analysis.model_name", stringFromMap(result, "model_name")),
		attribute.String("analysis.engine", stringFromMap(result, "analysis_engine")),
		attribute.Int("analysis.item_count", len(extractItems(result["items"]))),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	r.log.Info("food task analyze result ready",
		zap.String("task_id", task.ID),
		zap.String("user_id", task.UserID),
		zap.String("model_name", stringFromMap(result, "model_name")),
		zap.String("analysis_engine", stringFromMap(result, "analysis_engine")),
		zap.Int("item_count", len(extractItems(result["items"]))),
		zap.Duration("duration", time.Since(start)),
	)
	err = r.completeTask(ctx, task, result)
	if err != nil {
		r.log.Error("food task complete update failed", zap.String("task_id", task.ID), zap.Error(err))
		apm.RecordError(ctx, err, attribute.String("analysis.stage", "complete_task"))
		return err
	}
	apm.SetAttributes(ctx,
		attribute.Int("analysis.item_count", len(extractItems(result["items"]))),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	apm.AddEvent(ctx, "food task completed",
		attribute.String("analysis.task_id", task.ID),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	r.log.Info("food task completed", zap.String("task_id", task.ID), zap.Duration("duration", time.Since(start)))
	return nil
}

func (r *Runner) processFoodText(ctx context.Context, task *domain.AnalysisTask) error {
	ctx, span := apm.StartSpan(ctx, "analysis.task.food_text",
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
		attribute.String("analysis.user_id", task.UserID),
	)
	defer span.End()
	if done, err := r.completeCorrectionTask(ctx, task, "", 0, nil); done || err != nil {
		if err != nil {
			apm.RecordError(ctx, err, attribute.String("analysis.stage", "correction"))
		}
		return err
	}
	input := analyzeInputFromTask(task)
	if strings.TrimSpace(input.Text) == "" {
		err := fmt.Errorf("food_text task missing text_input")
		apm.RecordError(ctx, err, attribute.String("analysis.stage", "validate_input"))
		return err
	}
	start := time.Now()
	apm.AddEvent(ctx, "food text task analyze started",
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.user_id", task.UserID),
		attribute.String("analysis.model_name", stringFromMap(task.Payload, "modelName")),
		attribute.String("analysis.execution_mode", stringFromMap(task.Payload, "execution_mode")),
	)
	result, err := r.analyze.AnalyzeText(ctx, task.UserID, input)
	if err != nil {
		apm.RecordError(ctx, err,
			attribute.String("analysis.stage", "food_text_analyze"),
			apm.DurationMS("analysis.duration_ms", time.Since(start)),
		)
		return err
	}
	err = r.completeTask(ctx, task, result)
	if err != nil {
		apm.RecordError(ctx, err, attribute.String("analysis.stage", "complete_task"))
		return err
	}
	apm.AddEvent(ctx, "food text task completed",
		attribute.String("analysis.task_id", task.ID),
		attribute.Int("analysis.item_count", len(extractItems(result["items"]))),
		apm.DurationMS("analysis.duration_ms", time.Since(start)),
	)
	return err
}

func (r *Runner) completeCorrectionTask(ctx context.Context, task *domain.AnalysisTask, sessionID string, roundIndex int, latestInputs map[string]any) (bool, error) {
	correctionItems := extractItems(firstNonNil(task.Payload["correctionItems"], latestInputs["correctionItems"]))
	if len(correctionItems) == 0 {
		return false, nil
	}

	input := analyzeInputFromTask(task)
	applyLatestInputsToAnalyzeInput(&input, latestInputs)
	input.CorrectionItems = correctionItems
	if len(input.PreviousResult) == 0 {
		input.PreviousResult = mapFromAny(firstNonNil(task.Payload["previousResult"], latestInputs["previousResult"]))
	}
	input.AnalysisEngine = "db_first"
	input.ModelName = precisionPlanModelName
	standardMode := "standard"
	input.ExecutionMode = &standardMode

	var result map[string]any
	var err error
	sourceType := firstNonEmptyString(task.Payload, "source_type")
	if sourceType == "" {
		sourceType = firstNonEmptyString(latestInputs, "source_type")
	}
	if strings.EqualFold(sourceType, "text") || strings.TrimSpace(input.Text) != "" {
		if strings.TrimSpace(input.Text) == "" {
			return true, fmt.Errorf("correction text task missing text input")
		}
		result, err = r.analyze.AnalyzeText(ctx, task.UserID, input)
	} else {
		if input.ImageURL == "" && len(input.ImageURLs) == 0 {
			return true, fmt.Errorf("correction image task missing image input")
		}
		result, err = r.analyze.Analyze(ctx, task.UserID, input)
	}
	if err != nil {
		return true, err
	}
	originalItems := buildItemsFromCorrection(correctionItems)
	if len(originalItems) > 0 {
		result["items"] = restoreCorrectionFallbackNutrition(extractItems(result["items"]), originalItems)
	}
	result["correctionApplied"] = true
	if sessionID != "" {
		result["precisionSessionId"] = sessionID
		result["precisionStatus"] = "done"
		result["precisionRoundIndex"] = roundIndex
		if r.precision != nil {
			if err := r.precision.CreateRound(ctx, &domain.PrecisionSessionRound{
				SessionID:     sessionID,
				RoundIndex:    roundIndex,
				ActorRole:     "assistant",
				InputPayload:  map[string]any{"correctionItems": correctionItems, "additionalContext": input.AdditionalContext, "previousResult": input.PreviousResult},
				PlannerResult: result,
			}); err != nil {
				return true, err
			}
			if err := r.precision.UpdateSession(ctx, sessionID, map[string]any{
				"status":                "done",
				"final_result":          result,
				"latest_planner_result": result,
				"pending_requirements":  []any{},
				"current_task_id":       task.ID,
				"last_error":            nil,
				"updated_at":            time.Now(),
			}); err != nil {
				return true, err
			}
		}
	}
	err = r.completeTask(ctx, task, result)
	return true, err
}

func applyLatestInputsToAnalyzeInput(input *analyzeservice.AnalyzeInput, latestInputs map[string]any) {
	if input == nil || len(latestInputs) == 0 {
		return
	}
	if input.AdditionalContext == "" {
		input.AdditionalContext = firstNonEmptyString(latestInputs, "additionalContext")
	}
	if input.ImageURL == "" {
		input.ImageURL = firstNonEmptyString(latestInputs, "image_url")
	}
	if len(input.ImageURLs) == 0 {
		input.ImageURLs = stringSliceFromAny(latestInputs["image_urls"])
	}
	if strings.TrimSpace(input.Text) == "" {
		input.Text = firstNonEmptyString(latestInputs, "text", "text_input")
	}
	if input.MealType == "" {
		input.MealType = firstNonEmptyString(latestInputs, "meal_type")
	}
	if input.Province == "" {
		input.Province = firstNonEmptyString(latestInputs, "province")
	}
	if input.City == "" {
		input.City = firstNonEmptyString(latestInputs, "city")
	}
	if input.District == "" {
		input.District = firstNonEmptyString(latestInputs, "district")
	}
	if input.UserGoal == "" {
		input.UserGoal = firstNonEmptyString(latestInputs, "user_goal")
	}
	if input.DietGoal == "" {
		input.DietGoal = firstNonEmptyString(latestInputs, "diet_goal")
	}
	if input.ActivityTiming == "" {
		input.ActivityTiming = firstNonEmptyString(latestInputs, "activity_timing")
	}
	if input.ModelName == "" {
		input.ModelName = firstNonEmptyString(latestInputs, "modelName")
	}
	if input.AnalysisEngine == "" {
		input.AnalysisEngine = firstNonEmptyString(latestInputs, "analysis_engine")
	}
	if input.ExecutionMode == nil {
		if mode := firstNonEmptyString(latestInputs, "execution_mode"); mode != "" {
			input.ExecutionMode = &mode
		}
	}
	if input.RemainingCalories == nil {
		if remaining, ok := floatFromAny(latestInputs["remaining_calories"]); ok {
			input.RemainingCalories = &remaining
		}
	}
	if len(input.PreviousResult) == 0 {
		input.PreviousResult = mapFromAny(latestInputs["previousResult"])
	}
}

func buildItemsFromCorrection(correctionItems []map[string]any) []map[string]any {
	items := make([]map[string]any, 0, len(correctionItems))
	for index, item := range correctionItems {
		name := strings.TrimSpace(firstNonEmptyString(item, "name", "food_name", "item_name"))
		if name == "" {
			continue
		}
		weight, ok := firstPositiveFloat(item, "estimatedWeightGrams", "weight", "weight_g", "originalWeightGrams")
		if !ok || weight <= 0 {
			continue
		}
		next := map[string]any{
			"name":                 name,
			"estimatedWeightGrams": weight,
			"originalWeightGrams":  weight,
		}
		if sourceID, ok := firstPositiveFloat(item, "sourceItemId", "itemId", "id"); ok {
			next["itemId"] = int(sourceID)
		} else {
			next["itemId"] = index + 1
		}
		if sourceName := strings.TrimSpace(firstNonEmptyString(item, "sourceName")); sourceName != "" {
			next["sourceName"] = sourceName
		}
		if nutrients := correctionNutrients(item); len(nutrients) > 0 {
			next["nutrients"] = nutrients
		}
		items = append(items, next)
	}
	return items
}

func correctionNutrients(item map[string]any) map[string]any {
	nutrients := map[string]any{}
	if nested, ok := item["nutrients"].(map[string]any); ok {
		for _, key := range []string{"calories", "protein", "carbs", "fat", "fiber", "sugar"} {
			if value, ok := floatFromAny(nested[key]); ok {
				nutrients[key] = value
			}
		}
	}
	fieldMap := map[string]string{
		"calorie":  "calories",
		"calories": "calories",
		"protein":  "protein",
		"carbs":    "carbs",
		"fat":      "fat",
		"fiber":    "fiber",
		"sugar":    "sugar",
	}
	for from, to := range fieldMap {
		if value, ok := floatFromAny(item[from]); ok {
			nutrients[to] = value
		}
	}
	if !hasPositiveNutrient(nutrients) {
		return nil
	}
	for _, key := range []string{"calories", "protein", "carbs", "fat", "fiber", "sugar"} {
		if _, ok := nutrients[key]; !ok {
			nutrients[key] = 0.0
		}
	}
	return nutrients
}

func restoreCorrectionFallbackNutrition(dbItems, originalItems []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(dbItems))
	for index, item := range dbItems {
		next := copyAnyMap(item)
		if !isUnresolvedNutrition(item) || hasPositiveNutrientMap(item["nutrients"]) {
			out = append(out, next)
			continue
		}
		if index < len(originalItems) && hasPositiveNutrientMap(originalItems[index]["nutrients"]) {
			next["nutrients"] = originalItems[index]["nutrients"]
			next["nutrition_source"] = "user_correction_fallback"
		}
		out = append(out, next)
	}
	return out
}

func buildCorrectionAnalyzeResult(payload map[string]any, items []map[string]any) map[string]any {
	previous := mapFromAny(payload["previousResult"])
	description := strings.TrimSpace(stringFromMap(previous, "description"))
	if description == "" {
		description = summarizeCorrectionItems(items)
	}
	insight := strings.TrimSpace(stringFromMap(previous, "insight"))
	if insight == "" {
		insight = "已按当前食物清单计算营养。"
	}
	result := map[string]any{
		"description":          description,
		"insight":              insight,
		"items":                items,
		"analysis_engine":      "db_first",
		"analysis_duration_ms": 0,
	}
	for _, key := range []string{"pfc_ratio_comment", "absorption_notes", "context_advice", "recognitionOutcome", "rejectionReason", "retakeGuidance", "allowedFoodCategory", "followupQuestions"} {
		if value, ok := previous[key]; ok {
			result[key] = value
		}
	}
	resolved, unresolved := countResolvedItems(items)
	result["resolved_count"] = resolved
	result["unresolved_count"] = unresolved
	return result
}

func (r *Runner) processPrecisionPlan(ctx context.Context, task *domain.AnalysisTask) error {
	r.normalizeTaskImages(task, "food-images")
	sessionID := stringFromMap(task.Payload, "precision_session_id")
	if sessionID == "" {
		return fmt.Errorf("precision_plan task missing precision_session_id")
	}
	session, err := r.precision.GetSessionByID(ctx, sessionID)
	if err != nil {
		return err
	}
	if session == nil {
		return fmt.Errorf("精准模式会话不存在")
	}
	roundIndex := intFromMap(task.Payload, "round_index")
	if roundIndex <= 0 {
		roundIndex = session.RoundIndex
	}
	if roundIndex <= 0 {
		roundIndex = 1
	}
	sourceType := stringFromMap(task.Payload, "source_type")
	if sourceType == "" {
		sourceType = session.SourceType
	}
	if sourceType != "text" {
		sourceType = "image"
	}
	latestInputs := session.LatestInputs
	if latestInputs == nil {
		latestInputs = map[string]any{}
	}
	if done, err := r.completeCorrectionTask(ctx, task, sessionID, roundIndex, latestInputs); done || err != nil {
		return err
	}
	additionalContext := stringFromMap(latestInputs, "additionalContext")
	referenceObjects := extractItems(firstNonNil(latestInputs["reference_objects"], session.ReferenceObjects))
	previousRounds, err := r.precision.ListRounds(ctx, sessionID)
	if err != nil {
		return err
	}
	rawInput := additionalContext
	if sourceType == "image" {
		if rawInput == "" {
			rawInput = "图片输入"
		}
	} else {
		rawInput = firstNonEmptyString(latestInputs, "text")
		if rawInput == "" && task.TextInput != nil {
			rawInput = strings.TrimSpace(*task.TextInput)
		}
	}
	imageURL := firstNonEmptyString(latestInputs, "image_url")
	if imageURL == "" && task.ImageURL != nil {
		imageURL = strings.TrimSpace(*task.ImageURL)
	}
	imageURLs := stringSliceFromAny(firstNonNil(latestInputs["image_urls"], task.ImagePaths))
	if len(imageURLs) == 0 && imageURL != "" {
		imageURLs = []string{imageURL}
	}
	prompt := buildPrecisionPlanPrompt(sourceType, rawInput, additionalContext, referenceObjects, previousRounds)
	result, err := r.analyze.RunPrecisionJSONWithImages(ctx, sourceType, prompt, imageURLs, precisionPlanModelName)
	if err != nil {
		return err
	}
	result = normalizePrecisionPlanResult(result)

	if err := r.precision.CreateRound(ctx, &domain.PrecisionSessionRound{
		SessionID:     sessionID,
		RoundIndex:    roundIndex,
		ActorRole:     "assistant",
		InputPayload:  map[string]any{},
		PlannerResult: result,
	}); err != nil {
		return err
	}

	plannedItems := buildPrecisionEstimateItems(result, sourceType)
	splitStrategy := stringFromMap(result, "splitStrategy")
	groups := groupPrecisionItemsByStrategy(plannedItems, splitStrategy)
	r.log.Info("precision plan",
		zap.String("task_id", task.ID),
		zap.String("session_id", sessionID),
		zap.Int("round", roundIndex),
		zap.String("split_strategy", splitStrategy),
		zap.Int("items", len(plannedItems)),
		zap.Int("groups", len(groups)),
		zap.String("detail", formatPrecisionGroups(groups)),
	)
	childTaskIDs := make([]string, 0, len(groups))

	for groupIndex, groupItems := range groups {
		groupPayload := map[string]any{
			"precision_session_id": sessionID,
			"source_type":          sourceType,
			"round_index":          roundIndex,
			"group_index":          groupIndex,
			"items_to_estimate":    groupItems,
			"additionalContext":    additionalContext,
			"reference_objects":    referenceObjects,
			"image_url":            imageURL,
			"image_urls":           imageURLs,
			"text":                 firstNonEmptyString(latestInputs, "text"),
			"modelName":            precisionWeightModelName,
			"planner_modelName":    precisionPlanModelName,
		}
		groupPayload["round_index"] = roundIndex
		groupPayload["group_index"] = groupIndex
		groupPayload["items_to_estimate"] = groupItems
		if len(groupItems) == 1 {
			groupPayload["item_key"] = stringFromMap(groupItems[0], "item_key")
			groupPayload["item_name"] = stringFromMap(groupItems[0], "item_name")
			groupPayload["item_hint"] = stringFromMap(groupItems[0], "item_hint")
			groupPayload["requires_reference"] = groupItems[0]["requires_reference"]
			groupPayload["uncertainty_level"] = groupItems[0]["uncertainty_level"]
			groupPayload["uncertainty_reason"] = groupItems[0]["uncertainty_reason"]
		}
		if creditUsage := mapFromAny(task.Payload["credit_usage"]); len(creditUsage) > 0 {
			groupPayload["credit_usage"] = creditUsage
		}
		if groupID := stringFromAny(task.Payload["credit_group_id"]); groupID != "" {
			groupPayload["credit_group_id"] = groupID
		}

		childTask := &domain.AnalysisTask{
			UserID:   task.UserID,
			TaskType: "precision_item_estimate",
			Status:   "pending",
			Payload:  groupPayload,
		}
		if sourceType == "text" {
			if task.TextInput != nil {
				childTask.TextInput = task.TextInput
			} else if text := stringFromMap(task.Payload, "text"); text != "" {
				childTask.TextInput = &text
			}
		} else {
			childTask.ImageURL = task.ImageURL
			childTask.ImagePaths = task.ImagePaths
		}
		if err := r.tasks.CreateTask(ctx, childTask); err != nil {
			return err
		}
		childTaskIDs = append(childTaskIDs, childTask.ID)

		itemName := displayGroupName(groupItems, groupIndex)
		sourceTaskID := childTask.ID
		if err := r.precision.CreateItemEstimate(ctx, &domain.PrecisionItemEstimate{
			SessionID:    sessionID,
			RoundIndex:   roundIndex,
			ItemIndex:    groupIndex,
			ItemKey:      fmt.Sprintf("group_%d", groupIndex),
			ItemName:     itemName,
			Status:       "pending",
			Payload:      groupPayload,
			SourceTaskID: &sourceTaskID,
		}); err != nil {
			return err
		}
		if err := r.enqueueTask(ctx, childTask); err != nil {
			return err
		}
	}

	aggregatePayload := map[string]any{
		"precision_session_id": sessionID,
		"round_index":          roundIndex,
		"split_strategy":       splitStrategy,
		"child_task_ids":       childTaskIDs,
		"source_type":          sourceType,
	}
	if creditUsage := mapFromAny(task.Payload["credit_usage"]); len(creditUsage) > 0 {
		aggregatePayload["credit_usage"] = creditUsage
	}
	if groupID := stringFromAny(task.Payload["credit_group_id"]); groupID != "" {
		aggregatePayload["credit_group_id"] = groupID
	}
	if task.ImageURL != nil && *task.ImageURL != "" {
		aggregatePayload["image_url"] = *task.ImageURL
	}
	if len(task.ImagePaths) > 0 {
		aggregatePayload["image_urls"] = task.ImagePaths
	}
	if task.TextInput != nil && strings.TrimSpace(*task.TextInput) != "" {
		aggregatePayload["text"] = strings.TrimSpace(*task.TextInput)
	}
	aggregateTask := &domain.AnalysisTask{
		UserID:     task.UserID,
		TaskType:   "precision_aggregate",
		Status:     "pending",
		ImageURL:   task.ImageURL,
		ImagePaths: task.ImagePaths,
		TextInput:  task.TextInput,
		Payload:    aggregatePayload,
	}
	if err := r.tasks.CreateTask(ctx, aggregateTask); err != nil {
		return err
	}

	result["precisionSessionId"] = sessionID
	result["precisionStatus"] = "estimating"
	result["precisionRoundIndex"] = roundIndex
	result["redirectTaskId"] = aggregateTask.ID
	result["itemsToEstimate"] = plannedItems
	if err := r.precision.UpdateSession(ctx, sessionID, map[string]any{
		"status":                "estimating",
		"split_plan":            map[string]any{"splitStrategy": splitStrategy, "items": plannedItems},
		"latest_planner_result": result,
		"pending_requirements":  []any{},
		"current_task_id":       aggregateTask.ID,
		"last_error":            nil,
		"updated_at":            time.Now(),
	}); err != nil {
		return err
	}
	if err := r.enqueueTask(ctx, aggregateTask); err != nil {
		return err
	}
	err = r.completeTask(ctx, task, result)
	return err
}

func (r *Runner) processPrecisionItemEstimate(ctx context.Context, task *domain.AnalysisTask) error {
	r.normalizeTaskImages(task, "food-images")
	estimate, err := r.precision.GetItemEstimateBySourceTask(ctx, task.ID)
	if err != nil {
		return err
	}
	if estimate != nil {
		if err := r.precision.UpdateItemEstimate(ctx, estimate.ID, map[string]any{"status": "processing", "error_message": nil}); err != nil {
			return err
		}
	}

	sourceType := stringFromMap(task.Payload, "source_type")
	if sourceType != "text" {
		sourceType = "image"
	}
	additionalContext := stringFromMap(task.Payload, "additionalContext")
	referenceObjects := extractItems(task.Payload["reference_objects"])
	plannedItems := extractItems(task.Payload["items_to_estimate"])
	imageURL := stringFromMap(task.Payload, "image_url")
	if imageURL == "" && task.ImageURL != nil {
		imageURL = strings.TrimSpace(*task.ImageURL)
	}
	imageURLs := stringSliceFromAny(task.Payload["image_urls"])
	if len(imageURLs) == 0 && len(task.ImagePaths) > 0 {
		imageURLs = task.ImagePaths
	}
	if len(imageURLs) == 0 && imageURL != "" {
		imageURLs = []string{imageURL}
	}
	textInput := stringFromMap(task.Payload, "text")
	if textInput == "" && task.TextInput != nil {
		textInput = strings.TrimSpace(*task.TextInput)
	}
	prompt, err := buildPrecisionItemEstimatePromptFromPayload(sourceType, task.Payload, textInput, additionalContext, referenceObjects)
	if err != nil {
		if estimate != nil {
			_ = r.precision.UpdateItemEstimate(ctx, estimate.ID, map[string]any{"status": "failed", "error_message": err.Error()})
		}
		return err
	}
	parsed, err := r.analyze.RunPrecisionJSONWithImagesNoFallback(ctx, sourceType, prompt, imageURLs, precisionWeightModelName)
	if err != nil {
		if estimate != nil {
			_ = r.precision.UpdateItemEstimate(ctx, estimate.ID, map[string]any{"status": "failed", "error_message": err.Error()})
		}
		return err
	}
	parsedItems, err := parsePrecisionEstimateItems(parsed, plannedItems, task.Payload)
	if err != nil {
		if estimate != nil {
			_ = r.precision.UpdateItemEstimate(ctx, estimate.ID, map[string]any{"status": "failed", "error_message": err.Error()})
		}
		return err
	}
	parsedItems = attachPrecisionItemMetadata(parsedItems, plannedItems)
	rawInputForRefine := textInput
	if sourceType == "image" {
		rawInputForRefine = additionalContext
		if rawInputForRefine == "" {
			rawInputForRefine = "图片输入"
		}
	}
	initialWeights := precisionWeightSnapshot(parsedItems)
	refinedNotes := []string{}
	refinedItems, notes, refineErr := r.maybeRefinePrecisionWeights(ctx, sourceType, parsedItems, plannedItems, rawInputForRefine, additionalContext, referenceObjects, imageURLs, precisionWeightModelName)
	if refineErr != nil {
		r.log.Warn("precision refine skipped",
			zap.String("task_id", task.ID),
			zap.Int("group_index", intFromMap(task.Payload, "group_index")),
			zap.Error(refineErr),
		)
	} else {
		parsedItems = attachPrecisionItemMetadata(refinedItems, plannedItems)
		refinedNotes = notes
		refinedWeights := precisionWeightSnapshot(parsedItems)
		if strings.Join(refinedWeights, "|") != strings.Join(initialWeights, "|") {
			r.log.Info("precision refine",
				zap.String("task_id", task.ID),
				zap.Int("group_index", intFromMap(task.Payload, "group_index")),
				zap.Strings("before", initialWeights),
				zap.Strings("after", refinedWeights),
			)
		}
	}
	dbItems := r.analyze.ApplyDBFirstToItems(ctx, parsedItems, additionalContext)
	dbItems = attachPrecisionItemMetadata(dbItems, plannedItems)
	uncertaintyNotes := stringSliceFromAny(parsed["uncertaintyNotes"])
	uncertaintyNotes = append(uncertaintyNotes, refinedNotes...)
	var result map[string]any
	if len(plannedItems) > 1 {
		result = map[string]any{"items": dbItems, "uncertaintyNotes": nilIfEmptyStrings(uncertaintyNotes)}
	} else {
		var item any
		if len(dbItems) > 0 {
			item = dbItems[0]
		}
		result = map[string]any{"item": item, "uncertaintyNotes": nilIfEmptyStrings(uncertaintyNotes)}
	}
	lookupSummary := summarizeLookupItems(dbItems)
	r.log.Info("precision estimate",
		zap.String("task_id", task.ID),
		zap.String("session_id", stringFromMap(task.Payload, "precision_session_id")),
		zap.Int("round", intFromMap(task.Payload, "round_index")),
		zap.Int("group_index", intFromMap(task.Payload, "group_index")),
		zap.Int("items", intFromMap(lookupSummary, "total")),
		zap.Int("db_hits", intFromMap(lookupSummary, "library_hits")),
		zap.Int("deepseek_fallback", intFromMap(lookupSummary, "deepseek_fallback")),
		zap.Int("unresolved", intFromMap(lookupSummary, "unresolved")),
	)
	if estimate != nil {
		if err := r.precision.UpdateItemEstimate(ctx, estimate.ID, map[string]any{"status": "done", "result": result, "error_message": nil}); err != nil {
			return err
		}
	}
	err = r.completeTask(ctx, task, result)
	return err
}

func (r *Runner) processPrecisionAggregate(ctx context.Context, task *domain.AnalysisTask) error {
	sessionID := stringFromMap(task.Payload, "precision_session_id")
	if sessionID == "" {
		return fmt.Errorf("precision_aggregate task missing precision_session_id")
	}
	roundIndex := intFromMap(task.Payload, "round_index")
	if roundIndex <= 0 {
		roundIndex = 1
	}
	deadline := time.Now().Add(120 * time.Second)
	var estimates []domain.PrecisionItemEstimate
	for {
		rows, err := r.precision.ListItemEstimates(ctx, sessionID, roundIndex)
		if err != nil {
			return err
		}
		estimates = rows
		if len(estimates) > 0 && allPrecisionEstimatesFinished(estimates) {
			break
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("精准模式聚合等待子项估计超时")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	for _, estimate := range estimates {
		if estimate.Status == "failed" {
			msg := "子项估计失败"
			if estimate.ErrorMessage != nil && *estimate.ErrorMessage != "" {
				msg = *estimate.ErrorMessage
			}
			return fmt.Errorf("%s 精准估计失败：%s", estimate.ItemName, msg)
		}
	}
	finalResult, err := buildPrecisionFinalResult(sessionID, roundIndex, stringFromMap(task.Payload, "split_strategy"), estimates)
	if err != nil {
		return err
	}
	lookupSummary := finalResult["dbLookupSummary"]
	r.log.Info("precision aggregate",
		zap.String("task_id", task.ID),
		zap.String("session_id", sessionID),
		zap.Int("round", roundIndex),
		zap.String("split_strategy", stringFromMap(task.Payload, "split_strategy")),
		zap.Int("items", intFromMap(mapFromAny(lookupSummary), "total")),
		zap.Int("db_hits", intFromMap(mapFromAny(lookupSummary), "library_hits")),
		zap.Int("deepseek_fallback", intFromMap(mapFromAny(lookupSummary), "deepseek_fallback")),
		zap.Int("unresolved", intFromMap(mapFromAny(lookupSummary), "unresolved")),
	)
	if err := r.precision.UpdateSession(ctx, sessionID, map[string]any{
		"status":          "done",
		"final_result":    finalResult,
		"current_task_id": task.ID,
		"last_error":      nil,
		"updated_at":      time.Now(),
	}); err != nil {
		return err
	}
	err = r.completeTask(ctx, task, finalResult)
	return err
}

func normalizePrecisionPlanResult(parsed map[string]any) map[string]any {
	if parsed == nil {
		parsed = map[string]any{}
	}
	precisionStatus := strings.ToLower(strings.TrimSpace(stringFromAny(parsed["precisionStatus"])))
	if precisionStatus != "needs_user_input" && precisionStatus != "needs_retake" && precisionStatus != "ready_for_estimate" {
		precisionStatus = "ready_for_estimate"
	}
	splitStrategy := strings.ToLower(strings.TrimSpace(stringFromAny(parsed["splitStrategy"])))
	if !validPrecisionSplitStrategy(splitStrategy) {
		splitStrategy = "single_item"
	}
	detectedItems := stringSliceFromAny(parsed["detectedItemsSummary"])
	itemsToEstimate := normalizePrecisionPlanItems(parsed["itemsToEstimate"])
	if len(itemsToEstimate) == 0 {
		for index, name := range detectedItems {
			itemsToEstimate = append(itemsToEstimate, map[string]any{
				"item_key":           fmt.Sprintf("detected_%d", index+1),
				"item_name":          name,
				"item_hint":          "来自画面识别摘要，按主体食物继续估计",
				"requires_reference": false,
				"uncertainty_level":  "medium",
			})
		}
	}
	if len(itemsToEstimate) == 0 {
		itemsToEstimate = append(itemsToEstimate, map[string]any{
			"item_key":           "meal",
			"item_name":          "整餐",
			"item_hint":          "当前信息不足以稳定拆分时，按整顿餐食直接估计",
			"requires_reference": true,
			"uncertainty_level":  "high",
			"uncertainty_reason": "当前画面或文字未能稳定拆分出独立主体",
		})
	}
	precisionStatus = "ready_for_estimate"
	if len(itemsToEstimate) > 1 && (splitStrategy == "single_item" || splitStrategy == "multi_item_parallel") {
		hasHigh := false
		for _, item := range itemsToEstimate {
			if stringFromMap(item, "uncertainty_level") == "high" {
				hasHigh = true
				break
			}
		}
		if len(itemsToEstimate) <= 3 && !hasHigh {
			splitStrategy = "single_shot"
		} else {
			splitStrategy = "grouped_parallel"
		}
	}
	return map[string]any{
		"precisionStatus":            precisionStatus,
		"splitStrategy":              splitStrategy,
		"detectedItemsSummary":       detectedItems,
		"followupQuestions":          stringSliceFromAny(parsed["followupQuestions"]),
		"retakeInstructions":         stringSliceFromAny(firstNonNil(parsed["retakeInstructions"], parsed["retakeGuidance"])),
		"pendingRequirements":        stringSliceFromAny(parsed["pendingRequirements"]),
		"referenceObjectNeeded":      boolFromAny(parsed["referenceObjectNeeded"]),
		"referenceObjectSuggestions": stringSliceFromAny(parsed["referenceObjectSuggestions"]),
		"uncertaintyNotes":           stringSliceFromAny(parsed["uncertaintyNotes"]),
		"itemsToEstimate":            itemsToEstimate,
		"rejectionReason":            stringFromMap(parsed, "rejectionReason"),
		"description":                stringFromMap(parsed, "description"),
		"insight":                    stringFromMap(parsed, "insight"),
	}
}

func validPrecisionSplitStrategy(value string) bool {
	switch value {
	case "single_item", "multi_item_parallel", "single_shot", "grouped_parallel", "retake_required", "user_annotation_required":
		return true
	default:
		return false
	}
}

func normalizePrecisionPlanItems(value any) []map[string]any {
	rawItems := extractItems(value)
	items := make([]map[string]any, 0, len(rawItems))
	for index, item := range rawItems {
		name := firstNonEmptyString(item, "item_name", "name")
		if name == "" {
			continue
		}
		itemKey := firstNonEmptyString(item, "item_key")
		if itemKey == "" {
			itemKey = fmt.Sprintf("item_%d", index+1)
		}
		level := strings.ToLower(firstNonEmptyString(item, "uncertainty_level"))
		if level != "low" && level != "medium" && level != "high" {
			level = "medium"
		}
		items = append(items, map[string]any{
			"item_key":           itemKey,
			"item_name":          name,
			"item_hint":          firstNonEmptyString(item, "item_hint"),
			"candidate_names":    precisionCandidateNames(item),
			"alternative_name":   firstNonEmptyString(item, "alternative_name", "alternativeName"),
			"visual_evidence":    firstNonEmptyString(item, "visual_evidence", "visualEvidence", "recognition_evidence", "recognitionEvidence"),
			"requires_reference": boolFromAny(item["requires_reference"]),
			"uncertainty_level":  level,
			"uncertainty_reason": firstNonEmptyString(item, "uncertainty_reason"),
		})
	}
	return items
}

func buildPrecisionEstimateItems(plan map[string]any, sourceType string) []map[string]any {
	rawItems := extractItems(plan["itemsToEstimate"])
	if len(rawItems) == 0 {
		rawItems = extractItems(plan["items"])
	}
	out := make([]map[string]any, 0, len(rawItems))
	for index, raw := range rawItems {
		name := firstNonEmptyString(raw, "item_name", "name")
		if name == "" {
			continue
		}
		itemKey := firstNonEmptyString(raw, "item_key")
		if itemKey == "" {
			itemKey = fmt.Sprintf("item_%d", index+1)
		}
		level := strings.ToLower(firstNonEmptyString(raw, "uncertainty_level"))
		if level != "low" && level != "medium" && level != "high" {
			level = "medium"
		}
		out = append(out, map[string]any{
			"item_key":           itemKey,
			"item_name":          name,
			"item_hint":          firstNonEmptyString(raw, "item_hint"),
			"candidate_names":    precisionCandidateNames(raw),
			"alternative_name":   firstNonEmptyString(raw, "alternative_name", "alternativeName"),
			"visual_evidence":    firstNonEmptyString(raw, "visual_evidence", "visualEvidence", "recognition_evidence", "recognitionEvidence"),
			"requires_reference": boolFromAny(raw["requires_reference"]),
			"uncertainty_level":  level,
			"uncertainty_reason": firstNonEmptyString(raw, "uncertainty_reason"),
		})
	}
	if len(out) == 0 {
		fallbackName := "整餐"
		if sourceType == "text" {
			fallbackName = "整段描述"
		}
		out = append(out, map[string]any{
			"item_key":           "meal",
			"item_name":          fallbackName,
			"item_hint":          "当前信息不足以稳定拆分时，按整体直接估计",
			"requires_reference": sourceType == "image",
			"uncertainty_level":  "high",
			"uncertainty_reason": "当前画面或文字未能稳定拆分出独立主体",
		})
	}
	return out
}

func groupPrecisionItems(items []map[string]any) [][]map[string]any {
	if len(items) <= 1 {
		return [][]map[string]any{items}
	}
	hasHigh := false
	for _, item := range items {
		if stringFromMap(item, "uncertainty_level") == "high" {
			hasHigh = true
			break
		}
	}
	if len(items) <= 3 && !hasHigh {
		return [][]map[string]any{items}
	}
	groups := [][]map[string]any{}
	high := []map[string]any{}
	other := []map[string]any{}
	for _, item := range items {
		if stringFromMap(item, "uncertainty_level") == "high" {
			high = append(high, item)
		} else {
			other = append(other, item)
		}
	}
	for i := 0; i < len(high); i += 2 {
		end := i + 2
		if end > len(high) {
			end = len(high)
		}
		groups = append(groups, high[i:end])
	}
	for i := 0; i < len(other); i += 3 {
		end := i + 3
		if end > len(other) {
			end = len(other)
		}
		groups = append(groups, other[i:end])
	}
	return groups
}

func groupPrecisionItemsByStrategy(items []map[string]any, splitStrategy string) [][]map[string]any {
	if len(items) == 0 {
		return nil
	}
	if splitStrategy == "single_shot" && len(items) <= 3 {
		return [][]map[string]any{items}
	}
	if len(items) <= 1 {
		return [][]map[string]any{items}
	}
	groups := [][]map[string]any{}
	high := []map[string]any{}
	other := []map[string]any{}
	for _, item := range items {
		if stringFromMap(item, "uncertainty_level") == "high" {
			high = append(high, item)
		} else {
			other = append(other, item)
		}
	}
	for i := 0; i < len(high); i += 2 {
		end := i + 2
		if end > len(high) {
			end = len(high)
		}
		groups = append(groups, high[i:end])
	}
	for i := 0; i < len(other); i += 3 {
		end := i + 3
		if end > len(other) {
			end = len(other)
		}
		groups = append(groups, other[i:end])
	}
	return groups
}

func splitStrategyForGroups(groups [][]map[string]any) string {
	if len(groups) == 1 {
		if len(groups[0]) == 1 {
			return "single_item"
		}
		return "single_shot"
	}
	return "grouped_parallel"
}

func displayGroupName(items []map[string]any, groupIndex int) string {
	names := make([]string, 0, len(items))
	for _, item := range items {
		name := stringFromMap(item, "item_name")
		if name != "" {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return fmt.Sprintf("第%d组", groupIndex+1)
	}
	if len(names) > 3 {
		return strings.Join(names[:3], "、") + "等"
	}
	return strings.Join(names, "、")
}

func formatPrecisionGroups(groups [][]map[string]any) string {
	if len(groups) == 0 {
		return "无分组"
	}
	parts := make([]string, 0, len(groups))
	for index, groupItems := range groups {
		labels := []string{}
		for _, item := range groupItems {
			name := firstNonEmptyString(item, "item_name", "name")
			if name == "" {
				name = fmt.Sprintf("item_%d", index+1)
			}
			level := strings.ToLower(firstNonEmptyString(item, "uncertainty_level"))
			if level == "" {
				level = "medium"
			}
			labels = append(labels, fmt.Sprintf("%s<%s>", name, level))
		}
		parts = append(parts, fmt.Sprintf("group%d=[%s]", index+1, strings.Join(labels, ", ")))
	}
	return strings.Join(parts, "; ")
}

func buildReferenceObjectsHint(referenceObjects []map[string]any) string {
	if len(referenceObjects) == 0 {
		return "当前没有提供参考物。"
	}
	lines := []string{}
	for _, ref := range referenceObjects {
		dims, _ := ref["dimensions_mm"].(map[string]any)
		dimTokens := []string{}
		if dims != nil {
			if value := stringFromAny(dims["length"]); value != "" {
				dimTokens = append(dimTokens, "长"+value+"mm")
			}
			if value := stringFromAny(dims["width"]); value != "" {
				dimTokens = append(dimTokens, "宽"+value+"mm")
			}
			if value := stringFromAny(dims["height"]); value != "" {
				dimTokens = append(dimTokens, "高"+value+"mm")
			}
		}
		dimText := "尺寸未提供"
		if len(dimTokens) > 0 {
			dimText = strings.Join(dimTokens, "，")
		}
		placement := stringFromMap(ref, "placement_note")
		placementText := ""
		if placement != "" {
			placementText = "，摆放说明：" + placement
		}
		applies := stringSliceFromAny(ref["applies_to_items"])
		applyText := ""
		if len(applies) > 0 {
			applyText = "，适用于 " + strings.Join(applies, ", ")
		}
		name := firstNonEmptyString(ref, "reference_name", "name")
		if name == "" {
			name = "参考物"
		}
		lines = append(lines, fmt.Sprintf("- %s: %s%s%s", name, dimText, placementText, applyText))
	}
	return "参考物信息：\n" + strings.Join(lines, "\n")
}

func precisionCandidateNames(item map[string]any) []string {
	if item == nil {
		return nil
	}
	candidates := stringSliceFromAny(firstNonNil(item["candidate_names"], item["candidateNames"], item["recognition_candidates"], item["recognitionCandidates"]))
	for _, raw := range extractItems(firstNonNil(item["candidates"], item["candidateFoods"])) {
		if name := firstNonEmptyString(raw, "name", "food_name", "item_name"); name != "" {
			candidates = append(candidates, name)
		}
	}
	if alt := firstNonEmptyString(item, "alternative_name", "alternativeName"); alt != "" {
		candidates = append(candidates, alt)
	}
	if name := firstNonEmptyString(item, "item_name", "name"); name != "" {
		candidates = append([]string{name}, candidates...)
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		key := normalizeFoodName(candidate)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, candidate)
		if len(out) >= 3 {
			break
		}
	}
	return out
}

func buildPrecisionCandidateHint(item map[string]any) string {
	parts := []string{}
	if candidates := precisionCandidateNames(item); len(candidates) > 1 {
		parts = append(parts, "候选："+strings.Join(candidates, "/"))
	}
	if evidence := firstNonEmptyString(item, "visual_evidence", "visualEvidence", "recognition_evidence", "recognitionEvidence"); evidence != "" {
		parts = append(parts, "视觉证据："+evidence)
	}
	if alt := firstNonEmptyString(item, "alternative_name", "alternativeName"); alt != "" {
		parts = append(parts, "备选："+alt)
	}
	return strings.Join(parts, "；")
}

func buildPrecisionPlanPrompt(sourceType, rawInput, additionalContext string, referenceObjects []map[string]any, previousRounds []domain.PrecisionSessionRound) string {
	previousContext := []string{}
	start := len(previousRounds) - 3
	if start < 0 {
		start = 0
	}
	for _, round := range previousRounds[start:] {
		if len(round.PlannerResult) == 0 {
			continue
		}
		if data, err := json.Marshal(round.PlannerResult); err == nil {
			previousContext = append(previousContext, string(data))
		}
	}
	if strings.TrimSpace(rawInput) == "" {
		rawInput = "无"
	}
	previousBlock := strings.Join(previousContext, "\n")
	if previousBlock == "" {
		previousBlock = "无"
	}
	if additionalContext == "" {
		additionalContext = "无"
	}
	return fmt.Sprintf(`你是精准模式的直接估计规划器。你的任务不是跟用户对话，而是尽可能把当前画面/文本拆成可直接估计的主体，并为后续数据库营养检索提供结构化列表。

请基于当前输入，返回 JSON，且 precisionStatus 统一使用 ready_for_estimate。

当前输入类型：%s
原始输入：
%s

用户补充说明：
%s

%s

最近几轮历史（如有）：
%s

要求：
- 如果有多个主体食物，请拆成 itemsToEstimate，后续并行估计。
- 食物种类识别优先于重量估计。每个主体先列出 2-3 个最可能的候选食物，再根据视觉证据选择 item_name。
- 候选筛选必须看具体视觉证据：切法、形状、边缘/皮、是否有馅、颜色、纹理、菜梗/叶片比例、包裹方式、烹饪方式和所在区域；不要只按常见菜名猜。
- 对容易混淆的食物必须显式区分：莴苣/莴笋片 vs 青菜/小白菜，百叶包/千张包/豆皮包 vs 蒸饺/馄饨，鱼块 vs 鸡块，豆干 vs 肉块。
- 如果最可能名称不确定，item_name 填最可能的那个，candidate_names 保留 2-3 个候选，alternative_name 填次可能名称，visual_evidence 写选择依据。
- 不要生成追问式输出，也不要要求用户补充后再继续。
- 如果缺比例尺且会显著影响估重，请把 referenceObjectNeeded 设为 true，但仍然返回可估计主体。
- itemsToEstimate 中每个主体必须给 item_key、item_name、candidate_names、visual_evidence、uncertainty_level，可选 item_hint / alternative_name。
- uncertainty_level 规则：
  - low：单一食材、形状固定（如苹果、鸡蛋、鸡胸肉块、白米饭）
  - medium：普通菜肴、食材可见（如清炒西兰花、蒸蛋、切片水果）
  - high：混合菜、酱汁覆盖、油炸膨胀、无固定形状（如炒饭、炒面、咖喱、红烧肉、油条、粥、汤面）
- 如果有 high 难度的食物且没有提供参考物，依旧返回 ready_for_estimate，并在 referenceObjectSuggestions / uncertaintyNotes 中给出建议。
- followupQuestions 和 retakeInstructions 仅作内部备注，能留空就留空。

只返回 JSON，结构如下：
{
  "precisionStatus": "ready_for_estimate",
  "splitStrategy": "single_item | multi_item_parallel | single_shot | grouped_parallel | retake_required | user_annotation_required",
  "detectedItemsSummary": ["米饭", "鸡腿", "西兰花"],
  "followupQuestions": [],
  "retakeInstructions": [],
  "pendingRequirements": ["reference_object", "cook_method"],
  "referenceObjectNeeded": true,
  "referenceObjectSuggestions": ["手掌", "常规卡片", "大卡片"],
  "uncertaintyNotes": ["米饭厚度不清楚"],
  "rejectionReason": "当前主体遮挡严重",
  "description": "可继续精估",
  "insight": "先补充信息再进入精估。",
  "itemsToEstimate": [
    {"item_key": "rice", "item_name": "米饭", "candidate_names": ["米饭", "粥"], "alternative_name": "粥", "visual_evidence": "白色颗粒状主食，米粒边界清楚", "item_hint": "主食区域", "requires_reference": false, "uncertainty_level": "low"},
    {"item_key": "wrapped_tofu_skin", "item_name": "百叶包", "candidate_names": ["百叶包", "蒸饺", "馄饨"], "alternative_name": "蒸饺", "visual_evidence": "外皮呈豆皮褶皱和方形包裹感，不是半透明面皮", "item_hint": "右侧包裹类主体", "requires_reference": false, "uncertainty_level": "medium"},
    {"item_key": "lettuce_stem", "item_name": "莴苣片", "candidate_names": ["莴苣片", "青菜", "西兰花梗"], "alternative_name": "青菜", "visual_evidence": "浅绿色厚片状茎部为主，叶片很少", "item_hint": "左侧绿色蔬菜", "requires_reference": false, "uncertainty_level": "medium"}
  ]
}`, sourceType, rawInput, additionalContext, buildReferenceObjectsHint(referenceObjects), previousBlock)
}

func buildPrecisionItemEstimatePromptFromPayload(sourceType string, payload map[string]any, textInput, additionalContext string, referenceObjects []map[string]any) (string, error) {
	items := extractItems(payload["items_to_estimate"])
	if len(items) > 1 {
		return buildPrecisionItemEstimatePromptMulti(sourceType, items, textInput, additionalContext, referenceObjects), nil
	}
	itemName := stringFromMap(payload, "item_name")
	if itemName == "" && len(items) == 1 {
		itemName = firstNonEmptyString(items[0], "item_name", "name")
	}
	if itemName == "" {
		return "", fmt.Errorf("精准模式子项估计任务缺少 item_name")
	}
	itemHint := stringFromMap(payload, "item_hint")
	if itemHint == "" && len(items) == 1 {
		itemHint = firstNonEmptyString(items[0], "item_hint")
	}
	if len(items) == 1 {
		if candidateHint := buildPrecisionCandidateHint(items[0]); candidateHint != "" {
			if itemHint != "" {
				itemHint += "；" + candidateHint
			} else {
				itemHint = candidateHint
			}
		}
	}
	return buildPrecisionItemEstimatePromptSingle(sourceType, itemName, itemHint, textInput, additionalContext, referenceObjects), nil
}

func buildPrecisionItemEstimatePromptSingle(sourceType, itemName, itemHint, rawInput, additionalContext string, referenceObjects []map[string]any) string {
	if rawInput == "" {
		rawInput = "无"
	}
	if sourceType == "image" && rawInput == "无" {
		rawInput = "图片输入"
	}
	hintBlock := ""
	if itemHint != "" {
		hintBlock = "主体提示：" + itemHint + "\n"
	}
	if additionalContext == "" {
		additionalContext = "无"
	}
	return fmt.Sprintf(`你是精准模式的分项估计器。你现在只需要聚焦一个主体食物：%s。
%s原始输入：
%s

补充说明：
%s

%s

要求：
- 只输出这个主体食物自己的名称和估计重量，不要把其他食物并进去。
- 先判断食物种类，再估重量；如果 planner 给的名称和视觉证据不一致，可以把 name 修正为更可能的候选食物。
- 对相似项必须比较视觉证据：莴苣/莴笋片看厚片茎部和浅绿半透明质感，青菜/小白菜看叶片和菜梗；百叶包/千张包看豆皮褶皱和包裹边缘，蒸饺/馄饨看面皮半透明和褶边。
- 如果只能在两个名称之间选择，name 填更可能的主名称，并在 uncertaintyNotes 简短记录备选。
- 如果画面/描述里还有其他食物，忽略它们。
- 参考物和尺寸如果可用，请务必用于精确估重。
- 只有“图中可见”的参考物或容器，才能当强比例尺；不在图中的参考物尺寸只能当弱提示，不能当精确比例尺。
- 估重时必须同时考虑：可见面积、堆叠高度/厚度、容器占比、与餐具/手掌/碗盘的相对大小。
- 主食和混合菜（米饭、面条、炒饭、盖饭、粥、带酱汁菜）不要套用保守默认值，必须根据容器填充深度和实际视觉占比修正。
%s
- 对以下容易估计错误的食物要特别仔细：混合菜（如炒饭、炒面）、带酱汁的食物、油炸食物、无固定形状的食物（如粥、汤）。
- 仅返回 JSON。

JSON 结构：
{
  "item": {
    "name": "%s",
    "estimatedWeightGrams": 180
  },
  "uncertaintyNotes": ["如果没有参考物，重量可能有一定波动"]
}`, itemName, hintBlock, rawInput, additionalContext, buildReferenceObjectsHint(referenceObjects), precisionStapleVolumeRules(), itemName)
}

func buildPrecisionItemEstimatePromptMulti(sourceType string, items []map[string]any, rawInput, additionalContext string, referenceObjects []map[string]any) string {
	if rawInput == "" {
		rawInput = "无"
	}
	if sourceType == "image" && rawInput == "无" {
		rawInput = "图片输入"
	}
	lines := []string{}
	for index, item := range items {
		name := firstNonEmptyString(item, "item_name", "name")
		if name == "" {
			name = fmt.Sprintf("食物%d", index+1)
		}
		line := "  - " + name
		if hint := firstNonEmptyString(item, "item_hint"); hint != "" {
			line += "（" + hint + "）"
		}
		if candidateHint := buildPrecisionCandidateHint(item); candidateHint != "" {
			line += "（" + candidateHint + "）"
		}
		if stringFromMap(item, "uncertainty_level") == "high" {
			line += " 【注意：此食物较难精确估重，请特别仔细】"
		}
		lines = append(lines, line)
	}
	if additionalContext == "" {
		additionalContext = "无"
	}
	return fmt.Sprintf(`你是精准模式的分项估计器。请对以下食物进行一次性估计：

%s

原始输入：
%s

补充说明：
%s

%s

要求：
- 分别输出每个食物的名称和估计重量。
- 先判断食物种类，再估重量；如果 planner 给的名称和视觉证据不一致，可以把 name 修正为更可能的候选食物。
- 对相似项必须比较视觉证据：莴苣/莴笋片看厚片茎部和浅绿半透明质感，青菜/小白菜看叶片和菜梗；百叶包/千张包看豆皮褶皱和包裹边缘，蒸饺/馄饨看面皮半透明和褶边。
- 如果只能在两个名称之间选择，name 填更可能的主名称，并在 uncertaintyNotes 简短记录备选。
- 注意食物之间的比例关系和相对大小，这有助于更准确地估重。
- 参考物和尺寸如果可用，请务必用于精确估重。
- 只有“图中可见”的参考物或容器，才能当强比例尺；不在图中的参考物尺寸只能当弱提示，不能当精确比例尺。
- 每个食物都必须根据自身可见面积、厚度/高度、容器占比、与餐具/碗盘/手掌的相对大小估重。
- 主食和混合菜（米饭、面条、炒饭、盖饭、粥、带酱汁菜）不要套用保守默认值，必须根据容器填充深度和实际视觉占比修正。
%s
- 对标记为【注意】的难估食物要特别仔细。
- 仅返回 JSON。

JSON 结构：
{
  "items": [
    {"name": "食物名称1", "estimatedWeightGrams": 180},
    {"name": "食物名称2", "estimatedWeightGrams": 120}
  ],
  "uncertaintyNotes": ["如果没有参考物，重量可能有一定波动"]
}`, strings.Join(lines, "\n"), rawInput, additionalContext, buildReferenceObjectsHint(referenceObjects), precisionStapleVolumeRules())
}

func precisionStapleVolumeRules() string {
	return `- 主食估重必须先判断“容器容量 × 填充比例 × 食物厚度/松散度”，绝不能直接套用常见一碗饭 180g/200g。
- 米饭/面条/粉/粥/炒饭/盖饭必须区分：深碗满装、浅碗半碗、盘底薄薄一层、被菜覆盖的一小撮，这些重量差异很大。
- “薄薄一层”不能直接等于低克重；如果铺开的面积很大，体积和重量仍可能不小。必须先估可见面积，再估平均厚度，得到体积后再换算重量。
- 判断主食时请观察容器口径、碗/盘深度、主食占容器面积、堆叠高度、边缘厚度、是否被菜盖住；看不到厚度时不要默认偏高或默认偏低。
- 熟米饭可粗略按体积估算，约 0.75-0.85g/ml；熟面/粉更蓬松，约 0.55-0.70g/ml；粥含水更多，需看碗深和液面高度。
- 估计时请给出与实际可见体积一致的克重：小面积薄层应低，大面积薄层可中等，深碗厚堆可高；不要使用固定区间替代体积判断。`
}

var precisionWeightRefinementKeywords = []string{
	"米饭",
	"白饭",
	"炒饭",
	"盖饭",
	"面",
	"面条",
	"粉",
	"粥",
	"馒头",
	"包子",
	"面包",
	"红烧肉",
	"咖喱",
	"油条",
	"汤面",
}

func shouldRefinePrecisionWeights(plannedItems []map[string]any) bool {
	return len(plannedItems) > 0
}

func buildPrecisionWeightRefinePrompt(items []map[string]any, rawInput, additionalContext string, referenceObjects []map[string]any) string {
	itemLines := []string{}
	for _, item := range items {
		name := firstNonEmptyString(item, "name", "item_name")
		if name == "" {
			name = "未知食物"
		}
		weight, _ := floatFromAny(item["estimatedWeightGrams"])
		uncertaintyLevel := strings.ToLower(firstNonEmptyString(item, "uncertainty_level"))
		if uncertaintyLevel == "" {
			uncertaintyLevel = "medium"
		}
		note := ""
		if uncertaintyLevel == "high" || precisionNameHasRefineKeyword(name) {
			note = "，重点复核"
		}
		itemLines = append(itemLines, fmt.Sprintf("- %s: 当前估计 %.0fg，难度 %s%s", name, weight, uncertaintyLevel, note))
	}
	if rawInput == "" {
		rawInput = "无"
	}
	if additionalContext == "" {
		additionalContext = "无"
	}
	return fmt.Sprintf(`你是精准模式的重量复核器。请复核下面这些食物的重量估计，重点检查模型是否因为“保守默认值”而低估或高估。

当前估计：
%s

原始输入：
%s

补充说明：
%s

%s

复核规则：
- 只复核重量，不要补充营养。
- 只有“图中可见”的参考物或容器，才能当强比例尺；不在图中的参考物尺寸只能当弱提示。
- 必须根据可见面积、容器填充深度、堆积高度/厚度、与餐具/碗盘/手掌的相对大小重新审视重量。
- 主食和混合菜（米饭、面条、炒饭、盖饭、粥、带酱汁菜）绝不能套用保守默认值。
%s
- 如果当前估计明显与视觉占比不符，必须修正；如果没有足够依据修正，可以保留原值，但要在 uncertaintyNotes 里写明原因。
- 仅返回 JSON。

JSON 结构：
{
  "items": [
    {"name": "食物名称1", "estimatedWeightGrams": 220},
    {"name": "食物名称2", "estimatedWeightGrams": 95}
  ],
  "uncertaintyNotes": ["米饭缺少清晰顶视角，估重仍有波动"]
}`, strings.Join(itemLines, "\n"), rawInput, additionalContext, buildReferenceObjectsHint(referenceObjects), precisionStapleVolumeRules())
}

func precisionNameHasRefineKeyword(name string) bool {
	for _, keyword := range precisionWeightRefinementKeywords {
		if strings.Contains(name, keyword) {
			return true
		}
	}
	return false
}

func buildPrecisionEstimateContext(payload map[string]any, existing string) string {
	items := extractItems(payload["items_to_estimate"])
	lines := []string{}
	if existing != "" {
		lines = append(lines, existing)
	}
	if len(items) == 1 {
		name := firstNonEmptyString(items[0], "item_name", "name")
		hint := firstNonEmptyString(items[0], "item_hint")
		if hint != "" {
			lines = append(lines, fmt.Sprintf("精准模式本轮只估计「%s」：%s。忽略其他食物。", name, hint))
		} else if name != "" {
			lines = append(lines, fmt.Sprintf("精准模式本轮只估计「%s」，忽略其他食物。", name))
		}
	} else if len(items) > 1 {
		names := []string{}
		for _, item := range items {
			name := firstNonEmptyString(item, "item_name", "name")
			if name != "" {
				names = append(names, name)
			}
		}
		if len(names) > 0 {
			lines = append(lines, "精准模式本轮只估计这些主体："+strings.Join(names, "、")+"。")
		}
	}
	lines = append(lines, "请重点输出这些主体的名称和 estimatedWeightGrams，营养由后端数据库优先回算。")
	return strings.Join(lines, "\n")
}

func parsePrecisionEstimateItems(parsed map[string]any, plannedItems []map[string]any, payload map[string]any) ([]map[string]any, error) {
	if parsed == nil {
		parsed = map[string]any{}
	}
	if len(plannedItems) > 0 {
		filterPayload := payload
		if filterPayload == nil {
			filterPayload = map[string]any{}
		}
		filterPayload["items_to_estimate"] = plannedItems
		parsed = filterPrecisionResultToPlanned(copyAnyMap(parsed), filterPayload)
	}
	isMulti := len(plannedItems) > 1
	if isMulti {
		rawItems := extractItems(parsed["items"])
		if len(rawItems) == 0 {
			return nil, fmt.Errorf("精准模式多食物估计未返回有效结果")
		}
		items := make([]map[string]any, 0, len(rawItems))
		for _, raw := range rawItems {
			name := firstNonEmptyString(raw, "name")
			weight, _ := floatFromAny(firstNonNil(raw["estimatedWeightGrams"], raw["weight"]))
			if name != "" {
				items = append(items, map[string]any{
					"name":                 name,
					"estimatedWeightGrams": weight,
				})
			}
		}
		return items, nil
	}

	itemPayload, ok := parsed["item"].(map[string]any)
	if !ok || itemPayload == nil {
		itemPayload = parsed
	}
	name := firstNonEmptyString(itemPayload, "name")
	weight, _ := floatFromAny(firstNonNil(itemPayload["estimatedWeightGrams"], itemPayload["weight"]))
	if name == "" {
		return nil, fmt.Errorf("精准模式子项估计未返回有效结果")
	}
	return []map[string]any{{
		"name":                 name,
		"estimatedWeightGrams": weight,
	}}, nil
}

func (r *Runner) maybeRefinePrecisionWeights(
	ctx context.Context,
	sourceType string,
	parsedItems []map[string]any,
	plannedItems []map[string]any,
	rawInput string,
	additionalContext string,
	referenceObjects []map[string]any,
	imageURLs []string,
	modelName string,
) ([]map[string]any, []string, error) {
	if !precisionRefineEnabled {
		return parsedItems, nil, nil
	}
	if len(parsedItems) == 0 || !shouldRefinePrecisionWeights(plannedItems) {
		return parsedItems, nil, nil
	}
	prompt := buildPrecisionWeightRefinePrompt(parsedItems, rawInput, additionalContext, referenceObjects)
	refineCtx, cancel := context.WithTimeout(ctx, precisionRefineTimeout)
	defer cancel()
	parsed, err := r.analyze.RunPrecisionJSONWithImagesTemperatureNoFallback(refineCtx, sourceType, prompt, imageURLs, modelName, 0.1)
	if err != nil {
		return parsedItems, nil, err
	}
	refinedItems, notes := parsePrecisionRefinedItems(parsed, parsedItems)
	return refinedItems, notes, nil
}

func parsePrecisionRefinedItems(parsed map[string]any, fallbackItems []map[string]any) ([]map[string]any, []string) {
	notes := []string{}
	if parsed != nil {
		notes = stringSliceFromAny(parsed["uncertaintyNotes"])
	}
	rawItems := extractItems(parsed["items"])
	if len(rawItems) == 0 {
		if item, ok := parsed["item"].(map[string]any); ok && item != nil {
			rawItems = []map[string]any{item}
		}
	}
	if len(rawItems) == 0 {
		return fallbackItems, notes
	}
	refined := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		name := firstNonEmptyString(raw, "name")
		if name == "" {
			continue
		}
		weight, _ := floatFromAny(firstNonNil(raw["estimatedWeightGrams"], raw["weight"]))
		refined = append(refined, map[string]any{
			"name":                 name,
			"estimatedWeightGrams": weight,
		})
	}
	if len(refined) == 0 {
		return fallbackItems, notes
	}
	filtered := filterPrecisionResultToPlanned(map[string]any{"items": refined}, map[string]any{"items_to_estimate": fallbackItems})
	if item, ok := filtered["item"].(map[string]any); ok && item != nil {
		return []map[string]any{item}, notes
	}
	filteredItems := extractItems(filtered["items"])
	if len(filteredItems) == 0 {
		return fallbackItems, notes
	}
	if len(filteredItems) > len(fallbackItems) && len(fallbackItems) > 0 {
		filteredItems = filteredItems[:len(fallbackItems)]
	}
	return filteredItems, notes
}

func precisionWeightSnapshot(items []map[string]any) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		name := stringFromMap(item, "name")
		weight, _ := floatFromAny(item["estimatedWeightGrams"])
		out = append(out, fmt.Sprintf("%s:%.2f", name, weight))
	}
	return out
}

func attachPrecisionItemMetadata(parsedItems, plannedItems []map[string]any) []map[string]any {
	if len(parsedItems) == 0 {
		return nil
	}
	enriched := make([]map[string]any, 0, len(parsedItems))
	for _, item := range parsedItems {
		enriched = append(enriched, copyAnyMap(item))
	}
	if len(plannedItems) == 0 {
		return enriched
	}

	used := map[int]bool{}
	for _, planned := range plannedItems {
		if planned == nil {
			continue
		}
		targetName := firstNonEmptyString(planned, "item_name", "name")
		matchIndex := findPrecisionMetadataMatchIndex(enriched, targetName, used)
		if matchIndex < 0 {
			for index := range enriched {
				if !used[index] {
					matchIndex = index
					break
				}
			}
		}
		if matchIndex < 0 {
			continue
		}
		used[matchIndex] = true
		for _, key := range []string{"item_key", "item_hint", "uncertainty_level", "uncertainty_reason"} {
			if value, ok := planned[key]; ok && !isEmptyAny(value) {
				enriched[matchIndex][key] = value
			}
		}
		if value, ok := planned["requires_reference"]; ok {
			enriched[matchIndex]["requires_reference"] = boolFromAny(value)
		}
	}
	return enriched
}

func findPrecisionMetadataMatchIndex(items []map[string]any, targetName string, used map[int]bool) int {
	targetNorm := normalizeFoodName(targetName)
	if targetNorm == "" {
		return -1
	}
	fuzzyIndex := -1
	for index, item := range items {
		if used[index] {
			continue
		}
		itemNorm := normalizeFoodName(stringFromMap(item, "name"))
		if itemNorm == "" {
			continue
		}
		if itemNorm == targetNorm {
			return index
		}
		if fuzzyIndex < 0 && (strings.Contains(targetNorm, itemNorm) || strings.Contains(itemNorm, targetNorm)) {
			fuzzyIndex = index
		}
	}
	return fuzzyIndex
}

func filterPrecisionResultToPlanned(result map[string]any, payload map[string]any) map[string]any {
	if result == nil {
		return result
	}
	planned := extractItems(payload["items_to_estimate"])
	if len(planned) == 0 {
		return result
	}
	items := extractItems(result["items"])
	if len(items) == 0 {
		if item, ok := result["item"].(map[string]any); ok && item != nil {
			if plannedItemMatches(item, planned) || len(planned) == 1 {
				return result
			}
			result["item"] = nil
		}
		return result
	}
	filtered := make([]map[string]any, 0, len(planned))
	used := make([]bool, len(items))
	for _, plan := range planned {
		bestIndex := -1
		bestScore := 0.0
		for index, item := range items {
			if used[index] {
				continue
			}
			score := plannedItemMatchScore(item, plan)
			if score > bestScore {
				bestScore = score
				bestIndex = index
			}
		}
		if bestIndex >= 0 && bestScore >= 0.4 {
			used[bestIndex] = true
			filtered = append(filtered, items[bestIndex])
		}
	}
	if len(filtered) == 0 && len(items) <= len(planned) {
		filtered = items
	}
	if len(planned) == 1 {
		if len(filtered) > 0 {
			result["item"] = filtered[0]
			delete(result, "items")
		}
		return result
	}
	result["items"] = filtered
	return result
}

func plannedItemMatches(item map[string]any, planned []map[string]any) bool {
	for _, plan := range planned {
		if plannedItemMatchScore(item, plan) >= 0.4 {
			return true
		}
	}
	return false
}

func plannedItemMatchScore(item map[string]any, plan map[string]any) float64 {
	itemName := normalizeFoodName(firstNonEmptyString(item, "name", "item_name"))
	planName := normalizeFoodName(firstNonEmptyString(plan, "item_name", "name"))
	if itemName == "" || planName == "" {
		return 0
	}
	if itemName == planName {
		return 1
	}
	if strings.Contains(itemName, planName) || strings.Contains(planName, itemName) {
		return 0.9
	}
	itemRunes := runeSet(itemName)
	planRunes := runeSet(planName)
	if len(itemRunes) == 0 || len(planRunes) == 0 {
		return 0
	}
	intersection := 0
	for ch := range itemRunes {
		if planRunes[ch] {
			intersection++
		}
	}
	union := len(itemRunes) + len(planRunes) - intersection
	if union == 0 {
		return 0
	}
	return float64(intersection) / float64(union)
}

func normalizeFoodName(name string) string {
	name = strings.TrimSpace(strings.ToLower(name))
	replacements := []string{" ", "\t", "\n", "\r", "（", "）", "(", ")", "，", ",", "、", "-", "_"}
	for _, old := range replacements {
		name = strings.ReplaceAll(name, old, "")
	}
	return name
}

func runeSet(value string) map[rune]bool {
	out := map[rune]bool{}
	for _, ch := range value {
		out[ch] = true
	}
	return out
}

func attachPlannedItemMetadata(result map[string]any, payload map[string]any) map[string]any {
	items := extractItems(result["items"])
	planned := extractItems(payload["items_to_estimate"])
	if len(planned) == 0 {
		return result
	}
	if len(items) == 0 {
		if item, ok := result["item"].(map[string]any); ok && item != nil {
			for _, key := range []string{"item_key", "item_hint", "uncertainty_level", "uncertainty_reason", "requires_reference"} {
				if value, ok := planned[0][key]; ok {
					item[key] = value
				}
			}
			result["item"] = item
		}
		return result
	}
	for index := range items {
		planIndex := index
		if planIndex >= len(planned) {
			planIndex = len(planned) - 1
		}
		for _, key := range []string{"item_key", "item_hint", "uncertainty_level", "uncertainty_reason", "requires_reference"} {
			if value, ok := planned[planIndex][key]; ok {
				items[index][key] = value
			}
		}
	}
	result["items"] = items
	return result
}

func allPrecisionEstimatesFinished(estimates []domain.PrecisionItemEstimate) bool {
	for _, estimate := range estimates {
		if estimate.Status != "done" && estimate.Status != "failed" {
			return false
		}
	}
	return true
}

func buildPrecisionFinalResult(sessionID string, roundIndex int, splitStrategy string, estimates []domain.PrecisionItemEstimate) (map[string]any, error) {
	sort.SliceStable(estimates, func(i, j int) bool {
		return estimates[i].ItemIndex < estimates[j].ItemIndex
	})
	items := []map[string]any{}
	uncertaintyNotes := []string{}
	hasDeepSeekFallback := false
	hasHighUncertainty := false
	for _, estimate := range estimates {
		result := estimate.Result
		if result == nil {
			continue
		}
		resultItems := extractItems(result["items"])
		if len(resultItems) == 0 {
			if item, ok := result["item"].(map[string]any); ok {
				resultItems = append(resultItems, item)
			}
		}
		for _, item := range resultItems {
			if _, ok := item["originalWeightGrams"]; !ok {
				item["originalWeightGrams"] = item["estimatedWeightGrams"]
			}
			if stringFromMap(item, "nutrition_source") == "deepseek_text_fallback" {
				hasDeepSeekFallback = true
			}
			if stringFromMap(item, "uncertainty_level") == "high" {
				hasHighUncertainty = true
			}
			items = append(items, item)
		}
		for _, note := range stringSliceFromAny(result["uncertaintyNotes"]) {
			uncertaintyNotes = append(uncertaintyNotes, note)
		}
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("精准模式聚合未生成有效食物明细")
	}
	names := []string{}
	for _, item := range items {
		name := stringFromMap(item, "name")
		if name != "" {
			names = append(names, name)
		}
	}
	description := strings.Join(limitStrings(names, 4), "、")
	if description == "" {
		description = "精准估计结果"
	} else if len(names) > 4 {
		description += "等"
	}
	lookup := summarizeLookupItems(items)
	_ = hasDeepSeekFallback
	_ = hasHighUncertainty
	insight := "已完成本餐食物和份量分析，可结合下方明细查看热量与营养构成。"
	return map[string]any{
		"description":                description,
		"insight":                    insight,
		"items":                      items,
		"pfc_ratio_comment":          nil,
		"absorption_notes":           nil,
		"context_advice":             nil,
		"recognitionOutcome":         "ok",
		"rejectionReason":            nil,
		"retakeGuidance":             nil,
		"allowedFoodCategory":        "unknown",
		"followupQuestions":          nil,
		"precisionSessionId":         sessionID,
		"precisionStatus":            "done",
		"precisionRoundIndex":        roundIndex,
		"pendingRequirements":        nil,
		"retakeInstructions":         nil,
		"referenceObjectNeeded":      nil,
		"referenceObjectSuggestions": nil,
		"detectedItemsSummary":       names,
		"splitStrategy":              splitStrategy,
		"dbLookupSummary":            lookup,
		"uncertaintyNotes":           nilIfEmptyStrings(uncertaintyNotes),
	}, nil
}

func summarizeLookupItems(items []map[string]any) map[string]any {
	out := map[string]any{"total": len(items), "library_hits": 0, "deepseek_fallback": 0, "unresolved": 0}
	for _, item := range items {
		source := stringFromMap(item, "nutrition_source")
		switch {
		case strings.HasPrefix(source, "library"):
			out["library_hits"] = intFromMap(out, "library_hits") + 1
		case source == "deepseek_text_fallback":
			out["deepseek_fallback"] = intFromMap(out, "deepseek_fallback") + 1
		default:
			out["unresolved"] = intFromMap(out, "unresolved") + 1
		}
	}
	return out
}

func extractItems(value any) []map[string]any {
	switch arr := value.(type) {
	case []map[string]any:
		return arr
	case []any:
		out := make([]map[string]any, 0, len(arr))
		for _, item := range arr {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

func copyAnyMap(in map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range in {
		out[key] = value
	}
	return out
}

func mapFromAny(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func firstPositiveFloat(payload map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		value, ok := floatFromAny(payload[key])
		if ok && value > 0 {
			return value, true
		}
	}
	return 0, false
}

func hasPositiveNutrient(nutrients map[string]any) bool {
	return hasPositiveNutrientMap(nutrients)
}

func hasPositiveNutrientMap(value any) bool {
	nutrients, ok := value.(map[string]any)
	if !ok {
		return false
	}
	for _, key := range []string{"calories", "protein", "carbs", "fat"} {
		if number, ok := floatFromAny(nutrients[key]); ok && number > 0 {
			return true
		}
	}
	return false
}

func isUnresolvedNutrition(item map[string]any) bool {
	if v, ok := item["is_unresolved"].(bool); ok && v {
		return true
	}
	status := strings.ToLower(strings.TrimSpace(stringFromMap(item, "resolve_status")))
	source := strings.ToLower(strings.TrimSpace(stringFromMap(item, "nutrition_source")))
	return status == "unresolved" || source == "unresolved"
}

func countResolvedItems(items []map[string]any) (int, int) {
	resolved := 0
	unresolved := 0
	for _, item := range items {
		if isUnresolvedNutrition(item) {
			unresolved++
		} else {
			resolved++
		}
	}
	return resolved, unresolved
}

func summarizeCorrectionItems(items []map[string]any) string {
	names := make([]string, 0, len(items))
	for _, item := range items {
		if name := strings.TrimSpace(stringFromMap(item, "name")); name != "" {
			names = append(names, name)
		}
		if len(names) >= 4 {
			break
		}
	}
	if len(names) == 0 {
		return "饮食分析结果"
	}
	return strings.Join(names, "、")
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if !isEmptyAny(value) {
			return value
		}
	}
	return nil
}

func isEmptyAny(value any) bool {
	if value == nil {
		return true
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v) == ""
	case []string:
		return len(v) == 0
	case []any:
		return len(v) == 0
	case []map[string]any:
		return len(v) == 0
	case map[string]any:
		return len(v) == 0
	default:
		return false
	}
}

func firstNonEmptyString(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := stringFromMap(m, key); value != "" {
			return value
		}
	}
	return ""
}

func boolFromAny(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(v, "true") || v == "1"
	default:
		return false
	}
}

func stringSliceFromAny(value any) []string {
	switch arr := value.(type) {
	case []string:
		return arr
	case []any:
		out := []string{}
		for _, item := range arr {
			text := strings.TrimSpace(fmt.Sprintf("%v", item))
			if text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
	}
}

func healthReportImageURLs(task *domain.AnalysisTask) []string {
	values := []string{}
	values = append(values, task.ImagePaths...)
	if task.ImageURL != nil {
		values = append(values, strings.Split(*task.ImageURL, ",")...)
	}
	if len(values) == 0 {
		if raw := stringFromMap(task.Payload, "image_url"); raw != "" {
			values = append(values, strings.Split(raw, ",")...)
		}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func (r *Runner) normalizeTaskImages(task *domain.AnalysisTask, bucketAlias string) {
	if task == nil {
		return
	}
	task.ImagePaths = r.resolveImageURLs(bucketAlias, task.ImagePaths)
	if len(task.ImagePaths) > 0 {
		first := task.ImagePaths[0]
		task.ImageURL = &first
		return
	}
	if task.ImageURL != nil {
		resolved := r.resolveImageURL(bucketAlias, *task.ImageURL)
		if resolved == "" {
			task.ImageURL = nil
		} else {
			task.ImageURL = &resolved
			task.ImagePaths = []string{resolved}
		}
	}
}

func (r *Runner) resolveImageURLs(bucketAlias string, values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = r.resolveImageURL(bucketAlias, value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (r *Runner) resolveImageURL(bucketAlias, value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if r.storage == nil {
		return value
	}
	resolved := r.storage.ResolveReferenceURL(bucketAlias, value)
	if resolved == "" {
		return value
	}
	return resolved
}

func anySlice(value any) []any {
	switch arr := value.(type) {
	case []any:
		return arr
	case []map[string]any:
		out := make([]any, 0, len(arr))
		for _, item := range arr {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}

func appendUniqueStrings(values []string, additions ...string) []string {
	seen := map[string]bool{}
	for _, value := range values {
		seen[value] = true
	}
	for _, addition := range additions {
		addition = strings.TrimSpace(addition)
		if addition != "" && !seen[addition] {
			seen[addition] = true
			values = append(values, addition)
		}
	}
	return values
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprintf("%v", value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func limitStrings(values []string, limit int) []string {
	if len(values) <= limit {
		return values
	}
	return values[:limit]
}

func nilIfEmptyStrings(values []string) any {
	if len(values) == 0 {
		return nil
	}
	return values
}

func (r *Runner) processPublicFoodModeration(ctx context.Context, task *domain.AnalysisTask) error {
	itemID := stringFromMap(task.Payload, "item_id")
	if itemID == "" {
		return fmt.Errorf("public food moderation task missing item_id")
	}
	text := ""
	if task.TextInput != nil {
		text = *task.TextInput
	}
	if violated, reason := violatesTextPolicy(text); violated {
		if err := r.publicFood.UpdateStatus(ctx, itemID, "rejected"); err != nil {
			return err
		}
		err := r.completeTask(ctx, task, map[string]any{"status": "rejected", "reason": reason})
		return err
	}
	if err := r.publicFood.UpdateStatus(ctx, itemID, "published"); err != nil {
		return err
	}
	err := r.completeTask(ctx, task, map[string]any{"status": "approved"})
	return err
}

func (r *Runner) processExercise(ctx context.Context, task *domain.AnalysisTask) error {
	if r.exercise == nil {
		return fmt.Errorf("exercise worker dependencies are not initialized")
	}
	desc := ""
	if task.TextInput != nil {
		desc = strings.TrimSpace(*task.TextInput)
	}
	if desc == "" {
		desc = stringFromMap(task.Payload, "exercise_desc")
	}
	imageURL := ""
	if task.ImageURL != nil {
		imageURL = strings.TrimSpace(*task.ImageURL)
	}
	if imageURL == "" {
		imageURL = stringFromMap(task.Payload, "image_url")
	}
	imageURL = r.resolveImageURL("food-images", imageURL)
	if desc == "" && imageURL == "" {
		return fmt.Errorf("exercise task missing text_input/image_url")
	}
	result, err := r.exercise.ProcessExerciseTask(ctx, task.UserID, desc, imageURL, stringFromMap(task.Payload, "recorded_on"), task.Payload)
	if err != nil {
		return err
	}
	err = r.completeTask(ctx, task, result)
	return err
}

func (r *Runner) processHealthReport(ctx context.Context, task *domain.AnalysisTask) error {
	if r.ocr == nil || r.healthDocs == nil || r.users == nil {
		return fmt.Errorf("health_report worker dependencies are not initialized")
	}
	imageURLs := r.resolveImageURLs("health-reports", healthReportImageURLs(task))
	if len(imageURLs) == 0 {
		return fmt.Errorf("health_report task missing image_url")
	}

	merged := map[string]any{
		"indicators":    []any{},
		"conclusions":   []string{},
		"suggestions":   []string{},
		"medical_notes": "",
		"_image_urls":   imageURLs,
	}
	allIndicators := []any{}
	allConclusions := []string{}
	allSuggestions := []string{}
	allNotes := []string{}
	for _, imageURL := range imageURLs {
		extracted, err := r.ocr.ExtractFromURL(ctx, imageURL)
		if err != nil {
			return err
		}
		allIndicators = append(allIndicators, anySlice(extracted["indicators"])...)
		allConclusions = appendUniqueStrings(allConclusions, stringSliceFromAny(extracted["conclusions"])...)
		allSuggestions = appendUniqueStrings(allSuggestions, stringSliceFromAny(extracted["suggestions"])...)
		if note := stringFromAny(extracted["medical_notes"]); note != "" {
			allNotes = append(allNotes, note)
		}
	}
	merged["indicators"] = allIndicators
	merged["conclusions"] = allConclusions
	merged["suggestions"] = allSuggestions
	merged["medical_notes"] = strings.Join(allNotes, "\n")

	imageURLRaw := strings.Join(imageURLs, ",")
	if task.ImageURL != nil && strings.TrimSpace(*task.ImageURL) != "" {
		imageURLRaw = strings.TrimSpace(*task.ImageURL)
	}
	now := time.Now()
	if err := r.healthDocs.Create(ctx, &userdomain.UserHealthDocument{
		UserID:           task.UserID,
		DocumentType:     "report",
		ImageURL:         &imageURLRaw,
		ExtractedContent: merged,
		CreatedAt:        &now,
	}); err != nil {
		return err
	}
	user, err := r.users.FindByID(ctx, task.UserID)
	if err != nil {
		return err
	}
	if user != nil {
		healthCondition := map[string]any{}
		for key, value := range user.HealthCondition {
			healthCondition[key] = value
		}
		healthCondition["report_extract"] = merged
		if _, err := r.users.UpdateFields(ctx, task.UserID, map[string]any{"health_condition": healthCondition}); err != nil {
			return err
		}
	}
	err = r.completeTask(ctx, task, map[string]any{"extracted_content": merged})
	return err
}

func (r *Runner) processExpiryRecognize(ctx context.Context, task *domain.AnalysisTask) error {
	if r.expiry == nil {
		return fmt.Errorf("expiry_recognize worker dependencies are not initialized")
	}
	imageURLs := r.resolveImageURLs("food-images", healthReportImageURLs(task))
	if len(imageURLs) == 0 {
		return fmt.Errorf("expiry_recognize task missing image_url/image_paths")
	}
	recognized, err := r.expiry.Recognize(ctx, expiryservice.RecognizeInput{
		ImageURLs:         imageURLs,
		AdditionalContext: stringFromMap(task.Payload, "additional_context"),
	})
	if err != nil {
		return err
	}
	result := map[string]any{
		"recognize_mode": "food_expiry",
		"items":          recognized.Items,
	}
	err = r.completeTask(ctx, task, result)
	return err
}

func (r *Runner) completeTask(ctx context.Context, task *domain.AnalysisTask, result map[string]any) error {
	if task == nil {
		return nil
	}
	attemptID := stringPtrValue(task.AttemptID)
	var (
		ok  bool
		err error
	)
	if attemptID == "" {
		ok, err = r.tasks.CompleteTask(ctx, task.ID, result)
	} else {
		ok, err = r.tasks.CompleteTaskAttempt(ctx, task.ID, attemptID, result)
	}
	if err != nil {
		return err
	}
	if !ok {
		return errTaskAttemptLost
	}
	task.Status = "done"
	task.Result = result
	if err := r.captureCorrectionFeedbackSample(ctx, task, result, ""); err != nil {
		r.log.Warn("capture correction feedback sample failed",
			zap.String("task_id", task.ID),
			zap.Error(err),
		)
	}
	return nil
}

func (r *Runner) failTask(ctx context.Context, task *domain.AnalysisTask, taskErr error) error {
	if task == nil {
		return nil
	}
	msg := sanitizeTaskErrorMessage(taskErr)
	if msg == "" {
		msg = fmt.Sprintf("%T", taskErr)
	}
	attemptID := stringPtrValue(task.AttemptID)
	var (
		ok  bool
		err error
	)
	if attemptID == "" {
		ok, err = r.tasks.FailTask(ctx, task.ID, msg)
	} else {
		ok, err = r.tasks.FailTaskAttempt(ctx, task.ID, attemptID, msg)
	}
	if err != nil {
		r.log.Error("fail task update failed",
			zap.String("task_id", task.ID),
			zap.Stringp("attempt_id", task.AttemptID),
			zap.Error(err),
		)
		return err
	}
	if !ok {
		r.log.Warn("fail task update skipped because attempt no longer owns task",
			zap.String("task_id", task.ID),
			zap.Stringp("attempt_id", task.AttemptID),
			zap.String("error", msg),
		)
		return errTaskAttemptLost
	}
	task.Status = "failed"
	task.ErrorMessage = &msg
	if err := r.captureCorrectionFeedbackSample(ctx, task, nil, msg); err != nil {
		r.log.Warn("capture failed correction feedback sample failed",
			zap.String("task_id", task.ID),
			zap.Error(err),
		)
	}
	if task.TaskType == "precision_item_estimate" && r.precision != nil {
		if estimate, err := r.precision.GetItemEstimateBySourceTask(ctx, task.ID); err == nil && estimate != nil {
			_ = r.precision.UpdateItemEstimate(ctx, estimate.ID, map[string]any{"status": "failed", "error_message": msg, "updated_at": time.Now()})
		}
	}
	r.refundTaskCredits(ctx, task)
	r.log.Error("task failed",
		zap.String("task_id", task.ID),
		zap.Stringp("attempt_id", task.AttemptID),
		zap.String("error", msg),
	)
	return nil
}

func (r *Runner) captureCorrectionFeedbackSample(ctx context.Context, task *domain.AnalysisTask, result map[string]any, errorMessage string) error {
	if r == nil || r.tasks == nil || task == nil || task.Payload == nil {
		return nil
	}
	if !boolFromAny(task.Payload["is_correction"]) {
		return nil
	}
	sourceTaskID := strings.TrimSpace(stringFromMap(task.Payload, "correction_source_task_id"))
	if sourceTaskID == "" {
		return nil
	}
	rootTaskID := strings.TrimSpace(stringFromMap(task.Payload, "correction_root_task_id"))
	if rootTaskID == "" {
		rootTaskID = sourceTaskID
	}
	modelName := firstNonEmptyString(result, "model_name")
	if modelName == "" {
		modelName = stringFromMap(task.Payload, "modelName")
	}
	analysisEngine := firstNonEmptyString(result, "analysis_engine")
	if analysisEngine == "" {
		analysisEngine = stringFromMap(task.Payload, "analysis_engine")
	}
	feedbackType := "correction"
	var errPtr *string
	if strings.TrimSpace(errorMessage) != "" {
		feedbackType = "failed"
		errPtr = stringPtr(errorMessage)
	}
	afterResult := result
	if afterResult == nil {
		afterResult = map[string]any{}
	}
	sample := &domain.AnalysisFeedbackSample{
		UserID:              task.UserID,
		FeedbackType:        feedbackType,
		SourceTaskID:        stringPtr(sourceTaskID),
		CorrectionTaskID:    stringPtr(task.ID),
		RootTaskID:          stringPtr(rootTaskID),
		TaskType:            task.TaskType,
		ModelName:           optionalStringPtr(modelName),
		AnalysisEngine:      optionalStringPtr(analysisEngine),
		BeforeResult:        mapFromAny(task.Payload["previousResult"]),
		UserCorrectionItems: extractItems(task.Payload["correctionItems"]),
		AfterResult:         afterResult,
		PayloadSnapshot:     task.Payload,
		ErrorMessage:        errPtr,
	}
	return r.tasks.UpsertFeedbackSample(ctx, sample)
}

func (r *Runner) refundTaskCredits(ctx context.Context, task *domain.AnalysisTask) {
	if r.credit == nil || task == nil || task.UserID == "" {
		return
	}
	usage := mapFromAny(task.Payload["credit_usage"])
	if len(usage) == 0 {
		return
	}
	groupID := creditGroupIDFromTask(task)
	if groupID == "" {
		return
	}
	cost := intFromAny(usage["cost"])
	if cost <= 0 {
		return
	}
	spendReason := "food_analysis_reward_spend"
	spendSourceKey := "food_analysis:" + groupID
	refundReason := "food_analysis_reward_refund"
	refundSourceKey := "food_analysis_refund:" + groupID
	if task.TaskType == "exercise" {
		spendReason = "exercise_reward_spend"
		spendSourceKey = "exercise:" + groupID
		refundReason = "exercise_reward_refund"
		refundSourceKey = "exercise_refund:" + groupID
	}
	creditsInfo := map[string]any{
		"credit_cost":       cost,
		"credit_spend_plan": usage,
	}
	if err := r.credit.RefundEarnedCreditsAfterTaskFailure(ctx, task.UserID, creditsInfo, cost, spendReason, spendSourceKey, refundReason, refundSourceKey, map[string]any{
		"credit_group_id": groupID,
		"task_id":         task.ID,
		"task_type":       task.TaskType,
	}); err != nil {
		r.log.Warn("refund earned credits after task failure failed", zap.String("task_id", task.ID), zap.String("credit_group_id", groupID), zap.Error(err))
	}
}

func creditGroupIDFromTask(task *domain.AnalysisTask) string {
	if task == nil {
		return ""
	}
	if usage := mapFromAny(task.Payload["credit_usage"]); len(usage) > 0 {
		if groupID := stringFromAny(usage["credit_group_id"]); groupID != "" {
			return groupID
		}
	}
	return stringFromAny(task.Payload["credit_group_id"])
}

func sanitizeTaskErrorMessage(taskErr error) string {
	if taskErr == nil {
		return ""
	}
	msg := strings.TrimSpace(taskErr.Error())
	if msg == "" {
		return ""
	}
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "<html") ||
		strings.Contains(lower, "<!doctype html") ||
		strings.Contains(lower, "<head") ||
		strings.Contains(lower, "<body") {
		return "AI 服务返回了网页而不是 JSON，请检查模型 API base URL 或网关配置"
	}
	if strings.Contains(lower, "context deadline exceeded") ||
		strings.Contains(lower, "client.timeout") ||
		strings.Contains(lower, "timeout exceeded while awaiting headers") ||
		strings.Contains(lower, "net/http: timeout") ||
		strings.Contains(lower, "i/o timeout") ||
		strings.Contains(lower, "tls handshake timeout") {
		return "AI 识别服务响应超时，请稍后重试；如果连续失败，可以换一张更清晰的照片再试"
	}
	if strings.Contains(lower, "resource exhausted") ||
		strings.Contains(lower, "ofoxai api error 429") ||
		strings.Contains(lower, "doubao api error 429") {
		return "AI 识别服务当前繁忙，请稍后重试"
	}
	if strings.Contains(lower, "incorrect api key") ||
		strings.Contains(lower, "apikey-error") ||
		strings.Contains(lower, "doubao api error 401") ||
		strings.Contains(lower, "ofoxai api error 401") {
		return "AI 识别服务配置异常，请联系管理员处理"
	}
	if strings.Contains(lower, "ofoxai api error 500") ||
		strings.Contains(lower, "ofoxai api error 502") ||
		strings.Contains(lower, "ofoxai api error 503") ||
		strings.Contains(lower, "ofoxai api error 504") ||
		strings.Contains(lower, "doubao api error 500") ||
		strings.Contains(lower, "doubao api error 502") ||
		strings.Contains(lower, "doubao api error 503") ||
		strings.Contains(lower, "doubao api error 504") ||
		strings.Contains(lower, "internalserviceerror") {
		return "AI 识别服务暂时不可用，请稍后重试"
	}
	runes := []rune(msg)
	if len(runes) > 300 {
		return strings.TrimSpace(string(runes[:300])) + "..."
	}
	return msg
}

func analyzeInputFromTask(task *domain.AnalysisTask) analyzeservice.AnalyzeInput {
	payload := task.Payload
	input := analyzeservice.AnalyzeInput{
		ImageURLs:         task.ImagePaths,
		Text:              "",
		AdditionalContext: stringFromMap(payload, "additionalContext"),
		MealType:          stringFromMap(payload, "meal_type"),
		Province:          stringFromMap(payload, "province"),
		City:              stringFromMap(payload, "city"),
		District:          stringFromMap(payload, "district"),
		UserGoal:          stringFromMap(payload, "user_goal"),
		DietGoal:          stringFromMap(payload, "diet_goal"),
		ActivityTiming:    stringFromMap(payload, "activity_timing"),
		ModelName:         stringFromMap(payload, "modelName"),
		AnalysisEngine:    stringFromMap(payload, "analysis_engine"),
		IsMultiView:       boolFromAny(payload["is_multi_view"]),
		PreviousResult:    mapFromAny(payload["previousResult"]),
		CorrectionItems:   extractItems(payload["correctionItems"]),
	}
	if task.ImageURL != nil {
		input.ImageURL = *task.ImageURL
	}
	if input.ImageURL == "" && len(task.ImagePaths) > 0 {
		input.ImageURL = task.ImagePaths[0]
	}
	if task.TextInput != nil {
		input.Text = *task.TextInput
	}
	if mode := stringFromMap(payload, "execution_mode"); mode != "" {
		input.ExecutionMode = &mode
	}
	if remaining, ok := floatFromAny(payload["remaining_calories"]); ok {
		input.RemainingCalories = &remaining
	}
	return input
}

func normalizeTaskTypes(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part == "" || seen[part] {
				continue
			}
			seen[part] = true
			out = append(out, part)
		}
	}
	return out
}

func analysisQueueTaskTypes(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range normalizeTaskTypes(values) {
		if value == "expiry_notification" || value == "food_expiry_notification_job" {
			continue
		}
		out = append(out, value)
	}
	return out
}

func handlesTaskType(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func sleepContext(ctx context.Context, d time.Duration) {
	if d <= 0 {
		return
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func stringPtr(value string) *string {
	return &value
}

func optionalStringPtr(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func taskImageCount(task *domain.AnalysisTask) int {
	if task == nil {
		return 0
	}
	seen := map[string]bool{}
	count := 0
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		count++
	}
	if task.ImageURL != nil {
		add(*task.ImageURL)
	}
	for _, value := range task.ImagePaths {
		add(value)
	}
	return count
}

func stringFromMap(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	value, ok := payload[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprintf("%v", value))
}

func intFromMap(payload map[string]any, key string) int {
	value, ok := floatFromAny(payload[key])
	if !ok {
		return 0
	}
	return int(value)
}

func intFromAny(value any) int {
	number, ok := floatFromAny(value)
	if !ok {
		return 0
	}
	return int(number)
}

func floatFromAny(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case int32:
		return float64(v), true
	case jsonNumber:
		f, err := v.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

type jsonNumber interface {
	Float64() (float64, error)
}

func violatesTextPolicy(text string) (bool, string) {
	lower := strings.ToLower(text)
	keywords := []string{"色情", "赌博", "毒品", "暴恐", "政治谣言", "法轮功", "fuck"}
	for _, keyword := range keywords {
		if strings.Contains(lower, strings.ToLower(keyword)) {
			return true, "文本包含不适合公开展示的内容"
		}
	}
	return false, ""
}
