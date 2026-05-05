package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"food_link/backend/pkg/config"
)

type LocationService struct {
	cfg *config.Config
	client *http.Client
}

func NewLocationService(cfg *config.Config) *LocationService {
	return &LocationService{
		cfg: cfg,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *LocationService) ReverseGeocode(ctx context.Context, lat, lng float64) (map[string]any, error) {
	tk := s.cfg.External.TiandituTK
	if tk == "" {
		return nil, fmt.Errorf("tianditu tk not configured")
	}
	postStr := fmt.Sprintf(`{"lon":%f,"lat":%f,"ver":1}`, lng, lat)
	apiURL := fmt.Sprintf("http://api.tianditu.gov.cn/geocoder?postStr=%s&type=geocode&tk=%s", url.QueryEscape(postStr), tk)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data, nil
}

func (s *LocationService) SearchAddress(ctx context.Context, keyword string) (map[string]any, error) {
	tk := s.cfg.External.TiandituTK
	if tk == "" {
		return nil, fmt.Errorf("tianditu tk not configured")
	}
	postStr := fmt.Sprintf(`{"keyWord":"%s","level":12,"mapBound":"-180,-90,180,90","queryType":1,"start":0,"count":10}`, keyword)
	apiURL := fmt.Sprintf("http://api.tianditu.gov.cn/search?postStr=%s&type=query&tk=%s", url.QueryEscape(postStr), tk)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data, nil
}
