package service

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	healthrepo "food_link/backend/internal/health/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// This opt-in observation suite uses actual user records but replaces all chat
// persistence with memory. Every database connection is in a read-only transaction.
// Completion is NOT a recommendation-quality pass; inspect transcript/checks.
type mealEvalUser struct {
	ID             string `json:"-"`
	Alias          string
	Records        int
	Days           int
	LastRecord     string
	Goal           string
	HasSavedSchool bool
	TopFoods       []mealFoodFrequency     `gorm:"-"`
	Average        DietRecommendationMacro `gorm:"-"`
	RecentMeals    []mealHistoryEvidence   `gorm:"-"`
}
type mealEvalPoint struct {
	Label     string
	Latitude  float64 `json:"-"`
	Longitude float64 `json:"-"`
}
type mealEvalCatalog struct {
	Published                 int64
	Campus                    int64
	NamedNonCampusMerchant    int64
	GeocodedNonCampusMerchant int64
	MerchantPoint             mealEvalPoint
	CampusPoint               mealEvalPoint
}
type mealEvalReply struct {
	Model              string
	Content            string
	Tools              []campusDietAgentToolCall
	HasHistoryEvidence bool
}
type mealEvalTransport struct {
	base    http.RoundTripper
	replies []mealEvalReply
	mu      sync.Mutex
}

func (c *mealEvalTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	hasHistory := false
	if req.GetBody != nil {
		body, err := req.GetBody()
		if err == nil {
			raw, _ := io.ReadAll(body)
			_ = body.Close()
			hasHistory = bytes.Contains(raw, []byte("food_frequency"))
		}
	}
	resp, err := c.base.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		return nil, err
	}
	resp.Body = io.NopCloser(bytes.NewReader(raw))
	var parsed struct {
		Model   string
		Choices []struct {
			Message struct {
				Content   string
				ToolCalls []campusDietAgentToolCall `json:"tool_calls"`
			}
		}
	}
	reply := mealEvalReply{HasHistoryEvidence: hasHistory}
	if json.Unmarshal(raw, &parsed) == nil && len(parsed.Choices) > 0 {
		reply.Model, reply.Content, reply.Tools = parsed.Model, parsed.Choices[0].Message.Content, parsed.Choices[0].Message.ToolCalls
	} else {
		var content strings.Builder
		for _, line := range strings.Split(string(raw), "\n") {
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			var event struct {
				Model   string
				Choices []struct{ Delta struct{ Content string } }
			}
			if json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &event) == nil && len(event.Choices) > 0 {
				content.WriteString(event.Choices[0].Delta.Content)
				reply.Model = event.Model
			}
		}
		reply.Content = content.String()
	}
	c.mu.Lock()
	c.replies = append(c.replies, reply)
	c.mu.Unlock()
	return resp, nil
}

type mealEvalMemoryRepo struct {
	StatsRepo
	session  *domain.PetChatSession
	messages []domain.PetChatMessage
}

func (r *mealEvalMemoryRepo) CreatePetChatSession(_ context.Context, s domain.PetChatSession) (*domain.PetChatSession, error) {
	s.ID = uuid.NewString()
	r.session = &s
	return &s, nil
}
func (r *mealEvalMemoryRepo) GetPetChatSession(_ context.Context, _, _ string) (*domain.PetChatSession, error) {
	return r.session, nil
}
func (r *mealEvalMemoryRepo) GetPetChatSessionMessages(_ context.Context, _, _ string, limit int) ([]domain.PetChatMessage, error) {
	start := len(r.messages) - limit
	if start < 0 {
		start = 0
	}
	return append([]domain.PetChatMessage(nil), r.messages[start:]...), nil
}
func (r *mealEvalMemoryRepo) AddPetChatMessage(_ context.Context, m domain.PetChatMessage) (*domain.PetChatMessage, error) {
	m.ID = uuid.NewString()
	r.messages = append(r.messages, m)
	return &m, nil
}
func (r *mealEvalMemoryRepo) TouchPetChatSession(_ context.Context, _, _, _, _ string, _ int) error {
	return nil
}

