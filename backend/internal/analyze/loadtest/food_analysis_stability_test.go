//go:build food_analysis_load

package loadtest

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	authservice "food_link/backend/internal/auth/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
	"github.com/tencentyun/cos-go-sdk-v5"
	"gorm.io/gorm"
)

const (
	defaultRequestCount = 20
	defaultPollInterval = 500 * time.Millisecond
	defaultTaskTimeout  = 8 * time.Minute
)

var (
	foodAnalysisLoadModelFlag         = flag.String("food.analysis.model", "", "food analysis modelName submitted to /api/analyze/submit, for example doubao, ofox-gemini, or empty for backend default")
	foodAnalysisLoadExecutionModeFlag = flag.String("food.analysis.execution_mode", "", "food analysis execution_mode, for example standard or precision; empty uses FOOD_ANALYSIS_LOAD_EXECUTION_MODE/default")
)

type loadConfig struct {
	baseURL       string
	imagePath     string
	requestCount  int
	startPattern  string
	startInterval time.Duration
	pollInterval  time.Duration
	taskTimeout   time.Duration
	executionMode string
	analysisModel string
	tokens        []string
	storageCfg    config.StorageConfig
}

type requestResult struct {
	index               int
	userTokenIndex      int
	imageURL            string
	taskID              string
	status              string
	uploadDuration      time.Duration
	submitDuration      time.Duration
	queueDuration       time.Duration
	taskDuration        time.Duration
	processDuration     time.Duration
	totalDuration       time.Duration
	processingStartedAt *time.Time
	completedAt         *time.Time
	calories            float64
	err                 error
}

type apiEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

type submitResponse struct {
	TaskID string `json:"task_id"`
	TaskId string `json:"taskId"`
}

type analysisTaskResponse struct {
	ID           string         `json:"id"`
	Status       string         `json:"status"`
	TaskType     string         `json:"task_type"`
	ImageURL     string         `json:"image_url"`
	ImagePaths   []string       `json:"image_paths"`
	Result       map[string]any `json:"result"`
	ErrorMessage string         `json:"error_message"`
	CreatedAt    *time.Time     `json:"created_at"`
	UpdatedAt    *time.Time     `json:"updated_at"`
}

type pollAnalyzeTaskResult struct {
	task                analysisTaskResponse
	processingStartedAt *time.Time
}

func TestFoodAnalysisStabilityAndLatency(t *testing.T) {
	runFoodAnalysisLoadTest(t, "")
}

func runFoodAnalysisLoadTest(t *testing.T, defaultModel string) {
	t.Helper()
	cfg := loadFoodAnalysisConfig(t)
	if strings.TrimSpace(cfg.analysisModel) == "" {
		cfg.analysisModel = strings.TrimSpace(defaultModel)
	}
	t.Logf("food analysis load test config: base_url=%s count=%d pattern=%s interval=%s image=%s execution_mode=%s model=%s",
		cfg.baseURL, cfg.requestCount, cfg.startPattern, cfg.startInterval, cfg.imagePath, cfg.executionMode, cfg.analysisModel)
	t.Log("upload API: POST /api/upload-analyze-image-file, form field `file`; legacy base64 API: POST /api/upload-analyze-image")
	t.Log("task cleanup API: DELETE /api/analyze/tasks/:task_id only deletes analysis task rows; uploaded COS objects are deleted directly by this test after URL key resolution")
	t.Log("latency focus: processing_duration is measured from backend task status=processing updated_at to final done updated_at; upload, submit, queue wait, and test goroutine scheduling are not included in the main latency statistics")

	imageBytes, err := os.ReadFile(cfg.imagePath)
	if err != nil {
		t.Fatalf("read test image %s: %v", cfg.imagePath, err)
	}
	t.Logf("same-food guarantee: all %d submissions reuse the same uploaded image bytes from %s", cfg.requestCount, cfg.imagePath)

	ctx, cancel := context.WithTimeout(context.Background(), cfg.taskTimeout+time.Duration(cfg.requestCount)*cfg.startInterval+2*time.Minute)
	defer cancel()

	uploadStarted := time.Now()
	sharedImageURL, err := uploadAnalyzeImageFile(ctx, cfg.baseURL, cfg.tokens[0], imageBytes, "food-load-shared.jpg")
	if err != nil {
		t.Fatalf("upload shared image: %v", err)
	}
	sharedUploadDuration := time.Since(uploadStarted)
	t.Logf("shared image uploaded once: url=%s duration=%s", sharedImageURL, sharedUploadDuration)

	results := make([]requestResult, cfg.requestCount)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < cfg.requestCount; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			if cfg.startPattern == "burst" {
				<-start
			} else {
				time.Sleep(time.Duration(i) * cfg.startInterval)
			}
			results[i] = runFoodAnalysisOnce(ctx, cfg, sharedImageURL, i)
		}()
	}
	if cfg.startPattern == "burst" {
		close(start)
	}
	wg.Wait()

	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cleanupCancel()
	cleanupFoodAnalysisArtifacts(t, cleanupCtx, cfg, results)

	summarizeFoodAnalysisLoad(t, results, sharedUploadDuration)
	for _, result := range results {
		if result.err != nil {
			t.Errorf("request #%02d failed: %v", result.index+1, result.err)
		}
	}
}

