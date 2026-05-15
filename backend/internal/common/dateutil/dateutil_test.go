package dateutil

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestResolveRecordedOnDateWindow(t *testing.T) {
	now := time.Now().In(ChinaLocation())
	today := now.Format(ChinaDateLayout)
	twoDaysAgo := now.AddDate(0, 0, -2).Format(ChinaDateLayout)

	got, err := ResolveRecordedOnDate(today, "date")
	require.NoError(t, err)
	require.Equal(t, today, got)

	got, err = ResolveRecordedOnDate(twoDaysAgo, "date")
	require.NoError(t, err)
	require.Equal(t, twoDaysAgo, got)
}

func TestResolveRecordedOnDateRejectsOutsideWindow(t *testing.T) {
	now := time.Now().In(ChinaLocation())

	_, err := ResolveRecordedOnDate(now.AddDate(0, 0, 1).Format(ChinaDateLayout), "date")
	require.Error(t, err)

	_, err = ResolveRecordedOnDate(now.AddDate(0, 0, -3).Format(ChinaDateLayout), "date")
	require.Error(t, err)
}
