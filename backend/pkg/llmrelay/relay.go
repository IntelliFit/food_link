// Package llmrelay sends requests meant for Wanjie (the most expensive model
// gateway) to OpenLux and A6 first, and only reaches Wanjie when both fail.
//
// It works at the HTTP transport level so every caller that talks to Wanjie,
// whatever its client type, gets the same order without code changes. Only
// requests to the Wanjie host are touched; everything else passes through.
package llmrelay

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// WanjieHost is the gateway whose traffic is moved to the cheaper channels.
const WanjieHost = "maas-openapi.wanjiedata.com"

// defaultAttemptBudget bounds a relay attempt when the request carries no
// deadline, so a hanging channel still leaves time for the next one.
const defaultAttemptBudget = 45 * time.Second

// Target is one cheaper channel tried before Wanjie.
type Target struct {
	Name    string // used in logs: "openlux", "a6"
	BaseURL string // any URL on the channel's host; only scheme and host are used
	APIKey  string
	// GoogleKeyHeader sends the key as x-goog-api-key on Gemini native calls,
	// which is how A6 authenticates them.
	GoogleKeyHeader bool
	// Query is appended to Gemini native calls (OpenLux routes by success rate).
	GeminiQuery string
}

// Config enables the relay. An empty Targets list or Enabled=false turns it off.
type Config struct {
	Enabled bool
	Targets []Target
	// SourceHost is the host to relay; it defaults to WanjieHost. A value with
	// a port is matched against host:port (tests use local servers).
	SourceHost string
}

var current atomic.Pointer[Config]

// Configure installs the relay settings for every wrapped transport.
func Configure(c Config) {
	targets := make([]Target, 0, len(c.Targets))
	for _, t := range c.Targets {
		if strings.TrimSpace(t.APIKey) == "" || strings.TrimSpace(t.BaseURL) == "" {
			continue
		}
		targets = append(targets, t)
	}
	c.Targets = targets
	if strings.TrimSpace(c.SourceHost) == "" {
		c.SourceHost = WanjieHost
	}
	current.Store(&c)
}

type directKey struct{}

// WithDirect marks a request that must go to Wanjie itself, for example the
// vision router's own Wanjie attempt after OpenLux and A6 already failed.
func WithDirect(ctx context.Context) context.Context {
	return context.WithValue(ctx, directKey{}, true)
}

func isDirect(ctx context.Context) bool {
	v, _ := ctx.Value(directKey{}).(bool)
	return v
}

// Wrap returns a transport that relays Wanjie requests and passes others on.
func Wrap(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	if _, ok := base.(*transport); ok {
		return base
	}
	return &transport{base: base}
}

type transport struct {
	base http.RoundTripper
}

// Unwrap returns the transport Wrap was given, or rt itself when it is not wrapped.
func Unwrap(rt http.RoundTripper) http.RoundTripper {
	if t, ok := rt.(*transport); ok {
		return t.base
	}
	return rt
}

func (t *transport) RoundTrip(req *http.Request) (*http.Response, error) {
	cfg := current.Load()
	if cfg == nil || !cfg.Enabled || len(cfg.Targets) == 0 || !cfg.matches(req.URL) || isDirect(req.Context()) {
		return t.base.RoundTrip(req)
	}
	body, err := readBody(req)
	if err != nil {
		return nil, err
	}
	// The relay channels count thinking tokens toward max_tokens; Wanjie does
	// not, so only the relayed copies get the extra room.
	relayBody := withThinkingHeadroom(body)
	var lastErr error
	for i, target := range cfg.Targets {
		if req.Context().Err() != nil {
			break
		}
		attempt, cancel, err := relayRequest(req, relayBody, target, len(cfg.Targets)-i+1)
		if err != nil {
			lastErr = err
			continue
		}
		resp, err := t.base.RoundTrip(attempt)
		if err == nil {
			resp, err = bufferClientError(resp)
		}
		if err == nil && !retryableStatus(resp) {
			resp.Body = &cancelOnClose{ReadCloser: resp.Body, cancel: cancel}
			slog.Info("万界请求由其他渠道完成", "target", target.Name, "status", resp.StatusCode, "path", req.URL.Path)
			return resp, nil
		}
		status := "transport_error"
		if err == nil {
			status = fmt.Sprintf("http_%d", resp.StatusCode)
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
			_ = resp.Body.Close()
			err = fmt.Errorf("%s returned %d", target.Name, resp.StatusCode)
		}
		cancel()
		lastErr = err
		slog.Warn("万界请求改走其他渠道失败，尝试下一个", "target", target.Name, "status", status, "path", req.URL.Path)
	}
	if req.Context().Err() != nil {
		if lastErr != nil {
			return nil, errors.Join(lastErr, req.Context().Err())
		}
		return nil, req.Context().Err()
	}
	slog.Warn("OpenLux 和 A6 都未成功，回到万界", "path", req.URL.Path, "last_error", errString(lastErr))
	direct := req.Clone(req.Context())
	direct.Body = io.NopCloser(bytes.NewReader(body))
	direct.ContentLength = int64(len(body))
	return t.base.RoundTrip(direct)
}

