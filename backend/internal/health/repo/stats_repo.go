package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type StatsRepo struct {
	db *gorm.DB
}

func NewStatsRepo(db *gorm.DB) *StatsRepo {
	return &StatsRepo{db: db}
}

func (r *StatsRepo) GetFoodRecordsForDateRange(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]domain.FoodRecord, error) {
	var rows []domain.FoodRecord
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND record_time >= ? AND record_time < ?", userID, startUTC, endUTC).
		Order("record_time asc").
		Find(&rows).Error
	return rows, err
}

func (r *StatsRepo) GetExerciseLogsForDateRange(ctx context.Context, userID string, startDate, endDate string) ([]domain.ExerciseLog, error) {
	var rows []domain.ExerciseLog
	q := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if startDate != "" {
		q = q.Where("recorded_on >= ?", startDate)
	}
	if endDate != "" {
		q = q.Where("recorded_on <= ?", endDate)
	}
	err := q.Order("recorded_on desc, created_at desc").Find(&rows).Error
	return rows, err
}

func (r *StatsRepo) GetUserProfile(ctx context.Context, userID string) (*domain.StatsUserProfile, error) {
	var row domain.StatsUserProfile
	if err := r.db.WithContext(ctx).Where("id = ?", userID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *StatsRepo) GetRecentFoodRecordDates(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]string, error) {
	var rows []struct {
		Date string `gorm:"column:date"`
	}
	err := r.db.WithContext(ctx).Raw(`
		SELECT DISTINCT TO_CHAR(DATE(record_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD') AS date
		FROM user_food_records
		WHERE user_id = ? AND record_time >= ? AND record_time < ?
		ORDER BY date DESC
	`, userID, startUTC, endUTC).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	dates := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.Date != "" {
			dates = append(dates, row.Date)
		}
	}
	return dates, nil
}

func (r *StatsRepo) GetDistinctRecordDays(ctx context.Context, userID string, startUTC, endUTC time.Time) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Raw(`
		SELECT COUNT(DISTINCT DATE(record_time AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'))
		FROM user_food_records
		WHERE user_id = ? AND record_time >= ? AND record_time < ?
	`, userID, startUTC, endUTC).Scan(&count).Error
	return count, err
}

func (r *StatsRepo) UpsertInsightCache(ctx context.Context, userID, rangeType, generatedDate, dataFingerprint, insightText string) error {
	row := map[string]any{
		"id":               uuid.New().String(),
		"user_id":          userID,
		"range_type":       rangeType,
		"generated_date":   generatedDate,
		"data_fingerprint": dataFingerprint,
		"insight_text":     insightText,
		"generation_count": 1,
		"created_at":       time.Now().UTC(),
	}
	return r.db.WithContext(ctx).
		Table((&domain.StatsInsight{}).TableName()).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "user_id"},
				{Name: "range_type"},
				{Name: "generated_date"},
			},
			DoUpdates: clause.Assignments(map[string]any{
				"data_fingerprint": clause.Column{Table: "excluded", Name: "data_fingerprint"},
				"insight_text":     clause.Column{Table: "excluded", Name: "insight_text"},
				"created_at":       clause.Column{Table: "excluded", Name: "created_at"},
				"generation_count": gorm.Expr("COALESCE(ai_stats_insights.generation_count, 0) + 1"),
			}),
		}).
		Create(row).Error
}

func (r *StatsRepo) GetCachedInsight(ctx context.Context, userID string, rangeType string, generatedDate string) (*domain.StatsInsight, error) {
	var row domain.StatsInsight
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND range_type = ? AND generated_date = ?", userID, rangeType, generatedDate).
		First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *StatsRepo) GetLatestCachedInsight(ctx context.Context, userID string, rangeType string) (*domain.StatsInsight, error) {
	var row domain.StatsInsight
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND range_type = ?", userID, rangeType).
		Order("generated_date desc").
		Order("created_at desc").
		First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *StatsRepo) CountInsightGenerationsToday(ctx context.Context, userID string) (int64, error) {
	loc := time.FixedZone("Asia/Shanghai", 8*60*60)
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	end := start.Add(24 * time.Hour)

	var count int64
	err := r.db.WithContext(ctx).
		Table((&domain.StatsInsight{}).TableName()).
		Select("COALESCE(SUM(COALESCE(generation_count, 1)), 0)").
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, start.UTC(), end.UTC()).
		Scan(&count).Error
	return count, err
}

