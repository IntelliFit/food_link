package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	analyzeservice "food_link/backend/internal/analyze/service"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/onboarding/domain"
	"food_link/backend/pkg/logger"
)

const (
	statsTTL           = time.Hour
	maxBadges          = 3
	maxBadgeRunes      = 16
	maxSourceLines     = 6
	maxSourceLineRunes = 80
	maxResultLineRunes = 40
	maxTryImageChars   = 3 << 20
	maxNoteRunes       = 200
	maxPreviousItems   = 15
	maxItemNameRunes   = 40
	statsQueryTimeout  = 10 * time.Second
)

var (
	anonIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)
	badgeIcons    = map[string]bool{"shield": true, "school": true, "data": true, "star": true}
	// Words the Advertising Law treats as absolute claims. Saving still works;
	// the admin console shows the warning so the decision is deliberate.
	absoluteClaim = regexp.MustCompile(`第一|最|唯一|首个|首家|顶级|国家级|世界级|领先|权威|精准|100%|百分百`)
)

type Repository interface {
	GetConfig(ctx context.Context, key string) (json.RawMessage, error)
	SaveConfig(ctx context.Context, key string, value json.RawMessage, updatedBy string) error
	ReserveTry(ctx context.Context, anonID, userID string, props map[string]any, at, since time.Time, limits *domain.TryLimits) (domain.TryVerdict, error)
	FoodSources(ctx context.Context, ids []string) (map[string]string, error)
	Stats(ctx context.Context) (domain.Stats, error)
}

// Analyzer is the existing synchronous photo analysis.
type Analyzer interface {
	Analyze(ctx context.Context, userID string, input analyzeservice.AnalyzeInput) (map[string]any, error)
}

type Service struct {
	repo     Repository
	analyzer Analyzer
	now      func() time.Time
	loc      *time.Location

	mu      sync.Mutex
	stats   *domain.Stats
	statsAt time.Time
}

func NewService(repo Repository, analyzer Analyzer) *Service {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*3600)
	}
	return &Service{repo: repo, analyzer: analyzer, now: time.Now, loc: loc}
}

// Config returns the stored config, falling back to defaults for a missing
// row or missing fields.
func (s *Service) Config(ctx context.Context) (domain.Config, error) {
	cfg := domain.DefaultConfig()
	raw, err := s.repo.GetConfig(ctx, domain.ConfigKey)
	if err != nil {
		return cfg, err
	}
	if len(raw) == 0 {
		return cfg, nil
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return domain.DefaultConfig(), fmt.Errorf("解析引导配置失败: %w", err)
	}
	if cfg.Badges == nil {
		cfg.Badges = []domain.TrustBadge{}
	}
	if cfg.SourceLines == nil {
		cfg.SourceLines = []string{}
	}
	return cfg, nil
}

// PublicConfig never fails the page: a read error serves the defaults.
func (s *Service) PublicConfig(ctx context.Context) domain.PublicConfig {
	cfg, err := s.Config(ctx)
	if err != nil {
		logger.Error(ctx, "读取引导配置失败，使用默认配置", err)
	}
	return cfg.Public()
}

type SaveResult struct {
	Config   domain.Config `json:"config"`
	Warnings []string      `json:"warnings"`
}

func (s *Service) SaveConfig(ctx context.Context, in domain.Config, updatedBy string) (SaveResult, error) {
	cfg, warnings, err := normalizeConfig(in)
	if err != nil {
		return SaveResult{}, badRequest(err.Error())
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		return SaveResult{}, err
	}
	if err := s.repo.SaveConfig(ctx, domain.ConfigKey, raw, updatedBy); err != nil {
		return SaveResult{}, err
	}
	logger.Info(ctx, "引导配置已保存", slog.String("updated_by", updatedBy), slog.Int("badges", len(cfg.Badges)), slog.Int("warnings", len(warnings)))
	return SaveResult{Config: cfg, Warnings: warnings}, nil
}

