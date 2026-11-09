package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/onboarding/domain"
)

type fakeRepo struct {
	config     json.RawMessage
	saved      json.RawMessage
	tries      []string
	mineCount  int64
	allCount   int64
	limits     []*domain.TryLimits
	sources    map[string]string
	stats      domain.Stats
	statsCalls int
	statsErr   error
}

func (f *fakeRepo) GetConfig(context.Context, string) (json.RawMessage, error) { return f.config, nil }
func (f *fakeRepo) SaveConfig(_ context.Context, _ string, v json.RawMessage, _ string) error {
	f.saved = v
	return nil
}
func (f *fakeRepo) ReserveTry(_ context.Context, anonID, _ string, _ map[string]any, _, _ time.Time, limits *domain.TryLimits) (domain.TryVerdict, error) {
	f.limits = append(f.limits, limits)
	if limits != nil {
		if f.mineCount >= int64(limits.PerInstall) {
			return domain.TryInstallCapped, nil
		}
		if f.allCount >= int64(limits.Global) {
			return domain.TryGlobalCapped, nil
		}
	}
	f.tries = append(f.tries, anonID)
	return domain.TryAllowed, nil
}
func (f *fakeRepo) FoodSources(context.Context, []string) (map[string]string, error) {
	return f.sources, nil
}
func (f *fakeRepo) Stats(context.Context) (domain.Stats, error) {
	f.statsCalls++
	return f.stats, f.statsErr
}

type fakeAnalyzer struct {
	got  analyzeservice.AnalyzeInput
	data map[string]any
	err  error
}

func (f *fakeAnalyzer) Analyze(_ context.Context, _ string, in analyzeservice.AnalyzeInput) (map[string]any, error) {
	f.got = in
	return f.data, f.err
}

var t0 = time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)

func newSvc(repo *fakeRepo, an *fakeAnalyzer) *Service {
	s := NewService(repo, an)
	s.now = func() time.Time { return t0 }
	return s
}

func sampleResult() map[string]any {
	return map[string]any{"items": []any{
		map[string]any{"name": "藜麦饭", "matched_food_id": "f1", "nutrition_source": "library_exact_alias"},
		map[string]any{"name": "芝麻酱", "matched_food_id": "f2", "nutrition_source": "library_fuzzy"},
		map[string]any{"name": "某饮料", "nutrition_source": "packaged_food_library"},
		map[string]any{"name": "未匹配", "nutrition_source": "unresolved", "is_unresolved": true},
	}}
}

func TestConfigFallsBackToDefaults(t *testing.T) {
	svc := newSvc(&fakeRepo{}, &fakeAnalyzer{})
	cfg, err := svc.Config(context.Background())
	if err != nil || len(cfg.Badges) != 0 || cfg.GuestTryPerInstallDaily != 3 {
		t.Fatalf("没有配置时应使用默认值，且不带任何宣传徽章: %+v err=%v", cfg, err)
	}
	stored := &fakeRepo{config: json.RawMessage(`{"badges":[{"icon":"data","text":"1.2 万种食物"}],"result_line":"内测误差 8%"}`)}
	cfg, err = newSvc(stored, &fakeAnalyzer{}).Config(context.Background())
	if err != nil || len(cfg.Badges) != 1 || cfg.ResultLine != "内测误差 8%" || cfg.GuestTryGlobalDaily != 300 {
		t.Fatalf("存的配置应覆盖默认值、缺的字段保留默认: %+v err=%v", cfg, err)
	}
	public := newSvc(stored, &fakeAnalyzer{}).PublicConfig(context.Background())
	if public.ResultLine != "内测误差 8%" || len(public.Badges) != 1 {
		t.Fatalf("公开配置不对: %+v", public)
	}
}