type mealEvalTurn struct {
	Question         string
	LocationProvided bool
	RoutedToHarness  bool
	Answer           string
	Error            string `json:",omitempty"`
	DurationSeconds  float64
	Result           *CampusDietAgentResult `json:",omitempty"`
	ModelReplies     []mealEvalReply
	Checks           []string
}
type mealEvalScenario struct {
	Name          string
	User          mealEvalUser
	LocationLabel string
	Expectations  []string
	Turns         []mealEvalTurn
}
type mealEvalReport struct {
	Timestamp string
	Harness   string
	Notes     []string
	Users     []mealEvalUser
	Catalog   mealEvalCatalog
	Scenarios []mealEvalScenario
}

func mealEvalReadOnly(t *testing.T, db *gorm.DB, schema string) *gorm.DB {
	t.Helper()
	tx := db.Begin(&sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	require.NoError(t, tx.Error)
	t.Cleanup(func() { _ = tx.Rollback().Error })
	if schema != "" {
		require.Regexp(t, `^[A-Za-z_][A-Za-z0-9_]*$`, schema)
		require.NoError(t, tx.Exec("SET LOCAL search_path TO "+schema).Error)
	}
	return tx
}

func mealEvalDiscover(t *testing.T, db *gorm.DB) ([]mealEvalUser, mealEvalCatalog) {
	t.Helper()
	now := time.Now().In(chinaTZ)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, chinaTZ).AddDate(0, 0, -29)
	var users []mealEvalUser
	require.NoError(t, db.Raw(`SELECT f.user_id AS id, COUNT(*) AS records, TO_CHAR(MAX(f.record_time), 'YYYY-MM-DD') AS last_record
		FROM user_food_records f JOIN weapp_user u ON u.id=f.user_id
		WHERE f.record_time >= ? AND f.record_time <= ? GROUP BY f.user_id ORDER BY COUNT(*) DESC, f.user_id LIMIT 20`, start.UTC(), now.UTC()).Scan(&users).Error)
	require.GreaterOrEqual(t, len(users), 5, "need five real active users")
	r := healthrepo.NewStatsRepo(db)
	for i := range users {
		users[i].Alias = fmt.Sprintf("用户%02d", i+1)
		p, err := r.GetUserProfile(context.Background(), users[i].ID)
		require.NoError(t, err)
		if p != nil {
			if p.DietGoal != nil {
				users[i].Goal = *p.DietGoal
			}
			users[i].HasSavedSchool = dietRecommendationMapString(mapFromAny(p.HealthCondition["campus_dining_preference"]), "school_id") != ""
		}
		records, err := r.GetFoodRecordsForDateRange(context.Background(), users[i].ID, start.UTC(), now.UTC())
		require.NoError(t, err)
		history := summarizeMealHistory(records, now)
		users[i].Days = history.RecordedDays
		users[i].Average = history.Average
		users[i].RecentMeals = history.RecentMeals
		if len(users[i].RecentMeals) > 8 {
			users[i].RecentMeals = users[i].RecentMeals[:8]
		}
		users[i].TopFoods = history.FoodFrequency
		if len(users[i].TopFoods) > 5 {
			users[i].TopFoods = users[i].TopFoods[:5]
		}
	}
	var c mealEvalCatalog
	require.NoError(t, db.Table("public_food_library").Where("status='published'").Count(&c.Published).Error)
	require.NoError(t, db.Table("public_food_library").Where("status='published' AND is_campus_food=true").Count(&c.Campus).Error)
	require.NoError(t, db.Table("public_food_library").Where("status='published' AND COALESCE(is_campus_food,false)=false AND COALESCE(merchant_name,'')<>''").Count(&c.NamedNonCampusMerchant).Error)
	require.NoError(t, db.Table("public_food_library").Where("status='published' AND COALESCE(is_campus_food,false)=false AND COALESCE(merchant_name,'')<>'' AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND NOT(latitude=0 AND longitude=0)").Count(&c.GeocodedNonCampusMerchant).Error)
	require.NoError(t, db.Raw(`SELECT name AS label,latitude,longitude FROM schools WHERE name='清华大学' AND status='active' LIMIT 1`).Scan(&c.CampusPoint).Error)
	require.NotZero(t, c.CampusPoint.Latitude)
	require.NoError(t, db.Raw(`SELECT merchant_name AS label,latitude,longitude FROM public_food_library
		WHERE status='published' AND COALESCE(is_campus_food,false)=false AND COALESCE(merchant_name,'')<>'' AND total_calories>0
		AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND NOT(latitude=0 AND longitude=0)
		GROUP BY merchant_name,latitude,longitude ORDER BY COUNT(*) DESC,merchant_name LIMIT 1`).Scan(&c.MerchantPoint).Error)
	if c.MerchantPoint.Latitude == 0 {
		c.MerchantPoint = c.CampusPoint
		c.MerchantPoint.Label += "（无可用商家坐标，使用公开校园测试点）"
	}
	return users, c
}

