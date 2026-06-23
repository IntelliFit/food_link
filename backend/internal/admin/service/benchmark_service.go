package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"food_link/backend/pkg/logger"

	"food_link/backend/internal/admin/domain"
	admindomain "food_link/backend/internal/admin/domain"
	"food_link/backend/internal/admin/repo"
	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"
	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/migration/do"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"log/slog"
)

const (
	maxBenchmarkConcurrency = 3
	pollInterval            = 2 * time.Second
	maxPollDuration         = 5 * time.Minute
)

type BenchmarkTaskService interface {
	SubmitInternalAnalyzeTask(ctx context.Context, userID string, input analyzeservice.SubmitTaskInput) (string, error)
	GetTask(ctx context.Context, taskID, userID string) (*analyzedomain.AnalysisTask, error)
}

type AdminAccountReader interface {
	FindByID(ctx context.Context, id string) (*admindomain.AdminAccount, error)
}

type BenchmarkUserResolver interface {
	FindByOpenID(ctx context.Context, openID string) (*authrepo.User, error)
	Create(ctx context.Context, user *authrepo.User) error
}

// NameMatchingLLM 仅用于 benchmark 内部的 AI 名称对应步骤，不影响真实识别算法。
type NameMatchingLLM interface {
	AnalyzeWithImages(ctx context.Context, prompt string, imageURLs []string) (map[string]any, error)
}

type BenchmarkService struct {
	repo        *repo.BenchmarkRepo
	taskSvc     BenchmarkTaskService
	adminReader AdminAccountReader
	userReader  BenchmarkUserResolver
	nameMatcher NameMatchingLLM
}

func NewBenchmarkService(repo *repo.BenchmarkRepo, taskSvc BenchmarkTaskService, adminReader AdminAccountReader, userReader BenchmarkUserResolver, nameMatcher NameMatchingLLM) *BenchmarkService {
	return &BenchmarkService{repo: repo, taskSvc: taskSvc, adminReader: adminReader, userReader: userReader, nameMatcher: nameMatcher}
}

// Dataset samples

func (s *BenchmarkService) ListBatches(ctx context.Context) ([]string, error) {
	return s.repo.ListBatches(ctx)
}

func (s *BenchmarkService) ListSamples(ctx context.Context, input domain.ListSamplesInput) (*domain.ListSamplesResult, error) {
	return s.repo.ListSamples(ctx, input)
}

func (s *BenchmarkService) GetSample(ctx context.Context, id string) (*domain.DatasetSample, error) {
	return s.repo.GetSample(ctx, id)
}

func (s *BenchmarkService) CreateSample(ctx context.Context, input domain.CreateSampleInput) (*domain.DatasetSample, error) {
	if strings.TrimSpace(input.BatchName) == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "batch_name 不能为空", HTTPStatus: 400}
	}
	if strings.TrimSpace(input.SampleName) == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "sample_name 不能为空", HTTPStatus: 400}
	}
	if strings.TrimSpace(input.OriginalFilename) == "" {
		input.OriginalFilename = input.SampleName
	}
	if input.LabelType == "" {
		input.LabelType = "unlabeled"
	}
	if input.Status == "" {
		input.Status = "unlabeled"
		if input.LabelType != "unlabeled" {
			input.Status = "labeled"
		}
	}
	sample := &do.FoodWeightLabeledSampleDO{
		ID:               uuid.New().String(),
		BatchName:        strings.TrimSpace(input.BatchName),
		SampleName:       strings.TrimSpace(input.SampleName),
		OriginalFilename: strings.TrimSpace(input.OriginalFilename),
		ImageURL:         ptrString(input.ImageURL),
		LabelType:        input.LabelType,
		Items:            input.Items,
		Status:           input.Status,
		Metadata:         input.Metadata,
	}
	if input.TotalWeightGrams != nil {
		w := *input.TotalWeightGrams
		sample.TotalWeightGrams = &w
	}
	normalizeSampleItems(sample)
	now := time.Now()
	sample.CreatedAt = &now
	sample.UpdatedAt = &now
	if err := s.repo.CreateSample(ctx, sample); err != nil {
		return nil, err
	}
	return sample, nil
}

func (s *BenchmarkService) UpdateSample(ctx context.Context, id string, input domain.UpdateSampleInput) (*domain.DatasetSample, error) {
	if input.Items == nil {
		input.Items = map[string]any{}
	}
	if input.LabelType != nil && *input.LabelType == "total" && input.TotalWeightGrams != nil {
		input.Items["__total__"] = *input.TotalWeightGrams
	}
	return s.repo.UpdateSample(ctx, id, input)
}

func (s *BenchmarkService) DeleteSample(ctx context.Context, id string) error {
	return s.repo.DeleteSample(ctx, id)
}

// Benchmark runs

