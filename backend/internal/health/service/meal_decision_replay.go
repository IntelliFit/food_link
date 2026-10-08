package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"food_link/backend/internal/health/domain"
	"sort"
	"strings"
	"time"
)

// Replay is a service-only diagnostic, never an authenticated HTTP write path.
// Its caller must use a read-only repository/transaction as a second barrier.
type MealReplayInput struct {
	Question        string               `json:"question,omitempty"`
	AllowModelJudge bool                 `json:"allow_model_judge,omitempty"`
	RadiusKM        float64              `json:"radius_km,omitempty"`
	PriorExposures  []MealReplayExposure `json:"simulated_prior_exposures,omitempty"`
	SchoolNames     []string             `json:"school_names,omitempty"`
	AsOf            time.Time            `json:"as_of"`
	MealType        string               `json:"meal_type"`
	EngineVersion   string               `json:"engine_version"`
	Location        *domain.DietLocation `json:"location,omitempty"`
	MaxPrice        *float64             `json:"max_price,omitempty"`
}

// Simulated previously displayed options are not accepted or eaten meals.
// They only exercise the same novelty memory used by production impressions.
type MealReplayExposure struct {
	Date     string                     `json:"date"`
	MealType string                     `json:"meal_type"`
	Options  []DietRecommendationOption `json:"options"`
}

type MealReplayResult struct {
	AsOf             string                    `json:"as_of"`
	SnapshotHash     string                    `json:"snapshot_hash"`
	IncludedRecords  int                       `json:"included_records"`
	RecordedDates    []string                  `json:"recorded_dates"`
	LatestRecordTime string                    `json:"latest_record_time,omitempty"`
	LatestCreatedAt  string                    `json:"latest_created_at,omitempty"`
	Result           *DietRecommendationResult `json:"result"`
	Limitations      []string                  `json:"limitations"`
}

func mealDecisionNow(state *campusDietAgentRunState) time.Time {
	if state != nil && !state.AsOf.IsZero() {
		return state.AsOf
	}
	return time.Now()
}

func dietCandidatePoolHash(candidates []DietRecommendationCandidate) string {
	rows := append([]DietRecommendationCandidate(nil), candidates...)
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].Source+":"+rows[i].SourceID < rows[j].Source+":"+rows[j].SourceID
	})
	b, err := json.Marshal(rows)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(b)
	return fmt.Sprintf("%x", digest)
}

func mealRecordsBefore(records []domain.FoodRecord, userID string, cutoff time.Time, strict bool) []domain.FoodRecord {
	out := make([]domain.FoodRecord, 0, len(records))
	for _, record := range records {
		// A minimal repository projection may omit its already-scoped owner.
		// Strict historical replay requires the actual owner and creation time.
		if record.UserID == "" && !strict {
			record.UserID = userID
		}
		if record.UserID != userID || record.RecordTime == nil || !record.RecordTime.Before(cutoff) {
			continue
		}
		if strict && (record.CreatedAt == nil || !record.CreatedAt.Before(cutoff)) {
			continue
		}
		out = append(out, record)
	}
	return out
}

