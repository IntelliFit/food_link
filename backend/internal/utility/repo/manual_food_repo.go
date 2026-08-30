package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	fooddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	publicdomain "food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/utility/domain"
	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ManualFoodRepo struct {
	db      *gorm.DB
	storage *storage.Client
}

const nutritionExactQualitySQL = "quality_tier IN ('authoritative','reviewed_estimate','legacy_curated')"

type CustomFoodInput struct {
	ID                 string
	Title              string
	DefaultWeightGrams float64
	TotalCalories      float64
	TotalProtein       float64
	TotalCarbs         float64
	TotalFat           float64
	NutrientsPer100g   map[string]any
	ExtraNutrients     map[string]any
	ImagePath          *string
	ImagePaths         []string
	PortionLabel       string
	RecommendReason    string
	ShareToPublic      bool
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

	result.RecentItems = r.enrichManualFoodResultsWithNutritionLibrary(ctx, result.RecentItems)
	result.NutritionLibrary = r.enrichManualFoodResultsWithNutritionLibrary(ctx, result.NutritionLibrary)
	return result, nil
}

func (r *ManualFoodRepo) SaveCustomFood(ctx context.Context, userID string, input CustomFoodInput) (domain.ManualFoodResult, error) {
	userID = strings.TrimSpace(userID)
	title := strings.TrimSpace(input.Title)
	if userID == "" {
		return domain.ManualFoodResult{}, fmt.Errorf("user id is required")
	}
	if title == "" {
		return domain.ManualFoodResult{}, fmt.Errorf("title is required")
	}
	normalizedTitle := normalizeCustomFoodTitle(title)
	id := strings.TrimSpace(input.ID)
	if _, err := uuid.Parse(id); err != nil {
		id = uuid.New().String()
	}
	defaultWeight := input.DefaultWeightGrams
	if defaultWeight <= 0 {
		defaultWeight = 100
	}
	nutrientsPer100g := normalizeNutrientMap(input.NutrientsPer100g)
	if len(nutrientsPer100g) == 0 {
		nutrientsPer100g = map[string]any{
			"calories": input.TotalCalories,
			"protein":  input.TotalProtein,
			"carbs":    input.TotalCarbs,
			"fat":      input.TotalFat,
			"fiber":    0,
			"sugar":    0,
		}
	}
	extraNutrients := normalizeNutrientMap(input.ExtraNutrients)
	if len(extraNutrients) == 0 {
		extraNutrients = nutrientsPer100g
	}
	imagePaths := compactStrings(input.ImagePaths)
	if len(imagePaths) == 0 && input.ImagePath != nil && strings.TrimSpace(*input.ImagePath) != "" {
		imagePaths = []string{strings.TrimSpace(*input.ImagePath)}
	}
	var imagePath *string
	if len(imagePaths) > 0 {
		first := imagePaths[0]
		imagePath = &first
	}
	publicStatus := "private"
	if input.ShareToPublic {
		publicStatus = "pending"
	}
	now := time.Now()
	row := domain.UserCustomFood{
		ID:                 id,
		UserID:             userID,
		Title:              title,
		NormalizedTitle:    normalizedTitle,
		Category:           "custom",
		DefaultWeightGrams: defaultWeight,
		TotalCalories:      input.TotalCalories,
		TotalProtein:       input.TotalProtein,
		TotalCarbs:         input.TotalCarbs,
		TotalFat:           input.TotalFat,
		NutrientsPer100g:   nutrientsPer100g,
		ExtraNutrients:     extraNutrients,
		ImagePath:          imagePath,
		ImagePaths:         imagePaths,
		PortionLabel:       strings.TrimSpace(input.PortionLabel),
		RecommendReason:    strings.TrimSpace(input.RecommendReason),
		PublicStatus:       publicStatus,
		Status:             "active",
		CreatedAt:          &now,
		UpdatedAt:          &now,
	}
	if row.PortionLabel == "" {
		row.PortionLabel = fmt.Sprintf("%sg", formatManualCompactNumber(defaultWeight))
	}
	if err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "normalized_title"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"title",
			"category",
			"default_weight_grams",
			"total_calories",
			"total_protein",
			"total_carbs",
			"total_fat",
			"nutrients_per_100g",
			"extra_nutrients",
			"image_path",
			"image_paths",
			"portion_label",
			"recommend_reason",
			"public_status",
			"status",
			"updated_at",
		}),
	}).Create(&row).Error; err != nil {
		return domain.ManualFoodResult{}, err
	}
	var saved domain.UserCustomFood
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND normalized_title = ? AND status <> ?", userID, normalizedTitle, "deleted").
		First(&saved).Error; err != nil {
		return domain.ManualFoodResult{}, err
	}
	return r.manualFoodResultFromCustomFood(saved), nil
}

func (r *ManualFoodRepo) ListCustomFoods(ctx context.Context, userID string, limit int, offset int) ([]domain.ManualFoodResult, bool, error) {
	if strings.TrimSpace(userID) == "" {
		return []domain.ManualFoodResult{}, false, nil
	}
	limit = clampLimit(limit, 30, 120)
	if offset < 0 {
		offset = 0
	}
	var rows []domain.UserCustomFood
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND status <> ?", userID, "deleted").
		Order("updated_at desc NULLS LAST, created_at desc NULLS LAST").
		Limit(limit + 1).
		Offset(offset).
		Find(&rows).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return []domain.ManualFoodResult{}, false, nil
		}
		return nil, false, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		results = append(results, r.manualFoodResultFromCustomFood(row))
	}
	return results, hasMore, nil
}

func (r *ManualFoodRepo) searchCustomFoods(ctx context.Context, userID string, query string, limit int) ([]domain.ManualFoodResult, error) {
	if strings.TrimSpace(userID) == "" {
		return []domain.ManualFoodResult{}, nil
	}
	var rows []domain.UserCustomFood
	like := "%" + strings.ToLower(strings.TrimSpace(query)) + "%"
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND status <> ? AND LOWER(title) LIKE ?", userID, "deleted", like).
		Order("updated_at desc NULLS LAST, created_at desc NULLS LAST").
		Limit(limit).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		result := r.manualFoodResultFromCustomFood(row)
		result.MatchScore = computeMatchScore(query, result.Title)
		results = append(results, result)
	}
	return results, nil
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
	items = r.enrichManualFoodResultsWithNutritionLibrary(ctx, items)
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
	customRows, err := r.searchCustomFoods(ctx, userID, query, limit)
	if err != nil {
		return nil, err
	}
	results = append(results, customRows...)

	catalogRows, err := r.searchCatalogItems(ctx, userID, query, limit)
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
	results = r.enrichManualFoodResultsWithNutritionLibrary(ctx, results)
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
	if category == "custom" {
		return r.ListCustomFoods(ctx, userID, pageSize, offset)
	}
	if category == "campus" {
		items, err := r.listCampusCatalogItems(ctx, pageSize+1, offset)
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
		if isPhysicallyImplausibleFrequentFood(row.AvgWeight, row.AvgCal, row.AvgProtein, row.AvgCarbs, row.AvgFat) {
			continue
		}
		item := manualFoodResultFromFrequentRecord(row.Name, row.Uses, row.AvgWeight, row.AvgCal, row.AvgProtein, row.AvgCarbs, row.AvgFat, row.ItemJSON)
		if item.Title != "" {
			results = append(results, item)
		}
	}
	return results, nil
}

