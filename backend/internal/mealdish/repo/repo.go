// Package repo reads canteens and dishes for the meal-dish prompt and stores
// the prompt rows. It reads the campus directory and public food library
// directly; writes go only to its own two tables.
package repo

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"

	"food_link/backend/internal/mealdish/domain"

	"gorm.io/gorm"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "23505") || strings.Contains(msg, "duplicate") || strings.Contains(msg, "unique")
}

// CreatePrompt inserts the prompt for a task, or returns the one already there.
func (r *Repo) CreatePrompt(ctx context.Context, prompt *domain.Prompt) (*domain.Prompt, error) {
	now := time.Now()
	if prompt.CreatedAt == nil {
		prompt.CreatedAt = &now
	}
	if prompt.UpdatedAt == nil {
		prompt.UpdatedAt = &now
	}
	err := r.db.WithContext(ctx).Create(prompt).Error
	if err == nil {
		return prompt, nil
	}
	if !isUniqueViolation(err) {
		return nil, err
	}
	return r.PromptByTask(ctx, prompt.UserID, prompt.AnalysisTaskID)
}

func (r *Repo) PromptByTask(ctx context.Context, userID, taskID string) (*domain.Prompt, error) {
	var prompt domain.Prompt
	err := r.db.WithContext(ctx).Where("user_id = ? AND analysis_task_id = ?", userID, taskID).First(&prompt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &prompt, err
}

func (r *Repo) PromptByID(ctx context.Context, userID, id string) (*domain.Prompt, error) {
	var prompt domain.Prompt
	err := r.db.WithContext(ctx).Where("user_id = ? AND id = ?", userID, id).First(&prompt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &prompt, err
}

func (r *Repo) UpdatePrompt(ctx context.Context, userID, id string, updates map[string]any) error {
	updates["updated_at"] = time.Now()
	for key, value := range updates {
		if list, ok := value.([]string); ok {
			data, _ := json.Marshal(list)
			updates[key] = string(data)
		}
	}
	return r.db.WithContext(ctx).Model(&domain.Prompt{}).Where("user_id = ? AND id = ?", userID, id).Updates(updates).Error
}

func (r *Repo) AddLocationSample(ctx context.Context, sample *domain.LocationSample) error {
	now := time.Now()
	sample.CreatedAt = &now
	return r.db.WithContext(ctx).Create(sample).Error
}

type canteenRow struct {
	ID          string
	Name        string
	SchoolName  string
	CampusName  string
	DishCount   int
	RecentCount int
	Latitude    *float64
	Longitude   *float64
}

const canteenColumns = `c.id, c.name, COALESCE(s.name, '') AS school_name, COALESCE(ca.name, '') AS campus_name,
  (SELECT count(*) FROM public_food_library p WHERE p.canteen_id = c.id AND p.status = 'published') AS dish_count`

const canteenJoins = `FROM school_canteens c
LEFT JOIN schools s ON s.id = c.school_id
LEFT JOIN school_campuses ca ON ca.id = c.campus_id`

func (row canteenRow) canteen(reason string) domain.Canteen {
	return domain.Canteen{ID: row.ID, Name: row.Name, SchoolName: row.SchoolName, CampusName: row.CampusName,
		Reason: reason, DishCount: row.DishCount, RecentCount: row.RecentCount}
}

// RecentCanteens are the canteens this user confirmed lately, most used first.
func (r *Repo) RecentCanteens(ctx context.Context, userID string, since time.Time, limit int) ([]domain.Canteen, error) {
	rows := []canteenRow{}
	err := r.db.WithContext(ctx).Raw(`SELECT `+canteenColumns+`, t.uses AS recent_count
FROM (SELECT chosen_canteen_id, count(*) AS uses, max(created_at) AS last_at
      FROM meal_dish_prompts WHERE user_id = ? AND chosen_canteen_id IS NOT NULL AND created_at >= ?
      GROUP BY chosen_canteen_id) t
JOIN school_canteens c ON c.id = t.chosen_canteen_id
LEFT JOIN schools s ON s.id = c.school_id
LEFT JOIN school_campuses ca ON ca.id = c.campus_id
WHERE c.status = 'active'
ORDER BY t.uses DESC, t.last_at DESC
LIMIT ?`, userID, since, limit).Scan(&rows).Error
	canteens := make([]domain.Canteen, 0, len(rows))
	for _, row := range rows {
		canteens = append(canteens, row.canteen(domain.ReasonRecent))
	}
	return canteens, err
}

// CanteensNear returns canteens with a known position inside the radius,
// nearest first. A position comes from the directory or, when the directory
// has none, from the average of at least two confirmed samples.
func (r *Repo) CanteensNear(ctx context.Context, lat, lng, radiusM float64, limit int) ([]domain.Canteen, error) {
	dLat := radiusM / 111000
	dLng := radiusM / (111000 * math.Max(0.1, math.Cos(lat*math.Pi/180)))
	rows := []canteenRow{}
	err := r.db.WithContext(ctx).Raw(`WITH learned AS (
  SELECT canteen_id, avg(latitude) AS latitude, avg(longitude) AS longitude
  FROM canteen_location_samples GROUP BY canteen_id HAVING count(*) >= 2
), positioned AS (
  SELECT c.id,
         COALESCE(CASE WHEN c.latitude IS NOT NULL AND NOT (c.latitude = 0 AND c.longitude = 0) THEN c.latitude END, l.latitude)::float8 AS latitude,
         COALESCE(CASE WHEN c.latitude IS NOT NULL AND NOT (c.latitude = 0 AND c.longitude = 0) THEN c.longitude END, l.longitude)::float8 AS longitude
  FROM school_canteens c LEFT JOIN learned l ON l.canteen_id = c.id
  WHERE c.status = 'active'
)
SELECT `+canteenColumns+`, pos.latitude, pos.longitude
FROM positioned pos JOIN school_canteens c ON c.id = pos.id
LEFT JOIN schools s ON s.id = c.school_id
LEFT JOIN school_campuses ca ON ca.id = c.campus_id
WHERE pos.latitude BETWEEN ? AND ? AND pos.longitude BETWEEN ? AND ?
LIMIT 50`, lat-dLat, lat+dLat, lng-dLng, lng+dLng).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	type withDistance struct {
		canteen domain.Canteen
		meters  float64
	}
	found := []withDistance{}
	for _, row := range rows {
		if row.Latitude == nil || row.Longitude == nil {
			continue
		}
		meters := haversine(lat, lng, *row.Latitude, *row.Longitude)
		if meters > radiusM {
			continue
		}
		canteen := row.canteen(domain.ReasonNearby)
		rounded := int(math.Round(meters/10) * 10)
		canteen.DistanceM = &rounded
		found = append(found, withDistance{canteen, meters})
	}
	for i := 1; i < len(found); i++ {
		for j := i; j > 0 && found[j].meters < found[j-1].meters; j-- {
			found[j], found[j-1] = found[j-1], found[j]
		}
	}
	canteens := []domain.Canteen{}
	for index := 0; index < len(found) && index < limit; index++ {
		canteens = append(canteens, found[index].canteen)
	}
	return canteens, nil
}

func haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadius = 6371000.0
	rad := math.Pi / 180
	dLat, dLng := (lat2-lat1)*rad, (lng2-lng1)*rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadius * math.Asin(math.Min(1, math.Sqrt(a)))
}

// SchoolCanteensFromAddress finds the university whose name appears in the
// reverse-geocoded address or nearby place name, and lists its canteens that
// have dishes; a canteen named in the place text comes first.
func (r *Repo) SchoolCanteensFromAddress(ctx context.Context, texts []string, limit int) ([]domain.Canteen, error) {
	joined := strings.TrimSpace(strings.Join(texts, " "))
	if joined == "" {
		return nil, nil
	}
	var school struct {
		ID   string
		Name string
	}
	err := r.db.WithContext(ctx).Raw(`SELECT id, name FROM schools
WHERE status = 'active' AND location_type = 'university' AND char_length(name) >= 4 AND strpos(?, name) > 0
ORDER BY char_length(name) DESC LIMIT 1`, joined).Scan(&school).Error
	if err != nil || school.ID == "" {
		return nil, err
	}
	rows := []canteenRow{}
	err = r.db.WithContext(ctx).Raw(`SELECT `+canteenColumns+` `+canteenJoins+`
WHERE c.school_id = ? AND c.status = 'active'
ORDER BY (strpos(?, c.name) > 0) DESC, dish_count DESC, c.name
LIMIT ?`, school.ID, joined, limit).Scan(&rows).Error
	canteens := make([]domain.Canteen, 0, len(rows))
	for _, row := range rows {
		if row.DishCount == 0 && !strings.Contains(joined, row.Name) {
			continue
		}
		canteens = append(canteens, row.canteen(domain.ReasonSchool))
	}
	return canteens, err
}

func (r *Repo) CanteenByID(ctx context.Context, id string) (*domain.Canteen, error) {
	rows := []canteenRow{}
	if err := r.db.WithContext(ctx).Raw(`SELECT `+canteenColumns+` `+canteenJoins+` WHERE c.id = ? AND c.status = 'active'`, id).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	canteen := rows[0].canteen(domain.ReasonManual)
	return &canteen, nil
}

// DishRow is a published dish with what is needed to show and rank it.
type DishRow struct {
	ID         string
	CanteenID  string
	FoodName   string
	WindowName string
	Floor      string
	Price      float64
	PriceMin   float64
	PriceMax   float64
	PriceType  string
	ImagePath  *string
	ImagePaths string
	ImageKind  *string
	Popularity int
	// PriceSetAt is when the price was last collected, else when the dish was
	// published; InCatalog says the campus catalog owns the dish (corrections
	// go through its versions).
	PriceSetAt *time.Time
	InCatalog  bool
}

const dishSelect = `SELECT p.id, p.canteen_id, p.food_name, COALESCE(p.window_name, '') AS window_name, COALESCE(p.floor, '') AS floor,
  COALESCE(p.price, 0) AS price, COALESCE(p.price_min, 0) AS price_min, COALESCE(p.price_max, 0) AS price_max,
  COALESCE(p.price_type, '') AS price_type, p.image_path, COALESCE(p.image_paths::text, '[]') AS image_paths, ci.image_kind,
  COALESCE(p.price_collected_at, p.published_at, p.created_at) AS price_set_at, ci.id IS NOT NULL AS in_catalog,
  (SELECT count(*) FROM meal_dish_prompts m WHERE m.chosen_item_id = p.id) AS popularity
FROM public_food_library p LEFT JOIN campus_food_catalog_items ci ON ci.id = p.id`

func (r *Repo) CanteenDishes(ctx context.Context, canteenID string, limit int) ([]DishRow, error) {
	rows := []DishRow{}
	err := r.db.WithContext(ctx).Raw(dishSelect+`
WHERE p.canteen_id = ? AND p.status = 'published'
ORDER BY p.created_at DESC LIMIT ?`, canteenID, limit).Scan(&rows).Error
	return rows, err
}

func (r *Repo) DishByID(ctx context.Context, id string) (*DishRow, error) {
	rows := []DishRow{}
	if err := r.db.WithContext(ctx).Raw(dishSelect+` WHERE p.id = ? AND p.status = 'published'`, id).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return &rows[0], nil
}

// Images returns the dish's image references, first the cover.
func (row DishRow) Images() []string {
	images := []string{}
	if row.ImagePath != nil && strings.TrimSpace(*row.ImagePath) != "" {
		images = append(images, strings.TrimSpace(*row.ImagePath))
	}
	extra := []string{}
	if err := json.Unmarshal([]byte(row.ImagePaths), &extra); err == nil {
		for _, value := range extra {
			if value = strings.TrimSpace(value); value != "" && (len(images) == 0 || value != images[0]) {
				images = append(images, value)
			}
		}
	}
	return images
}

// HasRealPhoto is true for a dish photo; a menu board or none is not.
func (row DishRow) HasRealPhoto() bool {
	if len(row.Images()) == 0 {
		return false
	}
	return row.ImageKind == nil || *row.ImageKind == "" || *row.ImageKind == "dish"
}

// Task is the part of a recognition task the prompt needs.
type Task struct {
	ID         string
	UserID     string
	Status     string
	ImageURL   *string
	ImagePaths string
	Result     string
}

func (r *Repo) TaskForUser(ctx context.Context, userID, taskID string) (*Task, error) {
	rows := []Task{}
	err := r.db.WithContext(ctx).Raw(`SELECT id, user_id, status, image_url, COALESCE(image_paths::text, '[]') AS image_paths, COALESCE(result::text, '{}') AS result
FROM analysis_tasks WHERE id = ? AND user_id = ?`, taskID, userID).Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}

func (t Task) Images() []string {
	images := []string{}
	extra := []string{}
	if err := json.Unmarshal([]byte(t.ImagePaths), &extra); err == nil {
		for _, value := range extra {
			if value = strings.TrimSpace(value); value != "" {
				images = append(images, value)
			}
		}
	}
	if len(images) == 0 && t.ImageURL != nil && strings.TrimSpace(*t.ImageURL) != "" {
		images = append(images, strings.TrimSpace(*t.ImageURL))
	}
	return images
}

func (t Task) ResultMap() map[string]any {
	result := map[string]any{}
	_ = json.Unmarshal([]byte(t.Result), &result)
	return result
}
