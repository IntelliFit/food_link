package repo

import (
	"context"
	"encoding/json"
	"fmt"
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
			DoUpdates: clause.AssignmentColumns([]string{"data_fingerprint", "insight_text", "created_at"}),
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
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, start.UTC(), end.UTC()).
		Count(&count).Error
	return count, err
}

func (r *StatsRepo) GetDietRecommendationCandidates(ctx context.Context, userID string, scene string, limit int) ([]domain.DietRecommendationCandidate, error) {
	if limit <= 0 || limit > 50 {
		limit = 24
	}
	out := make([]domain.DietRecommendationCandidate, 0, limit)
	perSourceLimit := limit / 3
	if perSourceLimit < 5 {
		perSourceLimit = 5
	}

	if scene == "eat_out" {
		out = append(out, r.getPublicFoodRecommendationCandidates(ctx, perSourceLimit+3)...)
		out = append(out, r.getUserFoodRecordRecommendationCandidates(ctx, userID, perSourceLimit)...)
		out = append(out, r.getNutritionRecommendationCandidates(ctx, perSourceLimit)...)
	} else {
		out = append(out, r.getNutritionRecommendationCandidates(ctx, perSourceLimit+5)...)
		out = append(out, r.getUserFoodRecordRecommendationCandidates(ctx, userID, perSourceLimit)...)
		out = append(out, r.getPublicFoodRecommendationCandidates(ctx, perSourceLimit)...)
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

type dietRecommendationRow struct {
	ID          string  `gorm:"column:id"`
	Title       string  `gorm:"column:title"`
	Description string  `gorm:"column:description"`
	Calories    float64 `gorm:"column:calories"`
	Protein     float64 `gorm:"column:protein"`
	Carbs       float64 `gorm:"column:carbs"`
	Fat         float64 `gorm:"column:fat"`
	ItemsJSON   string  `gorm:"column:items_json"`
}

func (r *StatsRepo) getPublicFoodRecommendationCandidates(ctx context.Context, limit int) []domain.DietRecommendationCandidate {
	var rows []dietRecommendationRow
	err := r.db.WithContext(ctx).
		Table("public_food_library").
		Select("id, COALESCE(NULLIF(food_name, ''), NULLIF(description, ''), '公共食物') AS title, COALESCE(description, '') AS description, total_calories AS calories, total_protein AS protein, total_carbs AS carbs, total_fat AS fat, COALESCE(CAST(items AS TEXT), '[]') AS items_json").
		Where("status = ? AND total_calories > 0", "published").
		Order("RANDOM()").
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
		Where("is_active = ? AND kcal_per_100g > 0", true).
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
		out = append(out, domain.DietRecommendationCandidate{
			Source:      source,
			SourceID:    row.ID,
			Title:       title,
			Description: strings.TrimSpace(row.Description),
			Calories:    row.Calories,
			Protein:     row.Protein,
			Carbs:       row.Carbs,
			Fat:         row.Fat,
			Items:       normalizeDietRecommendationItems(parseDietRecommendationItems(row.ItemsJSON), source, row.ID, title),
		})
	}
	return out
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
