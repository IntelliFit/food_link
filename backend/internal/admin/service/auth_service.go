package service

import (
	"context"
	"fmt"
	"strings"

	"food_link/backend/internal/admin/domain"
	commonerrors "food_link/backend/internal/common/errors"
)

type AdminAccountRepo interface {
	FindByUsername(ctx context.Context, username string) (*domain.AdminAccount, error)
	FindByID(ctx context.Context, id string) (*domain.AdminAccount, error)
	Create(ctx context.Context, account *domain.AdminAccount) (*domain.AdminAccount, error)
	UpdatePassword(ctx context.Context, id, passwordHash, displayName string) (*domain.AdminAccount, error)
	TouchLastLogin(ctx context.Context, id string) error
}

type AuthService struct {
	repo AdminAccountRepo
}

type LoginResult struct {
	Account *domain.AdminAccount
}

type CreateAdminInput struct {
	Username    string
	Password    string
	DisplayName string
	Reset       bool
}

func NewAuthService(repo AdminAccountRepo) *AuthService {
	return &AuthService{repo: repo}
}

func (s *AuthService) Login(ctx context.Context, username, password string) (*LoginResult, error) {
	username = normalizeUsername(username)
	account, err := s.repo.FindByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if account == nil || account.Status != domain.AdminAccountStatusActive || !VerifyAdminPassword(password, account.PasswordHash) {
		return nil, &commonerrors.AppError{Code: 20003, Message: "管理员账号或密码错误", HTTPStatus: 403}
	}
	if err := s.repo.TouchLastLogin(ctx, account.ID); err != nil {
		return nil, err
	}
	return &LoginResult{Account: account}, nil
}

func (s *AuthService) GetActiveAccount(ctx context.Context, id string) (*domain.AdminAccount, error) {
	account, err := s.repo.FindByID(ctx, strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	if account == nil || account.Status != domain.AdminAccountStatusActive {
		return nil, nil
	}
	return account, nil
}

func (s *AuthService) CreateOrResetAdmin(ctx context.Context, input CreateAdminInput) (*domain.AdminAccount, error) {
	username := normalizeUsername(input.Username)
	if username == "" {
		return nil, fmt.Errorf("管理员用户名不能为空")
	}
	passwordHash, err := HashAdminPassword(input.Password)
	if err != nil {
		return nil, err
	}
	existing, err := s.repo.FindByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if !input.Reset {
			return nil, fmt.Errorf("管理员账号 %q 已存在，如需重置密码请添加 -reset", username)
		}
		return s.repo.UpdatePassword(ctx, existing.ID, passwordHash, strings.TrimSpace(input.DisplayName))
	}
	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		displayName = username
	}
	return s.repo.Create(ctx, &domain.AdminAccount{
		Username:     username,
		DisplayName:  displayName,
		PasswordHash: passwordHash,
		Status:       domain.AdminAccountStatusActive,
	})
}

func normalizeUsername(username string) string {
	return strings.ToLower(strings.TrimSpace(username))
}
