package repo

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"food_link/backend/internal/health/domain"
	"gorm.io/gorm/clause"
)

// Use local planar distance (an approximation, not travel distance) over a bounded
// radius. This keeps the query portable and requires no PostGIS migration.
func (r *StatsRepo) searchNearbyDietCandidates(ctx context.Context, f domain.CampusDietSearchFilter) ([]domain.DietRecommendationCandidate, int64, error) {
	if !f.Location.Valid(time.Now()) {
		return nil, 0, fmt.Errorf("invalid or expired location")
	}
	radius := f.RadiusKM
	if radius <= 0 {
		radius = 5
	}
	if radius > 10 {
		radius = 10
	}
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 20
	}
	if f.Offset < 0 {
		f.Offset = 0
	}
	if !f.ScanCatalog && f.Offset > 3000 {
		f.Offset = 3000
	}
	valid := func(prefix string) string {
		return fmt.Sprintf("(%[1]s.latitude BETWEEN -90 AND 90 AND %[1]s.longitude BETWEEN -180 AND 180 AND NOT (%[1]s.latitude = 0 AND %[1]s.longitude = 0))", prefix)
	}
	coordinate := func(column string) string {
		return fmt.Sprintf("CASE WHEN %s THEN p.%s WHEN %s THEN c.%s WHEN %s THEN ca.%s WHEN %s THEN s.%s END", valid("p"), column, valid("c"), column, valid("ca"), column, valid("s"), column)
	}
	base := r.db.WithContext(ctx).Table("public_food_library p").
		Joins("LEFT JOIN school_canteens c ON c.id = p.canteen_id AND c.status = 'active'").
		Joins("LEFT JOIN school_campuses ca ON ca.id = COALESCE(c.campus_id, p.campus_id) AND ca.status = 'active'").
		Joins(`LEFT JOIN schools s ON s.status = 'active' AND s.location_type = 'university' AND
			(s.id = COALESCE(ca.school_id, c.school_id, p.school_id) OR
			(COALESCE(ca.school_id, c.school_id, p.school_id) IS NULL AND s.name = p.school_name))`).
		Where("p.status = ?", "published")
	if !f.AllowUnknownNutrition {
		base = base.Where("p.total_calories > 0")
	}
	if !f.ScanCatalog && f.MealType == "breakfast" {
		if f.IncludeMenuEvidence {
			base = base.Where("(p.food_name ~ ? OR EXISTS (SELECT 1 FROM campus_food_catalog_items ce WHERE ce.id = p.id AND jsonb_exists(ce.meal_periods,'breakfast')))", domain.BreakfastMenuNamePattern)
		} else {
			base = base.Where("p.food_name ~ ?", domain.BreakfastMenuNamePattern)
		}
	}
	if f.ViewerID != "" {
		base = base.Where(`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
			(b.blocker_user_id = ? AND b.blocked_user_id = p.user_id) OR
			(b.blocker_user_id = p.user_id AND b.blocked_user_id = ?))`, f.ViewerID, f.ViewerID)
	}
	if f.SchoolID != "" {
		base = base.Where("COALESCE(p.school_id, c.school_id, ca.school_id, s.id) = ?", f.SchoolID)
	}
	if f.CampusID != "" {
		base = base.Where("p.campus_id = ?", f.CampusID)
	}
	if f.MerchantOnly {
		base = base.Where("COALESCE(p.is_campus_food, false) = false AND COALESCE(p.type, '') <> 'campus' AND COALESCE(p.merchant_name, '') <> ''")
	}
	if f.CampusOnly {
		base = base.Where("(COALESCE(p.is_campus_food, false) = true OR p.type = 'campus')")
	}
	for _, word := range []string{"餐盒", "打包盒", "包装盒", "纸袋", "塑料袋", "餐具", "筷子", "吸管", "杯盖"} {
		base = base.Where("COALESCE(p.food_name, '') NOT LIKE ?", "%"+word+"%")
	}
	if f.Keyword != "" {
		like := "%" + strings.ToLower(strings.TrimSpace(f.Keyword)) + "%"
		base = base.Where("(LOWER(p.food_name) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(p.merchant_name) LIKE ?)", like, like, like)
	}
	if f.CanteenName != "" {
		base = base.Where("p.canteen_name LIKE ?", "%"+f.CanteenName+"%")
	}
	if len(f.IncludeSourceIDs) > 0 {
		base = base.Where("p.id IN ?", f.IncludeSourceIDs)
	}
	if len(f.ExcludeSourceIDs) > 0 {
		base = base.Where("p.id NOT IN ?", f.ExcludeSourceIDs)
	}
	if f.MaxCalories != nil {
		base = base.Where("p.total_calories <= ?", *f.MaxCalories)
	}
	if f.MinProtein != nil {
		base = base.Where("p.total_protein >= ?", *f.MinProtein)
	}
	if f.MaxFat != nil {
		base = base.Where("p.total_fat <= ?", *f.MaxFat)
	}
	if f.MaxPrice != nil {
		base = base.Where("p.price > 0 AND p.price <= ?", *f.MaxPrice)
		for _, unit := range []string{"两", "克", "千克", "公斤", "斤", "kg", "/g", "每", "只", "个", "串", "枚", "片", "粒"} {
			base = base.Where("COALESCE(p.price_unit, '') NOT LIKE ?", "%"+unit+"%")
		}
	}
	projection := `p.id, p.food_name AS title, p.description, p.total_calories AS calories,
		p.total_protein AS protein, p.total_carbs AS carbs, p.total_fat AS fat,
		CAST(p.items AS TEXT) AS items_json, (COALESCE(p.is_campus_food,false) OR COALESCE(p.type,'') = 'campus') AS is_campus_food,
		COALESCE(p.school_id, c.school_id, ca.school_id, s.id) AS school_id, COALESCE(NULLIF(p.school_name,''),s.name) AS school_name,
		p.campus_id, p.campus_name, p.canteen_id, p.canteen_name, p.window_id, p.window_name,
		p.floor, p.price, p.price_unit, p.image_path, p.merchant_name,
		COALESCE(NULLIF(p.detail_address, ''), p.merchant_address, ca.address, '') AS address, ` +
		coordinate("latitude") + " AS food_lat, " + coordinate("longitude") + " AS food_lon, " +
		fmt.Sprintf("CASE WHEN %s THEN 'food' WHEN %s THEN 'canteen' WHEN %s THEN 'campus' ELSE 'school' END AS location_level", valid("p"), valid("c"), valid("ca"))
	located := base.Select(projection)
	lat, lon := f.Location.Latitude, f.Location.Longitude
	lonScale := 111.195 * math.Cos(lat*math.Pi/180)
	distance := `((food_lat - ?) * (food_lat - ?) * 111.195 * 111.195 + (food_lon - ?) * (food_lon - ?) * ? * ?)`
	measured := r.db.WithContext(ctx).Table("(?) located", located).
		Select("located.*, "+distance+" AS distance_squared", lat, lat, lon, lon, lonScale, lonScale).
		Where("food_lat IS NOT NULL AND food_lon IS NOT NULL")
	q := r.db.WithContext(ctx).Table("(?) nearby", measured).Where("distance_squared <= ?", radius*radius)
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if f.ScanCatalog && f.AfterID != "" {
		q = q.Where("id > ?", f.AfterID)
	}
	// A dense menu from one nearby shop must not occupy the entire retrieval
	// window. Interleave each merchant's nearest entries before paging.
	if !f.ScanCatalog && f.AllowUnknownNutrition && !f.CampusOnly {
		order := "distance_squared ASC, id ASC"
		args := []any{}
		if f.SortBy == "diverse" {
			order = "md5(id::text || ?), id ASC"
			args = append(args, f.DiversitySeed)
		}
		q = r.db.WithContext(ctx).Table("(?) diversified", q.Select("nearby.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(window_id::text, NULLIF(window_name, ''), NULLIF(merchant_name, ''), NULLIF(canteen_name, ''), school_id::text, id::text) ORDER BY "+order+") AS merchant_rank", args...)).Order("merchant_rank ASC")
	}
	var rows []struct {
		Row             dietRecommendationRow `gorm:"embedded"`
		DistanceSquared float64
		LocationLevel   string
		MerchantName    string
		Address         string
	}
	if f.ScanCatalog {
		q = q.Order("id ASC")
	} else {
		switch f.SortBy {
		case "diverse":
			order := "distance_squared ASC, md5(id::text || ?), id ASC"
			if f.AllowUnknownNutrition && !f.CampusOnly {
				order = "merchant_rank ASC, " + order
			}
			q = q.Order(clause.OrderBy{Expression: clause.Expr{SQL: order, Vars: []any{f.DiversitySeed}}})
		case "lowest_price":
			q = q.Where("price > 0").Order("price ASC")
		case "highest_protein":
			q = q.Order("protein DESC")
		case "lowest_calories":
			q = q.Order("calories ASC")
		case "protein_density":
			q = q.Order("protein / NULLIF(calories, 0) DESC")
		}
	}
	err := q.Order("distance_squared ASC, id ASC").Limit(f.Limit).Offset(f.Offset).Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	items := make([]domain.DietRecommendationCandidate, 0, len(rows))
	for _, row := range rows {
		item := rowsToDietRecommendationCandidates([]dietRecommendationRow{row.Row}, "public_food_library")[0]
		distanceKM := math.Round(math.Sqrt(row.DistanceSquared)*100) / 100
		item.DistanceKM, item.LocationLevel = &distanceKM, row.LocationLevel
		item.MerchantName, item.Address = row.MerchantName, row.Address
		items = append(items, item)
	}
	if f.IncludeMenuEvidence {
		if err := r.enrichDietMenuEvidence(ctx, items); err != nil {
			return nil, 0, err
		}
	}
	return items, total, nil
}
