package storage

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"github.com/tencentyun/cos-go-sdk-v5"
	"net/url"
	"path"
	"strings"
)

type AccountObjectRef struct {
	Bucket, Value string
	Shared        bool
}

func (c *Client) DeleteAccountReferences(ctx context.Context, id string, refs []AccountObjectRef) error {
	for _, ref := range refs {
		if ref.Shared {
			continue
		}
		if strings.Contains(ref.Value, "://") {
			parsed, err := url.Parse(ref.Value)
			if err != nil {
				continue
			}
			if _, trusted := c.trustedBucketHosts(ref.Bucket)[strings.ToLower(parsed.Host)]; !trusted {
				continue
			}
		}
		key := c.ResolveObjectKey(ref.Bucket, ref.Value)
		if key == "" || strings.Contains(key, "/") {
			continue
		}
		if _, err := uuid.Parse(strings.TrimSuffix(key, path.Ext(key))); err != nil {
			continue
		}
		client, err := c.cosClient(c.bucketName(ref.Bucket))
		if err != nil {
			return err
		}
		if _, err := client.Object.Delete(ctx, key); err != nil {
			return err
		}
	}
	return nil
}

// Enumerate only the account-owned namespace, including orphaned uploads.
func (c *Client) DeleteAccountObjects(ctx context.Context, userID string) error {
	if _, err := uuid.Parse(userID); err != nil {
		return fmt.Errorf("invalid account object prefix")
	}
	for _, alias := range []string{"food-images", "user-avatars", "health-reports"} {
		bucket := c.bucketName(alias)
		if bucket == "" {
			return fmt.Errorf("account cleanup storage bucket is not configured: %s", alias)
		}
		client, err := c.cosClient(bucket)
		if err != nil {
			return err
		}
		prefixes := []string{userID + "/"}
		if alias == "food-images" {
			prefixes = append(prefixes, "analysis-video-frames/"+userID+"/", "user-feedback/"+userID+"/")
		}
		for _, prefix := range prefixes {
			marker := ""
			for {
				list, _, err := client.Bucket.Get(ctx, &cos.BucketGetOptions{Prefix: prefix, Marker: marker, MaxKeys: 100})
				if err != nil {
					return err
				}
				for _, obj := range list.Contents {
					if !strings.HasPrefix(obj.Key, prefix) {
						return fmt.Errorf("object outside account namespace")
					}
					if _, err := client.Object.Delete(ctx, obj.Key); err != nil {
						return err
					}
				}
				if !list.IsTruncated {
					break
				}
				if list.NextMarker == "" || list.NextMarker == marker {
					return fmt.Errorf("account cleanup object pagination did not advance")
				}
				marker = list.NextMarker
			}
		}
	}
	return nil
}
