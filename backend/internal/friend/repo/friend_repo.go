package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	"food_link/backend/internal/friend/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// User — minimal weapp_user struct for friend queries
type User struct {
	ID        string  `gorm:"column:id"`
	Nickname  string  `gorm:"column:nickname"`
	Avatar    string  `gorm:"column:avatar"`
	Telephone *string `gorm:"column:telephone"`
}

func (User) TableName() string { return "weapp_user" }

type FriendRepo struct {
	db *gorm.DB
}

func NewFriendRepo(db *gorm.DB) *FriendRepo {
	return &FriendRepo{db: db}
}

func (r *FriendRepo) GetFriendIDs(ctx context.Context, userID string) ([]string, error) {
	var rows []domain.UserFriend
	err := r.db.WithContext(ctx).
		Where("user_id = ? OR friend_id = ?", userID, userID).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[string]struct{})
	for _, row := range rows {
		if row.UserID == userID && row.FriendID != "" {
			out[row.FriendID] = struct{}{}
		} else if row.FriendID == userID && row.UserID != "" {
			out[row.UserID] = struct{}{}
		}
	}
	result := make([]string, 0, len(out))
	for id := range out {
		result = append(result, id)
	}
	return result, nil
}

func (r *FriendRepo) IsFriend(ctx context.Context, userID, friendID string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.UserFriend{}).
		Where("(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", userID, friendID, friendID, userID).
		Count(&count).Error
	return count > 0, err
}

func (r *FriendRepo) IsBlocked(ctx context.Context, blockerUserID, blockedUserID string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.UserBlock{}).
		Where("blocker_user_id = ? AND blocked_user_id = ?", blockerUserID, blockedUserID).
		Count(&count).Error
	return count > 0, err
}

func (r *FriendRepo) IsBlockedEither(ctx context.Context, userA, userB string) (bool, error) {
	if strings.TrimSpace(userA) == "" || strings.TrimSpace(userB) == "" || userA == userB {
		return false, nil
	}
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.UserBlock{}).
		Where("(blocker_user_id = ? AND blocked_user_id = ?) OR (blocker_user_id = ? AND blocked_user_id = ?)", userA, userB, userB, userA).
		Count(&count).Error
	return count > 0, err
}

func (r *FriendRepo) GetBlockedPairUserIDs(ctx context.Context, userID string) ([]string, error) {
	var rows []domain.UserBlock
	err := r.db.WithContext(ctx).Model(&domain.UserBlock{}).
		Where("blocker_user_id = ? OR blocked_user_id = ?", userID, userID).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[string]struct{})
	for _, row := range rows {
		if row.BlockerUserID == userID && row.BlockedUserID != "" {
			out[row.BlockedUserID] = struct{}{}
		}
		if row.BlockedUserID == userID && row.BlockerUserID != "" {
			out[row.BlockerUserID] = struct{}{}
		}
	}
	result := make([]string, 0, len(out))
	for id := range out {
		result = append(result, id)
	}
	return result, nil
}

func (r *FriendRepo) AddFriendPair(ctx context.Context, userID, friendID string) error {
	var existing1, existing2 int64
	r.db.WithContext(ctx).Model(&domain.UserFriend{}).
		Where("user_id = ? AND friend_id = ?", userID, friendID).Count(&existing1)
	r.db.WithContext(ctx).Model(&domain.UserFriend{}).
		Where("user_id = ? AND friend_id = ?", friendID, userID).Count(&existing2)

	now := time.Now()
	if existing1 == 0 {
		uf1 := domain.UserFriend{ID: uuid.New().String(), UserID: userID, FriendID: friendID}
		if err := r.db.WithContext(ctx).Create(&uf1).Error; err != nil {
			if !isUniqueViolation(err) {
				return err
			}
		}
	}
	if existing2 == 0 {
		uf2 := domain.UserFriend{ID: uuid.New().String(), UserID: friendID, FriendID: userID}
		if err := r.db.WithContext(ctx).Create(&uf2).Error; err != nil {
			if !isUniqueViolation(err) {
				return err
			}
		}
	}
	_ = now
	return nil
}

func (r *FriendRepo) RemoveFriendPair(ctx context.Context, userID, friendID string) error {
	if _, err := r.DeleteFriendPair(ctx, userID, friendID); err != nil {
		return err
	}
	// clean up pending requests between them
	r.db.WithContext(ctx).Model(&domain.FriendRequest{}).
		Where("from_user_id = ? AND to_user_id = ? AND status = ?", userID, friendID, "pending").
		Delete(&domain.FriendRequest{})
	r.db.WithContext(ctx).Model(&domain.FriendRequest{}).
		Where("from_user_id = ? AND to_user_id = ? AND status = ?", friendID, userID, "pending").
		Delete(&domain.FriendRequest{})
	return nil
}

