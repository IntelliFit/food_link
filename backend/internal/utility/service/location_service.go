package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/config"
)

const (
	tiandituGeocoderEndpoint = "https://api.tianditu.gov.cn/geocoder"
	tiandituSearchEndpoint   = "https://api.tianditu.gov.cn/v2/search"

	locationServiceUnavailableCode    = 10030
	locationServiceUnavailableMessage = "位置服务暂时不可用，请稍后重试"
)

var errLocationServiceUnavailable = &commonerrors.AppError{
	Code:       locationServiceUnavailableCode,
	Message:    locationServiceUnavailableMessage,
	HTTPStatus: http.StatusBadGateway,
}

type LocationService struct {
	cfg    *config.Config
	client *http.Client
}

func NewLocationService(cfg *config.Config) *LocationService {
	return &LocationService{
		cfg:    cfg,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *LocationService) ReverseGeocode(ctx context.Context, lat, lng float64) (map[string]any, error) {
	tk := s.cfg.External.TiandituTK
	if tk == "" {
		if s.developmentFallbackEnabled() {
			return developmentReverseGeocode(lat, lng), nil
		}
		return nil, errLocationServiceUnavailable
	}
	postStr, err := json.Marshal(map[string]any{
		"lon": lng,
		"lat": lat,
		"ver": 1,
	})
	if err != nil {
		return nil, err
	}
	apiURL := tiandituURL(tiandituGeocoderEndpoint, url.Values{
		"postStr": {string(postStr)},
		"type":    {"geocode"},
		"tk":      {tk},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		if s.developmentFallbackEnabled() {
			return developmentReverseGeocode(lat, lng), nil
		}
		return nil, err
	}
	data, err := decodeTiandituJSON(resp)
	if err != nil {
		if s.developmentFallbackEnabled() && errors.Is(err, errLocationServiceUnavailable) {
			return developmentReverseGeocode(lat, lng), nil
		}
		return nil, err
	}
	return data, nil
}

func (s *LocationService) SearchAddress(ctx context.Context, keyword string) (map[string]any, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return map[string]any{"keyword": "", "pois": []any{}}, nil
	}
	tk := s.cfg.External.TiandituTK
	if tk == "" {
		if s.developmentFallbackEnabled() {
			return developmentSearchResult(keyword), nil
		}
		return nil, errLocationServiceUnavailable
	}
	postStr, err := json.Marshal(map[string]any{
		"keyWord":   keyword,
		"level":     12,
		"mapBound":  "-180,-90,180,90",
		"queryType": 1,
		"start":     0,
		"count":     10,
	})
	if err != nil {
		return nil, err
	}
	apiURL := tiandituURL(tiandituSearchEndpoint, url.Values{
		"postStr": {string(postStr)},
		"type":    {"query"},
		"tk":      {tk},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		if s.developmentFallbackEnabled() {
			return developmentSearchResult(keyword), nil
		}
		return nil, err
	}
	data, err := decodeTiandituJSON(resp)
	if err != nil {
		if s.developmentFallbackEnabled() && errors.Is(err, errLocationServiceUnavailable) {
			return developmentSearchResult(keyword), nil
		}
		return nil, err
	}
	return data, nil
}

func tiandituURL(endpoint string, values url.Values) string {
	return endpoint + "?" + values.Encode()
}

func decodeTiandituJSON(resp *http.Response) (map[string]any, error) {
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("%w: http_status=%d", errLocationServiceUnavailable, resp.StatusCode)
	}
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" || strings.HasPrefix(trimmed, "<") {
		return nil, errLocationServiceUnavailable
	}
	var data map[string]any
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, errLocationServiceUnavailable
	}
	switch status := strings.TrimSpace(fmt.Sprint(data["status"])); status {
	case "", "0", "101":
		return data, nil
	default:
		return nil, fmt.Errorf("%w: status=%s", errLocationServiceUnavailable, status)
	}
}

func (s *LocationService) developmentFallbackEnabled() bool {
	if s == nil || s.cfg == nil {
		return false
	}
	env := strings.TrimSpace(strings.ToLower(s.cfg.App.Env))
	return env == "development" || env == "dev" || env == "local"
}

func developmentSearchResult(keyword string) map[string]any {
	name := strings.TrimSpace(keyword)
	if name == "" {
		name = "测试位置"
	}
	return map[string]any{
		"keyword": name,
		"pois": []map[string]any{
			{
				"name":      name,
				"address":   "北京市东城区东长安街",
				"lonlat":    "116.40769,39.89945",
				"longitude": 116.40769,
				"latitude":  39.89945,
				"province":  "北京市",
				"city":      "北京市",
				"district":  "东城区",
				"location": map[string]any{
					"lng": 116.40769,
					"lat": 39.89945,
				},
			},
		},
		"prompt": []map[string]any{
			{
				"admins": []map[string]any{
					{"adminName": "北京市"},
				},
			},
		},
		"fallback": true,
	}
}

func developmentReverseGeocode(lat, lng float64) map[string]any {
	return map[string]any{
		"status":  "0",
		"msg":     "ok",
		"address": "北京市东城区东长安街",
		"location": map[string]any{
			"lon": lng,
			"lat": lat,
		},
		"fallback": true,
	}
}
