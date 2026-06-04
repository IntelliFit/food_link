package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	authservice "food_link/backend/internal/auth/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

var defaultGrayModes = []string{
	"fast",
	"standard",
	"strict",
	"strict_separate",
	"fast_web_search",
	"standard_web_search",
	"strict_web_search",
}

type stringListFlag []string

func (f *stringListFlag) String() string {
	if f == nil {
		return ""
	}
	return strings.Join(*f, ",")
}

func (f *stringListFlag) Set(value string) error {
	for _, part := range splitCSV(value) {
		if part != "" {
			*f = append(*f, part)
		}
	}
	return nil
}

type rawListFlag []string

func (f *rawListFlag) String() string {
	if f == nil {
		return ""
	}
	return strings.Join(*f, ";")
}

func (f *rawListFlag) Set(value string) error {
	value = strings.TrimSpace(value)
	if value != "" {
		*f = append(*f, value)
	}
	return nil
}

type grayConfig struct {
	BaseURL              string
	ConfigDir            string
	Token                string
	UserID               string
	Modes                []string
	Cases                []verifyCase
	OutputDir            string
	MealType             string
	AdditionalContext    string
	SuggestRatioEnabled  bool
	PollInterval         time.Duration
	TaskTimeout          time.Duration
	RequestTimeout       time.Duration
	FailOnIssue          bool
	RequireDone          bool
	RequireMixed         bool
	MinItems             int
	MinPackagedItems     int
	MinNonPackagedItems  int
	MinAIFallbackItems   int
	MaxPackagedItems     int
	MaxUnresolvedLike    int
	MaxMissingNutrition  int
	RequireAIRatio       bool
	RequirePackageAnchor bool
	Expectations         map[string]gateConfig
	ExpectationErrors    []string
}

type gateConfig struct {
	RequireDone             bool              `json:"require_done,omitempty"`
	RequireMixed            bool              `json:"require_mixed,omitempty"`
	MinItems                int               `json:"min_items,omitempty"`
	MinPackagedItems        int               `json:"min_packaged_items,omitempty"`
	MinNonPackagedItems     int               `json:"min_non_packaged_items,omitempty"`
	MinAIFallbackItems      int               `json:"min_ai_fallback_items,omitempty"`
	MaxPackagedItems        *int              `json:"max_packaged_items,omitempty"`
	MaxUnresolvedLike       int               `json:"max_unresolved_like_items,omitempty"`
	MaxMissingNutrition     int               `json:"max_missing_nutrition_items,omitempty"`
	RequireAIRatio          bool              `json:"require_ai_ratio,omitempty"`
	RequirePackageAnchor    bool              `json:"require_package_anchor,omitempty"`
	NameContains            []string          `json:"name_contains,omitempty"`
	PackagedNameContains    []string          `json:"packaged_name_contains,omitempty"`
	NonPackagedNameContains []string          `json:"non_packaged_name_contains,omitempty"`
	ItemExpectations        []itemExpectation `json:"item_expectations,omitempty"`
}

func defaultGateConfig() gateConfig {
	return gateConfig{
		MaxUnresolvedLike:   -1,
		MaxMissingNutrition: -1,
	}
}

type itemExpectation struct {
	NameContains                []string `json:"name_contains,omitempty"`
	RequirePackaged             bool     `json:"require_packaged,omitempty"`
	RequireNonPackaged          bool     `json:"require_non_packaged,omitempty"`
	MinWeightG                  float64  `json:"min_weight_g,omitempty"`
	MaxWeightG                  float64  `json:"max_weight_g,omitempty"`
	MinCalories                 float64  `json:"min_calories,omitempty"`
	MaxCalories                 float64  `json:"max_calories,omitempty"`
	NutritionSource             string   `json:"nutrition_source,omitempty"`
	NutritionSourceAny          []string `json:"nutrition_source_any,omitempty"`
	PackageWeightSource         string   `json:"package_weight_source,omitempty"`
	RequirePackageWeightApplied bool     `json:"require_package_weight_applied,omitempty"`
}

func (g *gateConfig) UnmarshalJSON(data []byte) error {
	type gateConfigAlias gateConfig
	tmp := gateConfigAlias(defaultGateConfig())
	if err := json.Unmarshal(data, &tmp); err != nil {
		return err
	}
	*g = gateConfig(tmp)
	return nil
}

type verifyCase struct {
	Name              string          `json:"name"`
	Refs              []string        `json:"refs"`
	AdditionalContext string          `json:"additional_context,omitempty"`
	Correction        *correctionSpec `json:"correction,omitempty"`
}

type graySuiteFile struct {
	BaseURL             string                `json:"base_url,omitempty"`
	Modes               []string              `json:"modes,omitempty"`
	Cases               []graySuiteCase       `json:"cases,omitempty"`
	Expectations        map[string]gateConfig `json:"expectations,omitempty"`
	OutputDir           string                `json:"output_dir,omitempty"`
	MealType            string                `json:"meal_type,omitempty"`
	AdditionalContext   string                `json:"additional_context,omitempty"`
	SuggestRatioEnabled *bool                 `json:"suggest_ratio_enabled,omitempty"`
	FailOnIssue         *bool                 `json:"fail_on_issue,omitempty"`
	GlobalGate          *gateConfig           `json:"global_gate,omitempty"`
}

type graySuiteCase struct {
	Name              string          `json:"name"`
	Refs              []string        `json:"refs"`
	AdditionalContext string          `json:"additional_context,omitempty"`
	Expect            *gateConfig     `json:"expect,omitempty"`
	Correction        *correctionSpec `json:"correction,omitempty"`
}

