package service

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type profileReviewContextKey struct{}

var errProfileReviewPending = &commonerrors.AppError{Code: 10012, Message: "资料审核尚未取得明确结论", HTTPStatus: 409}

func (s *Service) CheckProfileDocument(ctx context.Context, userID string, scene int, doc map[string]any, store *storage.Client) error {
	return s.CheckDocument(context.WithValue(ctx, profileReviewContextKey{}, true), userID, scene, doc, store)
}

var finishProfileReview = redis.NewScript(`
if redis.call('HGET', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end
if ARGV[3] == 'done' then
 redis.call('HDEL', KEYS[1], ARGV[1]); redis.call('ZREM', KEYS[2], ARGV[1])
else redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1]) end
return 1`)

// QueueProfileReview stores only an owner and nonce. Workers read the current
// profile, so an older enqueue can never substitute stale content for a new save.
func (s *Service) QueueProfileReview(ctx context.Context, userID string) error {
	nonce := uuid.NewString()
	s.profileMu.Lock()
	if s.profilePending == nil {
		s.profilePending = make(map[string]string)
	}
	s.profilePending[userID] = nonce
	s.profileMu.Unlock()
	return s.persistProfileReview(ctx, userID, nonce)
}

func (s *Service) persistProfileReview(ctx context.Context, userID, nonce string) error {
	if s.store == nil {
		return ErrUnavailable
	}
	_, err := s.store.TxPipelined(ctx, func(pipe redis.Pipeliner) error {
		pipe.HSet(ctx, s.prefix+"profile-jobs", userID, nonce)
		pipe.ZAdd(ctx, s.prefix+"profile-due", redis.Z{Score: float64(time.Now().Unix()), Member: userID})
		return nil
	})
	if err != nil {
		return ErrUnavailable
	}
	s.profileMu.Lock()
	if s.profilePending[userID] == nonce {
		delete(s.profilePending, userID)
	}
	s.profileMu.Unlock()
	return nil
}

func (s *Service) RunProfileReviews(ctx context.Context, review func(context.Context, string) error) {
	if s.store == nil {
		logger.Warn(ctx, "用户资料后台审核暂未启用，Redis 未配置")
		return
	}
	logger.Info(ctx, "用户资料后台审核已启用")
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		// Retry brief Redis outages without holding up registration. Persisted
		// jobs survive process restarts and are shared by all replicas.
		s.profileMu.Lock()
		pending := make(map[string]string)
		for id, nonce := range s.profilePending {
			pending[id] = nonce
			if len(pending) == 16 {
				break
			}
		}
		s.profileMu.Unlock()
		for id, nonce := range pending {
			writeCtx, cancel := context.WithTimeout(ctx, time.Second)
			err := s.persistProfileReview(writeCtx, id, nonce)
			cancel()
			if err != nil {
				break
			}
		}
		queryCtx, cancel := context.WithTimeout(ctx, time.Second)
		owners, err := s.store.ZRangeByScore(queryCtx, s.prefix+"profile-due", &redis.ZRangeBy{
			Min: "-inf", Max: strconv.FormatInt(time.Now().Unix(), 10), Count: 16,
		}).Result()
		cancel()
		if err != nil {
			continue
		}
		for _, owner := range owners {
			if ctx.Err() != nil {
				return
			}
			s.runProfileReview(ctx, owner, review)
		}
	}
}

func (s *Service) runProfileReview(ctx context.Context, owner string, review func(context.Context, string) error) {
	jobCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	lockKey := s.prefix + "profile-lock:" + owner
	lockValue := uuid.NewString()
	locked, err := s.store.SetNX(jobCtx, lockKey, lockValue, 45*time.Second).Result()
	if err != nil || !locked {
		return
	}
	defer func() {
		releaseCtx, releaseCancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
		defer releaseCancel()
		_, _ = releaseMediaLock.Run(releaseCtx, s.store, []string{lockKey}, lockValue).Result()
	}()
	nonce, err := s.store.HGet(jobCtx, s.prefix+"profile-jobs", owner).Result()
	if err != nil {
		return
	}
	err = review(jobCtx, owner)
	status := "done"
	if err != nil {
		status = "retry"
		logger.Warn(jobCtx, "用户资料后台审核延后重试", slog.String("user_id", owner), slog.String("reason", err.Error()))
	}
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), time.Second)
	defer finishCancel()
	_, finishErr := finishProfileReview.Run(finishCtx, s.store,
		[]string{s.prefix + "profile-jobs", s.prefix + "profile-due"}, owner, nonce, status, time.Now().Add(5*time.Second).Unix()).Result()
	if finishErr != nil {
		logger.Error(finishCtx, "更新用户资料审核队列失败", finishErr, slog.String("user_id", owner))
	}
}
