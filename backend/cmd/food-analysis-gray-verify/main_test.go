package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseCaseSpec(t *testing.T) {
	got, ok := parseCaseSpec(`rice_snack=D:\images\mixed.jpg,https://example.com/label.jpg`)
	if !ok {
		t.Fatal("parseCaseSpec returned ok=false")
	}
	if got.Name != "rice_snack" {
		t.Fatalf("Name=%q, want rice_snack", got.Name)
	}
	if len(got.Refs) != 2 {
		t.Fatalf("refs len=%d, want 2", len(got.Refs))
	}
	if got.Refs[0] != `D:\images\mixed.jpg` || got.Refs[1] != "https://example.com/label.jpg" {
		t.Fatalf("refs=%#v", got.Refs)
	}
}

func TestBuildCasesFallsBackToSingleImageCaseName(t *testing.T) {
	cases := buildCases(nil, []string{`D:\images\taoli-bread.jpg`}, nil)
	if len(cases) != 1 {
		t.Fatalf("cases len=%d, want 1", len(cases))
	}
	if cases[0].Name != "taoli-bread" {
		t.Fatalf("case name=%q, want taoli-bread", cases[0].Name)
	}
}

func TestIsAutoUserID(t *testing.T) {
	for _, value := range []string{"latest", " auto ", "LATEST"} {
		if !isAutoUserID(value) {
			t.Fatalf("isAutoUserID(%q)=false, want true", value)
		}
	}
	if isAutoUserID("00000000-0000-0000-0000-000000000000") {
		t.Fatal("uuid should not be treated as auto user id")
	}
}

func TestRedirectTaskID(t *testing.T) {
	got := redirectTaskID(map[string]any{"redirectTaskId": "task-2"})
	if got != "task-2" {
		t.Fatalf("redirectTaskID=%q, want task-2", got)
	}
	got = redirectTaskID(map[string]any{"redirect_task_id": "task-3"})
	if got != "task-3" {
		t.Fatalf("redirectTaskID snake=%q, want task-3", got)
	}
	if redirectTaskID(map[string]any{"redirectTaskId": ""}) != "" {
		t.Fatal("empty redirect should stay empty")
	}
}

func TestBuildItemSummariesExtractsPackagedFields(t *testing.T) {
	items := buildItemSummaries(map[string]any{
		"items": []any{
			map[string]any{
				"name":                     "白米饭",
				"estimatedWeightGrams":     120.0,
				"nutrition_source":         "library_exact_canonical",
				"matched_food_id":          "rice-id",
				"nutrients":                map[string]any{"calories": 139.0},
				"suggestedRatio":           80.0,
				"suggestedRatioSource":     "ai",
				"package_weight_source":    "",
				"package_weight_applied":   false,
				"packaged_candidate_count": 0,
			},
			map[string]any{
				"name":                   "桃李豆沙小饼面包",
				"type":                   "snack",
				"estimatedWeightGrams":   55.0,
				"calories":               165.0,
				"nutrition_source":       "packaged_food_library",
				"matched_food_id":        "packaged-id",
				"packaged_food_id":       "packaged-id",
				"package_weight_source":  "packaged_food_library",
				"package_weight_applied": true,
				"package_weight_reason":  "SKU net weight",
				"packaged_candidates": []any{
					map[string]any{"id": "packaged-id"},
				},
			},
		},
	})
	if len(items) != 2 {
		t.Fatalf("items len=%d, want 2", len(items))
	}
	if items[1].NutritionSource != "packaged_food_library" {
		t.Fatalf("NutritionSource=%q", items[1].NutritionSource)
	}
	if items[1].PackageWeightSource != "packaged_food_library" || !items[1].PackageWeightApplied {
		t.Fatalf("package fields=%#v", items[1])
	}
	if items[1].PackagedCandidateCnt != 1 {
		t.Fatalf("PackagedCandidateCnt=%d, want 1", items[1].PackagedCandidateCnt)
	}
	if items[0].Calories != 139 {
		t.Fatalf("Calories=%v, want 139 from nutrients.calories", items[0].Calories)
	}
	if !items[0].HasNutrition || !items[1].HasNutrition {
		t.Fatalf("expected both items to have nutrition: %#v", items)
	}
}

func TestBuildItemSummariesAcceptsCamelCasePackagedFields(t *testing.T) {
	items := buildItemSummaries(map[string]any{
		"items": []any{
			map[string]any{
				"name":                 "喜之郎CiCi果粒爽橙汁饮料",
				"estimatedWeightGrams": 258.0,
				"calories":             178.0,
				"nutritionSource":      "packaged_food_library",
				"matchedFoodId":        "nutrition:jelly-drink",
				"packagedFoodId":       "packaged:cici-orange-258g",
				"packageWeightSource":  "packaged_food_library",
				"packageWeightApplied": "true",
				"packageWeightReason":  "命中包装库净含量258g",
				"packagedCandidates": []any{
					map[string]any{"id": "packaged:cici-orange-258g"},
				},
				"suggestedRatio":       80,
				"suggestedRatioSource": "ai",
			},
		},
	})

	if len(items) != 1 {
		t.Fatalf("items len=%d, want 1", len(items))
	}
	item := items[0]
	if item.NutritionSource != "packaged_food_library" ||
		item.MatchedFoodID != "nutrition:jelly-drink" ||
		item.PackagedFoodID != "packaged:cici-orange-258g" ||
		item.PackageWeightSource != "packaged_food_library" ||
		!item.PackageWeightApplied ||
		item.PackageWeightReason == "" ||
		item.PackagedCandidateCnt != 1 {
		t.Fatalf("camelCase packaged fields not extracted: %#v", item)
	}
	run := runResult{Status: "done", ItemCount: 1, PackagedItemCount: 1, Items: items}
	if issues := runGateIssuesForGate(run, gateConfig{RequirePackageAnchor: true, RequireAIRatio: true}); len(issues) != 0 {
		t.Fatalf("camelCase packaged item should pass package/ratio gates, got %#v", issues)
	}
}

