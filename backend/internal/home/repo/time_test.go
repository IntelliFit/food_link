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

func TestChinaTZ_Local(t *testing.T) {
	assert.NotNil(t, chinaTZ)
	assert.Equal(t, "Asia/Shanghai", chinaTZ.String())
}
