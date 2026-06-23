package service

import (
	"context"
	"strings"
	"sync"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/friend/repo"
	"food_link/backend/pkg/storage"
)

const friendCacheTTL = 5 * time.Minute

type friendCacheEntry struct {
	ids []string
	ts  time.Time
}

type FriendService struct {
	friendRepo *repo.FriendRepo
	userRepo   *authrepo.UserRepo
	cacheMu    sync.RWMutex
	cache      map[string]friendCacheEntry
	storage    *storage.Client
}

func NewFriendService(friendRepo *repo.FriendRepo, userRepo *authrepo.UserRepo, storageClient ...*storage.Client) *FriendService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &FriendService{
		friendRepo: friendRepo,
		userRepo:   userRepo,
		cache:      make(map[string]friendCacheEntry),
		storage:    client,
	}
}

func (s *FriendService) invalidateFriendCache(userID string) {
	s.cacheMu.Lock()
	delete(s.cache, userID)
	s.cacheMu.Unlock()
}

func (s *FriendService) GetFriendIDs(ctx context.Context, userID string) ([]string, error) {
	s.cacheMu.RLock()
	entry, ok := s.cache[userID]
	s.cacheMu.RUnlock()
	if ok && time.Since(entry.ts) < friendCacheTTL {
		return entry.ids, nil
	}
	ids, err := s.friendRepo.GetFriendIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.cacheMu.Lock()
	s.cache[userID] = friendCacheEntry{ids: ids, ts: time.Now()}
	s.cacheMu.Unlock()
	return ids, nil
}

func (s *FriendService) IsFriend(ctx context.Context, userID, friendID string) (bool, error) {
	return s.friendRepo.IsFriend(ctx, userID, friendID)
}

func (s *FriendService) IsBlocked(ctx context.Context, blockerUserID, blockedUserID string) (bool, error) {
	return s.friendRepo.IsBlocked(ctx, blockerUserID, blockedUserID)
}

func (s *FriendService) IsBlockedEither(ctx context.Context, userID, counterpartUserID string) (bool, error) {
	return s.friendRepo.IsBlockedEither(ctx, userID, counterpartUserID)
}

func (s *FriendService) GetBlockedPairUserIDs(ctx context.Context, userID string) ([]string, error) {
	return s.friendRepo.GetBlockedPairUserIDs(ctx, userID)
}

func (s *FriendService) SearchUsers(ctx context.Context, currentUserID, nickname, telephone string) ([]map[string]any, error) {
	users, err := s.friendRepo.SearchUsers(ctx, currentUserID, nickname, telephone, 20)
	if err != nil {
		return nil, err
	}
	if len(users) == 0 {
		return []map[string]any{}, nil
	}
	friendIDs, err := s.GetFriendIDs(ctx, currentUserID)
	if err != nil {
		return nil, err
	}
	pending, err := s.friendRepo.GetPendingToUserIDs(ctx, currentUserID)
	if err != nil {
		return nil, err
	}
	friendSet := make(map[string]bool, len(friendIDs))
	for _, id := range friendIDs {
		friendSet[id] = true
	}
	pendingSet := make(map[string]bool, len(pending))
	for _, id := range pending {
		pendingSet[id] = true
	}
	out := make([]map[string]any, 0, len(users))
	for _, u := range users {
		out = append(out, map[string]any{
			"id":         u.ID,
			"nickname":   u.Nickname,
			"avatar":     s.resolveAvatarURL(u.Avatar),
			"is_friend":  friendSet[u.ID],
			"is_pending": pendingSet[u.ID],
		})
	}
	return out, nil
}

func (s *FriendService) SendFriendRequest(ctx context.Context, fromUserID, toUserID string) (map[string]any, error) {
	if fromUserID == toUserID {
		return nil, &commonerrors.AppError{Code: 10002, Message: "不能添加自己为好友", HTTPStatus: 400}
	}
	blocked, err := s.IsBlockedEither(ctx, fromUserID, toUserID)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, blockedOperationError()
	}
	isFriend, err := s.IsFriend(ctx, fromUserID, toUserID)
	if err != nil {
		return nil, err
	}
	if isFriend {
		return nil, &commonerrors.AppError{Code: 10002, Message: "你们已是好友", HTTPStatus: 400}
	}
	fr, err := s.friendRepo.SendFriendRequest(ctx, fromUserID, toUserID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":         fr.ID,
		"status":     fr.Status,
		"created_at": fr.CreatedAt,
	}, nil
}

