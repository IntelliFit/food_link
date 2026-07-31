package main

import (
	"context"
	"encoding/json"
	"fmt"
	stdhtml "html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	xhtml "golang.org/x/net/html"
)

const (
	commonsAPIEndpoint     = "https://commons.wikimedia.org/w/api.php"
	commonsSearchUserAgent = "food-link-standard-food-image-backfill/1.0 (https://healthymax.cn)"
	commonsMaxSearchLimit  = 50
	commonsMaxResponseSize = 8 * 1024 * 1024
)

// commonsImageCandidate is a Commons image whose license metadata is complete
// and permits commercial reuse. Author and credit are plain text; PageURL is
// the Commons File page rather than the binary image URL.
type commonsImageCandidate struct {
	ImageURL    string `json:"image_url"`
	PageURL     string `json:"page_url"`
	Author      string `json:"author"`
	Credit      string `json:"credit"`
	LicenseName string `json:"license_name"`
	LicenseURL  string `json:"license_url"`
}

type commonsSearchClient struct {
	httpClient *http.Client
	endpoint   string
	userAgent  string
}

func newCommonsSearchClient(httpClient *http.Client) *commonsSearchClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 45 * time.Second}
	}
	return &commonsSearchClient{
		httpClient: httpClient,
		endpoint:   commonsAPIEndpoint,
		userAgent:  commonsSearchUserAgent,
	}
}

// searchCommonsImages searches Wikimedia Commons and returns only candidates
// with an explicit CC0, public-domain, CC BY, or CC BY-SA license.
func searchCommonsImages(ctx context.Context, httpClient *http.Client, query string, limit int) ([]commonsImageCandidate, error) {
	return newCommonsSearchClient(httpClient).Search(ctx, query, limit)
}

func (c *commonsSearchClient) Search(ctx context.Context, query string, limit int) ([]commonsImageCandidate, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("commons search query is empty")
	}
	if limit <= 0 {
		return nil, fmt.Errorf("commons search limit must be positive")
	}
	if limit > commonsMaxSearchLimit {
		limit = commonsMaxSearchLimit
	}

	endpoint := strings.TrimSpace(c.endpoint)
	if endpoint == "" {
		endpoint = commonsAPIEndpoint
	}
	requestURL, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse commons api endpoint: %w", err)
	}
	params := requestURL.Query()
	params.Set("action", "query")
	params.Set("format", "json")
	params.Set("formatversion", "2")
	params.Set("generator", "search")
	params.Set("gsrsearch", query)
	params.Set("gsrnamespace", "6") // File
	params.Set("gsrlimit", fmt.Sprintf("%d", limit))
	params.Set("prop", "imageinfo")
	params.Set("iiprop", "url|extmetadata")
	requestURL.RawQuery = params.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build commons api request: %w", err)
	}
	userAgent := strings.TrimSpace(c.userAgent)
	if userAgent == "" {
		userAgent = commonsSearchUserAgent
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")

	httpClient := c.httpClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 45 * time.Second}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request commons api: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, commonsMaxResponseSize+1))
	if err != nil {
		return nil, fmt.Errorf("read commons api response: %w", err)
	}
	if len(body) > commonsMaxResponseSize {
		return nil, fmt.Errorf("commons api response exceeds %d bytes", commonsMaxResponseSize)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("commons api status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload commonsAPIResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode commons api response: %w", err)
	}
	if payload.Error != nil {
		return nil, fmt.Errorf("commons api error %s: %s", strings.TrimSpace(payload.Error.Code), strings.TrimSpace(payload.Error.Info))
	}

	out := make([]commonsImageCandidate, 0, len(payload.Query.Pages))
	seen := make(map[string]struct{}, len(payload.Query.Pages))
	for _, page := range payload.Query.Pages {
		if len(page.ImageInfo) == 0 {
			continue
		}
		info := page.ImageInfo[0]
		imageURL := commonsHTTPURL(info.URL)
		pageURL := commonsHTTPURL(info.DescriptionURL)
		if pageURL == "" {
			pageURL = commonsFilePageURL(page.Title)
		}
		licenseName, licenseURL, ok := parseCommonsLicense(info.ExtMetadata)
		if imageURL == "" || pageURL == "" || !ok {
			continue
		}
		if _, exists := seen[imageURL]; exists {
			continue
		}
		seen[imageURL] = struct{}{}

		author := commonsMetadataPlainText(info.ExtMetadata.text("Artist"))
		credit := commonsMetadataPlainText(info.ExtMetadata.text("Credit"))
		if credit == "" {
			credit = commonsMetadataPlainText(info.ExtMetadata.text("Attribution"))
		}
		out = append(out, commonsImageCandidate{
			ImageURL:    imageURL,
			PageURL:     pageURL,
			Author:      author,
			Credit:      credit,
			LicenseName: licenseName,
			LicenseURL:  licenseURL,
		})
	}
	return out, nil
}

type commonsAPIResponse struct {
	Error *struct {
		Code string `json:"code"`
		Info string `json:"info"`
	} `json:"error"`
	Query struct {
		Pages []commonsAPIPage `json:"pages"`
	} `json:"query"`
}

type commonsAPIPage struct {
	Title     string                `json:"title"`
	ImageInfo []commonsAPIImageInfo `json:"imageinfo"`
}

