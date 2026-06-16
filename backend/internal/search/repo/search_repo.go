package repo

import (
	"context"
	"strings"

	"gorm.io/gorm"
)

type ContentRow struct {
	TargetType string `gorm:"column:target_type"`
	TargetID   string `gorm:"column:target_id"`
	UserID     string `gorm:"column:user_id"`

	Description string  `gorm:"column:description"`
	Title       *string `gorm:"column:title"`
	Body        *string `gorm:"column:body"`
	ImagePath   *string `gorm:"column:image_path"`
	ImagePaths  *string `gorm:"column:image_paths"`

	RecordTime *string `gorm:"column:record_time"`
	CreatedAt  *string `gorm:"column:created_at"`

	TotalCalories *float64 `gorm:"column:total_calories"`
	TotalProtein  *float64 `gorm:"column:total_protein"`
	TotalCarbs    *float64 `gorm:"column:total_carbs"`
	TotalFat      *float64 `gorm:"column:total_fat"`
	Fiber         *float64 `gorm:"column:fiber"`
	Sugar         *float64 `gorm:"column:sugar"`
	SodiumMg      *float64 `gorm:"column:sodium_mg"`

	ExerciseDesc  *string  `gorm:"column:exercise_desc"`
	ExerciseType  *string  `gorm:"column:exercise_type"`
	CaloriesBurned *float64 `gorm:"column:calories_burned"`
	DurationMin   *int     `gorm:"column:duration_min"`

	MealType  *string `gorm:"column:meal_type"`
	DietGoal  *string `gorm:"column:diet_goal"`
}

type UserRow struct {
	ID       string `gorm:"column:id"`
	Nickname string `gorm:"column:nickname"`
	Avatar   string `gorm:"column:avatar"`
}

const contentUnionQuery = `
SELECT * FROM (
  SELECT
    'food_record' AS target_type,
    ufr.id::text AS target_id,
    ufr.user_id,
    COALESCE(ufr.description, '') AS description,
    NULL::text AS title,
    NULL::text AS body,
    ufr.image_path,
    NULL::text AS image_paths,
    to_char(ufr.record_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS record_time,
    to_char(ufr.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
    ufr.total_calories,
    ufr.total_protein,
    ufr.total_carbs,
    ufr.total_fat,
    NULL::numeric AS fiber,
    NULL::numeric AS sugar,
    NULL::numeric AS sodium_mg,
    NULL::text AS exercise_desc,
    NULL::text AS exercise_type,
    NULL::numeric AS calories_burned,
    NULL::int AS duration_min,
    ufr.meal_type,
    ufr.diet_goal
  FROM user_food_records ufr
  WHERE ufr.hidden_from_feed = false
    AND ufr.user_id IN (SELECT user_id FROM _search_visible_users)
    AND COALESCE(ufr.description, '') ILIKE '%' || ? || '%'

  UNION ALL

  SELECT
    'exercise_log' AS target_type,
    uel.id::text AS target_id,
    uel.user_id,
    COALESCE(uel.exercise_desc, '') AS description,
    NULL::text AS title,
    NULL::text AS body,
    uel.image_url AS image_path,
    NULL::text AS image_paths,
    to_char(uel.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS record_time,
    to_char(uel.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
    NULL::numeric AS total_calories,
    NULL::numeric AS total_protein,
    NULL::numeric AS total_carbs,
    NULL::numeric AS total_fat,
    NULL::numeric AS fiber,
    NULL::numeric AS sugar,
    NULL::numeric AS sodium_mg,
    uel.exercise_desc,
    uel.exercise_type,
    uel.calories_burned,
    NULL::int AS duration_min,
    NULL::text AS meal_type,
    NULL::text AS diet_goal
  FROM user_exercise_logs uel
  WHERE uel.hidden_from_feed = false
    AND uel.user_id IN (SELECT user_id FROM _search_visible_users)
    AND COALESCE(uel.exercise_desc, '') ILIKE '%' || ? || '%'

  UNION ALL

  SELECT
    'circle_post' AS target_type,
    ucp.id::text AS target_id,
    ucp.user_id,
    '' AS description,
    ucp.title,
    ucp.body,
    NULL::text AS image_path,
    ucp.image_paths::text,
    to_char(ucp.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS record_time,
    to_char(ucp.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
    ucp.total_calories,
    ucp.total_protein,
    ucp.total_carbs,
    ucp.total_fat,
    ucp.fiber,
    ucp.sugar,
    ucp.sodium_mg,
    NULL::text AS exercise_desc,
    NULL::text AS exercise_type,
    NULL::numeric AS calories_burned,
    NULL::int AS duration_min,
    NULL::text AS meal_type,
    NULL::text AS diet_goal
  FROM user_circle_posts ucp
  WHERE ucp.hidden_from_feed = false
    AND ucp.user_id IN (SELECT user_id FROM _search_visible_users)
    AND (
      COALESCE(ucp.title, '') ILIKE '%' || ? || '%'
      OR COALESCE(ucp.body, '') ILIKE '%' || ? || '%'
    )
) results
ORDER BY COALESCE(record_time, created_at) DESC
LIMIT ? OFFSET ?
`

