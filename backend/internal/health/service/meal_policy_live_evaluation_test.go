package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	healthrepo "food_link/backend/internal/health/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"github.com/stretchr/testify/require"
)

// Additional scenarios, not replacements for the unchanged v2 observation suite.
func TestMealPolicyRealUserConversations(t *testing.T) {
	if os.Getenv("FOODLINK_EVAL_REAL_USERS") != "1" {
		t.Skip("explicit opt-in: real model and read-only user data")
	}
	cfg, err := config.Load("../../..")
	require.NoError(t, err)
	db, err := database.Open(cfg.Database)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	tx := mealEvalReadOnly(t, db, cfg.Database.Schema)
	users, catalog := mealEvalDiscover(t, tx)
	var other mealEvalPoint
	require.NoError(t, tx.Raw(`SELECT s.name AS label,s.latitude,s.longitude FROM schools s JOIN public_food_library p ON p.school_id=s.id
		WHERE s.status='active' AND s.name <> '清华大学' AND s.latitude BETWEEN -90 AND 90 AND s.longitude BETWEEN -180 AND 180 AND s.latitude <> 0 AND s.longitude <> 0 AND p.status='published'
		GROUP BY s.id,s.name,s.latitude,s.longitude ORDER BY COUNT(*) DESC LIMIT 1`).Scan(&other).Error)
	require.NotEmpty(t, other.Label)
	report := mealEvalReport{Timestamp: time.Now().In(chinaTZ).Format(time.RFC3339), Harness: mealHarnessVersion, Users: users[:5], Catalog: catalog,
		Notes: []string{"真实用户档案与饮食只读；测试提问/位置为构造场景，未代表用户真实身份与定位", "内存聊天，不扣用户积分；真实模型调用有用量；未启动HTTP服务或微信UI", "五个新增场景每组四轮，覆盖已确认/未知/拒绝校园、另一个学校及中途换地点", "执行完成不是推荐质量合格，原文和工具调用保留供逐轮审阅"}}
	dir, err := filepath.Abs(filepath.Join("../../../../output/meal-agent-v3-eval", time.Now().Format("20060102-150405")))
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(dir, 0700))
	specs := []struct {
		name      string
		user      int
		point     *mealEvalPoint
		questions []string
	}{
		{"附近未知资格到明确确认再调整忌口", 0, &catalog.CampusPoint, []string{"我在清华大学附近，按历史记录推荐晚餐，预算20元以内。", "我可以在清华大学食堂吃饭，请推荐一餐。", "这餐不吃花生和虾，换一批，预算保持。", "虾今天可以吃了，但花生还是不吃，请确认限制并重新推荐。"}},
		{"确认可就餐的训练后完整晚餐", 1, &catalog.CampusPoint, []string{"我可以在清华大学食堂吃饭，刚做完45分钟力量训练，按历史记录推荐晚餐。", "今天不吃鸡肉，预算20元以内，要一餐的搭配。", "我长期想减脂，这一餐合计500大卡以下，预算和忌口保持。", "原方案分别在哪里买？不要换菜。"}},
		{"已有商家测试点且明确拒绝校园", 2, &catalog.MerchantPoint, []string{"我不是学生，也不能进学校食堂，只看附近已收录商家的晚餐，预算30元。", "清淡一点，商家范围和预算不变。", "不要学校食堂，也不扩大距离，还有其他选择吗？", "确认一下，没查到的地址和菜品不要编。"}},
		{"其他高校已确认可用且低预算", 3, &other, []string{fmt.Sprintf("我可以在%s食堂吃饭，请按历史记录推荐午餐。", other.Label), "不吃花生，预算20元以内，请给一餐。", "预算只有2元，希望一餐吃饱，不能只有单个鸡蛋或配菜。", "预算提高到20元，忌口保持，请重新推荐。"}},
		{"无定位到学校再中途换学校", 4, nil, []string{"今天在外地，附近午餐吃什么？预算20元，不吃花生。", "我在清华大学，可以在清华大学食堂吃饭，前面条件保持。", fmt.Sprintf("我现在换到%s了，预算和忌口不变，附近吃什么？", other.Label), fmt.Sprintf("我不能在%s食堂吃饭，只看校外商家。", other.Label)}},
	}
	t.Logf("V3_EVAL_DIR=%s OTHER_SCHOOL=%s", dir, other.Label)
	for scenarioIndex, spec := range specs {
		if selected := os.Getenv("FOODLINK_EVAL_SCENARIO"); selected != "" && !strings.Contains(","+selected+",", ","+fmt.Sprint(scenarioIndex+1)+",") {
			continue
		}
		// An SQL error in one scenario must not poison every later scenario.
		scenarioTx := mealEvalReadOnly(t, db, cfg.Database.Schema)
		memory := &mealEvalMemoryRepo{StatsRepo: healthrepo.NewStatsRepo(scenarioTx)}
		svc := NewStatsService(memory, nil, cfg)
		base := svc.client.Transport
		if base == nil {
			base = http.DefaultTransport
		}
		capture := &mealEvalTransport{base: base}
		svc.client.Transport = capture
		label := "无GPS，以本轮文字地点为准"
		if spec.point != nil {
			label = spec.point.Label
		}
		scenario := mealEvalScenario{Name: spec.name, User: users[spec.user], LocationLabel: label}
		for i, q := range spec.questions {
			input := PetChatInput{Question: q, Range: "month", NewSession: memory.session == nil}
			if memory.session != nil {
				input.SessionID = memory.session.ID
			}
			if spec.point != nil {
				input.Location = &domain.DietLocation{Latitude: spec.point.Latitude, Longitude: spec.point.Longitude, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			turn := mealEvalTurn{Question: q, LocationProvided: input.Location != nil, RoutedToHarness: svc.shouldUseCampusDietAgent(ctx, users[spec.user].ID, input)}
			capture.replies = nil
			started := time.Now()
			stream, e := svc.GeneratePetChatStream(ctx, users[spec.user].ID, input)
			if e != nil {
				turn.Error = e.Error()
			} else {
				for chunk := range stream {
					switch chunk.Type {
					case "chunk":
						turn.Answer += chunk.Text
					case "diet_result":
						turn.Result = chunk.DietResult
					case "error":
						turn.Error = chunk.Error
					}
				}
			}
			turn.DurationSeconds = time.Since(started).Seconds()
			cancel()
			turn.ModelReplies = append([]mealEvalReply(nil), capture.replies...)
			scenario.Turns = append(scenario.Turns, turn)
			if turn.Error != "" {
				t.Errorf("V3_EVAL_ERROR scenario=%s turn=%d: request failed", spec.name, i+1)
			}
			if turn.Result != nil {
				result := turn.Result.Recommendation
				if c := result.AgentConstraints; c != nil {
					for _, option := range result.Recommendations {
						if option.IsCampusFood {
							require.Contains(t, c.AllowedSchoolIDs, option.SchoolID, "campus must be explicitly usable")
						}
						if c.MaxPrice != nil {
							require.LessOrEqual(t, option.Price, *c.MaxPrice, "meal budget")
						}
						if c.MaxCalories != nil {
							require.LessOrEqual(t, option.Calories, *c.MaxCalories, "meal calories")
						}
					}
				}
			}
			t.Logf("V3_EVAL_TURN scenario=%s turn=%d options=%d seconds=%.1f error=%s", spec.name, i+1, mealEvalOptionCount(turn), turn.DurationSeconds, turn.Error)
		}
		report.Scenarios = append(report.Scenarios, scenario)
		raw, e := json.MarshalIndent(report, "", "  ")
		require.NoError(t, e)
		require.NoError(t, os.WriteFile(filepath.Join(dir, "results.json"), raw, 0600))
		require.NoError(t, os.WriteFile(filepath.Join(dir, "完整对话.md"), []byte(mealEvalMarkdown(report)), 0600))
		_ = scenarioTx.Rollback().Error
	}
}