func (r *StatsRepo) GetDietRecommendationCandidates(ctx context.Context, userID string, scene string, scope domain.DietRecommendationScope, limit int) ([]domain.DietRecommendationCandidate, error) {
	// 校园推荐会先扫描本校完整已发布菜品池，再在 service 层做营养初筛和 AI 重排。
	// 这里保留上限防止异常请求无界读取；普通推荐仍使用 24 条的小候选池。
	if limit <= 0 || limit > 3000 {
		limit = 24
	}
	out := make([]domain.DietRecommendationCandidate, 0, limit)
	perSourceLimit := limit / 3
	if perSourceLimit < 5 {
		perSourceLimit = 5
	}

	if scene == "eat_out" {
		publicLimit := perSourceLimit + 3
		if scope.SchoolID != "" {
			publicLimit = limit
		}
		out = append(out, r.getPublicFoodRecommendationCandidates(ctx, scope, publicLimit)...)
		if scope.SchoolID != "" {
			if len(out) > limit {
				out = out[:limit]
			}
			return out, nil
		}
		out = append(out, r.getUserFoodRecordRecommendationCandidates(ctx, userID, perSourceLimit)...)
		out = append(out, r.getNutritionRecommendationCandidates(ctx, perSourceLimit)...)
	} else {
		out = append(out, r.getNutritionRecommendationCandidates(ctx, perSourceLimit+5)...)
		out = append(out, r.getUserFoodRecordRecommendationCandidates(ctx, userID, perSourceLimit)...)
		out = append(out, r.getPublicFoodRecommendationCandidates(ctx, scope, perSourceLimit)...)
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

type dietRecommendationRow struct {
	ID           string  `gorm:"column:id"`
	Title        string  `gorm:"column:title"`
	Description  string  `gorm:"column:description"`
	Calories     float64 `gorm:"column:calories"`
	Protein      float64 `gorm:"column:protein"`
	Carbs        float64 `gorm:"column:carbs"`
	Fat          float64 `gorm:"column:fat"`
	ItemsJSON    string  `gorm:"column:items_json"`
	IsCampusFood bool    `gorm:"column:is_campus_food"`
	SchoolID     string  `gorm:"column:school_id"`
	SchoolName   string  `gorm:"column:school_name"`
	CampusID     string  `gorm:"column:campus_id"`
	CampusName   string  `gorm:"column:campus_name"`
	CanteenID    string  `gorm:"column:canteen_id"`
	CanteenName  string  `gorm:"column:canteen_name"`
	WindowID     string  `gorm:"column:window_id"`
	WindowName   string  `gorm:"column:window_name"`
	Floor        string  `gorm:"column:floor"`
	Price        float64 `gorm:"column:price"`
	PriceUnit    string  `gorm:"column:price_unit"`
	ImagePath    string  `gorm:"column:image_path"`
}

func (r *StatsRepo) SearchCampusDietCandidates(ctx context.Context, filter domain.CampusDietSearchFilter) ([]domain.DietRecommendationCandidate, int64, error) {
	filter.SchoolID = strings.TrimSpace(filter.SchoolID)
	if filter.SchoolID == "" {
		return nil, 0, fmt.Errorf("school_id required")
	}
	if filter.Limit <= 0 || filter.Limit > 20 {
		filter.Limit = 20
	}
	if filter.Offset < 0 {
		filter.Offset = 0
	}
	if filter.Offset > 3000 {
		filter.Offset = 3000
	}

	base := r.db.WithContext(ctx).
		Table("public_food_library").
		Where(`status = ? AND COALESCE(is_campus_food, false) = true AND school_id = ? AND total_calories > 0
			AND COALESCE(food_name, '') !~* '(餐盒|打包盒|包装盒|纸袋|塑料袋|餐具|筷子|勺子|吸管|杯盖|餐巾)'`, "published", filter.SchoolID)
	if campusID := strings.TrimSpace(filter.CampusID); campusID != "" {
		base = base.Where("campus_id = ?", campusID)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		base = base.Where(`(
			food_name ILIKE ? OR description ILIKE ? OR canteen_name ILIKE ?
			OR window_name ILIKE ? OR floor ILIKE ?
		)`, like, like, like, like, like)
	}
	if canteenName := strings.TrimSpace(filter.CanteenName); canteenName != "" {
		base = base.Where("canteen_name ILIKE ?", "%"+canteenName+"%")
	}
	if len(filter.IncludeSourceIDs) > 0 {
		base = base.Where("id IN ?", filter.IncludeSourceIDs)
	}
	if len(filter.ExcludeSourceIDs) > 0 {
		base = base.Where("id NOT IN ?", filter.ExcludeSourceIDs)
	}
	if filter.MaxCalories != nil && *filter.MaxCalories > 0 {
		base = base.Where("total_calories <= ?", *filter.MaxCalories)
	}
	if filter.MinProtein != nil && *filter.MinProtein > 0 {
		base = base.Where("total_protein >= ?", *filter.MinProtein)
	}
	if filter.MaxFat != nil && *filter.MaxFat > 0 {
		base = base.Where("total_fat <= ?", *filter.MaxFat)
	}
	if filter.MaxPrice != nil && *filter.MaxPrice > 0 {
		base = base.Where(`price > 0 AND price <= ?
			AND COALESCE(price_unit, '') !~* '(两|克|千克|公斤|斤|kg|/g|每|只|个|串|枚|片|粒)'`, *filter.MaxPrice)
	} else if strings.TrimSpace(filter.SortBy) == "lowest_price" {
		base = base.Where(`price > 0
			AND COALESCE(price_unit, '') !~* '(两|克|千克|公斤|斤|kg|/g|每|只|个|串|枚|片|粒)'`)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []dietRecommendationRow
	q := base.Select(`id, COALESCE(NULLIF(food_name, ''), NULLIF(description, ''), '校园餐') AS title,
		COALESCE(description, '') AS description, total_calories AS calories,
		total_protein AS protein, total_carbs AS carbs, total_fat AS fat,
		COALESCE(CAST(items AS TEXT), '[]') AS items_json,
		COALESCE(is_campus_food, false) AS is_campus_food,
		COALESCE(CAST(school_id AS TEXT), '') AS school_id, COALESCE(school_name, '') AS school_name,
		COALESCE(CAST(campus_id AS TEXT), '') AS campus_id, COALESCE(campus_name, '') AS campus_name,
		COALESCE(CAST(canteen_id AS TEXT), '') AS canteen_id, COALESCE(canteen_name, '') AS canteen_name,
		COALESCE(CAST(window_id AS TEXT), '') AS window_id, COALESCE(window_name, '') AS window_name,
		COALESCE(floor, '') AS floor, COALESCE(price, 0) AS price,
		COALESCE(price_unit, '') AS price_unit, COALESCE(image_path, '') AS image_path`)
	switch strings.TrimSpace(filter.SortBy) {
	case "lowest_calories":
		q = q.Order("total_calories ASC")
	case "highest_protein":
		q = q.Order("total_protein DESC, total_calories ASC")
	case "protein_density":
		q = q.Order("(total_protein / NULLIF(total_calories, 0)) DESC, total_protein DESC")
	case "lowest_price":
		q = q.Order("CASE WHEN COALESCE(price, 0) > 0 THEN 0 ELSE 1 END ASC, price ASC")
	default:
		if filter.TargetCalories != nil && *filter.TargetCalories > 0 {
			q = q.Order(gorm.Expr("ABS(total_calories - ?) ASC", *filter.TargetCalories))
		}
		q = q.Order("total_protein DESC, total_calories ASC")
	}
	q = q.Order("CASE WHEN COALESCE(image_path, '') <> '' THEN 0 ELSE 1 END ASC").Order("published_at DESC")
	if err := q.Offset(filter.Offset).Limit(filter.Limit).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rowsToDietRecommendationCandidates(rows, "public_food_library"), total, nil
}

func (r *StatsRepo) getPublicFoodRecommendationCandidates(ctx context.Context, scope domain.DietRecommendationScope, limit int) []domain.DietRecommendationCandidate {
	var rows []dietRecommendationRow
	q := r.db.WithContext(ctx).
		Table("public_food_library").
		Select(`id, COALESCE(NULLIF(food_name, ''), NULLIF(description, ''), '公共食物') AS title,
			COALESCE(description, '') AS description, total_calories AS calories,
			total_protein AS protein, total_carbs AS carbs, total_fat AS fat,
			COALESCE(CAST(items AS TEXT), '[]') AS items_json,
			COALESCE(is_campus_food, false) AS is_campus_food,
			COALESCE(CAST(school_id AS TEXT), '') AS school_id, COALESCE(school_name, '') AS school_name,
			COALESCE(CAST(campus_id AS TEXT), '') AS campus_id, COALESCE(campus_name, '') AS campus_name,
			COALESCE(CAST(canteen_id AS TEXT), '') AS canteen_id, COALESCE(canteen_name, '') AS canteen_name,
			COALESCE(CAST(window_id AS TEXT), '') AS window_id, COALESCE(window_name, '') AS window_name,
			COALESCE(floor, '') AS floor, COALESCE(price, 0) AS price,
			COALESCE(price_unit, '') AS price_unit, COALESCE(image_path, '') AS image_path`).
		Where("status = ? AND total_calories > 0", "published")
	if strings.TrimSpace(scope.CampusID) != "" {
		q = q.Where("campus_id = ?", strings.TrimSpace(scope.CampusID))
	} else if strings.TrimSpace(scope.SchoolID) != "" {
		q = q.Where("school_id = ?", strings.TrimSpace(scope.SchoolID))
	} else {
		q = q.Where("COALESCE(is_campus_food, false) = false")
	}
	if len(scope.IncludeSourceIDs) > 0 {
		q = q.Where("id IN ?", scope.IncludeSourceIDs)
	}
	if len(scope.ExcludeSourceIDs) > 0 {
		q = q.Where("id NOT IN ?", scope.ExcludeSourceIDs)
	}
	if strings.TrimSpace(scope.SchoolID) != "" {
		q = q.Where("COALESCE(is_campus_food, false) = true").
			Order("CASE WHEN COALESCE(image_path, '') <> '' THEN 0 ELSE 1 END ASC").
			Order("published_at DESC")
	} else {
		q = q.Order("RANDOM()")
	}
	err := q.
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil
	}
	return rowsToDietRecommendationCandidates(rows, "public_food_library")
}

func (r *StatsRepo) getUserFoodRecordRecommendationCandidates(ctx context.Context, userID string, limit int) []domain.DietRecommendationCandidate {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil
	}
	var rows []dietRecommendationRow
	err := r.db.WithContext(ctx).
		Table("user_food_records").
		Select("id, COALESCE(NULLIF(description, ''), meal_type, '历史餐食') AS title, COALESCE(description, '') AS description, total_calories AS calories, total_protein AS protein, total_carbs AS carbs, total_fat AS fat, COALESCE(CAST(items AS TEXT), '[]') AS items_json").
		Where("user_id = ? AND total_calories > 0", userID).
		Order("record_time DESC NULLS LAST, created_at DESC NULLS LAST").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil
	}
	return rowsToDietRecommendationCandidates(rows, "user_food_records")
}

