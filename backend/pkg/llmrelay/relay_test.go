package llmrelay

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type upstream struct {
	srv    *httptest.Server
	calls  atomic.Int32
	status int
	body   string
	delay  time.Duration
	seen   atomic.Value // last request: path|auth|google|query|body
}

func newUpstream(t *testing.T, status int, body string) *upstream {
	t.Helper()
	u := &upstream{status: status, body: body}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u.calls.Add(1)
		b, _ := io.ReadAll(r.Body)
		u.seen.Store(strings.Join([]string{r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("x-goog-api-key"), r.URL.RawQuery, string(b)}, "|"))
		if u.delay > 0 {
			select {
			case <-time.After(u.delay):
			case <-r.Context().Done():
				return
			}
		}
		w.WriteHeader(u.status)
		_, _ = w.Write([]byte(u.body))
	}))
	t.Cleanup(u.srv.Close)
	return u
}

func (u *upstream) last() string {
	v, _ := u.seen.Load().(string)
	return v
}

func setup(t *testing.T, wanjie, openlux, a6 *upstream) *http.Client {
	t.Helper()
	host := func(u *upstream) string { p, _ := url.Parse(u.srv.URL); return p.Host }
	Configure(Config{Enabled: true, SourceHost: host(wanjie), Targets: []Target{
		{Name: "openlux", BaseURL: openlux.srv.URL + "/v1", APIKey: "lux-key", GeminiQuery: "sort=success_rate"},
		{Name: "a6", BaseURL: a6.srv.URL, APIKey: "a6-key", GoogleKeyHeader: true},
	}})
	t.Cleanup(func() { Configure(Config{}) })
	return &http.Client{Transport: Wrap(http.DefaultTransport)}
}

func post(t *testing.T, c *http.Client, ctx context.Context, rawURL, body string) (int, string) {
	t.Helper()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer wanjie-key")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b)
}

func TestRelaySendsWanjieChatToOpenLuxFirst(t *testing.T) {
	wanjie, openlux, a6 := newUpstream(t, 200, "wanjie"), newUpstream(t, 200, "openlux"), newUpstream(t, 200, "a6")
	c := setup(t, wanjie, openlux, a6)

	status, body := post(t, c, context.Background(), wanjie.srv.URL+"/api/v1/chat/completions", `{"model":"qwen3.8-flash"}`)
	if status != 200 || body != "openlux" {
		t.Fatalf("got %d %q, want OpenLux answer", status, body)
	}
	if got := openlux.last(); got != `/v1/chat/completions|Bearer lux-key|||{"model":"qwen3.8-flash"}` {
		t.Fatalf("OpenLux saw %q", got)
	}
	if wanjie.calls.Load() != 0 || a6.calls.Load() != 0 {
		t.Fatalf("Wanjie %d and A6 %d must not be called", wanjie.calls.Load(), a6.calls.Load())
	}
}

func TestRelayFallsThroughToA6ThenWanjie(t *testing.T) {
	wanjie, openlux, a6 := newUpstream(t, 200, "wanjie"), newUpstream(t, 503, "busy"), newUpstream(t, 429, "limited")
	c := setup(t, wanjie, openlux, a6)

	status, body := post(t, c, context.Background(), wanjie.srv.URL+"/api/v1/chat/completions", `{"x":1}`)
	if status != 200 || body != "wanjie" {
		t.Fatalf("got %d %q, want Wanjie as last resort", status, body)
	}
	if !strings.Contains(wanjie.last(), "Bearer wanjie-key") {
		t.Fatalf("Wanjie must get its own key, saw %q", wanjie.last())
	}
	if openlux.calls.Load() != 1 || a6.calls.Load() != 1 {
		t.Fatalf("each relay channel is tried once, got openlux=%d a6=%d", openlux.calls.Load(), a6.calls.Load())
	}
}

func TestRelayUsesA6GoogleKeyForGeminiNative(t *testing.T) {
	wanjie, openlux, a6 := newUpstream(t, 200, "wanjie"), newUpstream(t, 500, "down"), newUpstream(t, 200, "a6")
	c := setup(t, wanjie, openlux, a6)

	_, body := post(t, c, context.Background(), wanjie.srv.URL+"/api/v1beta/models/gemini-3.5-flash:generateContent", "{}")
	if body != "a6" {
		t.Fatalf("got %q, want A6", body)
	}
	if !strings.HasPrefix(openlux.last(), "/v1beta/models/gemini-3.5-flash:generateContent|Bearer lux-key||sort=success_rate|") {
		t.Fatalf("OpenLux saw %q", openlux.last())
	}
	if !strings.HasPrefix(a6.last(), "/v1beta/models/gemini-3.5-flash:generateContent||a6-key||") {
		t.Fatalf("A6 saw %q", a6.last())
	}
}