func (s *BenchmarkService) CreateRun(ctx context.Context, adminID string, input domain.CreateRunInput) (*domain.BenchmarkRun, error) {
	if strings.TrimSpace(input.Name) == "" {
		input.Name = fmt.Sprintf("benchmark-%s", time.Now().Format("20060102-150405"))
	}
	mode := strings.TrimSpace(input.ExecutionMode)
	if mode == "" {
		mode = "standard"
	}
	if !isValidExecutionMode(mode) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "execution_mode 无效", HTTPStatus: 400}
	}

	samples, err := s.repo.FindSamplesByFilter(ctx, input.DatasetFilter)
	if err != nil {
		return nil, err
	}
	if len(samples) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "未找到符合条件的数据集样本", HTTPStatus: 400}
	}

	createdByUsername := ""
	if s.adminReader != nil && adminID != "" {
		account, err := s.adminReader.FindByID(ctx, adminID)
		if err != nil {
			return nil, err
		}
		if account != nil {
			createdByUsername = account.Username
		}
	}

	run := &do.BenchmarkRunDO{
		ID:                         uuid.New().String(),
		Name:                       input.Name,
		Status:                     domain.BenchmarkRunStatusPending,
		DatasetFilter:              input.DatasetFilter.ToMap(),
		ExecutionMode:              mode,
		ModelConfig:                input.ModelConfig.ToMap(),
		SampleCount:                len(samples),
		Metrics:                    map[string]any{},
		EvaluationAlgorithmVersion: domain.BenchmarkEvaluationAlgorithmVersion,
		CreatedBy:                  ptrString(adminID),
		CreatedByUsername:          ptrString(createdByUsername),
	}
	now := time.Now()
	run.CreatedAt = &now
	run.UpdatedAt = &now
	if err := s.repo.CreateRun(ctx, run); err != nil {
		return nil, err
	}

	for _, sample := range samples {
		brs := &do.BenchmarkRunSampleDO{
			ID:           uuid.New().String(),
			RunID:        run.ID,
			SampleID:     sample.ID,
			Status:       domain.BenchmarkSampleStatusPending,
			GroundTruth:  sampleToGroundTruth(&sample),
			Prediction:   map[string]any{},
			StageOutputs: map[string]any{},
			Metrics:      map[string]any{},
		}
		brs.CreatedAt = &now
		brs.UpdatedAt = &now
		if err := s.repo.CreateRunSample(ctx, brs); err != nil {
			return nil, err
		}
	}

	benchmarkUserID, err := s.resolveBenchmarkUserID(ctx, adminID)
	if err != nil {
		return nil, err
	}

	go s.executeRun(context.Background(), run.ID, benchmarkUserID, mode, input.TextInput, input.ModelConfig)

	return run, nil
}

