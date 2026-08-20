package repo

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type UserFoodPhotoRepo struct {
	db *gorm.DB
}

func NewUserFoodPhotoRepo(db *gorm.DB) *UserFoodPhotoRepo {
	return &UserFoodPhotoRepo{db: db}
}

type ListUserFoodPhotoInput struct {
	Query            string
	Source           string
	Status           string
	CircleVisibility string
	SortBy           string
	SortOrder        string
	Limit            int
	Offset           int
}

type UserFoodPhoto struct {
	SourceID         string                  `gorm:"column:source_id" json:"source_id"`
	SourceType       string                  `gorm:"column:source_type" json:"source_type"`
	TaskType         string                  `gorm:"column:task_type" json:"task_type"`
	Status           string                  `gorm:"column:status" json:"status"`
	RecordID         string                  `gorm:"column:record_id" json:"record_id"`
	ImagePath        string                  `gorm:"column:image_path" json:"-"`
	ImageURL         string                  `gorm:"-" json:"image_url"`
	ThumbnailURL     string                  `gorm:"-" json:"thumbnail_url"`
	Description      string                  `gorm:"column:description" json:"description"`
	UserID           string                  `gorm:"column:user_id" json:"user_id"`
	UserNickname     string                  `gorm:"column:user_nickname" json:"user_nickname"`
	UserAvatar       string                  `gorm:"column:user_avatar" json:"user_avatar"`
	UserPhone        string                  `gorm:"column:user_phone" json:"user_phone"`
	CircleVisibility string                  `gorm:"column:circle_visibility" json:"circle_visibility"`
	Nutrition        *UserFoodPhotoNutrition `gorm:"-" json:"nutrition,omitempty"`
	CreatedAt        time.Time               `gorm:"column:created_at" json:"created_at"`
}

type UserFoodPhotoNutrition struct {
	Source         string   `json:"source"`
	ItemCount      int      `json:"item_count"`
	ItemNames      []string `json:"item_names,omitempty"`
	Calories       float64  `json:"calories"`
	Protein        float64  `json:"protein"`
	Carbs          float64  `json:"carbs"`
	Fat            float64  `json:"fat"`
	Fiber          float64  `json:"fiber"`
	Sugar          float64  `json:"sugar"`
	SaturatedFat   float64  `json:"saturated_fat"`
	CholesterolMg  float64  `json:"cholesterol_mg"`
	SodiumMg       float64  `json:"sodium_mg"`
	PotassiumMg    float64  `json:"potassium_mg"`
	CalciumMg      float64  `json:"calcium_mg"`
	IronMg         float64  `json:"iron_mg"`
	MagnesiumMg    float64  `json:"magnesium_mg"`
	ZincMg         float64  `json:"zinc_mg"`
	VitaminARaeMcg float64  `json:"vitamin_a_rae_mcg"`
	VitaminCMg     float64  `json:"vitamin_c_mg"`
	VitaminDMcg    float64  `json:"vitamin_d_mcg"`
	VitaminEMg     float64  `json:"vitamin_e_mg"`
	VitaminKMcg    float64  `json:"vitamin_k_mcg"`
	ThiaminMg      float64  `json:"thiamin_mg"`
	RiboflavinMg   float64  `json:"riboflavin_mg"`
	NiacinMg       float64  `json:"niacin_mg"`
	VitaminB6Mg    float64  `json:"vitamin_b6_mg"`
	FolateMcg      float64  `json:"folate_mcg"`
	VitaminB12Mcg  float64  `json:"vitamin_b12_mcg"`
}

type userFoodPhotoNutritionRow struct {
	ID            string         `gorm:"column:id"`
	Items         datatypes.JSON `gorm:"column:items"`
	TotalCalories float64        `gorm:"column:total_calories"`
	TotalProtein  float64        `gorm:"column:total_protein"`
	TotalCarbs    float64        `gorm:"column:total_carbs"`
	TotalFat      float64        `gorm:"column:total_fat"`
}

type userFoodPhotoNutritionItem struct {
	Name      string                             `json:"name"`
	Nutrients foodrecorddomain.FoodItemNutrients `json:"nutrients"`
}