func TestFoodAnalysisLoadCleanupUploadedImages(t *testing.T) {
	imageURLs := parseCSV(os.Getenv("FOOD_ANALYSIS_LOAD_CLEANUP_IMAGE_URLS"))
	if len(imageURLs) == 0 {
		t.Skip("FOOD_ANALYSIS_LOAD_CLEANUP_IMAGE_URLS is empty")
	}
	backendRoot := findBackendRoot(t)
	cfgFile, err := config.Load(backendRoot)
	if err != nil {
		t.Fatalf("load backend config from %s: %v", backendRoot, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	deleted, err := deleteFoodImageObjects(ctx, cfgFile.Storage, imageURLs)
	if err != nil {
		t.Fatalf("cleanup COS food images failed after deleting %d/%d objects: %v", deleted, len(imageURLs), err)
	}
	t.Logf("cleanup COS food images: deleted=%d", deleted)
}

func loadFoodAnalysisConfig(t *testing.T) loadConfig {
	t.Helper()
	backendRoot := findBackendRoot(t)
	cfgFile, err := config.Load(backendRoot)
	if err != nil {
		t.Fatalf("load backend config from %s: %v", backendRoot, err)
	}

	baseURL := strings.TrimRight(envString("FOOD_ANALYSIS_LOAD_BASE_URL", "http://127.0.0.1:3010"), "/")
	requestCount := envInt("FOOD_ANALYSIS_LOAD_COUNT", defaultRequestCount)
	if requestCount <= 0 {
		t.Fatalf("FOOD_ANALYSIS_LOAD_COUNT must be greater than 0")
	}
	startPattern := strings.ToLower(envString("FOOD_ANALYSIS_LOAD_PATTERN", "stagger"))
	if startPattern != "stagger" && startPattern != "burst" {
		t.Fatalf("FOOD_ANALYSIS_LOAD_PATTERN must be stagger or burst, got %q", startPattern)
	}
	imagePath := envString("FOOD_ANALYSIS_LOAD_IMAGE", filepath.Join(backendRoot, "testdata", "food", "6781F1707431AC4E3BAB1416242E433D.jpg"))
	if !filepath.IsAbs(imagePath) {
		imagePath = filepath.Join(backendRoot, imagePath)
	}

	tokens := parseCSV(os.Getenv("FOOD_ANALYSIS_LOAD_TOKENS"))
	if len(tokens) == 0 {
		userIDs := parseCSV(os.Getenv("FOOD_ANALYSIS_LOAD_USER_IDS"))
		if len(userIDs) == 0 {
			userIDs = createTemporaryLoadTestUsers(t, cfgFile.Database, requestCount)
			t.Logf("FOOD_ANALYSIS_LOAD_TOKENS and FOOD_ANALYSIS_LOAD_USER_IDS are empty; created %d temporary UUID users in the configured database and registered cleanup.", len(userIDs))
		} else {
			validateLoadTestUserIDs(t, userIDs)
			t.Logf("FOOD_ANALYSIS_LOAD_TOKENS is empty; generated local JWTs for %d FOOD_ANALYSIS_LOAD_USER_IDS. Those IDs must exist in the configured database.", len(userIDs))
		}
		tokens = issueLocalTokens(t, cfgFile.JWT, userIDs)
	}

	return loadConfig{
		baseURL:       baseURL,
		imagePath:     imagePath,
		requestCount:  requestCount,
		startPattern:  startPattern,
		startInterval: envDuration("FOOD_ANALYSIS_LOAD_START_INTERVAL", 500*time.Millisecond),
		pollInterval:  envDuration("FOOD_ANALYSIS_LOAD_POLL_INTERVAL", defaultPollInterval),
		taskTimeout:   envDuration("FOOD_ANALYSIS_LOAD_TASK_TIMEOUT", defaultTaskTimeout),
		executionMode: firstNonEmpty(*foodAnalysisLoadExecutionModeFlag, envString("FOOD_ANALYSIS_LOAD_EXECUTION_MODE", "standard")),
		analysisModel: firstNonEmpty(*foodAnalysisLoadModelFlag, os.Getenv("FOOD_ANALYSIS_LOAD_MODEL")),
		tokens:        tokens,
		storageCfg:    cfgFile.Storage,
	}
}

func runFoodAnalysisOnce(ctx context.Context, cfg loadConfig, imageURL string, index int) requestResult {
	tokenIndex := index % len(cfg.tokens)
	token := cfg.tokens[tokenIndex]
	result := requestResult{index: index, userTokenIndex: tokenIndex, imageURL: imageURL, status: "not_started"}
	started := time.Now()

	submitStarted := time.Now()
	taskID, err := submitAnalyzeTask(ctx, cfg, token, imageURL, index)
	result.submitDuration = time.Since(submitStarted)
	submitFinished := time.Now()
	if err != nil {
		result.err = fmt.Errorf("submit analysis task: %w", err)
		result.totalDuration = time.Since(started)
		return result
	}
	result.taskID = taskID

	taskStarted := time.Now()
	pollResult, err := pollAnalyzeTask(ctx, cfg, token, taskID)
	result.taskDuration = time.Since(taskStarted)
	result.totalDuration = time.Since(started)
	if err != nil {
		result.err = fmt.Errorf("poll task %s: %w", taskID, err)
		return result
	}
	task := pollResult.task
	result.status = task.Status
	result.calories = extractCalories(task.Result)
	result.processingStartedAt = pollResult.processingStartedAt
	result.completedAt = task.UpdatedAt
	if result.processingStartedAt != nil {
		result.queueDuration = result.processingStartedAt.Sub(submitFinished)
		if result.queueDuration < 0 {
			result.queueDuration = 0
		}
	}
	if result.processingStartedAt != nil && result.completedAt != nil {
		result.processDuration = result.completedAt.Sub(*result.processingStartedAt)
		if result.processDuration < 0 {
			result.processDuration = 0
		}
	}
	if task.Status != "done" {
		result.err = fmt.Errorf("task ended with status=%s error=%s", task.Status, task.ErrorMessage)
	}
	return result
}

func uploadAnalyzeImageFile(ctx context.Context, baseURL, token string, imageBytes []byte, filename string) (string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{
		"name":     "file",
		"filename": filename,
	}))
	header.Set("Content-Type", "image/jpeg")
	part, err := writer.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(imageBytes); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/api/upload-analyze-image-file", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	setBearer(req, token)

	var payload map[string]any
	if err := doJSON(req, &payload); err != nil {
		return "", err
	}
	for _, key := range []string{"imageUrl", "image_url", "url"} {
		if value := strings.TrimSpace(fmt.Sprint(payload[key])); value != "" && value != "<nil>" {
			return value, nil
		}
	}
	return "", fmt.Errorf("upload response missing imageUrl: %#v", payload)
}

