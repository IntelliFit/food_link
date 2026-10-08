// diet-replay compares V2.1/V3 over read-only user data; --model-judge explicitly
// permits model arbitration. It never starts a server/worker or saves chat/intake.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"food_link/backend/internal/health/domain"
	healthrepo "food_link/backend/internal/health/repo"
	"food_link/backend/internal/health/service"
	"food_link/backend/internal/nutritionagg"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
)

func main() {
	configDir := flag.String("config-dir", ".", "existing backend config directory")
	userID := flag.String("user-id", "", "exact user ID; preferred over nickname")
	nickname := flag.String("nickname", "", "must resolve to exactly one user")
	date := flag.String("date", "", "business date YYYY-MM-DD; default today")
	output := flag.String("output", "", "optional private JSON report path")
	budget := flag.Float64("budget", 0, "explicit scenario budget, 0 means not supplied")
	selfCheck := flag.Bool("self-check", false, "pure invariants; no config or database access")
	auditRecords := flag.String("audit-records", "", "comma-separated own record IDs; provenance-only, no replay")
	schools := flag.String("schools", "", "explicit comma-separated school names; not a GPS location or saved profile")
	auditMenus := flag.Bool("audit-breakfast-menus", false, "read-only named-school breakfast catalog audit")
	simulateExposure := flag.Bool("simulate-exposure", false, "simulate seeing prior V3 options for both versions; never counts as eating")
	modelJudge := flag.Bool("model-judge", false, "explicitly allow bounded V3 model arbitration; no user points or business writes")
	mealTime := flag.Bool("at-meal-time", false, "use pre-meal cutoffs 07:00/11:00/17:00 instead of midnight; skip future cutoffs")
	radiusSchool := flag.String("audit-radius-school", "", "read-only 3/5km boundary audit centred on a catalog school coordinate, NOT the user's GPS")
	nearbyCenter := flag.String("nearby-center-school", "", "mixed-scope full replay around an explicitly labelled school-coordinate fixture, NOT a school filter or user GPS")
	flag.Parse()
	if *nearbyCenter != "" && (*schools != "" || *radiusSchool != "" || *auditMenus) {
		fail("附近混合回放不可同时传学校范围或仅检索审计参数")
	}
	if *selfCheck {
		emit(runSelfChecks(), *output)
		return
	}
	if *userID == "" && *nickname == "" {
		fail("需要明确的 user-id 或唯一昵称")
	}
	zone := time.FixedZone("Asia/Shanghai", 8*3600)
	now := time.Now().In(zone)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, zone)
	if *date != "" {
		var err error
		day, err = time.ParseInLocation("2006-01-02", *date, zone)
		if err != nil {
			fail("日期无效")
		}
	}
	if day.After(now) {
		fail("不能回放未来日期")
	}
	cfg, err := config.Load(*configDir)
	if err != nil {
		fail("配置读取失败")
	}
	if cfg.Database.Driver != "postgres" && cfg.Database.Driver != "postgresql" {
		fail("当前工具仅支持 PostgreSQL 只读事务")
	}
	if !regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`).MatchString(cfg.Database.Schema) {
		fail("数据库 schema 无效")
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		fail("数据库连接失败")
	}
	sqlDB, err := db.DB()
	if err != nil {
		fail("数据库句柄读取失败")
	}
	defer sqlDB.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	tx := db.WithContext(ctx).Begin(&sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if tx.Error != nil {
		fail("只读事务创建失败")
	}
	defer tx.Rollback()
	if err := tx.Exec(`SET LOCAL search_path TO "` + cfg.Database.Schema + `"`).Error; err != nil {
		fail("只读事务 schema 设置失败")
	}
	var readOnly string
	if err := tx.Raw("SHOW transaction_read_only").Scan(&readOnly).Error; err != nil || readOnly != "on" {
		fail("无法确认只读事务，停止")
	}
	var users []struct {
		ID       string
		Nickname string
	}
	query := tx.Table("weapp_user").Select("id, nickname")
	if *userID != "" {
		query = query.Where("id = ?", *userID)
	} else {
		query = query.Where("nickname = ?", *nickname)
	}
	if err := query.Limit(2).Find(&users).Error; err != nil || len(users) != 1 {
		fail("身份不唯一或不存在，请指定 exact user-id")
	}
	if *nickname != "" && users[0].Nickname != *nickname {
		fail("用户 ID 与昵称不一致")
	}
	if *auditRecords != "" {
		ids := strings.Split(*auditRecords, ",")
		if len(ids) > 10 {
			fail("一次最多核对10条记录")
		}
		var records []struct{ Evidence string }
		err := tx.Raw(`SELECT jsonb_build_object('id', r.id, 'meal_type', r.meal_type,
			'record_time', r.record_time, 'created_at', r.created_at, 'description', r.description,
			'items', r.items, 'entry_type', r.entry_type, 'image_path', r.image_path,
			'source_task_id', r.source_task_id, 'task_type', t.task_type, 'task_text_input', t.text_input,
			'task_created_at', t.created_at) ::text AS evidence
			FROM user_food_records r LEFT JOIN analysis_tasks t ON t.id = r.source_task_id AND t.user_id = r.user_id
			WHERE r.user_id = ? AND r.id IN ? ORDER BY r.record_time`, users[0].ID, ids).Scan(&records).Error
		if err != nil {
			fail("原始记录核对失败")
		}
		evidence := []json.RawMessage{}
		for _, r := range records {
			evidence = append(evidence, json.RawMessage(r.Evidence))
		}
		emit(map[string]any{"user_id": users[0].ID, "nickname": users[0].Nickname, "transaction_read_only": readOnly, "records": evidence}, *output)
		return
	}
	// Interface wrapping removes optional feedback/location-memory capabilities.
	var repo service.StatsRepo = readOnlyStatsRepo{StatsRepo: healthrepo.NewStatsRepo(tx)}
	profile, err := repo.GetUserProfile(ctx, users[0].ID)
	if err != nil || profile == nil {
		fail("个人档案读取失败")
	}
	svc := service.NewStatsService(repo, nil, cfg)
	if *radiusSchool != "" {
		school, err := repo.ResolveDietRecommendationSchool(ctx, *radiusSchool)
		if err != nil || school == nil {
			fail("范围核对学校不存在")
		}
		var center struct{ Latitude, Longitude float64 }
		if err := tx.Table("schools").Select("latitude,longitude").Where("id = ?", school.ID).Take(&center).Error; err != nil {
			fail("目录中心坐标不可读")
		}
		location := &domain.DietLocation{Latitude: center.Latitude, Longitude: center.Longitude, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}
		if !location.Valid(time.Now()) {
			fail("目录中心坐标不可用，不能冒充用户定位")
		}
		audits := []map[string]any{}
		var inner map[string]bool
		for _, radius := range []float64{3, 5} {
			f := domain.CampusDietSearchFilter{ViewerID: users[0].ID, Location: location, RadiusKM: radius, AllowUnknownNutrition: true, IncludeMenuEvidence: true, ScanCatalog: true, Limit: 100}
			seen, schools, levels := map[string]bool{}, map[string]int{}, map[string]int{}
			total := int64(0)
			merchants := 0
			for {
				rows, count, err := repo.SearchCampusDietCandidates(ctx, f)
				if err != nil {
					fail("附近完整扫描失败")
				}
				total = count
				added := 0
				for _, c := range rows {
					if c.DistanceKM == nil || *c.DistanceKM > radius {
						fail("范围核对发现越界菜品")
					}
					if !seen[c.SourceID] {
						seen[c.SourceID] = true
						added++
						schools[c.SchoolName]++
						levels[c.LocationLevel]++
						if !c.IsCampusFood {
							merchants++
						}
					}
					if c.SourceID > f.AfterID {
						f.AfterID = c.SourceID
					}
				}
				if len(seen) == int(total) {
					break
				}
				if added == 0 {
					fail("附近完整扫描没有进展")
				}
			}
			if inner != nil {
				for id := range inner {
					if !seen[id] {
						fail("3公里菜单不属于5公里集合")
					}
				}
			}
			inner = seen
			audits = append(audits, map[string]any{"radius_km": radius, "total_matches": total, "retrieved": len(seen), "schools": schools, "merchant_menu_count": merchants, "coordinate_evidence_levels": levels, "all_in_radius": true})
		}
		emit(map[string]any{"transaction_read_only": readOnly, "center_source": "学校目录坐标，仅用于检索边界核对，不是用户当前位置", "school": school, "audits": audits}, *output)
		return
	}
	var maxPrice *float64
	if *budget > 0 {
		maxPrice = budget
	}
	replays := []*service.MealReplayResult{}
	var schoolNames []string
	if strings.TrimSpace(*schools) != "" {
		schoolNames = strings.Split(*schools, ",")
	}
	var replayLocation *domain.DietLocation
	if *nearbyCenter != "" {
		school, err := repo.ResolveDietRecommendationSchool(ctx, *nearbyCenter)
		if err != nil || school == nil {
			fail("测试坐标对应的学校目录不存在")
		}
		var center struct{ Latitude, Longitude float64 }
		if err := tx.Table("schools").Select("latitude,longitude").Where("id = ?", school.ID).Take(&center).Error; err != nil {
			fail("测试中心坐标不可读")
		}
		replayLocation = &domain.DietLocation{Latitude: center.Latitude, Longitude: center.Longitude, CoordinateType: "gcj02", CapturedAt: now.UnixMilli()}
		if !replayLocation.Valid(time.Now()) {
			fail("测试中心坐标无效")
		}
	}
	if *auditMenus {
		if len(schoolNames) == 0 || len(schoolNames) > 3 {
			fail("菜单核对需要1至3所明确学校")
		}
		catalog := []map[string]any{}
		for _, name := range schoolNames {
			school, err := repo.ResolveDietRecommendationSchool(ctx, name)
			if err != nil || school == nil {
				fail("学校解析失败")
			}
			var evidence []struct{ Evidence string }
			if err := tx.Raw(`SELECT jsonb_build_object('id', id, 'title', food_name, 'description', description,
				'canteen', canteen_name, 'window', window_name, 'price', price, 'price_unit', price_unit,
				'portion_description', portion_description, 'price_type', price_type,
				'catalog', (SELECT jsonb_build_object('price_text', ci.price_text, 'price_type', ci.price_type, 'portion', ci.portion_description, 'raw_text', ci.raw_text, 'meal_periods', ci.meal_periods, 'availability', ci.availability_status) FROM campus_food_catalog_items ci WHERE ci.id = p.id),
				'calories', total_calories, 'protein', total_protein, 'carbs', total_carbs, 'fat', total_fat) ::text AS evidence
				FROM public_food_library p WHERE school_id = ? AND status = 'published'
				AND food_name ~ '(早餐|包|饼|粥|豆浆|馄饨|烧麦|烧卖|肠粉|鸡蛋|茶叶蛋|牛奶)'
				AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_user_id = ? AND b.blocked_user_id = p.user_id) OR (b.blocker_user_id = p.user_id AND b.blocked_user_id = ?))
				ORDER BY canteen_name, window_name, food_name LIMIT 200`, school.ID, users[0].ID, users[0].ID).Scan(&evidence).Error; err != nil {
				fail("早餐菜单核对失败")
			}
			rows := []json.RawMessage{}
			for _, r := range evidence {
				rows = append(rows, json.RawMessage(r.Evidence))
			}
			catalog = append(catalog, map[string]any{"school": school, "rows": rows})
		}
		emit(map[string]any{"transaction_read_only": readOnly, "catalog": catalog}, *output)
		return
	}
	var exposures []service.MealReplayExposure
	for _, cutoff := range []time.Time{day.AddDate(0, 0, -1), day} {
		for _, mealType := range []string{"breakfast", "lunch", "dinner"} {
			mealCutoff := cutoff
			if *mealTime {
				mealCutoff = cutoff.Add(time.Duration(map[string]int{"breakfast": 7, "lunch": 11, "dinner": 17}[mealType]) * time.Hour)
				if mealCutoff.After(now) {
					continue
				}
			}
			var snapshot string
			var candidateSnapshot string
			for _, version := range []string{"v2.1", "v3"} {
				question := "下一餐吃什么"
				if replayLocation != nil {
					question = "附近食堂和外卖都可以，一起比较推荐"
				}
				replay, err := svc.ReplayMeals(ctx, users[0].ID, service.MealReplayInput{Question: question, AsOf: mealCutoff, MealType: mealType, EngineVersion: version, MaxPrice: maxPrice, SchoolNames: schoolNames, Location: replayLocation, RadiusKM: 5, PriorExposures: exposures, AllowModelJudge: *modelJudge})
				if err != nil {
					fail("回放失败：" + err.Error())
				}
				if snapshot != "" && replay.SnapshotHash != snapshot {
					fail("旧/新版输入快照不同，比较无效")
				}
				snapshot = replay.SnapshotHash
				if replay.Result.CandidateSnapshotHash == "" || candidateSnapshot != "" && candidateSnapshot != replay.Result.CandidateSnapshotHash {
					fail("旧/新版候选快照不同，比较无效")
				}
				candidateSnapshot = replay.Result.CandidateSnapshotHash
				if replay.LatestRecordTime != "" {
					parsed, err := time.Parse(time.RFC3339, replay.LatestRecordTime)
					if err != nil || !parsed.Before(mealCutoff) {
						fail("检测到未来摄入泄漏")
					}
				}
				if replay.LatestCreatedAt != "" {
					parsed, err := time.Parse(time.RFC3339, replay.LatestCreatedAt)
					if err != nil || !parsed.Before(mealCutoff) {
						fail("检测到后来补录泄漏")
					}
				}
				if replay.Result.RecommendationID != "" {
					fail("回放意外签发反馈 ID")
				}
				if replayLocation != nil {
					if replay.Result.SearchScope != "nearby_and_history" || replay.Result.AgentConstraints.Scene != "any" {
						fail("混合范围被意外收窄")
					}
					for _, coverage := range replay.Result.CatalogCoverage {
						if coverage.Scope != "nearby" || coverage.Status != "complete" || coverage.RadiusKM != 5 {
							fail("附近目录未完整参与混合回放")
						}
					}
					for _, stage := range replay.Result.CandidateFunnel {
						excluded := 0
						for _, count := range stage.Excluded {
							excluded += count
						}
						if stage.Retrieved != stage.Eligible+excluded {
							fail("候选阶段计数不守恒")
						}
					}
				}
				replays = append(replays, replay)
			}
			if *simulateExposure {
				exposures = append(exposures, service.MealReplayExposure{Date: cutoff.Format("2006-01-02"), MealType: mealType, Options: replays[len(replays)-1].Result.Recommendations})
			}
		}
	}
	report := map[string]any{"checked_at": now.Format(time.RFC3339), "user_id": users[0].ID, "nickname": users[0].Nickname,
		"profile_evidence": map[string]any{"birthday": profile.Birthday, "gender": profile.Gender, "diet_goal": profile.DietGoal, "is_student": profile.HealthCondition["is_student"], "campus_dining_preference": profile.HealthCondition["campus_dining_preference"]},
		"database":         map[string]any{"host": cfg.Database.Host, "name": cfg.Database.Name, "schema": cfg.Database.Schema, "transaction_read_only": readOnly},
		"scenario":         "两天每日零点前的已知记录；三餐分别模拟，隐藏目标日全部摄入；当前个人档案和菜单、无实时GPS、无假定预算", "replays": replays}
	if maxPrice != nil {
		report["explicit_scenario_budget"] = *maxPrice
	}
	report["explicit_school_scope"] = schoolNames
	report["model_judge_allowed"], report["pre_meal_cutoffs"] = *modelJudge, *mealTime
	if *mealTime {
		report["scenario"] = "两日真实餐前已知记录，排除后续/补录；未来餐次跳过。条件规划与实际摄入分开，无实时GPS。"
	}
	if replayLocation != nil {
		report["nearby_origin"] = map[string]any{"source": "explicit_school_coordinate_fixture_not_user_gps", "label": *nearbyCenter, "radius_km": 5}
		report["scope_note"] = "此学校仅提供明确测试坐标，不限制学校/商家；周边食堂与校外条目共同参与最终评分及模型终选，不证明用户实时位置或配送可达。"
	}
	report["simulated_exposure"] = *simulateExposure
	if *simulateExposure {
		report["exposure_scenario"] = "顺序模拟看过此前v3三个选项；v2.1/v3共享相同曝光输入，不视为选择或摄入，不是全天联合食谱"
	}
	emit(report, *output)
}

func emit(value any, output string) {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		fail("报告序列化失败")
	}
	if output != "" {
		if err := os.MkdirAll(filepath.Dir(output), 0700); err != nil {
			fail("报告目录创建失败")
		}
		if err := os.WriteFile(output, b, 0600); err != nil {
			fail("报告保存失败")
		}
		fmt.Println("报告已保存：" + output)
	} else {
		fmt.Println(string(b))
	}
}

func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(1) }

type readOnlyStatsRepo struct{ service.StatsRepo }

func runSelfChecks() map[string]any {
	checks := []map[string]any{}
	check := func(name string, ok bool) {
		checks = append(checks, map[string]any{"name": name, "passed": ok})
		if !ok {
			fail("不变量失败：" + name)
		}
	}
	zero := nutritionagg.Observe([]map[string]any{{"sodiumMg": 0}}, false)["sodiumMg"]
	missing := nutritionagg.Observe([]map[string]any{{"name": "未知餐食"}}, false)["sodiumMg"]
	check("真实零与缺失分开", zero.Complete() && zero.Value == 0 && !missing.Complete())
	partial := nutritionagg.Observe([]map[string]any{{"fiber": 5}, {"name": "另一配料"}}, false)["fiber"]
	check("部分小计不当完整餐食", partial.Value == 5 && partial.Status == "partial" && !partial.Complete())
	intake := nutritionagg.Observe([]map[string]any{{"fiber": 10, "ratio": 50}}, true)["fiber"]
	check("按确认摄入比例缩放", intake.Complete() && intake.Value == 5)
	invalid := nutritionagg.Observe([]map[string]any{{"fiber": 10, "ratio": -20}}, true)["fiber"]
	check("无效摄入比例不补成整份", !invalid.Complete())
	combined := nutritionagg.Combine(nutritionagg.Observe([]map[string]any{{"fiber": 5}}, false), nutritionagg.Vector{})["fiber"]
	check("组合餐传播未知配菜", combined.Value == 5 && !combined.Complete())
	input := service.DietRecommendationInput{EngineVersion: "v3", MealType: "dinner", Targets: service.DietRecommendationMacro{Calories: 2000, Protein: 100, Carbs: 250, Fat: 60}, MacroGaps: service.DietRecommendationMacro{Calories: 600, Protein: 30, Carbs: 75, Fat: 18},
		DecisionBasis: &service.DietDecisionBasis{NutrientState: &service.DietNutrientState{Rules: []service.DietNutrientRule{{Key: "fiber", Unit: "g", Target: 25}, {Key: "sodiumMg", Unit: "mg", Limit: 2000}}}},
	}
	base := domain.DietRecommendationCandidate{Source: "public_food_library", SourceID: "a", Title: "鸡肉蔬菜饭", Calories: 600, Protein: 30, Carbs: 75, Fat: 18, Price: 25, CanteenName: "食堂", NutritionBasis: "library_record"}
	good := base
	good.Nutrients = nutritionagg.Observe([]map[string]any{{"fiber": 10, "sodiumMg": 500}}, false)
	bad := base
	bad.SourceID, bad.Title, bad.Price = "b", "低价鸡肉饭", 1
	bad.Nutrients = nutritionagg.Observe([]map[string]any{{"fiber": 0, "sodiumMg": 3500}}, false)
	unknown := base
	unknown.SourceID, unknown.Title, unknown.Price = "c", "未填微量鸡肉饭", 1
	ranked := service.EvaluateDietDecisionCandidates(input, []domain.DietRecommendationCandidate{unknown, bad, good})
	check("相同宏量时微量改变排序", len(ranked) == 3 && ranked[0].Candidate.SourceID == "a")
	check("低价不能抵消营养劣势", ranked[0].Scores.HealthFit > ranked[1].Scores.HealthFit)
	byID := map[string]float64{}
	for _, e := range ranked {
		byID[e.Candidate.SourceID] = e.Scores.HealthFit
	}
	check("缺失不取得零钠优势", byID["c"] <= byID["b"])
	legacyInput := input
	legacyInput.EngineVersion = "v2.1"
	legacy := service.EvaluateDietDecisionCandidates(legacyInput, []domain.DietRecommendationCandidate{good})
	check("旧版本可执行且未换成新公式", len(legacy) == 1 && legacy[0].Scores.Version == "foodlink-diet-decision-v2.1" && math.Abs(legacy[0].Scores.BalancedUtility-
		(legacy[0].Scores.HealthFit*.55+legacy[0].Scores.Adherence*.30+legacy[0].Scores.Confidence*.15-legacy[0].Scores.RiskPenalty)) <= .11)
	check("新版分项有版本和营养依据", ranked[0].Scores.Version == "foodlink-diet-decision-v3" && len(ranked[0].Scores.NutrientEffects) == 2)
	return map[string]any{"status": "passed", "count": len(checks), "checks": checks, "database_access": false, "model_calls": 0}
}
