package foodmedia

import (
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

// LookupManualSourceImagePaths 从饮食记录 items 中的 manual_source 回查食物库图片（记录级 image_path 为空时使用）。
func LookupManualSourceImagePaths(ctx context.Context, db *gorm.DB, items []map[string]any) []string {
	if db == nil || len(items) == 0 {
		return nil
	}
	publicIDs := make([]string, 0)
	packagedIDs := make([]string, 0)
	nutritionIDs := make([]string, 0)
	nutritionTitles := make([]string, 0)
	seenID := map[string]bool{}
	seenTitle := map[string]bool{}
	for _, item := range items {
		source := strings.TrimSpace(stringFromAny(item["manual_source"]))
		id := strings.TrimSpace(stringFromAny(item["manual_source_id"]))
		if source == "" || id == "" {
			continue
		}
		key := source + ":" + id
		if seenID[key] {
			continue
		}
		seenID[key] = true
		switch source {
		case "public_library":
			publicIDs = append(publicIDs, id)
		case "packaged_food":
			packagedIDs = append(packagedIDs, id)
		case "nutrition_library":
			if strings.HasPrefix(id, "catalog:") {
				title := strings.TrimSpace(strings.TrimPrefix(id, "catalog:"))
				if title != "" && !seenTitle[title] {
					seenTitle[title] = true
					nutritionTitles = append(nutritionTitles, title)
				}
			} else {
				nutritionIDs = append(nutritionIDs, id)
			}
		}
	}
	paths := make([]string, 0)
	seenPath := map[string]bool{}
	appendPath := func(raw string) {
		raw = strings.TrimSpace(raw)
		if raw == "" || seenPath[raw] {
			return
		}
		seenPath[raw] = true
		paths = append(paths, raw)
	}
	if len(publicIDs) > 0 {
		var rows []struct {
			ImagePath  *string  `gorm:"column:image_path"`
			ImagePaths []string `gorm:"column:image_paths;serializer:json"`
		}
		if err := db.WithContext(ctx).
			Table("public_food_library").
			Select("image_path, image_paths").
			Where("id IN ?", publicIDs).
			Scan(&rows).Error; err == nil {
			for _, row := range rows {
				if row.ImagePath != nil {
					appendPath(*row.ImagePath)
				}
				for _, imagePath := range row.ImagePaths {
					appendPath(imagePath)
				}
			}
		}
	}
	appendNutritionImageRows := func(rows []struct {
		ImagePath  *string
		ImagePaths []string `gorm:"column:image_paths;serializer:json"`
	}) {
		for _, row := range rows {
			if row.ImagePath != nil {
				appendPath(*row.ImagePath)
			}
			for _, imagePath := range row.ImagePaths {
				appendPath(imagePath)
			}
		}
	}
	if len(nutritionIDs) > 0 {
		var rows []struct {
			ImagePath  *string
			ImagePaths []string `gorm:"column:image_paths;serializer:json"`
		}
		if err := db.WithContext(ctx).
			Table("food_nutrition_library").
			Select("image_path, image_paths").
			Where("id IN ? AND is_active = TRUE AND quality_tier IN ?", nutritionIDs, []string{"authoritative", "reviewed_estimate", "legacy_curated"}).
			Scan(&rows).Error; err == nil {
			appendNutritionImageRows(rows)
		}
	}
	if len(nutritionTitles) > 0 {
		lowerTitles := make([]string, 0, len(nutritionTitles))
		for _, title := range nutritionTitles {
			lowerTitles = append(lowerTitles, strings.ToLower(title))
		}
		var rows []struct {
			ImagePath  *string
			ImagePaths []string `gorm:"column:image_paths;serializer:json"`
		}
		if err := db.WithContext(ctx).
			Table("food_nutrition_library").
			Select("image_path, image_paths").
			Where("is_active = TRUE AND quality_tier IN ? AND (canonical_name IN ? OR LOWER(canonical_name) IN ?)", []string{"authoritative", "reviewed_estimate", "legacy_curated"}, nutritionTitles, lowerTitles).
			Scan(&rows).Error; err == nil {
			appendNutritionImageRows(rows)
		}
		if err := db.WithContext(ctx).Raw(`
			SELECT f.image_path, f.image_paths
			FROM food_nutrition_aliases a
			INNER JOIN food_nutrition_library f ON f.id = a.food_id
			WHERE f.is_active = TRUE
			  AND f.quality_tier IN ('authoritative','reviewed_estimate','legacy_curated')
			  AND a.match_status = 'approved_exact'
			  AND (a.alias_name IN ? OR LOWER(a.alias_name) IN ?)
		`, nutritionTitles, lowerTitles).Scan(&rows).Error; err == nil {
			appendNutritionImageRows(rows)
		}
	}
	if len(packagedIDs) > 0 {
		var rows []struct {
			SourceImageURLs []string `gorm:"column:source_image_urls;serializer:json"`
		}
		if err := db.WithContext(ctx).
			Table("packaged_food_library").
			Select("source_image_urls").
			Where("id IN ?", packagedIDs).
			Scan(&rows).Error; err == nil {
			for _, row := range rows {
				for _, imageURL := range row.SourceImageURLs {
					appendPath(imageURL)
				}
			}
		}
	}
	return paths
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	default:
		if value == nil {
			return ""
		}
		return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(fmt.Sprint(value), "<nil>", ""), " ", ""))
	}
}
