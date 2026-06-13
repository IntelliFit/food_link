package feishu

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGenSign(t *testing.T) {
	sign, err := genSign("secret-demo", 1599360473)
	if err != nil {
		t.Fatalf("genSign: %v", err)
	}
	if sign == "" {
		t.Fatal("expected non-empty sign")
	}
}

func TestWebhookClientDisabled(t *testing.T) {
	client := NewWebhookClient("", "")
	if client.Enabled() {
		t.Fatal("expected disabled client")
	}
	if err := client.SendText(context.Background(), "noop"); err != nil {
		t.Fatalf("disabled client should no-op: %v", err)
	}
}

func TestWebhookClientSendTextWithSign(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if err := json.Unmarshal(body, &got); err != nil {
			t.Fatalf("unmarshal body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"StatusCode":0,"StatusMessage":"success"}`))
	}))
	defer server.Close()

	client := NewWebhookClient(server.URL, "test-secret")
	if err := client.SendText(context.Background(), "意见反馈测试"); err != nil {
		t.Fatalf("SendText: %v", err)
	}
	if got["msg_type"] != "text" {
		t.Fatalf("unexpected msg_type: %v", got["msg_type"])
	}
	if got["sign"] == "" || got["timestamp"] == "" {
		t.Fatalf("expected sign and timestamp, got=%v", got)
	}
}

func TestWebhookClientSendInteractiveCard(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if err := json.Unmarshal(body, &got); err != nil {
			t.Fatalf("unmarshal body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":0,"msg":"success"}`))
	}))
	defer server.Close()

	client := NewWebhookClient(server.URL, "")
	if err := client.SendInteractiveCard(context.Background(), map[string]any{
		"header": map[string]any{
			"title": map[string]string{"tag": "plain_text", "content": "意见反馈"},
		},
	}); err != nil {
		t.Fatalf("SendInteractiveCard: %v", err)
	}
	if got["msg_type"] != "interactive" {
		t.Fatalf("unexpected msg_type: %v", got["msg_type"])
	}
	if _, ok := got["card"].(map[string]any); !ok {
		t.Fatalf("expected card object, got=%v", got["card"])
	}
}

func TestWebhookClientReportsFeishuCodeError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":19002,"msg":"params error"}`))
	}))
	defer server.Close()

	client := NewWebhookClient(server.URL, "")
	if err := client.SendText(context.Background(), "bad"); err == nil {
		t.Fatal("expected Feishu code error")
	}
}
