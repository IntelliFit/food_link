package llmrelay

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func maxTokensOf(t *testing.T, body string) float64 {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(body), &m); err != nil {
		t.Fatalf("body is not JSON: %q", body)
	}
	v, _ := m["max_tokens"].(float64)
	return v
}

func TestWithThinkingHeadroom(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want float64 // 0 = body must be returned unchanged
	}{
		{"qwen with cap", `{"model":"qwen3.8-flash","max_tokens":320,"temperature":0.25}`, 1820},
		{"qwen case and spaces", `{"model":" Qwen3.8-Plus ","max_tokens":900}`, 2400},
		{"qwen without cap", `{"model":"qwen3.8-flash"}`, 0},
		{"other model", `{"model":"deepseek-v4-flash","max_tokens":900}`, 0},
		{"older qwen", `{"model":"qwen3.6-flash","max_tokens":900}`, 0},
		{"not json", `not json`, 0},
		{"empty", ``, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := string(withThinkingHeadroom([]byte(tc.in)))
			if tc.want == 0 {
				if got != tc.in {
					t.Fatalf("body changed: %q -> %q", tc.in, got)
				}
				return
			}
			if v := maxTokensOf(t, got); v != tc.want {
				t.Fatalf("max_tokens = %v, want %v (body %q)", v, tc.want, got)
			}
		})
	}
}

func TestWithThinkingHeadroomKeepsOtherFieldsExact(t *testing.T) {
	in := `{"model":"qwen3.8-flash","max_tokens":320,"temperature":0.25,"messages":[{"role":"user","content":"跑步30分钟"}]}`
	got := string(withThinkingHeadroom([]byte(in)))
	for _, part := range []string{`"temperature":0.25`, `"content":"跑步30分钟"`, `"max_tokens":1820`} {
		if !strings.Contains(got, part) {
			t.Fatalf("missing %s in %q", part, got)
		}
	}
}

func TestRelayAddsThinkingHeadroomOnlyOffWanjie(t *testing.T) {
	wanjie, openlux, a6 := newUpstream(t, 200, "wanjie"), newUpstream(t, 503, "busy"), newUpstream(t, 503, "busy")
	c := setup(t, wanjie, openlux, a6)

	status, _ := post(t, c, context.Background(), wanjie.srv.URL+"/api/v1/chat/completions", `{"model":"qwen3.8-flash","max_tokens":320}`)
	if status != 200 {
		t.Fatalf("status %d", status)
	}
	lastBody := func(u *upstream) string {
		parts := strings.SplitN(u.last(), "|", 5)
		return parts[len(parts)-1]
	}
	if v := maxTokensOf(t, lastBody(openlux)); v != 1820 {
		t.Fatalf("OpenLux max_tokens = %v, want 1820", v)
	}
	if v := maxTokensOf(t, lastBody(a6)); v != 1820 {
		t.Fatalf("A6 max_tokens = %v, want 1820", v)
	}
	if got := lastBody(wanjie); got != `{"model":"qwen3.8-flash","max_tokens":320}` {
		t.Fatalf("Wanjie must get the original body, saw %q", got)
	}
}