func TestBuildItemSummariesTreatsResolvedZeroNutritionAsPresent(t *testing.T) {
	run := runResult{Status: "done"}
	applyResultSummary(&run, map[string]any{
		"items": []any{
			map[string]any{
				"name":                   "无糖气泡水",
				"estimatedWeightGrams":   500.0,
				"nutrition_source":       "packaged_food_library",
				"packaged_food_id":       "packaged-zero-drink",
				"package_weight_source":  "packaged_food_library",
				"package_weight_applied": true,
				"nutrients": map[string]any{
					"calories": 0.0,
					"protein":  0.0,
					"carbs":    0.0,
					"fat":      0.0,
				},
			},
		},
	})

	if run.ItemCount != 1 || run.MissingNutritionCount != 0 {
		t.Fatalf("resolved zero-nutrition item should not count as missing nutrition: %#v", run)
	}
	if len(run.Items) != 1 || !run.Items[0].HasNutrition {
		t.Fatalf("resolved zero-nutrition item should have nutrition: %#v", run.Items)
	}
	if issues := runGateIssuesForGate(run, gateConfig{MaxMissingNutrition: 0}); len(issues) != 0 {
		t.Fatalf("resolved zero-nutrition item should pass missing-nutrition gate, got %#v", issues)
	}
}

func TestBuildItemSummariesKeepsUnresolvedZeroNutritionMissing(t *testing.T) {
	run := runResult{Status: "done"}
	applyResultSummary(&run, map[string]any{
		"items": []any{
			map[string]any{
				"name":                 "未知饮品",
				"estimatedWeightGrams": 500.0,
				"nutrition_source":     "unresolved",
				"nutrients": map[string]any{
					"calories": 0.0,
					"protein":  0.0,
					"carbs":    0.0,
					"fat":      0.0,
				},
			},
		},
	})

	if run.ItemCount != 1 || run.MissingNutritionCount != 1 {
		t.Fatalf("unresolved zero-nutrition item should count as missing nutrition: %#v", run)
	}
	if len(run.Items) != 1 || run.Items[0].HasNutrition {
		t.Fatalf("unresolved zero-nutrition item should not have nutrition: %#v", run.Items)
	}
	if issues := runGateIssuesForGate(run, gateConfig{MaxMissingNutrition: 0}); len(issues) == 0 {
		t.Fatal("unresolved zero-nutrition item should fail missing-nutrition gate")
	}
}

func TestBuildItemSummariesKeepsPartialZeroNutritionMissing(t *testing.T) {
	items := buildItemSummaries(map[string]any{
		"items": []any{
			map[string]any{
				"name":             "空营养占位",
				"nutrition_source": "packaged_food_library",
				"nutrients":        map[string]any{"calories": 0.0},
			},
		},
	})

	if len(items) != 1 || items[0].HasNutrition {
		t.Fatalf("partial zero-nutrition shell should not have nutrition: %#v", items)
	}
}

func TestApplyResultSummaryCountsSources(t *testing.T) {
	var run runResult
	applyResultSummary(&run, map[string]any{
		"packaged_food_resolution":    map[string]any{"matched_count": 1},
		"suggest_ratio_enabled":       true,
		"suggest_ratio_status":        "applied",
		"suggest_ratio_applied_count": 3,
		"items": []any{
			map[string]any{
				"name":             "白米饭",
				"calories":         120.0,
				"nutrition_source": "library_exact_canonical",
			},
			map[string]any{
				"name":                     "未收录包装豆干",
				"calories":                 88.0,
				"nutrition_source":         "deepseek_generated",
				"package_weight_source":    "ai_estimate",
				"package_weight_applied":   false,
				"packaged_candidate_count": 0,
			},
			map[string]any{
				"name":                  "桃李豆沙小饼面包",
				"calories":              165.0,
				"nutrition_source":      "packaged_food_library",
				"package_weight_source": "packaged_food_library",
			},
			map[string]any{
				"name":                  "包装饮料",
				"calories":              46.0,
				"package_weight_source": "packaged_food_library",
			},
		},
	})
	if run.ItemCount != 4 || run.PackagedItemCount != 2 || run.LibraryItemCount != 1 || run.AIFallbackItemCount != 1 {
		t.Fatalf("unexpected counts: %#v", run)
	}
	if run.PackagedMatchedCount != 1 {
		t.Fatalf("PackagedMatchedCount=%d, want top-level 1", run.PackagedMatchedCount)
	}
	if run.SuggestRatioEnabled == nil || !*run.SuggestRatioEnabled || run.SuggestRatioStatus != "applied" || run.SuggestRatioAppliedCount != 3 {
		t.Fatalf("suggest ratio summary not captured: %#v", run)
	}
}

func TestApplyResultSummaryDoesNotTreatUserContextWeightAsPackaged(t *testing.T) {
	var run runResult
	applyResultSummary(&run, map[string]any{
		"items": []any{
			map[string]any{
				"name":                   "糙米饭",
				"calories":               132.0,
				"nutrition_source":       "user_correction_context",
				"package_weight_source":  "user_context",
				"package_weight_applied": true,
			},
		},
	})

	if run.ItemCount != 1 || run.PackagedItemCount != 0 || run.UserContextItemCount != 1 {
		t.Fatalf("user-context corrected normal item should not count as packaged: %#v", run)
	}
	maxPackaged := 0
	if issues := runGateIssuesForGate(run, gateConfig{MaxPackagedItems: &maxPackaged, MinNonPackagedItems: 1}); len(issues) != 0 {
		t.Fatalf("user-context corrected normal item should pass non-packaged gate, got %#v", issues)
	}
}

func TestApplyResultSummaryCapturesCamelCaseSuggestRatioMetadata(t *testing.T) {
	var run runResult
	applyResultSummary(&run, map[string]any{
		"suggestRatioEnabled":      "true",
		"suggestRatioStatus":       "failed",
		"suggestRatioAppliedCount": 2.0,
	})
	if run.SuggestRatioEnabled == nil || !*run.SuggestRatioEnabled {
		t.Fatalf("SuggestRatioEnabled=%v, want true", run.SuggestRatioEnabled)
	}
	if run.SuggestRatioStatus != "failed" || run.SuggestRatioAppliedCount != 2 {
		t.Fatalf("suggest ratio metadata not captured: %#v", run)
	}
}

func TestApplyResultSummaryInfersPackagedMatchedCountFromItems(t *testing.T) {
	var run runResult
	applyResultSummary(&run, map[string]any{
		"items": []any{
			map[string]any{
				"name":             "包装饮料",
				"nutrition_source": "packaged_food_library",
				"nutrients":        map[string]any{"calories": 46.0},
			},
		},
	})
	if run.PackagedItemCount != 1 || run.PackagedMatchedCount != 1 {
		t.Fatalf("expected inferred packaged counts, got %#v", run)
	}
}

