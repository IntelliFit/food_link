package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode"

	fooddomain "food_link/backend/internal/foodrecord/domain"
	publicdomain "food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/utility/domain"
	"food_link/backend/pkg/storage"

	"gorm.io/gorm"
)

type ManualFoodRepo struct {
	db      *gorm.DB
	storage *storage.Client
}

func NewManualFoodRepo(db *gorm.DB, storageClient ...*storage.Client) *ManualFoodRepo {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &ManualFoodRepo{db: db, storage: client}
}

func (r *ManualFoodRepo) Browse(ctx context.Context, userID string, limit int) (*domain.ManualFoodBrowseResult, error) {
	limit = clampLimit(limit, 8, 20)
	result := &domain.ManualFoodBrowseResult{
		RecentItems:            []domain.ManualFoodResult{},
		CollectedPublicLibrary: []domain.ManualFoodResult{},
		PublicLibrary:          []domain.ManualFoodResult{},
		NutritionLibrary:       []domain.ManualFoodResult{},
	}

	stats, err := r.loadStats(ctx)
	if err != nil {
		return nil, err
	}
	result.Stats = stats

	if strings.TrimSpace(userID) != "" {
		if result.RecentItems, err = r.listRecentItems(ctx, userID, limit); err != nil {
			return nil, err
		}
		if result.CollectedPublicLibrary, err = r.listCollectedPublicLibrary(ctx, userID, limit); err != nil {
			return nil, err
		}
	}

	if result.PublicLibrary, err = r.listPublicLibrary(ctx, minInt(limit, 6)); err != nil {
		return nil, err
	}
	if result.NutritionLibrary, err = r.listNutritionLibrary(ctx, minInt(limit, 12)); err != nil {
		return nil, err
	}

	return result, nil
}

func (r *ManualFoodRepo) Catalog(ctx context.Context, userID string, category string, page int, pageSize int) (*domain.ManualFoodCatalogResult, error) {
	category = normalizeManualFoodCatalogCategory(category)
	if page <= 0 {
		page = 1
	}
	pageSize = clampLimit(pageSize, 30, 60)
	stats, err := r.loadStats(ctx)
	if err != nil {
		return nil, err
	}
	items, hasMore, err := r.listCatalogItems(ctx, userID, category, page, pageSize)
	if err != nil {
		return nil, err
	}
	return &domain.ManualFoodCatalogResult{
		Categories: manualFoodCatalogCategories(),
		Items:      items,
		Category:   category,
		Page:       page,
		PageSize:   pageSize,
		HasMore:    hasMore,
		Stats:      stats,
	}, nil
}