type correctionSpec struct {
	AdditionalContext string           `json:"additional_context,omitempty"`
	Items             []map[string]any `json:"items,omitempty"`
	Expect            *gateConfig      `json:"expect,omitempty"`
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

type verifySummary struct {
	StartedAt  time.Time          `json:"started_at"`
	FinishedAt time.Time          `json:"finished_at"`
	BaseURL    string             `json:"base_url"`
	Modes      []string           `json:"modes"`
	OutputDir  string             `json:"output_dir"`
	Cases      []verifyCaseResult `json:"cases"`
	Counts     map[string]int     `json:"counts"`
}

type verifyCaseResult struct {
	Name         string      `json:"name"`
	Refs         []string    `json:"refs"`
	ImageURLs    []string    `json:"image_urls"`
	UploadErrors []string    `json:"upload_errors,omitempty"`
	Runs         []runResult `json:"runs"`
}

type runResult struct {
	CaseName                 string         `json:"case_name"`
	Mode                     string         `json:"mode"`
	TaskID                   string         `json:"task_id,omitempty"`
	FinalTaskID              string         `json:"final_task_id,omitempty"`
	FollowedTaskIDs          []string       `json:"followed_task_ids,omitempty"`
	Status                   string         `json:"status"`
	Error                    string         `json:"error,omitempty"`
	SubmitDurationMS         int64          `json:"submit_duration_ms,omitempty"`
	WaitDurationMS           int64          `json:"wait_duration_ms,omitempty"`
	TotalDurationMS          int64          `json:"total_duration_ms,omitempty"`
	RawResultPath            string         `json:"raw_result_path,omitempty"`
	RawResultPaths           []string       `json:"raw_result_paths,omitempty"`
	Items                    []itemSummary  `json:"items,omitempty"`
	ItemCount                int            `json:"item_count"`
	PackagedItemCount        int            `json:"packaged_item_count"`
	LibraryItemCount         int            `json:"library_item_count"`
	AIFallbackItemCount      int            `json:"ai_fallback_item_count"`
	UserContextItemCount     int            `json:"user_context_item_count"`
	PackagedMatchedCount     int            `json:"packaged_matched_count"`
	UnresolvedLikeCount      int            `json:"unresolved_like_count"`
	MissingNutritionCount    int            `json:"missing_nutrition_count"`
	SuggestRatioEnabled      *bool          `json:"suggest_ratio_enabled,omitempty"`
	SuggestRatioStatus       string         `json:"suggest_ratio_status,omitempty"`
	SuggestRatioAppliedCount int            `json:"suggest_ratio_applied_count,omitempty"`
	GateErrors               []string       `json:"gate_errors,omitempty"`
	Correction               *runResult     `json:"correction,omitempty"`
	Result                   map[string]any `json:"-"`
}

type itemSummary struct {
	Index                int     `json:"index"`
	Name                 string  `json:"name"`
	Type                 string  `json:"type,omitempty"`
	WeightG              float64 `json:"weight_g,omitempty"`
	Calories             float64 `json:"calories,omitempty"`
	NutritionSource      string  `json:"nutrition_source,omitempty"`
	MatchedFoodID        string  `json:"matched_food_id,omitempty"`
	PackageWeightSource  string  `json:"package_weight_source,omitempty"`
	PackageWeightApplied bool    `json:"package_weight_applied,omitempty"`
	PackageWeightReason  string  `json:"package_weight_reason,omitempty"`
	PackagedFoodID       string  `json:"packaged_food_id,omitempty"`
	PackagedCandidateCnt int     `json:"packaged_candidate_count,omitempty"`
	SuggestedRatio       float64 `json:"suggested_ratio,omitempty"`
	SuggestedRatioSource string  `json:"suggested_ratio_source,omitempty"`
	HasNutrition         bool    `json:"has_nutrition"`
}

func main() {
	var caseSpecs stringListFlag
	var imageRefs stringListFlag
	var imageURLRefs stringListFlag
	var expectSpecs rawListFlag

	suitePath := flag.String("suite", "", "JSON suite file with modes, cases and per-case expectations")
	baseURL := flag.String("base-url", envString("FOOD_ANALYSIS_GRAY_BASE_URL", "http://127.0.0.1:3010"), "backend base URL")
	configDir := flag.String("config-dir", ".", "directory containing backend config, used only when issuing a token from --user-id")
	token := flag.String("token", envString("FOOD_ANALYSIS_GRAY_TOKEN", ""), "JWT token; may also be set by FOOD_ANALYSIS_GRAY_TOKEN")
	userID := flag.String("user-id", envString("FOOD_ANALYSIS_GRAY_USER_ID", ""), "existing user id used to issue a local JWT when --token is empty; use latest/auto to read the newest user id from the configured DB")
	modes := flag.String("modes", strings.Join(defaultGrayModes, ","), "comma-separated execution modes to verify")
	outputDir := flag.String("output-dir", "", "directory for summary.json/items.csv/raw task JSON files")
	mealType := flag.String("meal-type", "lunch", "meal_type submitted to /api/analyze/submit")
	additionalContext := flag.String("additional-context", "gray verify mixed normal food and packaged snack recognition", "additionalContext submitted to /api/analyze/submit")
	suggestRatio := flag.Bool("suggest-ratio", true, "submit suggest_ratio_enabled=true")
	pollInterval := flag.Duration("poll-interval", 1*time.Second, "poll interval for task status")
	taskTimeout := flag.Duration("task-timeout", 8*time.Minute, "timeout per task")
	requestTimeout := flag.Duration("request-timeout", 45*time.Second, "HTTP request timeout")
	failOnIssue := flag.Bool("fail-on-issue", false, "exit non-zero when any done result has unresolved/missing nutrition items")
	requireDone := flag.Bool("require-done", false, "fail unless every run reaches done status")
	requireMixed := flag.Bool("require-mixed", false, "fail unless every done run has at least one packaged item and one non-packaged item")
	minItems := flag.Int("min-items", 0, "fail unless every done run has at least this many items")
	minPackagedItems := flag.Int("min-packaged-items", 0, "fail unless every done run has at least this many packaged items")
	minNonPackagedItems := flag.Int("min-non-packaged-items", 0, "fail unless every done run has at least this many non-packaged items")
	minAIFallbackItems := flag.Int("min-ai-fallback-items", 0, "fail unless every done run has at least this many AI fallback items")
	maxPackagedItems := flag.Int("max-packaged-items", -1, "fail unless every done run has at most this many packaged items; -1 disables")
	maxUnresolvedLike := flag.Int("max-unresolved-like-items", -1, "fail unless every done run has at most this many unresolved-like items; -1 disables")
	maxMissingNutrition := flag.Int("max-missing-nutrition-items", -1, "fail unless every done run has at most this many missing-nutrition items; -1 disables")
	requireAIRatio := flag.Bool("require-ai-ratio", false, "fail unless every item in every done run has suggested ratio metadata")
	requirePackageAnchor := flag.Bool("require-packaged-weight-anchor", false, "fail unless every packaged item in every done run uses packaged_food_library weight anchor")
	flag.Var(&caseSpecs, "case", "verification case in name=pathOrURL[,pathOrURL2] format; may be repeated")
	flag.Var(&imageRefs, "image", "local image path; may be repeated, grouped as one default case when --case is not set")
	flag.Var(&imageURLRefs, "image-url", "already uploaded image URL; may be repeated, grouped as one default case when --case is not set")
	flag.Var(&expectSpecs, "expect", "case-specific gate in case:key=value,key=value format; keys include require_done, require_mixed, min_items, min_packaged, min_non_packaged, min_ai_fallback, max_packaged, max_unresolved, max_missing_nutrition, require_ai_ratio, require_package_anchor, name_contains, packaged_name_contains, non_packaged_name_contains; may be repeated")
	flag.Parse()

	visited := visitedFlags()
	suite, suiteErr := loadGraySuite(strings.TrimSpace(*suitePath))
	expectations, expectationErrors := parseExpectationSpecs(expectSpecs)
	cfg := grayConfig{
		BaseURL:              strings.TrimRight(strings.TrimSpace(*baseURL), "/"),
		ConfigDir:            strings.TrimSpace(*configDir),
		Token:                strings.TrimSpace(*token),
		UserID:               strings.TrimSpace(*userID),
		Modes:                normalizeModes(*modes),
		Cases:                buildCases(caseSpecs, imageRefs, imageURLRefs),
		OutputDir:            strings.TrimSpace(*outputDir),
		MealType:             strings.TrimSpace(*mealType),
		AdditionalContext:    strings.TrimSpace(*additionalContext),
		SuggestRatioEnabled:  *suggestRatio,
		PollInterval:         *pollInterval,
		TaskTimeout:          *taskTimeout,
		RequestTimeout:       *requestTimeout,
		FailOnIssue:          *failOnIssue,
		RequireDone:          *requireDone,
		RequireMixed:         *requireMixed,
		MinItems:             *minItems,
		MinPackagedItems:     *minPackagedItems,
		MinNonPackagedItems:  *minNonPackagedItems,
		MinAIFallbackItems:   *minAIFallbackItems,
		MaxPackagedItems:     *maxPackagedItems,
		MaxUnresolvedLike:    *maxUnresolvedLike,
		MaxMissingNutrition:  *maxMissingNutrition,
		RequireAIRatio:       *requireAIRatio,
		RequirePackageAnchor: *requirePackageAnchor,
		Expectations:         expectations,
		ExpectationErrors:    expectationErrors,
	}
	if suiteErr != nil {
		cfg.ExpectationErrors = append(cfg.ExpectationErrors, suiteErr.Error())
	}
	applySuiteDefaults(&cfg, suite, visited, len(caseSpecs) > 0 || len(imageRefs) > 0 || len(imageURLRefs) > 0, len(expectSpecs) > 0)
	cfg.applyShorthands()
	if err := cfg.validate(); err != nil {
		log.Fatal(err)
	}
	if cfg.OutputDir == "" {
		cfg.OutputDir = filepath.Join("..", "tmp", fmt.Sprintf("food-analysis-gray-verify-%s", time.Now().Format("20060102-150405")))
	}
	if err := os.MkdirAll(cfg.OutputDir, 0o755); err != nil {
		log.Fatalf("create output dir: %v", err)
	}
	ctx := context.Background()
	if cfg.Token == "" {
		tokenUserID := cfg.UserID
		if isAutoUserID(tokenUserID) {
			resolved, err := resolveLatestUserID(ctx, cfg.ConfigDir)
			if err != nil {
				log.Fatalf("resolve latest user id: %v", err)
			}
			tokenUserID = resolved
			cfg.UserID = resolved
			fmt.Printf("resolved --user-id latest to %s\n", tokenUserID)
		}
		issued, err := issueLocalToken(cfg.ConfigDir, tokenUserID)
		if err != nil {
			log.Fatalf("issue token from --user-id: %v", err)
		}
		cfg.Token = issued
	}

	client := &http.Client{Timeout: cfg.RequestTimeout}
	summary := verifySummary{
		StartedAt: time.Now(),
		BaseURL:   cfg.BaseURL,
		Modes:     cfg.Modes,
		OutputDir: cfg.OutputDir,
		Counts:    map[string]int{},
	}

	for _, c := range cfg.Cases {
		caseResult := runCase(ctx, client, cfg, c)
		summary.Cases = append(summary.Cases, caseResult)
		for _, run := range caseResult.Runs {
			addRunCounts(summary.Counts, run, false)
		}
	}
	summary.FinishedAt = time.Now()
	applyGateResults(&summary, cfg)

	if err := writeSummaryFiles(cfg.OutputDir, summary); err != nil {
		log.Fatalf("write summary files: %v", err)
	}
	fmt.Printf("gray verification complete: output_dir=%s runs=%d packaged_items=%d unresolved_like_items=%d missing_nutrition_items=%d\n",
		cfg.OutputDir,
		summary.Counts["runs"],
		summary.Counts["packaged_items"],
		summary.Counts["unresolved_like_items"],
		summary.Counts["missing_nutrition_items"],
	)
	if summary.Counts["gate_failures"] > 0 {
		fmt.Printf("gray verification gate failures: %d\n", summary.Counts["gate_failures"])
	}
	if shouldFail(summary, cfg.FailOnIssue) {
		os.Exit(1)
	}
}

func (cfg *grayConfig) applyShorthands() {
	gate := cfg.globalGate()
	gate.applyShorthands()
	cfg.RequireMixed = gate.RequireMixed
	cfg.MinItems = gate.MinItems
	cfg.MinPackagedItems = gate.MinPackagedItems
	cfg.MinNonPackagedItems = gate.MinNonPackagedItems
	if gate.MaxPackagedItems == nil {
		cfg.MaxPackagedItems = -1
	} else {
		cfg.MaxPackagedItems = *gate.MaxPackagedItems
	}
	for name, expectation := range cfg.Expectations {
		expectation.applyShorthands()
		cfg.Expectations[name] = expectation
	}
}

func addRunCounts(counts map[string]int, run runResult, isCorrection bool) {
	if counts == nil {
		return
	}
	prefix := ""
	if isCorrection {
		prefix = "correction_"
		counts["correction_runs"]++
	} else {
		counts["runs"]++
	}
	counts[prefix+"status_"+run.Status]++
	if run.Error != "" {
		counts[prefix+"errors"]++
		counts["errors"]++
	}
	counts[prefix+"items"] += run.ItemCount
	counts[prefix+"packaged_items"] += run.PackagedItemCount
	counts[prefix+"library_items"] += run.LibraryItemCount
	counts[prefix+"ai_fallback_items"] += run.AIFallbackItemCount
	counts[prefix+"user_context_items"] += run.UserContextItemCount
	counts[prefix+"unresolved_like_items"] += run.UnresolvedLikeCount
	counts[prefix+"missing_nutrition_items"] += run.MissingNutritionCount
	if run.Correction != nil {
		addRunCounts(counts, *run.Correction, true)
	}
}

func (cfg grayConfig) validate() error {
	if cfg.BaseURL == "" {
		return errors.New("--base-url is required")
	}
	if len(cfg.Modes) == 0 {
		return errors.New("--modes must include at least one mode")
	}
	if len(cfg.Cases) == 0 {
		return errors.New("provide at least one --case, --image, or --image-url")
	}
	if cfg.Token == "" && cfg.UserID == "" {
		return errors.New("provide --token/FOOD_ANALYSIS_GRAY_TOKEN or --user-id/FOOD_ANALYSIS_GRAY_USER_ID")
	}
	if cfg.PollInterval <= 0 {
		return errors.New("--poll-interval must be positive")
	}
	if cfg.TaskTimeout <= 0 {
		return errors.New("--task-timeout must be positive")
	}
	if cfg.RequestTimeout <= 0 {
		return errors.New("--request-timeout must be positive")
	}
	if cfg.MinItems < 0 || cfg.MinPackagedItems < 0 || cfg.MinNonPackagedItems < 0 || cfg.MinAIFallbackItems < 0 {
		return errors.New("--min-items, --min-packaged-items, --min-non-packaged-items and --min-ai-fallback-items must be non-negative")
	}
	if cfg.MaxPackagedItems < -1 || cfg.MaxUnresolvedLike < -1 || cfg.MaxMissingNutrition < -1 {
		return errors.New("--max-packaged-items, --max-unresolved-like-items and --max-missing-nutrition-items must be -1 or greater")
	}
	if len(cfg.ExpectationErrors) > 0 {
		return fmt.Errorf("invalid --expect: %s", strings.Join(cfg.ExpectationErrors, "; "))
	}
	caseNames := map[string]struct{}{}
	for _, c := range cfg.Cases {
		if len(c.Refs) == 0 {
			return fmt.Errorf("case %q has no image refs", c.Name)
		}
		if len(c.Refs) > 3 {
			return fmt.Errorf("case %q has %d image refs; max is 3", c.Name, len(c.Refs))
		}
		caseNames[sanitizeName(c.Name)] = struct{}{}
	}
	for name := range cfg.Expectations {
		if _, ok := caseNames[name]; !ok {
			return fmt.Errorf("--expect references unknown case %q", name)
		}
	}
	return nil
}

func visitedFlags() map[string]bool {
	out := map[string]bool{}
	flag.Visit(func(f *flag.Flag) {
		out[f.Name] = true
	})
	return out
}

func loadGraySuite(path string) (graySuiteFile, error) {
	if strings.TrimSpace(path) == "" {
		return graySuiteFile{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return graySuiteFile{}, fmt.Errorf("read suite %s: %w", path, err)
	}
	var suite graySuiteFile
	if err := json.Unmarshal(data, &suite); err != nil {
		return graySuiteFile{}, fmt.Errorf("parse suite %s: %w", path, err)
	}
	return suite, nil
}

func applySuiteDefaults(cfg *grayConfig, suite graySuiteFile, visited map[string]bool, hasCLICases bool, hasCLIExpectations bool) {
	if cfg == nil {
		return
	}
	if suite.BaseURL != "" && !visited["base-url"] {
		cfg.BaseURL = strings.TrimRight(strings.TrimSpace(suite.BaseURL), "/")
	}
	if len(suite.Modes) > 0 && !visited["modes"] {
		cfg.Modes = normalizeModes(strings.Join(suite.Modes, ","))
	}
	if len(suite.Cases) > 0 && !hasCLICases {
		cfg.Cases = suiteVerifyCases(suite)
	}
	if suite.OutputDir != "" && !visited["output-dir"] {
		cfg.OutputDir = strings.TrimSpace(suite.OutputDir)
	}
	if suite.MealType != "" && !visited["meal-type"] {
		cfg.MealType = strings.TrimSpace(suite.MealType)
	}
	if suite.AdditionalContext != "" && !visited["additional-context"] {
		cfg.AdditionalContext = strings.TrimSpace(suite.AdditionalContext)
	}
	if suite.SuggestRatioEnabled != nil && !visited["suggest-ratio"] {
		cfg.SuggestRatioEnabled = *suite.SuggestRatioEnabled
	}
	if suite.FailOnIssue != nil && !visited["fail-on-issue"] {
		cfg.FailOnIssue = *suite.FailOnIssue
	}
	if suite.GlobalGate != nil {
		gate := mergeGateConfig(*suite.GlobalGate, cfg.globalGate())
		// Explicit command-line gates should keep taking precedence, but absent
		// flags can still inherit stricter suite defaults.
		if !visited["require-done"] {
			cfg.RequireDone = gate.RequireDone
		}
		if !visited["require-mixed"] {
			cfg.RequireMixed = gate.RequireMixed
		}
		if !visited["min-items"] {
			cfg.MinItems = gate.MinItems
		}
		if !visited["min-packaged-items"] {
			cfg.MinPackagedItems = gate.MinPackagedItems
		}
		if !visited["min-non-packaged-items"] {
			cfg.MinNonPackagedItems = gate.MinNonPackagedItems
		}
		if !visited["min-ai-fallback-items"] {
			cfg.MinAIFallbackItems = gate.MinAIFallbackItems
		}
		if !visited["max-packaged-items"] {
			if gate.MaxPackagedItems == nil {
				cfg.MaxPackagedItems = -1
			} else {
				cfg.MaxPackagedItems = *gate.MaxPackagedItems
			}
		}
		if !visited["max-unresolved-like-items"] {
			cfg.MaxUnresolvedLike = gate.MaxUnresolvedLike
		}
		if !visited["max-missing-nutrition-items"] {
			cfg.MaxMissingNutrition = gate.MaxMissingNutrition
		}
		if !visited["require-ai-ratio"] {
			cfg.RequireAIRatio = gate.RequireAIRatio
		}
		if !visited["require-packaged-weight-anchor"] {
			cfg.RequirePackageAnchor = gate.RequirePackageAnchor
		}
	}
	if len(suite.Cases) > 0 || len(suite.Expectations) > 0 {
		suiteExpectations := suiteExpectations(suite)
		if hasCLIExpectations {
			cfg.Expectations = mergeExpectationMaps(suiteExpectations, cfg.Expectations)
		} else {
			cfg.Expectations = mergeExpectationMaps(cfg.Expectations, suiteExpectations)
		}
	}
}

func suiteVerifyCases(suite graySuiteFile) []verifyCase {
	out := make([]verifyCase, 0, len(suite.Cases))
	for _, c := range suite.Cases {
		name := sanitizeName(c.Name)
		if name == "case" && len(c.Refs) > 0 {
			name = caseNameFromRef(c.Refs[0])
		}
		out = append(out, verifyCase{Name: name, Refs: append([]string{}, c.Refs...), AdditionalContext: strings.TrimSpace(c.AdditionalContext), Correction: cloneCorrectionSpec(c.Correction)})
	}
	return out
}

func cloneCorrectionSpec(in *correctionSpec) *correctionSpec {
	if in == nil {
		return nil
	}
	out := &correctionSpec{
		AdditionalContext: in.AdditionalContext,
		Items:             make([]map[string]any, 0, len(in.Items)),
		Expect:            in.Expect,
	}
	for _, item := range in.Items {
		next := map[string]any{}
		for key, value := range item {
			next[key] = value
		}
		out.Items = append(out.Items, next)
	}
	return out
}

func suiteExpectations(suite graySuiteFile) map[string]gateConfig {
	out := map[string]gateConfig{}
	for name, gate := range suite.Expectations {
		name = sanitizeName(name)
		if name == "" {
			continue
		}
		base := defaultGateConfig()
		if existing, ok := out[name]; ok {
			base = existing
		}
		out[name] = mergeGateConfig(base, gate)
	}
	for _, c := range suite.Cases {
		name := sanitizeName(c.Name)
		if name == "case" && len(c.Refs) > 0 {
			name = caseNameFromRef(c.Refs[0])
		}
		if name == "" || c.Expect == nil || !hasGateRules(*c.Expect) {
			continue
		}
		base := defaultGateConfig()
		if existing, ok := out[name]; ok {
			base = existing
		}
		out[name] = mergeGateConfig(base, *c.Expect)
	}
	return out
}

func mergeExpectationMaps(base, override map[string]gateConfig) map[string]gateConfig {
	out := map[string]gateConfig{}
	for name, gate := range base {
		out[sanitizeName(name)] = mergeGateConfig(defaultGateConfig(), gate)
	}
	for name, gate := range override {
		name = sanitizeName(name)
		base := defaultGateConfig()
		if existing, ok := out[name]; ok {
			base = existing
		}
		out[name] = mergeGateConfig(base, gate)
	}
	return out
}

func hasGateRules(gate gateConfig) bool {
	return gate.RequireDone ||
		gate.RequireMixed ||
		gate.MinItems > 0 ||
		gate.MinPackagedItems > 0 ||
		gate.MinNonPackagedItems > 0 ||
		gate.MinAIFallbackItems > 0 ||
		gate.MaxPackagedItems != nil ||
		gate.MaxUnresolvedLike >= 0 ||
		gate.MaxMissingNutrition >= 0 ||
		gate.RequireAIRatio ||
		gate.RequirePackageAnchor ||
		len(gate.NameContains) > 0 ||
		len(gate.PackagedNameContains) > 0 ||
		len(gate.NonPackagedNameContains) > 0 ||
		len(gate.ItemExpectations) > 0
}

func (cfg grayConfig) globalGate() gateConfig {
	gate := gateConfig{
		RequireDone:          cfg.RequireDone,
		RequireMixed:         cfg.RequireMixed,
		MinItems:             cfg.MinItems,
		MinPackagedItems:     cfg.MinPackagedItems,
		MinNonPackagedItems:  cfg.MinNonPackagedItems,
		MinAIFallbackItems:   cfg.MinAIFallbackItems,
		MaxUnresolvedLike:    cfg.MaxUnresolvedLike,
		MaxMissingNutrition:  cfg.MaxMissingNutrition,
		RequireAIRatio:       cfg.RequireAIRatio,
		RequirePackageAnchor: cfg.RequirePackageAnchor,
	}
	if cfg.MaxPackagedItems >= 0 {
		value := cfg.MaxPackagedItems
		gate.MaxPackagedItems = &value
	}
	return gate
}

func (cfg grayConfig) gateForCase(caseName string) gateConfig {
	gate := cfg.globalGate()
	if expectation, ok := cfg.Expectations[sanitizeName(caseName)]; ok {
		gate = mergeGateConfig(gate, expectation)
	}
	gate.applyShorthands()
	return gate
}

func (g *gateConfig) applyShorthands() {
	if !g.RequireMixed {
		return
	}
	if g.MinItems < 2 {
		g.MinItems = 2
	}
	if g.MinPackagedItems < 1 {
		g.MinPackagedItems = 1
	}
	if g.MinNonPackagedItems < 1 {
		g.MinNonPackagedItems = 1
	}
}

func mergeGateConfig(base, override gateConfig) gateConfig {
	out := base
	out.RequireDone = out.RequireDone || override.RequireDone
	out.RequireMixed = out.RequireMixed || override.RequireMixed
	out.RequireAIRatio = out.RequireAIRatio || override.RequireAIRatio
	out.RequirePackageAnchor = out.RequirePackageAnchor || override.RequirePackageAnchor
	if override.MinItems > out.MinItems {
		out.MinItems = override.MinItems
	}
	if override.MinPackagedItems > out.MinPackagedItems {
		out.MinPackagedItems = override.MinPackagedItems
	}
	if override.MinNonPackagedItems > out.MinNonPackagedItems {
		out.MinNonPackagedItems = override.MinNonPackagedItems
	}
	if override.MinAIFallbackItems > out.MinAIFallbackItems {
		out.MinAIFallbackItems = override.MinAIFallbackItems
	}
	if override.MaxPackagedItems != nil {
		if out.MaxPackagedItems == nil || *override.MaxPackagedItems < *out.MaxPackagedItems {
			value := *override.MaxPackagedItems
			out.MaxPackagedItems = &value
		}
	}
	if override.MaxUnresolvedLike >= 0 && (out.MaxUnresolvedLike < 0 || override.MaxUnresolvedLike < out.MaxUnresolvedLike) {
		out.MaxUnresolvedLike = override.MaxUnresolvedLike
	}
	if override.MaxMissingNutrition >= 0 && (out.MaxMissingNutrition < 0 || override.MaxMissingNutrition < out.MaxMissingNutrition) {
		out.MaxMissingNutrition = override.MaxMissingNutrition
	}
	out.NameContains = appendUniqueStrings(out.NameContains, override.NameContains...)
	out.PackagedNameContains = appendUniqueStrings(out.PackagedNameContains, override.PackagedNameContains...)
	out.NonPackagedNameContains = appendUniqueStrings(out.NonPackagedNameContains, override.NonPackagedNameContains...)
	out.ItemExpectations = append(out.ItemExpectations, override.ItemExpectations...)
	return out
}

func appendUniqueStrings(base []string, values ...string) []string {
	out := append([]string{}, base...)
	seen := map[string]struct{}{}
	for _, value := range out {
		seen[strings.ToLower(strings.TrimSpace(value))] = struct{}{}
	}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	return out
}

func stringInList(value string, choices []string) bool {
	value = strings.TrimSpace(value)
	for _, choice := range choices {
		if value == strings.TrimSpace(choice) {
			return true
		}
	}
	return false
}

func parseExpectationSpecs(specs []string) (map[string]gateConfig, []string) {
	out := map[string]gateConfig{}
	errs := []string{}
	for _, spec := range specs {
		caseName, gate, err := parseExpectationSpec(spec)
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		if existing, ok := out[caseName]; ok {
			gate = mergeGateConfig(existing, gate)
		}
		out[caseName] = gate
	}
	return out, errs
}

func parseExpectationSpec(spec string) (string, gateConfig, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return "", gateConfig{}, errors.New("empty expectation")
	}
	name, rules, ok := strings.Cut(spec, ":")
	if !ok {
		return "", gateConfig{}, fmt.Errorf("%q must use case:key=value format", spec)
	}
	caseName := sanitizeName(name)
	if caseName == "" {
		return "", gateConfig{}, fmt.Errorf("%q has empty case name", spec)
	}
	gate := defaultGateConfig()
	for _, rawRule := range splitCSV(rules) {
		key, value, hasValue := strings.Cut(rawRule, "=")
		key = normalizeExpectationKey(key)
		value = strings.TrimSpace(value)
		if key == "" {
			continue
		}
		boolValue := true
		if hasValue {
			parsed, err := strconv.ParseBool(value)
			if err == nil {
				boolValue = parsed
			}
		}
		switch key {
		case "require_done":
			gate.RequireDone = boolValue
		case "require_mixed":
			gate.RequireMixed = boolValue
		case "require_ai_ratio":
			gate.RequireAIRatio = boolValue
		case "require_package_anchor":
			gate.RequirePackageAnchor = boolValue
		case "min_items":
			n, err := parseNonNegativeExpectationInt(key, value, hasValue)
			if err != nil {
				return "", gateConfig{}, err
			}
			gate.MinItems = n
		case "min_packaged":
			n, err := parseNonNegativeExpectationInt(key, value, hasValue)
			if err != nil {
				return "", gateConfig{}, err
			}
			gate.MinPackagedItems = n
		case "min_non_packaged":
			n, err := parseNonNegativeExpectationInt(key, value, hasValue)
			if err != nil {
				return "", gateConfig{}, err
			}
			gate.MinNonPackagedItems = n
		case "min_ai_fallback":
			n, err := parseNonNegativeExpectationInt(key, value, hasValue)
			if err != nil {
				return "", gateConfig{}, err
			}
			gate.MinAIFallbackItems = n
		case "max_packaged":
			n, err := parseNonNegativeExpectationInt(key, value, hasValue)
			if err != nil {
				return "", gateConfig{}, err
			}
			gate.MaxPackagedItems = &n
		case "max_unresolved":
			n, err := parseNonNegativeExpectationInt(key, value, hasValue)
			if err != nil {
				return "", gateConfig{}, err
			}
			gate.MaxUnresolvedLike = n
		case "max_missing_nutrition":
			n, err := parseNonNegativeExpectationInt(key, value, hasValue)
			if err != nil {
				return "", gateConfig{}, err
			}
			gate.MaxMissingNutrition = n
		case "name_contains":
			text, err := parseExpectationString(key, value, hasValue)
			if err != nil {
				return "", gateConfig{}, err
			}
			gate.NameContains = appendUniqueStrings(gate.NameContains, text)
		case "packaged_name_contains":
			text, err := parseExpectationString(key, value, hasValue)
			if err != nil {
				return "", gateConfig{}, err
			}
			gate.PackagedNameContains = appendUniqueStrings(gate.PackagedNameContains, text)
		case "non_packaged_name_contains":
			text, err := parseExpectationString(key, value, hasValue)
			if err != nil {
				return "", gateConfig{}, err
			}
			gate.NonPackagedNameContains = appendUniqueStrings(gate.NonPackagedNameContains, text)
		default:
			return "", gateConfig{}, fmt.Errorf("unknown expectation key %q in %q", key, spec)
		}
	}
	gate.applyShorthands()
	return caseName, gate, nil
}

func normalizeExpectationKey(key string) string {
	key = strings.ToLower(strings.TrimSpace(key))
	key = strings.ReplaceAll(key, "-", "_")
	switch key {
	case "done":
		return "require_done"
	case "mixed":
		return "require_mixed"
	case "ai_ratio":
		return "require_ai_ratio"
	case "package_anchor", "packaged_weight_anchor", "package_weight_anchor":
		return "require_package_anchor"
	case "min_packaged_items":
		return "min_packaged"
	case "min_non_packaged_items":
		return "min_non_packaged"
	case "min_ai_fallback_items", "min_ai_items":
		return "min_ai_fallback"
	case "max_packaged_items":
		return "max_packaged"
	case "max_unresolved_like", "max_unresolved_like_items":
		return "max_unresolved"
	case "max_missing", "max_missing_nutrition_items":
		return "max_missing_nutrition"
	case "name", "item_name", "item_name_contains":
		return "name_contains"
	case "packaged_name", "packaged_item_name", "packaged_item_name_contains":
		return "packaged_name_contains"
	case "non_packaged_name", "normal_name", "normal_item_name", "non_packaged_item_name_contains":
		return "non_packaged_name_contains"
	default:
		return key
	}
}

func parseNonNegativeExpectationInt(key, value string, hasValue bool) (int, error) {
	if !hasValue {
		return 0, fmt.Errorf("%s requires a numeric value", key)
	}
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || n < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer", key)
	}
	return n, nil
}

