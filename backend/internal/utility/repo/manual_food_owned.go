package repo

import (
	"context"
	"strings"

	fooddomain "food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/utility/domain"
)

// Ownership comes from the user's custom rows or their actual import history,
// never from browsing/recording someone else's public food. Reward status is
// irrelevant: reaching a daily reward cap must not hide a successful import.
const ownedManualFoodRefsSQL = `
SELECT source, id FROM (
  SELECT 'custom' AS source, id::text AS id, COALESCE(updated_at, created_at) AS saved_at
  FROM user_custom_foods WHERE user_id = ? AND status <> 'deleted'
  UNION ALL
  SELECT 'packaged_food' AS source, p.id::text AS id, imports.saved_at
  FROM packaged_food_library p JOIN (
    SELECT food_id, MAX(imported_at) AS saved_at FROM (
      SELECT packaged_food_id::text AS food_id, created_at AS imported_at
      FROM reward_task_uploads
      WHERE user_id = ? AND task_type = 'packaged_food_upload' AND packaged_food_id IS NOT NULL
      UNION ALL
      SELECT COALESCE(NULLIF(result->'packaged_product'->>'packaged_food_id', ''),
        NULLIF(result->'packaged_product'->'auto_ingest_result'->>'packaged_food_id', ''),
        NULLIF(result->'nutrition'->>'packaged_food_id', '')) AS food_id, created_at AS imported_at
      FROM analysis_tasks
      WHERE user_id = ? AND task_type = 'packaged_product_extract' AND status = 'done'
    ) history WHERE COALESCE(food_id, '') <> '' GROUP BY food_id
  ) imports ON imports.food_id = p.id::text
  WHERE p.is_active = TRUE AND COALESCE(NULLIF(p.review_status, ''), 'active') = 'active'
) foods ORDER BY saved_at DESC NULLS LAST, source, id LIMIT ? OFFSET ?`

// Preserve the original custom-only response for clients without source/unit support.
func (r *ManualFoodRepo) listStoredCustomFoods(ctx context.Context, userID string, limit, offset int) ([]domain.ManualFoodResult, bool, error) {
	if strings.TrimSpace(userID) == "" {
		return []domain.ManualFoodResult{}, false, nil
	}
	limit = clampLimit(limit, 30, 120)
	if offset < 0 {
		offset = 0
	}
	var rows []domain.UserCustomFood
	if err := r.db.WithContext(ctx).Where("user_id = ? AND status <> ?", userID, "deleted").
		Order("updated_at desc NULLS LAST, created_at desc NULLS LAST").Limit(limit + 1).Offset(offset).Find(&rows).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	items := make([]domain.ManualFoodResult, 0, len(rows))
	for _, row := range rows {
		items = append(items, r.manualFoodResultFromCustomFood(row, userID))
	}
	return items, hasMore, nil
}

func (r *ManualFoodRepo) listOwnedManualFoods(ctx context.Context, userID string, limit, offset int) ([]domain.ManualFoodResult, bool, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return []domain.ManualFoodResult{}, false, nil
	}
	limit = clampLimit(limit, 30, 120)
	if offset < 0 {
		offset = 0
	}
	var refs []struct{ Source, ID string }
	if err := r.db.WithContext(ctx).Raw(ownedManualFoodRefsSQL, userID, userID, userID, limit+1, offset).Scan(&refs).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(refs) > limit
	if hasMore {
		refs = refs[:limit]
	}
	customIDs, packagedIDs := []string{}, []string{}
	for _, ref := range refs {
		if ref.Source == "custom" {
			customIDs = append(customIDs, ref.ID)
		} else {
			packagedIDs = append(packagedIDs, ref.ID)
		}
	}
	byKey := make(map[string]domain.ManualFoodResult, len(refs))
	if len(customIDs) > 0 {
		var rows []domain.UserCustomFood
		if err := r.db.WithContext(ctx).Where("id IN ? AND user_id = ? AND status <> 'deleted'", customIDs, userID).Find(&rows).Error; err != nil {
			return nil, false, err
		}
		for _, row := range rows {
			byKey["custom:"+row.ID] = r.manualFoodResultFromCustomFood(row, userID)
		}
	}
	if len(packagedIDs) > 0 {
		var rows []fooddomain.PackagedFood
		if err := r.db.WithContext(ctx).Where("id IN ? AND is_active = TRUE AND COALESCE(NULLIF(review_status, ''), 'active') = 'active'", packagedIDs).Find(&rows).Error; err != nil {
			return nil, false, err
		}
		for _, row := range rows {
			item := r.manualFoodResultFromPackaged(row, 0)
			item.SourceLabel = "包装导入"
			item.CanEdit = false // Public package corrections use their existing review flow.
			byKey["packaged_food:"+row.ID] = item
		}
	}
	items := make([]domain.ManualFoodResult, 0, len(refs))
	for _, ref := range refs {
		if item, ok := byKey[ref.Source+":"+ref.ID]; ok {
			items = append(items, item)
		}
	}
	return items, hasMore, nil
}
