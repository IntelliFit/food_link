package storage

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"food_link/backend/pkg/config"

	"github.com/tencentyun/cos-go-sdk-v5"
)

type Client struct {
	cfg config.StorageConfig
}

func New(cfg config.StorageConfig) *Client {
	return &Client{cfg: cfg}
}

func (c *Client) NormalizeURL(bucketAlias, raw string) string {
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	return c.BuildAccessURL(bucketAlias, raw)
}

func (c *Client) NormalizeURLs(bucketAlias string, raws []string) []string {
	if len(raws) == 0 {
		return nil
	}
	out := make([]string, 0, len(raws))
	for _, raw := range raws {
		if raw == "" {
			continue
		}
		out = append(out, c.NormalizeURL(bucketAlias, raw))
	}
	return out
}

func (c *Client) BuildAccessURL(bucketAlias, key string) string {
	key = strings.TrimLeft(key, "/")
	var base string
	switch bucketAlias {
	case "food-images":
		base = c.cfg.CDNFoodImagesBaseURL
	case "user-avatars":
		base = c.cfg.CDNUserAvatarsBaseURL
	case "health-reports":
		base = c.cfg.CDNHealthReportsBaseURL
	case "icon":
		base = c.cfg.CDNIconBaseURL
	default:
		base = ""
	}
	base = strings.TrimRight(base, "/")
	if base == "" {
		return key
	}
	return fmt.Sprintf("%s/%s", base, key)
}

func (c *Client) ResolveObjectKey(bucketAlias, value string) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		return strings.TrimLeft(raw, "/")
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	path := strings.TrimSpace(parsed.EscapedPath())
	if decoded, decodeErr := url.PathUnescape(path); decodeErr == nil {
		path = decoded
	}
	path = strings.TrimSpace(path)
	netloc := strings.ToLower(strings.TrimSpace(parsed.Host))
	bucketName := c.bucketName(bucketAlias)
	trustedHosts := c.trustedBucketHosts(bucketAlias)

	baseURL := c.bucketBaseURL(bucketAlias)
	if baseURL != "" && strings.HasPrefix(raw, baseURL+"/") {
		return strings.TrimLeft(strings.SplitN(strings.TrimPrefix(raw, baseURL+"/"), "?", 2)[0], "/")
	}

	if _, ok := trustedHosts[netloc]; ok && strings.HasPrefix(path, "/"+bucketAlias+"/") {
		return strings.TrimLeft(strings.TrimPrefix(path, "/"+bucketAlias+"/"), "/")
	}
	if bucketName != "" {
		if _, ok := trustedHosts[netloc]; ok && strings.HasPrefix(path, "/"+bucketName+"/") {
			return strings.TrimLeft(strings.TrimPrefix(path, "/"+bucketName+"/"), "/")
		}
		if strings.Contains(netloc, bucketName+".cos.") {
			return strings.TrimLeft(path, "/")
		}
	}
	publicPrefix := "/storage/v1/object/public/"
	if strings.HasPrefix(path, publicPrefix+bucketAlias+"/") {
		return strings.TrimLeft(strings.TrimPrefix(path, publicPrefix+bucketAlias+"/"), "/")
	}
	if bucketName != "" && strings.HasPrefix(path, publicPrefix+bucketName+"/") {
		return strings.TrimLeft(strings.TrimPrefix(path, publicPrefix+bucketName+"/"), "/")
	}
	if _, ok := trustedHosts[netloc]; ok {
		return strings.TrimLeft(strings.SplitN(path, "?", 2)[0], "/")
	}

	return ""
}

func (c *Client) ResolveReferenceURL(bucketAlias, value string) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		return c.BuildAccessURL(bucketAlias, raw)
	}
	if key := c.ResolveObjectKey(bucketAlias, raw); key != "" {
		return c.BuildAccessURL(bucketAlias, key)
	}
	if c.isPrivateBucket(bucketAlias) {
		return ""
	}
	return raw
}