func (r *ManualFoodRepo) Search(ctx context.Context, userID string, keyword string, limit int) ([]domain.ManualFoodResult, error) {
	query := strings.TrimSpace(keyword)
	if query == "" {
		return []domain.ManualFoodResult{}, nil
	}
	limit = clampLimit(limit, 20, 60)

	results := make([]domain.ManualFoodResult, 0, limit*2)
	catalogRows, err := r.searchCatalogItems(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	results = append(results, catalogRows...)

	recentRows, err := r.searchRecentItems(ctx, userID, query, limit)
	if err != nil {
		return nil, err
	}
	results = append(results, recentRows...)

	publicRows, err := r.searchPublicLibrary(ctx, userID, query, limit)
	if err != nil {
		return nil, err
	}
	results = append(results, publicRows...)

	packagedRows, err := r.searchPackagedLibrary(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	results = append(results, packagedRows...)

	nutritionRows, err := r.searchNutritionLibrary(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	results = append(results, nutritionRows...)

	sort.SliceStable(results, func(i, j int) bool {
		left := manualFoodDisplayScore(results[i], query)
		right := manualFoodDisplayScore(results[j], query)
		if left == right {
			if results[i].UsageCount == results[j].UsageCount {
				return results[i].Title < results[j].Title
			}
			return results[i].UsageCount > results[j].UsageCount
		}
		return left > right
	})
	results = dedupeManualFoodResults(results)
	if len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

func (r *ManualFoodRepo) SearchPackaged(ctx context.Context, keyword string, limit int) ([]domain.ManualFoodResult, error) {
	query := strings.TrimSpace(keyword)
	if query == "" {
		return []domain.ManualFoodResult{}, nil
	}
	limit = clampLimit(limit, 20, 60)
	results, err := r.searchPackagedLibrary(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(results, func(i, j int) bool {
		left := manualFoodDisplayScore(results[i], query)
		right := manualFoodDisplayScore(results[j], query)
		if left == right {
			return results[i].Title < results[j].Title
		}
		return left > right
	})
	if len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

func (r *ManualFoodRepo) listCatalogItems(ctx context.Context, userID string, category string, page int, pageSize int) ([]domain.ManualFoodResult, bool, error) {
	offset := (page - 1) * pageSize
	if category == "recent" {
		if strings.TrimSpace(userID) == "" {
			return []domain.ManualFoodResult{}, false, nil
		}
		items, err := r.listRecentItems(ctx, userID, pageSize+1)
		if err != nil {
			return nil, false, err
		}
		hasMore := len(items) > pageSize
		if hasMore {
			items = items[:pageSize]
		}
		return items, hasMore, nil
	}
	if category == "favorites" {
		if strings.TrimSpace(userID) == "" {
			return []domain.ManualFoodResult{}, false, nil
		}
		items, err := r.listCollectedPublicLibrary(ctx, userID, pageSize+1)
		if err != nil {
			return nil, false, err
		}
		hasMore := len(items) > pageSize
		if hasMore {
			items = items[:pageSize]
		}
		return items, hasMore, nil
	}

	userItems, err := r.listGlobalFrequentRecordItems(ctx, category, pageSize+1, offset)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(userItems) > pageSize
	if hasMore {
		userItems = userItems[:pageSize]
	}
	if len(userItems) >= pageSize || category == "common" || category == "recent" || category == "favorites" {
		return userItems, hasMore, nil
	}

	packagedLimit := pageSize - len(userItems)
	packagedItems, err := r.listPackagedCatalogItems(ctx, category, packagedLimit+1, packagedCatalogOffset(category, page, pageSize, len(userItems)))
	if err != nil {
		return nil, false, err
	}
	if len(packagedItems) > packagedLimit {
		hasMore = true
		packagedItems = packagedItems[:packagedLimit]
	}

	nutritionItems, err := r.listNutritionCatalogItems(ctx, category, pageSize-len(userItems)-len(packagedItems), 0)
	if err != nil {
		return nil, false, err
	}
	items := dedupeManualFoodResults(append(append(userItems, packagedItems...), nutritionItems...))
	if len(items) > pageSize {
		items = items[:pageSize]
		hasMore = true
	}
	return items, hasMore, nil
}

func (r *ManualFoodRepo) listGlobalFrequentRecordItems(ctx context.Context, category string, limit int, offset int) ([]domain.ManualFoodResult, error) {
	type row struct {
		Name       string          `gorm:"column:name"`
		Uses       int             `gorm:"column:uses"`
		AvgWeight  float64         `gorm:"column:avg_weight"`
		AvgCal     float64         `gorm:"column:avg_cal"`
		AvgProtein float64         `gorm:"column:avg_protein"`
		AvgCarbs   float64         `gorm:"column:avg_carbs"`
		AvgFat     float64         `gorm:"column:avg_fat"`
		ItemJSON   json.RawMessage `gorm:"column:item_json"`
	}
	whereCategory := ""
	args := []any{}
	if category != "" && category != "all" && category != "common" {
		whereCategory = "AND " + manualFoodCategoryFilterSQL("name", category)
	}
	args = append(args, limit, offset)
	var rows []row
	err := r.db.WithContext(ctx).Raw(fmt.Sprintf(`
		WITH record_items AS (
			SELECT
				trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', ''))) AS name,
				item
			FROM user_food_records
			CROSS JOIN LATERAL jsonb_array_elements(items) item
			WHERE trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', ''))) <> ''
				AND COALESCE(item->'nutrients'->>'calories', item->>'calories') ~ '^[0-9]+([.][0-9]+){0,1}$'
		)
		SELECT
			name,
			COUNT(*)::int AS uses,
			COALESCE(AVG(NULLIF(COALESCE(item->>'intake', item->>'weight'), '')::numeric), 100)::float8 AS avg_weight,
			COALESCE(AVG(NULLIF(COALESCE(item->'nutrients'->>'calories', item->>'calories'), '')::numeric), 0)::float8 AS avg_cal,
			COALESCE(AVG(NULLIF(COALESCE(item->'nutrients'->>'protein', item->>'protein'), '')::numeric), 0)::float8 AS avg_protein,
			COALESCE(AVG(NULLIF(COALESCE(item->'nutrients'->>'carbs', item->>'carbs'), '')::numeric), 0)::float8 AS avg_carbs,
			COALESCE(AVG(NULLIF(COALESCE(item->'nutrients'->>'fat', item->>'fat'), '')::numeric), 0)::float8 AS avg_fat,
			(MAX(item::text))::jsonb AS item_json
		FROM record_items
		WHERE name <> ''
			%s
		GROUP BY name
		HAVING COUNT(*) >= 3
		ORDER BY COUNT(*) DESC, name ASC
		LIMIT ? OFFSET ?
	`, whereCategory), args...).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		item := manualFoodResultFromFrequentRecord(row.Name, row.Uses, row.AvgWeight, row.AvgCal, row.AvgProtein, row.AvgCarbs, row.AvgFat, row.ItemJSON)
		if item.Title != "" {
			results = append(results, item)
		}
	}
	return results, nil
}

func (r *ManualFoodRepo) searchCatalogItems(ctx context.Context, query string, limit int) ([]domain.ManualFoodResult, error) {
	terms := expandedSearchTerms(query)
	type row struct {
		Name       string          `gorm:"column:name"`
		Uses       int             `gorm:"column:uses"`
		AvgWeight  float64         `gorm:"column:avg_weight"`
		AvgCal     float64         `gorm:"column:avg_cal"`
		AvgProtein float64         `gorm:"column:avg_protein"`
		AvgCarbs   float64         `gorm:"column:avg_carbs"`
		AvgFat     float64         `gorm:"column:avg_fat"`
		ItemJSON   json.RawMessage `gorm:"column:item_json"`
	}
	conditions := make([]string, 0, len(terms))
	args := []any{}
	for _, term := range terms {
		conditions = append(conditions, "LOWER(name) LIKE ?")
		args = append(args, "%"+strings.ToLower(term)+"%")
	}
	args = append(args, limit)
	var rows []row
	err := r.db.WithContext(ctx).Raw(fmt.Sprintf(`
		WITH record_items AS (
			SELECT
				trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', ''))) AS name,
				item
			FROM user_food_records
			CROSS JOIN LATERAL jsonb_array_elements(items) item
			WHERE trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', ''))) <> ''
				AND COALESCE(item->'nutrients'->>'calories', item->>'calories') ~ '^[0-9]+([.][0-9]+){0,1}$'
		)
		SELECT
			name,
			COUNT(*)::int AS uses,
			COALESCE(AVG(NULLIF(COALESCE(item->>'intake', item->>'weight'), '')::numeric), 100)::float8 AS avg_weight,
			COALESCE(AVG(NULLIF(COALESCE(item->'nutrients'->>'calories', item->>'calories'), '')::numeric), 0)::float8 AS avg_cal,
			COALESCE(AVG(NULLIF(COALESCE(item->'nutrients'->>'protein', item->>'protein'), '')::numeric), 0)::float8 AS avg_protein,
			COALESCE(AVG(NULLIF(COALESCE(item->'nutrients'->>'carbs', item->>'carbs'), '')::numeric), 0)::float8 AS avg_carbs,
			COALESCE(AVG(NULLIF(COALESCE(item->'nutrients'->>'fat', item->>'fat'), '')::numeric), 0)::float8 AS avg_fat,
			(MAX(item::text))::jsonb AS item_json
		FROM record_items
		WHERE %s
		GROUP BY name
		HAVING COUNT(*) >= 2
		ORDER BY
			CASE WHEN name = ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END,
			COUNT(*) DESC,
			name ASC
		LIMIT ?
	`, strings.Join(conditions, " OR ")), append(args[:len(args)-1], query, query+"%", limit)...).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		item := manualFoodResultFromFrequentRecord(row.Name, row.Uses, row.AvgWeight, row.AvgCal, row.AvgProtein, row.AvgCarbs, row.AvgFat, row.ItemJSON)
		item.MatchScore = computeMatchScore(query, row.Name) + 0.45
		results = append(results, item)
	}
	return results, nil
}

func (r *ManualFoodRepo) listNutritionCatalogItems(ctx context.Context, category string, limit int, offset int) ([]domain.ManualFoodResult, error) {
	if limit <= 0 {
		return nil, nil
	}
	whereCategory := ""
	args := []any{true}
	if category != "" && category != "all" && category != "common" {
		whereCategory = "AND " + manualFoodCategoryFilterSQL("canonical_name", category)
	}
	args = append(args, limit, offset)
	var rows []fooddomain.FoodNutrition
	err := r.db.WithContext(ctx).Raw(fmt.Sprintf(`
		SELECT *
		FROM food_nutrition_library
		WHERE is_active = ?
			AND kcal_per_100g > 0
			AND canonical_name ~ '[一-龥]'
			%s
		ORDER BY %s
		LIMIT ? OFFSET ?
	`, whereCategory, nutritionBrowseOrderSQL()), args...).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		results = append(results, manualFoodResultFromNutrition(row, 0))
	}
	return results, nil
}

func (r *ManualFoodRepo) listPackagedCatalogItems(ctx context.Context, category string, limit int, offset int) ([]domain.ManualFoodResult, error) {
	if limit <= 0 || !manualFoodCategoryCanIncludePackaged(category) {
		return nil, nil
	}
	if offset < 0 {
		offset = 0
	}
	var rows []fooddomain.PackagedFood
	err := r.db.WithContext(ctx).
		Where("is_active = ? AND kcal_per_100g > 0", true).
		Order("updated_at DESC NULLS LAST, product_name ASC").
		Limit(minInt(limit, 60)).
		Offset(offset).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		result := manualFoodResultFromPackaged(row, 0.72)
		if packagedMatchesManualCategory(result, row, category) {
			results = append(results, result)
		}
	}
	return results, nil
}

func (r *ManualFoodRepo) loadStats(ctx context.Context) (*domain.ManualFoodBrowseStats, error) {
	stats := &domain.ManualFoodBrowseStats{}
	if err := r.db.WithContext(ctx).Model(&fooddomain.FoodNutrition{}).Where("is_active = ?", true).Count(&stats.NutritionFoodCount).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&fooddomain.FoodNutritionAlias{}).Count(&stats.NutritionAliasCount).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&publicdomain.PublicFoodItem{}).Where("status = ?", "published").Count(&stats.PublicFoodCount).Error; err != nil {
		return nil, err
	}
	return stats, nil
}