var benchmarkOpenIDNamespace = uuid.MustParse("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

func (s *BenchmarkService) resolveBenchmarkUserID(ctx context.Context, adminID string) (string, error) {
	if s.userReader == nil {
		return "", &commonerrors.AppError{Code: 10002, Message: "benchmark 用户解析器未配置", HTTPStatus: 500}
	}

	openID := uuid.NewSHA1(benchmarkOpenIDNamespace, []byte("food_link_benchmark:"+strings.TrimSpace(adminID))).String()
	if user, err := s.userReader.FindByOpenID(ctx, openID); err != nil {
		return "", err
	} else if user != nil {
		return user.ID, nil
	}

	now := time.Now()
	newUser := &authrepo.User{
		ID:       uuid.New().String(),
		OpenID:   openID,
		Nickname: "benchmark",
		Avatar:   "",
	}
	newUser.CreatedAt = &now
	if err := s.userReader.Create(ctx, newUser); err != nil {
		return "", err
	}
	return newUser.ID, nil
}

func (s *BenchmarkService) ListRuns(ctx context.Context, page, limit int) (*domain.ListRunsResult, error) {
	return s.repo.ListRuns(ctx, page, limit)
}

func (s *BenchmarkService) GetRun(ctx context.Context, id string) (*domain.BenchmarkRun, error) {
	return s.repo.GetRun(ctx, id)
}

func (s *BenchmarkService) DeleteRun(ctx context.Context, id string) error {
	return s.repo.DeleteRun(ctx, id)
}

func (s *BenchmarkService) CancelRun(ctx context.Context, id string) (*domain.BenchmarkRun, error) {
	run, err := s.repo.GetRun(ctx, id)
	if err != nil {
		return nil, err
	}
	if run.Status != domain.BenchmarkRunStatusPending && run.Status != domain.BenchmarkRunStatusRunning {
		return nil, &commonerrors.AppError{Code: 10002, Message: "当前状态不可取消", HTTPStatus: 400}
	}
	if err := s.repo.UpdateRun(ctx, id, map[string]any{"status": domain.BenchmarkRunStatusCancelled}); err != nil {
		return nil, err
	}
	return s.repo.GetRun(ctx, id)
}

func (s *BenchmarkService) ListRunSamples(ctx context.Context, runID string, page, limit int) (*domain.ListRunSamplesResult, error) {
	return s.repo.ListRunSamples(ctx, runID, page, limit)
}

func (s *BenchmarkService) ListRunSamplesWithDataset(ctx context.Context, runID string, page, limit int) (*domain.ListRunSamplesWithDatasetResult, error) {
	res, err := s.repo.ListRunSamples(ctx, runID, page, limit)
	if err != nil {
		return nil, err
	}

	ids := make([]string, 0, len(res.Items))
	for _, item := range res.Items {
		ids = append(ids, item.SampleID)
	}

	dsMap := make(map[string]*do.FoodWeightLabeledSampleDO)
	if len(ids) > 0 {
		dsItems, err := s.repo.FindSamplesByFilter(ctx, domain.DatasetFilter{SampleIDs: ids})
		if err != nil {
			return nil, err
		}
		for i := range dsItems {
			dsMap[dsItems[i].ID] = &dsItems[i]
		}
	}

	out := make([]domain.BenchmarkRunSampleWithDataset, len(res.Items))
	for i, item := range res.Items {
		out[i].BenchmarkRunSample = item
		if ds, ok := dsMap[item.SampleID]; ok {
			copy := *ds
			out[i].DatasetSample = (*domain.DatasetSample)(&copy)
		}
	}

	return &domain.ListRunSamplesWithDatasetResult{
		Items: out,
		Total: res.Total,
		Page:  res.Page,
		Limit: res.Limit,
	}, nil
}

// Execution

func (s *BenchmarkService) executeRun(ctx context.Context, runID, userID, mode, textInput string, modelConfig domain.ModelConfig) {
	if err := s.repo.UpdateRun(ctx, runID, map[string]any{
		"status":     domain.BenchmarkRunStatusRunning,
		"started_at": time.Now(),
	}); err != nil {
		_ = s.failRun(ctx, runID, fmt.Sprintf("启动运行失败: %v", err))
		return
	}

	samples, err := s.listRunSamplesByRun(ctx, runID)
	if err != nil {
		_ = s.failRun(ctx, runID, fmt.Sprintf("加载运行样本失败: %v", err))
		return
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, maxBenchmarkConcurrency)
	var hasFailure bool
	var mu sync.Mutex

	for i := range samples {
		wg.Add(1)
		sem <- struct{}{}
		go func(sample *do.BenchmarkRunSampleDO) {
			defer wg.Done()
			defer func() { <-sem }()
			if err := s.executeSample(ctx, runID, userID, mode, textInput, modelConfig, sample); err != nil {
				mu.Lock()
				hasFailure = true
				mu.Unlock()
			}
		}(&samples[i])
	}
	wg.Wait()

	run, err := s.repo.GetRun(ctx, runID)
	if err != nil {
		_ = s.failRun(ctx, runID, fmt.Sprintf("读取运行状态失败: %v", err))
		return
	}
	if run.Status == domain.BenchmarkRunStatusCancelled {
		return
	}

	metrics, err := s.computeRunMetrics(ctx, runID)
	if err != nil {
		_ = s.failRun(ctx, runID, fmt.Sprintf("计算指标失败: %v", err))
		return
	}

	status := domain.BenchmarkRunStatusDone
	if hasFailure {
		status = domain.BenchmarkRunStatusDone
	}
	updates := map[string]any{
		"status":       status,
		"metrics":      datatypes.JSONMap(metrics.ToMap()),
		"completed_at": time.Now(),
	}
	if err := s.repo.UpdateRun(ctx, runID, updates); err != nil {
		_ = s.failRun(ctx, runID, fmt.Sprintf("保存运行结果失败: %v", err))
	}
}

func (s *BenchmarkService) executeSample(ctx context.Context, runID, userID, mode, textInput string, modelConfig domain.ModelConfig, sample *do.BenchmarkRunSampleDO) error {
	ds, err := s.repo.GetSample(ctx, sample.SampleID)
	if err != nil {
		_ = s.updateSampleStatus(ctx, sample.ID, domain.BenchmarkSampleStatusFailed, fmt.Sprintf("读取样本失败: %v", err), nil)
		return err
	}

	if err := s.updateSampleStatus(ctx, sample.ID, domain.BenchmarkSampleStatusProcessing, "", nil); err != nil {
		return err
	}

	imageURLs := []string{}
	if ds.ImageURL != nil && strings.TrimSpace(*ds.ImageURL) != "" {
		imageURLs = append(imageURLs, strings.TrimSpace(*ds.ImageURL))
	}
	if len(imageURLs) == 0 {
		_ = s.updateSampleStatus(ctx, sample.ID, domain.BenchmarkSampleStatusFailed, "样本没有图片 URL", nil)
		return fmt.Errorf("样本 %s 没有图片", ds.SampleName)
	}

	input := analyzeservice.SubmitTaskInput{
		ImageURLs:           imageURLs,
		TextInput:           textInput,
		ExecutionMode:       &mode,
		AnalysisEngine:      "db_first",
		SuggestRatioEnabled: true,
		MealType:            "lunch",
		ModelName:           modelConfig.Vision,
	}
	if input.ModelName == "" {
		input.ModelName = modeToDefaultModel(mode)
	}

	startedAt := time.Now()
	taskID, err := s.taskSvc.SubmitInternalAnalyzeTask(ctx, userID, input)
	if err != nil {
		_ = s.updateSampleStatus(ctx, sample.ID, domain.BenchmarkSampleStatusFailed, fmt.Sprintf("提交任务失败: %v", err), nil)
		logger.Error(ctx, "benchmark 样本提交分析任务失败", err,
			slog.String("run_id", sample.RunID),
			slog.String("sample_id", sample.SampleID),
			slog.String("user_id", userID),
		)
		return err
	}

	if err := s.repo.UpdateRunSample(ctx, sample.ID, map[string]any{"task_id": taskID, "started_at": startedAt}); err != nil {
		return err
	}

	task, err := s.pollTask(ctx, userID, taskID)
	if err != nil {
		_ = s.updateSampleStatus(ctx, sample.ID, domain.BenchmarkSampleStatusFailed, fmt.Sprintf("轮询任务失败: %v", err), nil)
		return err
	}

	prediction, stageOutputs := parseTaskResult(task.Result)

	// AI 名称对应步骤：仅用于 benchmark 评测，不影响真实识别算法。
	// 其结果会作为 comparePredictionWithGroundTruth 的输入，用于生成分项对比和重量误差。
	aiMatch, aiStage := s.aiMatchNames(ctx, prediction, sample.GroundTruth, imageURLs)
	if aiStage != nil {
		stageOutputs["ai_name_matching"] = aiStage
	}

	metrics := comparePredictionWithGroundTruth(prediction, sample.GroundTruth, aiMatch)
	metrics.DurationMs = float64(time.Since(startedAt).Milliseconds())

	updates := map[string]any{
		"status":        domain.BenchmarkSampleStatusDone,
		"prediction":    datatypes.JSONMap(prediction),
		"stage_outputs": datatypes.JSONMap(stageOutputs),
		"metrics":       datatypes.JSONMap(metrics.ToMap()),
		"completed_at":  time.Now(),
	}
	if task.ErrorMessage != nil && *task.ErrorMessage != "" {
		updates["error_message"] = *task.ErrorMessage
	}
	if err := s.repo.UpdateRunSample(ctx, sample.ID, updates); err != nil {
		return err
	}
	return nil
}

// aiMatchNames 让 AI 判断预测食物名称与标注食物名称的对应关系。
// 该步骤仅在 benchmark 评测中使用，不影响真实识别算法。
// 返回的映射会被 comparePredictionWithGroundTruth 用来计算标准分项对比与重量误差。
func (s *BenchmarkService) aiMatchNames(ctx context.Context, prediction, groundTruth map[string]any, imageURLs []string) (*aiMatchResult, map[string]any) {
	labelType, _ := groundTruth["label_type"].(string)
	if labelType != "items" {
		return nil, nil
	}

	predItems := extractItems(prediction)
	gtItems := extractGroundTruthItems(groundTruth)
	if len(predItems) == 0 || len(gtItems) == 0 {
		return nil, nil
	}

	if s.nameMatcher == nil {
		return fallbackNameMatch(predItems, gtItems, "name matcher 未配置"), nil
	}

	prompt := buildNameMatchingPrompt(predItems, gtItems)
	raw, err := s.nameMatcher.AnalyzeWithImages(ctx, prompt, imageURLs)
	if err != nil {
		logger.Warn(ctx, "benchmark AI 名称匹配调用失败，降级到字符串匹配", slog.String("error", err.Error()))
		return fallbackNameMatch(predItems, gtItems, err.Error()), map[string]any{"fallback": true, "error": err.Error()}
	}

	aiMatch, stage := parseAIMatchResult(raw, predItems, gtItems)
	if aiMatch == nil {
		return fallbackNameMatch(predItems, gtItems, "AI 返回结果解析失败"), map[string]any{"fallback": true, "raw": raw}
	}
	return aiMatch, stage
}

// aiMatchResult 保存 AI（或降级）给出的预测项与标注项对应关系。
type aiMatchResult struct {
	PredToGT      map[int]int
	GTToPred      map[int]int
	UnmatchedPred []int
	UnmatchedGT   []int
	Fallback      bool
	Error         string
}

func buildNameMatchingPrompt(predItems, gtItems []item) string {
	type namedItem struct {
		Name   string  `json:"name"`
		Weight float64 `json:"weight_grams"`
	}
	predList := make([]namedItem, len(predItems))
	for i, it := range predItems {
		predList[i] = namedItem{Name: it.Name, Weight: it.Weight}
	}
	gtList := make([]namedItem, len(gtItems))
	for i, it := range gtItems {
		gtList[i] = namedItem{Name: it.Name, Weight: it.Weight}
	}
	predJSON, _ := json.Marshal(predList)
	gtJSON, _ := json.Marshal(gtList)

	return fmt.Sprintf(`你正在评测食物图像识别结果，原图已一并提供，你可以结合图像内容判断。

图片中的真实食物列表（标注）如下：
%s

AI 预测出的食物列表如下：
%s

规则：
1. 标注没有位置信息，请你根据食物名称的语义判断每个预测项对应的是哪个标注项。
2. 一个预测项最多对应一个标注项，一个标注项也最多对应一个预测项。
3. 中文食物名称中，同一食材的不同精度、形态或常见别称通常应视为同一食物，例如：
   - "熟米"、"白米饭"、"米饭" 视为同一食物
   - "生鸡胸肉"、"鸡胸肉"、"鸡肉" 视为同一食物
   - "番茄"、"西红柿" 视为同一食物
4. 当名称相似且重量也接近时，应优先视为同一项。
5. 如果某个预测项确实无法对应到任何标注项，则视为识别错误（多检）。

请只返回 JSON，不要附加说明：
{
  "matches": [
    {"pred_index": 0, "pred_name": "...", "gt_index": 1, "gt_name": "...", "matched": true, "reason": "..."}
  ],
  "unmatched_pred_indices": [2],
  "unmatched_gt_indices": [0]
}`, string(gtJSON), string(predJSON))
}

func parseAIMatchResult(raw map[string]any, predItems, gtItems []item) (*aiMatchResult, map[string]any) {
	matchesAny, ok := raw["matches"].([]any)
	if !ok {
		return nil, nil
	}

	predToGT := make(map[int]int)
	gtToPred := make(map[int]int)
	predMatched := make([]bool, len(predItems))
	gtMatched := make([]bool, len(gtItems))

	for _, mAny := range matchesAny {
		m, ok := mAny.(map[string]any)
		if !ok {
			continue
		}
		predIdx := anyToInt(m["pred_index"])
		gtIdx := anyToInt(m["gt_index"])
		matched := false
		if v, ok := m["matched"].(bool); ok {
			matched = v
		}
		if predIdx < 0 || predIdx >= len(predItems) || gtIdx < 0 || gtIdx >= len(gtItems) {
			continue
		}
		if matched {
			predToGT[predIdx] = gtIdx
			gtToPred[gtIdx] = predIdx
			predMatched[predIdx] = true
			gtMatched[gtIdx] = true
		}
	}

	var unmatchedPred, unmatchedGT []int
	for i, matched := range predMatched {
		if !matched {
			unmatchedPred = append(unmatchedPred, i)
		}
	}
	for i, matched := range gtMatched {
		if !matched {
			unmatchedGT = append(unmatchedGT, i)
		}
	}

	stage := map[string]any{
		"matches":                raw["matches"],
		"unmatched_pred_indices": unmatchedPred,
		"unmatched_gt_indices":   unmatchedGT,
	}
	return &aiMatchResult{
		PredToGT:      predToGT,
		GTToPred:      gtToPred,
		UnmatchedPred: unmatchedPred,
		UnmatchedGT:   unmatchedGT,
	}, stage
}

func fallbackNameMatch(predItems, gtItems []item, reason string) *aiMatchResult {
	predToGT := make(map[int]int)
	gtToPred := make(map[int]int)

	usedPred := make([]bool, len(predItems))
	for gi, gt := range gtItems {
		bestIdx, bestScore := -1, 0.0
		for pi, p := range predItems {
			if usedPred[pi] {
				continue
			}
			score := nameSimilarity(gt.Name, p.Name)
			if score >= 0.6 && (bestIdx == -1 || score > bestScore) {
				bestIdx = pi
				bestScore = score
			}
		}
		if bestIdx >= 0 && bestScore >= 0.8 {
			usedPred[bestIdx] = true
			predToGT[bestIdx] = gi
			gtToPred[gi] = bestIdx
		}
	}

	var unmatchedPred, unmatchedGT []int
	for i, used := range usedPred {
		if !used {
			unmatchedPred = append(unmatchedPred, i)
		}
	}
	for gi := range gtItems {
		if _, ok := gtToPred[gi]; !ok {
			unmatchedGT = append(unmatchedGT, gi)
		}
	}

	return &aiMatchResult{
		PredToGT:      predToGT,
		GTToPred:      gtToPred,
		UnmatchedPred: unmatchedPred,
		UnmatchedGT:   unmatchedGT,
		Fallback:      true,
		Error:         reason,
	}
}

func anyToInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case float32:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	case int32:
		return int(n)
	}
	return 0
}