func TestRelayKeepsBadRequestButSkipsMissingModel(t *testing.T) {
	wanjie, openlux, a6 := newUpstream(t, 200, "wanjie"), newUpstream(t, 400, `{"error":"prompt too long"}`), newUpstream(t, 200, "a6")
	c := setup(t, wanjie, openlux, a6)
	status, body := post(t, c, context.Background(), wanjie.srv.URL+"/api/v1/chat/completions", "{}")
	if status != 400 || !strings.Contains(body, "prompt too long") || a6.calls.Load() != 0 {
		t.Fatalf("a bad request must come back unchanged, got %d %q a6=%d", status, body, a6.calls.Load())
	}

	openlux.body = `{"error":{"message":"model qwen3.6-flash does not exist"}}`
	status, body = post(t, c, context.Background(), wanjie.srv.URL+"/api/v1/chat/completions", "{}")
	if status != 200 || body != "a6" {
		t.Fatalf("a missing model must move on, got %d %q", status, body)
	}
}

func withMinAttemptBudget(t *testing.T, d time.Duration) {
	t.Helper()
	old := minAttemptBudget
	minAttemptBudget = d
	t.Cleanup(func() { minAttemptBudget = old })
}

func TestRelayLeavesTimeForLaterChannels(t *testing.T) {
	wanjie, openlux, a6 := newUpstream(t, 200, "wanjie"), newUpstream(t, 200, "late"), newUpstream(t, 200, "a6")
	openlux.delay = 2 * time.Second
	c := setup(t, wanjie, openlux, a6)
	withMinAttemptBudget(t, 0)
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()

	_, body := post(t, c, ctx, wanjie.srv.URL+"/api/v1/chat/completions", "{}")
	if body != "a6" {
		t.Fatalf("got %q, want A6 after OpenLux used its share of the deadline", body)
	}
}

func TestRelayPassesOtherHostsAndDirectRequestsThrough(t *testing.T) {
	wanjie, openlux, a6 := newUpstream(t, 200, "wanjie"), newUpstream(t, 200, "openlux"), newUpstream(t, 200, "a6")
	c := setup(t, wanjie, openlux, a6)

	if _, body := post(t, c, WithDirect(context.Background()), wanjie.srv.URL+"/api/v1/chat/completions", "{}"); body != "wanjie" {
		t.Fatalf("direct request got %q", body)
	}
	if _, body := post(t, c, context.Background(), a6.srv.URL+"/v1/chat/completions", "{}"); body != "a6" {
		t.Fatalf("other host got %q", body)
	}
	if openlux.calls.Load() != 0 {
		t.Fatal("OpenLux must not see direct or unrelated requests")
	}
	Configure(Config{Enabled: false, Targets: []Target{{Name: "openlux", BaseURL: openlux.srv.URL, APIKey: "k"}}})
	if _, body := post(t, c, context.Background(), wanjie.srv.URL+"/api/v1/chat/completions", "{}"); body != "wanjie" {
		t.Fatalf("disabled relay got %q", body)
	}
}

func TestRelayGivesShortBudgetToOneChannel(t *testing.T) {
	wanjie, openlux, a6 := newUpstream(t, 200, "wanjie"), newUpstream(t, 200, "openlux"), newUpstream(t, 200, "a6")
	openlux.delay = time.Second
	c := setup(t, wanjie, openlux, a6)
	// The budget is below the minimum attempt, like the 8s meal judge in
	// production: splitting it would time out every channel.
	withMinAttemptBudget(t, 5*time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()

	_, body := post(t, c, ctx, wanjie.srv.URL+"/api/v1/chat/completions", "{}")
	if body != "openlux" || a6.calls.Load() != 0 {
		t.Fatalf("got %q a6=%d, want OpenLux to keep the whole short budget", body, a6.calls.Load())
	}
}

func TestRelayAttemptBudget(t *testing.T) {
	withMinAttemptBudget(t, 15*time.Second)
	for _, tc := range []struct {
		budget       time.Duration
		attemptsLeft int
		want         time.Duration // 0 = whole remaining budget
	}{
		{8 * time.Second, 3, 0},
		{25 * time.Second, 3, 15 * time.Second},
		{45 * time.Second, 3, 22500 * time.Millisecond},
		{90 * time.Second, 2, 67500 * time.Millisecond},
		{30 * time.Second, 1, 0},
	} {
		parent, cancel := context.WithTimeout(context.Background(), tc.budget)
		ctx, done := attemptContext(parent, tc.attemptsLeft)
		pd, _ := parent.Deadline()
		d, _ := ctx.Deadline()
		got := time.Duration(0)
		if !d.Equal(pd) {
			got = tc.budget - pd.Sub(d)
		}
		if diff := got - tc.want; diff < -50*time.Millisecond || diff > 50*time.Millisecond {
			t.Errorf("budget %v, %d left: attempt %v, want %v", tc.budget, tc.attemptsLeft, got, tc.want)
		}
		done()
		cancel()
	}
}
