package foodmedia

import (
	"context"
	"strings"

	"food_link/backend/pkg/storage"

	"gorm.io/gorm"
)

// ManualSourceLabel 手动记录来源对应展示标签。
func ManualSourceLabel(source string) string {
	switch strings.TrimSpace(source) {
	case "public_library":
		return "真实餐食"
	case "packaged_food":
		return "包装食品"
	case "nutrition_library":
		return "常用食物"
	default:
		return ""
	}
}

// EnrichFoodRecordDisplayFields 为圈子/首页展示补全记录级与条目级图片、来源标签。
func EnrichFoodRecordDisplayFields(
	ctx context.Context,
	db *gorm.DB,
	storageClient *storage.Client,
	imagePath **string,
	imagePaths *[]string,
	items []map[string]any,
) []map[string]any {
	if len(items) == 0 && imagePath == nil && imagePaths == nil {
		return items
	}
	out := make([]map[string]any, 0, len(items))
	recordPaths := make([]string, 0)
	seenRecord := map[string]bool{}
	appendRecordPath := func(raw string) {
		raw = resolveFoodImageURL(storageClient, strings.TrimSpace(raw))
		if raw == "" || seenRecord[raw] {
			return
		}
		seenRecord[raw] = true
		recordPaths = append(recordPaths, raw)
	}

	if imagePaths != nil {
		for _, p := range *imagePaths {
			appendRecordPath(p)
		}
	}
	if imagePath != nil && *imagePath != nil {
		appendRecordPath(*(*imagePath))
	}

	for _, raw := range items {
		item := cloneItemMap(raw)
		source := strings.TrimSpace(stringFromAny(item["manual_source"]))
		if source != "" {
			if label := ManualSourceLabel(source); label != "" {
				item["source_label"] = label
			}
		}
		itemPaths := collectItemImagePaths(item)
		if len(itemPaths) == 0 && db != nil && source != "" {
			itemPaths = LookupManualSourceImagePaths(ctx, db, []map[string]any{item})
		}
		resolved := resolveFoodImageURLs(storageClient, itemPaths)
		if len(resolved) > 0 {
			item["image_path"] = resolved[0]
			item["image_paths"] = resolved
			for _, p := range resolved {
				appendRecordPath(p)
			}
		}
		out = append(out, item)
	}

	if len(recordPaths) == 0 && db != nil && len(out) > 0 {
		for _, p := range resolveFoodImageURLs(storageClient, LookupManualSourceImagePaths(ctx, db, out)) {
			appendRecordPath(p)
		}
	}
	if len(recordPaths) == 0 {
		return out
	}
	if imagePaths != nil {
		*imagePaths = append([]string(nil), recordPaths...)
	}
	if imagePath != nil {
		first := recordPaths[0]
		imagePathCopy := first
		*imagePath = &imagePathCopy
	}
	return out
}

func cloneItemMap(raw map[string]any) map[string]any {
	if raw == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(raw))
	for k, v := range raw {
		out[k] = v
	}
	return out
}

func collectItemImagePaths(item map[string]any) []string {
	out := make([]string, 0, 4)
	seen := map[string]bool{}
	appendOne := func(raw string) {
		raw = strings.TrimSpace(raw)
		if raw == "" || seen[raw] {
			return
		}
		seen[raw] = true
		out = append(out, raw)
	}
	switch paths := item["image_paths"].(type) {
	case []string:
		for _, p := range paths {
			appendOne(p)
		}
	case []any:
		for _, v := range paths {
			appendOne(stringFromAny(v))
		}
	}
	appendOne(stringFromAny(item["image_path"]))
	return out
}

func resolveFoodImageURLs(storageClient *storage.Client, paths []string) []string {
	if len(paths) == 0 {
		return nil
	}
	out := make([]string, 0, len(paths))
	seen := map[string]bool{}
	for _, p := range paths {
		resolved := resolveFoodImageURL(storageClient, p)
		if resolved == "" || seen[resolved] {
			continue
		}
		seen[resolved] = true
		out = append(out, resolved)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func resolveFoodImageURL(storageClient *storage.Client, value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if storageClient == nil {
		return value
	}
	resolved := storageClient.ResolveReferenceURL("food-images", value)
	if resolved == "" {
		return value
	}
	return resolved
}
