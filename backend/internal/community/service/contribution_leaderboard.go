package service

import (
	"context"
	"sort"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
)

type ContributionLeaderboardItem struct {
	Rank              int    `json:"rank"`
	UserID            string `json:"user_id"`
	Nickname          string `json:"nickname"`
	Avatar            string `json:"avatar"`
	ContributionCount int    `json:"contribution_count"`
	StandardCount     int    `json:"standard_count"`
	PackagedCount     int    `json:"packaged_count"`
	MealCount         int    `json:"meal_count"`
	CustomCount       int    `json:"custom_count"`
	IsMe              bool   `json:"is_me"`
}

type ContributionLeaderboardResult struct {
	Period    string                        `json:"period"`
	StartDate string                        `json:"start_date,omitempty"`
	EndDate   string                        `json:"end_date,omitempty"`
	List      []ContributionLeaderboardItem `json:"list"`
}

func contributionMonthWindow(now time.Time) (time.Time, time.Time) {
	local := now.In(time.FixedZone("Asia/Shanghai", 8*60*60))
	start := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, local.Location())
	return start, start.AddDate(0, 1, 0)
}

func (s *CommunityService) FoodContributionLeaderboard(ctx context.Context, viewerID, period string) (*ContributionLeaderboardResult, error) {
	period = strings.TrimSpace(period)
	if period == "" {
		period = "month"
	}
	if period != "month" && period != "all" {
		return nil, &commonerrors.AppError{Code: 10002, HTTPStatus: 400, Message: "请选择本月或总榜"}
	}
	result := &ContributionLeaderboardResult{Period: period, List: []ContributionLeaderboardItem{}}
	var start, end *time.Time
	if period == "month" {
		first, next := contributionMonthWindow(time.Now())
		result.StartDate, result.EndDate = first.Format("2006-01-02"), next.AddDate(0, 0, -1).Format("2006-01-02")
		firstUTC, nextUTC := first.UTC(), next.UTC()
		start, end = &firstUTC, &nextUTC
	}
	counts, err := s.feedRepo.GetContributionCounts(ctx, start, end)
	if err != nil {
		return nil, err
	}
	blocked := s.blockedUserSet(ctx, viewerID)
	ids := make([]string, 0, len(counts))
	for id, count := range counts {
		if id != "" && count.Total > 0 && !blocked[id] {
			ids = append(ids, id)
		}
	}
	profiles, err := s.feedRepo.GetUserProfiles(ctx, ids)
	if err != nil {
		return nil, err
	}
	// Counts only describe explicitly published food data. They never include
	// private meals or expose diet/health scores, regardless of record sharing.
	for _, id := range ids {
		profile := profiles[id]
		if profile == nil {
			continue
		}
		count := counts[id]
		result.List = append(result.List, ContributionLeaderboardItem{
			UserID: id, Nickname: strOr(profile, "用户"), Avatar: s.resolveAvatarURL(profile.Avatar),
			ContributionCount: count.Total, StandardCount: count.Standard, PackagedCount: count.Packaged,
			MealCount: count.Meals, CustomCount: count.Custom, IsMe: id == viewerID,
		})
	}
	sort.Slice(result.List, func(i, j int) bool {
		a, b := result.List[i], result.List[j]
		if a.ContributionCount != b.ContributionCount {
			return a.ContributionCount > b.ContributionCount
		}
		if a.Nickname != b.Nickname {
			return a.Nickname < b.Nickname
		}
		return a.UserID < b.UserID
	})
	for i := range result.List {
		result.List[i].Rank = i + 1
	}
	return result, nil
}
