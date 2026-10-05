package service

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/storage"
)

var errInvalidImageReference = &commonerrors.AppError{
	Code: 10002, Message: "图片地址无效，请重新选择图片后重试", HTTPStatus: 400,
}

// ExtractContent extracts every human-readable string in a publish payload, including
// nested food items. Resource IDs and fixed protocol fields are not user content.
func ExtractContent(doc map[string]any, store *storage.Client) ([]string, []string, error) {
	// Normalize pointers and typed slices exactly as CheckValue does.
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, nil, commonerrors.ErrBadRequest
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, nil, commonerrors.ErrBadRequest
	}
	var texts, images []string
	var walk func(string, any)
	walk = func(key string, value any) {
		key = strings.ToLower(key)
		if key == ApprovalKey || key == WaitingKey {
			return
		}
		switch v := value.(type) {
		case map[string]any:
			keys := make([]string, 0, len(v))
			for k := range v {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				walk(k, v[k])
			}
		case []any:
			for _, entry := range v {
				walk(key, entry)
			}
		case []string:
			for _, entry := range v {
				walk(key, entry)
			}
		case string:
			v = strings.TrimSpace(v)
			if v == "" {
				return
			}
			if key == "avatar" || key == "cover_image" || key == "images" ||
				strings.HasSuffix(key, "image_url") || strings.HasSuffix(key, "image_urls") ||
				strings.HasSuffix(key, "image_path") || strings.HasSuffix(key, "image_paths") {
				alias := "food-images"
				if key == "avatar" || key == "cover_image" {
					alias = "user-avatars"
				}
				if store == nil {
					images = append(images, "")
					return
				}
				// Registration sends the system avatar from food-images. It is a
				// fixed application asset, not a user upload in user-avatars.
				if key == "avatar" && store.IsSystemDefaultUserAvatar(v) {
					return
				}
				objectKey := store.ResolveObjectKey(alias, v)
				if objectKey == "" || strings.Contains(objectKey, "..") {
					images = append(images, "")
					return
				}
				// Audit the canonical object URL that the backend will later render.
				images = append(images, store.BuildAccessURL(alias, objectKey))
			} else {
				if key == "id" || strings.HasSuffix(key, "_id") ||
					key == "date" || key == "record_time" || key == "created_at" || key == "telephone" ||
					key == "content_type" || key == "meal_type" || key == "entry_type" || key == "source" {
					return
				}
				texts = append(texts, v)
			}
		}
	}
	walk("", doc)
	for _, u := range images {
		if !strings.HasPrefix(u, "https://") {
			return nil, nil, errInvalidImageReference
		}
	}
	return unique(texts), unique(images), nil
}

func (s *Service) CheckDocument(ctx context.Context, userID string, scene int, doc map[string]any, store *storage.Client) error {
	texts, images, err := ExtractContent(doc, store)
	if err != nil {
		return err
	}
	// Receipts come exclusively from an owned, completed server-side task. Clients
	// cannot supply an approval. Changed text/images still receive a fresh check.
	if s.approvalReader != nil {
		if taskID, _ := doc["source_task_id"].(string); taskID != "" {
			approval, err := s.approvalReader(ctx, userID, taskID)
			if err != nil {
				return ErrUnavailable
			}
			if s.trustedApproval(userID, taskID, approval) {
				texts = subtractApproved(texts, approval["texts"])
				images = subtractApproved(images, approval["images"])
			}
		}
	}
	if len(texts) == 0 && len(images) == 0 {
		return nil
	}
	openID, err := s.Identity(ctx, userID)
	if err != nil {
		return err
	}
	if err := s.CheckText(ctx, openID, scene, strings.Join(texts, "\n")); err != nil {
		return err
	}
	return s.CheckImages(ctx, openID, scene, unique(images))
}

func (s *Service) CheckUpdate(ctx context.Context, userID string, scene int, current any, updates map[string]any, store *storage.Client) error {
	raw, err := json.Marshal(current)
	if err != nil {
		return ErrUnavailable
	}
	var doc map[string]any
	if json.Unmarshal(raw, &doc) != nil {
		return ErrUnavailable
	}
	raw, err = json.Marshal(updates)
	if err != nil {
		return ErrUnavailable
	}
	var values map[string]any
	if json.Unmarshal(raw, &values) != nil {
		return ErrUnavailable
	}
	for key, value := range values {
		doc[key] = value
	}
	return s.CheckDocument(ctx, userID, scene, doc, store)
}

func (s *Service) CheckValue(ctx context.Context, userID string, scene int, value any, store *storage.Client) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return ErrUnavailable
	}
	var doc map[string]any
	if json.Unmarshal(raw, &doc) != nil {
		return ErrUnavailable
	}
	return s.CheckDocument(ctx, userID, scene, doc, store)
}

func unique(values []string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(values))
	for _, v := range values {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