func (r *ManualFoodRepo) listRecentItems(ctx context.Context, userID string, limit int) ([]domain.ManualFoodResult, error) {
	type row struct {
		ManualSource       string          `gorm:"column:manual_source"`
		ManualSourceID     string          `gorm:"column:manual_source_id"`
		ManualSourceTitle  string          `gorm:"column:manual_source_title"`
		ManualPortionLabel string          `gorm:"column:manual_portion_label"`
		UsageCount         int             `gorm:"column:usage_count"`
		LatestRecordTime   string          `gorm:"column:latest_record_time"`
		ItemJSON           json.RawMessage `gorm:"column:item_json"`
	}
	var rows []row
	err := r.db.WithContext(ctx).Raw(`
		SELECT
			item->>'manual_source' AS manual_source,
			item->>'manual_source_id' AS manual_source_id,
			COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', '')) AS manual_source_title,
			COALESCE(NULLIF(item->>'manual_portion_label', ''), '1份') AS manual_portion_label,
			COUNT(*)::int AS usage_count,
			MAX(record_time)::text AS latest_record_time,
			(MAX(item::text))::jsonb AS item_json
		FROM user_food_records
		CROSS JOIN LATERAL jsonb_array_elements(items) AS item
		WHERE user_id = ?
			AND item->>'manual_source' IN ('public_library', 'nutrition_library', 'packaged_food')
			AND COALESCE(item->>'manual_source_id', '') <> ''
		GROUP BY 1,2,3,4
		ORDER BY usage_count DESC, latest_record_time DESC
		LIMIT ?
	`, userID, limit).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		result := manualFoodResultFromRecordItem(row.ManualSource, row.ManualSourceID, row.ManualSourceTitle, row.ManualPortionLabel, row.UsageCount, row.ItemJSON)
		if result.ID == "" || result.Title == "" {
			continue
		}
		if result.Source == "nutrition_library" && result.DefaultWeightGrams <= 0 {
			result.DefaultWeightGrams = 100
		}
		if result.Source == "public_library" && result.DefaultWeightGrams <= 0 {
			result.DefaultWeightGrams = 1
		}
		result.SourceLabel = sourceLabel(result.Source)
		result.Category = inferManualFoodCategory(result.Title, result.Source)
		result.MatchScore = 0.45
		results = append(results, result)
	}
	return results, nil
}

func (r *ManualFoodRepo) listCollectedPublicLibrary(ctx context.Context, userID string, limit int) ([]domain.ManualFoodResult, error) {
	var rows []publicdomain.PublicFoodItem
	err := r.db.WithContext(ctx).
		Table("public_food_library AS p").
		Select("p.*").
		Joins("JOIN public_food_library_collections c ON c.library_item_id = p.id").
		Where("c.user_id = ? AND p.status = ?", userID, "published").
		Order("c.created_at DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		result := r.manualFoodResultFromPublic(row, true)
		result.MatchScore = 0.5
		results = append(results, result)
	}
	return results, nil
}

func (r *ManualFoodRepo) listPublicLibrary(ctx context.Context, limit int) ([]domain.ManualFoodResult, error) {
	var rows []publicdomain.PublicFoodItem
	err := r.db.WithContext(ctx).
		Where("status = ? AND total_calories > 0 AND total_calories <= ?", "published", 900).
		Order("collection_count DESC, like_count DESC, published_at DESC NULLS LAST, created_at DESC").
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		results = append(results, r.manualFoodResultFromPublic(row, false))
	}
	return results, nil
}

func (r *ManualFoodRepo) listNutritionLibrary(ctx context.Context, limit int) ([]domain.ManualFoodResult, error) {
	var rows []fooddomain.FoodNutrition
	err := r.db.WithContext(ctx).
		Where("is_active = ? AND kcal_per_100g > 0", true).
		Order(nutritionBrowseOrderSQL()).
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		results = append(results, manualFoodResultFromNutrition(row, 0))
	}
	return results, nil
}

func (r *ManualFoodRepo) searchRecentItems(ctx context.Context, userID string, query string, limit int) ([]domain.ManualFoodResult, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, nil
	}
	terms := expandedSearchTerms(query)
	type row struct {
		ManualSource       string          `gorm:"column:manual_source"`
		ManualSourceID     string          `gorm:"column:manual_source_id"`
		ManualSourceTitle  string          `gorm:"column:manual_source_title"`
		ManualPortionLabel string          `gorm:"column:manual_portion_label"`
		UsageCount         int             `gorm:"column:usage_count"`
		LatestRecordTime   string          `gorm:"column:latest_record_time"`
		ItemJSON           json.RawMessage `gorm:"column:item_json"`
	}
	conditions := make([]string, 0, len(terms))
	args := []any{userID}
	for _, term := range terms {
		conditions = append(conditions, `
			LOWER(COALESCE(item->>'manual_source_title', item->>'name', '')) LIKE ?
		`)
		args = append(args, "%"+strings.ToLower(term)+"%")
	}
	args = append(args, limit)
	var rows []row
	err := r.db.WithContext(ctx).Raw(fmt.Sprintf(`
		SELECT
			item->>'manual_source' AS manual_source,
			item->>'manual_source_id' AS manual_source_id,
			COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', '')) AS manual_source_title,
			COALESCE(NULLIF(item->>'manual_portion_label', ''), '1份') AS manual_portion_label,
			COUNT(*)::int AS usage_count,
			MAX(record_time)::text AS latest_record_time,
			(MAX(item::text))::jsonb AS item_json
		FROM user_food_records
		CROSS JOIN LATERAL jsonb_array_elements(items) AS item
		WHERE user_id = ?
			AND item->>'manual_source' IN ('public_library', 'nutrition_library', 'packaged_food')
			AND COALESCE(item->>'manual_source_id', '') <> ''
			AND (%s)
		GROUP BY 1,2,3,4
		ORDER BY usage_count DESC, latest_record_time DESC
		LIMIT ?
	`, strings.Join(conditions, " OR ")), args...).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		result := manualFoodResultFromRecordItem(row.ManualSource, row.ManualSourceID, row.ManualSourceTitle, row.ManualPortionLabel, row.UsageCount, row.ItemJSON)
		if result.ID == "" || result.Title == "" {
			continue
		}
		result.SourceLabel = sourceLabel(result.Source)
		result.Category = inferManualFoodCategory(result.Title, result.Source)
		result.MatchScore = computeMatchScore(query, result.Title, result.Subtitle) + 0.35
		results = append(results, result)
	}
	return results, nil
}

func (r *ManualFoodRepo) searchPublicLibrary(ctx context.Context, userID string, query string, limit int) ([]domain.ManualFoodResult, error) {
	terms := expandedSearchTerms(query)
	type row struct {
		publicdomain.PublicFoodItem
		UsageCount int `gorm:"column:usage_count"`
	}
	conditions := make([]string, 0, len(terms))
	usageWhere := "FALSE"
	args := []any{}
	if strings.TrimSpace(userID) != "" {
		usageWhere = "user_id = ?"
		args = append(args, userID)
	}
	for _, term := range terms {
		like := "%" + strings.ToLower(term) + "%"
		conditions = append(conditions, `
			LOWER(COALESCE(p.food_name, '')) LIKE ?
			OR LOWER(COALESCE(p.description, '')) LIKE ?
			OR LOWER(COALESCE(p.merchant_name, '')) LIKE ?
			OR EXISTS (
				SELECT 1
				FROM jsonb_array_elements(p.items) AS item
				WHERE LOWER(COALESCE(item->>'name', '')) LIKE ?
			)
		`)
		args = append(args, like, like, like, like)
	}
	args = append(args, limit)
	var rows []row
	err := r.db.WithContext(ctx).Raw(fmt.Sprintf(`
		SELECT
			p.*,
			COALESCE(usage.usage_count, 0) AS usage_count
		FROM public_food_library p
		LEFT JOIN (
			SELECT
				item->>'manual_source_id' AS source_id,
				COUNT(*)::int AS usage_count
			FROM user_food_records
			CROSS JOIN LATERAL jsonb_array_elements(items) AS item
		WHERE %s
				AND item->>'manual_source' = 'public_library'
			GROUP BY 1
		) usage ON usage.source_id = p.id::text
		WHERE p.status = 'published'
			AND (%s)
		ORDER BY usage_count DESC, p.collection_count DESC, p.like_count DESC, p.published_at DESC NULLS LAST
		LIMIT ?
	`, usageWhere, strings.Join(conditions, " OR ")), args...).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		result := r.manualFoodResultFromPublic(row.PublicFoodItem, false)
		result.UsageCount = row.UsageCount
		result.MatchScore = computeMatchScore(query, result.Title, result.Subtitle) + 0.1
		results = append(results, result)
	}
	return results, nil
}

