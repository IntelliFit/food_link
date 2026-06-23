package service

import (
	"context"
	"strings"
	"sync"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/follow/repo"
	"food_link/backend/pkg/storage"
)

const followCacheTTL = 5 * time.Minute

type followCacheEntry struct {
	ids []string
	ts  time.Time
}

type BlockChecker interface {
	IsBlockedEither(ctx context.Context, userA, userB string) (bool, error)
}

type FollowService struct {
	followRepo   *repo.FollowRepo
	blockChecker BlockChecker
	cacheMu      sync.RWMutex
	cache        map[string]followCacheEntry
	storage      *storage.Client
}

func NewFollowService(followRepo *repo.FollowRepo, storageClient ...*storage.Client) *FollowService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &FollowService{
		followRepo: followRepo,
		cache:      make(map[string]followCacheEntry),
		storage:    client,
	}
}

func (s *FollowService) ConfigureBlockChecker(checker BlockChecker) {
	s.blockChecker = checker
}

func (s *FollowService) isBlockedEither(ctx context.Context, userA, userB string) (bool, error) {
	userA = strings.TrimSpace(userA)
	userB = strings.TrimSpace(userB)
	if s.blockChecker == nil || userA == "" || userB == "" || userA == userB {
		return false, nil
	}
	return s.blockChecker.IsBlockedEither(ctx, userA, userB)
}

func (s *FollowService) invalidateFollowCache(userID string) {
	s.cacheMu.Lock()
	delete(s.cache, userID)
	s.cacheMu.Unlock()
}

func (s *FollowService) Follow(ctx context.Context, followerID, followeeID string) error {
	if followerID == followeeID {
		return &commonerrors.AppError{Code: 10002, Message: "不能关注自己", HTTPStatus: 400}
	}
	blocked, err := s.isBlockedEither(ctx, followerID, followeeID)
	if err != nil {
		return err
	}
	if blocked {
		return blockedOperationError()
	}
	if err := s.followRepo.Follow(ctx, followerID, followeeID); err != nil {
		return err
	}
	s.invalidateFollowCache(followeeID)
	return nil
}

func (s *FollowService) Unfollow(ctx context.Context, followerID, followeeID string) error {
	if err := s.followRepo.Unfollow(ctx, followerID, followeeID); err != nil {
		return err
	}
	s.invalidateFollowCache(followeeID)
	return nil
}

func (s *FollowService) IsFollowing(ctx context.Context, followerID, followeeID string) (bool, error) {
	blocked, err := s.isBlockedEither(ctx, followerID, followeeID)
	if err != nil {
		return false, err
	}
	if blocked {
		return false, nil
	}
	return s.followRepo.IsFollowing(ctx, followerID, followeeID)
}

func (s *FollowService) CountFollowers(ctx context.Context, userID string) (int64, error) {
	return s.followRepo.CountFollowers(ctx, userID, userID)
}

func (s *FollowService) CountFollowing(ctx context.Context, userID string) (int64, error) {
	return s.followRepo.CountFollowing(ctx, userID, userID)
}

func (s *FollowService) GetFollowers(ctx context.Context, viewerUserID, userID string, offset, limit int) ([]map[string]any, error) {
	if blocked, err := s.isBlockedEither(ctx, viewerUserID, userID); err != nil {
		return nil, err
	} else if blocked {
		return nil, commonerrors.ErrNotFound
	}
	users, err := s.followRepo.GetFollowers(ctx, viewerUserID, userID, offset, limit)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(users))
	for _, u := range users {
		out = append(out, map[string]any{
			"id":       u.ID,
			"nickname": defaultNickname(u.Nickname),
			"avatar":   s.resolveAvatarURL(u.Avatar),
		})
	}
	return out, nil
}

func (s *FollowService) GetFollowing(ctx context.Context, viewerUserID, userID string, offset, limit int) ([]map[string]any, error) {
	if blocked, err := s.isBlockedEither(ctx, viewerUserID, userID); err != nil {
		return nil, err
	} else if blocked {
		return nil, commonerrors.ErrNotFound
	}
	users, err := s.followRepo.GetFollowing(ctx, viewerUserID, userID, offset, limit)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(users))
	for _, u := range users {
		out = append(out, map[string]any{
			"id":       u.ID,
			"nickname": defaultNickname(u.Nickname),
			"avatar":   s.resolveAvatarURL(u.Avatar),
		})
	}
	return out, nil
}

func (s *FollowService) GetFollowStats(ctx context.Context, userID, currentUserID string) (map[string]any, error) {
	if blocked, err := s.isBlockedEither(ctx, currentUserID, userID); err != nil {
		return nil, err
	} else if blocked {
		return nil, commonerrors.ErrNotFound
	}
	viewerUserID := strings.TrimSpace(currentUserID)
	if viewerUserID == "" {
		viewerUserID = userID
	}
	followersCount, err := s.followRepo.CountFollowers(ctx, viewerUserID, userID)
	if err != nil {
		return nil, err
	}
	followingCount, err := s.followRepo.CountFollowing(ctx, viewerUserID, userID)
	if err != nil {
		return nil, err
	}
	isFollowing := false
	if currentUserID != "" && currentUserID != userID {
		isFollowing, _ = s.IsFollowing(ctx, currentUserID, userID)
	}
	return map[string]any{
		"followers_count": followersCount,
		"following_count": followingCount,
		"is_following":    isFollowing,
	}, nil
}

func (s *FollowService) resolveAvatarURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("user-avatars", value)
	if resolved == "" {
		return value
	}
	return resolved
}

func defaultNickname(n string) string {
	if n == "" {
		return "用户"
	}
	return n
}

func blockedOperationError() error {
	return &commonerrors.AppError{Code: 20003, Message: "无法操作", HTTPStatus: 403}
}
