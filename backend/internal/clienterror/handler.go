// Package clienterror records crashes reported by the mini program in the server
// log. A release can break every phone while the backend stays healthy, and a
// page error caught by Taro never reaches WeChat's own error log.
package clienterror

import (
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"
	"github.com/gin-gonic/gin"
)

const (
	maxBodyBytes     = 8 * 1024
	maxMessageRunes  = 2000
	maxRouteRunes    = 200
	reportsPerMinute = 20
)

var (
	versionPattern = regexp.MustCompile(`^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$`)
	errTooMany     = &commonerrors.AppError{Code: 10029, Message: "上报过于频繁", HTTPStatus: http.StatusTooManyRequests}
)

type report struct {
	Kind       string `json:"kind"`
	Message    string `json:"message"`
	Route      string `json:"route"`
	AppVersion string `json:"app_version"`
	PageBlank  bool   `json:"page_blank"`
}

func (r report) valid() bool {
	return (r.Kind == "error" || r.Kind == "rejection") && strings.TrimSpace(r.Message) != "" && versionPattern.MatchString(r.AppVersion)
}

// clip cuts by characters so a truncated log line stays valid UTF-8.
func clip(text string, limit int) string {
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	return string([]rune(text)[:limit])
}

// limiter is per process: it only protects the log from one noisy client.
type limiter struct {
	mu     sync.Mutex
	minute int64
	counts map[string]int
}

func newLimiter() *limiter { return &limiter{counts: map[string]int{}} }

func (l *limiter) allow(client string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if minute := now.Unix() / 60; minute != l.minute {
		l.minute, l.counts = minute, map[string]int{}
	}
	if l.counts[client] >= reportsPerMinute {
		return false
	}
	l.counts[client]++
	return true
}

type Handler struct{ limiter *limiter }

func NewHandler() *Handler { return &Handler{limiter: newLimiter()} }

// Submit is public on purpose: a crash can happen before login. It stores nothing
// and does not read the caller's identity.
func (h *Handler) Submit(c *gin.Context) {
	if !h.limiter.allow(c.ClientIP(), time.Now()) {
		response.Error(c, errTooMany)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	var in report
	if err := c.ShouldBindJSON(&in); err != nil || !in.valid() {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	logger.Warn(c.Request.Context(), "小程序前端错误",
		slog.String("client.kind", in.Kind),
		slog.String("client.app_version", in.AppVersion),
		slog.String("client.route", clip(in.Route, maxRouteRunes)),
		slog.Bool("client.page_blank", in.PageBlank),
		slog.String("client.message", clip(in.Message, maxMessageRunes)),
	)
	response.Success(c, gin.H{"received": true})
}
