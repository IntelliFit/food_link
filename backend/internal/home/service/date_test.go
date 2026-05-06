package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestChinaToday(t *testing.T) {
	today := ChinaToday()
	assert.NotEmpty(t, today)
	assert.Regexp(t, `^\d{4}-\d{2}-\d{2}$`, today)

	// Verify it matches the expected timezone
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	expected := time.Now().In(chinaTZ).Format("2006-01-02")
	assert.Equal(t, expected, today)
}