// visibleUsersCTE builds the set of users whose records are visible to currentUserID:
// - users with public_records = true (public to all)
// - the current user themselves
// - friends of the current user
const visibleUsersCTE = `
_search_visible_users AS (
  SELECT id AS user_id FROM weapp_user WHERE COALESCE(public_records, TRUE) = TRUE
  UNION
  SELECT ? AS user_id
  UNION
  SELECT
    CASE WHEN uf.user_id = ? THEN uf.friend_id ELSE uf.user_id END AS user_id
  FROM user_friends uf
  WHERE (uf.user_id = ? OR uf.friend_id = ?)
)
`

type SearchRepo struct {
	db *gorm.DB
}

func NewSearchRepo(db *gorm.DB) *SearchRepo {
	return &SearchRepo{db: db}
}

func (r *SearchRepo) SearchContent(ctx context.Context, currentUserID, keyword string, offset, limit int) ([]ContentRow, error) {
	if limit <= 0 {
		limit = 20
	}
	cte := "WITH " + visibleUsersCTE + " "
	fullQuery := cte + contentUnionQuery

	var rows []ContentRow
	err := r.db.WithContext(ctx).Raw(fullQuery,
		currentUserID, currentUserID, currentUserID, currentUserID,
		keyword, keyword, keyword, keyword,
		limit, offset,
	).Scan(&rows).Error
	return rows, err
}

func (r *SearchRepo) SearchUsers(ctx context.Context, keyword string, offset, limit int) ([]UserRow, error) {
	if limit <= 0 {
		limit = 20
	}
	var rows []UserRow
	err := r.db.WithContext(ctx).
		Table("weapp_user").
		Select("id, nickname, avatar").
		Where("COALESCE(searchable, TRUE) = TRUE").
		Where("LOWER(nickname) LIKE LOWER(?)", "%"+keyword+"%").
		Limit(limit).
		Offset(offset).
		Find(&rows).Error
	return rows, err
}

type UserProfileRow struct {
	ID       string `gorm:"column:id"`
	Nickname string `gorm:"column:nickname"`
	Avatar   string `gorm:"column:avatar"`
}

func (UserProfileRow) TableName() string { return "weapp_user" }

func (r *SearchRepo) GetUserProfiles(ctx context.Context, userIDs []string) (map[string]*UserProfileRow, error) {
	if len(userIDs) == 0 {
		return map[string]*UserProfileRow{}, nil
	}
	var rows []UserProfileRow
	err := r.db.WithContext(ctx).Where("id IN ?", userIDs).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]*UserProfileRow)
	for i := range rows {
		result[rows[i].ID] = &rows[i]
	}
	return result, nil
}

func (r *SearchRepo) GetFriendIDs(ctx context.Context, userID string) (map[string]bool, error) {
	type friendRow struct {
		UserID   string `gorm:"column:user_id"`
		FriendID string `gorm:"column:friend_id"`
	}
	var rows []friendRow
	err := r.db.WithContext(ctx).
		Table("user_friends").
		Select("user_id, friend_id").
		Where("user_id = ? OR friend_id = ?", userID, userID).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]bool)
	for _, row := range rows {
		if row.UserID == userID {
			result[row.FriendID] = true
		} else {
			result[row.UserID] = true
		}
	}
	return result, nil
}
		func (r *SearchRepo) CountContent(ctx context.Context, currentUserID, keyword string) (int64, error) {
			cte := "WITH " + visibleUsersCTE + " "
			countQuery := cte + `
		SELECT COUNT(*) FROM (
		  SELECT ufr.id FROM user_food_records ufr
		  WHERE ufr.hidden_from_feed = false
		    AND ufr.user_id IN (SELECT user_id FROM _search_visible_users)
		    AND COALESCE(ufr.description, '') ILIKE '%' || ? || '%'
		  UNION ALL
		  SELECT uel.id FROM user_exercise_logs uel
		  WHERE uel.hidden_from_feed = false
		    AND uel.user_id IN (SELECT user_id FROM _search_visible_users)
		    AND COALESCE(uel.exercise_desc, '') ILIKE '%' || ? || '%'
		  UNION ALL
		  SELECT ucp.id FROM user_circle_posts ucp
		  WHERE ucp.hidden_from_feed = false
		    AND ucp.user_id IN (SELECT user_id FROM _search_visible_users)
		    AND (COALESCE(ucp.title, '') ILIKE '%' || ? || '%' OR COALESCE(ucp.body, '') ILIKE '%' || ? || '%')
		) sub
		`
			var count int64
			err := r.db.WithContext(ctx).Raw(countQuery,
				currentUserID, currentUserID, currentUserID, currentUserID,
				keyword, keyword, keyword, keyword,
			).Scan(&count).Error
			return count, err
		}

		func (r *SearchRepo) CountUsers(ctx context.Context, keyword string) (int64, error) {
			var count int64
			err := r.db.WithContext(ctx).
				Table("weapp_user").
				Where("COALESCE(searchable, TRUE) = TRUE").
				Where("LOWER(nickname) LIKE LOWER(?)", "%"+keyword+"%").
				Count(&count).Error
			return count, err
		}