type ListUserFoodPhotoResult struct {
	Items []UserFoodPhoto
	Total int64
}

// userFoodPhotoRowsSQLTemplate collects raw analysis uploads and saved record images.
// DISTINCT ON prevents the same uploaded object from appearing twice after an
// analysis task is saved as a food record.
const userFoodPhotoRowsSQLTemplate = `
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
	{{packaged_correction_photos}}
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
	CASE
		WHEN p.source_type IN ('analysis_task', 'food_record') OR p.record_id <> '' THEN
			CASE
				WHEN p.record_id = '' OR circle_record.id IS NULL THEN 'not_shared'
				WHEN circle_record.hidden_from_feed OR NOT COALESCE(u.public_records, TRUE) THEN 'not_shared'
				ELSE 'visible'
			END
		ELSE 'not_applicable'
	END AS circle_visibility,
	p.created_at
FROM deduplicated AS p
LEFT JOIN weapp_user AS u ON u.id::text = p.user_id
LEFT JOIN user_food_records AS circle_record ON circle_record.id::text = p.record_id
`

const packagedCorrectionPhotosSQL = `
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
`

const emptyPackagedCorrectionPhotosSQL = `
	SELECT
		NULL::text AS source_id,
		'packaged_correction'::text AS source_type,
		''::text AS task_type,
		''::text AS status,
		''::text AS record_id,
		NULL::text AS image_path,
		''::text AS description,
		NULL::text AS user_id,
		NULL::timestamptz AS created_at,
		2 AS source_priority
	WHERE FALSE
`

func buildUserFoodPhotoRowsSQL(includePackagedCorrections bool) string {
	packagedCorrectionsSQL := emptyPackagedCorrectionPhotosSQL
	if includePackagedCorrections {
		packagedCorrectionsSQL = packagedCorrectionPhotosSQL
	}
	return strings.Replace(userFoodPhotoRowsSQLTemplate, "{{packaged_correction_photos}}", packagedCorrectionsSQL, 1)
}

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

	rowsSQL := buildUserFoodPhotoRowsSQL(r.db.WithContext(ctx).Migrator().HasTable("packaged_food_correction_submissions"))
	whereSQL, args := buildUserFoodPhotoFilters(input)
	var total int64
	if err := r.db.WithContext(ctx).
		Raw("SELECT COUNT(*) FROM ("+rowsSQL+") AS photos "+whereSQL, args...).
		Scan(&total).Error; err != nil {
		return nil, err
	}

	var items []UserFoodPhoto
	listSQL := "SELECT * FROM (" + rowsSQL + ") AS photos " + whereSQL
	listSQL, orderSQL := buildUserFoodPhotoSort(listSQL, input)
	listArgs := append(append([]any{}, args...), limit, offset)
	if err := r.db.WithContext(ctx).
		Raw(listSQL+" "+orderSQL+" LIMIT ? OFFSET ?", listArgs...).
		Scan(&items).Error; err != nil {
		return nil, err
	}
	if err := r.attachNutrition(ctx, items); err != nil {
		return nil, err
	}
	return &ListUserFoodPhotoResult{Items: items, Total: total}, nil
}

type userFoodPhotoNutrientSort struct {
	keys       []string
	totalField string
}

