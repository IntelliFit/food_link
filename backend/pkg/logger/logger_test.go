package logger

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew_Production(t *testing.T) {
	log, err := New("production")
	require.NoError(t, err)
	require.NotNil(t, log)
	assert.NotNil(t, log.Core())
	_ = log.Sync()
}

func TestNew_Development(t *testing.T) {
	log, err := New("development")
	require.NoError(t, err)
	require.NotNil(t, log)
	assert.NotNil(t, log.Core())
	_ = log.Sync()
}

func TestNew_OtherEnv(t *testing.T) {
	log, err := New("test")
	require.NoError(t, err)
	require.NotNil(t, log)
	assert.NotNil(t, log.Core())
	_ = log.Sync()
}
