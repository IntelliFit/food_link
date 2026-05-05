package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

func simpleJSONGet(ctx context.Context, endpoint string, params map[string]string, target any) error {
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
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(target)
}