func (r *FriendRepo) BlockUser(ctx context.Context, blockerUserID, blockedUserID string) (*domain.UserBlock, error) {
	now := time.Now()
	block := &domain.UserBlock{
		ID:            uuid.New().String(),
		BlockerUserID: blockerUserID,
		BlockedUserID: blockedUserID,
		CreatedAt:     &now,
	}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(block).Error; err != nil {
			if !isUniqueViolation(err) {
				return err
			}
			if err := tx.Where("blocker_user_id = ? AND blocked_user_id = ?", blockerUserID, blockedUserID).First(block).Error; err != nil {
				return err
			}
		}
		if err := tx.Where(
			"(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
			blockerUserID, blockedUserID, blockedUserID, blockerUserID,
		).Delete(&domain.UserFriend{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)) AND status = ?",
			blockerUserID, blockedUserID, blockedUserID, blockerUserID, "pending",
		).Delete(&domain.FriendRequest{}).Error; err != nil {
			return err
		}
		if err := tx.Exec(
			`DELETE FROM user_follows
			WHERE (follower_id = ? AND followee_id = ?)
			   OR (follower_id = ? AND followee_id = ?)`,
			blockerUserID, blockedUserID, blockedUserID, blockerUserID,
		).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return block, nil
}

func (r *FriendRepo) UnblockUser(ctx context.Context, blockerUserID, blockedUserID string) error {
	return r.db.WithContext(ctx).Where(
		"blocker_user_id = ? AND blocked_user_id = ?",
		blockerUserID, blockedUserID,
	).Delete(&domain.UserBlock{}).Error
}

func (r *FriendRepo) GetBlockedUsersWithProfile(ctx context.Context, blockerUserID string) ([]domain.UserBlockExt, error) {
	var rows []domain.UserBlock
	if err := r.db.WithContext(ctx).Model(&domain.UserBlock{}).
		Where("blocker_user_id = ?", blockerUserID).
		Order("created_at DESC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []domain.UserBlockExt{}, nil
	}
	userIDs := make([]string, 0, len(rows))
	for _, row := range rows {
		userIDs = append(userIDs, row.BlockedUserID)
	}
	var users []User
	if err := r.db.WithContext(ctx).Where("id IN ?", userIDs).Find(&users).Error; err != nil {
		return nil, err
	}
	usersMap := make(map[string]User, len(users))
	for _, u := range users {
		usersMap[u.ID] = u
	}
	out := make([]domain.UserBlockExt, 0, len(rows))
	for _, row := range rows {
		u := usersMap[row.BlockedUserID]
		out = append(out, domain.UserBlockExt{
			UserBlock:       row,
			BlockedNickname: defaultNickname(u.Nickname),
			BlockedAvatar:   u.Avatar,
		})
	}
	return out, nil
}

func (r *FriendRepo) SearchUsers(ctx context.Context, currentUserID, nickname, telephone string, limit int) ([]User, error) {
	if limit <= 0 {
		limit = 20
	}
	var users []User
	q := r.db.WithContext(ctx).Model(&User{}).Select("id, nickname, avatar").
		Where("COALESCE(searchable, TRUE) = TRUE").
		Where("id <> ?", currentUserID).
		Where(`NOT EXISTS (
			SELECT 1 FROM user_blocks ub
			WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = weapp_user.id)
			   OR (ub.blocker_user_id = weapp_user.id AND ub.blocked_user_id = ?)
		)`, currentUserID, currentUserID)
	if telephone != "" {
		q = q.Where("telephone = ?", strings.TrimSpace(telephone)).Limit(1)
	} else if nickname != "" {
		q = q.Where("LOWER(nickname) LIKE LOWER(?)", "%"+strings.TrimSpace(nickname)+"%").Limit(limit)
	} else {
		return nil, nil
	}
	err := q.Find(&users).Error
	return users, err
}

func (r *FriendRepo) GetPendingToUserIDs(ctx context.Context, fromUserID string) ([]string, error) {
	var rows []domain.FriendRequest
	err := r.db.WithContext(ctx).Model(&domain.FriendRequest{}).
		Select("to_user_id").
		Where("from_user_id = ? AND status = ?", fromUserID, "pending").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.ToUserID
	}
	return out, nil
}