type LikeTarget struct {
	TargetType string
	TargetID   string
}

type TargetLikeInfo struct {
	Count int
	Liked bool
}

func (r *SearchRepo) GetLikesForTargets(ctx context.Context, targets []LikeTarget, currentUserID string) (map[string]*TargetLikeInfo, error) {
	result := make(map[string]*TargetLikeInfo)
	for _, t := range targets {
		key := t.TargetType + ":" + t.TargetID
		result[key] = &TargetLikeInfo{}
	}
	if len(targets) == 0 {
		return result, nil
	}

	type likeRow struct {
		TargetType string `gorm:"column:target_type"`
		TargetID   string `gorm:"column:target_id"`
		RecordID   *string `gorm:"column:record_id"`
		UserID     string `gorm:"column:user_id"`
	}

	// Build OR conditions for all targets
	var conditions []string
	var args []any
	for _, t := range targets {
		if t.TargetType == "food_record" {
			conditions = append(conditions, "(target_type = ? AND target_id = ?)")
			args = append(args, t.TargetType, t.TargetID)
			conditions = append(conditions, "(record_id = ?)")
			args = append(args, t.TargetID)
		} else {
			conditions = append(conditions, "(target_type = ? AND target_id = ?)")
			args = append(args, t.TargetType, t.TargetID)
		}
	}

	var rows []likeRow
	query := strings.Join(conditions, " OR ")
	if err := r.db.WithContext(ctx).Table("feed_likes").Where(query, args...).Find(&rows).Error; err != nil {
		return nil, err
	}

	for _, row := range rows {
		targetType := row.TargetType
		targetID := row.TargetID
		if targetType == "" && row.RecordID != nil {
			targetType = "food_record"
			targetID = *row.RecordID
		}
		key := targetType + ":" + targetID
		if info, ok := result[key]; ok {
			info.Count++
			if row.UserID == currentUserID {
				info.Liked = true
			}
		}
	}
	return result, nil
}

func (r *SearchRepo) CountCommentsForTargets(ctx context.Context, targets []LikeTarget) (map[string]int64, error) {
	result := make(map[string]int64)
	if len(targets) == 0 {
		return result, nil
	}

	type countRow struct {
		TargetType string `gorm:"column:target_type"`
		TargetID   string `gorm:"column:target_id"`
		RecordID   *string `gorm:"column:record_id"`
		Cnt        int64  `gorm:"column:cnt"`
	}

	var conditions []string
	var args []any
	for _, t := range targets {
		if t.TargetType == "food_record" {
			conditions = append(conditions, "(target_type = ? AND target_id = ?)")
			args = append(args, t.TargetType, t.TargetID)
			conditions = append(conditions, "(record_id = ?)")
			args = append(args, t.TargetID)
		} else {
			conditions = append(conditions, "(target_type = ? AND target_id = ?)")
			args = append(args, t.TargetType, t.TargetID)
		}
	}

	var rows []countRow
	query := strings.Join(conditions, " OR ")
	q := r.db.WithContext(ctx).Table("feed_comments").
		Select("target_type, target_id, record_id, COUNT(*) AS cnt").
		Where(query, args...).
		Group("target_type, target_id, record_id")
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}

	for _, row := range rows {
		targetType := row.TargetType
		targetID := row.TargetID
		if targetType == "" && row.RecordID != nil {
			targetType = "food_record"
			targetID = *row.RecordID
		}
		key := targetType + ":" + targetID
		result[key] += row.Cnt
	}
	return result, nil
}
