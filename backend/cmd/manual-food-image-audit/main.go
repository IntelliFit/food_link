package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/gorm"
)

type sourceCoverage struct {
	Source                       string `json:"source"`
	Total                        int64  `json:"total"`
	WithImage                    int64  `json:"with_image"`
	EmptyImage                   int64  `json:"empty_image"`
	BrowseEligibleTotal          int64  `json:"browse_eligible_total,omitempty"`
	BrowseEligibleWithImage      int64  `json:"browse_eligible_with_image,omitempty"`
	BrowseEligibleEmptyImage     int64  `json:"browse_eligible_empty_image,omitempty"`
	UniqueReferencedItems        int64  `json:"unique_referenced_items,omitempty"`
	EmptyImageOrNoImageField     int64  `json:"empty_image_or_no_image_field,omitempty"`
	WithImageRate                string `json:"with_image_rate,omitempty"`
	EmptyImageRate               string `json:"empty_image_rate,omitempty"`
	EmptyImageOrNoImageFieldRate string `json:"empty_image_or_no_image_field_rate,omitempty"`
	Note                         string `json:"note,omitempty"`
}

type auditOutput struct {
	ImageCapableSources                  sourceCoverage   `json:"image_capable_sources"`
	AllManualFoodSourcesIncludingNoImage sourceCoverage   `json:"all_manual_food_sources_including_no_image_sources"`
	SourceBreakdown                      []sourceCoverage `json:"source_breakdown"`
	UniqueRecentManualReferences         []sourceCoverage `json:"unique_recent_manual_references"`
	EmptyPackagedFoods                   []packagedFood   `json:"empty_packaged_foods,omitempty"`
	Note                                 string           `json:"note"`
}

type packagedFood struct {
	ID              string  `json:"id"`
	DisplayName     string  `json:"display_name"`
	Brand           string  `json:"brand"`
	ProductName     string  `json:"product_name"`
	SpecText        *string `json:"spec_text,omitempty"`
	FlavorText      *string `json:"flavor_text,omitempty"`
	Barcode         *string `json:"barcode,omitempty"`
	PackageCategory *string `json:"package_category,omitempty"`
	KcalPer100g     float64 `json:"kcal_per_100g"`
	UpdatedAt       string  `json:"updated_at"`
}

const publicLibrarySQL = `
WITH scoped AS (
	SELECT
		id,
		status,
		COALESCE(total_calories, 0) AS total_calories,
		NULLIF(trim(COALESCE(image_path, '')), '') AS clean_image_path,
		EXISTS (
			SELECT 1
			FROM jsonb_array_elements_text(COALESCE(image_paths, '[]'::jsonb)) AS image_url
			WHERE NULLIF(trim(image_url), '') IS NOT NULL
		) AS has_image_paths
	FROM public_food_library
	WHERE status = 'published'
)
SELECT
	'public_library' AS source,
	COUNT(*)::bigint AS total,
	COUNT(*) FILTER (WHERE clean_image_path IS NOT NULL OR has_image_paths)::bigint AS with_image,
	COUNT(*) FILTER (WHERE clean_image_path IS NULL AND NOT has_image_paths)::bigint AS empty_image,
	COUNT(*) FILTER (WHERE total_calories > 0 AND total_calories <= 900)::bigint AS browse_eligible_total,
	COUNT(*) FILTER (
		WHERE total_calories > 0
		  AND total_calories <= 900
		  AND (clean_image_path IS NOT NULL OR has_image_paths)
	)::bigint AS browse_eligible_with_image,
	COUNT(*) FILTER (
		WHERE total_calories > 0
		  AND total_calories <= 900
		  AND clean_image_path IS NULL
		  AND NOT has_image_paths
	)::bigint AS browse_eligible_empty_image
FROM scoped;
`

const packagedFoodSQL = `
WITH scoped AS (
	SELECT
		id,
		COALESCE(kcal_per_100g, 0) AS kcal_per_100g,
		EXISTS (
			SELECT 1
			FROM jsonb_array_elements_text(COALESCE(source_image_urls, '[]'::jsonb)) AS image_url
			WHERE NULLIF(trim(image_url), '') IS NOT NULL
		) AS has_image
	FROM packaged_food_library
	WHERE is_active = TRUE
	  AND COALESCE(kcal_per_100g, 0) > 0
)
SELECT
	'packaged_food' AS source,
	COUNT(*)::bigint AS total,
	COUNT(*) FILTER (WHERE has_image)::bigint AS with_image,
	COUNT(*) FILTER (WHERE NOT has_image)::bigint AS empty_image
FROM scoped;
`