func parseExpectationString(key, value string, hasValue bool) (string, error) {
	if !hasValue {
		return "", fmt.Errorf("%s requires a value", key)
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("%s requires a non-empty value", key)
	}
	return value, nil
}

func buildCases(caseSpecs, imageRefs, imageURLRefs []string) []verifyCase {
	if len(caseSpecs) > 0 {
		out := make([]verifyCase, 0, len(caseSpecs))
		for _, spec := range caseSpecs {
			if c, ok := parseCaseSpec(spec); ok {
				out = append(out, c)
			}
		}
		return out
	}
	refs := append([]string{}, imageRefs...)
	refs = append(refs, imageURLRefs...)
	if len(refs) == 0 {
		return nil
	}
	name := "mixed"
	if len(refs) == 1 {
		name = caseNameFromRef(refs[0])
	}
	return []verifyCase{{Name: name, Refs: refs}}
}

func parseCaseSpec(spec string) (verifyCase, bool) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return verifyCase{}, false
	}
	name := ""
	refsPart := spec
	if before, after, ok := strings.Cut(spec, "="); ok {
		name = strings.TrimSpace(before)
		refsPart = strings.TrimSpace(after)
	}
	refs := splitCSV(refsPart)
	if len(refs) == 0 {
		return verifyCase{}, false
	}
	if name == "" {
		name = caseNameFromRef(refs[0])
	}
	return verifyCase{Name: sanitizeName(name), Refs: refs}, true
}