func (r *ManualFoodRepo) searchCatalogItems(ctx context.Context, userID string, query string, limit int) ([]domain.ManualFoodResult, error) {
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
	recordFilter := ""
	args := []any{}
	if strings.TrimSpace(userID) != "" {
		recordFilter = "AND user_id = ?"
		args = append(args, strings.TrimSpace(userID))
	}
	conditions := make([]string, 0, len(terms))
	for _, term := range terms {
		conditions = append(conditions, "LOWER(name) LIKE ?")
		args = append(args, "%"+strings.ToLower(term)+"%")
	}
	args = append(args, query, query+"%", limit)
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
				%s
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
	`, recordFilter, strings.Join(conditions, " OR ")), args...).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		if isPhysicallyImplausibleFrequentFood(row.AvgWeight, row.AvgCal, row.AvgProtein, row.AvgCarbs, row.AvgFat) {
			continue
		}
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
			AND %s
			AND canonical_name ~ '[一-龥]'
			%s
		ORDER BY %s
		LIMIT ? OFFSET ?
	`, nutritionExactQualitySQL, whereCategory, nutritionBrowseOrderSQL()), args...).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		results = append(results, r.manualFoodResultFromNutrition(row, 0))
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
		Where("is_active = ? AND kcal_per_100g > 0 AND COALESCE(NULLIF(review_status, ''), 'active') = ?", true, "active").
		Order("updated_at DESC NULLS LAST, product_name ASC").
		Limit(minInt(limit, 60)).
		Offset(offset).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		result := r.manualFoodResultFromPackaged(row, 0.72)
		if packagedMatchesManualCategory(result, row, category) {
			results = append(results, result)
		}
	}
	return results, nil
}