func (s *BenchmarkService) pollTask(ctx context.Context, userID, taskID string) (*analyzedomain.AnalysisTask, error) {
	deadline := time.Now().Add(maxPollDuration)
	for time.Now().Before(deadline) {
		task, err := s.taskSvc.GetTask(ctx, taskID, userID)
		if err != nil {
			return nil, err
		}
		switch task.Status {
		case "done", "failed", "timed_out", "cancelled", "violated":
			return task, nil
		}
		time.Sleep(pollInterval)
	}
	return nil, fmt.Errorf("轮询任务超时")
}

func (s *BenchmarkService) updateSampleStatus(ctx context.Context, id, status, errMsg string, completedAt *time.Time) error {
	updates := map[string]any{"status": status}
	if errMsg != "" {
		updates["error_message"] = errMsg
	}
	if completedAt != nil {
		updates["completed_at"] = *completedAt
	}
	return s.repo.UpdateRunSample(ctx, id, updates)
}

func (s *BenchmarkService) failRun(ctx context.Context, runID, message string) error {
	return s.repo.UpdateRun(ctx, runID, map[string]any{
		"status":        domain.BenchmarkRunStatusFailed,
		"error_message": message,
		"completed_at":  time.Now(),
	})
}

func (s *BenchmarkService) listRunSamplesByRun(ctx context.Context, runID string) ([]do.BenchmarkRunSampleDO, error) {
	res, err := s.repo.ListRunSamples(ctx, runID, 1, 10000)
	if err != nil {
		return nil, err
	}
	return res.Items, nil
}

