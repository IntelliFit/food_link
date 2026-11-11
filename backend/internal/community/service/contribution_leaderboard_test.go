package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"food_link/backend/internal/community/repo"
	"github.com/stretchr/testify/require"
)

func (m *mockFeedRepo) GetContributionCounts(_ context.Context, start, end *time.Time) (map[string]repo.ContributionCounts, error) {
	m.contributionStart, m.contributionEnd = start, end
	return m.contributionCounts, m.contributionErr
}

type contributionBlockChecker struct{}

func (contributionBlockChecker) IsBlockedEither(context.Context, string, string) (bool, error) {
	return false, nil
}
func (contributionBlockChecker) GetBlockedPairUserIDs(context.Context, string) ([]string, error) {
	return []string{"blocked"}, nil
}

func TestFoodContributionLeaderboardRanksOnlyPublicFoodCounts(t *testing.T) {
	r := &mockFeedRepo{
		contributionCounts: map[string]repo.ContributionCounts{
			"a": {Total: 2, Packaged: 2}, "b": {Total: 4, Standard: 1, Meals: 3},
			"blocked": {Total: 99}, "missing": {Total: 10},
		},
		profiles: map[string]*repo.UserProfile{"a": {ID: "a", Nickname: "甲"}, "b": {ID: "b", Nickname: "乙"}, "blocked": {ID: "blocked"}},
	}
	s := NewCommunityService(r, nil, nil, nil, nil, nil)
	s.blockChecker = contributionBlockChecker{}
	result, err := s.FoodContributionLeaderboard(context.Background(), "a", "all")
	require.NoError(t, err)
	require.Len(t, result.List, 2)
	require.Equal(t, "b", result.List[0].UserID)
	require.Equal(t, 1, result.List[0].Rank)
	require.Equal(t, 4, result.List[0].ContributionCount)
	require.Equal(t, 2, result.List[1].PackagedCount)
	require.True(t, result.List[1].IsMe)
	require.Nil(t, r.contributionStart)
	_, err = s.FoodContributionLeaderboard(context.Background(), "a", "month")
	require.NoError(t, err)
	require.NotNil(t, r.contributionStart)
	require.Equal(t, 16, r.contributionStart.Hour(), "China calendar month starts at previous-day 16:00 UTC")
	_, err = s.FoodContributionLeaderboard(context.Background(), "a", "week")
	require.Error(t, err)
	r.contributionErr = errors.New("read failed")
	_, err = s.FoodContributionLeaderboard(context.Background(), "a", "all")
	require.ErrorContains(t, err, "read failed")
}

func TestContributionMonthWindowUsesChinaCalendar(t *testing.T) {
	start, end := contributionMonthWindow(time.Date(2026, 10, 31, 16, 0, 0, 0, time.UTC))
	require.Equal(t, "2026-11-01", start.Format("2006-01-02"))
	require.Equal(t, "2026-12-01", end.Format("2006-01-02"))
	start, end = contributionMonthWindow(time.Date(2026, 12, 31, 16, 0, 0, 0, time.UTC))
	require.Equal(t, "2027-01-01", start.Format("2006-01-02"))
	require.Equal(t, "2027-02-01", end.Format("2006-01-02"))
}