func (c *Client) ResolveReferenceURLs(bucketAlias string, values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		resolved := c.ResolveReferenceURL(bucketAlias, value)
		if resolved == "" {
			continue
		}
		if _, ok := seen[resolved]; ok {
			continue
		}
		seen[resolved] = struct{}{}
		out = append(out, resolved)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (c *Client) bucketBaseURL(bucketAlias string) string {
	var base string
	switch bucketAlias {
	case "food-images":
		base = c.cfg.CDNFoodImagesBaseURL
	case "user-avatars":
		base = c.cfg.CDNUserAvatarsBaseURL
	case "health-reports":
		base = c.cfg.CDNHealthReportsBaseURL
	case "icon":
		base = c.cfg.CDNIconBaseURL
	}
	return strings.TrimRight(strings.TrimSpace(base), "/")
}

func (c *Client) trustedBucketHosts(bucketAlias string) map[string]struct{} {
	hosts := map[string]struct{}{}
	if base := c.bucketBaseURL(bucketAlias); base != "" {
		if parsed, err := url.Parse(base); err == nil && parsed.Host != "" {
			hosts[strings.ToLower(strings.TrimSpace(parsed.Host))] = struct{}{}
		}
	}
	if origin := c.cosOriginBaseURL(bucketAlias); origin != "" {
		if parsed, err := url.Parse(origin); err == nil && parsed.Host != "" {
			hosts[strings.ToLower(strings.TrimSpace(parsed.Host))] = struct{}{}
		}
	}
	return hosts
}

func (c *Client) cosOriginBaseURL(bucketAlias string) string {
	bucket := c.bucketName(bucketAlias)
	if bucket == "" {
		return ""
	}
	region := strings.TrimSpace(c.cfg.COSRegion)
	if region == "" {
		region = "ap-beijing"
	}
	return fmt.Sprintf("https://%s.cos.%s.myqcloud.com", bucket, region)
}

func (c *Client) isPrivateBucket(bucketAlias string) bool {
	return bucketAlias == "health-reports"
}

func (c *Client) cosClient(bucket string) (*cos.Client, error) {
	if c.cfg.COSSecretID == "" || c.cfg.COSSecretKey == "" {
		return nil, fmt.Errorf("missing COS credentials")
	}
	region := c.cfg.COSRegion
	if region == "" {
		region = "ap-beijing"
	}
	baseURL, err := url.Parse(fmt.Sprintf("https://%s.cos.%s.myqcloud.com", bucket, region))
	if err != nil {
		return nil, err
	}
	return cos.NewClient(&cos.BaseURL{BucketURL: baseURL}, &http.Client{
		Transport: &cos.AuthorizationTransport{
			SecretID:  c.cfg.COSSecretID,
			SecretKey: c.cfg.COSSecretKey,
		},
	}), nil
}

func (c *Client) bucketName(alias string) string {
	switch alias {
	case "food-images":
		return c.cfg.COSFoodImagesBucket
	case "user-avatars":
		return c.cfg.COSUserAvatarsBucket
	case "health-reports":
		return c.cfg.COSHealthReportsBucket
	case "icon":
		return c.cfg.COSIconBucket
	default:
		return ""
	}
}

func (c *Client) UploadBytes(bucketAlias, key string, data []byte, contentType string) (string, error) {
	bucket := c.bucketName(bucketAlias)
	if bucket == "" {
		return "", fmt.Errorf("unknown bucket alias: %s", bucketAlias)
	}
	client, err := c.cosClient(bucket)
	if err != nil {
		return "", err
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, err = client.Object.Put(context.Background(), key, bytes.NewReader(data), &cos.ObjectPutOptions{
		ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{
			ContentType: contentType,
		},
	})
	if err != nil {
		return "", err
	}
	return c.BuildAccessURL(bucketAlias, key), nil
}

func (c *Client) DownloadBytes(bucketAlias, value string) ([]byte, error) {
	key := c.ResolveObjectKey(bucketAlias, value)
	if key == "" {
		key = strings.TrimLeft(strings.TrimSpace(value), "/")
	}
	if key == "" {
		return nil, fmt.Errorf("empty object key for bucket %s", bucketAlias)
	}
	bucket := c.bucketName(bucketAlias)
	if bucket == "" {
		return nil, fmt.Errorf("unknown bucket alias: %s", bucketAlias)
	}
	client, err := c.cosClient(bucket)
	if err != nil {
		return nil, err
	}
	resp, err := client.Object.Get(context.Background(), key, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

func (c *Client) PresignGETURL(bucketAlias, value string, expire time.Duration) (string, error) {
	key := c.ResolveObjectKey(bucketAlias, value)
	if key == "" {
		key = strings.TrimLeft(strings.TrimSpace(value), "/")
	}
	if key == "" {
		return "", fmt.Errorf("empty object key for bucket %s", bucketAlias)
	}
	bucket := c.bucketName(bucketAlias)
	if bucket == "" {
		return "", fmt.Errorf("unknown bucket alias: %s", bucketAlias)
	}
	if expire <= 0 {
		expire = 30 * time.Minute
	}
	client, err := c.cosClient(bucket)
	if err != nil {
		return "", err
	}
	presigned, err := client.Object.GetPresignedURL(
		context.Background(),
		http.MethodGet,
		key,
		c.cfg.COSSecretID,
		c.cfg.COSSecretKey,
		expire,
		nil,
	)
	if err != nil {
		return "", err
	}
	return presigned.String(), nil
}

func (c *Client) UploadBase64(bucketAlias, key, base64Image, contentType string) (string, error) {
	raw := base64Image
	if idx := strings.Index(raw, ","); idx != -1 {
		raw = raw[idx+1:]
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return "", fmt.Errorf("base64 decode failed: %w", err)
	}
	return c.UploadBytes(bucketAlias, key, data, contentType)
}