func (s *FriendService) GetFriendRequestsReceived(ctx context.Context, toUserID string) ([]map[string]any, error) {
	rows, err := s.friendRepo.GetFriendRequestsReceived(ctx, toUserID)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []map[string]any{}, nil
	}
	fromIDs := make([]string, 0, len(rows))
	for _, r := range rows {
		fromIDs = append(fromIDs, r.FromUserID)
	}
	usersMap := make(map[string]*authrepo.User)
	for _, id := range fromIDs {
		u, err := s.userRepo.FindByID(ctx, id)
		if err != nil {
			continue
		}
		if u != nil {
			usersMap[id] = u
		}
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		u := usersMap[r.FromUserID]
		nickname := "用户"
		avatar := ""
		if u != nil {
			nickname = u.Nickname
			avatar = s.resolveAvatarURL(u.Avatar)
		}
		out = append(out, map[string]any{
			"id":            r.ID,
			"from_user_id":  r.FromUserID,
			"to_user_id":    r.ToUserID,
			"status":        r.Status,
			"created_at":    r.CreatedAt,
			"from_nickname": nickname,
			"from_avatar":   avatar,
		})
	}
	return out, nil
}

func (s *FriendService) RespondFriendRequest(ctx context.Context, requestID, toUserID string, action string) error {
	if action != "accept" && action != "reject" {
		return &commonerrors.AppError{Code: 10002, Message: "action 必须为 accept 或 reject", HTTPStatus: 400}
	}
	if action == "accept" {
		req, err := s.friendRepo.GetFriendRequestForReceiver(ctx, requestID, toUserID)
		if err != nil {
			return err
		}
		if req == nil {
			return commonerrors.ErrNotFound
		}
		blocked, err := s.IsBlockedEither(ctx, req.FromUserID, req.ToUserID)
		if err != nil {
			return err
		}
		if blocked {
			return blockedOperationError()
		}
	}
	if err := s.friendRepo.RespondFriendRequest(ctx, requestID, toUserID, action == "accept"); err != nil {
		if err.Error() == "请求不存在或无权操作" {
			return commonerrors.ErrNotFound
		}
		if err.Error() == "该请求已处理" {
			return &commonerrors.AppError{Code: 10002, Message: err.Error(), HTTPStatus: 400}
		}
		return err
	}
	s.invalidateFriendCache(toUserID)
	return nil
}

func (s *FriendService) CancelSentFriendRequest(ctx context.Context, requestID, fromUserID string) error {
	if err := s.friendRepo.CancelSentFriendRequest(ctx, requestID, fromUserID); err != nil {
		if err.Error() == "请求不存在或无权撤销" {
			return commonerrors.ErrNotFound
		}
		if err.Error() == "只能撤销待对方处理的请求" {
			return &commonerrors.AppError{Code: 10002, Message: err.Error(), HTTPStatus: 400}
		}
		return err
	}
	return nil
}

func (s *FriendService) GetFriendList(ctx context.Context, userID string) ([]map[string]any, error) {
	users, err := s.friendRepo.GetFriendsWithProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(users))
	for _, u := range users {
		out = append(out, map[string]any{
			"id":       u.ID,
			"nickname": u.Nickname,
			"avatar":   s.resolveAvatarURL(u.Avatar),
		})
	}
	return out, nil
}

func (s *FriendService) CountFriends(ctx context.Context, userID string) (int64, error) {
	return s.friendRepo.CountFriends(ctx, userID)
}

func (s *FriendService) DeleteFriend(ctx context.Context, userID, friendID string) error {
	if userID == friendID {
		return &commonerrors.AppError{Code: 10002, Message: "不能删除自己", HTTPStatus: 400}
	}
	isFriend, err := s.IsFriend(ctx, userID, friendID)
	if err != nil {
		return err
	}
	if !isFriend {
		return &commonerrors.AppError{Code: 10002, Message: "你们还不是好友", HTTPStatus: 400}
	}
	if err := s.friendRepo.RemoveFriendPair(ctx, userID, friendID); err != nil {
		return err
	}
	s.invalidateFriendCache(userID)
	s.invalidateFriendCache(friendID)
	return nil
}