func TestSaveConfigValidatesAndWarns(t *testing.T) {
	repo := &fakeRepo{}
	svc := newSvc(repo, &fakeAnalyzer{})
	res, err := svc.SaveConfig(context.Background(), domain.Config{
		Badges:                  []domain.TrustBadge{{Icon: "unknown", Text: " 业内第一 "}, {Icon: "school", Text: ""}},
		SourceLines:             []string{"精准度：[基准名称] 误差 [X]%", " "},
		ResultLine:              "内测热量误差 [X]%",
		GuestTryPerInstallDaily: 2,
		GuestTryGlobalDaily:     100,
	}, "admin")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Config.Badges) != 1 || res.Config.Badges[0].Icon != "shield" || res.Config.Badges[0].Text != "业内第一" {
		t.Fatalf("应去掉空徽章、修正未知图标、去掉空格: %+v", res.Config.Badges)
	}
	if len(res.Config.SourceLines) != 1 {
		t.Fatalf("空行应被去掉: %+v", res.Config.SourceLines)
	}
	joined := strings.Join(res.Warnings, "\n")
	if !strings.Contains(joined, "业内第一") || !strings.Contains(joined, "方括号") {
		t.Fatalf("应提示绝对化用语和占位: %v", res.Warnings)
	}
	if len(repo.saved) == 0 {
		t.Fatal("配置应写入")
	}

	bad := []domain.Config{
		{Badges: make([]domain.TrustBadge, 4)},
		{Badges: []domain.TrustBadge{{Icon: "shield", Text: strings.Repeat("准", 17)}}},
		{GuestTryPerInstallDaily: 21},
		{GuestTryGlobalDaily: -1},
		{ResultLine: strings.Repeat("准", 41)},
	}
	for i, in := range bad {
		if _, err := svc.SaveConfig(context.Background(), in, "admin"); err == nil {
			t.Fatalf("第 %d 个非法配置应被拒绝", i)
		}
	}
}

func TestTryEnforcesDailyCapsForGuests(t *testing.T) {
	ctx := context.Background()
	in := TryInput{AnonID: "anon_try_0001", Base64Image: "aGVsbG8="}

	repo := &fakeRepo{mineCount: 3}
	_, err := newSvc(repo, &fakeAnalyzer{data: sampleResult()}).Try(ctx, "", in)
	var appErr *commonerrors.AppError
	if !errors.As(err, &appErr) || appErr != errTryNeedsLogin || len(repo.tries) != 0 {
		t.Fatalf("单设备用完次数应提示登录，且不调用模型: err=%v tries=%v", err, repo.tries)
	}

	repo = &fakeRepo{allCount: 300}
	if _, err := newSvc(repo, &fakeAnalyzer{data: sampleResult()}).Try(ctx, "", in); !errors.Is(err, errTryBusy) {
		t.Fatalf("全站用完次数应提示稍后: %v", err)
	}

	repo = &fakeRepo{mineCount: 99, allCount: 9999}
	if _, err := newSvc(repo, &fakeAnalyzer{data: sampleResult()}).Try(ctx, "user-1", in); err != nil {
		t.Fatalf("已登录用户不受游客次数限制: %v", err)
	}
	if repo.limits[0] != nil {
		t.Fatal("已登录用户不应带次数上限")
	}
}

func TestTryCountsAttemptsEvenWhenAnalysisFails(t *testing.T) {
	repo := &fakeRepo{}
	an := &fakeAnalyzer{err: errors.New("model down")}
	if _, err := newSvc(repo, an).Try(context.Background(), "", TryInput{AnonID: "anon_try_0002", Base64Image: "aGVsbG8="}); err == nil {
		t.Fatal("识别失败应返回错误")
	}
	if len(repo.tries) != 1 {
		t.Fatalf("调用模型前就应计一次: %v", repo.tries)
	}
}