func submitAnalyzeTask(ctx context.Context, cfg loadConfig, token, imageURL string, index int) (string, error) {
	timezoneOffset := -480
	body := map[string]any{
		"image_url":               imageURL,
		"image_urls":              []string{imageURL},
		"meal_type":               "lunch",
		"execution_mode":          cfg.executionMode,
		"analysis_engine":         "db_first",
		"timezone_offset_minutes": timezoneOffset,
		"additionalContext":       fmt.Sprintf("food analysis load test request #%02d", index+1),
	}
	if cfg.analysisModel != "" {
		body["modelName"] = cfg.analysisModel
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.baseURL+"/api/analyze/submit", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	setBearer(req, token)

	var payload submitResponse
	if err := doJSON(req, &payload); err != nil {
		return "", err
	}
	taskID := strings.TrimSpace(payload.TaskID)
	if taskID == "" {
		taskID = strings.TrimSpace(payload.TaskId)
	}
	if taskID == "" {
		return "", fmt.Errorf("submit response missing task_id: %#v", payload)
	}
	return taskID, nil
}

func pollAnalyzeTask(ctx context.Context, cfg loadConfig, token, taskID string) (pollAnalyzeTaskResult, error) {
	deadline := time.Now().Add(cfg.taskTimeout)
	var processingStartedAt *time.Time
	for {
		task, err := getAnalyzeTask(ctx, cfg.baseURL, token, taskID)
		if err != nil {
			return pollAnalyzeTaskResult{processingStartedAt: processingStartedAt}, err
		}
		if task.Status == "processing" && processingStartedAt == nil {
			if task.UpdatedAt != nil {
				startedAt := *task.UpdatedAt
				processingStartedAt = &startedAt
			} else {
				startedAt := time.Now()
				processingStartedAt = &startedAt
			}
		}
		switch task.Status {
		case "done", "failed", "timed_out", "cancelled", "violated":
			return pollAnalyzeTaskResult{task: task, processingStartedAt: processingStartedAt}, nil
		}
		if time.Now().After(deadline) {
			return pollAnalyzeTaskResult{task: task, processingStartedAt: processingStartedAt}, fmt.Errorf("task did not finish within %s; last status=%s", cfg.taskTimeout, task.Status)
		}
		select {
		case <-ctx.Done():
			return pollAnalyzeTaskResult{task: task, processingStartedAt: processingStartedAt}, ctx.Err()
		case <-time.After(cfg.pollInterval):
		}
	}
}

func getAnalyzeTask(ctx context.Context, baseURL, token, taskID string) (analysisTaskResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/api/analyze/tasks/"+url.PathEscape(taskID), nil)
	if err != nil {
		return analysisTaskResponse{}, err
	}
	setBearer(req, token)

	var payload analysisTaskResponse
	if err := doJSON(req, &payload); err != nil {
		return analysisTaskResponse{}, err
	}
	return payload, nil
}

func deleteAnalyzeTask(ctx context.Context, baseURL, token, taskID string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, baseURL+"/api/analyze/tasks/"+url.PathEscape(taskID), nil)
	if err != nil {
		return err
	}
	setBearer(req, token)
	var payload map[string]any
	return doJSON(req, &payload)
}