type commonsAPIImageInfo struct {
	URL            string                `json:"url"`
	DescriptionURL string                `json:"descriptionurl"`
	ExtMetadata    commonsAPIExtMetadata `json:"extmetadata"`
}

type commonsAPIExtMetadata map[string]commonsAPIMetadataValue

type commonsAPIMetadataValue struct {
	Value any `json:"value"`
}

func (m commonsAPIExtMetadata) text(key string) string {
	value, ok := m[key]
	if !ok || value.Value == nil {
		return ""
	}
	switch typed := value.Value.(type) {
	case string:
		return typed
	case bool:
		return fmt.Sprintf("%t", typed)
	case float64:
		return fmt.Sprintf("%v", typed)
	default:
		return ""
	}
}

type commonsLicenseKind string

const (
	commonsLicenseCC0    commonsLicenseKind = "cc0"
	commonsLicensePD     commonsLicenseKind = "public-domain"
	commonsLicenseCCBY   commonsLicenseKind = "cc-by"
	commonsLicenseCCBYSA commonsLicenseKind = "cc-by-sa"
)

func parseCommonsLicense(metadata commonsAPIExtMetadata) (name, licenseURL string, ok bool) {
	name = commonsMetadataPlainText(metadata.text("LicenseShortName"))
	licenseURL = commonsHTTPURL(metadata.text("LicenseUrl"))
	if name == "" || licenseURL == "" {
		return "", "", false
	}

	normalizedName := normalizeCommonsLicenseText(name)
	normalizedURL := normalizeCommonsLicenseText(licenseURL)
	restrictions := normalizeCommonsLicenseText(metadata.text("Restrictions"))
	if commonsLicenseHasForbiddenTerms(normalizedName) ||
		commonsLicenseHasForbiddenTerms(normalizedURL) ||
		commonsLicenseHasForbiddenTerms(restrictions) {
		return "", "", false
	}

	nameKind := classifyCommonsLicenseName(normalizedName)
	if nameKind == "" {
		return "", "", false
	}
	if urlKind := classifyCommonsLicenseURL(licenseURL); urlKind != "" && urlKind != nameKind {
		return "", "", false
	}
	return name, licenseURL, true
}

func classifyCommonsLicenseName(normalized string) commonsLicenseKind {
	switch {
	case strings.Contains(normalized, "cc0") || strings.Contains(normalized, "creative commons zero"):
		return commonsLicenseCC0
	case normalized == "pd" || strings.Contains(normalized, "public domain"):
		return commonsLicensePD
	case strings.HasPrefix(normalized, "cc by sa ") || normalized == "cc by sa" ||
		strings.Contains(normalized, "creative commons attribution share alike") ||
		strings.Contains(normalized, "creative commons attribution sharealike"):
		return commonsLicenseCCBYSA
	case strings.HasPrefix(normalized, "cc by ") || normalized == "cc by" ||
		strings.Contains(normalized, "creative commons attribution "):
		return commonsLicenseCCBY
	default:
		return ""
	}
}

func classifyCommonsLicenseURL(rawURL string) commonsLicenseKind {
	lower := strings.ToLower(rawURL)
	switch {
	case strings.Contains(lower, "/publicdomain/zero/"):
		return commonsLicenseCC0
	case strings.Contains(lower, "/publicdomain/"):
		return commonsLicensePD
	case strings.Contains(lower, "/licenses/by-sa/"):
		return commonsLicenseCCBYSA
	case strings.Contains(lower, "/licenses/by/"):
		return commonsLicenseCCBY
	default:
		return ""
	}
}

func commonsLicenseHasForbiddenTerms(normalized string) bool {
	for _, token := range strings.Fields(normalized) {
		switch token {
		case "nc", "nd", "noncommercial", "non-commercial", "noderivatives", "no-derivatives":
			return true
		}
	}
	return strings.Contains(normalized, "non commercial") ||
		strings.Contains(normalized, "no derivatives") ||
		strings.Contains(normalized, "no derivative")
}

func normalizeCommonsLicenseText(value string) string {
	value = strings.ToLower(commonsMetadataPlainText(value))
	replacer := strings.NewReplacer(
		"-", " ", "_", " ", "/", " ",
		"–", " ", "—", " ", "‑", " ",
	)
	return strings.Join(strings.Fields(replacer.Replace(value)), " ")
}

func commonsMetadataPlainText(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	tokenizer := xhtml.NewTokenizer(strings.NewReader(value))
	var parts []string
	for {
		tokenType := tokenizer.Next()
		switch tokenType {
		case xhtml.ErrorToken:
			if tokenizer.Err() != nil && tokenizer.Err() != io.EOF {
				return strings.Join(strings.Fields(stdhtml.UnescapeString(value)), " ")
			}
			return strings.Join(strings.Fields(stdhtml.UnescapeString(strings.Join(parts, " "))), " ")
		case xhtml.TextToken:
			text := strings.TrimSpace(stdhtml.UnescapeString(string(tokenizer.Text())))
			if text != "" {
				parts = append(parts, text)
			}
		}
	}
}

func commonsHTTPURL(raw string) string {
	raw = strings.TrimSpace(stdhtml.UnescapeString(raw))
	if strings.HasPrefix(raw, "//") {
		raw = "https:" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return parsed.String()
}

func commonsFilePageURL(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}
	title = strings.ReplaceAll(title, " ", "_")
	return "https://commons.wikimedia.org/wiki/" + url.PathEscape(title)
}
