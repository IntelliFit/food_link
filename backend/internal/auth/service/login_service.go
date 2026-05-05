package service

import (
	"context"
	"strings"

	"food_link/backend/internal/auth/repo"
	"food_link/backend/pkg/config"
)

type LoginInput struct {
	Code       string `json:"code"`
	PhoneCode  string `json:"phoneCode"`
	InviteCode string `json:"inviteCode"`
	TestOpenID string `json:"testOpenid"`
}

type LoginOutput struct {
	AccessToken     string  `json:"access_token"`
	RefreshToken    string  `json:"refresh_token"`
	TokenType       string  `json:"token_type"`
	ExpiresIn       int64   `json:"expires_in"`
	UserID          string  `json:"user_id"`
	OpenID          string  `json:"openid"`
	UnionID         string  `json:"unionid,omitempty"`
	PhoneNumber     *string `json:"phoneNumber,omitempty"`
	PurePhoneNumber *string `json:"purePhoneNumber,omitempty"`
	CountryCode     *string `json:"countryCode,omitempty"`
	DietGoal        *string `json:"diet_goal,omitempty"`
}

type LoginService struct {
	cfg   *config.Config
	users *repo.UserRepo
	jwt   *JWTService
}

func NewLoginService(cfg *config.Config, users *repo.UserRepo, jwt *JWTService) *LoginService {
	return &LoginService{cfg: cfg, users: users, jwt: jwt}
}

func (s *LoginService) Login(ctx context.Context, input LoginInput) (*LoginOutput, error) {
	var openID, unionID string
	testOpenID := strings.TrimSpace(input.TestOpenID)
	if testOpenID != "" && s.cfg.App.Env == "development" {
		openID = testOpenID
	} else {
		oid, uid, err := s.users.ExchangeCode(ctx, s.cfg.External.AppID, s.cfg.External.Secret, strings.TrimSpace(input.Code))
		if err != nil {
			return nil, err
		}
		openID = oid
		unionID = uid
	}

	user, err := s.users.FindByOpenID(ctx, openID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		user = &repo.User{
			OpenID:   openID,
			Nickname: "",
			Avatar:   "",
		}
		if unionID != "" {
			user.UnionID = &unionID
		}
		if err := s.users.Create(ctx, user); err != nil {
			return nil, err
		}
	} else if unionID != "" && user.UnionID == nil {
		user, err = s.users.UpdateFields(ctx, user.ID, map[string]any{"unionid": unionID})
		if err != nil {
			return nil, err
		}
	}

	access, err := s.jwt.IssueAccess(user.ID, openID, unionID)
	if err != nil {
		return nil, err
	}
	refresh, err := s.jwt.IssueRefresh(user.ID, openID)
	if err != nil {
		return nil, err
	}
	return &LoginOutput{
		AccessToken:     access,
		RefreshToken:    refresh,
		TokenType:       "bearer",
		ExpiresIn:       s.cfg.JWT.AccessTokenTTLSeconds,
		UserID:          user.ID,
		OpenID:          openID,
		UnionID:         unionID,
		PhoneNumber:     user.Telephone,
		PurePhoneNumber: user.Telephone,
		DietGoal:        user.DietGoal,
	}, nil
}