func doJSON(req *http.Request, out any) error {
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s returned %d: %s", req.Method, req.URL.Path, resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var envelope apiEnvelope
	if err := json.Unmarshal(data, &envelope); err == nil && len(envelope.Data) > 0 {
		if envelope.Code != 0 {
			return fmt.Errorf("%s %s returned code=%d message=%s", req.Method, req.URL.Path, envelope.Code, envelope.Message)
		}
		return json.Unmarshal(envelope.Data, out)
	}
	return json.Unmarshal(data, out)
}

func cleanupFoodAnalysisArtifacts(t *testing.T, ctx context.Context, cfg loadConfig, results []requestResult) {
	t.Helper()
	for _, result := range results {
		if result.taskID == "" {
			continue
		}
		token := cfg.tokens[result.userTokenIndex%len(cfg.tokens)]
		if err := deleteAnalyzeTask(ctx, cfg.baseURL, token, result.taskID); err != nil {
			t.Logf("cleanup task %s failed: %v", result.taskID, err)
		}
	}

	imageURLs := make([]string, 0, len(results))
	seenImages := map[string]bool{}
	for _, result := range results {
		if result.imageURL != "" && !seenImages[result.imageURL] {
			imageURLs = append(imageURLs, result.imageURL)
			seenImages[result.imageURL] = true
		}
	}
	if len(imageURLs) == 0 {
		return
	}
	deleted, err := deleteFoodImageObjects(ctx, cfg.storageCfg, imageURLs)
	if err != nil {
		t.Errorf("cleanup COS food images failed after deleting %d/%d objects: %v", deleted, len(imageURLs), err)
		return
	}
	t.Logf("cleanup COS food images: deleted=%d", deleted)
}

