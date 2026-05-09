package worker

import (
	"context"
	"fmt"
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
	userdomain "food_link/backend/internal/user/domain"
	userrepo "food_link/backend/internal/user/repo"
	userservice "food_link/backend/internal/user/service"
	"food_link/backend/pkg/storage"

	"go.uber.org/zap"
)

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
	log        *zap.Logger
	storage    *storage.Client
}

type Options struct {
	WorkerID      string
	TaskTypes     []string
	PollInterval  time.Duration
	MaxConcurrent int
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
		log:        log,
		storage:    client,
	}
}

func (r *Runner) Run(ctx context.Context, opts Options) error {
	taskTypes := normalizeTaskTypes(opts.TaskTypes)
	if len(taskTypes) == 0 {
		return fmt.Errorf("worker task types cannot be empty")
	}
	if opts.PollInterval <= 0 {
		opts.PollInterval = 2 * time.Second
	}
	if opts.MaxConcurrent <= 0 {
		opts.MaxConcurrent = 1
	}
	if opts.WorkerID == "" {
		opts.WorkerID = "worker-0"
	}

	r.log.Info("worker started",
		zap.String("worker_id", opts.WorkerID),
		zap.Strings("task_types", taskTypes),
		zap.Duration("poll_interval", opts.PollInterval),
		zap.Int("max_concurrent", opts.MaxConcurrent),
	)

	var wg sync.WaitGroup
	for i := 0; i < opts.MaxConcurrent; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			r.loop(ctx, fmt.Sprintf("%s-%d", opts.WorkerID, index), taskTypes, opts.PollInterval)
		}(i)
	}
	<-ctx.Done()
	wg.Wait()
	return ctx.Err()
}

func (r *Runner) loop(ctx context.Context, workerID string, taskTypes []string, pollInterval time.Duration) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	idleCount := 0
	for {
		select {
		case <-ctx.Done():
			r.log.Info("worker loop stopped", zap.String("worker_id", workerID))
			return
		default:
		}

		task, err := r.tasks.ClaimNextPendingTask(ctx, taskTypes)
		if err != nil {
			r.log.Error("claim task failed", zap.String("worker_id", workerID), zap.Error(err))
			<-ticker.C
			continue
		}
		if task == nil {
			if handlesTaskType(taskTypes, "expiry_notification") || handlesTaskType(taskTypes, "food_expiry_notification_job") {
				handled, err := r.processExpiryNotification(ctx, workerID)
				if err != nil {
					r.log.Error("process expiry notification failed", zap.String("worker_id", workerID), zap.Error(err))
					<-ticker.C
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
			<-ticker.C
			continue
		}
		idleCount = 0
		r.log.Info("task claimed", zap.String("worker_id", workerID), zap.String("task_id", task.ID), zap.String("task_type", task.TaskType))
		r.process(ctx, task)
	}
}

func (r *Runner) processExpiryNotification(ctx context.Context, workerID string) (bool, error) {
	if r.notifier == nil {
		return false, nil
	}
	jobCtx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	handled, err := r.notifier.ProcessNext(jobCtx)
	if handled {
		r.log.Info("expiry notification job processed", zap.String("worker_id", workerID))
	}
	return handled, err
}

func (r *Runner) process(ctx context.Context, task *domain.AnalysisTask) {
	taskCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

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
		r.failTask(taskCtx, task.ID, err)
		return
	}
	r.log.Info("task processed", zap.String("task_id", task.ID), zap.String("task_type", task.TaskType))
}

func (r *Runner) processFood(ctx context.Context, task *domain.AnalysisTask) error {
	r.normalizeTaskImages(task, "food-images")
	input := analyzeInputFromTask(task)
	if input.ImageURL == "" && len(input.ImageURLs) == 0 {
		return fmt.Errorf("food task missing image_url/image_paths")
	}
	result, err := r.analyze.Analyze(ctx, task.UserID, input)
	if err != nil {
		return err
	}
	_, err = r.tasks.CompleteTask(ctx, task.ID, result)
	return err
}

func (r *Runner) processFoodText(ctx context.Context, task *domain.AnalysisTask) error {
	input := analyzeInputFromTask(task)
	if strings.TrimSpace(input.Text) == "" {
		return fmt.Errorf("food_text task missing text_input")
	}
	result, err := r.analyze.AnalyzeText(ctx, task.UserID, input)
	if err != nil {
		return err
	}
	_, err = r.tasks.CompleteTask(ctx, task.ID, result)
	return err
}

