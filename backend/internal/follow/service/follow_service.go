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

type FollowService struct {
	followRepo *repo.FollowRepo
	cacheMu    sync.RWMutex
	cache      map[string]followCacheEntry
	storage    *storage.Client
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

func (s *FollowService) invalidateFollowCache(userID string) {
	s.cacheMu.Lock()
	delete(s.cache, userID)
	s.cacheMu.Unlock()
}

func (s *FollowService) Follow(ctx context.Context, followerID, followeeID string) error {
	if followerID == followeeID {
		return &commonerrors.AppError{Code: 10002, Message: "不能关注自己", HTTPStatus: 400}
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
	return s.followRepo.IsFollowing(ctx, followerID, followeeID)
}

func (s *FollowService) CountFollowers(ctx context.Context, userID string) (int64, error) {
	return s.followRepo.CountFollowers(ctx, userID)
}

func (s *FollowService) CountFollowing(ctx context.Context, userID string) (int64, error) {
	return s.followRepo.CountFollowing(ctx, userID)
}

func (s *FollowService) GetFollowers(ctx context.Context, userID string, offset, limit int) ([]map[string]any, error) {
	users, err := s.followRepo.GetFollowers(ctx, userID, offset, limit)
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

func (s *FollowService) GetFollowing(ctx context.Context, userID string, offset, limit int) ([]map[string]any, error) {
	users, err := s.followRepo.GetFollowing(ctx, userID, offset, limit)
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
	followersCount, err := s.followRepo.CountFollowers(ctx, userID)
	if err != nil {
		return nil, err
	}
	followingCount, err := s.followRepo.CountFollowing(ctx, userID)
	if err != nil {
		return nil, err
	}
	isFollowing := false
	if currentUserID != "" && currentUserID != userID {
		isFollowing, _ = s.followRepo.IsFollowing(ctx, currentUserID, userID)
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
