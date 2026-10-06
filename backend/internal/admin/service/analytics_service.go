package service

import (
	"context"
	"fmt"
	"food_link/backend/internal/admin/domain"
	"food_link/backend/internal/admin/repo"
	"food_link/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"log/slog"
	"sync"
	"time"
)

type AnalyticsRepository interface {
	StartedAt(context.Context) (time.Time, error)
	Record(context.Context, string, time.Time) error
	ComputeDay(context.Context, time.Time, time.Time, time.Time) (domain.AnalyticsDay, error)
	SaveDay(context.Context, domain.AnalyticsDay) error
	Days(context.Context, time.Time, time.Time) ([]domain.AnalyticsDay, error)
	PayingUsers(context.Context, time.Time, time.Time) (int64, error)
	ActivePaidMembers(context.Context, time.Time) (int64, error)
}
type analyticsUse struct {
	user string
	at   time.Time
}
type analyticsCache struct {
	data domain.AnalyticsOverview
	at   time.Time
}
type AnalyticsService struct {
	repo  AnalyticsRepository
	mu    sync.Mutex
	cache map[int]analyticsCache
	queue chan analyticsUse
	now   func() time.Time
}

func NewAnalyticsService(r AnalyticsRepository) *AnalyticsService {
	return &AnalyticsService{repo: r, cache: map[int]analyticsCache{}, queue: make(chan analyticsUse, 4096), now: time.Now}
}

// Only successful, authenticated screen reads count. Polling and notification APIs are excluded.
func AnalyticsScreenRead(method, path string) bool {
	if method != "GET" {
		return false
	}
	switch path {
	case "/api/home/dashboard", "/api/user/profile", "/api/community/feed", "/api/food-record/list", "/api/expiry/dashboard", "/api/supplements/dashboard":
		return true
	}
	return false
}
func (s *AnalyticsService) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		if c.Writer.Status() >= 400 || !AnalyticsScreenRead(c.Request.Method, c.FullPath()) {
			return
		}
		id := c.GetString("user_id")
		if id == "" {
			return
		}
		select {
		case s.queue <- analyticsUse{id, s.now()}:
		default:
			logger.Warn(c.Request.Context(), "运营活跃采集队列已满")
		}
	}
}

// The worker writes only analytics tables; request handlers never wait for a statistics write.
func (s *AnalyticsService) Run(ctx context.Context) {
	maintenance := time.NewTicker(time.Hour)
	defer maintenance.Stop()
	seen := map[string]string{}
	refresh := func() {
		taskCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		s.mu.Lock()
		defer s.mu.Unlock()
		if err := s.refresh(taskCtx, 90); err != nil {
			logger.Error(taskCtx, "运营历史统计汇总失败", err)
			return
		}
		s.cache = map[int]analyticsCache{}
		logger.Info(taskCtx, "运营历史统计汇总完成")
	}
	// Wait for DB/schema readiness; retry a failed initialization on subsequent ticks.
	refresh()
	for {
		select {
		case <-ctx.Done():
			return
		case <-maintenance.C:
			if s.now().In(repo.AnalyticsTimezone).Hour() == 1 {
				refresh()
			}
		case event := <-s.queue:
			day := event.at.In(repo.AnalyticsTimezone).Format("2006-01-02")
			if seen[event.user] == day {
				continue
			}
			writeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			err := s.repo.Record(writeCtx, event.user, event.at)
			cancel()
			if err != nil {
				logger.Error(ctx, "运营活跃采集失败", err, slog.String("user_id", event.user))
				continue
			}
			if len(seen) > 100000 {
				seen = map[string]string{}
			}
			seen[event.user] = day
		}
	}
}

func (s *AnalyticsService) refresh(ctx context.Context, days int) error {
	now := s.now()
	today := repo.AnalyticsDate(now)
	started, err := s.repo.StartedAt(ctx)
	if err != nil {
		return err
	}
	existing, err := s.repo.Days(ctx, today.AddDate(0, 0, -days+1), today)
	if err != nil {
		return err
	}
	known := map[string]bool{}
	for _, row := range existing {
		known[row.Day] = true
	}
	for day := today.AddDate(0, 0, -days+1); day.Before(today); day = day.AddDate(0, 0, 1) {
		if known[day.Format("2006-01-02")] && day.Before(today.AddDate(0, 0, -7)) {
			continue
		}
		row, err := s.repo.ComputeDay(ctx, day, started, now)
		if err != nil {
			return err
		}
		if err := s.repo.SaveDay(ctx, row); err != nil {
			return err
		}
	}
	return nil
}
func (s *AnalyticsService) Overview(ctx context.Context, days int) (domain.AnalyticsOverview, error) {
	if days != 7 && days != 30 && days != 90 {
		return domain.AnalyticsOverview{}, fmt.Errorf("仅支持7、30或90天")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if item, ok := s.cache[days]; ok && now.Sub(item.at) < 5*time.Minute && repo.AnalyticsDate(now).Equal(repo.AnalyticsDate(item.at)) {
		return item.data, nil
	}
	if err := s.refresh(ctx, days); err != nil {
		return domain.AnalyticsOverview{}, err
	}
	today := repo.AnalyticsDate(now)
	start := today.AddDate(0, 0, -days+1)
	result := domain.AnalyticsOverview{UpdatedAt: now, Timezone: "Asia/Shanghai"}
	var err error
	result.CollectionStartedAt, err = s.repo.StartedAt(ctx)
	if err != nil {
		return result, err
	}
	result.Today, err = s.repo.ComputeDay(ctx, today, result.CollectionStartedAt, now)
	if err != nil {
		return result, err
	}
	result.Days, err = s.repo.Days(ctx, start, today)
	if err != nil {
		return result, err
	}
	result.Days = append(result.Days, result.Today)
	result.PeriodPayingUsers, err = s.repo.PayingUsers(ctx, start, now)
	if err != nil {
		return result, err
	}
	result.TotalPayingUsers, err = s.repo.PayingUsers(ctx, time.Date(2000, 1, 1, 0, 0, 0, 0, repo.AnalyticsTimezone), now)
	if err != nil {
		return result, err
	}
	result.ActivePaidMembers, err = s.repo.ActivePaidMembers(ctx, now)
	if err != nil {
		return result, err
	}
	s.cache[days] = analyticsCache{result, now}
	return result, nil
}