func (r *Runner) processPrecisionPlan(ctx context.Context, task *domain.AnalysisTask) error {
	r.normalizeTaskImages(task, "food-images")
	input := analyzeInputFromTask(task)
	mode := "strict"
	input.ExecutionMode = &mode

	var result map[string]any
	var err error
	if strings.TrimSpace(input.Text) != "" && input.ImageURL == "" && len(input.ImageURLs) == 0 {
		result, err = r.analyze.AnalyzeText(ctx, task.UserID, input)
	} else {
		result, err = r.analyze.Analyze(ctx, task.UserID, input)
	}
	if err != nil {
		return err
	}

	sessionID := stringFromMap(task.Payload, "precision_session_id")
	if sessionID == "" {
		return fmt.Errorf("precision_plan task missing precision_session_id")
	}
	roundIndex := intFromMap(task.Payload, "round_index")
	if roundIndex <= 0 {
		roundIndex = 1
	}
	if err := r.precision.CreateRound(ctx, &domain.PrecisionSessionRound{
		SessionID:     sessionID,
		RoundIndex:    roundIndex,
		ActorRole:     "assistant",
		InputPayload:  map[string]any{},
		PlannerResult: result,
	}); err != nil {
		return err
	}

	plannedItems := buildPrecisionEstimateItems(result)
	groups := groupPrecisionItems(plannedItems)
	childTaskIDs := make([]string, 0, len(groups))
	sourceType := stringFromMap(task.Payload, "source_type")
	if sourceType == "" {
		sourceType = "image"
	}

	for groupIndex, groupItems := range groups {
		groupPayload := copyAnyMap(task.Payload)
		delete(groupPayload, "credit_usage")
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
	}

	aggregatePayload := map[string]any{
		"precision_session_id": sessionID,
		"round_index":          roundIndex,
		"split_strategy":       splitStrategyForGroups(groups),
		"child_task_ids":       childTaskIDs,
		"source_type":          sourceType,
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
		"split_plan":            map[string]any{"splitStrategy": splitStrategyForGroups(groups), "items": plannedItems},
		"latest_planner_result": result,
		"pending_requirements":  []any{},
		"current_task_id":       aggregateTask.ID,
		"last_error":            nil,
		"updated_at":            time.Now(),
	}); err != nil {
		return err
	}
	_, err = r.tasks.CompleteTask(ctx, task.ID, result)
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

	input := analyzeInputFromTask(task)
	mode := "strict"
	input.ExecutionMode = &mode
	input.AdditionalContext = buildPrecisionEstimateContext(task.Payload, input.AdditionalContext)

	var result map[string]any
	if strings.TrimSpace(input.Text) != "" && input.ImageURL == "" && len(input.ImageURLs) == 0 {
		result, err = r.analyze.AnalyzeText(ctx, task.UserID, input)
	} else {
		result, err = r.analyze.Analyze(ctx, task.UserID, input)
	}
	if err != nil {
		if estimate != nil {
			_ = r.precision.UpdateItemEstimate(ctx, estimate.ID, map[string]any{"status": "failed", "error_message": err.Error()})
		}
		return err
	}
	result = attachPlannedItemMetadata(result, task.Payload)
	if estimate != nil {
		if err := r.precision.UpdateItemEstimate(ctx, estimate.ID, map[string]any{"status": "done", "result": result, "error_message": nil}); err != nil {
			return err
		}
	}
	_, err = r.tasks.CompleteTask(ctx, task.ID, result)
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
	if err := r.precision.UpdateSession(ctx, sessionID, map[string]any{
		"status":          "done",
		"final_result":    finalResult,
		"current_task_id": task.ID,
		"last_error":      nil,
		"updated_at":      time.Now(),
	}); err != nil {
		return err
	}
	_, err = r.tasks.CompleteTask(ctx, task.ID, finalResult)
	return err
}

func buildPrecisionEstimateItems(plan map[string]any) []map[string]any {
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
			"requires_reference": boolFromAny(raw["requires_reference"]),
			"uncertainty_level":  level,
			"uncertainty_reason": firstNonEmptyString(raw, "uncertainty_reason"),
		})
	}
	if len(out) == 0 {
		out = append(out, map[string]any{
			"item_key":           "meal",
			"item_name":          "整餐",
			"item_hint":          "当前信息不足以稳定拆分时，按整体直接估计",
			"requires_reference": true,
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

func attachPlannedItemMetadata(result map[string]any, payload map[string]any) map[string]any {
	items := extractItems(result["items"])
	planned := extractItems(payload["items_to_estimate"])
	if len(items) == 0 || len(planned) == 0 {
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
	items := []map[string]any{}
	uncertaintyNotes := []string{}
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
	insight := fmt.Sprintf("已完成精准模式估计。数据库命中 %d/%d 项。", intFromMap(lookup, "library_hits"), intFromMap(lookup, "total"))
	if intFromMap(lookup, "unresolved") > 0 {
		insight += fmt.Sprintf("仍有 %d 项未命中标准库。", intFromMap(lookup, "unresolved"))
	}
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
		_, err := r.tasks.CompleteTask(ctx, task.ID, map[string]any{"status": "rejected", "reason": reason})
		return err
	}
	if err := r.publicFood.UpdateStatus(ctx, itemID, "published"); err != nil {
		return err
	}
	_, err := r.tasks.CompleteTask(ctx, task.ID, map[string]any{"status": "approved"})
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
	_, err = r.tasks.CompleteTask(ctx, task.ID, result)
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
	_, err = r.tasks.CompleteTask(ctx, task.ID, map[string]any{"extracted_content": merged})
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
	_, err = r.tasks.CompleteTask(ctx, task.ID, result)
	return err
}

func (r *Runner) failTask(ctx context.Context, taskID string, taskErr error) {
	msg := sanitizeTaskErrorMessage(taskErr)
	if msg == "" {
		msg = fmt.Sprintf("%T", taskErr)
	}
	_, err := r.tasks.FailTask(ctx, taskID, msg)
	if err != nil {
		r.log.Error("fail task update failed", zap.String("task_id", taskID), zap.Error(err))
		return
	}
	r.log.Error("task failed", zap.String("task_id", taskID), zap.String("error", msg))
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

func handlesTaskType(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
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