func (r *StatsRepo) getNutritionRecommendationCandidates(ctx context.Context, limit int) []domain.DietRecommendationCandidate {
	var rows []struct {
		ID       string  `gorm:"column:id"`
		Name     string  `gorm:"column:name"`
		Calories float64 `gorm:"column:calories"`
		Protein  float64 `gorm:"column:protein"`
		Carbs    float64 `gorm:"column:carbs"`
		Fat      float64 `gorm:"column:fat"`
	}
	err := r.db.WithContext(ctx).
		Table("food_nutrition_library").
		Select("id, canonical_name AS name, kcal_per_100g AS calories, protein_per_100g AS protein, carbs_per_100g AS carbs, fat_per_100g AS fat").
		Where("is_active = ? AND kcal_per_100g > 0 AND quality_tier IN ?", true, []string{"authoritative", "reviewed_estimate", "legacy_curated"}).
		Order("RANDOM()").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil
	}
	out := make([]domain.DietRecommendationCandidate, 0, len(rows))
	for _, row := range rows {
		name := strings.TrimSpace(row.Name)
		if name == "" {
			continue
		}
		out = append(out, domain.DietRecommendationCandidate{
			Source:   "food_nutrition_library",
			SourceID: row.ID,
			Title:    name,
			Calories: row.Calories,
			Protein:  row.Protein,
			Carbs:    row.Carbs,
			Fat:      row.Fat,
			Items: []domain.DietRecommendationFoodItem{{
				Name:     name,
				Amount:   "100g",
				Source:   "food_nutrition_library",
				SourceID: row.ID,
			}},
		})
	}
	return out
}