func TestGrayConfigApplyShorthandsRequireMixed(t *testing.T) {
	cfg := grayConfig{RequireMixed: true, MaxPackagedItems: -1}
	cfg.applyShorthands()

	if cfg.MinItems != 2 || cfg.MinPackagedItems != 1 || cfg.MinNonPackagedItems != 1 {
		t.Fatalf("mixed shorthand did not set minimums: %#v", cfg)
	}
}

func TestParseExpectationSpec(t *testing.T) {
	name, gate, err := parseExpectationSpec("mixed_meal:require_done,require_mixed,require_ai_ratio,require_package_anchor,min_ai_fallback=1,max_packaged=2,max_unresolved=0,max_missing_nutrition=0,packaged_name_contains=雀巢,non_packaged_name_contains=米饭")
	if err != nil {
		t.Fatalf("parseExpectationSpec error: %v", err)
	}
	if name != "mixed_meal" {
		t.Fatalf("name=%q, want mixed_meal", name)
	}
	if !gate.RequireDone || !gate.RequireMixed || !gate.RequireAIRatio || !gate.RequirePackageAnchor {
		t.Fatalf("expected bool gates enabled: %#v", gate)
	}
	if gate.MinItems != 2 || gate.MinPackagedItems != 1 || gate.MinNonPackagedItems != 1 {
		t.Fatalf("mixed shorthand not applied: %#v", gate)
	}
	if gate.MinAIFallbackItems != 1 || gate.MaxPackagedItems == nil || *gate.MaxPackagedItems != 2 || gate.MaxUnresolvedLike != 0 || gate.MaxMissingNutrition != 0 {
		t.Fatalf("numeric gates not parsed: %#v", gate)
	}
	if len(gate.PackagedNameContains) != 1 || gate.PackagedNameContains[0] != "雀巢" {
		t.Fatalf("packaged name expectation not parsed: %#v", gate.PackagedNameContains)
	}
	if len(gate.NonPackagedNameContains) != 1 || gate.NonPackagedNameContains[0] != "米饭" {
		t.Fatalf("non-packaged name expectation not parsed: %#v", gate.NonPackagedNameContains)
	}
}

func TestSubmitAnalyzeTaskUsesCaseAdditionalContext(t *testing.T) {
	var bodies []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/analyze/submit" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		bodies = append(bodies, body)
		_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "task-id"})
	}))
	defer server.Close()

	cfg := grayConfig{
		BaseURL:             server.URL,
		Token:               "token",
		MealType:            "lunch",
		AdditionalContext:   "global context",
		SuggestRatioEnabled: true,
	}
	taskID, err := submitAnalyzeTask(context.Background(), server.Client(), cfg, []string{"https://example.com/image.jpg"}, "standard", "case context")
	if err != nil {
		t.Fatalf("submitAnalyzeTask error: %v", err)
	}
	if taskID != "task-id" {
		t.Fatalf("taskID=%q", taskID)
	}
	if len(bodies) != 1 {
		t.Fatalf("request count=%d, want 1", len(bodies))
	}
	if bodies[0]["additionalContext"] != "case context" {
		t.Fatalf("additionalContext=%#v, want case context", bodies[0]["additionalContext"])
	}

	_, err = submitAnalyzeTask(context.Background(), server.Client(), cfg, []string{"https://example.com/image.jpg"}, "standard", "")
	if err != nil {
		t.Fatalf("submitAnalyzeTask fallback error: %v", err)
	}
	if bodies[1]["additionalContext"] != "global context" {
		t.Fatalf("fallback additionalContext=%#v, want global context", bodies[1]["additionalContext"])
	}
}

func TestRunModeSubmitsCorrectionAndAppliesCorrectionGate(t *testing.T) {
	var submitBodies []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/analyze/submit":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode submit body: %v", err)
			}
			submitBodies = append(submitBodies, body)
			taskID := "base-task"
			if boolFromAny(body["is_correction"]) {
				taskID = "correction-task"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": taskID})
		case r.Method == http.MethodGet && r.URL.Path == "/api/analyze/tasks/base-task":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":     "base-task",
				"status": "done",
				"result": map[string]any{
					"items": []any{
						map[string]any{
							"name":                   "雀巢咖啡1+2奶香",
							"estimatedWeightGrams":   105,
							"calories":               42,
							"nutrition_source":       "packaged_food_library",
							"package_weight_source":  "packaged_food_library",
							"package_weight_applied": true,
							"suggestedRatio":         80,
							"suggestedRatioSource":   "ai",
						},
					},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/analyze/tasks/correction-task":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":     "correction-task",
				"status": "done",
				"result": map[string]any{
					"items": []any{
						map[string]any{
							"name":                   "雀巢咖啡1+2奶香（半包）",
							"estimatedWeightGrams":   52.5,
							"calories":               52.5,
							"nutrition_source":       "user_correction_context",
							"package_weight_source":  "user_context",
							"package_weight_applied": true,
							"suggestedRatio":         100,
							"suggestedRatioSource":   "ai",
						},
					},
				},
			})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	cfg := grayConfig{
		BaseURL:             server.URL,
		Token:               "token",
		MealType:            "lunch",
		AdditionalContext:   "global context",
		SuggestRatioEnabled: true,
		PollInterval:        time.Millisecond,
		TaskTimeout:         time.Second,
		RequestTimeout:      time.Second,
		OutputDir:           t.TempDir(),
	}
	run := runMode(context.Background(), server.Client(), cfg, verifyCase{
		Name: "mixed_nescafe",
		Refs: []string{"https://example.com/mixed.jpg"},
		Correction: &correctionSpec{
			AdditionalContext: "把雀巢咖啡修正为半包，并使用用户营养。",
			Items: []map[string]any{{
				"name":                 "雀巢咖啡1+2奶香（半包）",
				"sourceName":           "雀巢咖啡1+2奶香",
				"estimatedWeightGrams": 52.5,
				"nameEdited":           true,
				"weightEdited":         true,
				"nutritionEdited":      true,
				"nutrients": map[string]any{
					"calories": 52.5,
					"protein":  1,
					"carbs":    10,
					"fat":      1,
				},
			}},
			Expect: &gateConfig{
				RequireDone: true,
				ItemExpectations: []itemExpectation{{
					NameContains:                []string{"半包"},
					MinWeightG:                  52,
					MaxWeightG:                  53,
					MinCalories:                 52,
					MaxCalories:                 53,
					NutritionSource:             "user_correction_context",
					PackageWeightSource:         "user_context",
					RequirePackageWeightApplied: true,
				}},
			},
		},
	}, []string{"https://example.com/mixed.jpg"}, "standard")

	if run.Status != "done" || run.Correction == nil || run.Correction.Status != "done" {
		t.Fatalf("expected base and correction done, got base=%#v correction=%#v", run, run.Correction)
	}
	if len(run.Correction.GateErrors) != 0 {
		t.Fatalf("correction gate should pass, got %#v items=%#v", run.Correction.GateErrors, run.Correction.Items)
	}
	if len(submitBodies) != 2 {
		t.Fatalf("submit count=%d, want base + correction", len(submitBodies))
	}
	correctionBody := submitBodies[1]
	if !boolFromAny(correctionBody["is_correction"]) {
		t.Fatalf("second submit should be correction: %#v", correctionBody)
	}
	if correctionBody["correction_source_task_id"] != "base-task" || correctionBody["correction_root_task_id"] != "base-task" {
		t.Fatalf("correction source/root ids not preserved: %#v", correctionBody)
	}
	correctionItems := anySlice(correctionBody["correctionItems"])
	if len(correctionItems) != 1 || !boolFromAny(mapFromAny(correctionItems[0])["nutritionEdited"]) {
		t.Fatalf("correction payload should preserve nutritionEdited: %#v", correctionItems)
	}
	if len(run.Correction.RawResultPaths) == 0 {
		t.Fatal("correction raw task output should be written")
	}
}

