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
		OR t.task_type = 'packaged_nutrition_label'
		OR t.task_type LIKE 'packaged_nutrition_label_debug%'
		OR t.task_type = 'packaged_product_extract'
		OR t.task_type LIKE 'packaged_product_extract_debug%'
		OR t.task_type = 'expiry_recognize'
		OR t.task_type LIKE 'expiry_recognize_debug%'
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
public_food_photos AS (
	SELECT
		p.id::text AS source_id,
		'public_food'::text AS source_type,
		''::text AS task_type,
		p.status,
		COALESCE(p.source_record_id::text, '') AS record_id,
		photo.image_path,
		COALESCE(NULLIF(p.food_name, ''), NULLIF(p.description, ''), '') AS description,
		p.user_id::text AS user_id,
		COALESCE(p.created_at, p.updated_at, NOW()) AS created_at,
		2 AS source_priority
	FROM public_food_library AS p
	CROSS JOIN LATERAL (
		SELECT DISTINCT BTRIM(candidate.image_path) AS image_path
		FROM (
			SELECT value AS image_path
			FROM jsonb_array_elements_text(COALESCE(p.image_paths, '[]'::jsonb)) AS paths(value)
			UNION ALL
			SELECT p.image_path
		) AS candidate
		WHERE BTRIM(COALESCE(candidate.image_path, '')) <> ''
	) AS photo
	WHERE p.user_id IS NOT NULL
),
packaged_correction_photos AS (
	SELECT
		c.id::text AS source_id,
		'packaged_correction'::text AS source_type,
		''::text AS task_type,
		c.status,
		''::text AS record_id,
		BTRIM(photo.image_path) AS image_path,
		COALESCE(c.comment, '') AS description,
		c.user_id::text AS user_id,
		COALESCE(c.created_at, c.updated_at, NOW()) AS created_at,
		2 AS source_priority
	FROM packaged_food_correction_submissions AS c
	CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(c.evidence_image_urls, '[]'::jsonb)) AS photo(image_path)
	WHERE BTRIM(COALESCE(photo.image_path, '')) <> ''
	AND c.deleted_at IS NULL
),
recipe_photos AS (
	SELECT
		r.id::text AS source_id,
		'user_recipe'::text AS source_type,
		''::text AS task_type,
		'saved'::text AS status,
		''::text AS record_id,
		BTRIM(r.image_path) AS image_path,
		COALESCE(NULLIF(r.recipe_name, ''), NULLIF(r.description, ''), '') AS description,
		r.user_id::text AS user_id,
		COALESCE(r.created_at, r.updated_at, NOW()) AS created_at,
		2 AS source_priority
	FROM user_recipes AS r
	WHERE BTRIM(COALESCE(r.image_path, '')) <> ''
),
deduplicated AS (
	SELECT DISTINCT ON (user_id, image_path) *
	FROM (
		SELECT * FROM task_photos
		UNION ALL
		SELECT * FROM record_photos
		UNION ALL
		SELECT * FROM public_food_photos
		UNION ALL
		SELECT * FROM packaged_correction_photos
		UNION ALL
		SELECT * FROM recipe_photos
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
	if source := strings.TrimSpace(input.Source); isUserFoodPhotoSource(source) {
		conditions = append(conditions, "photos.source_type = ?")
		args = append(args, source)
	}
	if status := strings.TrimSpace(input.Status); status != "" && status != "all" {
		conditions = append(conditions, "photos.status = ?")
		args = append(args, status)
	}
	return "WHERE " + strings.Join(conditions, " AND "), args
}

func isUserFoodPhotoSource(source string) bool {
	switch source {
	case "analysis_task", "food_record", "public_food", "packaged_correction", "user_recipe":
		return true
	default:
		return false
	}
}
