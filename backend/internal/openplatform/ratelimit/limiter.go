package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"food_link/backend/pkg/config"

	"github.com/redis/go-redis/v9"
)

var ErrUnavailable = errors.New("open api rate limiter unavailable")

type Decision struct {
	Allowed   bool
	Limit     int
	Remaining int
	ResetAt   time.Time
}

type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (Decision, error)
}

func New(cfg config.RedisConfig, appEnv string) (Limiter, error) {
	mode := strings.ToLower(strings.TrimSpace(cfg.Mode))
	if mode == "" {
		mode = "auto"
	}
	if mode == "memory" && !isLocalEnv(appEnv) {
		return unavailableLimiter{}, nil
	}
	if mode == "memory" || (mode == "auto" && strings.TrimSpace(cfg.URL) == "" && isLocalEnv(appEnv)) {
		return NewMemoryLimiter(), nil
	}
	if mode == "auto" && strings.TrimSpace(cfg.URL) == "" {
		return unavailableLimiter{}, nil
	}
	if mode != "redis" && mode != "auto" {
		return nil, fmt.Errorf("redis.mode 只支持 auto、redis 或 memory")
	}
	if strings.TrimSpace(cfg.URL) == "" {
		return nil, fmt.Errorf("redis.url 不能为空")
	}
	options, err := redis.ParseURL(strings.TrimSpace(cfg.URL))
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.Password) != "" && options.Password == "" {
		options.Password = strings.TrimSpace(cfg.Password)
	}
	options.DB = cfg.DB
	prefix := strings.Trim(strings.TrimSpace(cfg.KeyPrefix), ":")
	if prefix != "" {
		prefix += ":"
	}
	return &RedisLimiter{client: redis.NewClient(options), prefix: prefix + "openapi:ratelimit:"}, nil
}

type RedisLimiter struct {
	client *redis.Client
	prefix string
}

var fixedWindowScript = redis.NewScript(`
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {current, ttl}
`)

func (l *RedisLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (Decision, error) {
	limit, window = normalize(limit, window)
	values, err := fixedWindowScript.Run(ctx, l.client, []string{l.prefix + strings.TrimSpace(key)}, window.Milliseconds()).Int64Slice()
	if err != nil || len(values) != 2 {
		if err == nil {
			err = ErrUnavailable
		}
		return Decision{}, err
	}
	count, ttl := values[0], values[1]
	if ttl < 0 {
		ttl = window.Milliseconds()
	}
	remaining := limit - int(count)
	if remaining < 0 {
		remaining = 0
	}
	return Decision{Allowed: count <= int64(limit), Limit: limit, Remaining: remaining, ResetAt: time.Now().Add(time.Duration(ttl) * time.Millisecond)}, nil
}

type memoryWindow struct {
	count   int
	resetAt time.Time
}

type MemoryLimiter struct {
	mu      sync.Mutex
	windows map[string]memoryWindow
	now     func() time.Time
}

func NewMemoryLimiter() *MemoryLimiter {
	return &MemoryLimiter{windows: map[string]memoryWindow{}, now: time.Now}
}

func (l *MemoryLimiter) Allow(_ context.Context, key string, limit int, window time.Duration) (Decision, error) {
	limit, window = normalize(limit, window)
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	item, ok := l.windows[key]
	if !ok || !now.Before(item.resetAt) {
		item = memoryWindow{resetAt: now.Add(window)}
	}
	item.count++
	l.windows[key] = item
	remaining := limit - item.count
	if remaining < 0 {
		remaining = 0
	}
	return Decision{Allowed: item.count <= limit, Limit: limit, Remaining: remaining, ResetAt: item.resetAt}, nil
}

type unavailableLimiter struct{}

func (unavailableLimiter) Allow(context.Context, string, int, time.Duration) (Decision, error) {
	return Decision{}, ErrUnavailable
}

func normalize(limit int, window time.Duration) (int, time.Duration) {
	if limit <= 0 {
		limit = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	return limit, window
}

func isLocalEnv(env string) bool {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "", "local", "dev", "development", "test", "testing":
		return true
	default:
		return false
	}
}