func rowsToDietRecommendationCandidates(rows []dietRecommendationRow, source string) []domain.DietRecommendationCandidate {
	out := make([]domain.DietRecommendationCandidate, 0, len(rows))
	for _, row := range rows {
		title := strings.TrimSpace(row.Title)
		if title == "" {
			title = "餐食方案"
		}
		rawItems := parseDietRecommendationItems(row.ItemsJSON)
		evidence := dietRecommendationNutritionEvidence(rawItems)
		out = append(out, domain.DietRecommendationCandidate{
			Source:                  source,
			SourceID:                row.ID,
			Title:                   title,
			Description:             strings.TrimSpace(row.Description),
			Calories:                row.Calories,
			Protein:                 row.Protein,
			Carbs:                   row.Carbs,
			Fat:                     row.Fat,
			Items:                   normalizeDietRecommendationItems(rawItems, source, row.ID, title),
			IsCampusFood:            row.IsCampusFood,
			SchoolID:                strings.TrimSpace(row.SchoolID),
			SchoolName:              strings.TrimSpace(row.SchoolName),
			CampusID:                strings.TrimSpace(row.CampusID),
			CampusName:              strings.TrimSpace(row.CampusName),
			CanteenID:               strings.TrimSpace(row.CanteenID),
			CanteenName:             strings.TrimSpace(row.CanteenName),
			WindowID:                strings.TrimSpace(row.WindowID),
			WindowName:              strings.TrimSpace(row.WindowName),
			Floor:                   strings.TrimSpace(row.Floor),
			Price:                   row.Price,
			PriceUnit:               strings.TrimSpace(row.PriceUnit),
			ImagePath:               strings.TrimSpace(row.ImagePath),
			NutritionBasis:          evidence.Basis,
			NutritionSourceCategory: evidence.SourceCategory,
			WeightMethod:            evidence.WeightMethod,
			WeightConfidence:        evidence.WeightConfidence,
			UncertaintyLevel:        evidence.UncertaintyLevel,
		})
	}
	return out
}