func normalizeConfig(in domain.Config) (domain.Config, []string, error) {
	out := domain.Config{
		Badges:                  []domain.TrustBadge{},
		SourceLines:             []string{},
		ResultLine:              strings.TrimSpace(in.ResultLine),
		GuestTryPerInstallDaily: in.GuestTryPerInstallDaily,
		GuestTryGlobalDaily:     in.GuestTryGlobalDaily,
	}
	if len(in.Badges) > maxBadges {
		return out, nil, fmt.Errorf("徽章最多 %d 个", maxBadges)
	}
	var warnings []string
	check := func(where, text string) {
		if absoluteClaim.MatchString(text) {
			warnings = append(warnings, fmt.Sprintf("%s「%s」含绝对化或需要证据支撑的用语（《广告法》第九条、第二十八条），上线前请备好依据", where, text))
		}
	}
	for _, b := range in.Badges {
		text := strings.TrimSpace(b.Text)
		if text == "" {
			continue
		}
		if len([]rune(text)) > maxBadgeRunes {
			return out, nil, fmt.Errorf("徽章文字最多 %d 个字：%s", maxBadgeRunes, text)
		}
		icon := strings.TrimSpace(b.Icon)
		if !badgeIcons[icon] {
			icon = "shield"
		}
		check("徽章", text)
		out.Badges = append(out.Badges, domain.TrustBadge{Icon: icon, Text: text})
	}
	if len(in.SourceLines) > maxSourceLines {
		return out, nil, fmt.Errorf("说明最多 %d 行", maxSourceLines)
	}
	for _, line := range in.SourceLines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if len([]rune(line)) > maxSourceLineRunes {
			return out, nil, fmt.Errorf("每行说明最多 %d 个字", maxSourceLineRunes)
		}
		check("说明", line)
		out.SourceLines = append(out.SourceLines, line)
	}
	if len([]rune(out.ResultLine)) > maxResultLineRunes {
		return out, nil, fmt.Errorf("识别结果下方的说明最多 %d 个字", maxResultLineRunes)
	}
	if out.ResultLine != "" {
		check("识别结果说明", out.ResultLine)
	}
	if out.GuestTryPerInstallDaily < 0 || out.GuestTryPerInstallDaily > 20 {
		return out, nil, fmt.Errorf("每台设备每天体验次数须在 0–20 之间")
	}
	if out.GuestTryGlobalDaily < 0 || out.GuestTryGlobalDaily > 10000 {
		return out, nil, fmt.Errorf("每天体验总次数须在 0–10000 之间")
	}
	for _, text := range []string{out.ResultLine} {
		if strings.Contains(text, "[") {
			warnings = append(warnings, "识别结果说明里还有方括号占位，用户会直接看到")
		}
	}
	for _, line := range out.SourceLines {
		if strings.Contains(line, "[") {
			warnings = append(warnings, "说明里还有方括号占位，用户会直接看到："+line)
		}
	}
	return out, warnings, nil
}

// Stats is cached for an hour; a failed refresh keeps serving the last value.
func (s *Service) Stats(ctx context.Context) (domain.Stats, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if s.stats != nil && now.Sub(s.statsAt) < statsTTL {
		return *s.stats, nil
	}
	queryCtx, cancel := context.WithTimeout(context.Background(), statsQueryTimeout)
	defer cancel()
	fresh, err := s.repo.Stats(queryCtx)
	if err != nil {
		if s.stats != nil {
			logger.Error(ctx, "刷新引导页数据统计失败，沿用上次结果", err)
			return *s.stats, nil
		}
		return domain.Stats{}, err
	}
	fresh.AsOf = now
	s.stats = &fresh
	s.statsAt = now
	return fresh, nil
}

type TryInput struct {
	AnonID         string         `json:"anon_id"`
	Base64Image    string         `json:"base64Image"`
	Note           string         `json:"note"`
	PreviousResult map[string]any `json:"previous_result"`
}

// sanitizePreviousItems keeps at most 15 items with a short name, the weight
// and the four main nutrients; everything else the client sent is dropped.
func sanitizePreviousItems(prev map[string]any) []map[string]any {
	raw, _ := prev["items"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		if len(out) >= maxPreviousItems {
			break
		}
		item, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		name := []rune(strings.TrimSpace(fmt.Sprint(item["name"])))
		if len(name) == 0 || string(name) == "<nil>" {
			continue
		}
		if len(name) > maxItemNameRunes {
			name = name[:maxItemNameRunes]
		}
		clean := map[string]any{"name": string(name)}
		if w, ok := toNumber(item["estimatedWeightGrams"]); ok {
			clean["estimatedWeightGrams"] = w
		}
		if nutrients, ok := item["nutrients"].(map[string]any); ok {
			kept := map[string]any{}
			for _, key := range []string{"calories", "protein", "carbs", "fat"} {
				if v, ok := toNumber(nutrients[key]); ok {
					kept[key] = v
				}
			}
			clean["nutrients"] = kept
		}
		out = append(out, clean)
	}
	return out
}

func toNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

var (
	errTryNeedsLogin = &commonerrors.AppError{Code: 10030, Message: "今天的免费体验次数用完了，登录后可以继续识别", HTTPStatus: http.StatusTooManyRequests}
	errTryBusy       = &commonerrors.AppError{Code: 10031, Message: "体验的人有点多，登录后可以直接识别", HTTPStatus: http.StatusTooManyRequests}
)