var userFoodPhotoNutrientSorts = map[string]userFoodPhotoNutrientSort{
	"calories":          {keys: []string{"calories"}, totalField: "total_calories"},
	"protein":           {keys: []string{"protein"}, totalField: "total_protein"},
	"carbs":             {keys: []string{"carbs", "carbohydrate", "carbohydrates"}, totalField: "total_carbs"},
	"fat":               {keys: []string{"fat"}, totalField: "total_fat"},
	"fiber":             {keys: []string{"fiber", "dietary_fiber", "fibre"}},
	"sugar":             {keys: []string{"sugar", "total_sugar", "sugars"}},
	"saturated_fat":     {keys: []string{"saturatedFat", "saturated_fat"}},
	"cholesterol_mg":    {keys: []string{"cholesterolMg", "cholesterol_mg"}},
	"sodium_mg":         {keys: []string{"sodiumMg", "sodium_mg"}},
	"potassium_mg":      {keys: []string{"potassiumMg", "potassium_mg"}},
	"calcium_mg":        {keys: []string{"calciumMg", "calcium_mg"}},
	"iron_mg":           {keys: []string{"ironMg", "iron_mg"}},
	"magnesium_mg":      {keys: []string{"magnesiumMg", "magnesium_mg"}},
	"zinc_mg":           {keys: []string{"zincMg", "zinc_mg"}},
	"vitamin_a_rae_mcg": {keys: []string{"vitaminARaeMcg", "vitamin_a_rae_mcg"}},
	"vitamin_c_mg":      {keys: []string{"vitaminCMg", "vitamin_c_mg"}},
	"vitamin_d_mcg":     {keys: []string{"vitaminDMcg", "vitamin_d_mcg"}},
	"vitamin_e_mg":      {keys: []string{"vitaminEMg", "vitamin_e_mg"}},
	"vitamin_k_mcg":     {keys: []string{"vitaminKMcg", "vitamin_k_mcg"}},
	"thiamin_mg":        {keys: []string{"thiaminMg", "thiamin_mg"}},
	"riboflavin_mg":     {keys: []string{"riboflavinMg", "riboflavin_mg"}},
	"niacin_mg":         {keys: []string{"niacinMg", "niacin_mg"}},
	"vitamin_b6_mg":     {keys: []string{"vitaminB6Mg", "vitamin_b6_mg"}},
	"folate_mcg":        {keys: []string{"folateMcg", "folate_mcg"}},
	"vitamin_b12_mcg":   {keys: []string{"vitaminB12Mcg", "vitamin_b12_mcg"}},
}

func buildUserFoodPhotoSort(filteredSQL string, input ListUserFoodPhotoInput) (string, string) {
	direction := "DESC"
	if strings.EqualFold(strings.TrimSpace(input.SortOrder), "asc") {
		direction = "ASC"
	}
	sortBy := strings.TrimSpace(input.SortBy)
	if sortBy == "" || sortBy == "created_at" {
		return filteredSQL, "ORDER BY photos.created_at " + direction + ", photos.source_id DESC"
	}
	nutrient, ok := userFoodPhotoNutrientSorts[sortBy]
	if !ok {
		return filteredSQL, "ORDER BY photos.created_at " + direction + ", photos.source_id DESC"
	}

	itemValueSQL := buildUserFoodPhotoNutrientValueSQL(nutrient.keys)
	query := `SELECT photos.*
		FROM (` + filteredSQL + `) AS photos
		LEFT JOIN user_food_records AS nutrition_record ON nutrition_record.id::text = photos.record_id
		LEFT JOIN analysis_tasks AS nutrition_task ON photos.source_type = 'analysis_task' AND nutrition_task.id::text = photos.source_id
		LEFT JOIN public_food_library AS nutrition_public ON photos.source_type = 'public_food' AND nutrition_public.id::text = photos.source_id
		LEFT JOIN LATERAL (
			SELECT COUNT(*) AS item_count, COALESCE(SUM(` + itemValueSQL + `), 0) AS nutrient_value
			FROM jsonb_array_elements(` + userFoodPhotoNutritionItemsSQL + `) AS selected_item(item)
		) AS nutrition_sort ON TRUE`

	valueSQL := "CASE WHEN nutrition_sort.item_count > 0 THEN nutrition_sort.nutrient_value ELSE NULL END"
	if nutrient.totalField != "" {
		valueSQL = `CASE
			WHEN nutrition_record.id IS NOT NULL AND (nutrition_record.` + nutrient.totalField + ` > 0 OR nutrition_sort.item_count > 0)
				THEN COALESCE(NULLIF(nutrition_record.` + nutrient.totalField + `, 0), nutrition_sort.nutrient_value)
			WHEN photos.source_type = 'public_food' AND nutrition_public.id IS NOT NULL AND (nutrition_public.` + nutrient.totalField + ` > 0 OR nutrition_sort.item_count > 0)
				THEN COALESCE(NULLIF(nutrition_public.` + nutrient.totalField + `, 0), nutrition_sort.nutrient_value)
			WHEN nutrition_sort.item_count > 0 THEN nutrition_sort.nutrient_value
			ELSE NULL
		END`
	}
	return query, "ORDER BY " + valueSQL + " " + direction + " NULLS LAST, photos.created_at DESC, photos.source_id DESC"
}