func normalizeModes(raw string) []string {
	parts := splitCSV(raw)
	if len(parts) == 0 {
		return append([]string{}, defaultGrayModes...)
	}
	out := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, mode := range parts {
		mode = strings.ToLower(strings.TrimSpace(mode))
		if mode == "" {
			continue
		}
		if _, ok := seen[mode]; ok {
			continue
		}
		seen[mode] = struct{}{}
		out = append(out, mode)
	}
	return out
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func runCase(ctx context.Context, client *http.Client, cfg grayConfig, c verifyCase) verifyCaseResult {
	caseResult := verifyCaseResult{Name: c.Name, Refs: c.Refs}
	for _, ref := range c.Refs {
		imageURL, err := ensureImageURL(ctx, client, cfg, ref)
		if err != nil {
			caseResult.UploadErrors = append(caseResult.UploadErrors, fmt.Sprintf("%s: %v", ref, err))
			continue
		}
		caseResult.ImageURLs = append(caseResult.ImageURLs, imageURL)
	}
	if len(caseResult.ImageURLs) == 0 {
		for _, mode := range cfg.Modes {
			caseResult.Runs = append(caseResult.Runs, runResult{
				CaseName: c.Name,
				Mode:     mode,
				Status:   "upload_failed",
				Error:    strings.Join(caseResult.UploadErrors, "; "),
			})
		}
		return caseResult
	}

	for _, mode := range cfg.Modes {
		caseResult.Runs = append(caseResult.Runs, runMode(ctx, client, cfg, c, caseResult.ImageURLs, mode))
	}
	return caseResult
}

func runMode(ctx context.Context, client *http.Client, cfg grayConfig, c verifyCase, imageURLs []string, mode string) runResult {
	started := time.Now()
	run := runResult{CaseName: c.Name, Mode: mode, Status: "not_started"}

	submitStarted := time.Now()
	taskID, err := submitAnalyzeTask(ctx, client, cfg, imageURLs, mode, c.AdditionalContext)
	run.SubmitDurationMS = time.Since(submitStarted).Milliseconds()
	if err != nil {
		run.Status = "submit_failed"
		run.Error = err.Error()
		run.TotalDurationMS = time.Since(started).Milliseconds()
		return run
	}
	run.TaskID = taskID
	run = pollRun(ctx, client, cfg, c.Name, mode, taskID, started, run.SubmitDurationMS)
	if c.Correction != nil && run.Status == "done" && len(c.Correction.Items) > 0 {
		correctionStarted := time.Now()
		correctionTaskID, correctionErr := submitCorrectionTask(ctx, client, cfg, imageURLs, mode, run.FinalTaskID, run.TaskID, run.Result, c.Correction)
		correctionRun := runResult{
			CaseName: c.Name,
			Mode:     mode + "_correction",
			Status:   "not_started",
		}
		correctionRun.SubmitDurationMS = time.Since(correctionStarted).Milliseconds()
		if correctionErr != nil {
			correctionRun.Status = "submit_failed"
			correctionRun.Error = correctionErr.Error()
			correctionRun.TotalDurationMS = time.Since(correctionStarted).Milliseconds()
		} else {
			correctionRun.TaskID = correctionTaskID
			correctionRun = pollRun(ctx, client, cfg, c.Name, mode+"_correction", correctionTaskID, correctionStarted, correctionRun.SubmitDurationMS)
			if c.Correction.Expect != nil {
				correctionRun.GateErrors = append(correctionRun.GateErrors, runGateIssuesForGate(correctionRun, *c.Correction.Expect)...)
			}
		}
		run.Correction = &correctionRun
	}
	return run
}

func pollRun(ctx context.Context, client *http.Client, cfg grayConfig, caseName, mode, taskID string, started time.Time, submitDurationMS int64) runResult {
	run := runResult{CaseName: caseName, Mode: mode, TaskID: taskID, Status: "not_started", SubmitDurationMS: submitDurationMS}
	waitStarted := time.Now()
	task, err := pollAnalyzeTask(ctx, client, cfg, taskID)
	run.WaitDurationMS = time.Since(waitStarted).Milliseconds()
	run.TotalDurationMS = time.Since(started).Milliseconds()
	if err != nil {
		run.Status = "poll_failed"
		run.Error = err.Error()
		return run
	}
	finalTask := task
	seenTasks := map[string]struct{}{taskID: {}}
	for depth := 0; depth < 10; depth++ {
		rawPath, rawErr := writeRawTask(cfg.OutputDir, caseName, mode, finalTask.ID, finalTask)
		if rawErr != nil {
			run.Error = joinErrors(run.Error, rawErr.Error())
		} else {
			run.RawResultPath = rawPath
			run.RawResultPaths = append(run.RawResultPaths, rawPath)
		}
		redirectID := redirectTaskID(finalTask.Result)
		if redirectID == "" {
			break
		}
		if _, ok := seenTasks[redirectID]; ok {
			run.Error = joinErrors(run.Error, fmt.Sprintf("redirect task loop detected at %s", redirectID))
			break
		}
		seenTasks[redirectID] = struct{}{}
		run.FollowedTaskIDs = append(run.FollowedTaskIDs, redirectID)
		nextTask, followErr := pollAnalyzeTask(ctx, client, cfg, redirectID)
		if followErr != nil {
			run.Status = "poll_failed"
			run.Error = joinErrors(run.Error, fmt.Sprintf("poll redirect task %s: %v", redirectID, followErr))
			return run
		}
		finalTask = nextTask
	}
	run.FinalTaskID = finalTask.ID
	run.Status = finalTask.Status
	if finalTask.ErrorMessage != "" {
		run.Error = joinErrors(run.Error, finalTask.ErrorMessage)
	}
	if finalTask.Status == "done" {
		run.Result = finalTask.Result
		applyResultSummary(&run, finalTask.Result)
	}
	return run
}

func redirectTaskID(result map[string]any) string {
	if len(result) == 0 {
		return ""
	}
	for _, key := range []string{"redirectTaskId", "redirect_task_id", "nextTaskId", "next_task_id"} {
		value := strings.TrimSpace(fmt.Sprint(result[key]))
		if value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}

func ensureImageURL(ctx context.Context, client *http.Client, cfg grayConfig, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", errors.New("empty image ref")
	}
	if isRemoteURL(ref) {
		return ref, nil
	}
	return uploadAnalyzeImageFile(ctx, client, cfg, ref)
}

func uploadAnalyzeImageFile(ctx context.Context, client *http.Client, cfg grayConfig, path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{
		"name":     "file",
		"filename": filepath.Base(path),
	}))
	header.Set("Content-Type", imageContentType(path))
	part, err := writer.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.BaseURL+"/api/upload-analyze-image-file", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	setBearer(req, cfg.Token)

	var payload map[string]any
	if err := doJSON(client, req, &payload); err != nil {
		return "", err
	}
	for _, key := range []string{"imageUrl", "image_url", "url"} {
		value := strings.TrimSpace(fmt.Sprint(payload[key]))
		if value != "" && value != "<nil>" {
			return value, nil
		}
	}
	return "", fmt.Errorf("upload response missing imageUrl: %#v", payload)
}

