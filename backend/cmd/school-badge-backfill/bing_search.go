package main

import (
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	bingImageSearchBase = "https://cn.bing.com/images/search"
	bingTilesPerPage    = 35
	bingMaxSearchPages  = 4
)

var (
	bingHTTPClient   *http.Client
	bingIuscAnchorRE = regexp.MustCompile(`(?is)<a\s[^>]*class="iusc"[^>]*>`)
)

type bingSearchTile struct {
	ImageURL string
	PageURL  string
}

func bingClient() *http.Client {
	if bingHTTPClient != nil {
		return bingHTTPClient
	}
	jar, _ := cookiejar.New(nil)
	bingHTTPClient = &http.Client{
		Jar:     jar,
		Timeout: 45 * time.Second,
	}
	return bingHTTPClient
}

func bingSearchUserAgent() string {
	return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.105 Safari/537.36"
}

func searchBingImages(query string, maxCandidates int, startPage int) []imageCandidate {
	if maxCandidates <= 0 {
		maxCandidates = 12
	}
	if startPage < 0 {
		startPage = 0
	}
	seen := map[string]bool{}
	out := make([]imageCandidate, 0, maxCandidates)

	for page := startPage; page < startPage+bingMaxSearchPages && len(out) < maxCandidates; page++ {
		first := 1 + page*bingTilesPerPage
		pageHTML, err := fetchBingSearchHTML(query, first)
		if err != nil {
			break
		}
		tiles := parseBingIuscFromSearchHTML(pageHTML)
		if len(tiles) == 0 {
			break
		}
		for _, tile := range tiles {
			imgURL := strings.TrimSpace(tile.ImageURL)
			if imgURL == "" || seen[imgURL] {
				continue
			}
			seen[imgURL] = true
			out = append(out, imageCandidate{
				ImageURL: imgURL,
				PageURL:  strings.TrimSpace(tile.PageURL),
				Query:    query,
			})
			if len(out) >= maxCandidates {
				return out
			}
		}
	}
	return out
}

func fetchBingSearchHTML(query string, first int) (string, error) {
	bingWarmupCookies()
	searchURL := bingImageSearchBase + "?" + url.Values{
		"q":     {query},
		"first": {fmt.Sprintf("%d", first)},
	}.Encode()
	return bingGET(searchURL)
}

func bingGET(searchURL string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, searchURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", bingSearchUserAgent())
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	resp, err := bingClient().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("bing status %d", resp.StatusCode)
	}
	return string(body), nil
}

func bingWarmupCookies() {
	req, err := http.NewRequest(http.MethodGet, "https://cn.bing.com/images", nil)
	if err != nil {
		return
	}
	req.Header.Set("User-Agent", bingSearchUserAgent())
	resp, err := bingClient().Do(req)
	if err != nil {
		return
	}
	io.Copy(io.Discard, io.LimitReader(resp.Body, 256*1024))
	resp.Body.Close()
}

func parseBingIuscFromSearchHTML(pageHTML string) []bingSearchTile {
	tags := bingIuscAnchorRE.FindAllString(pageHTML, -1)
	out := make([]bingSearchTile, 0, len(tags))
	for _, tag := range tags {
		href := htmlAttrValue(tag, "href")
		mediaURL := bingMediaURLFromHref(href)
		if mediaURL == "" {
			continue
		}
		tile := bingSearchTile{ImageURL: mediaURL}
		if mRaw := htmlAttrValue(tag, "m"); mRaw != "" {
			tile.PageURL = bingPurlFromMAttr(mRaw)
		}
		out = append(out, tile)
	}
	return out
}

func htmlAttrValue(tag, name string) string {
	needle := strings.ToLower(name) + `="`
	tagLower := strings.ToLower(tag)
	i := strings.Index(tagLower, needle)
	if i < 0 {
		return ""
	}
	start := i + len(needle)
	end := strings.Index(tag[start:], `"`)
	if end < 0 {
		return ""
	}
	return html.UnescapeString(tag[start : start+end])
}

func bingMediaURLFromHref(href string) string {
	href = strings.TrimSpace(html.UnescapeString(href))
	if href == "" {
		return ""
	}
	if strings.HasPrefix(href, "/") {
		href = "https://cn.bing.com" + href
	}
	if u, err := url.Parse(href); err == nil {
		if m := strings.TrimSpace(u.Query().Get("mediaurl")); m != "" {
			return cleanHTMLURL(m)
		}
	}
	parts := strings.Split(href, "&")
	if len(parts) > 4 && strings.HasPrefix(parts[4], "mediaurl=") {
		return cleanHTMLURL(parts[4][len("mediaurl="):])
	}
	return ""
}

func bingPurlFromMAttr(mRaw string) string {
	decoded := html.UnescapeString(mRaw)
	var meta struct {
		Purl string `json:"purl"`
	}
	if err := json.Unmarshal([]byte(decoded), &meta); err != nil {
		decoded = html.UnescapeString(decoded)
		if err := json.Unmarshal([]byte(decoded), &meta); err != nil {
			return ""
		}
	}
	return strings.TrimSpace(meta.Purl)
}