const nutritionLibrarySQL = `
WITH scoped AS (
	SELECT
		id,
		NULLIF(trim(COALESCE(image_path, '')), '') AS clean_image_path,
		EXISTS (
			SELECT 1
			FROM jsonb_array_elements_text(COALESCE(image_paths, '[]'::jsonb)) AS image_url
			WHERE NULLIF(trim(image_url), '') IS NOT NULL
		) AS has_image_paths
	FROM food_nutrition_library
	WHERE is_active = TRUE
	  AND COALESCE(kcal_per_100g, 0) > 0
)
SELECT
	'nutrition_library' AS source,
	COUNT(*)::bigint AS total,
	COUNT(*) FILTER (WHERE clean_image_path IS NOT NULL OR has_image_paths)::bigint AS with_image,
	COUNT(*) FILTER (WHERE clean_image_path IS NULL AND NOT has_image_paths)::bigint AS empty_image
FROM scoped;
`

const frequentCatalogSQL = `
WITH record_items AS (
	SELECT
		trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', ''))) AS name,
		item
	FROM user_food_records
	CROSS JOIN LATERAL jsonb_array_elements(items) item
	WHERE trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', ''))) <> ''
	  AND COALESCE(item->'nutrients'->>'calories', item->>'calories') ~ '^[0-9]+([.][0-9]+){0,1}$'
),
catalog AS (
	SELECT name
	FROM record_items
	GROUP BY name
	HAVING COUNT(*) >= 3
)
SELECT
	'frequent_record_catalog' AS source,
	COUNT(*)::bigint AS total,
	0::bigint AS with_image,
	COUNT(*)::bigint AS empty_image,
	'derived from user_food_records; manual_food_repo does not attach images' AS note
FROM catalog;
`

const recentReferenceSQL = `
WITH refs AS (
	SELECT DISTINCT
		item->>'manual_source' AS source,
		item->>'manual_source_id' AS source_id
	FROM user_food_records
	CROSS JOIN LATERAL jsonb_array_elements(items) AS item
	WHERE item->>'manual_source' IN ('public_library', 'packaged_food', 'nutrition_library')
	  AND COALESCE(item->>'manual_source_id', '') <> ''
),
resolved AS (
	SELECT
		refs.source,
		refs.source_id,
		CASE
			WHEN refs.source = 'public_library' THEN EXISTS (
				SELECT 1
				FROM public_food_library p
				WHERE p.id::text = refs.source_id
				  AND (
					  NULLIF(trim(COALESCE(p.image_path, '')), '') IS NOT NULL
					  OR EXISTS (
						  SELECT 1
						  FROM jsonb_array_elements_text(COALESCE(p.image_paths, '[]'::jsonb)) AS image_url
						  WHERE NULLIF(trim(image_url), '') IS NOT NULL
					  )
				  )
			)
			WHEN refs.source = 'packaged_food' THEN EXISTS (
				SELECT 1
				FROM packaged_food_library f
				WHERE f.id::text = refs.source_id
				  AND EXISTS (
					  SELECT 1
					  FROM jsonb_array_elements_text(COALESCE(f.source_image_urls, '[]'::jsonb)) AS image_url
					  WHERE NULLIF(trim(image_url), '') IS NOT NULL
				  )
			)
			WHEN refs.source = 'nutrition_library' THEN EXISTS (
				SELECT 1
				FROM food_nutrition_library n
				WHERE n.id::text = refs.source_id
				  AND (
					  NULLIF(trim(COALESCE(n.image_path, '')), '') IS NOT NULL
					  OR EXISTS (
						  SELECT 1
						  FROM jsonb_array_elements_text(COALESCE(n.image_paths, '[]'::jsonb)) AS image_url
						  WHERE NULLIF(trim(image_url), '') IS NOT NULL
					  )
				  )
			)
			ELSE FALSE
		END AS has_image
	FROM refs
)
SELECT
	source,
	COUNT(*)::bigint AS unique_referenced_items,
	COUNT(*)::bigint AS total,
	COUNT(*) FILTER (WHERE has_image)::bigint AS with_image,
	COUNT(*) FILTER (WHERE NOT has_image)::bigint AS empty_image
FROM resolved
GROUP BY source
ORDER BY source;
`