func readBody(req *http.Request) ([]byte, error) {
	if req.Body == nil || req.Body == http.NoBody {
		return nil, nil
	}
	if req.GetBody != nil {
		rc, err := req.GetBody()
		if err == nil {
			defer rc.Close()
			_ = req.Body.Close()
			return io.ReadAll(rc)
		}
	}
	defer req.Body.Close()
	return io.ReadAll(req.Body)
}

// relayRequest rewrites a Wanjie request for target. Wanjie serves OpenAI
// routes under /api/v1 and Gemini native routes under /api/v1beta; the relay
// channels serve the same routes without the /api prefix.
func relayRequest(req *http.Request, body []byte, target Target, attemptsLeft int) (*http.Request, context.CancelFunc, error) {
	base, err := url.Parse(target.BaseURL)
	if err != nil || base.Host == "" {
		return nil, nil, fmt.Errorf("invalid %s base URL", target.Name)
	}
	ctx, cancel := attemptContext(req.Context(), attemptsLeft)
	out := req.Clone(ctx)
	u := *req.URL
	u.Scheme, u.Host = base.Scheme, base.Host
	u.Path = strings.TrimPrefix(req.URL.Path, "/api")
	u.RawPath = ""
	gemini := strings.HasPrefix(u.Path, "/v1beta/")
	if gemini && target.GeminiQuery != "" {
		u.RawQuery = target.GeminiQuery
	}
	out.URL = &u
	out.Host = base.Host
	out.Header = req.Header.Clone()
	out.Header.Del("Authorization")
	out.Header.Del("x-goog-api-key")
	if gemini && target.GoogleKeyHeader {
		out.Header.Set("x-goog-api-key", target.APIKey)
	} else {
		out.Header.Set("Authorization", "Bearer "+target.APIKey)
	}
	out.Body = io.NopCloser(bytes.NewReader(body))
	out.ContentLength = int64(len(body))
	out.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil }
	return out, cancel, nil
}

// attemptContext leaves part of the caller's deadline for the channels after
// this one, so one hanging channel cannot use up the whole budget.
func attemptContext(parent context.Context, attemptsLeft int) (context.Context, context.CancelFunc) {
	deadline, ok := parent.Deadline()
	if !ok {
		return context.WithTimeout(parent, defaultAttemptBudget)
	}
	remaining := time.Until(deadline)
	if attemptsLeft <= 1 || remaining <= 0 {
		return context.WithCancel(parent)
	}
	return context.WithTimeout(parent, remaining*3/(2*time.Duration(attemptsLeft)))
}

func (c *Config) matches(u *url.URL) bool {
	if strings.Contains(c.SourceHost, ":") {
		return strings.EqualFold(u.Host, c.SourceHost)
	}
	return strings.EqualFold(u.Hostname(), c.SourceHost)
}

// bufferClientError reads a 400 body so retryableStatus can look at it and the
// caller still receives it intact.
func bufferClientError(resp *http.Response) (*http.Response, error) {
	if resp.StatusCode != http.StatusBadRequest {
		return resp, nil
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	_ = resp.Body.Close()
	if err != nil {
		return nil, err
	}
	resp.Body = io.NopCloser(bytes.NewReader(data))
	resp.ContentLength = int64(len(data))
	clientErrorBodies.Store(resp, strings.ToLower(string(data)))
	return resp, nil
}

var clientErrorBodies sync.Map // *http.Response -> lower-cased 400 body

// retryableStatus reports responses another channel may serve: auth or model
// availability on this channel, rate limits and server errors. A 400 is a bad
// request everywhere unless it says this channel lacks the model.
func retryableStatus(resp *http.Response) bool {
	switch {
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden,
		resp.StatusCode == http.StatusNotFound, resp.StatusCode == http.StatusRequestTimeout,
		resp.StatusCode == http.StatusTooManyRequests, resp.StatusCode >= 500:
		return true
	case resp.StatusCode == http.StatusBadRequest:
		v, ok := clientErrorBodies.LoadAndDelete(resp)
		return ok && modelUnavailable(v.(string))
	}
	return false
}

func modelUnavailable(body string) bool {
	if !strings.Contains(body, "model") && !strings.Contains(body, "模型") {
		return false
	}
	for _, hint := range []string{"not found", "not exist", "does not exist", "unsupported", "not supported", "no available", "invalid model", "不存在", "不支持", "无可用", "没有可用", "无效"} {
		if strings.Contains(body, hint) {
			return true
		}
	}
	return false
}

type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c *cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel()
	return err
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
