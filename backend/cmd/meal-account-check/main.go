// Read-only account diagnostic. Run from backend; -model explicitly opts into
// real model usage. Chat writes stay in memory and no credit guard is attached.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/health/domain"
	healthrepo "food_link/backend/internal/health/repo"
	"food_link/backend/internal/health/service"
	homerepo "food_link/backend/internal/home/repo"
	homeservice "food_link/backend/internal/home/service"
	publicfoodrepo "food_link/backend/internal/publicfood/repo"
	publicfoodservice "food_link/backend/internal/publicfood/service"
	recipedomain "food_link/backend/internal/recipe/domain"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"github.com/google/uuid"
)

type memoryRepo struct {
	service.StatsRepo
	session  *domain.PetChatSession
	messages []domain.PetChatMessage
}

type conversationSpec struct {
	Name                   string   `json:"name"`
	Questions              []string `json:"questions"`
	HomeEntry              bool     `json:"home_entry"`
	CatalogLocationFixture string   `json:"catalog_location_fixture,omitempty"`
}

func (r *memoryRepo) LatestMealArea(ctx context.Context, userID string) (*domain.MealArea, error) {
	if repo, ok := r.StatsRepo.(interface {
		LatestMealArea(context.Context, string) (*domain.MealArea, error)
	}); ok {
		return repo.LatestMealArea(ctx, userID)
	}
	return nil, nil
}

