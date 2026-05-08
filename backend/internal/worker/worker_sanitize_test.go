package worker

import (
	"errors"
	"strings"
	"testing"
)

func TestSanitizeTaskErrorMessage_HTML(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(`ofoxai api error 405: <html><head><title>Ofox AI</title></head><body>home</body></html>`))
	if strings.Contains(msg, "<html") {
		t.Fatalf("html leaked into sanitized error: %s", msg)
	}
	if !strings.Contains(msg, "AI 服务返回了网页") {
		t.Fatalf("unexpected sanitized error: %s", msg)
	}
}

func TestSanitizeTaskErrorMessage_TruncatesLongText(t *testing.T) {
	msg := sanitizeTaskErrorMessage(errors.New(strings.Repeat("x", 400)))
	if len([]rune(msg)) > 303 {
		t.Fatalf("expected truncated message, got %d runes", len([]rune(msg)))
	}
}