func TestMealAgentFiveRealUserConversations(t *testing.T) {
	if os.Getenv("FOODLINK_EVAL_REAL_USERS") != "1" {
		t.Skip("explicit opt-in: real-user read-only meal evaluation")
	}
	cfg, err := config.Load("../../..")
	require.NoError(t, err)
	db, err := database.Open(cfg.Database)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	catalogDB := mealEvalReadOnly(t, db, cfg.Database.Schema)
	users, catalog := mealEvalDiscover(t, catalogDB)
	report := mealEvalReport{Timestamp: time.Now().In(chinaTZ).Format(time.RFC3339), Harness: mealHarnessVersion, Users: users, Catalog: catalog,
		Notes: []string{"真实用户近30天饮食、健康档案与近期运动只读；不读取原用户聊天，新测试对话仅在内存中", "所有数据库事务只读，未注入积分服务，未写入真实会话或扣用户积分；真实模型 API 会有用量", "位置是公共地图餐食/学校坐标构造的测试位置，不是这些用户的实时 GPS", "运行本地当前源码的 GeneratePetChatStream 生产入口，保留路由、会话连续性、Agent工具和后处理；没有启动 HTTP 服务或微信界面", "测试完成不代表推荐质量通过，人工评估见单独结论；模型原始回复与最终用户可见回复分别保留"}}
	outDir, err := filepath.Abs(filepath.Join("../../../../output/meal-agent-eval-20260926", time.Now().Format("20060102-150405")))
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(outDir, 0700))
	save := func() {
		raw, e := json.MarshalIndent(report, "", "  ")
		require.NoError(t, e)
		require.NoError(t, os.WriteFile(filepath.Join(outDir, "results.json"), raw, 0600))
		require.NoError(t, os.WriteFile(filepath.Join(outDir, "完整对话.md"), []byte(mealEvalMarkdown(report)), 0600))
	}
	save()
	t.Logf("EVAL_REPORT_DIR=%s", outDir)
	if os.Getenv("FOODLINK_EVAL_DISCOVER") == "1" {
		t.Logf("EVAL_DISCOVERY users=%d published=%d campus=%d merchants=%d geocoded_merchants=%d point=%s", len(users), catalog.Published, catalog.Campus, catalog.NamedNonCampusMerchant, catalog.GeocodedNonCampusMerchant, catalog.MerchantPoint.Label)
		return
	}
	noSchool := 4
	for i := 4; i < len(users); i++ {
		if !users[i].HasSavedSchool {
			noSchool = i
			break
		}
	}
	type scenarioSpec struct {
		name         string
		user         int
		point        mealEvalPoint
		questions    []string
		expectations []string
	}
	specs := []scenarioSpec{
		{"历史饮食与避免重复", 0, catalog.CampusPoint, []string{"我在附近准备吃晚饭，帮我按最近一个月的饮食记录和个人目标，推荐这餐吃什么。", "为什么选这些？请具体说说我最近吃得比较多的食物，以及这餐需要换什么。", "我不想再吃最近反复吃的东西，换一批，清淡一点。", "这餐预算20元以内，前面的要求不变。"}, []string{"读取真实历史并准确引用，不把记录空白当没吃", "换一批不重复之前菜品，预算约束继承"}},
		{"训练后需求连续调整", 1, catalog.CampusPoint, []string{"我刚做完45分钟力量训练，附近晚餐吃什么？请结合我的饮食记录，不要只给通用建议。", "今天不吃鸡肉，预算20元以内。", "我长期还是想减脂，重新推荐500大卡以下的餐，刚才的忌口和预算保持。", "这几道分别在哪里能买到？不要换菜。"}, []string{"训练不强制改长期目标", "不吃鸡肉、20元、500kcal连续保留", "位置追问只解释原菜，不换菜"}},
		{"地图已收录外卖商家", 2, catalog.MerchantPoint, []string{"我想从附近地图里已经收录的外卖商家选晚餐，预算30元以内。请给出真实菜名、店名和地址。", "不要学校食堂，只看地图里收录的外卖商家，清淡一些。", "换一批，刚才的预算和商家范围不变。", "这几道具体是哪家店，在哪里？不知道的信息就直接说不知道。"}, []string{"使用真实商家菜品和地址，不捏造库存配送", "正确理解不要学校食堂", "预算与商家范围持续有效"}},
		{"多项忌口与局部解除", 3, catalog.CampusPoint, []string{"附近有什么适合我的晚餐？这餐不吃花生，也不吃虾，预算25元以内。", "换一批，还是不要花生和虾，口味清淡些。", "今天可以吃虾了，但仍然不吃花生，预算还是25元，请重新推荐。", "为什么这次适合我？请确认没有把花生的限制也取消。"}, []string{"两项忌口分别执行", "仅解除虾，不误删花生；档案过敏不能被对话解除", "说明实际证据缺口，不承诺过敏安全"}},
		{"缺地点与不可满足预算", noSchool, catalog.CampusPoint, []string{"我今天在外地，不在常用学校。附近午餐吃什么？", "我现在在清华大学，请结合我的饮食记录推荐午餐。", "我的预算只有2元，希望一餐能吃饱，不要只推荐饮料或者单个鸡蛋。", "那预算提高到20元，午餐帮我重新选，其他要求不变。"}, []string{"无授权地点不把常用学校当当前位置", "需求不可满足时说明缺口，不硬凑一餐", "提高预算后能恢复具体推荐"}},
	}
	report.Users = nil
	for _, spec := range specs {
		report.Users = append(report.Users, users[spec.user])
	}
	// Two independent read-only conversations at a time. Turns within each are sequential.
	var reportMu sync.Mutex
	t.Run("conversations", func(t *testing.T) {
		for index, spec := range specs {
			t.Run(fmt.Sprintf("%02d", index+1), func(t *testing.T) {
				t.Parallel()
				tx := mealEvalReadOnly(t, db, cfg.Database.Schema)
				memory := &mealEvalMemoryRepo{StatsRepo: healthrepo.NewStatsRepo(tx)}
				svc := NewStatsService(memory, nil, cfg)
				base := svc.client.Transport
				if base == nil {
					base = http.DefaultTransport
				}
				capture := &mealEvalTransport{base: base}
				svc.client.Transport = capture
				result := mealEvalScenario{Name: spec.name, User: users[spec.user], LocationLabel: spec.point.Label, Expectations: spec.expectations}
				for turn, question := range spec.questions {
					input := PetChatInput{Question: question, Range: "month", NewSession: memory.session == nil}
					if memory.session != nil {
						input.SessionID = memory.session.ID
					}
					if index != 4 {
						input.Location = &domain.DietLocation{Latitude: spec.point.Latitude, Longitude: spec.point.Longitude, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}
					}
					ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
					entry := mealEvalTurn{Question: question, LocationProvided: input.Location != nil, RoutedToHarness: svc.shouldUseCampusDietAgent(ctx, users[spec.user].ID, input)}
					capture.mu.Lock()
					capture.replies = nil
					capture.mu.Unlock()
					started := time.Now()
					stream, e := svc.GeneratePetChatStream(ctx, users[spec.user].ID, input)
					if e != nil {
						entry.Error = e.Error()
					} else {
						for chunk := range stream {
							switch chunk.Type {
							case "chunk":
								entry.Answer += chunk.Text
							case "error":
								entry.Error = chunk.Error
							case "diet_result":
								entry.Result = chunk.DietResult
							}
						}
					}
					entry.DurationSeconds = time.Since(started).Seconds()
					cancel()
					capture.mu.Lock()
					entry.ModelReplies = append([]mealEvalReply(nil), capture.replies...)
					capture.mu.Unlock()
					entry.Checks = mealEvalChecks(index, turn, entry, result.Turns)
					result.Turns = append(result.Turns, entry)
					t.Logf("EVAL_TURN scenario=%d turn=%d route=%t options=%d duration=%.1fs error=%s", index+1, turn+1, entry.RoutedToHarness, mealEvalOptionCount(entry), entry.DurationSeconds, entry.Error)
				}
				reportMu.Lock()
				report.Scenarios = append(report.Scenarios, result)
				save()
				reportMu.Unlock()
			})
		}
	})
	t.Logf("EVAL_COMPLETE scenarios=%d path=%s", len(report.Scenarios), outDir)
}