func TestRunCaseRunsCorrectionForEachMode(t *testing.T) {
	var submitBodies []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/analyze/submit":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode submit body: %v", err)
			}
			submitBodies = append(submitBodies, body)
			mode := firstString(body, "execution_mode")
			taskID := "base-" + mode
			if boolFromAny(body["is_correction"]) {
				taskID = "correction-" + mode
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": taskID})
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/analyze/tasks/"):
			taskID := strings.TrimPrefix(r.URL.Path, "/api/analyze/tasks/")
			isCorrection := strings.HasPrefix(taskID, "correction-")
			item := map[string]any{
				"name":                   "雀巢咖啡1+2奶香",
				"estimatedWeightGrams":   105,
				"calories":               42,
				"nutrition_source":       "packaged_food_library",
				"package_weight_source":  "packaged_food_library",
				"package_weight_applied": true,
				"suggestedRatio":         100,
				"suggestedRatioSource":   "ai",
			}
			if isCorrection {
				item["name"] = "雀巢咖啡1+2奶香（半包）"
				item["estimatedWeightGrams"] = 52.5
				item["calories"] = 52.5
				item["nutrition_source"] = "user_correction_context"
				item["package_weight_source"] = "user_context"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":     taskID,
				"status": "done",
				"result": map[string]any{
					"suggest_ratio_enabled":       true,
					"suggest_ratio_status":        "applied",
					"suggest_ratio_applied_count": 1,
					"items":                       []any{item},
				},
			})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	cfg := grayConfig{
		BaseURL:             server.URL,
		Token:               "token",
		MealType:            "lunch",
		Modes:               []string{"standard", "strict_separate"},
		SuggestRatioEnabled: true,
		PollInterval:        time.Millisecond,
		TaskTimeout:         time.Second,
		RequestTimeout:      time.Second,
		OutputDir:           t.TempDir(),
	}
	result := runCase(context.Background(), server.Client(), cfg, verifyCase{
		Name: "mixed_nescafe",
		Refs: []string{"https://example.com/mixed.jpg"},
		Correction: &correctionSpec{
			Items: []map[string]any{{
				"name":                 "雀巢咖啡1+2奶香（半包）",
				"sourceName":           "雀巢咖啡1+2奶香",
				"estimatedWeightGrams": 52.5,
				"nameEdited":           true,
				"weightEdited":         true,
				"nutritionEdited":      true,
				"nutrients":            map[string]any{"calories": 52.5},
			}},
			Expect: &gateConfig{
				RequireDone:    true,
				RequireAIRatio: true,
				ItemExpectations: []itemExpectation{{
					NameContains:                []string{"半包"},
					MinCalories:                 52,
					MaxCalories:                 53,
					NutritionSource:             "user_correction_context",
					PackageWeightSource:         "user_context",
					RequirePackageWeightApplied: true,
				}},
			},
		},
	})
	if len(result.Runs) != 2 {
		t.Fatalf("runs=%d, want one per mode", len(result.Runs))
	}
	for _, run := range result.Runs {
		if run.Status != "done" || run.Correction == nil || run.Correction.Status != "done" {
			t.Fatalf("mode %s did not complete base and correction: %#v", run.Mode, run)
		}
		if len(run.Correction.GateErrors) != 0 {
			t.Fatalf("mode %s correction gate errors: %#v", run.Mode, run.Correction.GateErrors)
		}
	}
	if len(submitBodies) != 4 {
		t.Fatalf("submit count=%d, want base+correction per mode", len(submitBodies))
	}
	correctionsByMode := map[string]bool{}
	for _, body := range submitBodies {
		if boolFromAny(body["is_correction"]) {
			correctionsByMode[firstString(body, "execution_mode")] = true
		}
	}
	for _, mode := range cfg.Modes {
		if !correctionsByMode[mode] {
			t.Fatalf("missing correction submit for mode %s; bodies=%#v", mode, submitBodies)
		}
	}
}

func TestLoadGraySuiteAndApplyDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "suite.json")
	raw := []byte(`{
  "modes": ["standard", "strict_separate"],
  "cases": [
    {
      "name": "mixed",
      "additional_context": "case context only",
      "refs": ["https://example.com/mixed.jpg"],
      "expect": {
        "require_mixed": true,
        "packaged_name_contains": ["雀巢"],
        "item_expectations": [
          {
            "name_contains": ["雀巢", "咖啡"],
            "require_packaged": true,
            "min_weight_g": 104,
            "max_weight_g": 106,
            "nutrition_source": "packaged_food_library",
            "package_weight_source": "packaged_food_library",
            "require_package_weight_applied": true
          }
        ],
        "max_unresolved_like_items": 0
      },
      "correction": {
        "additional_context": "改成半包",
        "items": [
          {
            "name": "雀巢咖啡半包",
            "sourceName": "雀巢咖啡",
            "estimatedWeightGrams": 52.5,
            "nameEdited": true,
            "weightEdited": true
          }
        ],
        "expect": {
          "require_done": true,
          "name_contains": ["半包"],
          "item_expectations": [
            {
              "name_contains": ["半包"],
              "min_weight_g": 52,
              "max_weight_g": 53,
              "min_calories": 52,
              "max_calories": 53
            }
          ]
        }
      }
    },
    {
      "name": "normal_only",
      "refs": ["https://example.com/normal.jpg"]
    }
  ],
  "global_gate": {
    "require_done": true,
    "max_missing_nutrition_items": 0
  },
  "fail_on_issue": true,
  "suggest_ratio_enabled": false
}`)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write suite: %v", err)
	}
	suite, err := loadGraySuite(path)
	if err != nil {
		t.Fatalf("loadGraySuite error: %v", err)
	}

	cfg := grayConfig{
		BaseURL:             "http://127.0.0.1:3010",
		ConfigDir:           ".",
		Token:               "token",
		Modes:               defaultGrayModes,
		SuggestRatioEnabled: true,
		PollInterval:        time.Second,
		TaskTimeout:         time.Minute,
		RequestTimeout:      time.Minute,
		MaxPackagedItems:    -1,
		MaxUnresolvedLike:   -1,
		MaxMissingNutrition: -1,
		Expectations:        map[string]gateConfig{},
	}
	applySuiteDefaults(&cfg, suite, nil, false, false)
	cfg.applyShorthands()
	if err := cfg.validate(); err != nil {
		t.Fatalf("validate after suite defaults: %v", err)
	}

	if len(cfg.Modes) != 2 || cfg.Modes[1] != "strict_separate" {
		t.Fatalf("modes not loaded from suite: %#v", cfg.Modes)
	}
	if len(cfg.Cases) != 2 || cfg.Cases[0].Name != "mixed" || cfg.Cases[1].Name != "normal_only" {
		t.Fatalf("cases not loaded from suite: %#v", cfg.Cases)
	}
	if cfg.Cases[0].AdditionalContext != "case context only" {
		t.Fatalf("case additional_context not loaded: %#v", cfg.Cases[0])
	}
	if cfg.Cases[0].Correction == nil || len(cfg.Cases[0].Correction.Items) != 1 || cfg.Cases[0].Correction.Expect == nil {
		t.Fatalf("correction not loaded from suite: %#v", cfg.Cases[0].Correction)
	}
	if !cfg.RequireDone || cfg.MaxMissingNutrition != 0 || !cfg.FailOnIssue || cfg.SuggestRatioEnabled {
		t.Fatalf("global suite defaults not applied: %#v", cfg)
	}
	mixed := cfg.gateForCase("mixed")
	if !mixed.RequireMixed || mixed.MinPackagedItems != 1 || mixed.MaxUnresolvedLike != 0 || len(mixed.PackagedNameContains) != 1 || len(mixed.ItemExpectations) != 1 {
		t.Fatalf("mixed gate not loaded: %#v", mixed)
	}
	normal := cfg.gateForCase("normal_only")
	if normal.MaxUnresolvedLike != -1 {
		t.Fatalf("normal case with no expect should not inherit max_unresolved=0: %#v", normal)
	}
}

