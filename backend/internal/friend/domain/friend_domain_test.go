package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestFriendRequest_Struct(t *testing.T) {
	now := time.Now()
	req := FriendRequest{
		ID:         "req-1",
		FromUserID: "user-1",
		ToUserID:   "user-2",
		Status:     "pending",
		CreatedAt:  &now,
		UpdatedAt:  &now,
	}
	assert.Equal(t, "req-1", req.ID)
	assert.Equal(t, "friend_requests", req.TableName())
}

func TestUserFriend_Struct(t *testing.T) {
	friend := UserFriend{
		ID:       "f-1",
		UserID:   "user-1",
		FriendID: "user-2",
	}
	assert.Equal(t, "f-1", friend.ID)
	assert.Equal(t, "user_friends", friend.TableName())
}

func TestFriendRequestExt_Struct(t *testing.T) {
	now := time.Now()
	ext := FriendRequestExt{
		FriendRequest: FriendRequest{
			ID:         "req-1",
			FromUserID: "user-1",
			ToUserID:   "user-2",
			Status:     "pending",
			CreatedAt:  &now,
		},
		CounterpartUserID:   "user-2",
		CounterpartNickname: "Test User",
	}
	assert.Equal(t, "user-2", ext.CounterpartUserID)
	assert.Equal(t, "Test User", ext.CounterpartNickname)
}