func (s *BenchmarkService) computeRunMetrics(ctx context.Context, runID string) (*domain.RunMetrics, error) {
	res, err := s.repo.ListRunSamples(ctx, runID, 1, 10000)
	if err != nil {
		return nil, err
	}

	m := &domain.RunMetrics{SampleCount: len(res.Items)}
	var totalErrors, totalErrorPcts []float64
	var itemErrors, itemErrorPcts []float64
	var nameMatchRates []float64
	var durations []float64

	for _, sample := range res.Items {
		switch sample.Status {
		case domain.BenchmarkSampleStatusDone:
			m.CompletedCount++
		case domain.BenchmarkSampleStatusFailed:
			m.FailedCount++
		}
		metrics := toSampleMetrics(sample.Metrics)
		if rate := sampleNameMatchRate(metrics); rate >= 0 {
			nameMatchRates = append(nameMatchRates, rate)
		}
		if metrics.TotalWeightErrorPct > 0 || metrics.TotalWeightError != 0 {
			totalErrors = append(totalErrors, metrics.TotalWeightError)
			totalErrorPcts = append(totalErrorPcts, metrics.TotalWeightErrorPct)
		}
		itemErrors = append(itemErrors, metrics.ItemWeightErrors...)
		itemErrorPcts = append(itemErrorPcts, metrics.ItemWeightErrorPcts...)
		if metrics.DurationMs > 0 {
			durations = append(durations, metrics.DurationMs)
		}
	}

	if len(nameMatchRates) > 0 {
		m.NameMatchRate = avg(nameMatchRates)
	}
	m.TotalWeightMAPE = mape(totalErrorPcts)
	m.TotalWeightRMSE = rmse(totalErrors)
	m.ItemWeightMAPE = mape(itemErrorPcts)
	m.ItemWeightRMSE = rmse(itemErrors)
	m.AverageDurationMs = avg(durations)
	return m, nil
}

// Helpers

func isValidExecutionMode(mode string) bool {
	switch mode {
	case "fast", "standard", "strict", "fast_web_search", "standard_web_search", "strict_web_search", "gemini35_flash_grouped":
		return true
	}
	return false
}

func modeToDefaultModel(mode string) string {
	switch mode {
	case "fast", "fast_web_search":
		return "qwen3.6-flash"
	case "standard", "standard_web_search":
		return "gemini-3-flash-preview"
	case "strict", "strict_web_search", "gemini35_flash_grouped":
		return "gemini-3.5-flash"
	}
	return "gemini-3-flash-preview"
}

func normalizeSampleItems(sample *do.FoodWeightLabeledSampleDO) {
	if sample.Items == nil {
		sample.Items = map[string]any{}
	}
	if sample.LabelType == "total" && sample.TotalWeightGrams != nil {
		sample.Items["__total__"] = *sample.TotalWeightGrams
	}
	if sample.LabelType == "unlabeled" {
		sample.Items = map[string]any{}
	}
}

func sampleToGroundTruth(sample *do.FoodWeightLabeledSampleDO) map[string]any {
	gt := map[string]any{
		"label_type":  sample.LabelType,
		"batch_name":  sample.BatchName,
		"sample_name": sample.SampleName,
	}
	if sample.TotalWeightGrams != nil {
		gt["total_weight_grams"] = *sample.TotalWeightGrams
	}
	if len(sample.Items) > 0 {
		gt["items"] = sample.Items
	}
	return gt
}