type dietRecommendationNutritionEvidenceValue struct {
	Basis            string
	SourceCategory   string
	WeightMethod     string
	WeightConfidence float64
	UncertaintyLevel string
}

func dietRecommendationNutritionEvidence(items []map[string]any) dietRecommendationNutritionEvidenceValue {
	evidence := dietRecommendationNutritionEvidenceValue{Basis: "library_record"}
	for _, item := range items {
		sourceCategory := strings.TrimSpace(fmt.Sprintf("%v", item["nutrition_source_category"]))
		weightMethod := strings.TrimSpace(fmt.Sprintf("%v", item["weight_method"]))
		uncertainty := strings.TrimSpace(fmt.Sprintf("%v", item["uncertainty_level"]))
		if sourceCategory != "" && sourceCategory != "<nil>" {
			evidence.SourceCategory = sourceCategory
		}
		if weightMethod != "" && weightMethod != "<nil>" {
			evidence.WeightMethod = weightMethod
		}
		if uncertainty != "" && uncertainty != "<nil>" {
			evidence.UncertaintyLevel = uncertainty
		}
		if value, ok := floatFromAny(item["weight_confidence"]); ok {
			evidence.WeightConfidence = value
		}
		if strings.Contains(strings.ToLower(sourceCategory), "label") {
			evidence.Basis = "nutrition_label"
		} else if sourceCategory == "llm_generated" || weightMethod == "visual_estimate" || weightMethod == "ai_estimate" {
			evidence.Basis = "library_estimate"
		}
		break
	}
	return evidence
}

func floatFromAny(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func (r *StatsRepo) ResolveDietRecommendationSchool(ctx context.Context, question string) (*domain.DietRecommendationSchool, error) {
	normalized := strings.NewReplacer(" ", "", "\t", "", "\n", "", "\r", "").Replace(strings.TrimSpace(question))
	if normalized == "" {
		return nil, nil
	}
	aliases := map[string]string{"北大": "北京大学", "清华": "清华大学"}
	for alias, canonical := range aliases {
		if strings.Contains(normalized, alias) {
			var row domain.DietRecommendationSchool
			err := r.db.WithContext(ctx).Table("schools").Select("id, name").Where("name = ? AND status = ?", canonical, "active").First(&row).Error
			if err == nil {
				return &row, nil
			}
			if err != gorm.ErrRecordNotFound {
				return nil, err
			}
		}
	}
	var rows []domain.DietRecommendationSchool
	if err := r.db.WithContext(ctx).Table("schools").Select("id, name").Where("status = ?", "active").Find(&rows).Error; err != nil {
		return nil, err
	}
	var best *domain.DietRecommendationSchool
	for i := range rows {
		name := strings.ReplaceAll(strings.TrimSpace(rows[i].Name), " ", "")
		if name == "" || !strings.Contains(normalized, name) {
			continue
		}
		if best == nil || len([]rune(name)) > len([]rune(best.Name)) {
			candidate := rows[i]
			best = &candidate
		}
	}
	return best, nil
}

func parseDietRecommendationItems(raw string) []map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var items []map[string]any
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil
	}
	return items
}