func (r *FriendRepo) SendFriendRequest(ctx context.Context, fromUserID, toUserID string) (*domain.FriendRequest, error) {
	var existing domain.FriendRequest
	err := r.db.WithContext(ctx).Where("from_user_id = ? AND to_user_id = ?", fromUserID, toUserID).
		First(&existing).Error
	if err == nil {
		if existing.Status == "pending" {
			return &existing, nil
		}
		now := time.Now()
		existing.Status = "pending"
		existing.UpdatedAt = &now
		r.db.WithContext(ctx).Save(&existing)
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	fr := &domain.FriendRequest{
		ID:         uuid.New().String(),
		FromUserID: fromUserID,
		ToUserID:   toUserID,
		Status:     "pending",
	}
	if err := r.db.WithContext(ctx).Create(fr).Error; err != nil {
		return nil, err
	}
	return fr, nil
}

func (r *FriendRepo) GetFriendRequestForReceiver(ctx context.Context, requestID, toUserID string) (*domain.FriendRequest, error) {
	var req domain.FriendRequest
	if err := r.db.WithContext(ctx).Where("id = ? AND to_user_id = ?", requestID, toUserID).First(&req).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &req, nil
}

func (r *FriendRepo) GetFriendRequestsReceived(ctx context.Context, toUserID string) ([]domain.FriendRequest, error) {
	var rows []domain.FriendRequest
	err := r.db.WithContext(ctx).Where("to_user_id = ? AND status = ?", toUserID, "pending").
		Where(`NOT EXISTS (
			SELECT 1 FROM user_blocks ub
			WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = friend_requests.from_user_id)
			   OR (ub.blocker_user_id = friend_requests.from_user_id AND ub.blocked_user_id = ?)
		)`, toUserID, toUserID).
		Order("created_at DESC").
		Find(&rows).Error
	return rows, err
}

func (r *FriendRepo) RespondFriendRequest(ctx context.Context, requestID, toUserID string, accept bool) error {
	var req domain.FriendRequest
	if err := r.db.WithContext(ctx).Where("id = ? AND to_user_id = ?", requestID, toUserID).First(&req).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("请求不存在或无权操作")
		}
		return err
	}
	if req.Status != "pending" {
		return errors.New("该请求已处理")
	}
	status := "rejected"
	if accept {
		status = "accepted"
	}
	now := time.Now()
	updates := map[string]any{
		"status":     status,
		"updated_at": now,
	}
	if err := r.db.WithContext(ctx).Model(&domain.FriendRequest{}).
		Where("id = ?", requestID).Updates(updates).Error; err != nil {
		return err
	}
	if accept {
		return r.AddFriendPair(ctx, req.ToUserID, req.FromUserID)
	}
	return nil
}

func (r *FriendRepo) CancelSentFriendRequest(ctx context.Context, requestID, fromUserID string) error {
	var req domain.FriendRequest
	if err := r.db.WithContext(ctx).Where("id = ? AND from_user_id = ?", requestID, fromUserID).First(&req).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errors.New("请求不存在或无权撤销")
		}
		return err
	}
	if req.Status != "pending" {
		return errors.New("只能撤销待对方处理的请求")
	}
	return r.db.WithContext(ctx).Delete(&req).Error
}

func (r *FriendRepo) GetFriendsWithProfile(ctx context.Context, userID string) ([]User, error) {
	friendIDs, err := r.GetFriendIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(friendIDs) == 0 {
		return nil, nil
	}
	var users []User
	err = r.db.WithContext(ctx).Where("id IN ?", friendIDs).Find(&users).Error
	return users, err
}

func (r *FriendRepo) CountFriends(ctx context.Context, userID string) (int64, error) {
	friendIDs, err := r.GetFriendIDs(ctx, userID)
	if err != nil {
		return 0, err
	}
	return int64(len(friendIDs)), nil
}

func (r *FriendRepo) DeleteFriendPair(ctx context.Context, userID, friendID string) (int64, error) {
	res := r.db.WithContext(ctx).Where(
		"(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
		userID, friendID, friendID, userID,
	).Delete(&domain.UserFriend{})
	return res.RowsAffected, res.Error
}