func submitAnalyzeTask(ctx context.Context, client *http.Client, cfg grayConfig, imageURLs []string, mode string, caseAdditionalContext string) (string, error) {
	additionalContext := strings.TrimSpace(caseAdditionalContext)
	if additionalContext == "" {
		additionalContext = cfg.AdditionalContext
	}
	body := map[string]any{
		"image_url":               imageURLs[0],
		"image_urls":              imageURLs,
		"meal_type":               cfg.MealType,
		"execution_mode":          mode,
		"analysis_engine":         "db_first",
		"suggest_ratio_enabled":   cfg.SuggestRatioEnabled,
		"timezone_offset_minutes": -480,
		"additionalContext":       additionalContext,
		"is_multi_view":           len(imageURLs) > 1,
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.BaseURL+"/api/analyze/submit", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	setBearer(req, cfg.Token)

	var payload submitResponse
	if err := doJSON(client, req, &payload); err != nil {
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

func submitCorrectionTask(ctx context.Context, client *http.Client, cfg grayConfig, imageURLs []string, mode, sourceTaskID, rootTaskID string, previousResult map[string]any, correction *correctionSpec) (string, error) {
	if correction == nil || len(correction.Items) == 0 {
		return "", errors.New("correction has no items")
	}
	if len(imageURLs) == 0 {
		return "", errors.New("correction requires image urls")
	}
	additionalContext := strings.TrimSpace(correction.AdditionalContext)
	if additionalContext == "" {
		additionalContext = "gray verify correction after mixed packaged food recognition"
	}
	body := map[string]any{
		"image_url":                 imageURLs[0],
		"image_urls":                imageURLs,
		"meal_type":                 cfg.MealType,
		"execution_mode":            mode,
		"analysis_engine":           "db_first",
		"suggest_ratio_enabled":     cfg.SuggestRatioEnabled,
		"timezone_offset_minutes":   -480,
		"additionalContext":         additionalContext,
		"is_multi_view":             len(imageURLs) > 1,
		"is_correction":             true,
		"previousResult":            previousResult,
		"correctionItems":           correction.Items,
		"correction_source_task_id": sourceTaskID,
		"correction_root_task_id":   rootTaskID,
	}
	raw, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.BaseURL+"/api/analyze/submit", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	setBearer(req, cfg.Token)

	var payload submitResponse
	if err := doJSON(client, req, &payload); err != nil {
		return "", err
	}
	taskID := strings.TrimSpace(payload.TaskID)
	if taskID == "" {
		taskID = strings.TrimSpace(payload.TaskId)
	}
	if taskID == "" {
		return "", fmt.Errorf("correction submit response missing task_id: %#v", payload)
	}
	return taskID, nil
}

func pollAnalyzeTask(ctx context.Context, client *http.Client, cfg grayConfig, taskID string) (analysisTaskResponse, error) {
	deadline := time.Now().Add(cfg.TaskTimeout)
	for {
		task, err := getAnalyzeTask(ctx, client, cfg, taskID)
		if err != nil {
			return task, err
		}
		switch task.Status {
		case "done", "failed", "timed_out", "cancelled", "violated":
			return task, nil
		}
		if time.Now().After(deadline) {
			return task, fmt.Errorf("task did not finish within %s; last status=%s", cfg.TaskTimeout, task.Status)
		}
		select {
		case <-ctx.Done():
			return task, ctx.Err()
		case <-time.After(cfg.PollInterval):
		}
	}
}

func getAnalyzeTask(ctx context.Context, client *http.Client, cfg grayConfig, taskID string) (analysisTaskResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.BaseURL+"/api/analyze/tasks/"+url.PathEscape(taskID), nil)
	if err != nil {
		return analysisTaskResponse{}, err
	}
	setBearer(req, cfg.Token)

	var payload analysisTaskResponse
	if err := doJSON(client, req, &payload); err != nil {
		return analysisTaskResponse{}, err
	}
	return payload, nil
}

func doJSON(client *http.Client, req *http.Request, out any) error {
	resp, err := client.Do(req)
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

func applyResultSummary(run *runResult, result map[string]any) {
	run.PackagedMatchedCount = intFromAny(mapFromAny(result["packaged_food_resolution"])["matched_count"])
	run.SuggestRatioEnabled = firstBoolPtr(result, "suggest_ratio_enabled", "suggestRatioEnabled")
	run.SuggestRatioStatus = firstString(result, "suggest_ratio_status", "suggestRatioStatus")
	run.SuggestRatioAppliedCount = firstInt(result, "suggest_ratio_applied_count", "suggestRatioAppliedCount")
	items := buildItemSummaries(result)
	run.Items = items
	run.ItemCount = len(items)
	for _, item := range items {
		if item.NutritionSource == "packaged_food_library" || item.PackageWeightSource == "packaged_food_library" {
			run.PackagedItemCount++
		} else {
			switch item.NutritionSource {
			case "deepseek_generated", "ai_generated", "llm_generated":
				run.AIFallbackItemCount++
			case "user_correction_context":
				run.UserContextItemCount++
			default:
				if strings.Contains(item.NutritionSource, "library") {
					run.LibraryItemCount++
				}
			}
		}
		if isUnresolvedLike(item.NutritionSource) {
			run.UnresolvedLikeCount++
		}
		if !item.HasNutrition {
			run.MissingNutritionCount++
		}
	}
	if run.PackagedMatchedCount == 0 && run.PackagedItemCount > 0 {
		run.PackagedMatchedCount = run.PackagedItemCount
	}
}

func buildItemSummaries(result map[string]any) []itemSummary {
	rawItems := anySlice(result["items"])
	if len(rawItems) == 0 {
		rawItems = anySlice(result["nutritionItems"])
	}
	out := make([]itemSummary, 0, len(rawItems))
	for index, raw := range rawItems {
		item := mapFromAny(raw)
		if len(item) == 0 {
			continue
		}
		summary := itemSummary{
			Index:                index,
			Name:                 firstString(item, "name", "food_name", "display_name"),
			Type:                 firstString(item, "type", "food_type", "category"),
			WeightG:              firstFloat(item, "estimatedWeightGrams", "weight", "weightGrams", "grossWeightGrams"),
			Calories:             firstFloat(item, "calories", "kcal"),
			NutritionSource:      firstString(item, "nutrition_source", "nutritionSource", "source"),
			MatchedFoodID:        firstString(item, "matched_food_id", "matchedFoodId", "food_id"),
			PackageWeightSource:  firstString(item, "package_weight_source", "packageWeightSource"),
			PackageWeightApplied: firstBool(item, "package_weight_applied", "packageWeightApplied"),
			PackageWeightReason:  firstString(item, "package_weight_reason", "packageWeightReason"),
			PackagedFoodID:       firstString(item, "packaged_food_id", "packagedFoodId", "matched_packaged_food_id", "matchedPackagedFoodId"),
			PackagedCandidateCnt: packagedCandidateCount(item),
			SuggestedRatio:       firstFloat(item, "suggestedRatio", "suggested_ratio"),
			SuggestedRatioSource: firstString(item, "suggestedRatioSource", "suggested_ratio_source"),
		}
		if summary.Calories == 0 {
			summary.Calories = floatFromAny(mapFromAny(item["nutrients"])["calories"])
		}
		summary.HasNutrition = hasNutrition(item, summary.Calories)
		out = append(out, summary)
	}
	return out
}

func hasNutrition(item map[string]any, calories float64) bool {
	if calories > 0 {
		return true
	}
	nutrients := mapFromAny(item["nutrients"])
	for _, key := range []string{"calories", "protein", "carbs", "fat", "protein_g", "carbs_g", "fat_g"} {
		if floatFromAny(nutrients[key]) > 0 {
			return true
		}
	}
	for _, key := range []string{"protein", "carbs", "fat", "protein_g", "carbs_g", "fat_g"} {
		if floatFromAny(item[key]) > 0 {
			return true
		}
	}
	return hasExplicitZeroCoreNutrition(item, nutrients)
}

func hasExplicitZeroCoreNutrition(item map[string]any, nutrients map[string]any) bool {
	if isUnresolvedLike(firstString(item, "nutrition_source", "nutritionSource", "source")) {
		return false
	}
	return hasNonNegativeNutrientValue(item, nutrients, "calories", "kcal", "energy_kcal", "energyKcal") &&
		hasNonNegativeNutrientValue(item, nutrients, "protein", "protein_g", "proteinG", "proteinGrams") &&
		hasNonNegativeNutrientValue(item, nutrients, "carbs", "carb", "carbohydrate", "carbohydrates", "carbs_g", "carbsG", "carbsGrams") &&
		hasNonNegativeNutrientValue(item, nutrients, "fat", "fat_g", "fatG", "fatGrams")
}

func hasNonNegativeNutrientValue(item map[string]any, nutrients map[string]any, keys ...string) bool {
	for _, source := range []map[string]any{nutrients, item} {
		for _, key := range keys {
			value, ok := source[key]
			if !ok || value == nil {
				continue
			}
			parsed, ok := parseNumericValue(value)
			if ok && parsed >= 0 {
				return true
			}
		}
	}
	return false
}

func parseNumericValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		v, err := typed.Float64()
		return v, err == nil
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0, false
		}
		v, err := strconv.ParseFloat(trimmed, 64)
		return v, err == nil
	default:
		return 0, false
	}
}