func (s *FriendService) BlockUser(ctx context.Context, blockerUserID, blockedUserID string) (map[string]any, error) {
	blockerUserID = strings.TrimSpace(blockerUserID)
	blockedUserID = strings.TrimSpace(blockedUserID)
	if blockerUserID == "" || blockedUserID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "用户 ID 不能为空", HTTPStatus: 400}
	}
	if blockerUserID == blockedUserID {
		return nil, &commonerrors.AppError{Code: 10002, Message: "不能拉黑自己", HTTPStatus: 400}
	}
	block, err := s.friendRepo.BlockUser(ctx, blockerUserID, blockedUserID)
	if err != nil {
		return nil, err
	}
	s.invalidateFriendCache(blockerUserID)
	s.invalidateFriendCache(blockedUserID)
	return map[string]any{
		"id":              block.ID,
		"blocker_user_id": block.BlockerUserID,
		"blocked_user_id": block.BlockedUserID,
		"created_at":      block.CreatedAt,
	}, nil
}

func (s *FriendService) UnblockUser(ctx context.Context, blockerUserID, blockedUserID string) error {
	blockerUserID = strings.TrimSpace(blockerUserID)
	blockedUserID = strings.TrimSpace(blockedUserID)
	if blockerUserID == "" || blockedUserID == "" {
		return &commonerrors.AppError{Code: 10002, Message: "用户 ID 不能为空", HTTPStatus: 400}
	}
	if blockerUserID == blockedUserID {
		return &commonerrors.AppError{Code: 10002, Message: "不能操作自己", HTTPStatus: 400}
	}
	return s.friendRepo.UnblockUser(ctx, blockerUserID, blockedUserID)
}

func (s *FriendService) GetBlockedUsers(ctx context.Context, blockerUserID string) ([]map[string]any, error) {
	rows, err := s.friendRepo.GetBlockedUsersWithProfile(ctx, blockerUserID)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, map[string]any{
			"id":              row.ID,
			"blocked_user_id": row.BlockedUserID,
			"nickname":        row.BlockedNickname,
			"avatar":          s.resolveAvatarURL(row.BlockedAvatar),
			"created_at":      row.CreatedAt,
		})
	}
	return out, nil
}

func (s *FriendService) GetBlockStatus(ctx context.Context, userID, counterpartUserID string) (map[string]any, error) {
	userID = strings.TrimSpace(userID)
	counterpartUserID = strings.TrimSpace(counterpartUserID)
	if userID == "" || counterpartUserID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "用户 ID 不能为空", HTTPStatus: 400}
	}
	blockedByMe, err := s.IsBlocked(ctx, userID, counterpartUserID)
	if err != nil {
		return nil, err
	}
	hasBlockedMe, err := s.IsBlocked(ctx, counterpartUserID, userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"is_blocked_by_me": blockedByMe,
		"has_blocked_me":   hasBlockedMe,
		"blocked_either":   blockedByMe || hasBlockedMe,
	}, nil
}

func (s *FriendService) GetFriendRequestsOverview(ctx context.Context, userID string) (map[string]any, error) {
	received, sent, err := s.friendRepo.GetFriendRequestsOverview(ctx, userID)
	if err != nil {
		return nil, err
	}
	receivedOut := make([]map[string]any, 0, len(received))
	for _, r := range received {
		receivedOut = append(receivedOut, map[string]any{
			"id":                   r.ID,
			"from_user_id":         r.FromUserID,
			"to_user_id":           r.ToUserID,
			"status":               r.Status,
			"created_at":           r.CreatedAt,
			"updated_at":           r.UpdatedAt,
			"counterpart_user_id":  r.CounterpartUserID,
			"counterpart_nickname": r.CounterpartNickname,
			"counterpart_avatar":   s.resolveAvatarURL(r.CounterpartAvatar),
		})
	}
	sentOut := make([]map[string]any, 0, len(sent))
	for _, r := range sent {
		sentOut = append(sentOut, map[string]any{
			"id":                   r.ID,
			"from_user_id":         r.FromUserID,
			"to_user_id":           r.ToUserID,
			"status":               r.Status,
			"created_at":           r.CreatedAt,
			"updated_at":           r.UpdatedAt,
			"counterpart_user_id":  r.CounterpartUserID,
			"counterpart_nickname": r.CounterpartNickname,
			"counterpart_avatar":   s.resolveAvatarURL(r.CounterpartAvatar),
		})
	}
	return map[string]any{
		"received": receivedOut,
		"sent":     sentOut,
	}, nil
}