func parseTaskResult(result map[string]any) (prediction map[string]any, stageOutputs map[string]any) {
	prediction = map[string]any{}
	stageOutputs = map[string]any{}
	if result == nil {
		return
	}

	items, _ := result["items"].([]any)
	prediction["items"] = items
	for _, key := range []string{"description", "insight", "pfc_ratio_comment", "eating_order_advice", "absorption_notes", "context_advice", "analysis_engine", "food_image_strategy", "recognitionOutcome", "rejectionReason", "retakeGuidance", "allowedFoodCategory", "followupQuestions"} {
		if v, ok := result[key]; ok {
			prediction[key] = v
		}
	}
	for _, key := range []string{"analysis_duration_ms", "resolved_count", "unresolved_count", "total_weight_grams", "edible_portion_applied_count", "suggest_ratio_applied_count"} {
		prediction[key] = anyToFloat64(result[key])
	}

	stageOutputs["final"] = map[string]any{
		"item_count":  len(items),
		"description": result["description"],
		"strategy":    result["food_image_strategy"],
	}
	if hr, ok := result["hybrid_review"].(map[string]any); ok {
		stageOutputs["review"] = hr
	}
	if eps, ok := result["edible_portion_status"].(string); ok {
		stageOutputs["edible"] = map[string]any{"status": eps, "applied_count": result["edible_portion_applied_count"]}
	}
	if ae, ok := result["analysis_engine"].(string); ok {
		stageOutputs["nutrition"] = map[string]any{"engine": ae, "resolved_count": result["resolved_count"], "unresolved_count": result["unresolved_count"]}
	}
	if srs, ok := result["suggest_ratio_status"].(string); ok {
		stageOutputs["suggest_ratio"] = map[string]any{"status": srs, "applied_count": result["suggest_ratio_applied_count"]}
	}
	stageOutputs["vision"] = map[string]any{"status": "completed", "note": "vision raw output is internal to analyze pipeline"}
	return
}

func comparePredictionWithGroundTruth(prediction, groundTruth map[string]any, aiMatch ...*aiMatchResult) *domain.SampleMetrics {
	m := &domain.SampleMetrics{}
	labelType, _ := groundTruth["label_type"].(string)

	predItems := extractItems(prediction)
	gtItems := extractGroundTruthItems(groundTruth)

	var match *aiMatchResult
	if len(aiMatch) > 0 {
		match = aiMatch[0]
	}

	// items 类型且有 AI/降级映射时，直接用映射计算名称匹配和重量误差。
	if labelType == "items" && match != nil && len(gtItems) > 0 {
		details := make([]bool, len(gtItems))
		matched := 0
		var totalGtWeight, totalPredWeight float64
		for gi, gt := range gtItems {
			totalGtWeight += gt.Weight
			if pi, ok := match.GTToPred[gi]; ok && pi >= 0 && pi < len(predItems) {
				p := predItems[pi]
				details[gi] = true
				matched++
				err := p.Weight - gt.Weight
				m.ItemWeightErrors = append(m.ItemWeightErrors, err)
				totalPredWeight += p.Weight
				if gt.Weight > 0 {
					m.ItemWeightErrorPcts = append(m.ItemWeightErrorPcts, math.Abs(err)/gt.Weight*100)
				}
			} else {
				m.ItemWeightErrors = append(m.ItemWeightErrors, -gt.Weight)
				if gt.Weight > 0 {
					m.ItemWeightErrorPcts = append(m.ItemWeightErrorPcts, 100)
				}
			}
		}
		m.NameMatchDetails = details
		m.NameMatched = matched == len(gtItems)
		m.TotalWeightError = totalPredWeight - totalGtWeight
		if totalGtWeight > 0 {
			m.TotalWeightErrorPct = math.Abs(m.TotalWeightError) / totalGtWeight * 100
		}
		m.ItemComparisons = buildItemComparisonsWithAIMatch(gtItems, predItems, match)
		return m
	}

	if len(gtItems) > 0 {
		details := make([]bool, len(gtItems))
		matched := 0
		for i, gt := range gtItems {
			best := 0.0
			for _, p := range predItems {
				score := nameSimilarity(gt.Name, p.Name)
				if score > best {
					best = score
				}
			}
			if best >= 0.8 {
				details[i] = true
				matched++
			}
		}
		m.NameMatchDetails = details
		m.NameMatched = matched == len(gtItems)
	} else if labelType == "total" {
		m.NameMatched = true
	}

	if labelType == "total" {
		gtWeight := anyToFloat64(groundTruth["total_weight_grams"])
		if gtWeight == 0 {
			if items, ok := groundTruth["items"].(map[string]any); ok {
				gtWeight = anyToFloat64(items["__total__"])
			} else if items, ok := groundTruth["items"].(map[string]float64); ok {
				gtWeight = items["__total__"]
			}
		}
		predWeight := sumItemWeights(predItems)
		if predWeight == 0 && len(predItems) == 1 {
			predWeight = predItems[0].Weight
		}
		m.TotalWeightError = predWeight - gtWeight
		if gtWeight > 0 {
			m.TotalWeightErrorPct = math.Abs(m.TotalWeightError) / gtWeight * 100
		}
		m.ItemComparisons = buildItemComparisons(nil, predItems, groundTruth)
	} else if labelType == "items" {
		var totalGtWeight, totalPredWeight float64
		for _, gt := range gtItems {
			totalGtWeight += gt.Weight
			bestPred := findBestMatch(gt, predItems)
			if bestPred != nil {
				err := bestPred.Weight - gt.Weight
				m.ItemWeightErrors = append(m.ItemWeightErrors, err)
				totalPredWeight += bestPred.Weight
				if gt.Weight > 0 {
					m.ItemWeightErrorPcts = append(m.ItemWeightErrorPcts, math.Abs(err)/gt.Weight*100)
				}
			} else {
				m.ItemWeightErrors = append(m.ItemWeightErrors, -gt.Weight)
				if gt.Weight > 0 {
					m.ItemWeightErrorPcts = append(m.ItemWeightErrorPcts, 100)
				}
			}
		}
		m.TotalWeightError = totalPredWeight - totalGtWeight
		if totalGtWeight > 0 {
			m.TotalWeightErrorPct = math.Abs(m.TotalWeightError) / totalGtWeight * 100
		}
		m.ItemComparisons = buildItemComparisons(gtItems, predItems, groundTruth)
	}
	return m
}