func (r *ManualFoodRepo) searchPackagedLibrary(ctx context.Context, query string, limit int) ([]domain.ManualFoodResult, error) {
	terms := expandedSearchTerms(query)
	conditions := make([]string, 0, len(terms))
	args := []any{}
	for _, term := range terms {
		like := "%" + strings.ToLower(term) + "%"
		conditions = append(conditions, `
			LOWER(COALESCE(product_name, '')) LIKE ?
			OR LOWER(COALESCE(display_name, '')) LIKE ?
			OR LOWER(COALESCE(search_text, '')) LIKE ?
			OR LOWER(COALESCE(product_family_key, '')) LIKE ?
			OR LOWER(COALESCE(brand, '')) LIKE ?
			OR LOWER(COALESCE(flavor_text, '')) LIKE ?
			OR LOWER(COALESCE(spec_text, '')) LIKE ?
			OR LOWER(COALESCE(barcode, '')) LIKE ?
			OR LOWER(COALESCE(package_category, '')) LIKE ?
		`)
		args = append(args, like, like, like, like, like, like, like, like, like)
	}
	args = append(args, query+"%", limit)
	var rows []fooddomain.PackagedFood
	err := r.db.WithContext(ctx).Raw(fmt.Sprintf(`
		SELECT *
		FROM packaged_food_library
		WHERE is_active = TRUE
			AND kcal_per_100g > 0
			AND (%s)
		ORDER BY
			CASE WHEN LOWER(COALESCE(display_name, product_name)) LIKE LOWER(?) THEN 0 ELSE 1 END,
			updated_at DESC NULLS LAST,
			product_name ASC
		LIMIT ?
	`, strings.Join(conditions, " OR ")), args...).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		score := computeMatchScore(query, packagedDisplayName(row), row.SearchText, row.ProductName, row.Brand, stringPtrValue(row.FlavorText), stringPtrValue(row.SpecText), stringPtrValue(row.Barcode)) + 0.18
		results = append(results, manualFoodResultFromPackaged(row, score))
	}
	return results, nil
}

func (r *ManualFoodRepo) searchNutritionLibrary(ctx context.Context, query string, limit int) ([]domain.ManualFoodResult, error) {
	terms := expandedSearchTerms(query)
	type row struct {
		fooddomain.FoodNutrition
		MatchSource string `gorm:"column:match_source"`
	}
	conditions := make([]string, 0, len(terms))
	args := []any{}
	for _, term := range terms {
		like := "%" + strings.ToLower(term) + "%"
		conditions = append(conditions, `
			LOWER(f.canonical_name) LIKE ?
			OR LOWER(COALESCE(a.alias_name, '')) LIKE ?
		`)
		args = append(args, like, like)
	}
	args = append([]any{"%" + strings.ToLower(query) + "%"}, args...)
	args = append(args, limit)
	var rows []row
	err := r.db.WithContext(ctx).Raw(fmt.Sprintf(`
		SELECT DISTINCT ON (f.id)
			f.*,
			CASE
				WHEN LOWER(f.canonical_name) LIKE ? THEN 'canonical'
				ELSE 'alias'
			END AS match_source
		FROM food_nutrition_library f
		LEFT JOIN food_nutrition_aliases a ON a.food_id = f.id
		WHERE f.is_active = TRUE
			AND f.kcal_per_100g > 0
			AND (%s)
		ORDER BY f.id, match_source ASC, %s
		LIMIT ?
	`, strings.Join(conditions, " OR "), nutritionSearchOrderSQL()), args...).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		score := computeMatchScore(query, row.CanonicalName, row.MatchSource)
		if row.MatchSource == "canonical" {
			score += 0.1
		}
		results = append(results, manualFoodResultFromNutrition(row.FoodNutrition, score))
	}
	return results, nil
}

func (r *ManualFoodRepo) manualFoodResultFromPublic(item publicdomain.PublicFoodItem, collected bool) domain.ManualFoodResult {
	item = r.normalizePublicFoodItem(item)
	title := strings.TrimSpace(item.FoodName)
	if title == "" {
		title = strings.TrimSpace(item.Description)
	}
	if title == "" {
		title = "真实餐食"
	}
	subtitleParts := make([]string, 0, 2)
	if merchant := strings.TrimSpace(item.MerchantName); merchant != "" {
		subtitleParts = append(subtitleParts, merchant)
	}
	if desc := strings.TrimSpace(item.Description); desc != "" && desc != title {
		subtitleParts = append(subtitleParts, desc)
	}
	portionLabel := "1份"
	defaultWeight := 1.0
	if item.Items != nil && len(item.Items) == 1 {
		if label := strings.TrimSpace(fmt.Sprintf("%v", item.Items[0]["manual_portion_label"])); label != "" && label != "<nil>" {
			portionLabel = label
		}
		if intake := numberFromAny(item.Items[0]["intake"]); intake > 0 {
			defaultWeight = intake
		} else if weight := numberFromAny(item.Items[0]["weight"]); weight > 0 {
			defaultWeight = weight
		}
	}
	if defaultWeight <= 0 && item.TotalCalories > 0 {
		defaultWeight = 1
	}
	highlights := make([]string, 0, 2)
	if item.TotalProtein >= 20 {
		highlights = append(highlights, fmt.Sprintf("蛋白 %.0fg", item.TotalProtein))
	}
	if item.TotalCalories > 0 && item.TotalCalories <= 350 {
		highlights = append(highlights, fmt.Sprintf("%.0f kcal", item.TotalCalories))
	}
	result := domain.ManualFoodResult{
		ID:                  item.ID,
		Source:              "public_library",
		Title:               title,
		Subtitle:            strings.Join(subtitleParts, " · "),
		Category:            inferManualFoodCategory(title+" "+strings.Join(subtitleParts, " "), "public_library"),
		DefaultWeightGrams:  defaultWeight,
		TotalCalories:       item.TotalCalories,
		TotalProtein:        item.TotalProtein,
		TotalCarbs:          item.TotalCarbs,
		TotalFat:            item.TotalFat,
		Items:               item.Items,
		ImagePath:           item.ImagePath,
		ImagePaths:          item.ImagePaths,
		PortionLabel:        portionLabel,
		SourceLabel:         "真实餐食",
		RecommendReason:     "整份复用更快，适合商家餐和外卖",
		NutritionHighlights: highlights,
		Collected:           collected,
		LikeCount:           item.LikeCount,
		CollectionCount:     item.CollectionCount,
	}
	applyManualFoodServingProfile(&result)
	return result
}

func manualFoodResultFromPackaged(item fooddomain.PackagedFood, score float64) domain.ManualFoodResult {
	title := packagedDisplayName(item)
	if title == "" {
		title = "包装食品"
	}
	subtitleParts := make([]string, 0, 3)
	if brand := strings.TrimSpace(item.Brand); brand != "" && !strings.Contains(title, brand) {
		subtitleParts = append(subtitleParts, brand)
	}
	if flavor := stringPtrValue(item.FlavorText); flavor != "" && !strings.Contains(title, flavor) {
		subtitleParts = append(subtitleParts, flavor)
	}
	if spec := stringPtrValue(item.SpecText); spec != "" && !strings.Contains(title, spec) {
		subtitleParts = append(subtitleParts, spec)
	}
	if basis := stringPtrValue(item.NutritionBasisUnit); basis != "" {
		subtitleParts = append(subtitleParts, "营养口径 "+basis)
	}
	imagePath, imagePaths := packagedPrimaryImage(item.SourceImageURLs)
	highlights := make([]string, 0, 3)
	if item.KcalPer100g > 0 {
		highlights = append(highlights, fmt.Sprintf("%.0f kcal/100g", item.KcalPer100g))
	}
	if item.ProteinPer100g >= 8 {
		highlights = append(highlights, fmt.Sprintf("蛋白 %.1fg/100g", item.ProteinPer100g))
	}
	if label := packagedNetContentLabel(item); label != "" {
		highlights = append(highlights, "净含量 "+label)
	}
	subtitle := strings.Join(subtitleParts, " · ")
	result := domain.ManualFoodResult{
		ID:                 item.ID,
		Source:             "packaged_food",
		Title:              title,
		Subtitle:           subtitle,
		Category:           inferManualFoodCategory(title+" "+subtitle+" "+stringPtrValue(item.PackageCategory), "packaged_food"),
		DefaultWeightGrams: packagedDefaultWeight(item),
		TotalCalories:      item.KcalPer100g,
		TotalProtein:       item.ProteinPer100g,
		TotalCarbs:         item.CarbsPer100g,
		TotalFat:           item.FatPer100g,
		NutrientsPer100g: &domain.ManualFoodNutrients{
			Calories: item.KcalPer100g,
			Protein:  item.ProteinPer100g,
			Carbs:    item.CarbsPer100g,
			Fat:      item.FatPer100g,
			Fiber:    item.FiberPer100g,
			Sugar:    item.SugarPer100g,
			SodiumMg: item.SodiumMgPer100g,
		},
		ExtraNutrients: &domain.ManualFoodNutrients{
			Fiber:    item.FiberPer100g,
			Sugar:    item.SugarPer100g,
			SodiumMg: item.SodiumMgPer100g,
		},
		ImagePath:           imagePath,
		ImagePaths:          imagePaths,
		PortionLabel:        packagedPortionLabel(item),
		SourceLabel:         "包装食品",
		RecommendReason:     "来自用户上传包装图，按营养成分表换算",
		NutritionHighlights: highlights,
		MatchScore:          score,
	}
	applyManualFoodServingProfile(&result)
	return result
}