func TestLoadFullGraySuiteFixture(t *testing.T) {
	suite, err := loadGraySuite(filepath.Join("..", "..", "testdata", "food-analysis-gray-suite.full.json"))
	if err != nil {
		t.Fatalf("load full suite fixture: %v", err)
	}
	if strings.Join(suite.Modes, ",") != strings.Join(defaultGrayModes, ",") {
		t.Fatalf("full suite modes=%#v, want default seven modes %#v", suite.Modes, defaultGrayModes)
	}
	if suite.SuggestRatioEnabled == nil || !*suite.SuggestRatioEnabled {
		t.Fatalf("full suite must keep suggest_ratio_enabled=true")
	}
	if suite.FailOnIssue == nil || !*suite.FailOnIssue {
		t.Fatalf("full suite must fail on unresolved or missing nutrition issues")
	}
	if suite.GlobalGate == nil || !suite.GlobalGate.RequireDone || !suite.GlobalGate.RequireAIRatio || suite.GlobalGate.MaxUnresolvedLike != 0 || suite.GlobalGate.MaxMissingNutrition != 0 {
		t.Fatalf("weak full suite global gate: %#v", suite.GlobalGate)
	}
	if len(suite.Cases) != 6 {
		t.Fatalf("suite cases=%d, want 6", len(suite.Cases))
	}
	expectations := suiteExpectations(suite)
	casesByName := map[string]graySuiteCase{}
	for _, c := range suite.Cases {
		casesByName[c.Name] = c
	}
	for _, name := range []string{"mixed_nescafe", "mixed_cutlet_cici", "mixed_skewer_snickers"} {
		gate, ok := expectations[name]
		if !ok {
			t.Fatalf("missing expectation for %s", name)
		}
		if !gate.RequireMixed || !gate.RequirePackageAnchor || len(gate.ItemExpectations) == 0 {
			t.Fatalf("weak gate for %s: %#v", name, gate)
		}
	}
	packageMiss, ok := expectations["package_miss_ai_fallback"]
	if !ok {
		t.Fatal("missing expectation for package_miss_ai_fallback")
	}
	if packageMiss.MaxPackagedItems == nil || *packageMiss.MaxPackagedItems != 0 || packageMiss.MinNonPackagedItems < 1 || len(packageMiss.ItemExpectations) < 2 {
		t.Fatalf("weak package miss gate: %#v", packageMiss)
	}
	if !fullSuiteAllowsNutritionSource(packageMiss.ItemExpectations, "deepseek_generated") || !fullSuiteAllowsNutritionSource(packageMiss.ItemExpectations, "library_exact_canonical") {
		t.Fatalf("package miss must allow both AI fallback and generated-library fallback: %#v", packageMiss.ItemExpectations)
	}
	sugarfreeDrink, ok := expectations["mixed_rice_suntory_sugarfree"]
	if !ok {
		t.Fatal("missing expectation for mixed_rice_suntory_sugarfree")
	}
	if !sugarfreeDrink.RequireMixed || !sugarfreeDrink.RequirePackageAnchor || sugarfreeDrink.MaxMissingNutrition != 0 || sugarfreeDrink.MaxUnresolvedLike != 0 || len(sugarfreeDrink.ItemExpectations) < 2 {
		t.Fatalf("weak sugarfree drink gate: %#v", sugarfreeDrink)
	}
	if !fullSuiteHasLowCalorieSugarfreePackagedExpectation(sugarfreeDrink.ItemExpectations) {
		t.Fatalf("sugarfree drink case must require packaged library source, weight anchor, and realistic low calories: %#v", sugarfreeDrink.ItemExpectations)
	}
	sugarfreeDrinkCase, ok := casesByName["mixed_rice_suntory_sugarfree"]
	if !ok || strings.TrimSpace(sugarfreeDrinkCase.AdditionalContext) == "" || len(sugarfreeDrinkCase.Refs) != 1 {
		t.Fatalf("sugarfree drink case should include local ref and additional_context: %#v", sugarfreeDrinkCase)
	}
	sugarfreeDrinkRef := filepath.Join("..", "..", sugarfreeDrinkCase.Refs[0])
	if _, err := os.Stat(sugarfreeDrinkRef); err != nil {
		t.Fatalf("sugarfree drink local asset missing: %s: %v", sugarfreeDrinkRef, err)
	}
	normalOnly, ok := expectations["normal_only_skewer"]
	if !ok {
		t.Fatal("missing expectation for normal_only_skewer")
	}
	if normalOnly.MaxPackagedItems == nil || *normalOnly.MaxPackagedItems != 0 || normalOnly.MinNonPackagedItems < 1 || len(normalOnly.ItemExpectations) == 0 {
		t.Fatalf("weak normal-only gate: %#v", normalOnly)
	}
	packageMissCase, ok := casesByName["package_miss_ai_fallback"]
	if !ok || strings.TrimSpace(packageMissCase.AdditionalContext) == "" {
		t.Fatalf("package miss case should include additional_context: %#v", packageMissCase)
	}
	nescafeCase, ok := casesByName["mixed_nescafe"]
	if !ok || nescafeCase.Correction == nil || nescafeCase.Correction.Expect == nil || len(nescafeCase.Correction.Expect.ItemExpectations) == 0 {
		t.Fatalf("nescafe correction gate should include item expectations: %#v", nescafeCase.Correction)
	}
	if !nescafeCase.Correction.Expect.RequireDone || !nescafeCase.Correction.Expect.RequireAIRatio {
		t.Fatalf("nescafe correction must require done status and AI ratio: %#v", nescafeCase.Correction.Expect)
	}
	if len(nescafeCase.Correction.Items) != 1 || !boolFromAny(nescafeCase.Correction.Items[0]["nameEdited"]) || !boolFromAny(nescafeCase.Correction.Items[0]["weightEdited"]) || !boolFromAny(nescafeCase.Correction.Items[0]["nutritionEdited"]) {
		t.Fatalf("nescafe correction must exercise name, weight, and nutrition edits: %#v", nescafeCase.Correction.Items)
	}
	correctionExpectation := nescafeCase.Correction.Expect.ItemExpectations[0]
	if correctionExpectation.NutritionSource != "user_correction_context" || correctionExpectation.PackageWeightSource != "user_context" || !correctionExpectation.RequirePackageWeightApplied {
		t.Fatalf("nescafe correction must require user correction nutrition and weight source: %#v", correctionExpectation)
	}
	ciciCase, ok := casesByName["mixed_cutlet_cici"]
	if !ok || ciciCase.Correction == nil || ciciCase.Correction.Expect == nil || len(ciciCase.Correction.Expect.ItemExpectations) < 2 {
		t.Fatalf("cici mixed case must include normal-food correction plus packaged-preservation gates: %#v", ciciCase.Correction)
	}
	if !ciciCase.Correction.Expect.RequireDone || !ciciCase.Correction.Expect.RequireAIRatio || ciciCase.Correction.Expect.MinItems < 2 {
		t.Fatalf("cici correction must require done status, AI ratio, and at least two items: %#v", ciciCase.Correction.Expect)
	}
	if len(ciciCase.Correction.Items) < 2 ||
		!boolFromAny(ciciCase.Correction.Items[0]["nameEdited"]) ||
		!boolFromAny(ciciCase.Correction.Items[0]["weightEdited"]) ||
		!boolFromAny(ciciCase.Correction.Items[0]["nutritionEdited"]) {
		t.Fatalf("cici correction must exercise normal item name, weight, and nutrition edits while keeping packaged item: %#v", ciciCase.Correction.Items)
	}
	hasNormalUserCorrection := false
	hasPackagedPreservation := false
	for _, expectation := range ciciCase.Correction.Expect.ItemExpectations {
		if expectation.RequireNonPackaged &&
			expectation.NutritionSource == "user_correction_context" &&
			expectation.PackageWeightSource == "user_context" &&
			expectation.RequirePackageWeightApplied {
			hasNormalUserCorrection = true
		}
		if expectation.RequirePackaged &&
			expectation.NutritionSource == "packaged_food_library" &&
			expectation.PackageWeightSource == "packaged_food_library" &&
			expectation.RequirePackageWeightApplied {
			hasPackagedPreservation = true
		}
	}
	if !hasNormalUserCorrection || !hasPackagedPreservation {
		t.Fatalf("cici correction must require normal user correction and packaged item preservation: %#v", ciciCase.Correction.Expect.ItemExpectations)
	}
}

func fullSuiteAllowsNutritionSource(expectations []itemExpectation, source string) bool {
	for _, expectation := range expectations {
		if stringInList(source, expectation.NutritionSourceAny) {
			return true
		}
	}
	return false
}

func fullSuiteHasLowCalorieSugarfreePackagedExpectation(expectations []itemExpectation) bool {
	for _, expectation := range expectations {
		if expectation.RequirePackaged &&
			expectation.MinCalories >= 1 &&
			expectation.MaxCalories > expectation.MinCalories &&
			expectation.MaxCalories <= 100 &&
			expectation.NutritionSource == "packaged_food_library" &&
			expectation.PackageWeightSource == "packaged_food_library" &&
			expectation.RequirePackageWeightApplied {
			return true
		}
	}
	return false
}

