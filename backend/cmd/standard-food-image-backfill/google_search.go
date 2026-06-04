package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
)

func searchGoogleImages(query string, maxCandidates int) []imageCandidate {
	if key := strings.TrimSpace(os.Getenv("GOOGLE_CSE_API_KEY")); key != "" {
		if cx := strings.TrimSpace(os.Getenv("GOOGLE_CSE_CX")); cx != "" {
			if out := searchGoogleImagesCSE(query, maxCandidates, key, cx); len(out) > 0 {
				return out
			}
		}
	}
	if out := searchGoogleImagesOpenCLI(query, maxCandidates); len(out) > 0 {
		return out
	}
	return searchGoogleImagesHTML(query, maxCandidates)
}

func searchGoogleImagesCSE(query string, maxCandidates int, apiKey, cx string) []imageCandidate {
	endpoint := "https://www.googleapis.com/customsearch/v1?" + url.Values{
		"key":        {apiKey},
		"cx":         {cx},
		"q":          {query},
		"searchType": {"image"},
		"num":        {fmt.Sprintf("%d", min(maxCandidates, 10))},
		"safe":       {"active"},
	}.Encode()
	req, _ := http.NewRequest(http.MethodGet, endpoint, nil)
	req.Header.Set("User-Agent", browserUserAgent())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if resp.StatusCode >= 400 {
		return nil
	}
	var parsed struct {
		Items []struct {
			Link  string `json:"link"`
			Image struct {
				ThumbnailLink string `json:"thumbnailLink"`
			} `json:"image"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil
	}
	out := []imageCandidate{}
	for _, item := range parsed.Items {
		raw := strings.TrimSpace(item.Link)
		if raw == "" {
			raw = strings.TrimSpace(item.Image.ThumbnailLink)
		}
		if raw == "" {
			continue
		}
		out = append(out, imageCandidate{ImageURL: raw, Query: query})
		if len(out) >= maxCandidates {
			break
		}
	}
	return out
}

func searchGoogleImagesHTML(query string, maxCandidates int) []imageCandidate {
	bases := []string{
		"https://www.google.com.hk/search?q=" + url.QueryEscape(query) + "&tbm=isch&hl=zh-CN&gl=hk",
		"https://www.google.com/search?q=" + url.QueryEscape(query) + "&tbm=isch&hl=en&gl=us",
	}
	for _, searchURL := range bases {
		out := scrapeGoogleImageHTML(searchURL, query, maxCandidates)
		if len(out) > 0 {
			return out
		}
	}
	return nil
}

func scrapeGoogleImageHTML(searchURL, query string, maxCandidates int) []imageCandidate {
	req, _ := http.NewRequest(http.MethodGet, searchURL, nil)
	req.Header.Set("User-Agent", browserUserAgent())
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	req.Header.Set("Referer", "https://www.google.com/")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil {
		return nil
	}
	text := string(body)
	if len(text) < 20000 || strings.Contains(text, "enablejs") {
		return nil
	}
	out := []imageCandidate{}
	seen := map[string]bool{}
	add := func(rawImage string) {
		rawImage = cleanHTMLURL(rawImage)
		rawImage = strings.ReplaceAll(rawImage, `\u003d`, "=")
		rawImage = strings.ReplaceAll(rawImage, `\u0026`, "&")
		if !strings.HasPrefix(rawImage, "http://") && !strings.HasPrefix(rawImage, "https://") {
			return
		}
		if strings.Contains(rawImage, "gstatic.com/images?q=tbn") {
			return
		}
		if seen[rawImage] {
			return
		}
		seen[rawImage] = true
		out = append(out, imageCandidate{ImageURL: rawImage, Query: query})
	}
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`"ou":"(https?://[^"\\]+)"`),
		regexp.MustCompile(`\\"ou\\":\\"(https?://[^\\"]+)\\"`),
		regexp.MustCompile(`imgurl=(https?%3A%2F%2F[^&"\\]+)`),
		regexp.MustCompile(`imgurl=(https?://[^&"\\]+)`),
		regexp.MustCompile(`\["(https?://[^"\\]+\.(?:jpg|jpeg|png|webp)[^"\\]*)",\d+,\d+\]`),
		regexp.MustCompile(`(https?://[^"\\]+\.(?:jpg|jpeg|png|webp)(?:\?[^"\\]*)?)`),
	}
	for _, pattern := range patterns {
		for _, match := range pattern.FindAllStringSubmatch(text, -1) {
			if len(match) < 2 {
				continue
			}
			add(match[1])
			if len(out) >= maxCandidates {
				return out
			}
		}
	}
	return out
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