func packagedCandidateCount(item map[string]any) int {
	for _, key := range []string{"packaged_candidates", "packagedCandidates", "packaged_food_candidates", "packagedFoodCandidates", "package_candidates", "packageCandidates"} {
		if candidates := anySlice(item[key]); len(candidates) > 0 {
			return len(candidates)
		}
	}
	return firstInt(item, "packaged_candidate_count", "packagedCandidateCount")
}

func isUnresolvedLike(source string) bool {
	source = strings.ToLower(strings.TrimSpace(source))
	return source == "" || source == "unresolved" || source == "ai_estimate" || source == "unknown"
}

func applyGateResults(summary *verifySummary, cfg grayConfig) {
	if summary == nil {
		return
	}
	for caseIndex := range summary.Cases {
		gate := cfg.gateForCase(summary.Cases[caseIndex].Name)
		for runIndex := range summary.Cases[caseIndex].Runs {
			run := &summary.Cases[caseIndex].Runs[runIndex]
			issues := runGateIssuesForGate(*run, gate)
			if len(issues) == 0 {
				continue
			}
			run.GateErrors = append(run.GateErrors, issues...)
			summary.Counts["gate_failures"] += len(issues)
			summary.Counts["gate_failed_runs"]++
		}
		for runIndex := range summary.Cases[caseIndex].Runs {
			correction := summary.Cases[caseIndex].Runs[runIndex].Correction
			if correction == nil || len(correction.GateErrors) == 0 {
				continue
			}
			summary.Counts["gate_failures"] += len(correction.GateErrors)
			summary.Counts["gate_failed_runs"]++
			summary.Counts["correction_gate_failures"] += len(correction.GateErrors)
		}
	}
}