func (r *ManualFoodRepo) loadStats(ctx context.Context) (*domain.ManualFoodBrowseStats, error) {
	stats := &domain.ManualFoodBrowseStats{}
	if err := r.db.WithContext(ctx).Model(&fooddomain.FoodNutrition{}).Where("is_active = ? AND "+nutritionExactQualitySQL, true).Count(&stats.NutritionFoodCount).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&fooddomain.FoodNutritionAlias{}).Where("match_status = ?", fooddomain.NutritionAliasApprovedExact).Count(&stats.NutritionAliasCount).Error; err != nil {
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
			AND item->>'manual_source' IN ('public_library', 'nutrition_library', 'packaged_food', 'custom')
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
	return r.refreshRecentPackagedFoods(ctx, results)
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

func (r *ManualFoodRepo) listCampusCatalogItems(ctx context.Context, limit int, offset int) ([]domain.ManualFoodResult, error) {
	var rows []publicdomain.PublicFoodItem
	err := r.db.WithContext(ctx).
		Where("status = ? AND is_campus_food = ? AND total_calories > 0", "published", true).
		Order("collection_count DESC, like_count DESC, published_at DESC NULLS LAST, created_at DESC").
		Limit(limit).
		Offset(offset).
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
		Where("is_active = ? AND kcal_per_100g > 0 AND "+nutritionExactQualitySQL, true).
		Order(nutritionBrowseOrderSQL()).
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	results := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		results = append(results, r.manualFoodResultFromNutrition(row, 0))
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
			AND item->>'manual_source' IN ('public_library', 'nutrition_library', 'packaged_food', 'custom')
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
	return r.refreshRecentPackagedFoods(ctx, results)
}

// refreshRecentPackagedFoods prevents historical record snapshots from
// overriding a corrected packaged-food row. A legacy record may contain a
// suggested 25g portion or per-100g values in total fields; recent/search
// results must always use the current active package evidence instead.
func (r *ManualFoodRepo) refreshRecentPackagedFoods(ctx context.Context, results []domain.ManualFoodResult) ([]domain.ManualFoodResult, error) {
	ids := make([]string, 0)
	seen := map[string]bool{}
	for _, result := range results {
		id := strings.TrimSpace(result.ID)
		if result.Source != "packaged_food" || id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return results, nil
	}
	var rows []fooddomain.PackagedFood
	if err := r.db.WithContext(ctx).
		Where("id IN ? AND is_active = TRUE AND kcal_per_100g > 0 AND COALESCE(NULLIF(review_status, ''), 'active') = ?", ids, "active").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	byID := make(map[string]fooddomain.PackagedFood, len(rows))
	for _, row := range rows {
		byID[strings.TrimSpace(row.ID)] = row
	}
	refreshed := make([]domain.ManualFoodResult, 0, len(results))
	for _, result := range results {
		if result.Source != "packaged_food" {
			refreshed = append(refreshed, result)
			continue
		}
		row, ok := byID[strings.TrimSpace(result.ID)]
		if !ok {
			// Inactive or needs-review package rows must not re-enter search
			// through a user's historical record snapshot.
			continue
		}
		current := r.manualFoodResultFromPackaged(row, result.MatchScore)
		current.UsageCount = result.UsageCount
		current.Collected = result.Collected
		refreshed = append(refreshed, current)
	}
	return refreshed, nil
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
			AND COALESCE(NULLIF(review_status, ''), 'active') = 'active'
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
		results = append(results, r.manualFoodResultFromPackaged(row, score))
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
		LEFT JOIN food_nutrition_aliases a ON a.food_id = f.id AND a.match_status = 'approved_exact'
		WHERE f.is_active = TRUE
			AND f.kcal_per_100g > 0
			AND f.quality_tier IN ('authoritative','reviewed_estimate','legacy_curated')
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
		results = append(results, r.manualFoodResultFromNutrition(row.FoodNutrition, score))
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
	if item.IsCampusFood {
		if loc := strings.TrimSpace(item.CampusLocationText); loc != "" {
			subtitleParts = append(subtitleParts, loc)
		}
	} else {
		if merchant := strings.TrimSpace(item.MerchantName); merchant != "" {
			subtitleParts = append(subtitleParts, merchant)
		}
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
	sourceLabel := "真实餐食"
	recommendReason := "整份复用更快，适合商家餐和外卖"
	if item.IsCampusFood {
		sourceLabel = "校园食堂"
		recommendReason = "校园真实菜品，热量价格一目了然"
		if item.Price > 0 {
			highlights = append([]string{fmtPriceDisplay(item.Price, item.PriceType, item.PriceUnit)}, highlights...)
		}
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
		SourceLabel:         sourceLabel,
		RecommendReason:     recommendReason,
		NutritionHighlights: highlights,
		Collected:           collected,
		LikeCount:           item.LikeCount,
		CollectionCount:     item.CollectionCount,
	}

	// 公共食物库条目本身来自真实记录，items 里保存了每份食物的完整营养素，
	// 把它汇总后映射到 nutrients_per_100g / extra_nutrients，这样手动记录时微量元素不会丢失。
	totalIntake := 0.0
	totalNutrients := domain.ManualFoodNutrients{}
	for _, it := range item.Items {
		if it == nil {
			continue
		}
		intake := numberFromAny(it["intake"])
		if intake <= 0 {
			intake = numberFromAny(it["weight"])
		}
		if intake <= 0 {
			continue
		}
		totalIntake += intake
		nutrients := manualFoodNutrientsFromAny(it["nutrients"])
		totalNutrients = sumManualFoodNutrients(totalNutrients, nutrients)
	}
	if totalIntake > 0 {
		per100Scale := 100 / totalIntake
		nutrientsPer100g := scaleManualFoodNutrients(totalNutrients, per100Scale)
		result.NutrientsPer100g = &nutrientsPer100g
		result.ExtraNutrients = &totalNutrients
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
	defaultWeight := packagedDefaultWeight(item)
	per100g := domain.ManualFoodNutrients{
		Calories:       item.KcalPer100g,
		Protein:        item.ProteinPer100g,
		Carbs:          item.CarbsPer100g,
		Fat:            item.FatPer100g,
		Fiber:          item.FiberPer100g,
		Sugar:          item.SugarPer100g,
		SaturatedFat:   item.SaturatedFatPer100g,
		CholesterolMg:  item.CholesterolMgPer100g,
		SodiumMg:       item.SodiumMgPer100g,
		PotassiumMg:    item.PotassiumMgPer100g,
		CalciumMg:      item.CalciumMgPer100g,
		IronMg:         item.IronMgPer100g,
		MagnesiumMg:    item.MagnesiumMgPer100g,
		ZincMg:         item.ZincMgPer100g,
		VitaminARaeMcg: item.VitaminARaeMcgPer100g,
		VitaminCMg:     item.VitaminCMgPer100g,
		VitaminDMcg:    item.VitaminDMcgPer100g,
		VitaminEMg:     item.VitaminEMgPer100g,
		VitaminKMcg:    item.VitaminKMcgPer100g,
		ThiaminMg:      item.ThiaminMgPer100g,
		RiboflavinMg:   item.RiboflavinMgPer100g,
		NiacinMg:       item.NiacinMgPer100g,
		VitaminB6Mg:    item.VitaminB6MgPer100g,
		FolateMcg:      item.FolateMcgPer100g,
		VitaminB12Mcg:  item.VitaminB12McgPer100g,
	}
	// NutrientsPer100g 保持每100克口径不变；ExtraNutrients 和 Total* 需要缩放到 defaultWeight 份量，
	// 这样前端列表显示和后续按份缩放时，宏量、微量营养素口径一致。
	scaled := scaleManualFoodNutrients(per100g, defaultWeight/100.0)
	result := domain.ManualFoodResult{
		ID:                  item.ID,
		Source:              "packaged_food",
		Title:               title,
		Subtitle:            subtitle,
		Category:            inferManualFoodCategory(title+" "+subtitle+" "+stringPtrValue(item.PackageCategory), "packaged_food"),
		DefaultWeightGrams:  defaultWeight,
		TotalCalories:       scaled.Calories,
		TotalProtein:        scaled.Protein,
		TotalCarbs:          scaled.Carbs,
		TotalFat:            scaled.Fat,
		NutrientsPer100g:    &per100g,
		ExtraNutrients:      &scaled,
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

func (r *ManualFoodRepo) manualFoodResultFromPackaged(item fooddomain.PackagedFood, score float64) domain.ManualFoodResult {
	result := manualFoodResultFromPackaged(item, score)
	if r.storage != nil {
		result.ImagePaths = r.storage.ResolveReferenceURLs("food-images", result.ImagePaths)
		if result.ImagePath != nil {
			resolved := r.storage.ResolveReferenceURL("food-images", *result.ImagePath)
			if strings.TrimSpace(resolved) == "" {
				result.ImagePath = nil
			} else {
				result.ImagePath = &resolved
			}
		}
	}
	if result.ImagePath == nil && len(result.ImagePaths) > 0 {
		first := result.ImagePaths[0]
		result.ImagePath = &first
	}
	if len(result.ImagePaths) == 0 && result.ImagePath != nil {
		result.ImagePaths = []string{*result.ImagePath}
	}
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
			Calories:       item.KcalPer100g,
			Protein:        item.ProteinPer100g,
			Carbs:          item.CarbsPer100g,
			Fat:            item.FatPer100g,
			Fiber:          item.FiberPer100g,
			Sugar:          item.SugarPer100g,
			SaturatedFat:   item.SaturatedFatPer100g,
			CholesterolMg:  item.CholesterolMgPer100g,
			SodiumMg:       item.SodiumMgPer100g,
			PotassiumMg:    item.PotassiumMgPer100g,
			CalciumMg:      item.CalciumMgPer100g,
			IronMg:         item.IronMgPer100g,
			MagnesiumMg:    item.MagnesiumMgPer100g,
			ZincMg:         item.ZincMgPer100g,
			VitaminARaeMcg: item.VitaminARaeMcgPer100g,
			VitaminCMg:     item.VitaminCMgPer100g,
			VitaminDMcg:    item.VitaminDMcgPer100g,
			VitaminEMg:     item.VitaminEMgPer100g,
			VitaminKMcg:    item.VitaminKMcgPer100g,
			ThiaminMg:      item.ThiaminMgPer100g,
			RiboflavinMg:   item.RiboflavinMgPer100g,
			NiacinMg:       item.NiacinMgPer100g,
			VitaminB6Mg:    item.VitaminB6MgPer100g,
			FolateMcg:      item.FolateMcgPer100g,
			VitaminB12Mcg:  item.VitaminB12McgPer100g,
		},
		ExtraNutrients: &domain.ManualFoodNutrients{
			Fiber:          item.FiberPer100g,
			Sugar:          item.SugarPer100g,
			SaturatedFat:   item.SaturatedFatPer100g,
			CholesterolMg:  item.CholesterolMgPer100g,
			SodiumMg:       item.SodiumMgPer100g,
			PotassiumMg:    item.PotassiumMgPer100g,
			CalciumMg:      item.CalciumMgPer100g,
			IronMg:         item.IronMgPer100g,
			MagnesiumMg:    item.MagnesiumMgPer100g,
			ZincMg:         item.ZincMgPer100g,
			VitaminARaeMcg: item.VitaminARaeMcgPer100g,
			VitaminCMg:     item.VitaminCMgPer100g,
			VitaminDMcg:    item.VitaminDMcgPer100g,
			VitaminEMg:     item.VitaminEMgPer100g,
			VitaminKMcg:    item.VitaminKMcgPer100g,
			ThiaminMg:      item.ThiaminMgPer100g,
			RiboflavinMg:   item.RiboflavinMgPer100g,
			NiacinMg:       item.NiacinMgPer100g,
			VitaminB6Mg:    item.VitaminB6MgPer100g,
			FolateMcg:      item.FolateMcgPer100g,
			VitaminB12Mcg:  item.VitaminB12McgPer100g,
		},
		ImagePath:           item.ImagePath,
		ImagePaths:          item.ImagePaths,
		PortionLabel:        "100g",
		SourceLabel:         "标准食物",
		RecommendReason:     "按克重精调，适合单食材和自制餐",
		NutritionHighlights: highlights,
		MatchScore:          score,
	}
	applyManualFoodServingProfile(&result)
	return result
}

func (r *ManualFoodRepo) manualFoodResultFromNutrition(item fooddomain.FoodNutrition, score float64) domain.ManualFoodResult {
	result := manualFoodResultFromNutrition(item, score)
	if r.storage != nil {
		result.ImagePaths = r.storage.ResolveReferenceURLs("food-images", result.ImagePaths)
		if result.ImagePath != nil {
			resolved := r.storage.ResolveReferenceURL("food-images", *result.ImagePath)
			if strings.TrimSpace(resolved) == "" {
				result.ImagePath = nil
			} else {
				result.ImagePath = &resolved
			}
		}
	}
	if result.ImagePath == nil && len(result.ImagePaths) > 0 {
		first := result.ImagePaths[0]
		result.ImagePath = &first
	}
	if len(result.ImagePaths) == 0 && result.ImagePath != nil {
		result.ImagePaths = []string{*result.ImagePath}
	}
	return result
}

func manualFoodResultFromRecordItem(source, sourceID, sourceTitle, portionLabel string, usageCount int, raw json.RawMessage) domain.ManualFoodResult {
	type nutrientPayload struct {
		Calories       float64 `json:"calories"`
		Protein        float64 `json:"protein"`
		Carbs          float64 `json:"carbs"`
		Fat            float64 `json:"fat"`
		Fiber          float64 `json:"fiber"`
		Sugar          float64 `json:"sugar"`
		SaturatedFat   float64 `json:"saturatedFat"`
		CholesterolMg  float64 `json:"cholesterolMg"`
		SodiumMg       float64 `json:"sodiumMg"`
		PotassiumMg    float64 `json:"potassiumMg"`
		CalciumMg      float64 `json:"calciumMg"`
		IronMg         float64 `json:"ironMg"`
		MagnesiumMg    float64 `json:"magnesiumMg"`
		ZincMg         float64 `json:"zincMg"`
		VitaminARaeMcg float64 `json:"vitaminARaeMcg"`
		VitaminCMg     float64 `json:"vitaminCMg"`
		VitaminDMcg    float64 `json:"vitaminDMcg"`
		VitaminEMg     float64 `json:"vitaminEMg"`
		VitaminKMcg    float64 `json:"vitaminKMcg"`
		ThiaminMg      float64 `json:"thiaminMg"`
		RiboflavinMg   float64 `json:"riboflavinMg"`
		NiacinMg       float64 `json:"niacinMg"`
		VitaminB6Mg    float64 `json:"vitaminB6Mg"`
		FolateMcg      float64 `json:"folateMcg"`
		VitaminB12Mcg  float64 `json:"vitaminB12Mcg"`
	}
	type recordItem struct {
		Name       string          `json:"name"`
		Weight     float64         `json:"weight"`
		Intake     float64         `json:"intake"`
		ImagePath  *string         `json:"image_path"`
		ImagePaths []string        `json:"image_paths"`
		Nutrients  nutrientPayload `json:"nutrients"`
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
		ImagePath:          item.ImagePath,
		ImagePaths:         item.ImagePaths,
		ExtraNutrients: &domain.ManualFoodNutrients{
			Fiber:          item.Nutrients.Fiber,
			Sugar:          item.Nutrients.Sugar,
			SaturatedFat:   item.Nutrients.SaturatedFat,
			CholesterolMg:  item.Nutrients.CholesterolMg,
			SodiumMg:       item.Nutrients.SodiumMg,
			PotassiumMg:    item.Nutrients.PotassiumMg,
			CalciumMg:      item.Nutrients.CalciumMg,
			IronMg:         item.Nutrients.IronMg,
			MagnesiumMg:    item.Nutrients.MagnesiumMg,
			ZincMg:         item.Nutrients.ZincMg,
			VitaminARaeMcg: item.Nutrients.VitaminARaeMcg,
			VitaminCMg:     item.Nutrients.VitaminCMg,
			VitaminDMcg:    item.Nutrients.VitaminDMcg,
			VitaminEMg:     item.Nutrients.VitaminEMg,
			VitaminKMcg:    item.Nutrients.VitaminKMcg,
			ThiaminMg:      item.Nutrients.ThiaminMg,
			RiboflavinMg:   item.Nutrients.RiboflavinMg,
			NiacinMg:       item.Nutrients.NiacinMg,
			VitaminB6Mg:    item.Nutrients.VitaminB6Mg,
			FolateMcg:      item.Nutrients.FolateMcg,
			VitaminB12Mcg:  item.Nutrients.VitaminB12Mcg,
		},
	}
	if result.ImagePath == nil && len(result.ImagePaths) > 0 {
		first := result.ImagePaths[0]
		result.ImagePath = &first
	}
	if len(result.ImagePaths) == 0 && result.ImagePath != nil {
		result.ImagePaths = []string{*result.ImagePath}
	}
	if result.DefaultWeightGrams > 0 {
		scale := 100 / result.DefaultWeightGrams
		result.NutrientsPer100g = &domain.ManualFoodNutrients{
			Calories:       result.TotalCalories * scale,
			Protein:        result.TotalProtein * scale,
			Carbs:          result.TotalCarbs * scale,
			Fat:            result.TotalFat * scale,
			Fiber:          item.Nutrients.Fiber * scale,
			Sugar:          item.Nutrients.Sugar * scale,
			SaturatedFat:   item.Nutrients.SaturatedFat * scale,
			CholesterolMg:  item.Nutrients.CholesterolMg * scale,
			SodiumMg:       item.Nutrients.SodiumMg * scale,
			PotassiumMg:    item.Nutrients.PotassiumMg * scale,
			CalciumMg:      item.Nutrients.CalciumMg * scale,
			IronMg:         item.Nutrients.IronMg * scale,
			MagnesiumMg:    item.Nutrients.MagnesiumMg * scale,
			ZincMg:         item.Nutrients.ZincMg * scale,
			VitaminARaeMcg: item.Nutrients.VitaminARaeMcg * scale,
			VitaminCMg:     item.Nutrients.VitaminCMg * scale,
			VitaminDMcg:    item.Nutrients.VitaminDMcg * scale,
			VitaminEMg:     item.Nutrients.VitaminEMg * scale,
			VitaminKMcg:    item.Nutrients.VitaminKMcg * scale,
			ThiaminMg:      item.Nutrients.ThiaminMg * scale,
			RiboflavinMg:   item.Nutrients.RiboflavinMg * scale,
			NiacinMg:       item.Nutrients.NiacinMg * scale,
			VitaminB6Mg:    item.Nutrients.VitaminB6Mg * scale,
			FolateMcg:      item.Nutrients.FolateMcg * scale,
			VitaminB12Mcg:  item.Nutrients.VitaminB12Mcg * scale,
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
	sourceWeight := avgWeight
	if sourceWeight <= 0 {
		sourceWeight = 100
	}
	// 历史记录的 AVG 往往会产生 65.8333g 这类不可操作的小数。
	// 营养密度仍按原始平均重量计算，但默认份量统一为整克，避免把统计值直接暴露给用户。
	defaultWeight := practicalManualFoodWeight(sourceWeight)
	per100Scale := 100 / sourceWeight
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
		TotalCalories:      avgCalories * per100Scale * defaultWeight / 100,
		TotalProtein:       avgProtein * per100Scale * defaultWeight / 100,
		TotalCarbs:         avgCarbs * per100Scale * defaultWeight / 100,
		TotalFat:           avgFat * per100Scale * defaultWeight / 100,
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

	// 从代表性记录的原始 item 中解析微量元素，避免高频食物丢失微量营养。
	// 高频项的宏量营养必须以聚合 AVG 结果为准；单条代表记录只用于补齐微量元素，
	// 否则一个异常历史样本会覆盖几十条记录的平均值。
	representative := manualFoodResultFromRecordItem("nutrition_library", "catalog:"+title, title, fmt.Sprintf("%.0fg", defaultWeight), usageCount, raw)
	if representative.NutrientsPer100g != nil {
		result.NutrientsPer100g = mergeManualFoodNutrients(result.NutrientsPer100g, representative.NutrientsPer100g)
		extraNutrients := scaleManualFoodNutrients(*result.NutrientsPer100g, defaultWeight/100)
		result.ExtraNutrients = &extraNutrients
	} else if representative.ExtraNutrients != nil {
		representativePer100g := scaleManualFoodNutrients(*representative.ExtraNutrients, per100Scale)
		result.NutrientsPer100g = mergeManualFoodNutrients(result.NutrientsPer100g, &representativePer100g)
		extraNutrients := scaleManualFoodNutrients(*result.NutrientsPer100g, defaultWeight/100)
		result.ExtraNutrients = &extraNutrients
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

func (r *ManualFoodRepo) manualFoodResultFromCustomFood(item domain.UserCustomFood) domain.ManualFoodResult {
	nutrientsPer100g := manualFoodNutrientsFromMap(item.NutrientsPer100g)
	extraNutrients := manualFoodNutrientsFromMap(item.ExtraNutrients)
	imagePaths := compactStrings(item.ImagePaths)
	imagePath := item.ImagePath
	if r.storage != nil {
		imagePaths = r.storage.ResolveReferenceURLs("food-images", imagePaths)
		if imagePath != nil {
			resolved := r.storage.ResolveReferenceURL("food-images", *imagePath)
			if strings.TrimSpace(resolved) == "" {
				imagePath = nil
			} else {
				imagePath = &resolved
			}
		}
	}
	if imagePath == nil && len(imagePaths) > 0 {
		first := imagePaths[0]
		imagePath = &first
	}
	if len(imagePaths) == 0 && imagePath != nil {
		imagePaths = []string{*imagePath}
	}
	result := domain.ManualFoodResult{
		ID:                 item.ID,
		Source:             "custom",
		Title:              item.Title,
		Subtitle:           fmt.Sprintf("%.0f kcal / %sg", item.TotalCalories, formatManualCompactNumber(item.DefaultWeightGrams)),
		Category:           "custom",
		DefaultWeightGrams: item.DefaultWeightGrams,
		DisplayUnit:        "g",
		DisplayUnitLabel:   "g",
		TotalCalories:      item.TotalCalories,
		TotalProtein:       item.TotalProtein,
		TotalCarbs:         item.TotalCarbs,
		TotalFat:           item.TotalFat,
		NutrientsPer100g:   &nutrientsPer100g,
		ExtraNutrients:     &extraNutrients,
		ImagePath:          imagePath,
		ImagePaths:         imagePaths,
		PortionLabel:       item.PortionLabel,
		SourceLabel:        "自定义",
		RecommendReason:    item.RecommendReason,
	}
	if result.DefaultWeightGrams <= 0 {
		result.DefaultWeightGrams = 100
	}
	if result.PortionLabel == "" {
		result.PortionLabel = fmt.Sprintf("%sg", formatManualCompactNumber(result.DefaultWeightGrams))
	}
	if result.RecommendReason == "" {
		result.RecommendReason = "我的自定义食物"
	}
	applyManualFoodServingProfile(&result)
	return result
}

func manualFoodNutrientsFromMap(values map[string]any) domain.ManualFoodNutrients {
	if len(values) == 0 {
		return domain.ManualFoodNutrients{}
	}
	raw, err := json.Marshal(values)
	if err != nil {
		return domain.ManualFoodNutrients{}
	}
	var nutrients domain.ManualFoodNutrients
	_ = json.Unmarshal(raw, &nutrients)
	return nutrients
}

func manualFoodNutrientsFromAny(value any) domain.ManualFoodNutrients {
	switch v := value.(type) {
	case map[string]any:
		return manualFoodNutrientsFromMap(v)
	case json.RawMessage:
		var out domain.ManualFoodNutrients
		_ = json.Unmarshal(v, &out)
		return out
	case []byte:
		var out domain.ManualFoodNutrients
		_ = json.Unmarshal(v, &out)
		return out
	default:
		return domain.ManualFoodNutrients{}
	}
}

func sumManualFoodNutrients(a, b domain.ManualFoodNutrients) domain.ManualFoodNutrients {
	return domain.ManualFoodNutrients{
		Calories:       a.Calories + b.Calories,
		Protein:        a.Protein + b.Protein,
		Carbs:          a.Carbs + b.Carbs,
		Fat:            a.Fat + b.Fat,
		Fiber:          a.Fiber + b.Fiber,
		Sugar:          a.Sugar + b.Sugar,
		SaturatedFat:   a.SaturatedFat + b.SaturatedFat,
		CholesterolMg:  a.CholesterolMg + b.CholesterolMg,
		SodiumMg:       a.SodiumMg + b.SodiumMg,
		PotassiumMg:    a.PotassiumMg + b.PotassiumMg,
		CalciumMg:      a.CalciumMg + b.CalciumMg,
		IronMg:         a.IronMg + b.IronMg,
		MagnesiumMg:    a.MagnesiumMg + b.MagnesiumMg,
		ZincMg:         a.ZincMg + b.ZincMg,
		VitaminARaeMcg: a.VitaminARaeMcg + b.VitaminARaeMcg,
		VitaminCMg:     a.VitaminCMg + b.VitaminCMg,
		VitaminDMcg:    a.VitaminDMcg + b.VitaminDMcg,
		VitaminEMg:     a.VitaminEMg + b.VitaminEMg,
		VitaminKMcg:    a.VitaminKMcg + b.VitaminKMcg,
		ThiaminMg:      a.ThiaminMg + b.ThiaminMg,
		RiboflavinMg:   a.RiboflavinMg + b.RiboflavinMg,
		NiacinMg:       a.NiacinMg + b.NiacinMg,
		VitaminB6Mg:    a.VitaminB6Mg + b.VitaminB6Mg,
		FolateMcg:      a.FolateMcg + b.FolateMcg,
		VitaminB12Mcg:  a.VitaminB12Mcg + b.VitaminB12Mcg,
	}
}

func scaleManualFoodNutrients(n domain.ManualFoodNutrients, scale float64) domain.ManualFoodNutrients {
	return domain.ManualFoodNutrients{
		Calories:       n.Calories * scale,
		Protein:        n.Protein * scale,
		Carbs:          n.Carbs * scale,
		Fat:            n.Fat * scale,
		Fiber:          n.Fiber * scale,
		Sugar:          n.Sugar * scale,
		SaturatedFat:   n.SaturatedFat * scale,
		CholesterolMg:  n.CholesterolMg * scale,
		SodiumMg:       n.SodiumMg * scale,
		PotassiumMg:    n.PotassiumMg * scale,
		CalciumMg:      n.CalciumMg * scale,
		IronMg:         n.IronMg * scale,
		MagnesiumMg:    n.MagnesiumMg * scale,
		ZincMg:         n.ZincMg * scale,
		VitaminARaeMcg: n.VitaminARaeMcg * scale,
		VitaminCMg:     n.VitaminCMg * scale,
		VitaminDMcg:    n.VitaminDMcg * scale,
		VitaminEMg:     n.VitaminEMg * scale,
		VitaminKMcg:    n.VitaminKMcg * scale,
		ThiaminMg:      n.ThiaminMg * scale,
		RiboflavinMg:   n.RiboflavinMg * scale,
		NiacinMg:       n.NiacinMg * scale,
		VitaminB6Mg:    n.VitaminB6Mg * scale,
		FolateMcg:      n.FolateMcg * scale,
		VitaminB12Mcg:  n.VitaminB12Mcg * scale,
	}
}

func normalizeNutrientMap(values map[string]any) map[string]any {
	out := make(map[string]any)
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		switch v := value.(type) {
		case float64:
			out[key] = v
		case float32:
			out[key] = float64(v)
		case int:
			out[key] = float64(v)
		case int64:
			out[key] = float64(v)
		case json.Number:
			if n, err := v.Float64(); err == nil {
				out[key] = n
			}
		default:
			if n, ok := parseLooseFloat(v); ok {
				out[key] = n
			}
		}
	}
	return out
}

func parseLooseFloat(value any) (float64, bool) {
	raw := strings.TrimSpace(fmt.Sprint(value))
	if raw == "" || raw == "<nil>" {
		return 0, false
	}
	n, err := strconv.ParseFloat(raw, 64)
	return n, err == nil
}

func normalizeCustomFoodTitle(title string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(title)), " "))
}

func compactStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
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

func (r *ManualFoodRepo) normalizeNutritionFoodItem(item fooddomain.FoodNutrition) fooddomain.FoodNutrition {
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
	case "custom":
		return "自定义"
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

func (r *ManualFoodRepo) enrichManualFoodResultsWithNutritionLibrary(ctx context.Context, results []domain.ManualFoodResult) []domain.ManualFoodResult {
	if r == nil || r.db == nil || len(results) == 0 {
		return results
	}
	ids := make([]string, 0, len(results))
	titles := make([]string, 0, len(results))
	for _, item := range results {
		if !shouldEnrichManualFoodWithNutritionLibrary(item) {
			continue
		}
		id := strings.TrimSpace(item.ID)
		if id != "" && !strings.HasPrefix(id, "catalog:") {
			ids = append(ids, id)
			continue
		}
		if title := strings.TrimSpace(item.Title); title != "" {
			titles = append(titles, title)
		}
	}
	byID := r.loadNutritionFoodRowsByIDs(ctx, ids)
	byTitle := r.loadNutritionFoodRowsByTitles(ctx, titles)
	for i := range results {
		results[i] = r.mergeNutritionLibraryIntoManualFoodResult(results[i], byID, byTitle)
	}
	return results
}

func shouldEnrichManualFoodWithNutritionLibrary(item domain.ManualFoodResult) bool {
	source := strings.TrimSpace(item.Source)
	id := strings.TrimSpace(item.ID)
	if source == "nutrition_library" {
		return true
	}
	return strings.HasPrefix(id, "catalog:")
}

func (r *ManualFoodRepo) loadNutritionFoodRowsByIDs(ctx context.Context, ids []string) map[string]fooddomain.FoodNutrition {
	out := make(map[string]fooddomain.FoodNutrition, len(ids))
	if len(ids) == 0 {
		return out
	}
	var rows []fooddomain.FoodNutrition
	if err := r.db.WithContext(ctx).
		Where("id::text IN ? AND is_active = TRUE AND kcal_per_100g > 0 AND "+nutritionExactQualitySQL, ids).
		Find(&rows).Error; err != nil {
		return out
	}
	for _, row := range rows {
		row = r.normalizeNutritionFoodItem(row)
		out[strings.TrimSpace(row.ID)] = row
	}
	return out
}

func (r *ManualFoodRepo) loadNutritionFoodRowsByTitles(ctx context.Context, titles []string) map[string]fooddomain.FoodNutrition {
	out := make(map[string]fooddomain.FoodNutrition, len(titles))
	exactMatches := make(map[string]bool, len(titles))
	if len(titles) == 0 {
		return out
	}
	unique := make([]string, 0, len(titles))
	seen := map[string]bool{}
	for _, title := range titles {
		title = strings.TrimSpace(title)
		if title == "" || seen[title] {
			continue
		}
		seen[title] = true
		unique = append(unique, title)
	}
	if len(unique) == 0 {
		return out
	}
	lowerTitles := make([]string, 0, len(unique))
	for _, title := range unique {
		lowerTitles = append(lowerTitles, strings.ToLower(title))
	}
	var rows []fooddomain.FoodNutrition
	if err := r.db.WithContext(ctx).
		Where("is_active = TRUE AND kcal_per_100g > 0 AND "+nutritionExactQualitySQL+" AND (canonical_name IN ? OR LOWER(canonical_name) IN ?)", unique, lowerTitles).
		Find(&rows).Error; err == nil {
		for _, row := range rows {
			row = r.normalizeNutritionFoodItem(row)
			key := strings.TrimSpace(row.CanonicalName)
			if key == "" {
				continue
			}
			for _, title := range unique {
				if strings.EqualFold(title, key) {
					out[title] = preferNutritionRowWithImage(out[title], row)
					exactMatches[title] = true
				}
			}
		}
	}
	type aliasRow struct {
		AliasName string `gorm:"column:alias_name"`
		fooddomain.FoodNutrition
	}
	var aliasRows []aliasRow
	if err := r.db.WithContext(ctx).Raw(`
		SELECT a.alias_name, f.*
		FROM food_nutrition_aliases a
		INNER JOIN food_nutrition_library f ON f.id = a.food_id
		WHERE f.is_active = TRUE
			AND f.kcal_per_100g > 0
			AND f.quality_tier IN ('authoritative','reviewed_estimate','legacy_curated')
			AND a.match_status = 'approved_exact'
			AND (a.alias_name IN ? OR LOWER(a.alias_name) IN ?)
	`, unique, lowerTitles).Scan(&aliasRows).Error; err == nil {
		for _, row := range aliasRows {
			food := r.normalizeNutritionFoodItem(row.FoodNutrition)
			alias := strings.TrimSpace(row.AliasName)
			if alias == "" {
				continue
			}
			for _, title := range unique {
				if strings.EqualFold(title, alias) {
					// 精确 canonical_name 必须优先于别名。否则两行都有图片时，
					// 例如“茶叶蛋”的精确营养行会被“茶叶蛋 -> 鸡蛋(全蛋)”
					// 别名目标覆盖，最终返回错误的 food_id 和营养来源。
					if !exactMatches[title] {
						out[title] = food
					}
				}
			}
		}
	}
	nutriRepo := foodrecordrepo.NewFoodNutritionRepo(r.db)
	for _, title := range unique {
		if exactMatches[title] {
			continue
		}
		if existing, ok := out[title]; ok && nutritionRowHasImage(existing) {
			continue
		}
		resolved, err := nutriRepo.ResolveFood(ctx, title)
		if err != nil || resolved == nil || resolved.Food == nil {
			continue
		}
		out[title] = preferNutritionRowWithImage(out[title], r.normalizeNutritionFoodItem(*resolved.Food))
	}
	return out
}

func nutritionRowHasImage(row fooddomain.FoodNutrition) bool {
	if row.ImagePath != nil && strings.TrimSpace(*row.ImagePath) != "" {
		return true
	}
	for _, path := range row.ImagePaths {
		if strings.TrimSpace(path) != "" {
			return true
		}
	}
	return false
}

func preferNutritionRowWithImage(current, candidate fooddomain.FoodNutrition) fooddomain.FoodNutrition {
	if !nutritionRowHasImage(current) {
		return candidate
	}
	if nutritionRowHasImage(candidate) {
		return candidate
	}
	return current
}

func nutrientsFromFoodNutritionRow(row fooddomain.FoodNutrition) *domain.ManualFoodNutrients {
	return &domain.ManualFoodNutrients{
		Calories:       row.KcalPer100g,
		Protein:        row.ProteinPer100g,
		Carbs:          row.CarbsPer100g,
		Fat:            row.FatPer100g,
		Fiber:          row.FiberPer100g,
		Sugar:          row.SugarPer100g,
		SaturatedFat:   row.SaturatedFatPer100g,
		CholesterolMg:  row.CholesterolMgPer100g,
		SodiumMg:       row.SodiumMgPer100g,
		PotassiumMg:    row.PotassiumMgPer100g,
		CalciumMg:      row.CalciumMgPer100g,
		IronMg:         row.IronMgPer100g,
		MagnesiumMg:    row.MagnesiumMgPer100g,
		ZincMg:         row.ZincMgPer100g,
		VitaminARaeMcg: row.VitaminARaeMcgPer100g,
		VitaminCMg:     row.VitaminCMgPer100g,
		VitaminDMcg:    row.VitaminDMcgPer100g,
		VitaminEMg:     row.VitaminEMgPer100g,
		VitaminKMcg:    row.VitaminKMcgPer100g,
		ThiaminMg:      row.ThiaminMgPer100g,
		RiboflavinMg:   row.RiboflavinMgPer100g,
		NiacinMg:       row.NiacinMgPer100g,
		VitaminB6Mg:    row.VitaminB6MgPer100g,
		FolateMcg:      row.FolateMcgPer100g,
		VitaminB12Mcg:  row.VitaminB12McgPer100g,
	}
}

func manualFoodNutrientsHasMicros(n *domain.ManualFoodNutrients) bool {
	if n == nil {
		return false
	}
	return n.Fiber > 0 || n.Sugar > 0 || n.SaturatedFat > 0 || n.CholesterolMg > 0 ||
		n.SodiumMg > 0 || n.PotassiumMg > 0 || n.CalciumMg > 0 || n.IronMg > 0 ||
		n.MagnesiumMg > 0 || n.ZincMg > 0 || n.VitaminARaeMcg > 0 || n.VitaminCMg > 0 ||
		n.VitaminDMcg > 0 || n.VitaminEMg > 0 || n.VitaminKMcg > 0 || n.ThiaminMg > 0 ||
		n.RiboflavinMg > 0 || n.NiacinMg > 0 || n.VitaminB6Mg > 0 || n.FolateMcg > 0 ||
		n.VitaminB12Mcg > 0
}

func scaleManualFoodNutrientsPtr(n *domain.ManualFoodNutrients, scale float64) *domain.ManualFoodNutrients {
	if n == nil {
		return nil
	}
	scaled := scaleManualFoodNutrients(*n, scale)
	return &scaled
}

// mergeManualFoodNutrients 将营养库数据合并到现有营养素中：
// 宏量营养素（calories/protein/carbs/fat）优先保留现有值；
// 微量元素仅在现有值缺失或为零时用营养库补齐。
// 这样最近记录/高频食物的列表显示能量与实际记录能量保持一致。
func mergeManualFoodNutrients(existing *domain.ManualFoodNutrients, library *domain.ManualFoodNutrients) *domain.ManualFoodNutrients {
	if existing == nil {
		return library
	}
	if library == nil {
		return existing
	}
	out := *existing
	mergePositive := func(current *float64, value float64) {
		if *current <= 0 && value > 0 {
			*current = value
		}
	}
	mergePositive(&out.Calories, library.Calories)
	mergePositive(&out.Protein, library.Protein)
	mergePositive(&out.Carbs, library.Carbs)
	mergePositive(&out.Fat, library.Fat)
	mergePositive(&out.Fiber, library.Fiber)
	mergePositive(&out.Sugar, library.Sugar)
	mergePositive(&out.SaturatedFat, library.SaturatedFat)
	mergePositive(&out.CholesterolMg, library.CholesterolMg)
	mergePositive(&out.SodiumMg, library.SodiumMg)
	mergePositive(&out.PotassiumMg, library.PotassiumMg)
	mergePositive(&out.CalciumMg, library.CalciumMg)
	mergePositive(&out.IronMg, library.IronMg)
	mergePositive(&out.MagnesiumMg, library.MagnesiumMg)
	mergePositive(&out.ZincMg, library.ZincMg)
	mergePositive(&out.VitaminARaeMcg, library.VitaminARaeMcg)
	mergePositive(&out.VitaminCMg, library.VitaminCMg)
	mergePositive(&out.VitaminDMcg, library.VitaminDMcg)
	mergePositive(&out.VitaminEMg, library.VitaminEMg)
	mergePositive(&out.VitaminKMcg, library.VitaminKMcg)
	mergePositive(&out.ThiaminMg, library.ThiaminMg)
	mergePositive(&out.RiboflavinMg, library.RiboflavinMg)
	mergePositive(&out.NiacinMg, library.NiacinMg)
	mergePositive(&out.VitaminB6Mg, library.VitaminB6Mg)
	mergePositive(&out.FolateMcg, library.FolateMcg)
	mergePositive(&out.VitaminB12Mcg, library.VitaminB12Mcg)
	return &out
}

func (r *ManualFoodRepo) mergeNutritionLibraryIntoManualFoodResult(
	item domain.ManualFoodResult,
	byID map[string]fooddomain.FoodNutrition,
	byTitle map[string]fooddomain.FoodNutrition,
) domain.ManualFoodResult {
	if !shouldEnrichManualFoodWithNutritionLibrary(item) {
		return item
	}
	var row fooddomain.FoodNutrition
	var ok bool
	id := strings.TrimSpace(item.ID)
	if id != "" && !strings.HasPrefix(id, "catalog:") {
		row, ok = byID[id]
	}
	if !ok {
		row, ok = byTitle[strings.TrimSpace(item.Title)]
	}
	if !ok {
		return item
	}
	item.ID = strings.TrimSpace(row.ID)
	item.Source = "nutrition_library"
	item.ImagePath = row.ImagePath
	item.ImagePaths = append([]string(nil), row.ImagePaths...)
	if item.ImagePath == nil && len(item.ImagePaths) > 0 {
		first := item.ImagePaths[0]
		item.ImagePath = &first
	}
	// 如果目标结果没有微量元素（常见于最近记录/高频食物），从营养库补齐，
	// 避免手动记录后首页微量营养不更新。同时保留原有宏量营养素，确保列表显示能量
	// 与实际记录能量一致（例如 178g/227kcal 的白米饭不会被营养库 116kcal/100g 覆盖成 206kcal）。
	if !manualFoodNutrientsHasMicros(item.NutrientsPer100g) {
		item.NutrientsPer100g = mergeManualFoodNutrients(item.NutrientsPer100g, nutrientsFromFoodNutritionRow(row))
		if item.DefaultWeightGrams > 0 {
			item.ExtraNutrients = scaleManualFoodNutrientsPtr(item.NutrientsPer100g, item.DefaultWeightGrams/100)
		} else {
			item.ExtraNutrients = item.NutrientsPer100g
		}
	}
	return item
}

func manualFoodCatalogCategories() []domain.ManualFoodCatalogCategory {
	return []domain.ManualFoodCatalogCategory{
		{Key: "common", Label: "常见"},
		{Key: "campus", Label: "校园食堂"},
		{Key: "custom", Label: "自定义"},
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
		applyPackagedFoodPortionNutrition(item)
		return
	}
	title := strings.TrimSpace(item.Title)
	switch {
	case manualFoodEggPieceWeight(title) > 0:
		pieceWeight := manualFoodEggPieceWeight(title)
		applyPer100Default(item, pieceWeight)
		item.DisplayUnit = "piece"
		item.DisplayUnitLabel = "个"
		item.PortionLabel = "1个"
		item.ServingPresets = []domain.ManualFoodServingPreset{
			{Label: "0.5个", Grams: pieceWeight * 0.5, Quantity: 0.5},
			{Label: "1个", Grams: pieceWeight, Quantity: 1},
			{Label: "2个", Grams: pieceWeight * 2, Quantity: 2},
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

func applyPackagedFoodPortionNutrition(item *domain.ManualFoodResult) {
	if item == nil || item.NutrientsPer100g == nil || item.DefaultWeightGrams <= 0 {
		return
	}
	if item.DisplayUnit == "ml" && item.DefaultWeightGrams > 750 {
		item.DefaultWeightGrams = 500
		item.PortionLabel = "500ml"
	}
	scale := item.DefaultWeightGrams / 100
	item.TotalCalories = item.NutrientsPer100g.Calories * scale
	item.TotalProtein = item.NutrientsPer100g.Protein * scale
	item.TotalCarbs = item.NutrientsPer100g.Carbs * scale
	item.TotalFat = item.NutrientsPer100g.Fat * scale
	if item.ExtraNutrients == nil {
		item.ExtraNutrients = &domain.ManualFoodNutrients{}
	}
	item.ExtraNutrients.Fiber = item.NutrientsPer100g.Fiber * scale
	item.ExtraNutrients.Sugar = item.NutrientsPer100g.Sugar * scale
	item.ExtraNutrients.SaturatedFat = item.NutrientsPer100g.SaturatedFat * scale
	item.ExtraNutrients.CholesterolMg = item.NutrientsPer100g.CholesterolMg * scale
	item.ExtraNutrients.SodiumMg = item.NutrientsPer100g.SodiumMg * scale
	item.ExtraNutrients.PotassiumMg = item.NutrientsPer100g.PotassiumMg * scale
	item.ExtraNutrients.CalciumMg = item.NutrientsPer100g.CalciumMg * scale
	item.ExtraNutrients.IronMg = item.NutrientsPer100g.IronMg * scale
	item.ExtraNutrients.MagnesiumMg = item.NutrientsPer100g.MagnesiumMg * scale
	item.ExtraNutrients.ZincMg = item.NutrientsPer100g.ZincMg * scale
	item.ExtraNutrients.VitaminARaeMcg = item.NutrientsPer100g.VitaminARaeMcg * scale
	item.ExtraNutrients.VitaminCMg = item.NutrientsPer100g.VitaminCMg * scale
	item.ExtraNutrients.VitaminDMcg = item.NutrientsPer100g.VitaminDMcg * scale
	item.ExtraNutrients.VitaminEMg = item.NutrientsPer100g.VitaminEMg * scale
	item.ExtraNutrients.VitaminKMcg = item.NutrientsPer100g.VitaminKMcg * scale
	item.ExtraNutrients.ThiaminMg = item.NutrientsPer100g.ThiaminMg * scale
	item.ExtraNutrients.RiboflavinMg = item.NutrientsPer100g.RiboflavinMg * scale
	item.ExtraNutrients.NiacinMg = item.NutrientsPer100g.NiacinMg * scale
	item.ExtraNutrients.VitaminB6Mg = item.NutrientsPer100g.VitaminB6Mg * scale
	item.ExtraNutrients.FolateMcg = item.NutrientsPer100g.FolateMcg * scale
	item.ExtraNutrients.VitaminB12Mcg = item.NutrientsPer100g.VitaminB12Mcg * scale
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
	if normalized == "" {
		return false
	}
	// 蛋白、蛋黄和含蛋复合食品不能套用“一个整蛋约 55g”的份量。
	// 这也避免“鸡蛋面”“鸡蛋饼”等仅因名称含鸡蛋就被显示为按个记录。
	if containsAnyManualFoodToken(normalized, []string{
		"蛋白", "蛋清", "蛋黄", "蛋糕", "蛋挞", "蛋卷", "蛋饼", "鸡蛋面",
		"炒蛋", "炒鸡蛋", "蒸蛋", "蛋羹", "蛋花", "鹌鹑蛋", "鸽子蛋", "鹅蛋", "鸭蛋",
		"eggplant", "egg white", "egg yolk", "egg tart", "egg cake", "quail egg", "duck egg", "goose egg",
		"scrambled egg", "omelet", "omelette",
	}) {
		return false
	}
	return containsAnyManualFoodToken(normalized, []string{
		"egg", "鸡蛋", "水煮蛋", "白煮蛋", "煮鸡蛋", "茶叶蛋", "卤蛋", "煎蛋", "荷包蛋",
	})
}

func manualFoodEggPieceWeight(title string) float64 {
	normalized := strings.ToLower(strings.TrimSpace(title))
	if normalized == "" || containsAnyManualFoodToken(normalized, []string{
		"蛋白粉", "蛋白棒", "蛋白饮", "蛋白奶昔", "egg protein", "protein powder",
		"蛋糕", "蛋挞", "蛋卷", "蛋饼", "鸡蛋面", "炒蛋", "炒鸡蛋", "蒸蛋", "蛋羹", "蛋花",
		"eggplant", "egg tart", "egg cake", "scrambled egg", "omelet", "omelette",
	}) {
		return 0
	}
	switch {
	case containsAnyManualFoodToken(normalized, []string{"蛋清", "蛋蛋白", "鸡蛋白", "egg white"}):
		return 33
	case containsAnyManualFoodToken(normalized, []string{"蛋黄", "egg yolk"}):
		return 17
	case containsAnyManualFoodToken(normalized, []string{"鹌鹑蛋", "quail egg"}):
		return 10
	case containsAnyManualFoodToken(normalized, []string{"鸽子蛋", "pigeon egg"}):
		return 15
	case containsAnyManualFoodToken(normalized, []string{"鸭蛋", "duck egg"}):
		return 65
	case containsAnyManualFoodToken(normalized, []string{"鹅蛋", "goose egg"}):
		return 180
	case isEggLikeFood(normalized):
		return 55
	default:
		return 0
	}
}

func practicalManualFoodWeight(weight float64) float64 {
	if weight <= 0 {
		return 100
	}
	if weight < 1 {
		return math.Round(weight*10) / 10
	}
	return math.Round(weight)
}

func containsAnyManualFoodToken(value string, tokens []string) bool {
	for _, token := range tokens {
		if strings.Contains(value, strings.ToLower(token)) {
			return true
		}
	}
	return false
}

func isBeverageLikeFood(title string) bool {
	lower := strings.ToLower(strings.TrimSpace(title))
	if strings.Contains(title, "粉") || strings.Contains(title, "固体饮料") || strings.Contains(title, "冲剂") || strings.Contains(lower, "powder") {
		return false
	}
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
	if servingWeight := validPackagedServingWeight(item); servingWeight > 0 {
		return servingWeight
	}
	if strings.Contains(strings.ToLower(stringPtrValue(item.NutritionBasisUnit)), "100ml") && item.ServingWeightG > 750 {
		return 500
	}
	if netContent := packagedNetContentWeight(item); netContent > 0 && netContent <= 500 {
		return netContent
	}
	if strings.EqualFold(strings.TrimSpace(stringPtrValue(item.NetContentUnit)), "ml") && item.NetContentValue > 750 {
		return 500
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
	if servingWeight := validPackagedServingWeight(item); servingWeight > 0 {
		return fmt.Sprintf("%.0f%s", servingWeight, unit)
	}
	if unit == "ml" && (item.NetContentValue > 750 || item.ServingWeightG > 750) {
		return "500ml"
	}
	if unit == "ml" && item.NetContentValue > 750 {
		return "500ml"
	}
	if unit == "ml" && item.NetContentValue > 750 {
		return "500ml"
	}
	if label := packagedNetContentLabel(item); label != "" {
		return label
	}
	if item.NetWeightG > 0 && item.NetWeightG <= 500 {
		return fmt.Sprintf("%.0f%s", item.NetWeightG, unit)
	}
	return "100" + unit
}

func validPackagedServingWeight(item fooddomain.PackagedFood) float64 {
	servingWeight, _ := fooddomain.SupportedPackagedServingWeight(item)
	return servingWeight
}

func isPhysicallyImplausibleFrequentFood(weight, calories, protein, carbs, fat float64) bool {
	if weight <= 0 || weight > 2000 || calories < 0 || protein < 0 || carbs < 0 || fat < 0 {
		return true
	}
	scale := 100 / weight
	if calories*scale > 950 {
		return true
	}
	return (protein+carbs+fat)*scale > 105
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

func fmtPriceDisplay(price float64, priceType, priceUnit string) string {
	if price <= 0 {
		return "价格待补充"
	}
	switch priceType {
	case "weight":
		if priceUnit != "" {
			return fmt.Sprintf("%.0f%s", price, priceUnit)
		}
		return fmt.Sprintf("%.0f元/kg", price)
	case "range":
		return fmt.Sprintf("%.0f-%.0f元", price, price)
	case "combo":
		if priceUnit != "" {
			return fmt.Sprintf("%.0f%s", price, priceUnit)
		}
		return fmt.Sprintf("%.0f元/套餐", price)
	default:
		if priceUnit != "" {
			return fmt.Sprintf("%.0f%s", price, priceUnit)
		}
		return fmt.Sprintf("%.0f元/份", price)
	}
}
