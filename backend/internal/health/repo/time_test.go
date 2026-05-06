package repo

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChinaDateWindow(t *testing.T) {
	start, end, err := chinaDateWindow("2024-06-15")
	require.NoError(t, err)

	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	expectedStart := time.Date(2024, 6, 15, 0, 0, 0, 0, chinaTZ).UTC()
	expectedEnd := expectedStart.Add(24 * time.Hour)

	assert.Equal(t, expectedStart, start)
	assert.Equal(t, expectedEnd, end)
}

func TestChinaDateWindow_InvalidDate(t *testing.T) {
	_, _, err := chinaDateWindow("invalid-date")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid date")
}

func TestChinaToday(t *testing.T) {
	today := chinaToday()
	assert.NotEmpty(t, today)
	// Should be in YYYY-MM-DD format
	_, err := time.Parse("2006-01-02", today)
	require.NoError(t, err)
}

func TestParseChinaDate(t *testing.T) {
	parsed, err := parseChinaDate("2024-06-15")
	require.NoError(t, err)

	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	expected := time.Date(2024, 6, 15, 0, 0, 0, 0, chinaTZ)
	assert.Equal(t, expected, parsed)
}

func TestParseChinaDate_Invalid(t *testing.T) {
	_, err := parseChinaDate("invalid")
	require.Error(t, err)
}