const userFoodPhotoNutritionItemsSQL = `CASE
	WHEN nutrition_record.id IS NOT NULL AND (
		CASE WHEN jsonb_typeof(nutrition_record.items) = 'array' THEN jsonb_array_length(nutrition_record.items) ELSE 0 END > 0
		OR COALESCE(nutrition_record.total_calories, 0) > 0
		OR COALESCE(nutrition_record.total_protein, 0) > 0
		OR COALESCE(nutrition_record.total_carbs, 0) > 0
		OR COALESCE(nutrition_record.total_fat, 0) > 0
	) THEN CASE WHEN jsonb_typeof(nutrition_record.items) = 'array' THEN nutrition_record.items ELSE '[]'::jsonb END
	WHEN photos.source_type = 'analysis_task' AND jsonb_typeof(nutrition_task.result->'items') = 'array' THEN nutrition_task.result->'items'
	WHEN photos.source_type = 'public_food' AND jsonb_typeof(nutrition_public.items) = 'array' THEN nutrition_public.items
	ELSE '[]'::jsonb
END`

func buildUserFoodPhotoNutrientValueSQL(keys []string) string {
	clauses := make([]string, 0, len(keys))
	for _, key := range keys {
		clauses = append(clauses, "WHEN jsonb_typeof(selected_item.item->'nutrients'->'"+key+"') = 'number' THEN (selected_item.item->'nutrients'->>'"+key+"')::numeric")
	}
	return "CASE " + strings.Join(clauses, " ") + " ELSE 0 END"
}

func (r *UserFoodPhotoRepo) attachNutrition(ctx context.Context, items []UserFoodPhoto) error {
	recordIDs := make([]string, 0, len(items))
	taskIDs := make([]string, 0, len(items))
	publicFoodIDs := make([]string, 0, len(items))
	for i := range items {
		if items[i].RecordID != "" {
			recordIDs = append(recordIDs, items[i].RecordID)
		}
		switch items[i].SourceType {
		case "analysis_task":
			taskIDs = append(taskIDs, items[i].SourceID)
		case "public_food":
			publicFoodIDs = append(publicFoodIDs, items[i].SourceID)
		}
	}

	records, err := r.listNutritionRows(ctx, "user_food_records", recordIDs, "items")
	if err != nil {
		return err
	}
	tasks, err := r.listNutritionRows(ctx, "analysis_tasks", taskIDs,
		"CASE WHEN jsonb_typeof(result->'items') = 'array' THEN result->'items' ELSE '[]'::jsonb END AS items, 0 AS total_calories, 0 AS total_protein, 0 AS total_carbs, 0 AS total_fat")
	if err != nil {
		return err
	}
	publicFoods, err := r.listNutritionRows(ctx, "public_food_library", publicFoodIDs, "items")
	if err != nil {
		return err
	}

	for i := range items {
		item := &items[i]
		if row, ok := records[item.RecordID]; ok {
			item.Nutrition = buildUserFoodPhotoNutrition("food_record", row)
		}
		if item.Nutrition == nil && item.SourceType == "analysis_task" {
			if row, ok := tasks[item.SourceID]; ok {
				item.Nutrition = buildUserFoodPhotoNutrition("analysis_result", row)
			}
		}
		if item.Nutrition == nil && item.SourceType == "public_food" {
			if row, ok := publicFoods[item.SourceID]; ok {
				item.Nutrition = buildUserFoodPhotoNutrition("public_food", row)
			}
		}
	}
	return nil
}