func (r *memoryRepo) CreatePetChatSession(_ context.Context, s domain.PetChatSession) (*domain.PetChatSession, error) {
	s.ID = uuid.NewString()
	r.session = &s
	return &s, nil
}
func (r *memoryRepo) GetPetChatSession(context.Context, string, string) (*domain.PetChatSession, error) {
	return r.session, nil
}
func (r *memoryRepo) GetPetChatSessionMessages(_ context.Context, _, _ string, limit int) ([]domain.PetChatMessage, error) {
	start := len(r.messages) - limit
	if start < 0 {
		start = 0
	}
	return append([]domain.PetChatMessage(nil), r.messages[start:]...), nil
}
func (r *memoryRepo) GetLatestPetChatSessionWithMessages(context.Context, string, int) (*domain.PetChatSession, []domain.PetChatMessage, error) {
	return r.session, r.messages, nil
}
func (r *memoryRepo) ListPetChatSessions(context.Context, string, int) ([]domain.PetChatSession, error) {
	return nil, nil
}
func (r *memoryRepo) AddPetChatMessage(_ context.Context, m domain.PetChatMessage) (*domain.PetChatMessage, error) {
	m.ID = uuid.NewString()
	r.messages = append(r.messages, m)
	return &m, nil
}
func (r *memoryRepo) TouchPetChatSession(context.Context, string, string, string, string, int) error {
	return nil
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func main() {
	nickname := flag.String("nickname", "小马哥", "exact nickname; ambiguous matches abort")
	accountID := flag.String("user-id", "", "explicit account ID after resolving duplicate nicknames")
	date := flag.String("date", "2026-09-28", "dashboard date, China time")
	model := flag.Bool("model", false, "run a real model conversation with no injected GPS")
	conversationFile := flag.String("conversation-file", "", "JSON conversation scenarios; all chat writes stay in memory; catalog locations are labelled fixtures")
	renderFile := flag.String("render-evidence", "", "render a saved evidence.json as readable conversations without database or model calls")
	fixture := flag.Bool("location-fixture", false, "also exercise catalog coordinates as a labelled fixture, NOT the account's current position")
	out := flag.String("out", "../output/meal-account-check", "local evidence directory")
	flag.Parse()
	if *renderFile != "" {
		must(renderConversations(*renderFile))
		return
	}
	cfg, err := config.Load(".")
	must(err)
	db, err := database.Open(cfg.Database)
	must(err)
	sqlDB, err := db.DB()
	must(err)
	defer sqlDB.Close()
	tx := db.Begin(&sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	must(tx.Error)
	defer tx.Rollback()
	if cfg.Database.Schema != "" {
		if !regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`).MatchString(cfg.Database.Schema) {
			panic("invalid schema")
		}
		must(tx.Exec("SET LOCAL search_path TO " + cfg.Database.Schema).Error)
	}
	must(tx.Exec("SET LOCAL statement_timeout = '30000'").Error)
	var identities []struct {
		ID       string
		Nickname string
	}
	must(tx.Table("weapp_user").Select("id,nickname").Where("nickname = ?", *nickname).Find(&identities).Error)
	if len(identities) != 1 && *accountID == "" {
		for _, identity := range identities {
			var summary struct {
				Records    int64
				LastRecord *time.Time
				Recipes    int64
			}
			must(tx.Raw(`SELECT COUNT(*) AS records, MAX(record_time) AS last_record,
			(SELECT COUNT(*) FROM user_recipes WHERE user_id=?) AS recipes FROM user_food_records WHERE user_id=?`, identity.ID, identity.ID).Scan(&summary).Error)
			fmt.Printf("同名账号：id=%s，记录=%d，食谱=%d，最近记录=%v\n", identity.ID, summary.Records, summary.Recipes, summary.LastRecord)
		}
	}
	if *accountID != "" {
		matched := identities[:0]
		for _, identity := range identities {
			if identity.ID == *accountID {
				matched = append(matched, identity)
			}
		}
		identities = matched
	}
	if len(identities) != 1 {
		panic(fmt.Sprintf("exact nickname matches=%d; cannot choose an account", len(identities)))
	}
	uid := identities[0].ID
	var locationEvidence []struct {
		CreatedAt time.Time `json:"created_at"`
		Province  string    `json:"province"`
		City      string    `json:"city"`
		District  string    `json:"district"`
	}
	must(tx.Raw(`SELECT created_at, payload->>'province' AS province,
		payload->>'city' AS city, payload->>'district' AS district
		FROM analysis_tasks WHERE user_id=? AND
		(COALESCE(payload->>'province','')<>'' OR COALESCE(payload->>'city','')<>'' OR COALESCE(payload->>'district','')<>'')
		ORDER BY created_at DESC LIMIT 5`, uid).Scan(&locationEvidence).Error)
	repo := healthrepo.NewStatsRepo(tx)
	ctx := context.Background()
	p, err := repo.GetUserProfile(ctx, uid)
	must(err)
	tz := time.FixedZone("Asia/Shanghai", 8*3600)
	day, err := time.ParseInLocation("2006-01-02", *date, tz)
	must(err)
	records, err := repo.GetFoodRecordsForDateRange(ctx, uid, day.AddDate(0, 0, -29).UTC(), day.AddDate(0, 0, 1).UTC())
	must(err)
	var total int64
	must(tx.Table("user_food_records").Where("user_id = ?", uid).Count(&total).Error)
	var recipes []recipedomain.Recipe
	must(tx.Where("user_id = ?", uid).Order("updated_at desc").Find(&recipes).Error)
	dashboard, err := homeservice.NewDashboardService(authrepo.NewUserRepo(tx), homerepo.NewHomeRepo(tx)).HomeDashboard(ctx, uid, *date)
	must(err)
	history := make([]map[string]any, 0, len(records))
	frequency := map[string]int{}
	for _, record := range records {
		items := make([]map[string]any, 0, len(record.Items))
		for _, item := range record.Items {
			name, _ := item["name"].(string)
			if name != "" {
				frequency[name]++
			}
			items = append(items, map[string]any{"name": name, "weight": item["weight"], "intake": item["intake"], "ratio": item["ratio"]})
		}
		history = append(history, map[string]any{"id": record.ID, "date": record.RecordTime, "meal_type": record.MealType, "items": items, "calories": record.TotalCalories, "protein": record.TotalProtein, "carbs": record.TotalCarbs, "fat": record.TotalFat})
	}
	report := map[string]any{"nickname": *nickname, "date": *date, "timestamp": time.Now().In(tz).Format(time.RFC3339), "total_records": total, "records_30d": len(records), "recipes_count": len(recipes), "history": history, "food_frequency": frequency, "dashboard": dashboard, "recipes": recipes,
		"notes": []string{"数据库事务只读，无扣费服务；对话只在内存，不读写原账号聊天", "未注入GPS、学校身份或就餐资格；真实模型输出不等于质量合格", "首页按指定日期回放；模型服务按运行时日期读取上下文，跨午夜可能有一天差异"}}
	if p != nil {
		report["profile"] = map[string]any{"diet_goal": p.DietGoal, "health_condition": p.HealthCondition}
	}
	report["historical_area_context"] = locationEvidence
	// Read-only catalog audit: map visibility and recommendation availability
	// are separate concerns. No account coordinates are inferred here.
	var campusCatalog []struct {
		School          string `json:"school"`
		Canteen         string `json:"canteen"`
		Published       int    `json:"published"`
		WithCoordinates int    `json:"with_coordinates"`
		WithNutrition   int    `json:"with_nutrition"`
	}
	must(tx.Raw(`SELECT school_name AS school, canteen_name AS canteen, COUNT(*) AS published,
		COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND NOT(latitude=0 AND longitude=0)) AS with_coordinates,
		COUNT(*) FILTER (WHERE total_calories > 0) AS with_nutrition
		FROM public_food_library WHERE status='published' AND school_name LIKE '%清华%'
		GROUP BY school_name,canteen_name ORDER BY COUNT(*) DESC`).Scan(&campusCatalog).Error)
	report["tsinghua_published_catalog"] = campusCatalog
	mapSpots, err := publicfoodservice.NewPublicFoodService(publicfoodrepo.NewPublicFoodRepo(tx)).ListMapSpots(ctx, uid)
	must(err)
	campusMap := []map[string]any{}
	for _, spot := range mapSpots {
		if strings.Contains(spot.LocationName, "清华") || strings.Contains(spot.FeaturedItem.SchoolName, "清华") {
			campusMap = append(campusMap, map[string]any{"location": spot.LocationName, "food_count": spot.FoodCount, "location_level": spot.LocationLevel})
		}
	}
	report["tsinghua_map_spots"] = campusMap
	preview, previewErr := service.NewStatsService(repo, nil, cfg).PreviewMeals(ctx, uid, service.MealPreviewInput{MealType: "dinner"})
	must(previewErr)
	report["home_preview"] = preview
	if *fixture {
		var places []struct {
			Merchant  string
			Latitude  float64
			Longitude float64
			Count     int
		}
		must(tx.Raw(`SELECT merchant_name AS merchant,latitude,longitude,count(*) AS count FROM public_food_library WHERE status='published' AND COALESCE(is_campus_food,false)=false AND COALESCE(type,'')<>'campus' AND COALESCE(merchant_name,'')<>'' AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND NOT(latitude=0 AND longitude=0) GROUP BY merchant_name,latitude,longitude ORDER BY count(*) DESC LIMIT 5`).Scan(&places).Error)
		results := []map[string]any{}
		for _, place := range places {
			location := &domain.DietLocation{Latitude: place.Latitude, Longitude: place.Longitude, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli(), AccuracyM: 50}
			result, e := service.NewStatsService(repo, nil, cfg).PreviewMeals(ctx, uid, service.MealPreviewInput{MealType: "dinner", Location: location})
			must(e)
			results = append(results, map[string]any{"fixture_only": true, "note": "使用库内商家坐标验证附近召回，不代表小马哥当前位置", "merchant": place.Merchant, "catalog_count": place.Count, "preview": result})
		}
		report["location_fixtures"] = results
	}
	abs, err := filepath.Abs(*out)
	must(err)
	must(os.MkdirAll(abs, 0700))
	save := func() {
		raw, e := json.MarshalIndent(report, "", "  ")
		must(e)
		must(os.WriteFile(filepath.Join(abs, "evidence.json"), raw, 0600))
	}
	save()
	fmt.Printf("账号已匹配：%s，全部记录=%d，近30天=%d，私人食谱=%d；证据=%s\n", *nickname, total, len(records), len(recipes), abs)
	if !*model {
		return
	}
	memory := &memoryRepo{StatsRepo: repo}
	svc := service.NewStatsService(memory, nil, cfg)
	turns := []map[string]any{}
	questions := []string{
		"下一餐吃什么？请直接从我过去真实记录过的餐食里选一餐，给出具体菜名、记录日期和原来的份量，并说明为什么适合我。不要给通用搭配，也不要把没吃过的说成吃过。",
		"你刚才选的餐食确实在我的历史记录里吗？请给出能核对的日期和菜名；查不到就明确说查不到，不要用私人收藏食谱代替历史记录。",
		"那我身边已有收录的餐食呢？请推荐具体商家或食堂的菜。你现在有没有我的可靠位置，以及我能否在那里就餐的信息？没有就不要默认任何学校。",
		"我先不提供位置，也不去学校食堂。请回到我的历史餐食里换一份晚餐；保留前面的来源要求，找不到合适的一整餐就说原因。",
	}
	scenarios := []conversationSpec{{Name: "history_source_check", Questions: questions}}
	if *conversationFile != "" {
		data, e := os.ReadFile(*conversationFile)
		must(e)
		must(json.Unmarshal(data, &scenarios))
		if len(scenarios) == 0 {
			panic("empty scenarios")
		}
	}
	for _, scenario := range scenarios {
		memory = &memoryRepo{StatsRepo: repo}
		svc = service.NewStatsService(memory, nil, cfg)
		var location *domain.DietLocation
		if scenario.CatalogLocationFixture != "" {
			var coordinate struct{ Latitude, Longitude float64 }
			must(tx.Table("schools").Select("latitude,longitude").Where("name = ? AND status = ? AND latitude IS NOT NULL AND longitude IS NOT NULL", scenario.CatalogLocationFixture, "active").Take(&coordinate).Error)
			location = &domain.DietLocation{Latitude: coordinate.Latitude, Longitude: coordinate.Longitude, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli(), AccuracyM: 50}
			if !location.Valid(time.Now()) {
				panic("invalid catalog fixture coordinates")
			}
		}
		for i, q := range scenario.Questions {
			input := service.PetChatInput{Question: q, Range: "month", NewSession: memory.session == nil}
			if location != nil {
				location.CapturedAt = time.Now().UnixMilli()
				input.Location = location
			}
			if scenario.HomeEntry {
				input.EntryContext = &service.PetChatEntryContext{Source: "home_next_meal", Date: *date, MealType: "dinner", MealLabel: "晚餐"}
				if preview != nil && len(preview.Recommendations) > 0 {
					input.EntryContext.SelectedSourceID = preview.Recommendations[0].SourceID
					input.EntryContext.BasicAdvice = preview.Recommendations[0].Title
				}
			}
			if memory.session != nil {
				input.SessionID = memory.session.ID
			}
			requestCtx, cancel := context.WithTimeout(ctx, 100*time.Second)
			start := time.Now()
			stream, e := svc.GeneratePetChatStream(requestCtx, uid, input)
			turn := map[string]any{"scenario": scenario.Name, "turn": i + 1, "question": q, "catalog_location_fixture": scenario.CatalogLocationFixture, "home_entry": scenario.HomeEntry}
			answer := ""
			if e != nil {
				turn["error"] = e.Error()
			} else {
				for chunk := range stream {
					switch chunk.Type {
					case "chunk":
						answer += chunk.Text
					case "diet_result":
						turn["diet_result"] = chunk.DietResult
					case "error":
						turn["error"] = chunk.Error
					case "done":
						turn["stream_meta"] = chunk.Meta
					}
				}
			}
			cancel()
			turn["answer"] = answer
			turn["seconds"] = time.Since(start).Seconds()
			if len(memory.messages) > 0 {
				turn["agent_run"] = memory.messages[len(memory.messages)-1].Meta["agent_run"]
			}
			turns = append(turns, turn)
			report["turns"] = turns
			save()
			fmt.Printf("%s 第%d轮完成，耗时%.1f秒，回复%d字\n", scenario.Name, i+1, time.Since(start).Seconds(), len([]rune(answer)))
		}
	}
}

func renderConversations(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var evidence struct {
		Nickname  string `json:"nickname"`
		Timestamp string `json:"timestamp"`
		Turns     []struct {
			Scenario string                         `json:"scenario"`
			Turn     int                            `json:"turn"`
			Question string                         `json:"question"`
			Answer   string                         `json:"answer"`
			Seconds  float64                        `json:"seconds"`
			Fixture  string                         `json:"catalog_location_fixture"`
			Result   *service.CampusDietAgentResult `json:"diet_result"`
		} `json:"turns"`
	}
	if err := json.Unmarshal(raw, &evidence); err != nil {
		return err
	}
	var doc strings.Builder
	fmt.Fprintf(&doc, "# 餐食助手真实连续对话回放\n\n账号：%s；时间：%s。\n\n使用账号真实档案与饮食记录、现有餐食库和真实模型。数据库事务只读，聊天只保存在内存，未修改账号聊天、档案或积分。标注位置 fixture 的场景使用库内学校坐标，不代表账号当前 GPS。\n\n", evidence.Nickname, evidence.Timestamp)
	lastScenario := ""
	for _, turn := range evidence.Turns {
		if turn.Scenario != lastScenario {
			fmt.Fprintf(&doc, "## %s\n\n", turn.Scenario)
			lastScenario = turn.Scenario
		}
		if turn.Fixture != "" {
			fmt.Fprintf(&doc, "位置条件：%s的库内坐标 fixture，非实时定位。\n\n", turn.Fixture)
		}
		fmt.Fprintf(&doc, "### 第%d轮\n\n用户：%s\n\n助手：%s\n\n", turn.Turn, turn.Question, turn.Answer)
		if turn.Result != nil {
			for _, meal := range turn.Result.Recommendation.Recommendations {
				place := []string{}
				for _, part := range []string{meal.SchoolName, meal.CanteenName, meal.Floor, meal.WindowName, meal.MerchantName, meal.Address} {
					if part != "" {
						place = append(place, part)
					}
				}
				if meal.HistoryDate != "" {
					place = []string{"本人记录 · " + meal.HistoryDate + "，没有当前商家地点"}
				}
				price := ""
				if meal.Price > 0 {
					price = fmt.Sprintf("；库内价格 %.2f %s", meal.Price, meal.PriceUnit)
				}
				fmt.Fprintf(&doc, "- %s — %s%s\n", meal.Title, strings.Join(place, " · "), price)
			}
			fmt.Fprintf(&doc, "\n耗时 %.1f 秒，工具调用 %d 次，生成来源 `%s`", turn.Seconds, turn.Result.ToolCount, turn.Result.Recommendation.GeneratedBy)
			if turn.Result.FallbackReason != "" {
				fmt.Fprintf(&doc, "，原因 `%s`", turn.Result.FallbackReason)
			}
			doc.WriteString("。\n\n")
		}
	}
	if filepath.Base(path) != "evidence.json" {
		return fmt.Errorf("render expects evidence.json")
	}
	output := filepath.Join(filepath.Dir(path), "conversations.md")
	if err := os.WriteFile(output, []byte(doc.String()), 0600); err != nil {
		return err
	}
	fmt.Printf("对话稿：%s\n", output)
	return nil
}