func mealEvalOptionCount(turn mealEvalTurn) int {
	if turn.Result == nil {
		return 0
	}
	return len(turn.Result.Recommendation.Recommendations)
}
func mealEvalChecks(scenario, turn int, e mealEvalTurn, prior []mealEvalTurn) []string {
	checks := []string{}
	if e.Error != "" {
		checks = append(checks, "请求失败："+e.Error)
	}
	if !e.RoutedToHarness {
		checks = append(checks, "注意：本轮进入普通聊天，没有进入餐食Harness")
	}
	if e.Result == nil {
		return checks
	}
	if e.Result.FallbackReason != "" {
		checks = append(checks, "回退/澄清："+e.Result.FallbackReason)
	}
	maxPrice := 0.0
	if scenario == 0 && turn == 3 || scenario == 1 && turn >= 1 || scenario == 4 && turn == 3 {
		maxPrice = 20
	}
	if scenario == 2 {
		maxPrice = 30
	}
	if scenario == 3 {
		maxPrice = 25
	}
	if scenario == 4 && turn == 2 {
		maxPrice = 2
	}
	for _, o := range e.Result.Recommendation.Recommendations {
		if maxPrice > 0 && (o.Price <= 0 || o.Price > maxPrice) {
			checks = append(checks, "价格违约或未知："+o.Title)
		}
		if scenario == 1 && turn >= 2 && o.Calories > 500 {
			checks = append(checks, "热量超过500："+o.Title)
		}
		if scenario == 1 && turn >= 1 && strings.Contains(o.Title, "鸡") {
			checks = append(checks, "需核对鸡肉忌口："+o.Title)
		}
		if scenario == 2 && o.MerchantName == "" {
			checks = append(checks, "商家信息缺失或返回食堂："+o.Title)
		}
		if scenario == 3 && (strings.Contains(o.Title, "花生") || (turn < 2 && strings.Contains(o.Title, "虾"))) {
			checks = append(checks, "菜名命中本轮忌口："+o.Title)
		}
		if strings.Contains(e.Question, "换一批") {
			for _, p := range prior {
				if p.Result != nil {
					for _, old := range p.Result.Recommendation.Recommendations {
						if old.SourceID == o.SourceID {
							checks = append(checks, "换一批重复："+o.Title)
						}
					}
				}
			}
		}
	}
	return checks
}