func (s *FriendService) CleanupDuplicateFriends(ctx context.Context, userID string) (map[string]any, error) {
	count, err := s.friendRepo.CleanupDuplicateFriends(ctx, userID)
	if err != nil {
		return nil, err
	}
	s.invalidateFriendCache(userID)
	return map[string]any{"cleaned": count, "user_id": userID}, nil
}

func (s *FriendService) GetInviteProfile(ctx context.Context, userID string) (map[string]any, error) {
	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	return map[string]any{
		"id":          user.ID,
		"user_id":     user.ID,
		"nickname":    user.Nickname,
		"avatar":      s.resolveAvatarURL(user.Avatar),
		"invite_code": buildInviteCode(user.ID),
	}, nil
}

func (s *FriendService) ResolveUserByInviteCode(ctx context.Context, code string) (map[string]any, error) {
	user, err := s.friendRepo.ResolveUserByInviteCode(ctx, code)
	if err != nil {
		if err.Error() == "邀请码存在歧义，请使用更长邀请码" {
			return nil, &commonerrors.AppError{Code: 10002, Message: err.Error(), HTTPStatus: 400}
		}
		return nil, err
	}
	if user == nil {
		return nil, commonerrors.ErrNotFound
	}
	return map[string]any{
		"id":          user.ID,
		"user_id":     user.ID,
		"nickname":    user.Nickname,
		"avatar":      s.resolveAvatarURL(user.Avatar),
		"invite_code": buildInviteCode(user.ID),
	}, nil
}

func (s *FriendService) ResolveInviteWithRelation(ctx context.Context, userID, code string) (map[string]any, error) {
	profile, err := s.ResolveUserByInviteCode(ctx, code)
	if err != nil {
		return nil, err
	}
	inviterID, _ := profile["id"].(string)
	isSelf := inviterID == userID
	isFriend := false
	if !isSelf && inviterID != "" {
		blocked, err := s.IsBlockedEither(ctx, userID, inviterID)
		if err != nil {
			return nil, err
		}
		if blocked {
			return nil, commonerrors.ErrNotFound
		}
		isFriend, _ = s.IsFriend(ctx, userID, inviterID)
	}
	profile["is_self"] = isSelf
	profile["is_friend"] = isFriend
	profile["already_friend"] = isFriend
	return profile, nil
}

func (s *FriendService) AcceptInvite(ctx context.Context, userID, code string) (map[string]any, error) {
	profile, err := s.ResolveUserByInviteCode(ctx, code)
	if err != nil {
		return nil, err
	}
	inviterID, _ := profile["id"].(string)
	if inviterID == "" {
		return nil, commonerrors.ErrNotFound
	}
	if inviterID == userID {
		return nil, &commonerrors.AppError{Code: 10002, Message: "不能添加自己为好友", HTTPStatus: 400}
	}
	blocked, err := s.IsBlockedEither(ctx, userID, inviterID)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, blockedOperationError()
	}
	isFriend, _ := s.IsFriend(ctx, userID, inviterID)
	if isFriend {
		profile["status"] = "already_friend"
		profile["already_friend"] = true
		return profile, nil
	}
	fr, err := s.friendRepo.SendFriendRequest(ctx, userID, inviterID)
	if err != nil {
		return nil, err
	}
	profile["request_id"] = fr.ID
	profile["status"] = "request_sent"
	profile["already_friend"] = false
	return profile, nil
}

func (s *FriendService) resolveAvatarURL(value string) string {
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

func buildInviteCode(userID string) string {
	raw := strings.ToLower(strings.ReplaceAll(userID, "-", ""))
	if len(raw) < 8 {
		return raw
	}
	return raw[:8]
}

func blockedOperationError() error {
	return &commonerrors.AppError{Code: 20003, Message: "无法操作", HTTPStatus: 403}
}