const emptyPackagedFoodsSQL = `
SELECT
	id,
	display_name,
	brand,
	product_name,
	spec_text,
	flavor_text,
	barcode,
	package_category,
	kcal_per_100g,
	COALESCE(updated_at::text, '') AS updated_at
FROM packaged_food_library
WHERE is_active = TRUE
  AND COALESCE(kcal_per_100g, 0) > 0
  AND NOT EXISTS (
	  SELECT 1
	  FROM jsonb_array_elements_text(COALESCE(source_image_urls, '[]'::jsonb)) AS image_url
	  WHERE NULLIF(trim(image_url), '') IS NOT NULL
  )
ORDER BY updated_at DESC NULLS LAST, display_name ASC, product_name ASC;
`

func main() {
	configDir := flag.String("config-dir", ".", "directory containing .env plus app-config.yaml or apollo-config.yaml")
	timeout := flag.Duration("timeout", 30*time.Second, "database audit timeout")
	includeEmptyPackaged := flag.Bool("include-empty-packaged", false, "include packaged_food_library rows whose source_image_urls is empty")
	emptyPackagedMarkdown := flag.String("empty-packaged-markdown", "", "write empty packaged food rows to a markdown review file")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("获取 SQL 数据库连接失败: %v", err)
	}
	defer sqlDB.Close()
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库 ping 失败: %v", err)
	}
	if cfg.Database.Schema != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + cfg.Database.Schema).Error; err != nil {
			log.Fatalf("设置数据库 schema 失败: %v", err)
		}
	}

	publicCoverage, err := scanOne(ctx, db, publicLibrarySQL)
	if err != nil {
		log.Fatalf("统计 public_food_library 失败: %v", err)
	}
	packagedCoverage, err := scanOne(ctx, db, packagedFoodSQL)
	if err != nil {
		log.Fatalf("统计 packaged_food_library 失败: %v", err)
	}
	nutritionCoverage, err := scanOne(ctx, db, nutritionLibrarySQL)
	if err != nil {
		log.Fatalf("统计 food_nutrition_library 失败: %v", err)
	}
	frequentCoverage, err := scanOne(ctx, db, frequentCatalogSQL)
	if err != nil {
		log.Fatalf("统计高频记录聚合目录失败: %v", err)
	}
	recentReferences, err := scanMany(ctx, db, recentReferenceSQL)
	if err != nil {
		log.Fatalf("统计最近手动记录引用失败: %v", err)
	}
	var emptyPackagedFoods []packagedFood
	if *includeEmptyPackaged || strings.TrimSpace(*emptyPackagedMarkdown) != "" {
		if err := db.WithContext(ctx).Raw(emptyPackagedFoodsSQL).Scan(&emptyPackagedFoods).Error; err != nil {
			log.Fatalf("查询空图包装食品明细失败: %v", err)
		}
	}
	if path := strings.TrimSpace(*emptyPackagedMarkdown); path != "" {
		if err := writeEmptyPackagedMarkdown(path, emptyPackagedFoods); err != nil {
			log.Fatalf("写入空图包装食品 Markdown 失败: %v", err)
		}
	}

	imageTotal := publicCoverage.Total + packagedCoverage.Total
	imageWith := publicCoverage.WithImage + packagedCoverage.WithImage
	imageEmpty := publicCoverage.EmptyImage + packagedCoverage.EmptyImage
	allTotal := imageTotal + nutritionCoverage.Total + frequentCoverage.Total
	allWith := imageWith + nutritionCoverage.WithImage + frequentCoverage.WithImage
	allEmpty := imageEmpty + nutritionCoverage.EmptyImage + frequentCoverage.EmptyImage

	out := auditOutput{
		ImageCapableSources: sourceCoverage{
			Source:         "public_library+packaged_food",
			Total:          imageTotal,
			WithImage:      imageWith,
			EmptyImage:     imageEmpty,
			WithImageRate:  pct(imageWith, imageTotal),
			EmptyImageRate: pct(imageEmpty, imageTotal),
		},
		AllManualFoodSourcesIncludingNoImage: sourceCoverage{
			Source:                       "manual_food_all_sources",
			Total:                        allTotal,
			WithImage:                    allWith,
			EmptyImageOrNoImageField:     allEmpty,
			WithImageRate:                pct(allWith, allTotal),
			EmptyImageOrNoImageFieldRate: pct(allEmpty, allTotal),
		},
		SourceBreakdown: []sourceCoverage{
			withRates(publicCoverage),
			withRates(packagedCoverage),
			withRates(nutritionCoverage),
			withRates(frequentCoverage),
		},
		UniqueRecentManualReferences: withRatesList(recentReferences),
		EmptyPackagedFoods:           emptyPackagedFoods,
		Note:                         "Only public_library and packaged_food have image fields. nutrition_library and frequent_record_catalog are displayed in manual food but do not carry images in manual_food_repo.",
	}

	encoded, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		log.Fatalf("编码统计结果失败: %v", err)
	}
	fmt.Println(string(encoded))
}