func TestTryPassesCorrectionAndLabelsSources(t *testing.T) {
	repo := &fakeRepo{sources: map[string]string{"f1": "美国农业部食物数据中心（SR Legacy）", "f2": "boohee_ui_food_batch_001"}}
	an := &fakeAnalyzer{data: sampleResult()}
	svc := newSvc(repo, an)
	longName := strings.Repeat("菜", 60)
	prevItems := []any{map[string]any{
		"name": longName, "estimatedWeightGrams": 80.0, "description": strings.Repeat("x", 5000),
		"nutrients": map[string]any{"calories": 96.0, "protein": 3.0, "sodium": 1.0},
	}}
	for i := 0; i < 20; i++ {
		prevItems = append(prevItems, map[string]any{"name": "菜"})
	}
	data, err := svc.Try(context.Background(), "", TryInput{
		AnonID:         "anon_try_0003",
		Base64Image:    "aGVsbG8=",
		Note:           "还淋了一勺芝麻酱",
		PreviousResult: map[string]any{"items": prevItems, "insight": strings.Repeat("y", 5000)},
	})
	if err != nil {
		t.Fatal(err)
	}
	if an.got.AdditionalContext != "还淋了一勺芝麻酱" || an.got.ExecutionMode == nil || *an.got.ExecutionMode != "standard" {
		t.Fatalf("纠错应带上说明，走标准模式: %+v", an.got)
	}
	if len(an.got.CorrectionItems) != maxPreviousItems || len(an.got.PreviousResult) != 1 {
		t.Fatalf("原结果应只保留 %d 项且只有 items: %d %v", maxPreviousItems, len(an.got.CorrectionItems), an.got.PreviousResult)
	}
	first := an.got.CorrectionItems[0]
	if len([]rune(first["name"].(string))) != maxItemNameRunes || first["description"] != nil {
		t.Fatalf("菜名应截断、多余字段应丢弃: %+v", first)
	}
	if n := first["nutrients"].(map[string]any); n["sodium"] != nil || n["calories"] != 96.0 {
		t.Fatalf("营养只留四项: %+v", n)
	}
	items := data["items"].([]any)
	want := []string{"美国农业部食物数据", "食探标准食物库", "包装营养成分表", "AI 估算"}
	for i, w := range want {
		if got := items[i].(map[string]any)["nutrition_source_label"]; got != w {
			t.Fatalf("第 %d 项来源应为 %s, got %v", i, w, got)
		}
	}

	an2 := &fakeAnalyzer{data: sampleResult()}
	if _, err := newSvc(&fakeRepo{}, an2).Try(context.Background(), "", TryInput{AnonID: "anon_try_0004", Base64Image: "aGVsbG8=", PreviousResult: map[string]any{"items": prevItems}}); err != nil {
		t.Fatal(err)
	}
	if an2.got.PreviousResult != nil {
		t.Fatal("没有纠错说明时不应当成纠错")
	}
}

func TestTryRejectsBadInput(t *testing.T) {
	svc := newSvc(&fakeRepo{}, &fakeAnalyzer{data: sampleResult()})
	for _, in := range []TryInput{
		{AnonID: "bad", Base64Image: "aGVsbG8="},
		{AnonID: "anon_try_0005"},
		{AnonID: "anon_try_0005", Base64Image: strings.Repeat("a", maxTryImageChars+1)},
	} {
		if _, err := svc.Try(context.Background(), "", in); err == nil {
			t.Fatalf("应拒绝: %+v", in.AnonID)
		}
	}
}

func TestStatsAreCachedAndSurviveRefreshFailure(t *testing.T) {
	repo := &fakeRepo{stats: domain.Stats{StandardFoods: 12255}}
	svc := newSvc(repo, &fakeAnalyzer{})
	ctx := context.Background()
	if s, err := svc.Stats(ctx); err != nil || s.StandardFoods != 12255 || !s.AsOf.Equal(t0) {
		t.Fatalf("首次统计: %+v err=%v", s, err)
	}
	svc.Stats(ctx)
	if repo.statsCalls != 1 {
		t.Fatalf("一小时内应使用缓存, calls=%d", repo.statsCalls)
	}
	svc.now = func() time.Time { return t0.Add(2 * time.Hour) }
	repo.statsErr = errors.New("db down")
	if s, err := svc.Stats(ctx); err != nil || s.StandardFoods != 12255 {
		t.Fatalf("刷新失败应沿用上次结果: %+v err=%v", s, err)
	}
	if _, err := newSvc(&fakeRepo{statsErr: errors.New("db down")}, &fakeAnalyzer{}).Stats(ctx); err == nil {
		t.Fatal("没有旧值时应返回错误")
	}
}

func TestSourceLabel(t *testing.T) {
	cases := []struct {
		source     string
		unresolved bool
		library    string
		want       string
	}{
		{"library_exact_alias", false, "USDA FoodData Central SR Legacy", "美国农业部食物数据"},
		{"library_fuzzy", false, "中国疾控营养成分平台零食筛选导入", "中国疾控营养数据"},
		{"library_exact_canonical", false, "tfda_food_nutrition", "台湾食品营养数据库"},
		{"library_exact_alias", false, "gemini_generated", AIEstimateLabel},
		{"library_semantic_rerank", false, "boohee_ui_food_batch_001", "食探标准食物库"},
		{"library_fuzzy", false, "", "食探标准食物库"},
		{"unresolved", false, "", AIEstimateLabel},
		{"database", true, "", AIEstimateLabel},
		{"some_engine", false, "", AIEstimateLabel},
		{"ingredient_label", false, "anything", "包装营养成分表"},
	}
	for _, c := range cases {
		if got := SourceLabel(c.source, c.unresolved, c.library); got != c.want {
			t.Fatalf("SourceLabel(%q,%v,%q)=%q want %q", c.source, c.unresolved, c.library, got, c.want)
		}
	}
}
