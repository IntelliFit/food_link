package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"os/exec"
	"strings"
	"sync"
	"time"
)

var opencliSearchMu sync.Mutex

func searchGoogleImagesOpenCLI(query string, maxCandidates int) []imageCandidate {
	opencliSearchMu.Lock()
	defer opencliSearchMu.Unlock()

	session := fmt.Sprintf("foodlink-%d", time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	if err := runOpenCLI(ctx, "browser", session, "open", "https://www.google.com"); err != nil {
		return nil
	}
	defer func() { _ = runOpenCLI(context.Background(), "browser", session, "close") }()

	if err := openCLINavigateGoogleImages(ctx, session, query); err != nil {
		return nil
	}
	time.Sleep(7 * time.Second)

	js := fmt.Sprintf(
		`var out=[],skip=/googleg|productlogos|\/ogw\/|fonts\.gstatic|favicon|logo\.svg/i;for(const img of document.querySelectorAll("img")){const s=(img.currentSrc||img.src||"").trim();if(!s.startsWith("https://"))continue;if(skip.test(s))continue;if(!(img.naturalWidth>=80&&img.naturalHeight>=80))continue;if(!s.includes("encrypted-tbn"))continue;out.push(s);if(out.length>=%d)break}JSON.stringify(out)`,
		maxCandidates,
	)
	raw, err := runOpenCLICapture(ctx, "browser", session, "eval", js)
	if err != nil {
		return nil
	}
	payload := extractJSONArrayPayload(raw)
	var urls []string
	if err := json.Unmarshal([]byte(payload), &urls); err != nil {
		return nil
	}
	out := make([]imageCandidate, 0, len(urls))
	for _, u := range urls {
		out = append(out, imageCandidate{ImageURL: u, Query: query})
	}
	return out
}

// openCLINavigateGoogleImages uses in-page navigation so query URLs with & are not split by cmd.exe on Windows.
func openCLINavigateGoogleImages(ctx context.Context, session, query string) error {
	qLit, err := json.Marshal(query)
	if err != nil {
		return err
	}
	navJS := fmt.Sprintf(
		`var u=new URL("https://www.google.com/search");u.searchParams.set("q",%s);u.searchParams.set("tbm","isch");u.searchParams.set("hl","zh-CN");location.href=u.href`,
		string(qLit),
	)
	return runOpenCLI(ctx, "browser", session, "eval", navJS)
}

func runOpenCLI(ctx context.Context, args ...string) error {
	_, err := runOpenCLICapture(ctx, args...)
	return err
}

func runOpenCLICapture(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "opencli", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	out := strings.TrimSpace(stdout.String())
	err := cmd.Run()
	if err != nil {
		// opencli on Windows may exit non-zero after writing valid stdout (e.g. cmd.exe & warnings).
		if out != "" {
			return stdout.String(), nil
		}
		if stderr.Len() > 0 {
			return "", fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
		}
		return "", err
	}
	return stdout.String(), nil
}

func extractJSONArrayPayload(stdout string) string {
	stdout = strings.TrimSpace(stdout)
	if idx := strings.LastIndex(stdout, "["); idx >= 0 {
		if end := strings.LastIndex(stdout, "]"); end > idx {
			return stdout[idx : end+1]
		}
	}
	return stdout
}

func decodeDataURLImage(dataURL string) (*downloadedImage, error) {
	comma := strings.Index(dataURL, ",")
	if comma < 0 {
		return nil, fmt.Errorf("invalid data url")
	}
	meta := dataURL[:comma]
	payload := dataURL[comma+1:]
	contentType := strings.TrimPrefix(meta, "data:")
	if idx := strings.Index(contentType, ";"); idx >= 0 {
		contentType = contentType[:idx]
	}
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, err
	}
	if len(raw) < 4*1024 {
		return nil, fmt.Errorf("invalid image size %d", len(raw))
	}
	if contentType == "image/gif" {
		return nil, fmt.Errorf("unsupported image type %s", contentType)
	}
	if _, _, err := image.Decode(bytes.NewReader(raw)); err != nil {
		return nil, fmt.Errorf("invalid image bytes: %w", err)
	}
	sum := sha256.Sum256(raw)
	return &downloadedImage{
		URL:         dataURL[:min(len(dataURL), 120)] + "...",
		ContentType: contentType,
		Data:        raw,
		Ext:         extensionForContentType(contentType),
		SHA256:      hex.EncodeToString(sum[:]),
	}, nil
}
