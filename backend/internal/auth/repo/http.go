package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const wechatUpstreamRequestTimeout = 4 * time.Second

var (
	ErrWechatUpstreamUnavailable = errors.New("微信服务暂时不可用")
	wechatUpstreamHTTPClient     = &http.Client{Timeout: wechatUpstreamRequestTimeout}
)

func simpleJSONGet(ctx context.Context, endpoint string, params map[string]string, target any) error {
	return simpleJSONGetWithClient(ctx, wechatUpstreamHTTPClient, endpoint, params, target)
}

func simpleJSONGetWithClient(ctx context.Context, client *http.Client, endpoint string, params map[string]string, target any) error {
	reqURL, err := url.Parse(endpoint)
	if err != nil {
		return err
	}
	q := reqURL.Query()
	for key, value := range params {
		q.Set(key, value)
	}
	reqURL.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL.String(), nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		return fmt.Errorf("%w: 网络请求失败", ErrWechatUpstreamUnavailable)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%w: HTTP %d", ErrWechatUpstreamUnavailable, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
		return fmt.Errorf("%w: 响应解析失败", ErrWechatUpstreamUnavailable)
	}
	return nil
}