func manualFoodResultFromNutrition(item fooddomain.FoodNutrition, score float64) domain.ManualFoodResult {
	title := strings.TrimSpace(item.CanonicalName)
	if title == "" {
		title = "标准食物"
	}
	highlights := make([]string, 0, 2)
	if item.ProteinPer100g >= 10 {
		highlights = append(highlights, fmt.Sprintf("蛋白 %.1fg/100g", item.ProteinPer100g))
	}
	if item.KcalPer100g > 0 && item.KcalPer100g <= 120 {
		highlights = append(highlights, fmt.Sprintf("%.0f kcal/100g", item.KcalPer100g))
	}
	result := domain.ManualFoodResult{
		ID:                 item.ID,
		Source:             "nutrition_library",
		Title:              title,
		Subtitle:           "标准营养库",
		Category:           inferManualFoodCategory(title, "nutrition_library"),
		DefaultWeightGrams: 100,
		TotalCalories:      item.KcalPer100g,
		TotalProtein:       item.ProteinPer100g,
		TotalCarbs:         item.CarbsPer100g,
		TotalFat:           item.FatPer100g,
		NutrientsPer100g: &domain.ManualFoodNutrients{
			Calories: item.KcalPer100g,
			Protein:  item.ProteinPer100g,
			Carbs:    item.CarbsPer100g,
			Fat:      item.FatPer100g,
			Fiber:    item.FiberPer100g,
			Sugar:    item.SugarPer100g,
			SodiumMg: item.SodiumMgPer100g,
		},
		ExtraNutrients: &domain.ManualFoodNutrients{
			Fiber:    item.FiberPer100g,
			Sugar:    item.SugarPer100g,
			SodiumMg: item.SodiumMgPer100g,
		},
		PortionLabel:        "100g",
		SourceLabel:         "标准食物",
		RecommendReason:     "按克重精调，适合单食材和自制餐",
		NutritionHighlights: highlights,
		MatchScore:          score,
	}
	applyManualFoodServingProfile(&result)
	return result
}

func manualFoodResultFromRecordItem(source, sourceID, sourceTitle, portionLabel string, usageCount int, raw json.RawMessage) domain.ManualFoodResult {
	type nutrientPayload struct {
		Calories float64 `json:"calories"`
		Protein  float64 `json:"protein"`
		Carbs    float64 `json:"carbs"`
		Fat      float64 `json:"fat"`
		Fiber    float64 `json:"fiber"`
		Sugar    float64 `json:"sugar"`
		SodiumMg float64 `json:"sodium_mg"`
	}
	type recordItem struct {
		Name      string          `json:"name"`
		Weight    float64         `json:"weight"`
		Intake    float64         `json:"intake"`
		Nutrients nutrientPayload `json:"nutrients"`
	}
	var item recordItem
	_ = json.Unmarshal(raw, &item)
	title := strings.TrimSpace(sourceTitle)
	if title == "" {
		title = strings.TrimSpace(item.Name)
	}
	defaultWeight := item.Intake
	if defaultWeight <= 0 {
		defaultWeight = item.Weight
	}
	result := domain.ManualFoodResult{
		ID:                 strings.TrimSpace(sourceID),
		Source:             strings.TrimSpace(source),
		Title:              title,
		Subtitle:           "最近常吃",
		Category:           inferManualFoodCategory(title, source),
		DefaultWeightGrams: defaultWeight,
		TotalCalories:      item.Nutrients.Calories,
		TotalProtein:       item.Nutrients.Protein,
		TotalCarbs:         item.Nutrients.Carbs,
		TotalFat:           item.Nutrients.Fat,
		PortionLabel:       strings.TrimSpace(portionLabel),
		SourceLabel:        sourceLabel(source),
		UsageCount:         usageCount,
		ExtraNutrients: &domain.ManualFoodNutrients{
			Fiber:    item.Nutrients.Fiber,
			Sugar:    item.Nutrients.Sugar,
			SodiumMg: item.Nutrients.SodiumMg,
		},
	}
	if result.DefaultWeightGrams > 0 {
		scale := 100 / result.DefaultWeightGrams
		result.NutrientsPer100g = &domain.ManualFoodNutrients{
			Calories: result.TotalCalories * scale,
			Protein:  result.TotalProtein * scale,
			Carbs:    result.TotalCarbs * scale,
			Fat:      result.TotalFat * scale,
			Fiber:    item.Nutrients.Fiber * scale,
			Sugar:    item.Nutrients.Sugar * scale,
			SodiumMg: item.Nutrients.SodiumMg * scale,
		}
	}
	applyManualFoodServingProfile(&result)
	return result
}

func manualFoodResultFromFrequentRecord(name string, usageCount int, avgWeight float64, avgCalories float64, avgProtein float64, avgCarbs float64, avgFat float64, raw json.RawMessage) domain.ManualFoodResult {
	title := strings.TrimSpace(name)
	if title == "" {
		return domain.ManualFoodResult{}
	}
	defaultWeight := avgWeight
	if defaultWeight <= 0 {
		defaultWeight = 100
	}
	per100Scale := 100 / defaultWeight
	if avgCalories <= 0 {
		item := manualFoodResultFromRecordItem("nutrition_library", "catalog:"+title, title, "100g", usageCount, raw)
		item.ID = "catalog:" + title
		item.Source = "nutrition_library"
		item.SourceLabel = "常用食物"
		item.RecommendReason = "来自大家真实记录的高频食物"
		applyManualFoodServingProfile(&item)
		return item
	}
	highlights := []string{fmt.Sprintf("记录过 %d 次", usageCount)}
	if avgProtein > 8 {
		highlights = append(highlights, fmt.Sprintf("蛋白 %.1fg", avgProtein))
	}
	result := domain.ManualFoodResult{
		ID:                 "catalog:" + title,
		Source:             "nutrition_library",
		Title:              title,
		Subtitle:           "常用食物",
		Category:           inferManualFoodCategory(title, "nutrition_library"),
		DefaultWeightGrams: defaultWeight,
		TotalCalories:      avgCalories,
		TotalProtein:       avgProtein,
		TotalCarbs:         avgCarbs,
		TotalFat:           avgFat,
		NutrientsPer100g: &domain.ManualFoodNutrients{
			Calories: avgCalories * per100Scale,
			Protein:  avgProtein * per100Scale,
			Carbs:    avgCarbs * per100Scale,
			Fat:      avgFat * per100Scale,
		},
		ExtraNutrients:      &domain.ManualFoodNutrients{},
		PortionLabel:        fmt.Sprintf("%.0fg", defaultWeight),
		SourceLabel:         "常用食物",
		RecommendReason:     "来自真实记录的高频食物",
		NutritionHighlights: highlights,
		UsageCount:          usageCount,
		MatchScore:          0.58,
	}
	applyManualFoodServingProfile(&result)
	return result
}

