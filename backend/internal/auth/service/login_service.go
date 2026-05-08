package service

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
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
		phone := s.resolvePhoneNumber(ctx, input.PhoneCode)
		inviteCode := strings.ToUpper(strings.TrimSpace(input.InviteCode))
		pointsBalance := 100.0
		user = &repo.User{
			OpenID:        openID,
			Nickname:      "",
			Avatar:        "",
			Telephone:     phone,
			PointsBalance: &pointsBalance,
		}
		if unionID != "" {
			user.UnionID = &unionID
		}
		if err := s.users.Create(ctx, user); err != nil {
			return nil, err
		}
		_ = s.ensureRegistrationInviteCode(ctx, user.ID)
		if inviteCode != "" {
			_ = s.bindInviteReferral(ctx, user.ID, inviteCode)
		}
	} else if unionID != "" && user.UnionID == nil {
		user, err = s.users.UpdateFields(ctx, user.ID, map[string]any{"unionid": unionID})
		if err != nil {
			return nil, err
		}
	}
	if user != nil && (user.Telephone == nil || strings.TrimSpace(*user.Telephone) == "") && strings.TrimSpace(input.PhoneCode) != "" {
		if phone := s.resolvePhoneNumber(ctx, input.PhoneCode); phone != nil && strings.TrimSpace(*phone) != "" {
			user, err = s.users.UpdateFields(ctx, user.ID, map[string]any{"telephone": strings.TrimSpace(*phone)})
			if err != nil {
				return nil, err
			}
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

func (s *LoginService) resolvePhoneNumber(ctx context.Context, phoneCode string) *string {
	phoneCode = strings.TrimSpace(phoneCode)
	if phoneCode == "" {
		return nil
	}
	accessToken, err := s.getWechatAccessToken(ctx)
	if err != nil {
		return nil
	}
	url := fmt.Sprintf("https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=%s", accessToken)
	body, _ := json.Marshal(map[string]string{"code": phoneCode})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil
	}
	phoneInfo, _ := result["phone_info"].(map[string]any)
	pure := strings.TrimSpace(fmt.Sprintf("%v", phoneInfo["purePhoneNumber"]))
	if pure == "" || pure == "<nil>" {
		return nil
	}
	return &pure
}

func (s *LoginService) getWechatAccessToken(ctx context.Context) (string, error) {
	url := "https://api.weixin.qq.com/cgi-bin/stable_token"
	body, _ := json.Marshal(map[string]string{
		"grant_type": "client_credential",
		"appid":      s.cfg.External.AppID,
		"secret":     s.cfg.External.Secret,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if token, ok := result["access_token"].(string); ok && token != "" {
		return token, nil
	}
	return "", fmt.Errorf("access_token empty")
}

func (s *LoginService) ensureRegistrationInviteCode(ctx context.Context, userID string) error {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil || user == nil {
		return err
	}
	if user.RegistrationInviteCode != nil && strings.TrimSpace(*user.RegistrationInviteCode) != "" {
		return nil
	}
	for i := 0; i < 8; i++ {
		code := randomInviteCode()
		if _, err := s.users.UpdateFields(ctx, userID, map[string]any{"registration_invite_code": code}); err == nil {
			return nil
		}
	}
	return nil
}

func (s *LoginService) bindInviteReferral(ctx context.Context, inviteeUserID, inviteCode string) error {
	inviter, err := s.users.FindByRegistrationInviteCode(ctx, inviteCode)
	if err != nil {
		return err
	}
	if inviter == nil {
		inviter, err = s.users.ResolveUserByInviteCode(ctx, inviteCode)
		if err != nil {
			return err
		}
	}
	if inviter == nil || inviter.ID == "" || inviter.ID == inviteeUserID {
		return nil
	}
	_, _ = s.users.UpdateFields(ctx, inviteeUserID, map[string]any{"referred_by_user_id": inviter.ID})
	return s.users.CreateInviteReferralBinding(ctx, inviter.ID, inviteeUserID, inviteCode)
}

func randomInviteCode() string {
	var buf [4]byte
	_, _ = rand.Read(buf[:])
	return strings.ToUpper(hex.EncodeToString(buf[:]))
}