func mealEvalMarkdown(report mealEvalReport) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# 餐食 Agent 五场景连续对话原始记录\n\n测试时间：%s\n\n", report.Timestamp)
	for _, n := range report.Notes {
		fmt.Fprintf(&b, "- %s\n", n)
	}
	fmt.Fprintf(&b, "\n数据概览：已发布 %d 条；校园 %d 条；非校园具名商家 %d 条；其中直接有坐标 %d 条。\n", report.Catalog.Published, report.Catalog.Campus, report.Catalog.NamedNonCampusMerchant, report.Catalog.GeocodedNonCampusMerchant)
	for _, s := range report.Scenarios {
		fmt.Fprintf(&b, "\n## %s\n\n%s：近30天 %d 条记录，覆盖 %d 天；档案目标 `%s`；地点为测试点：%s。\n\n历史高频食物（数据库实读）：", s.Name, s.User.Alias, s.User.Records, s.User.Days, s.User.Goal, s.LocationLabel)
		for _, f := range s.User.TopFoods {
			fmt.Fprintf(&b, "%s（%d条）；", f.Name, f.Count)
		}
		b.WriteString("\n\n检验目标：" + strings.Join(s.Expectations, "；") + "。\n")
		for i, tr := range s.Turns {
			fmt.Fprintf(&b, "\n### 第%d轮\n\n**用户：** %s\n\n**实际用户可见回答：**\n\n%s\n", i+1, tr.Question, tr.Answer)
			if tr.Error != "" {
				fmt.Fprintf(&b, "\n错误：%s\n", tr.Error)
			}
			if tr.Result != nil {
				for _, o := range tr.Result.Recommendation.Recommendations {
					place := strings.Join(compactDietStrings(o.SchoolName, o.CampusName, o.CanteenName, o.Floor, o.WindowName, o.MerchantName, o.Address), " · ")
					distance := ""
					if o.DistanceKM != nil {
						distance = fmt.Sprintf("；约 %.2f km", *o.DistanceKM)
					}
					fmt.Fprintf(&b, "\n- **%s**：¥%.2f/%s；%.0f kcal，蛋白 %.1fg，碳水 %.1fg，脂肪 %.1fg%s。\n  - 位置：%s\n  - 理由：%s\n  - 提示：%s\n", o.Title, o.Price, o.PriceUnit, o.Calories, o.Protein, o.Carbs, o.Fat, distance, place, o.Reason, strings.Join(o.Tips, "；"))
				}
				fmt.Fprintf(&b, "\n数据说明：%s\n", strings.Join(tr.Result.Recommendation.DataNotes, "；"))
			}
			fmt.Fprintf(&b, "\n耗时 %.1f 秒；进入餐食 Harness：%t。\n", tr.DurationSeconds, tr.RoutedToHarness)
			for _, c := range tr.Checks {
				fmt.Fprintf(&b, "\n- 自动检查：%s\n", c)
			}
			b.WriteString("\n<details>\n<summary>原始模型回复（未经业务后处理）及工具调用</summary>\n\n")
			for n, r := range tr.ModelReplies {
				fmt.Fprintf(&b, "调用 %d，模型 `%s`，已携带历史食物频率证据：%t\n\n", n+1, r.Model, r.HasHistoryEvidence)
				if len(r.Tools) > 0 {
					raw, _ := json.Marshal(r.Tools)
					fmt.Fprintf(&b, "```json\n%s\n```\n\n", raw)
				}
				if r.Content != "" {
					fmt.Fprintf(&b, "```text\n%s\n```\n\n", r.Content)
				}
			}
			b.WriteString("</details>\n")
		}
	}
	// UUIDs inside public dish IDs are useful evidence, but real user IDs are not.
	out := b.String()
	for _, u := range report.Users {
		out = strings.ReplaceAll(out, u.ID, u.Alias)
	}
	return out
}
