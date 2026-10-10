package dateutil

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestResolveRecordedOnDateWindow(t *testing.T) {
	now := time.Now().In(ChinaLocation())
	for _, daysAgo := range []int{0, 2, 3, 7, 13} {
		date := now.AddDate(0, 0, -daysAgo).Format(ChinaDateLayout)
		t.Run(date, func(t *testing.T) {
			got, err := ResolveRecordedOnDate(date, "date")
			require.NoError(t, err)
			require.Equal(t, date, got)
		})
	}
}

func TestResolveRecordedOnDateRejectsOutsideWindow(t *testing.T) {
	now := time.Now().In(ChinaLocation())

	_, err := ResolveRecordedOnDate(now.AddDate(0, 0, 1).Format(ChinaDateLayout), "date")
	require.Error(t, err)

	_, err = ResolveRecordedOnDate(now.AddDate(0, 0, -14).Format(ChinaDateLayout), "date")
	require.Error(t, err)
}