func buildItemComparisonsWithAIMatch(gtItems, predItems []item, match *aiMatchResult) []map[string]any {
	var comparisons []map[string]any
	usedPred := map[int]bool{}
	for gi, gt := range gtItems {
		row := map[string]any{
			"gt_name":    gt.Name,
			"gt_weight":  gt.Weight,
			"matched":    false,
			"similarity": 0,
		}
		if pi, ok := match.GTToPred[gi]; ok && pi >= 0 && pi < len(predItems) {
			usedPred[pi] = true
			p := predItems[pi]
			row["pred_name"] = p.Name
			row["pred_weight"] = p.Weight
			row["weight_error"] = p.Weight - gt.Weight
			row["matched"] = true
			row["similarity"] = 1
			if gt.Weight > 0 {
				row["weight_error_pct"] = math.Abs(p.Weight-gt.Weight) / gt.Weight * 100
			}
		}
		comparisons = append(comparisons, row)
	}
	for i, p := range predItems {
		if usedPred[i] {
			continue
		}
		comparisons = append(comparisons, map[string]any{
			"gt_name":     "",
			"gt_weight":   0,
			"pred_name":   p.Name,
			"pred_weight": p.Weight,
			"matched":     false,
			"similarity":  0,
			"extra":       true,
		})
	}
	return comparisons
}

func buildItemComparisons(gtItems, predItems []item, groundTruth map[string]any) []map[string]any {
	var comparisons []map[string]any
	usedPred := map[int]bool{}
	for _, gt := range gtItems {
		bestIdx, bestScore := -1, 0.0
		for i, p := range predItems {
			if usedPred[i] {
				continue
			}
			score := nameSimilarity(gt.Name, p.Name)
			if score >= 0.6 && (bestIdx == -1 || score > bestScore) {
				bestIdx = i
				bestScore = score
			}
		}
		row := map[string]any{
			"gt_name":    gt.Name,
			"gt_weight":  gt.Weight,
			"matched":    bestIdx >= 0 && bestScore >= 0.8,
			"similarity": bestScore,
		}
		if bestIdx >= 0 {
			usedPred[bestIdx] = true
			p := predItems[bestIdx]
			row["pred_name"] = p.Name
			row["pred_weight"] = p.Weight
			row["weight_error"] = p.Weight - gt.Weight
			if gt.Weight > 0 {
				row["weight_error_pct"] = math.Abs(p.Weight-gt.Weight) / gt.Weight * 100
			}
		}
		comparisons = append(comparisons, row)
	}
	for i, p := range predItems {
		if usedPred[i] {
			continue
		}
		comparisons = append(comparisons, map[string]any{
			"gt_name":     "",
			"gt_weight":   0,
			"pred_name":   p.Name,
			"pred_weight": p.Weight,
			"matched":     false,
			"similarity":  0,
			"extra":       true,
		})
	}
	if len(gtItems) == 0 {
		labelType, _ := groundTruth["label_type"].(string)
		if labelType == "total" {
			gtWeight := anyToFloat64(groundTruth["total_weight_grams"])
			if gtWeight == 0 {
				if items, ok := groundTruth["items"].(map[string]any); ok {
					gtWeight = anyToFloat64(items["__total__"])
				} else if items, ok := groundTruth["items"].(map[string]float64); ok {
					gtWeight = items["__total__"]
				}
			}
			predWeight := sumItemWeights(predItems)
			if predWeight == 0 && len(predItems) == 1 {
				predWeight = predItems[0].Weight
			}
			comparisons = append(comparisons, map[string]any{
				"gt_name":      "__total__",
				"gt_weight":    gtWeight,
				"pred_name":    "__total__",
				"pred_weight":  predWeight,
				"weight_error": predWeight - gtWeight,
				"matched":      true,
				"similarity":   1,
			})
		}
	}
	return comparisons
}

type item struct {
	Name   string
	Weight float64
}

func extractItems(data map[string]any) []item {
	var rawItems []any
	switch v := data["items"].(type) {
	case []any:
		rawItems = v
	case []map[string]any:
		for _, m := range v {
			rawItems = append(rawItems, m)
		}
	}
	var out []item
	for _, it := range rawItems {
		m, ok := it.(map[string]any)
		if !ok {
			continue
		}
		name, _ := m["name"].(string)
		w := anyToFloat64(m["estimatedWeightGrams"])
		if w == 0 {
			w = anyToFloat64(m["grossWeightGrams"])
		}
		if w == 0 {
			w = anyToFloat64(m["originalWeightGrams"])
		}
		if w == 0 {
			w = anyToFloat64(m["weight_grams"])
		}
		if strings.TrimSpace(name) == "" && w == 0 {
			continue
		}
		out = append(out, item{Name: name, Weight: w})
	}
	sortItems(out)
	return out
}

func extractGroundTruthItems(groundTruth map[string]any) []item {
	var out []item
	switch raw := groundTruth["items"].(type) {
	case map[string]float64:
		for name, w := range raw {
			out = append(out, item{Name: name, Weight: w})
		}
	case map[string]any:
		for name, v := range raw {
			out = append(out, item{Name: name, Weight: anyToFloat64(v)})
		}
	case []any:
		// legacy array format for backward compatibility with existing runs
		for _, it := range raw {
			m, ok := it.(map[string]any)
			if !ok {
				continue
			}
			name, _ := m["name"].(string)
			w := anyToFloat64(m["weight_grams"])
			out = append(out, item{Name: name, Weight: w})
		}
	}
	// 占位符 __total__ 只用于 total 类型，items 类型不参与分项对比
	for i := 0; i < len(out); i++ {
		if out[i].Name == "__total__" {
			out = append(out[:i], out[i+1:]...)
			break
		}
	}
	sortItems(out)
	return out
}

func sortItems(items []item) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Name == items[j].Name {
			return items[i].Weight < items[j].Weight
		}
		return items[i].Name < items[j].Name
	})
}