func (r *ManualFoodRepo) normalizePublicFoodItem(item publicdomain.PublicFoodItem) publicdomain.PublicFoodItem {
	if r.storage != nil {
		item.ImagePaths = r.storage.ResolveReferenceURLs("food-images", item.ImagePaths)
		if item.ImagePath != nil {
			resolved := r.storage.ResolveReferenceURL("food-images", *item.ImagePath)
			item.ImagePath = &resolved
		}
	}
	if item.ImagePath == nil && len(item.ImagePaths) > 0 {
		first := item.ImagePaths[0]
		item.ImagePath = &first
	}
	return item
}

func sourceLabel(source string) string {
	switch strings.TrimSpace(source) {
	case "public_library":
		return "真实餐食"
	case "packaged_food":
		return "包装食品"
	}
	return "标准食物"
}

func clampLimit(limit, fallback, max int) int {
	if limit <= 0 {
		return fallback
	}
	if limit > max {
		return max
	}
	return limit
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func computeMatchScore(query string, fields ...string) float64 {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return 0
	}
	best := 0.0
	for _, field := range fields {
		value := strings.ToLower(strings.TrimSpace(field))
		switch {
		case value == "":
		case value == q:
			if best < 1 {
				best = 1
			}
		case strings.HasPrefix(value, q):
			if best < 0.92 {
				best = 0.92
			}
		case strings.Contains(value, q):
			if best < 0.82 {
				best = 0.82
			}
		}
	}
	return best
}

func manualFoodDisplayScore(item domain.ManualFoodResult, query string) float64 {
	score := item.MatchScore
	if item.UsageCount > 0 {
		score += 0.25
	}
	if item.Collected {
		score += 0.2
	}
	if item.Source == "nutrition_library" && containsCJK(item.Title) {
		score += 0.18
	}
	if item.Source == "nutrition_library" && !containsCJK(item.Title) {
		score -= 0.55
	}
	if item.Category == "staple" {
		score += 0.18
	}
	if strings.Contains(strings.ToLower(strings.TrimSpace(item.Title)), strings.ToLower(strings.TrimSpace(query))) {
		score += 0.12
	}
	return score
}

