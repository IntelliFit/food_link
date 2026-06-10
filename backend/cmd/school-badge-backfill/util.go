package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"

	"golang.org/x/image/draw"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func extensionForContentType(contentType string) string {
	if exts, err := mime.ExtensionsByType(contentType); err == nil && len(exts) > 0 {
		ext := strings.ToLower(exts[0])
		switch ext {
		case ".jpe", ".jfif":
			return ".jpg"
		}
		return ext
	}
	switch contentType {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}

func buildObjectKey(prefix, schoolID, hash, ext string) string {
	prefix = strings.Trim(strings.TrimSpace(prefix), "/")
	if len(hash) > 16 {
		hash = hash[:16]
	}
	if ext == "" {
		ext = ".png"
	}
	return fmt.Sprintf("%s/%s/%s%s", prefix, schoolID, hash, ext)
}

func cleanHTMLURL(value string) string {
	value = html.UnescapeString(value)
	value = strings.ReplaceAll(value, `\/`, `/`)
	if decoded, err := url.QueryUnescape(value); err == nil {
		return decoded
	}
	return value
}

func quoteIdent(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func appendJSONL(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = file.Write(append(data, '\n'))
	return err
}

func loadState(path string) stateFile {
	state := stateFile{Entries: map[string]stateEntry{}}
	data, err := os.ReadFile(path)
	if err == nil {
		_ = json.Unmarshal(data, &state)
	}
	if state.Entries == nil {
		state.Entries = map[string]stateEntry{}
	}
	return state
}

func saveState(path string, state stateFile) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func updateState(state stateFile, result resultRow) {
	entry := state.Entries[result.SchoolID]
	entry.Status = result.Status
	entry.Reason = result.Reason
	entry.ObjectKey = result.ObjectKey
	entry.AccessURL = result.AccessURL
	entry.UpdatedAt = time.Now()
	entry.Attempts++
	if result.Candidate != "" {
		entry.TriedURLs = appendUnique(entry.TriedURLs, result.Candidate)
	}
	state.Entries[result.SchoolID] = entry
}

func appendUnique(list []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return list
	}
	for _, existing := range list {
		if existing == value {
			return list
		}
	}
	return append(list, value)
}

func shouldSkip(schoolID string, state stateFile) bool {
	entry, ok := state.Entries[schoolID]
	if !ok {
		return false
	}
	switch entry.Status {
	case "db_updated", "dry_run_match":
		return true
	case "search_failed", "download_failed", "vision_failed", "no_match", "upload_failed", "db_update_failed":
		return false
	default:
		return false
	}
}

func isFailureStatus(status string) bool {
	switch status {
	case "search_failed", "download_failed", "vision_failed", "no_match", "upload_failed", "db_update_failed":
		return true
	default:
		return false
	}
}

func downloadImage(ctx context.Context, imageURL, pageURL string) (*downloadedImage, error) {
	if strings.HasPrefix(imageURL, "data:image/") {
		return nil, fmt.Errorf("data URL not supported")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", bingSearchUserAgent())
	req.Header.Set("Referer", pageURL)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("download status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024+1))
	if err != nil {
		return nil, err
	}
	if len(data) < 1024 || len(data) > 8*1024*1024 {
		return nil, fmt.Errorf("invalid image size %d", len(data))
	}
	contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if idx := strings.Index(contentType, ";"); idx >= 0 {
		contentType = contentType[:idx]
	}
	detected := http.DetectContentType(data)
	if !strings.HasPrefix(contentType, "image/") {
		contentType = detected
	}
	if !strings.HasPrefix(contentType, "image/") {
		return nil, fmt.Errorf("not image content type %s", contentType)
	}
	if contentType == "image/gif" {
		return nil, fmt.Errorf("unsupported image type %s", contentType)
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return nil, fmt.Errorf("invalid image bytes: %w", err)
	}
	sum := sha256.Sum256(data)
	ext := extensionForContentType(contentType)
	return &downloadedImage{
		URL:         imageURL,
		PageURL:     pageURL,
		Data:        data,
		ContentType: contentType,
		Ext:         ext,
		SHA256:      hex.EncodeToString(sum[:]),
	}, nil
}

func imageAspectRatio(data []byte) (width, height int, ratio float64, err error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return 0, 0, 0, err
	}
	bounds := img.Bounds()
	w := bounds.Dx()
	h := bounds.Dy()
	if h == 0 {
		return w, h, 0, fmt.Errorf("zero height")
	}
	ratio = float64(w) / float64(h)
	return w, h, ratio, nil
}

func isKnownBlankImageURL(imageURL string) bool {
	lower := strings.ToLower(imageURL)
	if strings.Contains(lower, "chinaschool.com.cn/images/l_about/d_logo.png") {
		return true
	}
	if strings.Contains(lower, "chinaschool.com.cn") && strings.Contains(lower, "d_logo") {
		return true
	}
	return false
}

func isBlankImage(data []byte) bool {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return false
	}
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w == 0 || h == 0 {
		return true
	}
	const grid = 8
	whiteCount := 0
	total := 0
	for gy := 0; gy < grid; gy++ {
		y := bounds.Min.Y + (h*gy)/grid
		for gx := 0; gx < grid; gx++ {
			x := bounds.Min.X + (w*gx)/grid
			total++
			r, g, b, _ := img.At(x, y).RGBA()
			if r > 60000 && g > 60000 && b > 60000 {
				whiteCount++
			}
		}
	}
	return total > 0 && float64(whiteCount)/float64(total) > 0.95
}

func loadBackendEnv(configDir string) {
	if os.Getenv("CONFIG_SOURCE") == "" {
		_ = os.Setenv("CONFIG_SOURCE", "apollo")
	}
}

func browserUserAgent() string {
	return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
}

// processBadgeImage 将下载的校徽图片统一处理后处理：
// 1. 居中裁剪为正方形
// 2. 缩放到 256×256
// 3. 统一输出为 PNG 格式（白色背景填充透明区域）
func processBadgeImage(data []byte) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode image: %w", err)
	}

	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()

	// 居中裁剪为正方形
	size := w
	if h < w {
		size = h
	}
	x0 := bounds.Min.X + (w-size)/2
	y0 := bounds.Min.Y + (h-size)/2
	cropRect := image.Rect(x0, y0, x0+size, y0+size)

	square := image.NewRGBA(image.Rect(0, 0, size, size))
	draw.Draw(square, square.Bounds(), img, cropRect.Min, draw.Src)

	// 缩放到 256×256
	const targetSize = 256
	final := image.NewRGBA(image.Rect(0, 0, targetSize, targetSize))

	// 白色背景（处理透明通道）
	for i := range final.Pix {
		final.Pix[i] = 0xff
	}

	draw.BiLinear.Scale(final, final.Bounds(), square, square.Bounds(), draw.Over, nil)

	var buf bytes.Buffer
	if err := png.Encode(&buf, final); err != nil {
		return nil, fmt.Errorf("encode png: %w", err)
	}
	return buf.Bytes(), nil
}
