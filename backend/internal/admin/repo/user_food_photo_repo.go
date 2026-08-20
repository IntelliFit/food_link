package repo

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"
)

type UserFoodPhotoRepo struct {
	db *gorm.DB
}

func NewUserFoodPhotoRepo(db *gorm.DB) *UserFoodPhotoRepo {
	return &UserFoodPhotoRepo{db: db}
}

type ListUserFoodPhotoInput struct {
	Query  string
	Source string
	Status string
	Limit  int
	Offset int
}

type UserFoodPhoto struct {
	SourceID     string    `gorm:"column:source_id" json:"source_id"`
	SourceType   string    `gorm:"column:source_type" json:"source_type"`
	TaskType     string    `gorm:"column:task_type" json:"task_type"`
	Status       string    `gorm:"column:status" json:"status"`
	RecordID     string    `gorm:"column:record_id" json:"record_id"`
	ImagePath    string    `gorm:"column:image_path" json:"-"`
	ImageURL     string    `gorm:"-" json:"image_url"`
	ThumbnailURL string    `gorm:"-" json:"thumbnail_url"`
	Description  string    `gorm:"column:description" json:"description"`
	UserID       string    `gorm:"column:user_id" json:"user_id"`
	UserNickname string    `gorm:"column:user_nickname" json:"user_nickname"`
	UserAvatar   string    `gorm:"column:user_avatar" json:"user_avatar"`
	UserPhone    string    `gorm:"column:user_phone" json:"user_phone"`
	CreatedAt    time.Time `gorm:"column:created_at" json:"created_at"`
}

type ListUserFoodPhotoResult struct {
	Items []UserFoodPhoto
	Total int64
}

// userFoodPhotoRowsSQL collects raw analysis uploads and saved record images.
// DISTINCT ON prevents the same uploaded object from appearing twice after an
// analysis task is saved as a food record.
const userFoodPhotoRowsSQL = `
WITH task_photos AS (
	SELECT
		t.id::text AS source_id,
		'analysis_task'::text AS source_type,
		t.task_type,
		t.status,
		COALESCE(record.id::text, '') AS record_id,
		photo.image_path,
		COALESCE(NULLIF(t.result->>'description', ''), NULLIF(t.result->>'insight', ''), '') AS description,
		t.user_id::text AS user_id,
		COALESCE(t.created_at, t.updated_at, NOW()) AS created_at,
		0 AS source_priority
	FROM analysis_tasks AS t
	CROSS JOIN LATERAL (
		SELECT DISTINCT BTRIM(candidate.image_path) AS image_path
		FROM (
			SELECT value AS image_path
			FROM jsonb_array_elements_text(COALESCE(t.image_paths, '[]'::jsonb)) AS paths(value)
			UNION ALL
			SELECT t.image_url
		) AS candidate
		WHERE BTRIM(COALESCE(candidate.image_path, '')) <> ''
	) AS photo
	LEFT JOIN LATERAL (
		SELECT r.id
		FROM user_food_records AS r
		WHERE r.source_task_id = t.id
		ORDER BY COALESCE(r.created_at, r.record_time) DESC NULLS LAST
		LIMIT 1
	) AS record ON TRUE
	WHERE (
		t.task_type IN ('food', 'precision_plan')
		OR t.task_type LIKE 'food_debug%'
		OR t.task_type LIKE 'precision_plan_debug%'
	)
	AND LOWER(COALESCE(t.payload->>'internal_benchmark', 'false')) <> 'true'
	AND COALESCE(t.payload->>'campus_catalog_item_id', '') = ''
),
record_photos AS (
	SELECT
		r.id::text AS source_id,
		'food_record'::text AS source_type,
		''::text AS task_type,
		'recorded'::text AS status,
		r.id::text AS record_id,
		photo.image_path,
		COALESCE(r.description, '') AS description,
		r.user_id::text AS user_id,
		COALESCE(r.created_at, r.record_time, NOW()) AS created_at,
		1 AS source_priority
	FROM user_food_records AS r
	CROSS JOIN LATERAL (
		SELECT DISTINCT BTRIM(candidate.image_path) AS image_path
		FROM (
			SELECT value AS image_path
			FROM jsonb_array_elements_text(COALESCE(r.image_paths, '[]'::jsonb)) AS paths(value)
			UNION ALL
			SELECT r.image_path
		) AS candidate
		WHERE BTRIM(COALESCE(candidate.image_path, '')) <> ''
	) AS photo
),
deduplicated AS (
	SELECT DISTINCT ON (user_id, image_path) *
	FROM (
		SELECT * FROM task_photos
		UNION ALL
		SELECT * FROM record_photos
	) AS combined
	ORDER BY user_id, image_path, source_priority, created_at DESC
)
SELECT
	p.source_id,
	p.source_type,
	p.task_type,
	p.status,
	p.record_id,
	p.image_path,
	p.description,
	p.user_id,
	COALESCE(u.nickname, '') AS user_nickname,
	COALESCE(u.avatar, '') AS user_avatar,
	COALESCE(u.telephone, '') AS user_phone,
	p.created_at
FROM deduplicated AS p
LEFT JOIN weapp_user AS u ON u.id::text = p.user_id
`

func (r *UserFoodPhotoRepo) List(ctx context.Context, input ListUserFoodPhotoInput) (*ListUserFoodPhotoResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 40
	}
	if limit > 100 {
		limit = 100
	}
	offset := input.Offset
	if offset < 0 {
		offset = 0
	}

	whereSQL, args := buildUserFoodPhotoFilters(input)
	var total int64
	if err := r.db.WithContext(ctx).
		Raw("SELECT COUNT(*) FROM ("+userFoodPhotoRowsSQL+") AS photos "+whereSQL, args...).
		Scan(&total).Error; err != nil {
		return nil, err
	}

	var items []UserFoodPhoto
	listArgs := append(append([]any{}, args...), limit, offset)
	if err := r.db.WithContext(ctx).
		Raw("SELECT * FROM ("+userFoodPhotoRowsSQL+") AS photos "+whereSQL+" ORDER BY created_at DESC, source_id DESC LIMIT ? OFFSET ?", listArgs...).
		Scan(&items).Error; err != nil {
		return nil, err
	}
	return &ListUserFoodPhotoResult{Items: items, Total: total}, nil
}

func buildUserFoodPhotoFilters(input ListUserFoodPhotoInput) (string, []any) {
	conditions := []string{"1 = 1"}
	args := make([]any, 0, 8)
	if query := strings.TrimSpace(input.Query); query != "" {
		like := "%" + query + "%"
		conditions = append(conditions, `(
			photos.user_id ILIKE ? OR
			photos.user_nickname ILIKE ? OR
			photos.user_phone ILIKE ? OR
			photos.source_id ILIKE ? OR
			photos.description ILIKE ?
		)`)
		args = append(args, like, like, like, like, like)
	}
	if source := strings.TrimSpace(input.Source); source == "analysis_task" || source == "food_record" {
		conditions = append(conditions, "photos.source_type = ?")
		args = append(args, source)
	}
	if status := strings.TrimSpace(input.Status); status != "" && status != "all" {
		conditions = append(conditions, "photos.status = ?")
		args = append(args, status)
	}
	return "WHERE " + strings.Join(conditions, " AND "), args
}
