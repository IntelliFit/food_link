package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"

	"github.com/mitchellh/mapstructure"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// Opt-in live evaluation. Run the compiled test binary with configuration on
// stdin; no credentials, tasks, credits or meal records are written.
func TestLiveNutritionStateImages(t *testing.T) {
	if os.Getenv("FOODLINK_LIVE_STATE_QA") != "1" {
		t.Skip("真实模型图片回归需显式启用")
	}
	var cfg struct {
		Storage                                                                                                                                                       map[string]any
		DSN, DashKey, DashURL, OfoxKey, OfoxURL, OpenLuxKey, OpenLuxURL, A6Key, A6URL, DeepKey, DeepURL, GeminiKey, GeminiURL, DoubaoKey, DoubaoURL, Provider, Output string
		QwenOrdinary, QwenPrecision, OpenLuxOrdinary, OpenLuxPrecision                                                                                                int
		Routing                                                                                                                                                       map[string]any
		Modes                                                                                                                                                         []string
		Cases                                                                                                                                                         []struct {
			ID, Expected, Context string
			Paths                 []string
			URLs                  []string
		}
	}
	if err := json.NewDecoder(os.Stdin).Decode(&cfg); err != nil {
		t.Fatal("读取私有验证配置失败")
	}
	logger.SetGlobal(nil)
	var storageCfg config.StorageConfig
	if err := mapstructure.Decode(cfg.Storage, &storageCfg); err != nil {
		t.Fatal("测试图片存储配置解析失败")
	}
	fixtureStorage := storage.New(storageCfg)
	db, err := gorm.Open(postgres.Open(cfg.DSN), &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)})
	if err != nil {
		t.Fatal("只读验证数据库不可用")
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	var readOnly string
	if err = db.Raw("SHOW transaction_read_only").Scan(&readOnly).Error; err != nil || readOnly != "on" {
		t.Fatal("验证连接不是只读连接")
	}
	s := analyzeservice.NewAnalyzeService(analyzeservice.NewDoubaoClient(cfg.DoubaoKey, "", cfg.DoubaoURL), analyzeservice.NewOfoxAIClient(cfg.OfoxKey, "gemini-3-flash-preview", cfg.OfoxURL), nil, foodrecordrepo.NewFoodNutritionRepo(db))
	s.ConfigureDashScopeClient(cfg.DashKey, cfg.DashURL)
	s.ConfigureGemini35Client(cfg.GeminiKey, cfg.GeminiURL, "gemini-3.5-flash")
	s.ConfigureGemini31LiteClient(cfg.OfoxKey, cfg.OfoxURL, "gemini-3.1-flash-lite")
	s.ConfigureOpenLuxGeminiClients(cfg.OpenLuxKey, cfg.OpenLuxURL)
	var routing config.VisionRoutingConfig
	if err := mapstructure.Decode(cfg.Routing, &routing); err != nil {
		t.Fatal("渠道配置解析失败")
	}
	routing.A6ShadowPercent = 0
	s.ConfigureA6VisionRouting(cfg.A6Key, cfg.A6URL, routing)
	s.ConfigureImageProvider(cfg.Provider)
	s.ConfigureImageModelTraffic(cfg.QwenOrdinary, cfg.QwenPrecision)
	s.ConfigureGeminiUpstreamTraffic(cfg.OpenLuxOrdinary, cfg.OpenLuxPrecision)
	s.ConfigureDeepSeekFallback(cfg.DeepKey, cfg.DeepURL)
	r := &Runner{analyze: s}
	rows := []map[string]any{}
	modes := cfg.Modes
	if len(modes) == 0 {
		modes = []string{"standard", "strict"}
	}
	for _, c := range cfg.Cases {
		urls := c.URLs
		if !strings.HasPrefix(c.ID, "original_duck") {
			bytes, e := os.ReadFile(c.Paths[0])
			if e != nil {
				t.Fatal(e)
			}
			key := "qa/nutrition-state-20261015/" + c.ID + ".jpg"
			fixtureURL, e := fixtureStorage.UploadBytes("food-images", key, bytes, "image/jpeg")
			if e != nil {
				t.Fatal("上传临时测试图片失败")
			}
			urls = []string{fixtureURL}
			t.Cleanup(func() {
				if e := fixtureStorage.DeleteObject("food-images", key); e != nil {
					t.Errorf("清理本任务临时测试对象失败: %s", key)
				}
			})
		}
		if len(urls) == 0 {
			t.Fatal("测试图片缺少HTTPS引用")
		}
		for _, mode := range modes {
			start := time.Now()
			ctx, cancel := context.WithTimeout(context.Background(), 160*time.Second)
			var result map[string]any
			var callErr error
			if mode == "standard" {
				result, callErr = s.Analyze(ctx, "", analyzeservice.AnalyzeInput{ImageURL: urls[0], ImageURLs: urls, AdditionalContext: c.Context, ExecutionMode: &mode, AnalysisEngine: "ai_direct", PreciseMicronutrients: true})
			} else {
				model := selectPrecisionModel(s, "state-qa-"+c.ID)
				prompt := buildPrecisionPlanPrompt("image", "图片输入", c.Context, nil, nil, false, map[string]any{"continue_with_uncertainty": true})
				var planned map[string]any
				planned, callErr = s.RunPrecisionPlanJSONWithImages(ctx, "image", prompt, urls, model)
				if callErr == nil {
					plan := normalizePrecisionPlanResult(planned)
					itemsToEstimate := buildPrecisionEstimateItems(plan, "image")
					if len(itemsToEstimate) == 0 {
						callErr = fmt.Errorf("规划未返回可估计食物")
					} else {
						payload := map[string]any{"items_to_estimate": itemsToEstimate, "additionalContext": c.Context, "source_type": "image", "analysis_engine": "db_candidates_ai", "precise_micronutrients": true}
						weightPrompt, e := buildPrecisionItemEstimatePromptFromPayload("image", payload, "", c.Context, nil)
						if e != nil {
							callErr = e
						} else {
							var weightResult map[string]any
							weightResult, callErr = s.RunPrecisionJSONWithImages(ctx, "image", weightPrompt, urls, model)
							if callErr == nil {
								var items []map[string]any
								items, callErr = parsePrecisionEstimateItems(weightResult, itemsToEstimate, payload)
								if callErr == nil {
									if refined, _, e := r.maybeRefinePrecisionWeights(ctx, "image", items, itemsToEstimate, c.Context, c.Context, nil, urls, model); e == nil {
										items = refined
									}
									items, callErr = r.resolvePrecisionNutrition(ctx, items, itemsToEstimate, payload)
									result = map[string]any{"items": items, "model_name": model}
								}
							}
						}
					}
				}
			}
			cancel()
			row := map[string]any{"case": c.ID, "mode": mode, "expected": c.Expected, "elapsed_ms": time.Since(start).Milliseconds()}
			if callErr != nil {
				row["error"] = callErr.Error()
			} else {
				row["model"] = result["model_name"]
				items := extractItems(result["items"])
				summary := []map[string]any{}
				for _, item := range items {
					m := map[string]any{}
					for _, key := range []string{"name", "foodState", "weightBasis", "basisEvidence", "item_hint", "estimatedWeightGrams", "matched_food_id", "matched_food_name", "matched_food_state", "matched_weight_basis", "nutrition_source", "nutrition_match_reason", "unit_nutrition_per_100g", "candidate_review_status", "candidate_review_reason"} {
						if v, ok := item[key]; ok {
							m[key] = v
						}
					}
					summary = append(summary, m)
				}
				row["items"] = summary
				passed := len(items) > 0
				duckCount := 0
				for _, item := range items {
					state := strings.ToLower(stringFromMap(item, "foodState"))
					if c.Expected == "raw_or_dry" && !(state == "raw" || state == "fresh" || state == "dry" || strings.Contains(state, "生") || strings.Contains(state, "干")) {
						passed = false
					}
					if c.Expected == "cooked" && !(state == "cooked" || state == "baked" || state == "roasted" || state == "fried" || strings.Contains(state, "熟")) {
						passed = false
					}
					if strings.HasPrefix(c.Expected, "duck_") && strings.Contains(stringFromMap(item, "name"), "鸭") {
						duckCount++
						evidence := stringFromMap(item, "name") + stringFromMap(item, "item_hint") + stringFromMap(item, "basisEvidence")
						if c.Expected == "duck_skinless" && !strings.Contains(evidence, "去皮") && !strings.Contains(evidence, "不吃皮") {
							passed = false
						}
						if c.Expected == "duck_with_skin" && !strings.Contains(evidence, "带皮") && !strings.Contains(evidence, "含皮") && !strings.Contains(evidence, "保留皮") && !strings.Contains(evidence, "不去皮") {
							passed = false
						}
						if stringFromMap(item, "matched_food_id") == "98bfd093-e84f-4045-9070-c37a8c6eb357" {
							passed = false
						}
					}
				}
				if strings.HasPrefix(c.Expected, "duck_") && duckCount == 0 {
					passed = false
				}
				row["passed"] = passed
			}
			rows = append(rows, row)
			bytes, _ := json.MarshalIndent(map[string]any{"read_only": true, "real_models": true, "results": rows}, "", "  ")
			if err := os.WriteFile(filepath.Clean(cfg.Output), bytes, 0600); err != nil {
				t.Fatal(err)
			}
			progress, _ := json.Marshal(map[string]any{"case": c.ID, "mode": mode, "elapsed_ms": row["elapsed_ms"], "passed": row["passed"], "error": row["error"]})
			fmt.Println("QA_PROGRESS " + string(progress))
			if callErr != nil || row["passed"] != true {
				t.Errorf("图片状态回归未通过: %s/%s", c.ID, mode)
			}
		}
	}
}