// Try runs one guest photo analysis (or a correction of the previous one)
// within the configured daily caps, then labels each item's nutrition source.
// Nothing is saved as a food record; the client saves after login.
func (s *Service) Try(ctx context.Context, userID string, in TryInput) (map[string]any, error) {
	if !anonIDPattern.MatchString(in.AnonID) {
		return nil, badRequest("访客标识无效")
	}
	in.Base64Image = strings.TrimSpace(in.Base64Image)
	if in.Base64Image == "" {
		return nil, badRequest("请先拍一张照片")
	}
	if len(in.Base64Image) > maxTryImageChars {
		return nil, badRequest("照片太大了，请重新拍一张")
	}
	note := []rune(strings.TrimSpace(in.Note))
	if len(note) > maxNoteRunes {
		note = note[:maxNoteRunes]
	}
	cfg, err := s.Config(ctx)
	if err != nil {
		logger.Error(ctx, "读取引导配置失败，按默认次数限制", err)
	}
	now := s.now()
	var limits *domain.TryLimits
	if userID == "" {
		limits = &domain.TryLimits{PerInstall: cfg.GuestTryPerInstallDaily, Global: cfg.GuestTryGlobalDaily}
	}
	previous := sanitizePreviousItems(in.PreviousResult)
	isCorrection := len(note) > 0 && len(previous) > 0
	verdict, err := s.repo.ReserveTry(ctx, in.AnonID, userID, map[string]any{"correction": isCorrection}, now, startOfDay(now, s.loc), limits)
	if err != nil {
		return nil, fmt.Errorf("记录体验次数失败: %w", err)
	}
	switch verdict {
	case domain.TryInstallCapped:
		return nil, errTryNeedsLogin
	case domain.TryGlobalCapped:
		return nil, errTryBusy
	}
	standard := "standard"
	input := analyzeservice.AnalyzeInput{
		Base64Image:       in.Base64Image,
		AdditionalContext: string(note),
		ExecutionMode:     &standard,
	}
	if isCorrection {
		// Only names, weights and the four main nutrients go back to the model,
		// so a crafted correction cannot inflate the prompt.
		items := make([]any, len(previous))
		for i, item := range previous {
			items[i] = item
		}
		input.PreviousResult = map[string]any{"items": items}
		input.CorrectionItems = previous
	}
	data, err := s.analyzer.Analyze(ctx, userID, input)
	if err != nil {
		return nil, err
	}
	s.labelSources(ctx, data)
	return data, nil
}

// labelSources adds `nutrition_source_label` to each item so the client can
// say where the numbers come from. A lookup failure only drops the labels.
func (s *Service) labelSources(ctx context.Context, data map[string]any) {
	items, _ := data["items"].([]any)
	ids := make([]string, 0, len(items))
	for _, raw := range items {
		if item, ok := raw.(map[string]any); ok {
			if id := matchedFoodID(item); id != "" {
				ids = append(ids, id)
			}
		}
	}
	sources, err := s.repo.FoodSources(ctx, ids)
	if err != nil {
		logger.Error(ctx, "读取营养来源失败，结果不带来源说明", err)
		sources = map[string]string{}
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		unresolved, _ := item["is_unresolved"].(bool)
		item["nutrition_source_label"] = SourceLabel(fmt.Sprint(item["nutrition_source"]), unresolved, sources[matchedFoodID(item)])
	}
}

func matchedFoodID(item map[string]any) string {
	for _, key := range []string{"matched_food_id", "matchedFoodId"} {
		if v, ok := item[key]; ok && v != nil {
			if s := strings.TrimSpace(fmt.Sprint(v)); s != "" && s != "<nil>" {
				return s
			}
		}
	}
	return ""
}

// AIEstimateLabel marks numbers the model estimated without a library match.
const AIEstimateLabel = "AI 估算"

// SourceLabel turns internal source codes into wording users can check. Only
// public datasets are named; library rows that were themselves generated, and
// items with no library match, are labelled as AI estimates.
func SourceLabel(nutritionSource string, unresolved bool, librarySource string) string {
	switch nutritionSource {
	case "packaged_food_library", "ingredient_label":
		return "包装营养成分表"
	}
	if unresolved || nutritionSource == "unresolved" {
		return AIEstimateLabel
	}
	lower := strings.ToLower(librarySource)
	switch {
	case librarySource == "":
		if strings.HasPrefix(nutritionSource, "library_") {
			return "食探标准食物库"
		}
		return AIEstimateLabel
	case strings.Contains(librarySource, "美国农业部") || strings.Contains(lower, "usda"):
		return "美国农业部食物数据"
	case strings.Contains(librarySource, "中国疾控"):
		return "中国疾控营养数据"
	case strings.Contains(lower, "tfda"):
		return "台湾食品营养数据库"
	case strings.Contains(lower, "generated"):
		return AIEstimateLabel
	default:
		return "食探标准食物库"
	}
}

func startOfDay(t time.Time, loc *time.Location) time.Time {
	local := t.In(loc)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
}

func badRequest(msg string) error {
	return &commonerrors.AppError{Code: 10002, Message: msg, HTTPStatus: http.StatusBadRequest}
}