func scanOne(ctx context.Context, db *gorm.DB, query string) (sourceCoverage, error) {
	var row sourceCoverage
	if err := db.WithContext(ctx).Raw(query).Scan(&row).Error; err != nil {
		return sourceCoverage{}, err
	}
	return row, nil
}

func scanMany(ctx context.Context, db *gorm.DB, query string) ([]sourceCoverage, error) {
	var rows []sourceCoverage
	if err := db.WithContext(ctx).Raw(query).Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func pct(part int64, total int64) string {
	if total <= 0 {
		return "0.00%"
	}
	return fmt.Sprintf("%.2f%%", float64(part)/float64(total)*100)
}

func withRates(row sourceCoverage) sourceCoverage {
	row.WithImageRate = pct(row.WithImage, row.Total)
	row.EmptyImageRate = pct(row.EmptyImage, row.Total)
	return row
}

func withRatesList(rows []sourceCoverage) []sourceCoverage {
	for i := range rows {
		rows[i] = withRates(rows[i])
	}
	return rows
}

func writeEmptyPackagedMarkdown(path string, foods []packagedFood) error {
	var b strings.Builder
	b.WriteString("# 包装食品空图补全审核清单\n\n")
	b.WriteString(fmt.Sprintf("- 生成时间：%s\n", time.Now().Format("2006-01-02 15:04:05 -0700")))
	b.WriteString(fmt.Sprintf("- 空图包装食品数量：%d\n", len(foods)))
	b.WriteString("- 说明：以下商品当前 `source_image_urls` 为空。网络图片需要确认来源、授权和商品包装是否匹配后，再上传 COS 并写回数据库。\n\n")
	b.WriteString("| 序号 | ID | 商品 | 品牌 | 商品名 | 规格/口味 | 条码 | 建议搜索词 | 候选来源URL | 上传后COS URL | 状态 |\n")
	b.WriteString("|---:|---|---|---|---|---|---|---|---|---|---|\n")
	for i, food := range foods {
		spec := strings.Join(nonEmpty(ptrValue(food.SpecText), ptrValue(food.FlavorText), ptrValue(food.PackageCategory)), " / ")
		searchTerm := strings.TrimSpace(strings.Join(nonEmpty(food.DisplayName, food.Brand, food.ProductName, ptrValue(food.SpecText), "商品图片"), " "))
		b.WriteString(fmt.Sprintf(
			"| %d | `%s` | %s | %s | %s | %s | %s | `%s` | 待补充 | 待上传 | 待人工确认 |\n",
			i+1,
			escapeMarkdown(food.ID),
			escapeMarkdown(food.DisplayName),
			escapeMarkdown(food.Brand),
			escapeMarkdown(food.ProductName),
			escapeMarkdown(spec),
			escapeMarkdown(ptrValue(food.Barcode)),
			escapeMarkdown(searchTerm),
		))
	}
	b.WriteString("\n## 后续写回建议\n\n")
	b.WriteString("1. 先为每行补充候选来源 URL，并确认图片与商品品牌、口味、规格一致。\n")
	b.WriteString("2. 上传到 `food-images` COS bucket，建议 key 前缀为 `packaged-food/backfill/<food_id>/...`。\n")
	b.WriteString("3. 确认后更新 `packaged_food_library.source_image_urls`，不要覆盖已有非空图片数组。\n")
	return os.WriteFile(path, []byte(b.String()), 0o644)
}

func ptrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func nonEmpty(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func escapeMarkdown(value string) string {
	value = strings.ReplaceAll(value, "|", "\\|")
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	return strings.TrimSpace(value)
}