func TestApplyGateResultsUsesCaseSpecificExpectations(t *testing.T) {
	summary := verifySummary{Counts: map[string]int{}, Cases: []verifyCaseResult{
		{
			Name: "mixed",
			Runs: []runResult{{
				Mode:              "standard",
				Status:            "done",
				ItemCount:         2,
				PackagedItemCount: 1,
				LibraryItemCount:  1,
				Items: []itemSummary{
					{Name: "白米饭", NutritionSource: "library_exact_canonical", HasNutrition: true},
					{Name: "桃李豆沙小饼面包", NutritionSource: "packaged_food_library", PackageWeightSource: "packaged_food_library", PackageWeightApplied: true, HasNutrition: true},
				},
			}},
		},
		{
			Name: "package_miss",
			Runs: []runResult{{
				Mode:                "standard",
				Status:              "done",
				ItemCount:           1,
				AIFallbackItemCount: 1,
				Items: []itemSummary{
					{Name: "未收录包装豆干", NutritionSource: "deepseek_generated", HasNutrition: true},
				},
			}},
		},
		{
			Name: "normal_only",
			Runs: []runResult{{
				Mode:             "standard",
				Status:           "done",
				ItemCount:        1,
				LibraryItemCount: 1,
				Items: []itemSummary{
					{Name: "白米饭", NutritionSource: "library_exact_canonical", HasNutrition: true},
				},
			}},
		},
	}}
	expectations, errs := parseExpectationSpecs([]string{
		"mixed:require_mixed,require_package_anchor,packaged_name_contains=桃李,non_packaged_name_contains=米饭",
		"package_miss:min_ai_fallback=1,max_unresolved=0,max_missing_nutrition=0",
		"normal_only:min_non_packaged=1,max_packaged=0,max_unresolved=0,max_missing_nutrition=0",
	})
	if len(errs) != 0 {
		t.Fatalf("unexpected expectation errors: %#v", errs)
	}

	applyGateResults(&summary, grayConfig{
		RequireDone:         true,
		Expectations:        expectations,
		MaxPackagedItems:    -1,
		MaxUnresolvedLike:   -1,
		MaxMissingNutrition: -1,
	})

	for _, c := range summary.Cases {
		if len(c.Runs) != 1 || len(c.Runs[0].GateErrors) != 0 {
			t.Fatalf("case %s should pass case-specific gates: %#v", c.Name, c.Runs)
		}
	}
	if summary.Counts["gate_failures"] != 0 {
		t.Fatalf("unexpected gate failures: %#v", summary.Counts)
	}
}

func TestAddRunCountsIncludesCorrectionRuns(t *testing.T) {
	counts := map[string]int{}
	addRunCounts(counts, runResult{
		Status:    "done",
		ItemCount: 2,
		Correction: &runResult{
			Status:                "done",
			ItemCount:             1,
			UserContextItemCount:  1,
			MissingNutritionCount: 0,
		},
	}, false)

	if counts["runs"] != 1 || counts["correction_runs"] != 1 {
		t.Fatalf("run counts not tracked: %#v", counts)
	}
	if counts["items"] != 2 || counts["correction_items"] != 1 || counts["correction_status_done"] != 1 {
		t.Fatalf("item/status counts not tracked: %#v", counts)
	}
}

func TestWriteItemsCSVIncludesCorrectionRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "items.csv")
	suggestEnabled := true
	summary := verifySummary{Cases: []verifyCaseResult{{
		Name: "mixed",
		Runs: []runResult{{
			Mode:                     "standard",
			Status:                   "done",
			SuggestRatioEnabled:      &suggestEnabled,
			SuggestRatioStatus:       "applied",
			SuggestRatioAppliedCount: 1,
			Items:                    []itemSummary{{Name: "雀巢咖啡", NutritionSource: "packaged_food_library", SuggestedRatioSource: "ai", HasNutrition: true}},
			Correction: &runResult{
				Mode:   "standard_correction",
				Status: "done",
				Items:  []itemSummary{{Name: "雀巢咖啡半包", NutritionSource: "user_correction_context", HasNutrition: true}},
			},
		}},
	}}}

	if err := writeItemsCSV(path, summary); err != nil {
		t.Fatalf("writeItemsCSV error: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read csv: %v", err)
	}
	text := string(data)
	if !strings.Contains(text, "standard_correction") || !strings.Contains(text, "雀巢咖啡半包") {
		t.Fatalf("correction row missing from csv:\n%s", text)
	}
	if !strings.Contains(text, "suggest_ratio_enabled,suggest_ratio_status,suggest_ratio_applied_count") ||
		!strings.Contains(text, "standard,done,true,applied,1") {
		t.Fatalf("suggest ratio run metadata missing from csv:\n%s", text)
	}
}

func TestRunGateIssuesRequiresExpectedItemNames(t *testing.T) {
	run := runResult{
		Status:            "done",
		ItemCount:         2,
		PackagedItemCount: 1,
		Items: []itemSummary{
			{Name: "白米饭", NutritionSource: "library_exact_canonical", HasNutrition: true},
			{Name: "雀巢咖啡1+2奶香", NutritionSource: "packaged_food_library", PackageWeightSource: "packaged_food_library", PackageWeightApplied: true, HasNutrition: true},
		},
	}

	passIssues := runGateIssuesForGate(run, gateConfig{
		NameContains:            []string{"咖啡"},
		PackagedNameContains:    []string{"雀巢"},
		NonPackagedNameContains: []string{"米饭"},
	})
	if len(passIssues) != 0 {
		t.Fatalf("expected name gates to pass, got %#v", passIssues)
	}

	failIssues := runGateIssuesForGate(run, gateConfig{
		PackagedNameContains:    []string{"桃李"},
		NonPackagedNameContains: []string{"炸猪排"},
	})
	if len(failIssues) != 2 {
		t.Fatalf("expected two missing-name issues, got %#v", failIssues)
	}
}