func (s *StatsService) ReplayMeals(ctx context.Context, userID string, input MealReplayInput) (*MealReplayResult, error) {
	if strings.TrimSpace(userID) == "" || input.AsOf.IsZero() || input.AsOf.After(time.Now()) {
		return nil, fmt.Errorf("回放需要有效用户及不晚于当前时间的截止时点")
	}
	if input.MealType != "breakfast" && input.MealType != "lunch" && input.MealType != "dinner" {
		return nil, fmt.Errorf("回放餐次无效")
	}
	version, err := normalizeDietEngineVersion(input.EngineVersion)
	if err != nil {
		return nil, err
	}
	question := strings.TrimSpace(input.Question)
	if question == "" {
		question = "下一餐吃什么"
	}
	constraints := resolveCampusDietAgentConstraints(nil, nil, question)
	constraints.MealType, constraints.CompleteMeal, constraints.MaxPrice = input.MealType, true, input.MaxPrice
	state := &campusDietAgentRunState{UserID: userID, Question: question, Intent: "initial", IsHomePreview: true, ReadOnlyReplay: true, AsOf: input.AsOf, EngineVersion: version, Location: input.Location,
		Constraints: constraints,
	}
	state.AllowReplayJudge = input.AllowModelJudge
	state.Constraints.RadiusKM = input.RadiusKM
	if len(input.PriorExposures) > 21 {
		return nil, fmt.Errorf("模拟曝光过多")
	}
	mealOrder := map[string]int{"breakfast": 1, "lunch": 2, "dinner": 3}
	for _, exposure := range input.PriorExposures {
		day, err := time.ParseInLocation("2006-01-02", exposure.Date, chinaTZ)
		currentDay := input.AsOf.In(chinaTZ).Format("2006-01-02")
		if err != nil || day.After(input.AsOf) || exposure.Date == currentDay && mealOrder[exposure.MealType] >= mealOrder[input.MealType] || mealOrder[exposure.MealType] == 0 || len(exposure.Options) > 3 {
			return nil, fmt.Errorf("模拟曝光必须来自之前的餐次")
		}
		for _, option := range exposure.Options {
			c := DietRecommendationCandidate{Source: option.Source, SourceID: option.SourceID, Title: option.Title, Items: option.Items}
			state.PreviewMemory = append(state.PreviewMemory, domain.MealRecommendationMemory{UserID: userID, ContextKey: "simulated:" + exposure.Date + ":" + exposure.MealType,
				SourceID: c.SourceID, OptionKey: mealDecisionHash(c.Source, c.SourceID), Fingerprint: mealDecisionHash(mealFingerprint(c)), Family: mealCandidateFamily(c), MealDate: exposure.Date, MealType: exposure.MealType, ShownAt: &input.AsOf})
		}
	}
	profile, err := s.repo.GetUserProfile(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("回放个人档案读取失败")
	}
	if school, campusID, campusName := studentDiningPreference(profile); school != nil {
		state.School, state.CampusID, state.CampusName = *school, campusID, campusName
	}
	if err := s.resolvePreviewSchools(ctx, state, input.SchoolNames); err != nil {
		return nil, err
	}
	result, err := s.hybridMealRecommendation(ctx, state)
	if err != nil {
		return nil, err
	}
	out := &MealReplayResult{AsOf: input.AsOf.In(chinaTZ).Format(time.RFC3339), IncludedRecords: len(state.HistoryRecords), RecordedDates: []string{}, Result: result, Limitations: []string{
		"仅使用 record_time 和 created_at 均早于截止时点的本人记录；当天后续餐食和后来补录被排除。",
		"个人档案与菜单使用当前数据库版本，没有完整历史档案/菜单价格快照，不能声称完全还原当时信息。",
		"饮食记录没有完整修订历史；早期记录如后来被编辑，无法重建原始内容。",
		"未读取后续聊天/曝光/选择反馈或运动记录；无积分、摄入与反馈写入，模型终选默认关闭。",
		"每个餐次输出互为替代的选择，不是一份已联合优化的全天食谱，也不证明当日营业/库存。",
	}}
	if len(input.PriorExposures) > 0 {
		out.Limitations = append(out.Limitations, "前序曝光为本次连续浏览模拟，不是真实反馈；只影响去重，不扣减营养余量或伪造已吃。")
	}
	if input.AllowModelJudge {
		out.Limitations = append(out.Limitations, "本次明确开启模型终选；只发送必要饮食与菜单上下文，无用户扣分或业务记录写入。")
	}
	seen := map[string]bool{}
	latestRecord, latestCreated := time.Time{}, time.Time{}
	for _, record := range state.HistoryRecords {
		date := record.RecordTime.In(chinaTZ).Format("2006-01-02")
		if !seen[date] {
			seen[date] = true
			out.RecordedDates = append(out.RecordedDates, date)
		}
		if record.RecordTime.After(latestRecord) {
			latestRecord = *record.RecordTime
		}
		if record.CreatedAt != nil && record.CreatedAt.After(latestCreated) {
			latestCreated = *record.CreatedAt
		}
	}
	sort.Strings(out.RecordedDates)
	if !latestRecord.IsZero() {
		out.LatestRecordTime = latestRecord.In(chinaTZ).Format(time.RFC3339)
	}
	if !latestCreated.IsZero() {
		out.LatestCreatedAt = latestCreated.In(chinaTZ).Format(time.RFC3339)
	}
	hashInput := input
	hashInput.EngineVersion = ""
	b, _ := json.Marshal(struct {
		Profile *domain.StatsUserProfile
		Records []domain.FoodRecord
		Input   MealReplayInput
	}{profile, state.HistoryRecords, hashInput})
	digest := sha256.Sum256(b)
	out.SnapshotHash = fmt.Sprintf("%x", digest)
	return out, nil
}