func runGateIssues(run runResult, cfg grayConfig) []string {
	return runGateIssuesForGate(run, cfg.globalGate())
}

func runGateIssuesForGate(run runResult, gate gateConfig) []string {
	issues := []string{}
	if gate.RequireDone && run.Status != "done" {
		issues = append(issues, fmt.Sprintf("status=%s, want done", run.Status))
	}
	if run.Status != "done" {
		return issues
	}
	if gate.MinItems > 0 && run.ItemCount < gate.MinItems {
		issues = append(issues, fmt.Sprintf("item_count=%d, want >=%d", run.ItemCount, gate.MinItems))
	}
	if gate.MinPackagedItems > 0 && run.PackagedItemCount < gate.MinPackagedItems {
		issues = append(issues, fmt.Sprintf("packaged_item_count=%d, want >=%d", run.PackagedItemCount, gate.MinPackagedItems))
	}
	if gate.MaxPackagedItems != nil && run.PackagedItemCount > *gate.MaxPackagedItems {
		issues = append(issues, fmt.Sprintf("packaged_item_count=%d, want <=%d", run.PackagedItemCount, *gate.MaxPackagedItems))
	}
	nonPackagedCount := run.ItemCount - run.PackagedItemCount
	if gate.MinNonPackagedItems > 0 && nonPackagedCount < gate.MinNonPackagedItems {
		issues = append(issues, fmt.Sprintf("non_packaged_item_count=%d, want >=%d", nonPackagedCount, gate.MinNonPackagedItems))
	}
	if gate.MinAIFallbackItems > 0 && run.AIFallbackItemCount < gate.MinAIFallbackItems {
		issues = append(issues, fmt.Sprintf("ai_fallback_item_count=%d, want >=%d", run.AIFallbackItemCount, gate.MinAIFallbackItems))
	}
	if gate.MaxUnresolvedLike >= 0 && run.UnresolvedLikeCount > gate.MaxUnresolvedLike {
		issues = append(issues, fmt.Sprintf("unresolved_like_count=%d, want <=%d", run.UnresolvedLikeCount, gate.MaxUnresolvedLike))
	}
	if gate.MaxMissingNutrition >= 0 && run.MissingNutritionCount > gate.MaxMissingNutrition {
		issues = append(issues, fmt.Sprintf("missing_nutrition_count=%d, want <=%d", run.MissingNutritionCount, gate.MaxMissingNutrition))
	}
	if gate.RequireAIRatio {
		for _, item := range run.Items {
			ratioSource := strings.ToLower(strings.TrimSpace(item.SuggestedRatioSource))
			if ratioSource == "" && item.SuggestedRatio == 0 {
				issues = append(issues, fmt.Sprintf("item[%d] %s missing suggested ratio", item.Index, item.Name))
				continue
			}
			if ratioSource != "ai" {
				issues = append(issues, fmt.Sprintf("item[%d] %s suggested ratio source=%q, want ai", item.Index, item.Name, item.SuggestedRatioSource))
			}
		}
	}
	if gate.RequirePackageAnchor {
		for _, item := range run.Items {
			if !isPackagedItemSummary(item) {
				continue
			}
			if item.PackageWeightSource != "packaged_food_library" || !item.PackageWeightApplied {
				issues = append(issues, fmt.Sprintf("item[%d] %s missing packaged_food_library weight anchor", item.Index, item.Name))
			}
		}
	}
	for _, expected := range gate.NameContains {
		if !anyItemNameContains(run.Items, expected, nil) {
			issues = append(issues, fmt.Sprintf("missing item name containing %q", expected))
		}
	}
	for _, expected := range gate.PackagedNameContains {
		if !anyItemNameContains(run.Items, expected, isPackagedItemSummary) {
			issues = append(issues, fmt.Sprintf("missing packaged item name containing %q", expected))
		}
	}
	for _, expected := range gate.NonPackagedNameContains {
		if !anyItemNameContains(run.Items, expected, func(item itemSummary) bool { return !isPackagedItemSummary(item) }) {
			issues = append(issues, fmt.Sprintf("missing non-packaged item name containing %q", expected))
		}
	}
	for index, expectation := range gate.ItemExpectations {
		if !anyItemMatchesExpectation(run.Items, expectation) {
			issues = append(issues, fmt.Sprintf("missing item_expectations[%d] %s", index, describeItemExpectation(expectation)))
		}
	}
	return issues
}

func isPackagedItemSummary(item itemSummary) bool {
	return item.NutritionSource == "packaged_food_library" || item.PackageWeightSource == "packaged_food_library"
}

func anyItemMatchesExpectation(items []itemSummary, expectation itemExpectation) bool {
	for _, item := range items {
		if itemMatchesExpectation(item, expectation) {
			return true
		}
	}
	return false
}

func itemMatchesExpectation(item itemSummary, expectation itemExpectation) bool {
	if expectation.RequirePackaged && !isPackagedItemSummary(item) {
		return false
	}
	if expectation.RequireNonPackaged && isPackagedItemSummary(item) {
		return false
	}
	for _, expected := range expectation.NameContains {
		if !strings.Contains(normalizeGateText(item.Name), normalizeGateText(expected)) {
			return false
		}
	}
	if expectation.MinWeightG > 0 && item.WeightG < expectation.MinWeightG {
		return false
	}
	if expectation.MaxWeightG > 0 && item.WeightG > expectation.MaxWeightG {
		return false
	}
	if expectation.MinCalories > 0 && item.Calories < expectation.MinCalories {
		return false
	}
	if expectation.MaxCalories > 0 && item.Calories > expectation.MaxCalories {
		return false
	}
	if strings.TrimSpace(expectation.NutritionSource) != "" && item.NutritionSource != strings.TrimSpace(expectation.NutritionSource) {
		return false
	}
	if len(expectation.NutritionSourceAny) > 0 && !stringInList(item.NutritionSource, expectation.NutritionSourceAny) {
		return false
	}
	if strings.TrimSpace(expectation.PackageWeightSource) != "" && item.PackageWeightSource != strings.TrimSpace(expectation.PackageWeightSource) {
		return false
	}
	if expectation.RequirePackageWeightApplied && !item.PackageWeightApplied {
		return false
	}
	return true
}

func describeItemExpectation(expectation itemExpectation) string {
	parts := []string{}
	if len(expectation.NameContains) > 0 {
		parts = append(parts, "name_contains="+strings.Join(expectation.NameContains, "+"))
	}
	if expectation.RequirePackaged {
		parts = append(parts, "require_packaged")
	}
	if expectation.RequireNonPackaged {
		parts = append(parts, "require_non_packaged")
	}
	if expectation.MinWeightG > 0 || expectation.MaxWeightG > 0 {
		parts = append(parts, fmt.Sprintf("weight_g=%s..%s", formatFloat(expectation.MinWeightG), formatFloat(expectation.MaxWeightG)))
	}
	if expectation.MinCalories > 0 || expectation.MaxCalories > 0 {
		parts = append(parts, fmt.Sprintf("calories=%s..%s", formatFloat(expectation.MinCalories), formatFloat(expectation.MaxCalories)))
	}
	if strings.TrimSpace(expectation.NutritionSource) != "" {
		parts = append(parts, "nutrition_source="+strings.TrimSpace(expectation.NutritionSource))
	}
	if len(expectation.NutritionSourceAny) > 0 {
		parts = append(parts, "nutrition_source_any="+strings.Join(expectation.NutritionSourceAny, "|"))
	}
	if strings.TrimSpace(expectation.PackageWeightSource) != "" {
		parts = append(parts, "package_weight_source="+strings.TrimSpace(expectation.PackageWeightSource))
	}
	if expectation.RequirePackageWeightApplied {
		parts = append(parts, "require_package_weight_applied")
	}
	if len(parts) == 0 {
		return "with no filters"
	}
	return strings.Join(parts, ",")
}

