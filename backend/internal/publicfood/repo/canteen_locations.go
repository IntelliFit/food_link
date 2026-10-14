package repo

import (
	"context"
	"fmt"

	"food_link/backend/internal/publicfood/domain"
	"gorm.io/gorm"
)

// These are read-time source labels, not new persisted directory records.
const canteenOrganizationRawSQL = `COALESCE(NULLIF(BTRIM(venue_item.organization_name), ''), NULLIF(BTRIM(venue_batch.organization_name), ''), NULLIF(BTRIM(venue_school.name), ''), NULLIF(BTRIM(p.school_name), ''), NULLIF(BTRIM(p.merchant_name), ''), '')`
const canteenCitySQL = `REGEXP_REPLACE(BTRIM(COALESCE(p.city, '')), '市$', '')`
const canteenOrganizationSQL = `CASE WHEN LENGTH(` + canteenCitySQL + `) > 0 AND LEFT(` + canteenOrganizationRawSQL + `, LENGTH(` + canteenCitySQL + `)) = ` + canteenCitySQL + ` THEN BTRIM(SUBSTRING(` + canteenOrganizationRawSQL + ` FROM LENGTH(` + canteenCitySQL + `) + 1)) ELSE ` + canteenOrganizationRawSQL + ` END`
const canteenNameSQL = `REGEXP_REPLACE(COALESCE(NULLIF(BTRIM(p.canteen_name), ''), NULLIF(BTRIM(venue_item.canteen_name), ''), NULLIF(BTRIM(venue_batch.canteen_name), ''), NULLIF(BTRIM(p.merchant_name), ''), '食堂'), '\s*[（(]名称待确认[）)]\s*$', '')`
const canteenOrganizationKeySQL = `MD5(JSONB_BUILD_ARRAY(` + canteenOrganizationSQL + `, ` + canteenCitySQL + `, BTRIM(COALESCE(p.district, '')))::text)`
const canteenKeySQL = `MD5(JSONB_BUILD_ARRAY(` + canteenOrganizationKeySQL + `, ` + canteenNameSQL + `)::text)`

func withCanteenScope(q *gorm.DB, scope string) (*gorm.DB, error) {
	q = q.Joins("LEFT JOIN campus_food_catalog_items venue_item ON venue_item.id = p.id").
		Joins("LEFT JOIN campus_food_collection_batches venue_batch ON venue_batch.id = venue_item.batch_id").
		Joins("LEFT JOIN schools venue_school ON venue_school.id = p.school_id AND venue_school.status = 'active'")
	switch scope {
	case "all":
		return q.Where("(" + canteenVenueTypeSQL + ") <> '' OR p.type = 'campus' OR p.is_campus_food = true"), nil
	case "campus":
		return q.Where("("+canteenVenueTypeSQL+") = ?", "university"), nil
	case "community":
		return q.Where("("+canteenVenueTypeSQL+") IN ?", []string{"community", "corporate", "office_park"}), nil
	default:
		return nil, fmt.Errorf("invalid canteen scope: %q", scope)
	}
}

// Aggregate the entire visible published catalogue, not the first page of dishes.
// Coordinates are optional: an un-geocoded community must still be selectable.
func (r *PublicFoodRepo) ListCanteenLocations(ctx context.Context, viewerUserID string) ([]domain.CanteenLocation, error) {
	q := r.db.WithContext(ctx).Table("public_food_library AS p").
		Joins("LEFT JOIN schools s ON s.name = p.school_name AND s.status = 'active'").
		Where("p.status = ?", "published").Where(validPublishedCampusNutritionSQL("p"))
	q = visiblePublicFoodToViewer(q, "p.user_id", viewerUserID)
	q, err := withCanteenScope(q, "community")
	if err != nil {
		return nil, err
	}
	q = q.Select(`p.id, ` + canteenOrganizationKeySQL + ` AS organization_key, ` + canteenOrganizationSQL + ` AS organization_name,
		COALESCE(p.city, '') AS city, COALESCE(p.district, '') AS district,
		` + canteenKeySQL + ` AS canteen_key, ` + canteenNameSQL + ` AS canteen_name,
		COALESCE(NULLIF(p.detail_address, ''), NULLIF(p.merchant_address, ''), p.campus_location_text, '') AS address`).
		Where("(" + canteenOrganizationSQL + ") <> ''")
	rows := make([]domain.CanteenLocation, 0)
	err = r.db.WithContext(ctx).Table("(?) AS locations", q).
		Select(`organization_key, MIN(organization_name) AS organization_name, MIN(city) AS city, MIN(district) AS district,
			canteen_key, MIN(canteen_name) AS canteen_name, MIN(NULLIF(address, '')) AS address, COUNT(DISTINCT id) AS food_count`).
		Group("organization_key, canteen_key").Order("organization_name ASC, canteen_name ASC, canteen_key ASC").Scan(&rows).Error
	return rows, err
}
