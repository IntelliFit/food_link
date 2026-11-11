package repo

import (
	"context"
	"time"
)

type ContributionCounts struct {
	UserID   string
	Total    int
	Standard int
	Packaged int
	Meals    int
	Custom   int
}

// A package import is a contribution only with creation evidence, not merely
// recognition of an existing product. Deduplicate claims before filtering the
// month, so editing/re-importing an old entry cannot create a new monthly score.
const contributionEventsSQL = `
WITH package_claims AS (
  SELECT user_id, packaged_food_id::text AS food_id, created_at AS claimed_at
  FROM reward_task_uploads
  WHERE task_type = 'packaged_food_upload' AND packaged_food_id IS NOT NULL
    AND COALESCE(meta->>'upsert_action', 'created') = 'created'
  UNION ALL
  SELECT user_id,
    COALESCE(NULLIF(result->'packaged_product'->>'packaged_food_id', ''),
      result->'packaged_product'->'auto_ingest_result'->>'packaged_food_id'), created_at
  FROM analysis_tasks WHERE task_type = 'packaged_product_extract' AND status = 'done'
    AND result->'packaged_product'->'auto_ingest_result'->>'upsert_action' = 'created'
), events AS (
  SELECT 'packaged:' || p.id::text AS food_key, c.user_id::text AS user_id, 'packaged' AS kind,
    COALESCE(p.created_at, c.claimed_at) AS contributed_at, c.claimed_at
  FROM package_claims c JOIN packaged_food_library p ON p.id::text = c.food_id
  WHERE p.is_active = TRUE AND COALESCE(NULLIF(p.review_status, ''), 'active') = 'active'
  UNION ALL
  SELECT 'standard:' || f.target_food_id::text, f.user_id::text, 'standard',
    COALESCE(f.reviewed_at, f.created_at), COALESCE(f.reviewed_at, f.created_at)
  FROM food_nutrition_contributions f JOIN food_nutrition_library n ON n.id = f.target_food_id
  WHERE f.status = 'approved' AND f.review_action = 'approve_new' AND n.is_active = TRUE
  UNION ALL
  SELECT 'meal:' || p.id::text, p.user_id::text, 'meals', p.created_at, p.created_at
  FROM public_food_library p WHERE p.status = 'published'
  UNION ALL
  SELECT 'custom:' || c.id::text, c.user_id::text, 'custom', c.created_at, c.created_at
  FROM user_custom_foods c WHERE c.status = 'active' AND c.public_status = 'published'
    AND NOT EXISTS (SELECT 1 FROM food_nutrition_contributions f
      WHERE f.legacy_custom_food_id = c.id AND f.status = 'approved')
    AND NOT EXISTS (SELECT 1 FROM public_food_library p
      WHERE p.id = c.public_food_item_id AND p.status = 'published')
), claimed AS (
  SELECT DISTINCT ON (food_key) food_key, user_id, kind, contributed_at
  FROM events WHERE COALESCE(user_id, '') <> ''
  ORDER BY food_key, claimed_at ASC NULLS LAST, user_id
)
SELECT c.user_id, COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE kind = 'standard')::int AS standard,
  COUNT(*) FILTER (WHERE kind = 'packaged')::int AS packaged,
  COUNT(*) FILTER (WHERE kind = 'meals')::int AS meals,
  COUNT(*) FILTER (WHERE kind = 'custom')::int AS custom
FROM claimed c JOIN weapp_user u ON u.id::text = c.user_id WHERE TRUE`

func (r *FeedRepo) GetContributionCounts(ctx context.Context, start, end *time.Time) (map[string]ContributionCounts, error) {
	query, args := contributionEventsSQL, []any{}
	if start != nil && end != nil {
		query += " AND c.contributed_at >= ? AND c.contributed_at < ?"
		args = append(args, *start, *end)
	}
	// Account deletion is an independently deployed capability; do not require
	// its table on environments where that dedicated migration is not installed.
	var hasDeletionTable bool
	if err := r.db.WithContext(ctx).Raw(`SELECT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'account_deletions')`).Scan(&hasDeletionTable).Error; err != nil {
		return nil, err
	}
	if hasDeletionTable {
		query += " AND NOT EXISTS (SELECT 1 FROM account_deletions d WHERE d.user_id::text = c.user_id AND d.state <> 'cancelled')"
	}
	query += " GROUP BY c.user_id"
	var rows []ContributionCounts
	if err := r.db.WithContext(ctx).Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]ContributionCounts, len(rows))
	for _, row := range rows {
		counts[row.UserID] = row
	}
	return counts, nil
}