func anyItemNameContains(items []itemSummary, expected string, predicate func(itemSummary) bool) bool {
	expected = normalizeGateText(expected)
	if expected == "" {
		return true
	}
	for _, item := range items {
		if predicate != nil && !predicate(item) {
			continue
		}
		text := normalizeGateText(strings.Join([]string{item.Name, item.MatchedFoodID, item.PackagedFoodID}, " "))
		if strings.Contains(text, expected) {
			return true
		}
	}
	return false
}

func normalizeGateText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, " ", "")
	value = strings.ReplaceAll(value, "　", "")
	return value
}

func writeSummaryFiles(outputDir string, summary verifySummary) error {
	raw, err := json.MarshalIndent(summary, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outputDir, "summary.json"), raw, 0o644); err != nil {
		return err
	}
	return writeItemsCSV(filepath.Join(outputDir, "items.csv"), summary)
}

func writeItemsCSV(path string, summary verifySummary) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	w := csv.NewWriter(file)
	defer w.Flush()
	header := []string{
		"case", "mode", "status", "suggest_ratio_enabled", "suggest_ratio_status", "suggest_ratio_applied_count",
		"task_id", "final_task_id", "item_index", "name", "type", "weight_g", "calories",
		"nutrition_source", "matched_food_id", "package_weight_source", "package_weight_applied",
		"package_weight_reason", "packaged_food_id", "packaged_candidate_count",
		"suggested_ratio", "suggested_ratio_source", "has_nutrition", "error",
	}
	if err := w.Write(header); err != nil {
		return err
	}
	for _, c := range summary.Cases {
		for _, run := range c.Runs {
			if err := writeRunCSVRows(w, c.Name, run); err != nil {
				return err
			}
			if run.Correction != nil {
				if err := writeRunCSVRows(w, c.Name, *run.Correction); err != nil {
					return err
				}
			}
		}
	}
	return w.Error()
}

func writeRunCSVRows(w *csv.Writer, caseName string, run runResult) error {
	runError := joinErrors(run.Error, strings.Join(run.GateErrors, "; "))
	suggestRatioEnabled := formatBoolPtr(run.SuggestRatioEnabled)
	suggestRatioApplied := ""
	if run.SuggestRatioAppliedCount != 0 {
		suggestRatioApplied = strconv.Itoa(run.SuggestRatioAppliedCount)
	}
	if len(run.Items) == 0 {
		row := []string{caseName, run.Mode, run.Status, suggestRatioEnabled, run.SuggestRatioStatus, suggestRatioApplied, run.TaskID, run.FinalTaskID, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", runError}
		return w.Write(row)
	}
	for _, item := range run.Items {
		row := []string{
			caseName,
			run.Mode,
			run.Status,
			suggestRatioEnabled,
			run.SuggestRatioStatus,
			suggestRatioApplied,
			run.TaskID,
			run.FinalTaskID,
			strconv.Itoa(item.Index),
			item.Name,
			item.Type,
			formatFloat(item.WeightG),
			formatFloat(item.Calories),
			item.NutritionSource,
			item.MatchedFoodID,
			item.PackageWeightSource,
			strconv.FormatBool(item.PackageWeightApplied),
			item.PackageWeightReason,
			item.PackagedFoodID,
			strconv.Itoa(item.PackagedCandidateCnt),
			formatFloat(item.SuggestedRatio),
			item.SuggestedRatioSource,
			strconv.FormatBool(item.HasNutrition),
			runError,
		}
		if err := w.Write(row); err != nil {
			return err
		}
	}
	return nil
}

func writeRawTask(outputDir, caseName, mode, taskID string, task analysisTaskResponse) (string, error) {
	rawDir := filepath.Join(outputDir, "raw")
	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		return "", err
	}
	filename := fmt.Sprintf("%s_%s_%s.json", sanitizeName(caseName), sanitizeName(mode), sanitizeName(taskID))
	path := filepath.Join(rawDir, filename)
	raw, err := json.MarshalIndent(task, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func issueLocalToken(configDir, userID string) (string, error) {
	cfg, err := config.Load(configDir)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(cfg.JWT.Secret) == "" {
		return "", errors.New("jwt.secret is empty")
	}
	accessTTL := cfg.JWT.AccessTokenTTLSeconds
	if accessTTL <= 0 {
		accessTTL = 3600
	}
	refreshTTL := cfg.JWT.RefreshTokenTTLSeconds
	if refreshTTL <= 0 {
		refreshTTL = accessTTL * 2
	}
	svc := authservice.NewJWTService(cfg.JWT.Secret, accessTTL, refreshTTL)
	return svc.IssueAccess(userID, "gray-verify-openid", "")
}

func isAutoUserID(userID string) bool {
	userID = strings.ToLower(strings.TrimSpace(userID))
	return userID == "latest" || userID == "auto"
}

func resolveLatestUserID(ctx context.Context, configDir string) (string, error) {
	cfg, err := config.Load(configDir)
	if err != nil {
		return "", err
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		return "", err
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}
	if err := database.Ping(ctx, db); err != nil {
		return "", err
	}
	if strings.TrimSpace(cfg.Database.Schema) != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + cfg.Database.Schema).Error; err != nil {
			return "", err
		}
	}
	var userID string
	query := `
SELECT id
FROM weapp_user
ORDER BY COALESCE(update_time, create_time) DESC NULLS LAST
LIMIT 1
`
	if err := db.WithContext(ctx).Raw(query).Scan(&userID).Error; err != nil {
		return "", err
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return "", errors.New("weapp_user is empty")
	}
	return userID, nil
}

func shouldFail(summary verifySummary, failOnIssue bool) bool {
	if summary.Counts["errors"] > 0 {
		return true
	}
	if summary.Counts["gate_failures"] > 0 {
		return true
	}
	if !failOnIssue {
		return false
	}
	return summary.Counts["unresolved_like_items"] > 0 || summary.Counts["missing_nutrition_items"] > 0
}

func setBearer(req *http.Request, token string) {
	token = strings.TrimSpace(token)
	if token == "" {
		return
	}
	if strings.HasPrefix(strings.ToLower(token), "bearer ") {
		req.Header.Set("Authorization", token)
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
}

func envString(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value != "" {
		return value
	}
	return fallback
}

func isRemoteURL(ref string) bool {
	lower := strings.ToLower(strings.TrimSpace(ref))
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

func imageContentType(path string) string {
	if detected := mime.TypeByExtension(strings.ToLower(filepath.Ext(path))); strings.HasPrefix(detected, "image/") {
		return detected
	}
	return "image/jpeg"
}

func caseNameFromRef(ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "case"
	}
	if isRemoteURL(ref) {
		if parsed, err := url.Parse(ref); err == nil {
			base := filepath.Base(parsed.Path)
			if base != "." && base != "/" && base != "" {
				return sanitizeName(strings.TrimSuffix(base, filepath.Ext(base)))
			}
		}
		return "remote_image"
	}
	base := filepath.Base(ref)
	name := strings.TrimSuffix(base, filepath.Ext(base))
	if name == "" || name == "." {
		return "case"
	}
	return sanitizeName(name)
}

var unsafeNamePattern = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func sanitizeName(name string) string {
	name = strings.TrimSpace(name)
	name = unsafeNamePattern.ReplaceAllString(name, "_")
	name = strings.Trim(name, "._-")
	if name == "" {
		return "case"
	}
	if len(name) > 80 {
		name = name[:80]
	}
	return name
}

func joinErrors(left, right string) string {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == "" {
		return right
	}
	if right == "" {
		return left
	}
	return left + "; " + right
}

func anySlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}

func mapFromAny(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	default:
		return nil
	}
}

func firstString(item map[string]any, keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(fmt.Sprint(item[key]))
		if value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}

func firstFloat(item map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if value := floatFromAny(item[key]); value != 0 {
			return value
		}
	}
	return 0
}

func firstInt(item map[string]any, keys ...string) int {
	for _, key := range keys {
		if value := intFromAny(item[key]); value != 0 {
			return value
		}
	}
	return 0
}

func intFromAny(value any) int {
	return int(math.Round(floatFromAny(value)))
}

func floatFromAny(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		v, _ := typed.Float64()
		return v
	case string:
		v, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return v
	default:
		return 0
	}
}

func boolFromAny(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		v, _ := strconv.ParseBool(strings.TrimSpace(typed))
		return v
	default:
		return false
	}
}

func firstBool(item map[string]any, keys ...string) bool {
	if value := firstBoolPtr(item, keys...); value != nil {
		return *value
	}
	return false
}

func firstBoolPtr(item map[string]any, keys ...string) *bool {
	for _, key := range keys {
		value, ok := item[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return &typed
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed == "" {
				continue
			}
			parsed, err := strconv.ParseBool(trimmed)
			if err == nil {
				return &parsed
			}
		}
	}
	return nil
}

func formatBoolPtr(value *bool) string {
	if value == nil {
		return ""
	}
	return strconv.FormatBool(*value)
}

func formatFloat(value float64) string {
	if value == 0 {
		return ""
	}
	return strconv.FormatFloat(value, 'f', 2, 64)
}
