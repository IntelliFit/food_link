package storage

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"food_link/backend/pkg/config"

	"github.com/tencentyun/cos-go-sdk-v5"
)

type Client struct {
	cfg config.StorageConfig
}

func New(cfg config.StorageConfig) *Client {
	return &Client{cfg: cfg}
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
	_, err = client.Object.Put(nil, key, bytes.NewReader(data), &cos.ObjectPutOptions{
		ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{
			ContentType: contentType,
		},
	})
	if err != nil {
		return "", err
	}
	return c.BuildAccessURL(bucketAlias, key), nil
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