func normalizeDietRecommendationItems(items []map[string]any, source string, sourceID string, fallbackTitle string) []domain.DietRecommendationFoodItem {
	out := make([]domain.DietRecommendationFoodItem, 0, len(items))
	for _, item := range items {
		name := strings.TrimSpace(fmt.Sprintf("%v", item["name"]))
		if name == "" || name == "<nil>" {
			continue
		}
		amount := formatDietRecommendationAmount(item)
		out = append(out, domain.DietRecommendationFoodItem{
			Name:     name,
			Amount:   amount,
			Source:   source,
			SourceID: sourceID,
		})
	}
	if len(out) == 0 {
		out = append(out, domain.DietRecommendationFoodItem{
			Name:     fallbackTitle,
			Amount:   "1份",
			Source:   source,
			SourceID: sourceID,
		})
	}
	if len(out) > 5 {
		out = out[:5]
	}
	return out
}

func (r *StatsRepo) UpsertCustomFocusCard(ctx context.Context, card domain.CustomFocusCard) error {
	row := map[string]any{
		"id":               card.ID,
		"user_id":          card.UserID,
		"focus_id":         card.FocusID,
		"range_type":       card.RangeType,
		"generated_date":   card.GeneratedDate,
		"data_fingerprint": card.DataFingerprint,
		"focus_label":      card.FocusLabel,
		"score":            card.Score,
		"brief":            card.Brief,
		"summary":          card.Summary,
		"basis":            card.Basis,
		"action":           card.Action,
		"created_at":       time.Now().UTC(),
	}
	if card.ID == "" {
		row["id"] = uuid.New().String()
	}
	return r.db.WithContext(ctx).
		Table((&domain.CustomFocusCard{}).TableName()).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "user_id"},
				{Name: "range_type"},
				{Name: "focus_id"},
			},
			DoUpdates: clause.AssignmentColumns([]string{
				"generated_date", "data_fingerprint", "focus_label", "score", "brief", "summary", "basis", "action", "created_at",
			}),
		}).
		Create(row).Error
}

func (r *StatsRepo) GetCustomFocusCards(ctx context.Context, userID, rangeType string) ([]domain.CustomFocusCard, error) {
	var rows []domain.CustomFocusCard
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND range_type = ?", userID, rangeType).
		Order("created_at desc").
		Find(&rows).Error
	return rows, err
}

func (r *StatsRepo) GetCustomFocusCard(ctx context.Context, userID, rangeType, focusID string) (*domain.CustomFocusCard, error) {
	var row domain.CustomFocusCard
	if err := r.db.WithContext(ctx).
		Where("user_id = ? AND range_type = ? AND focus_id = ?", userID, rangeType, focusID).
		First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *StatsRepo) CountCustomFocusGenerationsToday(ctx context.Context, userID string) (int64, error) {
	loc := time.FixedZone("Asia/Shanghai", 8*60*60)
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	end := start.Add(24 * time.Hour)

	var count int64
	err := r.db.WithContext(ctx).
		Table((&domain.CustomFocusCard{}).TableName()).
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, start.UTC(), end.UTC()).
		Count(&count).Error
	return count, err
}

func (r *StatsRepo) CountCustomFocusGenerationsTodayForFocus(ctx context.Context, userID, focusID string) (int64, error) {
	loc := time.FixedZone("Asia/Shanghai", 8*60*60)
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	end := start.Add(24 * time.Hour)

	var count int64
	err := r.db.WithContext(ctx).
		Table((&domain.CustomFocusCard{}).TableName()).
		Where("user_id = ? AND focus_id = ? AND created_at >= ? AND created_at < ?", userID, focusID, start.UTC(), end.UTC()).
		Count(&count).Error
	return count, err
}

func formatDietRecommendationAmount(item map[string]any) string {
	if label := strings.TrimSpace(fmt.Sprintf("%v", item["manual_portion_label"])); label != "" && label != "<nil>" {
		return label
	}
	for _, key := range []string{"intake", "weight"} {
		value, ok := item[key]
		if !ok {
			continue
		}
		switch v := value.(type) {
		case float64:
			if v > 0 {
				return fmt.Sprintf("%.0fg", v)
			}
		case int:
			if v > 0 {
				return fmt.Sprintf("%dg", v)
			}
		case int64:
			if v > 0 {
				return fmt.Sprintf("%dg", v)
			}
		}
	}
	return "1份"
}
