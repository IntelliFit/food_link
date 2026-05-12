package repo

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestChinaTZ(t *testing.T) {
	tz := ChinaTZ()
	assert.NotNil(t, tz)
	assert.Equal(t, "Asia/Shanghai", tz.String())
}