func deleteFoodImageObjects(ctx context.Context, storageCfg config.StorageConfig, imageURLs []string) (int, error) {
	if storageCfg.COSFoodImagesBucket == "" {
		return 0, fmt.Errorf("storage.food_images_bucket is empty")
	}
	if storageCfg.COSSecretID == "" || storageCfg.COSSecretKey == "" {
		return 0, fmt.Errorf("COS credentials are empty")
	}
	storageClient := storage.New(storageCfg)
	regions := cosRegionCandidates(storageCfg.COSRegion)

	deleted := 0
	for _, imageURL := range imageURLs {
		key := storageClient.ResolveObjectKey("food-images", imageURL)
		if key == "" {
			return deleted, fmt.Errorf("cannot resolve COS object key from image URL %q", imageURL)
		}
		if err := deleteCOSObjectWithRegionFallback(ctx, storageCfg, regions, key); err != nil {
			return deleted, fmt.Errorf("delete %s: %w", key, err)
		}
		deleted++
	}
	return deleted, nil
}

func cosRegionCandidates(configured string) []string {
	candidates := []string{configured, os.Getenv("COS_REGION"), "ap-beijing", "ap-shanghai", "ap-guangzhou"}
	out := make([]string, 0, len(candidates))
	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		out = append(out, candidate)
	}
	if len(out) == 0 {
		return []string{"ap-beijing"}
	}
	return out
}

func deleteCOSObjectWithRegionFallback(ctx context.Context, storageCfg config.StorageConfig, regions []string, key string) error {
	var lastErr error
	for _, region := range regions {
		client, err := newCOSBucketClient(storageCfg, region)
		if err != nil {
			lastErr = err
			continue
		}
		for attempt := 1; attempt <= 3; attempt++ {
			_, err = client.Object.Delete(ctx, key)
			if err == nil {
				return nil
			}
			lastErr = err
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * 300 * time.Millisecond):
			}
		}
	}
	return lastErr
}

func newCOSBucketClient(storageCfg config.StorageConfig, region string) (*cos.Client, error) {
	base, err := url.Parse(fmt.Sprintf("https://%s.cos.%s.myqcloud.com", storageCfg.COSFoodImagesBucket, region))
	if err != nil {
		return nil, err
	}
	return cos.NewClient(&cos.BaseURL{BucketURL: base}, &http.Client{
		Transport: &cos.AuthorizationTransport{
			SecretID:  storageCfg.COSSecretID,
			SecretKey: storageCfg.COSSecretKey,
		},
	}), nil
}

func summarizeFoodAnalysisLoad(t *testing.T, results []requestResult, sharedUploadDuration time.Duration) {
	t.Helper()
	successes := make([]requestResult, 0, len(results))
	failures := 0
	for _, result := range results {
		if result.err != nil || result.status != "done" {
			failures++
			continue
		}
		successes = append(successes, result)
	}

	submitDurations := durations(successes, func(r requestResult) time.Duration { return r.submitDuration })
	queueDurations := durationsWithValue(successes, func(r requestResult) (time.Duration, bool) {
		return r.queueDuration, r.processingStartedAt != nil
	})
	taskDurations := durations(successes, func(r requestResult) time.Duration { return r.taskDuration })
	totalDurations := durations(successes, func(r requestResult) time.Duration { return r.totalDuration })
	processDurations := durationsWithValue(successes, func(r requestResult) (time.Duration, bool) {
		return r.processDuration, r.processDuration > 0
	})
	avgCalories := averageFloat(successes, func(r requestResult) float64 { return r.calories })
	processVarianceMS2, processStddev := durationVarianceMS2(processDurations)
	taskVarianceMS2, taskStddev := durationVarianceMS2(taskDurations)
	totalVarianceMS2, totalStddev := durationVarianceMS2(totalDurations)

	t.Logf("food analysis load summary: total=%d success=%d failed=%d success_rate=%.1f%% shared_upload=%s avg_submit=%s avg_queue=%s avg_processing=%s p95_processing=%s processing_variance_ms2=%.2f processing_stddev=%s processing_samples=%d avg_task_wait=%s p95_task_wait=%s task_wait_variance_ms2=%.2f task_wait_stddev=%s avg_total=%s p95_total=%s total_variance_ms2=%.2f total_stddev=%s avg_calories=%.1f",
		len(results),
		len(successes),
		failures,
		float64(len(successes))*100/float64(len(results)),
		sharedUploadDuration,
		averageDuration(submitDurations),
		averageDuration(queueDurations),
		averageDuration(processDurations),
		percentileDuration(processDurations, 0.95),
		processVarianceMS2,
		processStddev,
		len(processDurations),
		averageDuration(taskDurations),
		percentileDuration(taskDurations, 0.95),
		taskVarianceMS2,
		taskStddev,
		averageDuration(totalDurations),
		percentileDuration(totalDurations, 0.95),
		totalVarianceMS2,
		totalStddev,
		avgCalories,
	)
	for _, result := range results {
		if result.err != nil {
			t.Logf("#%02d token=%02d status=%s task=%s submit=%s queue=%s processing=%s task_wait=%s total=%s err=%v",
				result.index+1, result.userTokenIndex+1, result.status, result.taskID, result.submitDuration, result.queueDuration, result.processDuration, result.taskDuration, result.totalDuration, result.err)
			continue
		}
		t.Logf("#%02d token=%02d status=%s task=%s submit=%s queue=%s processing=%s task_wait=%s total=%s calories=%.1f",
			result.index+1, result.userTokenIndex+1, result.status, result.taskID, result.submitDuration, result.queueDuration, result.processDuration, result.taskDuration, result.totalDuration, result.calories)
	}
}