func (r *FriendRepo) GetFriendRequestsOverview(ctx context.Context, userID string) (received []domain.FriendRequestExt, sent []domain.FriendRequestExt, err error) {
	var receivedRows, sentRows []domain.FriendRequest
	blockFilter := `NOT EXISTS (
		SELECT 1 FROM user_blocks ub
		WHERE (ub.blocker_user_id = ? AND ub.blocked_user_id = CASE WHEN friend_requests.from_user_id = ? THEN friend_requests.to_user_id ELSE friend_requests.from_user_id END)
		   OR (ub.blocker_user_id = CASE WHEN friend_requests.from_user_id = ? THEN friend_requests.to_user_id ELSE friend_requests.from_user_id END AND ub.blocked_user_id = ?)
	)`
	if err = r.db.WithContext(ctx).Where("to_user_id = ?", userID).
		Where(blockFilter, userID, userID, userID, userID).
		Order("created_at DESC").Find(&receivedRows).Error; err != nil {
		return nil, nil, err
	}
	if err = r.db.WithContext(ctx).Where("from_user_id = ?", userID).
		Where(blockFilter, userID, userID, userID, userID).
		Order("created_at DESC").Find(&sentRows).Error; err != nil {
		return nil, nil, err
	}

	counterpartIDs := make(map[string]struct{})
	for _, row := range receivedRows {
		counterpartIDs[row.FromUserID] = struct{}{}
	}
	for _, row := range sentRows {
		counterpartIDs[row.ToUserID] = struct{}{}
	}

	usersMap := make(map[string]User)
	if len(counterpartIDs) > 0 {
		ids := make([]string, 0, len(counterpartIDs))
		for id := range counterpartIDs {
			ids = append(ids, id)
		}
		var users []User
		if err := r.db.WithContext(ctx).Where("id IN ?", ids).Find(&users).Error; err != nil {
			return nil, nil, err
		}
		for _, u := range users {
			usersMap[u.ID] = u
		}
	}

	for _, row := range receivedRows {
		u := usersMap[row.FromUserID]
		received = append(received, domain.FriendRequestExt{
			FriendRequest:       row,
			CounterpartUserID:   row.FromUserID,
			CounterpartNickname: defaultNickname(u.Nickname),
			CounterpartAvatar:   u.Avatar,
		})
	}
	for _, row := range sentRows {
		u := usersMap[row.ToUserID]
		sent = append(sent, domain.FriendRequestExt{
			FriendRequest:       row,
			CounterpartUserID:   row.ToUserID,
			CounterpartNickname: defaultNickname(u.Nickname),
			CounterpartAvatar:   u.Avatar,
		})
	}
	return received, sent, nil
}

func (r *FriendRepo) CleanupDuplicateFriends(ctx context.Context, userID string) (int64, error) {
	var rows []domain.UserFriend
	if err := r.db.WithContext(ctx).Where("user_id = ?", userID).Find(&rows).Error; err != nil {
		return 0, err
	}
	friendRecords := make(map[string][]string)
	for _, row := range rows {
		friendRecords[row.FriendID] = append(friendRecords[row.FriendID], row.ID)
	}
	var deleted int64
	for _, ids := range friendRecords {
		if len(ids) > 1 {
			for _, id := range ids[1:] {
				res := r.db.WithContext(ctx).Delete(&domain.UserFriend{}, "id = ?", id)
				if res.Error == nil {
					deleted += res.RowsAffected
				}
			}
		}
	}
	return deleted, nil
}

func (r *FriendRepo) ResolveUserByInviteCode(ctx context.Context, code string) (*User, error) {
	code = strings.TrimSpace(strings.ToLower(code))
	if len(code) < 6 || len(code) > 12 {
		return nil, nil
	}
	pageSize := 500
	offset := 0
	var matches []User
	for {
		var batch []User
		if err := r.db.WithContext(ctx).Model(&User{}).Select("id, nickname, avatar").
			Limit(pageSize).Offset(offset).Find(&batch).Error; err != nil {
			return nil, err
		}
		if len(batch) == 0 {
			break
		}
		for _, u := range batch {
			raw := strings.ToLower(strings.ReplaceAll(u.ID, "-", ""))
			if strings.HasPrefix(raw, code) {
				matches = append(matches, u)
				if len(matches) > 1 {
					break
				}
			}
		}
		if len(matches) > 1 || len(batch) < pageSize {
			break
		}
		offset += pageSize
	}
	if len(matches) == 0 {
		return nil, nil
	}
	if len(matches) > 1 {
		return nil, errors.New("邀请码存在歧义，请使用更长邀请码")
	}
	return &matches[0], nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "unique") || strings.Contains(s, "duplicate")
}

func defaultNickname(n string) string {
	if n == "" {
		return "用户"
	}
	return n
}
