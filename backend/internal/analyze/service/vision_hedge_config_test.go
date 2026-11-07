package service

import (
	"testing"
	"time"

	"food_link/backend/pkg/config"
	"github.com/stretchr/testify/require"
)

func TestOrdinaryHedgeSecondsFixesOnlyOrdinaryPhotoDelay(t *testing.T) {
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureA6VisionRouting("", "", config.VisionRoutingConfig{BalancedRoutingEnabled: true, OrdinaryHedgeSeconds: 30})
	now := time.Now()
	require.Equal(t, 30*time.Second, s.balancedHedgeDelayFor("k", balancedHedgeDelayOrdinary, false, true, now))
	require.Equal(t, balancedHedgeDelayPrecision, s.balancedHedgeDelayFor("k", balancedHedgeDelayPrecision, true, true, now), "precision keeps its own delay")
	require.Equal(t, balancedHedgeDelayOrdinary, s.balancedHedgeDelayFor("k", balancedHedgeDelayOrdinary, false, false, now), "text keeps the adaptive delay")

	s.ConfigureA6VisionRouting("", "", config.VisionRoutingConfig{BalancedRoutingEnabled: true})
	require.Equal(t, balancedHedgeDelayOrdinary, s.balancedHedgeDelayFor("k", balancedHedgeDelayOrdinary, false, true, now), "unset keeps today's behaviour")

	s.ConfigureA6VisionRouting("", "", config.VisionRoutingConfig{BalancedRoutingEnabled: true, OrdinaryHedgeSeconds: 500})
	require.Equal(t, balancedHedgeDelayOrdinary, s.balancedHedgeDelayFor("k", balancedHedgeDelayOrdinary, false, true, now), "an out-of-range value is ignored")
}