func dedupeManualFoodResults(items []domain.ManualFoodResult) []domain.ManualFoodResult {
	seen := map[string]bool{}
	out := make([]domain.ManualFoodResult, 0, len(items))
	for _, item := range items {
		key := item.Source + ":" + item.ID
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func expandedSearchTerms(query string) []string {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil
	}
	terms := []string{q}
	lower := strings.ToLower(q)
	switch {
	case q == "饭" || q == "米饭" || strings.Contains(lower, "rice"):
		terms = append(terms, "米饭", "白米饭", "米", "rice", "cooked rice")
	case strings.Contains(q, "面"):
		terms = append(terms, "面条", "面", "noodle")
	case strings.Contains(q, "鸡"):
		terms = append(terms, "鸡肉", "鸡胸", "chicken")
	case strings.Contains(q, "牛"):
		terms = append(terms, "牛肉", "beef")
	case strings.Contains(q, "蛋"):
		terms = append(terms, "鸡蛋", "蛋", "egg")
	}
	return uniqueStrings(terms)
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func manualFoodCatalogCategories() []domain.ManualFoodCatalogCategory {
	return []domain.ManualFoodCatalogCategory{
		{Key: "common", Label: "常见"},
		{Key: "recent", Label: "最近"},
		{Key: "favorites", Label: "收藏"},
		{Key: "staple", Label: "主食"},
		{Key: "protein", Label: "肉蛋奶"},
		{Key: "vegetable", Label: "蔬菜"},
		{Key: "fruit", Label: "水果"},
		{Key: "dairy", Label: "乳品"},
		{Key: "beverage", Label: "饮品"},
		{Key: "soup", Label: "汤饮"},
		{Key: "snack", Label: "零食"},
		{Key: "meal", Label: "菜肴"},
		{Key: "other", Label: "其他"},
	}
}

func normalizeManualFoodCatalogCategory(category string) string {
	category = strings.TrimSpace(category)
	if category == "" || category == "all" {
		return "common"
	}
	for _, item := range manualFoodCatalogCategories() {
		if item.Key == category {
			return category
		}
	}
	return "common"
}

func manualFoodCategorySQL(column string) string {
	return fmt.Sprintf(`CASE
		WHEN %s ILIKE ANY (ARRAY['%%清汤%%','%%汤%%','%%羹%%','%%soup%%','%%broth%%']) THEN 'soup'
		WHEN %s ILIKE ANY (ARRAY['%%咖啡%%','%%美式%%','%%拿铁%%','%%奶茶%%','%%茶饮%%','%%绿茶%%','%%红茶%%','%%乌龙茶%%','%%普洱%%','%%茉莉茶%%','%%饮料%%','%%可乐%%','%%果汁%%','%%豆浆%%','%%coffee%%','%%latte%%','%%tea%%','%%drink%%']) THEN 'beverage'
		WHEN %s ILIKE ANY (ARRAY['%%坚果%%','%%薯片%%','%%饼干%%','%%曲奇%%','%%巧克力%%','%%方糖%%','%%糖果%%','%%软糖%%','%%棒棒糖%%','%%糕点%%','%%蛋糕%%','%%零食%%','%%瓜子%%','%%花生%%','%%杏仁%%','%%核桃%%','%%cookie%%','%%snack%%','%%nuts%%']) THEN 'snack'
		WHEN %s ILIKE ANY (ARRAY['%%沙拉%%','%%便当%%','%%套餐%%','%%外卖%%','%%餐%%','%%饭团%%','%%炒饭%%']) THEN 'meal'
		WHEN %s ILIKE ANY (ARRAY['%%米饭%%','%%白米饭%%','%%糙米%%','%%饭%%','%%面条%%','%%荞麦面%%','%%馒头%%','%%包子%%','%%粥%%','%%燕麦%%','%%红薯%%','%%玉米%%','%%土豆%%','%%紫薯%%','%%南瓜%%','%%面包%%','%%吐司%%']) THEN 'staple'
		WHEN %s ILIKE ANY (ARRAY['%%鸡%%','%%牛肉%%','%%猪肉%%','%%红烧肉%%','%%鱼%%','%%虾%%','%%蛋%%','%%豆腐%%','%%蛋白%%','%%鸭%%','%%鹅%%']) THEN 'protein'
		WHEN %s ILIKE ANY (ARRAY['%%菜%%','%%西兰花%%','%%生菜%%','%%菠菜%%','%%番茄%%','%%黄瓜%%','%%白菜%%','%%秋葵%%','%%时蔬%%']) THEN 'vegetable'
		WHEN %s ILIKE ANY (ARRAY['%%苹果%%','%%香蕉%%','%%橙%%','%%梨%%','%%莓%%','%%水果%%','%%西瓜%%','%%草莓%%']) THEN 'fruit'
		WHEN %s ILIKE ANY (ARRAY['%%奶%%','%%酸奶%%','%%牛奶%%','%%奶酪%%','%%芝士%%']) THEN 'dairy'
		ELSE 'other'
	END`, column, column, column, column, column, column, column, column, column)
}

func manualFoodCategoryFilterSQL(column string, category string) string {
	conditions := manualFoodCategoryConditions(column)
	if condition, ok := conditions[category]; ok {
		return condition
	}
	if category == "other" {
		known := make([]string, 0, len(conditions))
		for _, condition := range conditions {
			known = append(known, "("+condition+")")
		}
		sort.Strings(known)
		return "NOT (" + strings.Join(known, " OR ") + ")"
	}
	return "TRUE"
}

func manualFoodCategoryConditions(column string) map[string]string {
	return map[string]string{
		"soup":     ilikeAnySQL(column, []string{"%清汤%", "%汤%", "%羹%", "%soup%", "%broth%"}),
		"beverage": ilikeAnySQL(column, []string{"%咖啡%", "%美式%", "%拿铁%", "%奶茶%", "%茶饮%", "%绿茶%", "%红茶%", "%乌龙茶%", "%普洱%", "%茉莉茶%", "%饮料%", "%可乐%", "%果汁%", "%豆浆%", "%coffee%", "%latte%", "%tea%", "%drink%"}),
		"snack":    ilikeAnySQL(column, []string{"%坚果%", "%薯片%", "%饼干%", "%曲奇%", "%巧克力%", "%方糖%", "%糖果%", "%软糖%", "%棒棒糖%", "%糕点%", "%蛋糕%", "%零食%", "%瓜子%", "%花生%", "%杏仁%", "%核桃%", "%cookie%", "%snack%", "%nuts%"}),
		"meal":     ilikeAnySQL(column, []string{"%沙拉%", "%便当%", "%套餐%", "%外卖%", "%餐%", "%饭团%", "%炒饭%"}),
		"staple":   ilikeAnySQL(column, []string{"%米饭%", "%白米饭%", "%糙米%", "%饭%", "%面条%", "%荞麦面%", "%馒头%", "%包子%", "%粥%", "%燕麦%", "%红薯%", "%玉米%", "%土豆%", "%紫薯%", "%南瓜%", "%面包%", "%吐司%"}),
		"protein":  ilikeAnySQL(column, []string{"%鸡%", "%牛肉%", "%猪肉%", "%红烧肉%", "%鱼%", "%虾%", "%蛋%", "%豆腐%", "%蛋白%", "%鸭%", "%鹅%"}),
		"vegetable": ilikeAnySQL(column, []string{
			"%菜%", "%西兰花%", "%生菜%", "%菠菜%", "%番茄%", "%黄瓜%", "%白菜%", "%秋葵%", "%时蔬%",
		}),
		"fruit": ilikeAnySQL(column, []string{"%苹果%", "%香蕉%", "%橙%", "%梨%", "%莓%", "%水果%", "%西瓜%", "%草莓%"}),
		"dairy": ilikeAnySQL(column, []string{"%奶%", "%酸奶%", "%牛奶%", "%奶酪%", "%芝士%"}),
	}
}

func ilikeAnySQL(column string, patterns []string) string {
	quoted := make([]string, 0, len(patterns))
	for _, pattern := range patterns {
		quoted = append(quoted, "'"+strings.ReplaceAll(pattern, "'", "''")+"'")
	}
	return fmt.Sprintf("%s ILIKE ANY (ARRAY[%s])", column, strings.Join(quoted, ","))
}

func nutritionBrowseOrderSQL() string {
	return `
		CASE
			WHEN canonical_name IN ('米饭','白米饭','糙米饭','馒头','面条','鸡蛋','鸡胸肉','牛奶','豆腐','西兰花','香蕉','苹果','燕麦') THEN 0
			WHEN canonical_name ~ '[一-龥]' THEN 1
			ELSE 4
		END ASC,
		CASE
			WHEN source LIKE '历史%' OR source LIKE 'deepseek%' THEN 0
			WHEN source LIKE 'usda%' THEN 3
			ELSE 1
		END ASC,
		canonical_name ASC
	`
}

func nutritionSearchOrderSQL() string {
	return `
		CASE WHEN f.canonical_name ~ '[一-龥]' THEN 0 ELSE 2 END ASC,
		CASE WHEN f.source LIKE 'usda%' THEN 2 ELSE 0 END ASC,
		f.canonical_name ASC
	`
}

func inferManualFoodCategory(text string, source string) string {
	normalized := strings.ToLower(strings.TrimSpace(text))
	categories := []struct {
		keywords []string
		value    string
	}{
		{[]string{"清汤", "汤", "羹", "soup", "broth"}, "soup"},
		{[]string{"咖啡", "美式", "拿铁", "奶茶", "茶饮", "绿茶", "红茶", "乌龙茶", "普洱", "茉莉茶", "饮料", "可乐", "果汁", "豆浆", "coffee", "latte", "tea", "drink"}, "beverage"},
		{[]string{"坚果", "薯片", "饼干", "曲奇", "巧克力", "方糖", "糖果", "软糖", "棒棒糖", "糕点", "蛋糕", "零食", "瓜子", "花生", "杏仁", "核桃", "cookie", "snack", "nuts"}, "snack"},
		{[]string{"沙拉", "便当", "套餐", "外卖", "餐", "饭团"}, "meal"},
		{[]string{"米饭", "白米饭", "糙米", "饭", "面条", "荞麦面", "馒头", "包子", "粥", "燕麦", "红薯", "玉米", "土豆", "紫薯", "南瓜", "面包", "吐司", "rice", "noodle", "bread", "oat"}, "staple"},
		{[]string{"鸡", "牛肉", "猪肉", "红烧肉", "鱼", "虾", "蛋", "豆腐", "protein", "chicken", "beef", "egg", "tofu", "fish"}, "protein"},
		{[]string{"菜", "西兰花", "生菜", "菠菜", "番茄", "蔬", "时蔬", "broccoli", "tomato", "vegetable"}, "vegetable"},
		{[]string{"苹果", "香蕉", "橙", "梨", "莓", "水果", "apple", "banana", "berry", "fruit"}, "fruit"},
		{[]string{"奶", "酸奶", "牛奶", "奶酪", "芝士", "cheese", "milk", "yogurt"}, "dairy"},
	}
	for _, category := range categories {
		for _, keyword := range category.keywords {
			if strings.Contains(normalized, strings.ToLower(keyword)) {
				return category.value
			}
		}
	}
	if source == "public_library" {
		return "meal"
	}
	return "other"
}

func applyManualFoodServingProfile(item *domain.ManualFoodResult) {
	if item == nil {
		return
	}
	if item.Source == "public_library" {
		item.DisplayUnit = "serving"
		item.DisplayUnitLabel = "份"
		if strings.TrimSpace(item.PortionLabel) == "" {
			item.PortionLabel = "1份"
		}
		if item.DefaultWeightGrams <= 0 {
			item.DefaultWeightGrams = 1
		}
		item.ServingPresets = servingPresets(item.DefaultWeightGrams, "份", []float64{0.5, 1, 1.5, 2})
		return
	}
	if item.Source == "packaged_food" {
		if strings.Contains(strings.ToLower(strings.TrimSpace(item.Subtitle+" "+item.Category)), "100ml") || item.Category == "beverage" {
			item.DisplayUnit = "ml"
			item.DisplayUnitLabel = "ml"
		} else {
			item.DisplayUnit = "g"
			item.DisplayUnitLabel = "g"
		}
		if item.DefaultWeightGrams <= 0 {
			item.DefaultWeightGrams = 100
		}
		if strings.TrimSpace(item.PortionLabel) == "" {
			item.PortionLabel = fmt.Sprintf("%.0f%s", item.DefaultWeightGrams, item.DisplayUnitLabel)
		}
		return
	}
	title := strings.TrimSpace(item.Title)
	switch {
	case isEggLikeFood(title):
		applyPer100Default(item, 55)
		item.DisplayUnit = "piece"
		item.DisplayUnitLabel = "个"
		item.PortionLabel = "1个"
		item.ServingPresets = []domain.ManualFoodServingPreset{
			{Label: "0.5个", Grams: 27.5, Quantity: 0.5},
			{Label: "1个", Grams: 55, Quantity: 1},
			{Label: "2个", Grams: 110, Quantity: 2},
		}
	case isBeverageLikeFood(title):
		defaultWeight := 350.0
		if strings.Contains(strings.ToLower(title), "清汤") || strings.Contains(title, "汤") {
			defaultWeight = 250
		}
		applyPer100Default(item, defaultWeight)
		item.DisplayUnit = "ml"
		item.DisplayUnitLabel = "ml"
		item.PortionLabel = fmt.Sprintf("%.0fml", defaultWeight)
		item.ServingPresets = beverageServingPresets(title)
	default:
		item.DisplayUnit = "g"
		item.DisplayUnitLabel = "g"
		if strings.TrimSpace(item.PortionLabel) == "" {
			item.PortionLabel = fmt.Sprintf("%.0fg", item.DefaultWeightGrams)
		}
	}
}

func applyPer100Default(item *domain.ManualFoodResult, defaultWeight float64) {
	if item == nil || defaultWeight <= 0 {
		return
	}
	if item.NutrientsPer100g != nil {
		scale := defaultWeight / 100
		item.TotalCalories = item.NutrientsPer100g.Calories * scale
		item.TotalProtein = item.NutrientsPer100g.Protein * scale
		item.TotalCarbs = item.NutrientsPer100g.Carbs * scale
		item.TotalFat = item.NutrientsPer100g.Fat * scale
		if item.ExtraNutrients == nil {
			item.ExtraNutrients = &domain.ManualFoodNutrients{}
		}
		item.ExtraNutrients.Fiber = item.NutrientsPer100g.Fiber * scale
		item.ExtraNutrients.Sugar = item.NutrientsPer100g.Sugar * scale
		item.ExtraNutrients.SodiumMg = item.NutrientsPer100g.SodiumMg * scale
	}
	item.DefaultWeightGrams = defaultWeight
}

func servingPresets(base float64, unit string, quantities []float64) []domain.ManualFoodServingPreset {
	if base <= 0 {
		return nil
	}
	out := make([]domain.ManualFoodServingPreset, 0, len(quantities))
	for _, quantity := range quantities {
		out = append(out, domain.ManualFoodServingPreset{
			Label:    fmt.Sprintf("%g%s", quantity, unit),
			Grams:    base * quantity,
			Quantity: quantity,
		})
	}
	return out
}

func beverageServingPresets(title string) []domain.ManualFoodServingPreset {
	lower := strings.ToLower(strings.TrimSpace(title))
	if strings.Contains(lower, "coffee") || strings.Contains(title, "咖啡") || strings.Contains(title, "拿铁") || strings.Contains(title, "美式") {
		return []domain.ManualFoodServingPreset{
			{Label: "350ml", Grams: 350, Quantity: 350},
			{Label: "450ml", Grams: 450, Quantity: 450},
			{Label: "590ml", Grams: 590, Quantity: 590},
		}
	}
	return []domain.ManualFoodServingPreset{
		{Label: "250ml", Grams: 250, Quantity: 250},
		{Label: "350ml", Grams: 350, Quantity: 350},
		{Label: "500ml", Grams: 500, Quantity: 500},
	}
}

func isEggLikeFood(title string) bool {
	normalized := strings.ToLower(strings.TrimSpace(title))
	return strings.Contains(normalized, "egg") || strings.Contains(title, "鸡蛋") || strings.Contains(title, "水煮蛋") || strings.Contains(title, "卤蛋") || strings.Contains(title, "煎蛋")
}

func isBeverageLikeFood(title string) bool {
	lower := strings.ToLower(strings.TrimSpace(title))
	keywords := []string{"咖啡", "美式", "拿铁", "奶茶", "茶饮", "绿茶", "红茶", "乌龙茶", "普洱", "茉莉茶", "饮料", "可乐", "果汁", "豆浆", "清汤", "汤", "coffee", "latte", "tea", "drink", "soup", "broth"}
	for _, keyword := range keywords {
		if strings.Contains(lower, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

func containsCJK(value string) bool {
	for _, r := range value {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func numberFromAny(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case json.Number:
		n, _ := v.Float64()
		return n
	case string:
		var out float64
		_, _ = fmt.Sscanf(strings.TrimSpace(v), "%f", &out)
		return out
	default:
		return 0
	}
}

func packagedCatalogOffset(category string, page int, pageSize int, userItemCount int) int {
	if page <= 1 || !manualFoodCategoryCanIncludePackaged(category) {
		return 0
	}
	return maxInt(0, (page-1)*pageSize-userItemCount)
}

func manualFoodCategoryCanIncludePackaged(category string) bool {
	switch category {
	case "snack", "beverage", "dairy", "staple", "other":
		return true
	default:
		return false
	}
}

func packagedMatchesManualCategory(result domain.ManualFoodResult, item fooddomain.PackagedFood, category string) bool {
	switch category {
	case "", "all", "snack":
		return true
	case "other":
		return result.Category == "other"
	default:
		if result.Category == category {
			return true
		}
		text := strings.TrimSpace(result.Title + " " + result.Subtitle + " " + stringPtrValue(item.PackageCategory))
		return inferManualFoodCategory(text, "packaged_food") == category
	}
}

func packagedDefaultWeight(item fooddomain.PackagedFood) float64 {
	if item.ServingWeightG > 0 {
		return item.ServingWeightG
	}
	if netContent := packagedNetContentWeight(item); netContent > 0 && netContent <= 500 {
		return netContent
	}
	if item.NetWeightG > 0 && item.NetWeightG <= 500 {
		return item.NetWeightG
	}
	return 100
}

func packagedPortionLabel(item fooddomain.PackagedFood) string {
	unit := "g"
	if strings.Contains(strings.ToLower(stringPtrValue(item.NutritionBasisUnit)), "100ml") {
		unit = "ml"
	}
	if item.ServingWeightG > 0 {
		return fmt.Sprintf("%.0f%s", item.ServingWeightG, unit)
	}
	if label := packagedNetContentLabel(item); label != "" {
		return label
	}
	if item.NetWeightG > 0 && item.NetWeightG <= 500 {
		return fmt.Sprintf("%.0f%s", item.NetWeightG, unit)
	}
	return "100" + unit
}

func packagedDisplayName(item fooddomain.PackagedFood) string {
	if displayName := strings.TrimSpace(item.DisplayName); displayName != "" {
		return displayName
	}
	titleParts := []string{strings.TrimSpace(item.Brand), strings.TrimSpace(item.ProductName)}
	if flavor := stringPtrValue(item.FlavorText); flavor != "" && !strings.Contains(normalizeManualText(item.ProductName), normalizeManualText(flavor)) {
		titleParts = append(titleParts, flavor)
	}
	if label := packagedNetContentLabel(item); label != "" {
		titleParts = append(titleParts, label)
	} else if spec := stringPtrValue(item.SpecText); spec != "" {
		titleParts = append(titleParts, spec)
	}
	out := make([]string, 0, len(titleParts))
	for _, part := range titleParts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return strings.Join(out, " ")
}

func packagedNetContentLabel(item fooddomain.PackagedFood) string {
	if item.NetContentValue > 0 {
		unit := strings.TrimSpace(stringPtrValue(item.NetContentUnit))
		if unit == "" && item.NetWeightG > 0 {
			unit = "g"
		}
		if unit != "" {
			return formatManualCompactNumber(item.NetContentValue) + unit
		}
	}
	if item.NetWeightG > 0 {
		return formatManualCompactNumber(item.NetWeightG) + "g"
	}
	return ""
}

func packagedNetContentWeight(item fooddomain.PackagedFood) float64 {
	if item.NetWeightG > 0 {
		return item.NetWeightG
	}
	unit := strings.ToLower(strings.TrimSpace(stringPtrValue(item.NetContentUnit)))
	if item.NetContentValue > 0 && (unit == "g" || unit == "ml") {
		return item.NetContentValue
	}
	return 0
}

func formatManualCompactNumber(value float64) string {
	if value <= 0 {
		return "0"
	}
	if math.Abs(value-math.Round(value)) < 0.005 {
		return fmt.Sprintf("%.0f", math.Round(value))
	}
	return strconv.FormatFloat(math.Round(value*100)/100, 'f', -1, 64)
}

func normalizeManualText(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func packagedPrimaryImage(urls []string) (*string, []string) {
	for _, raw := range urls {
		url := strings.TrimSpace(raw)
		if url == "" {
			continue
		}
		return &url, []string{url}
	}
	return nil, nil
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