func TestRunGateIssuesSupportsItemExpectations(t *testing.T) {
	run := runResult{
		Status:            "done",
		ItemCount:         2,
		PackagedItemCount: 1,
		Items: []itemSummary{
			{
				Name:            "炸猪排",
				WeightG:         160,
				Calories:        480,
				NutritionSource: "library_exact_canonical",
				HasNutrition:    true,
			},
			{
				Name:                 "士力架花生夹心巧克力 2条装",
				WeightG:              70,
				Calories:             343,
				NutritionSource:      "packaged_food_library",
				PackageWeightSource:  "packaged_food_library",
				PackageWeightApplied: true,
				HasNutrition:         true,
			},
		},
	}

	passIssues := runGateIssuesForGate(run, gateConfig{ItemExpectations: []itemExpectation{
		{
			NameContains:                []string{"士力架", "2条"},
			RequirePackaged:             true,
			MinWeightG:                  69,
			MaxWeightG:                  71,
			MinCalories:                 300,
			MaxCalories:                 380,
			NutritionSource:             "packaged_food_library",
			PackageWeightSource:         "packaged_food_library",
			RequirePackageWeightApplied: true,
		},
		{
			NameContains:       []string{"猪排"},
			RequireNonPackaged: true,
			MinWeightG:         150,
			MaxWeightG:         170,
			NutritionSourceAny: []string{"library_exact_canonical", "deepseek_generated"},
		},
	}})
	if len(passIssues) != 0 {
		t.Fatalf("expected item expectations to pass, got %#v", passIssues)
	}

	failIssues := runGateIssuesForGate(run, gateConfig{ItemExpectations: []itemExpectation{
		{
			NameContains:                []string{"士力架"},
			RequirePackaged:             true,
			MinWeightG:                  34,
			MaxWeightG:                  36,
			PackageWeightSource:         "packaged_food_library",
			RequirePackageWeightApplied: true,
		},
	}})
	if len(failIssues) != 1 || !strings.Contains(failIssues[0], "item_expectations[0]") {
		t.Fatalf("expected item expectation failure, got %#v", failIssues)
	}
}

func TestApplyGateResultsRequiresMixedDoneAndPackageAnchor(t *testing.T) {
	summary := verifySummary{Counts: map[string]int{}, Cases: []verifyCaseResult{{
		Name: "mixed",
		Runs: []runResult{
			{
				Mode:              "standard",
				Status:            "done",
				ItemCount:         2,
				PackagedItemCount: 1,
				Items: []itemSummary{
					{Name: "白米饭", NutritionSource: "library_exact_canonical", SuggestedRatio: 80, SuggestedRatioSource: "ai", HasNutrition: true},
					{Name: "桃李豆沙小饼面包", NutritionSource: "packaged_food_library", PackageWeightSource: "packaged_food_library", PackageWeightApplied: true, SuggestedRatio: 60, SuggestedRatioSource: "ai", HasNutrition: true},
				},
			},
			{
				Mode:              "strict_separate",
				Status:            "done",
				ItemCount:         1,
				PackagedItemCount: 0,
				Items: []itemSummary{
					{Name: "炸猪排", NutritionSource: "library_exact_canonical", SuggestedRatio: 100, SuggestedRatioSource: "ai", HasNutrition: true},
				},
			},
			{
				Mode:   "strict_web_search",
				Status: "failed",
			},
		},
	}}}

	applyGateResults(&summary, grayConfig{
		RequireDone:          true,
		RequireMixed:         true,
		MinItems:             2,
		MinPackagedItems:     1,
		MinNonPackagedItems:  1,
		RequireAIRatio:       true,
		RequirePackageAnchor: true,
		MaxPackagedItems:     -1,
	})

	if len(summary.Cases[0].Runs[0].GateErrors) != 0 {
		t.Fatalf("first run should pass gates: %#v", summary.Cases[0].Runs[0].GateErrors)
	}
	if len(summary.Cases[0].Runs[1].GateErrors) == 0 {
		t.Fatal("second run should fail mixed gates")
	}
	if len(summary.Cases[0].Runs[2].GateErrors) == 0 {
		t.Fatal("third run should fail require-done gate")
	}
	if summary.Counts["gate_failed_runs"] != 2 || summary.Counts["gate_failures"] == 0 {
		t.Fatalf("unexpected gate counts: %#v", summary.Counts)
	}
	if !shouldFail(summary, false) {
		t.Fatal("gate failures should make command fail")
	}
}

func TestRunGateIssuesRequireAIRatioAndPackagedWeightAnchor(t *testing.T) {
	run := runResult{
		Status:            "done",
		ItemCount:         2,
		PackagedItemCount: 1,
		Items: []itemSummary{
			{Name: "白米饭", NutritionSource: "library_exact_canonical", HasNutrition: true},
			{Name: "雀巢咖啡", NutritionSource: "packaged_food_library", PackageWeightSource: "ai_estimate", PackageWeightApplied: false, HasNutrition: true},
		},
	}

	issues := runGateIssues(run, grayConfig{RequireAIRatio: true, RequirePackageAnchor: true, MaxPackagedItems: -1})
	if len(issues) < 2 {
		t.Fatalf("expected ratio and package anchor issues, got %#v", issues)
	}
}

func TestRunGateIssuesRequireAIRatioSourceAI(t *testing.T) {
	passRun := runResult{
		Status:    "done",
		ItemCount: 1,
		Items: []itemSummary{
			{Name: "白米饭", NutritionSource: "library_exact_canonical", SuggestedRatio: 80, SuggestedRatioSource: "ai", HasNutrition: true},
		},
	}
	if issues := runGateIssuesForGate(passRun, gateConfig{RequireAIRatio: true}); len(issues) != 0 {
		t.Fatalf("expected AI ratio source to pass, got %#v", issues)
	}

	defaultRun := runResult{
		Status:    "done",
		ItemCount: 1,
		Items: []itemSummary{
			{Name: "白米饭", NutritionSource: "library_exact_canonical", SuggestedRatio: 100, SuggestedRatioSource: "default", HasNutrition: true},
		},
	}
	issues := runGateIssuesForGate(defaultRun, gateConfig{RequireAIRatio: true})
	if len(issues) != 1 || !strings.Contains(issues[0], "want ai") {
		t.Fatalf("expected non-AI ratio source failure, got %#v", issues)
	}
}

func TestRunGateIssuesSupportsMaxPackagedItems(t *testing.T) {
	run := runResult{
		Status:            "done",
		ItemCount:         2,
		PackagedItemCount: 1,
		Items: []itemSummary{
			{Name: "烤肉串", NutritionSource: "library_exact_canonical", HasNutrition: true},
			{Name: "误触发包装食品", NutritionSource: "packaged_food_library", HasNutrition: true},
		},
	}

	maxPackaged := 0
	issues := runGateIssuesForGate(run, gateConfig{MaxPackagedItems: &maxPackaged})
	if len(issues) != 1 || !strings.Contains(issues[0], "packaged_item_count=1") {
		t.Fatalf("expected max packaged failure, got %#v", issues)
	}
}
