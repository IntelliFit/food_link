package handler

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"food_link/backend/internal/modelcompare/service"
	"food_link/backend/pkg/logger"
)

//go:embed web/*
var web embed.FS

type Handler struct {
	svc   *service.Service
	host  string
	token string
	run   sync.Mutex
}

func New(svc *service.Service, host string) (*Handler, error) {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return nil, err
	}
	return &Handler{svc: svc, host: host, token: hex.EncodeToString(token[:])}, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	// Exact Host + Origin + a session token prevent DNS rebinding and cross-site
	// drive-by requests to this localhost-only, billable diagnostic.
	if r.Host != h.host || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "http://"+h.host) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		http.Error(w, "只允许本机同源访问", http.StatusForbidden)
		return
	}
	if r.URL.Path == "/api/config" && r.Method == http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"providers": h.svc.Providers, "token": h.token, "max_bytes": service.MaxImageBytes})
		return
	}
	if r.URL.Path == "/api/compare" && r.Method == http.MethodPost {
		h.compare(w, r)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "不支持此方法", http.StatusMethodNotAllowed)
		return
	}
	name, contentType := "", ""
	switch r.URL.Path {
	case "/":
		name, contentType = "index.html", "text/html; charset=utf-8"
	case "/app.js":
		name, contentType = "app.js", "text/javascript; charset=utf-8"
	case "/style.css":
		name, contentType = "style.css", "text/css; charset=utf-8"
	default:
		http.NotFound(w, r)
		return
	}
	data, err := web.ReadFile("web/" + name)
	if err != nil {
		http.Error(w, "页面资源不可用", 500)
		return
	}
	w.Header().Set("Content-Type", contentType)
	_, _ = w.Write(data)
}

func (h *Handler) compare(w http.ResponseWriter, r *http.Request) {
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Compare-Token")), []byte(h.token)) != 1 {
		http.Error(w, "请重新打开页面", 403)
		return
	}
	if !h.run.TryLock() {
		http.Error(w, "已有一组对比请求，请稍后再试", 409)
		return
	}
	defer h.run.Unlock()
	r.Body = http.MaxBytesReader(w, r.Body, service.MaxImageBytes+(128<<10))
	if err := r.ParseMultipartForm(service.MaxImageBytes + (128 << 10)); err != nil {
		http.Error(w, "图片超过8MiB或上传格式不正确", 400)
		return
	}
	defer r.MultipartForm.RemoveAll()
	files := r.MultipartForm.File["image"]
	if len(files) > 1 {
		http.Error(w, "每次最多选择一张图片", 400)
		return
	}
	var photo service.Photo
	if len(files) == 1 {
		file, err := files[0].Open()
		if err != nil {
			http.Error(w, "无法读取图片", 400)
			return
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, service.MaxImageBytes+1))
		if err != nil {
			http.Error(w, "图片读取失败", 400)
			return
		}
		photo, err = service.ReadPhoto(files[0].Filename, data)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
	}
	// Validate emptiness without rewriting the user's actual question.
	prompt := r.FormValue("prompt")
	if strings.TrimSpace(prompt) == "" && len(photo.Data) == 0 {
		http.Error(w, "请填写问题或选择一张图片", 400)
		return
	}
	if len(prompt) > 32<<10 {
		http.Error(w, "提示词超过32KiB", 400)
		return
	}
	protocol := r.FormValue("protocol")
	if protocol == "" {
		protocol = "native"
	}
	if protocol != "native" && protocol != "compat" {
		http.Error(w, "协议参数无效", 400)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "当前服务不支持独立结果推送", 500)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	enc := json.NewEncoder(w)
	originalPath := r.FormValue("original_path")
	if len(originalPath) > 4096 {
		originalPath = "[路径备注超过4096字节，已省略]"
	}
	photoInfo := map[string]any{"type": "start", "photo": photo, "providers": h.svc.Providers, "protocol": protocol, "prompt": h.svc.Redact(prompt), "timeout_seconds": 90, "started_at": time.Now().Format(time.RFC3339), "original_path_note": h.svc.Redact(originalPath)}
	if enc.Encode(photoInfo) != nil {
		return
	}
	flusher.Flush()
	logger.Info(r.Context(), "模型对比请求进入", slog.Int("image_bytes", photo.Bytes), slog.String("protocol", protocol), slog.Int("providers", len(h.svc.Providers)))
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	results := make(chan service.Result, len(h.svc.Providers))
	go func() {
		h.svc.Compare(ctx, photo, prompt, protocol, 90*time.Second, func(result service.Result) { results <- result })
		close(results)
	}()
	writeFailed := false
	for result := range results {
		if writeFailed {
			continue
		}
		if enc.Encode(map[string]any{"type": "result", "result": result}) != nil {
			cancel()
			writeFailed = true
			continue
		}
		flusher.Flush()
	}
	if writeFailed {
		return
	}
	_ = enc.Encode(map[string]any{"type": "done"})
	flusher.Flush()
	logger.Info(r.Context(), "模型对比请求完成", slog.Int("providers", len(h.svc.Providers)))
}