func findBestMatch(gt item, preds []item) *item {
	var best *item
	bestScore := 0.0
	for i := range preds {
		score := nameSimilarity(gt.Name, preds[i].Name)
		if score >= 0.6 && (best == nil || score > bestScore) {
			best = &preds[i]
			bestScore = score
		}
	}
	return best
}

func sumItemWeights(items []item) float64 {
	var sum float64
	for _, it := range items {
		sum += it.Weight
	}
	return sum
}

func nameSimilarity(a, b string) float64 {
	a = strings.ToLower(strings.TrimSpace(a))
	b = strings.ToLower(strings.TrimSpace(b))
	if a == "" || b == "" {
		return 0
	}
	if a == b {
		return 1
	}
	if strings.Contains(a, b) || strings.Contains(b, a) {
		return 0.9
	}

	// 如果两个名称有共同前缀（通常是品牌）且都包含品类关键词，视为同一产品系列。
	if commonPrefixRunes(a, b) >= 2 {
		aHasCategory := hasFoodCategoryKeyword(a)
		bHasCategory := hasFoodCategoryKeyword(b)
		if aHasCategory && bHasCategory {
			return 0.85
		}
	}

	setA := map[rune]struct{}{}
	for _, r := range a {
		setA[r] = struct{}{}
	}
	intersection := 0
	for _, r := range b {
		if _, ok := setA[r]; ok {
			intersection++
		}
	}
	union := len(setA) + len([]rune(b)) - intersection
	if union == 0 {
		return 0
	}
	return float64(intersection) / float64(union)
}

func commonPrefixRunes(a, b string) int {
	ra := []rune(a)
	rb := []rune(b)
	n := len(ra)
	if len(rb) < n {
		n = len(rb)
	}
	count := 0
	for i := 0; i < n; i++ {
		if ra[i] == rb[i] {
			count++
		} else {
			break
		}
	}
	return count
}

func hasFoodCategoryKeyword(value string) bool {
	keywords := []string{
		"橙汁", "橙", "橘子", "柑橘", "柠檬", "葡萄", "苹果", "香蕉", "草莓", "蓝莓", "西瓜", "梨", "桃", "芒果", "菠萝",
		"饮料", "果汁", "汽水", "可乐", "奶茶", "咖啡", "茶", "水", "牛奶", "酸奶", "牛乳", "乳",
		"巧克力", "面包", "蛋糕", "饼干", "薯片", "方便面", "泡面", "面条", "米饭", "粥", "饺子", "包子", "馒头",
		"香肠", "火腿", "肠", "肉", "鱼", "虾", "蛋", "鸡", "鸭", "鹅", "牛", "羊", "猪",
		"冰淇淋", "雪糕", "果冻", "糖果", "辣条", "小面筋", "锅巴", "竹笋", "棒", "条", "袋", "罐", "瓶", "盒",
	}
	for _, kw := range keywords {
		if strings.Contains(value, kw) {
			return true
		}
	}
	return false
}

func anyToFloat64(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case int32:
		return float64(n)
	case string:
		f, _ := strconv.ParseFloat(n, 64)
		return f
	}
	return 0
}

func mape(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

func rmse(errors []float64) float64 {
	if len(errors) == 0 {
		return 0
	}
	var sum float64
	for _, e := range errors {
		sum += e * e
	}
	return math.Sqrt(sum / float64(len(errors)))
}

func avg(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

// sampleNameMatchRate 返回单个样本的名称命中率（百分比，如 5/6 返回 83.33）。
// 优先使用 name_match_details，其次从 item_comparisons 统计。
func sampleNameMatchRate(metrics *domain.SampleMetrics) float64 {
	if metrics == nil {
		return -1
	}
	if len(metrics.NameMatchDetails) > 0 {
		total := len(metrics.NameMatchDetails)
		matched := 0
		for _, ok := range metrics.NameMatchDetails {
			if ok {
				matched++
			}
		}
		return float64(matched) / float64(total) * 100
	}
	if len(metrics.ItemComparisons) > 0 {
		total := 0
		matched := 0
		for _, row := range metrics.ItemComparisons {
			if name, _ := row["gt_name"].(string); name == "" {
				continue
			}
			total++
			if v, _ := row["matched"].(bool); v {
				matched++
			}
		}
		if total > 0 {
			return float64(matched) / float64(total) * 100
		}
	}
	if metrics.NameMatched {
		return 100
	}
	return -1
}

func toSampleMetrics(m map[string]any) *domain.SampleMetrics {
	s := &domain.SampleMetrics{}
	if v, ok := m["name_matched"].(bool); ok {
		s.NameMatched = v
	}
	if arr, ok := m["name_match_details"].([]any); ok {
		for _, raw := range arr {
			if b, ok := raw.(bool); ok {
				s.NameMatchDetails = append(s.NameMatchDetails, b)
			}
		}
	}
	if v, ok := m["total_weight_error"].(float64); ok {
		s.TotalWeightError = v
	}
	if v, ok := m["total_weight_error_pct"].(float64); ok {
		s.TotalWeightErrorPct = v
	}
	if v, ok := m["duration_ms"].(float64); ok {
		s.DurationMs = v
	}
	if arr, ok := m["item_comparisons"].([]any); ok {
		for _, raw := range arr {
			if row, ok := raw.(map[string]any); ok {
				s.ItemComparisons = append(s.ItemComparisons, row)
			}
		}
	}
	s.ItemWeightErrors = appendFloatSlice(s.ItemWeightErrors, m["item_weight_errors"])
	s.ItemWeightErrorPcts = appendFloatSlice(s.ItemWeightErrorPcts, m["item_weight_error_pcts"])
	return s
}

func appendFloatSlice(dst []float64, v any) []float64 {
	arr, ok := v.([]any)
	if !ok {
		return dst
	}
	for _, raw := range arr {
		switch n := raw.(type) {
		case float64:
			dst = append(dst, n)
		case float32:
			dst = append(dst, float64(n))
		case int:
			dst = append(dst, float64(n))
		case int64:
			dst = append(dst, float64(n))
		}
	}
	return dst
}

func ptrString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