func durations(results []requestResult, pick func(requestResult) time.Duration) []time.Duration {
	out := make([]time.Duration, 0, len(results))
	for _, result := range results {
		out = append(out, pick(result))
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func durationsWithValue(results []requestResult, pick func(requestResult) (time.Duration, bool)) []time.Duration {
	out := make([]time.Duration, 0, len(results))
	for _, result := range results {
		value, ok := pick(result)
		if !ok {
			continue
		}
		out = append(out, value)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func averageDuration(values []time.Duration) time.Duration {
	if len(values) == 0 {
		return 0
	}
	var total time.Duration
	for _, value := range values {
		total += value
	}
	return total / time.Duration(len(values))
}

func percentileDuration(values []time.Duration, p float64) time.Duration {
	if len(values) == 0 {
		return 0
	}
	idx := int(float64(len(values)-1)*p + 0.5)
	if idx < 0 {
		idx = 0
	}
	if idx >= len(values) {
		idx = len(values) - 1
	}
	return values[idx]
}

func durationVarianceMS2(values []time.Duration) (float64, time.Duration) {
	if len(values) == 0 {
		return 0, 0
	}
	mean := 0.0
	for _, value := range values {
		mean += float64(value) / float64(time.Millisecond)
	}
	mean /= float64(len(values))
	variance := 0.0
	for _, value := range values {
		delta := float64(value)/float64(time.Millisecond) - mean
		variance += delta * delta
	}
	variance /= float64(len(values))
	return variance, time.Duration(math.Sqrt(variance) * float64(time.Millisecond))
}

func averageFloat(results []requestResult, pick func(requestResult) float64) float64 {
	if len(results) == 0 {
		return 0
	}
	total := 0.0
	for _, result := range results {
		total += pick(result)
	}
	return total / float64(len(results))
}

func extractCalories(result map[string]any) float64 {
	for _, key := range []string{"total_calories", "totalCalories", "calories", "calorie"} {
		if value, ok := toFloat64(result[key]); ok {
			return value
		}
	}
	if items, ok := result["items"].([]any); ok {
		total := 0.0
		for _, item := range items {
			row, ok := item.(map[string]any)
			if !ok {
				continue
			}
			found := false
			for _, key := range []string{"calories", "calorie", "total_calories", "totalCalories"} {
				if value, ok := toFloat64(row[key]); ok {
					total += value
					found = true
					break
				}
			}
			if !found {
				nutrients, ok := row["nutrients"].(map[string]any)
				if !ok {
					continue
				}
				if value, ok := toFloat64(nutrients["calories"]); ok {
					total += value
				}
			}
		}
		return total
	}
	return 0
}

func toFloat64(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		f, err := v.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

func issueLocalTokens(t *testing.T, cfg config.JWTConfig, userIDs []string) []string {
	t.Helper()
	if strings.TrimSpace(cfg.Secret) == "" {
		t.Fatal("jwt.secret is empty and FOOD_ANALYSIS_LOAD_TOKENS is not set")
	}
	jwtSvc := authservice.NewJWTService(cfg.Secret, cfg.AccessTokenTTLSeconds, cfg.RefreshTokenTTLSeconds)
	tokens := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		token, err := jwtSvc.IssueAccess(userID, "load-openid-"+userID, "load-unionid-"+userID)
		if err != nil {
			t.Fatalf("issue JWT for %s: %v", userID, err)
		}
		tokens = append(tokens, token)
	}
	if len(tokens) == 0 {
		t.Fatal("no usable tokens generated")
	}
	return tokens
}

func validateLoadTestUserIDs(t *testing.T, userIDs []string) {
	t.Helper()
	for _, userID := range userIDs {
		userID = strings.TrimSpace(userID)
		if userID == "" {
			continue
		}
		if _, err := uuid.Parse(userID); err != nil {
			t.Fatalf("FOOD_ANALYSIS_LOAD_USER_IDS contains non-UUID user id %q. Unset FOOD_ANALYSIS_LOAD_USER_IDS to let the loadtest create temporary UUID users automatically, or provide real weapp_user.id UUIDs.", userID)
		}
	}
}

func createTemporaryLoadTestUsers(t *testing.T, cfg config.DatabaseConfig, count int) []string {
	t.Helper()
	if count <= 0 {
		t.Fatal("temporary loadtest user count must be greater than 0")
	}
	db, err := database.Open(cfg)
	if err != nil {
		t.Fatalf("open configured database for temporary loadtest users: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db for temporary loadtest users: %v", err)
	}
	tag := fmt.Sprintf("food-analysis-load-%s-%d", time.Now().UTC().Format("20060102T150405"), os.Getpid())
	type userRow struct {
		ID string `gorm:"column:id"`
	}
	var rows []userRow
	if err := db.Raw(`
WITH ins AS (
  INSERT INTO weapp_user (
    openid,
    nickname,
    avatar,
    earned_credits_balance,
    onboarding_completed,
    execution_mode,
    health_condition,
    create_time,
    update_time
  )
  SELECT
    ? || '-' || gs::text,
    'Food Analysis Load Test',
    '',
    100,
    true,
    'standard',
    '{}'::jsonb,
    now(),
    now()
  FROM generate_series(1, ?) AS gs
  RETURNING id
)
SELECT id::text AS id FROM ins
`, tag, count).Scan(&rows).Error; err != nil {
		_ = sqlDB.Close()
		t.Fatalf("create temporary loadtest users: %v", err)
	}
	userIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		if strings.TrimSpace(row.ID) != "" {
			userIDs = append(userIDs, row.ID)
		}
	}
	if len(userIDs) != count {
		_ = cleanupTemporaryLoadTestUsers(context.Background(), db, tag)
		_ = sqlDB.Close()
		t.Fatalf("created %d temporary loadtest users, want %d", len(userIDs), count)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := cleanupTemporaryLoadTestUsers(ctx, db, tag); err != nil {
			t.Logf("cleanup temporary loadtest users with openid prefix %s failed: %v", tag, err)
		}
		if err := sqlDB.Close(); err != nil {
			t.Logf("close temporary loadtest database connection failed: %v", err)
		}
	})
	return userIDs
}

func cleanupTemporaryLoadTestUsers(ctx context.Context, db *gorm.DB, tag string) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`
DELETE FROM user_earned_credit_ledger
WHERE user_id IN (SELECT id FROM weapp_user WHERE openid LIKE ?)
`, tag+"-%").Error; err != nil {
			return fmt.Errorf("delete temporary earned credit ledger rows: %w", err)
		}
		if err := tx.Exec(`
DELETE FROM analysis_tasks
WHERE user_id IN (SELECT id FROM weapp_user WHERE openid LIKE ?)
`, tag+"-%").Error; err != nil {
			return fmt.Errorf("delete temporary analysis tasks: %w", err)
		}
		if err := tx.Exec(`DELETE FROM weapp_user WHERE openid LIKE ?`, tag+"-%").Error; err != nil {
			return fmt.Errorf("delete temporary users: %w", err)
		}
		return nil
	})
}

func setBearer(req *http.Request, token string) {
	token = strings.TrimSpace(token)
	token = strings.TrimPrefix(token, "Bearer ")
	token = strings.TrimSpace(token)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
}

func findBackendRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("cannot find backend go.mod")
		}
		dir = parent
	}
}

func envString(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func envInt(key string, fallback int) int {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return fallback
		}
		return parsed
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		if parsed, err := time.ParseDuration(value); err == nil {
			return parsed
		}
	}
	return fallback
}

func parseCSV(raw string) []string {
	out := []string{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
