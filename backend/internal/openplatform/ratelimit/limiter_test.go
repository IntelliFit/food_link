package ratelimit

import (
	"context"
	"testing"
	"time"

	"food_link/backend/pkg/config"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

func TestMemoryLimiterEnforcesAndResetsFixedWindow(t *testing.T) {
	limiter := NewMemoryLimiter()
	now := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return now }
	first, err := limiter.Allow(context.Background(), "app:1", 2, time.Minute)
	require.NoError(t, err)
	require.True(t, first.Allowed)
	require.Equal(t, 1, first.Remaining)
	second, _ := limiter.Allow(context.Background(), "app:1", 2, time.Minute)
	require.True(t, second.Allowed)
	third, _ := limiter.Allow(context.Background(), "app:1", 2, time.Minute)
	require.False(t, third.Allowed)
	now = now.Add(time.Minute)
	reset, _ := limiter.Allow(context.Background(), "app:1", 2, time.Minute)
	require.True(t, reset.Allowed)
	require.Equal(t, 1, reset.Remaining)
}

func TestRedisLimiterUsesSharedAtomicCounter(t *testing.T) {
	server := miniredis.RunT(t)
	limiter := &RedisLimiter{client: redis.NewClient(&redis.Options{Addr: server.Addr()}), prefix: "test:"}
	first, err := limiter.Allow(context.Background(), "app:1", 2, time.Minute)
	require.NoError(t, err)
	require.True(t, first.Allowed)
	second, err := limiter.Allow(context.Background(), "app:1", 2, time.Minute)
	require.NoError(t, err)
	require.True(t, second.Allowed)
	third, err := limiter.Allow(context.Background(), "app:1", 2, time.Minute)
	require.NoError(t, err)
	require.False(t, third.Allowed)
	server.FastForward(time.Minute)
	reset, err := limiter.Allow(context.Background(), "app:1", 2, time.Minute)
	require.NoError(t, err)
	require.True(t, reset.Allowed)
}

func TestProductionWithoutRedisFailsClosed(t *testing.T) {
	limiter, err := New(config.RedisConfig{Mode: "auto"}, "production")
	require.NoError(t, err)
	_, err = limiter.Allow(context.Background(), "app:1", 1, time.Minute)
	require.ErrorIs(t, err, ErrUnavailable)
}
