package trace

import (
	"context"
	"testing"

	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInit_Disabled(t *testing.T) {
	cfg := config.OTelConfig{Enabled: false}
	shutdown, err := Init(cfg, "test-service")
	require.NoError(t, err)
	require.NotNil(t, shutdown)

	ctx := context.Background()
	assert.NoError(t, shutdown(ctx))
}

func TestInit_Enabled(t *testing.T) {
	cfg := config.OTelConfig{
		Enabled:           true,
		CollectorEndpoint: "localhost:4317",
		Insecure:          true,
	}
	// This may fail if no collector is running, so we just test it doesn't panic
	// and handles errors gracefully
	_, err := Init(cfg, "test-service")
	// We expect this to potentially fail due to no collector, but it shouldn't panic
	_ = err
}
