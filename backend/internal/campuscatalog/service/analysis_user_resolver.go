package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	authrepo "food_link/backend/internal/auth/repo"

	"github.com/google/uuid"
)

var internalAnalysisOpenIDNamespace = uuid.MustParse("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

type InternalAnalysisUserRepository interface {
	FindByOpenID(ctx context.Context, openID string) (*authrepo.User, error)
	Create(ctx context.Context, user *authrepo.User) error
}

type InternalAnalysisUserResolver struct {
	users InternalAnalysisUserRepository
}

func NewInternalAnalysisUserResolver(users InternalAnalysisUserRepository) *InternalAnalysisUserResolver {
	return &InternalAnalysisUserResolver{users: users}
}

func (r *InternalAnalysisUserResolver) ResolveInternalAnalysisUserID(ctx context.Context, purpose, _ string) (string, error) {
	if r == nil || r.users == nil {
		return "", fmt.Errorf("内部分析用户仓库未配置")
	}
	purpose = strings.TrimSpace(purpose)
	if purpose == "" {
		return "", fmt.Errorf("内部分析用途不能为空")
	}
	openID := uuid.NewSHA1(internalAnalysisOpenIDNamespace, []byte("food_link_internal_analysis:"+purpose)).String()
	if user, err := r.users.FindByOpenID(ctx, openID); err != nil {
		return "", err
	} else if user != nil {
		return user.ID, nil
	}
	now := time.Now()
	user := &authrepo.User{
		ID: uuid.NewString(), OpenID: openID, Nickname: "校园菜品 AI 分析", Avatar: "", CreatedAt: &now,
	}
	if err := r.users.Create(ctx, user); err != nil {
		if existing, findErr := r.users.FindByOpenID(ctx, openID); findErr == nil && existing != nil {
			return existing.ID, nil
		}
		return "", err
	}
	return user.ID, nil
}
