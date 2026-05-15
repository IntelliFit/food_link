package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/config"
)

type BindPhoneService struct {
	cfg   *config.Config
	users *repo.UserRepo
}

func NewBindPhoneService(cfg *config.Config, users *repo.UserRepo) *BindPhoneService {
	return &BindPhoneService{cfg: cfg, users: users}
}

type BindPhoneInput struct {
	PhoneCode string `json:"phoneCode"`
}

type BindPhoneOutput struct {
	Telephone       string `json:"telephone"`
	PurePhoneNumber string `json:"purePhoneNumber"`
}

func (s *BindPhoneService) BindPhone(ctx context.Context, userID string, input BindPhoneInput) (*BindPhoneOutput, error) {
	if input.PhoneCode == "" {
		return nil, commonerrors.ErrBadRequest
	}
	phoneInfo, err := s.getPhoneNumber(ctx, input.PhoneCode)
	if err != nil {
		return nil, err
	}
	purePhoneNumber := ""
	if v, ok := phoneInfo["purePhoneNumber"].(string); ok {
		purePhoneNumber = v
	}
	if purePhoneNumber == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "未能获取到手机号", HTTPStatus: 400}
	}
	_, err = s.users.UpdateFields(ctx, userID, map[string]any{"telephone": purePhoneNumber})
	if err != nil {
		return nil, err
	}
	return &BindPhoneOutput{
		Telephone:       purePhoneNumber,
		PurePhoneNumber: purePhoneNumber,
	}, nil
}

func (s *BindPhoneService) getPhoneNumber(ctx context.Context, phoneCode string) (map[string]any, error) {
	accessToken, err := s.getAccessToken(ctx)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=%s", accessToken)
	body, _ := json.Marshal(map[string]string{"code": phoneCode})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("get phone number failed: status %d", resp.StatusCode)
	}
	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if errCode, ok := result["errcode"].(float64); ok && errCode != 0 {
		errMsg := ""
		if v, ok := result["errmsg"].(string); ok {
			errMsg = v
		}
		return nil, &commonerrors.AppError{Code: 10002, Message: fmt.Sprintf("获取手机号失败: %s", errMsg), HTTPStatus: 400}
	}
	phoneInfo, ok := result["phone_info"].(map[string]any)
	if !ok {
		return nil, &commonerrors.AppError{Code: 10002, Message: "未能获取到手机号", HTTPStatus: 400}
	}
	return phoneInfo, nil
}

func (s *BindPhoneService) getAccessToken(ctx context.Context) (string, error) {
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
	if errCode, ok := result["errcode"].(float64); ok && errCode != 0 {
		return "", fmt.Errorf("get access_token failed: %v", result["errmsg"])
	}
	token, ok := result["access_token"].(string)
	if !ok || token == "" {
		return "", fmt.Errorf("access_token empty")
	}
	return token, nil
}