func (r *UserFoodPhotoRepo) listNutritionRows(ctx context.Context, table string, ids []string, itemsProjection string) (map[string]userFoodPhotoNutritionRow, error) {
	rowsByID := make(map[string]userFoodPhotoNutritionRow, len(ids))
	if len(ids) == 0 {
		return rowsByID, nil
	}
	projection := "id::text AS id, " + itemsProjection
	if itemsProjection == "items" {
		projection += ", COALESCE(total_calories, 0) AS total_calories, COALESCE(total_protein, 0) AS total_protein, COALESCE(total_carbs, 0) AS total_carbs, COALESCE(total_fat, 0) AS total_fat"
	}
	var rows []userFoodPhotoNutritionRow
	if err := r.db.WithContext(ctx).Table(table).Select(projection).Where("id::text IN ?", uniqueStrings(ids)).Scan(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		rowsByID[rows[i].ID] = rows[i]
	}
	return rowsByID, nil
}

func buildUserFoodPhotoNutrition(source string, row userFoodPhotoNutritionRow) *UserFoodPhotoNutrition {
	var items []userFoodPhotoNutritionItem
	if len(row.Items) > 0 {
		if err := json.Unmarshal(row.Items, &items); err != nil {
			return nil
		}
	}
	if len(items) == 0 && row.TotalCalories <= 0 && row.TotalProtein <= 0 && row.TotalCarbs <= 0 && row.TotalFat <= 0 {
		return nil
	}
	nutrition := &UserFoodPhotoNutrition{Source: source, ItemCount: len(items)}
	for i := range items {
		item := items[i]
		if name := strings.TrimSpace(item.Name); name != "" {
			nutrition.ItemNames = append(nutrition.ItemNames, name)
		}
		n := item.Nutrients
		nutrition.Calories += n.Calories
		nutrition.Protein += n.Protein
		nutrition.Carbs += n.Carbs
		nutrition.Fat += n.Fat
		nutrition.Fiber += n.Fiber
		nutrition.Sugar += n.Sugar
		nutrition.SaturatedFat += n.SaturatedFat
		nutrition.CholesterolMg += n.CholesterolMg
		nutrition.SodiumMg += n.SodiumMg
		nutrition.PotassiumMg += n.PotassiumMg
		nutrition.CalciumMg += n.CalciumMg
		nutrition.IronMg += n.IronMg
		nutrition.MagnesiumMg += n.MagnesiumMg
		nutrition.ZincMg += n.ZincMg
		nutrition.VitaminARaeMcg += n.VitaminARaeMcg
		nutrition.VitaminCMg += n.VitaminCMg
		nutrition.VitaminDMcg += n.VitaminDMcg
		nutrition.VitaminEMg += n.VitaminEMg
		nutrition.VitaminKMcg += n.VitaminKMcg
		nutrition.ThiaminMg += n.ThiaminMg
		nutrition.RiboflavinMg += n.RiboflavinMg
		nutrition.NiacinMg += n.NiacinMg
		nutrition.VitaminB6Mg += n.VitaminB6Mg
		nutrition.FolateMcg += n.FolateMcg
		nutrition.VitaminB12Mcg += n.VitaminB12Mcg
	}
	if row.TotalCalories > 0 {
		nutrition.Calories = row.TotalCalories
	}
	if row.TotalProtein > 0 {
		nutrition.Protein = row.TotalProtein
	}
	if row.TotalCarbs > 0 {
		nutrition.Carbs = row.TotalCarbs
	}
	if row.TotalFat > 0 {
		nutrition.Fat = row.TotalFat
	}
	return nutrition
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
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
	if visibility := strings.TrimSpace(input.CircleVisibility); isUserFoodPhotoCircleVisibility(visibility) {
		conditions = append(conditions, "photos.circle_visibility = ?")
		args = append(args, visibility)
	}
	return "WHERE " + strings.Join(conditions, " AND "), args
}

func isUserFoodPhotoCircleVisibility(visibility string) bool {
	switch visibility {
	case "visible", "not_shared", "not_applicable":
		return true
	default:
		return false
	}
}

func isUserFoodPhotoSource(source string) bool {
	switch source {
	case "analysis_task", "food_record", "public_food", "packaged_correction", "user_recipe":
		return true
	default:
		return false
	}
}
