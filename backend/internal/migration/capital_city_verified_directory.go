package migration

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"gorm.io/gorm"
)

const (
	capitalCityVerifiedDiningBatchName = "省会高校已核验食堂楼层-20260811"
	capitalCityVerifiedDiningSeedPath  = "data/capital_city_verified_dining_seed_20260811.json"
)

// PublishCapitalCityVerifiedDiningDirectory imports and publishes only the
// reviewed official-source records in the 2026-08-11 capital-city batch. It
// deliberately avoids the global pending-research seed so unrelated drafts
// cannot become user-visible as a side effect of this release.
func PublishCapitalCityVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set capital-city directory schema: %w", err)
		}
		if err := ensureCampusDirectoryResearchSeedFile(ctx, tx, capitalCityVerifiedDiningSeedPath); err != nil {
			return fmt.Errorf("import capital-city verified dining seed: %w", err)
		}

		statements := []string{
			`UPDATE campus_directory_sources AS source
			 SET review_status = 'approved', updated_at = now()
			 FROM campus_directory_import_batches AS batch
			 WHERE source.batch_id = batch.id
			   AND batch.name = ?
			   AND source.evidence_level = 'A'
			   AND source.review_status <> 'approved'`,
			`UPDATE school_canteens AS canteen
			 SET status = 'active',
			     review_note = '2026-08-11高校官方来源复核通过',
			     reviewed_at = COALESCE(canteen.reviewed_at, now()),
			     updated_at = now()
			 WHERE canteen.status IN ('pending_review', 'inactive')
			   AND EXISTS (
			     SELECT 1
			     FROM campus_directory_sources AS source
			     JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id
			     WHERE source.canteen_id = canteen.id
			       AND batch.name = ?
			       AND source.evidence_level = 'A'
			       AND source.review_status = 'approved'
			   )`,
			`UPDATE school_campuses AS campus
			 SET status = 'active', updated_at = now()
			 WHERE campus.status = 'pending_review'
			   AND EXISTS (
			     SELECT 1
			     FROM school_canteens AS canteen
			     JOIN campus_directory_sources AS source ON source.canteen_id = canteen.id
			     JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id
			     WHERE canteen.campus_id = campus.id
			       AND canteen.status = 'active'
			       AND batch.name = ?
			       AND source.review_status = 'approved'
			   )`,
			`UPDATE campus_directory_import_batches
			 SET status = 'approved', updated_at = now()
			 WHERE name = ?`,
		}
		for _, statement := range statements {
			if err := tx.Exec(statement, capitalCityVerifiedDiningBatchName).Error; err != nil {
				return fmt.Errorf("publish capital-city verified dining directory: %w", err)
			}
		}
		if err := applyCapitalCityVerifiedDiningMetadata(ctx, tx); err != nil {
			return err
		}
		return verifyCapitalCityVerifiedDiningDirectory(ctx, tx)
	})
}

func loadCapitalCityVerifiedDiningSeed() (*campusDirectoryPendingResearchSeed, error) {
	data, err := os.ReadFile(capitalCityVerifiedDiningSeedPath)
	if err != nil {
		return nil, fmt.Errorf("read capital-city verified dining seed: %w", err)
	}
	var batches []campusDirectoryPendingResearchSeed
	if err := json.Unmarshal(data, &batches); err != nil {
		return nil, fmt.Errorf("parse capital-city verified dining seed: %w", err)
	}
	if len(batches) != 1 || batches[0].BatchName != capitalCityVerifiedDiningBatchName {
		return nil, fmt.Errorf("capital-city verified dining seed has unexpected batch metadata")
	}
	return &batches[0], nil
}

func applyCapitalCityVerifiedDiningMetadata(ctx context.Context, db *gorm.DB) error {
	batch, err := loadCapitalCityVerifiedDiningSeed()
	if err != nil {
		return err
	}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").
			Take(&school).Error; err != nil {
			return fmt.Errorf("find verified dining school %q: %w", schoolSeed.School, err)
		}

		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campus struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, strings.TrimSpace(campusSeed.Name), "deleted").
				Take(&campus).Error; err != nil {
				return fmt.Errorf("find verified dining campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			updates := map[string]any{"status": "active", "updated_at": gorm.Expr("now()")}
			if value := strings.TrimSpace(campusSeed.Address); value != "" {
				updates["address"] = value
			}
			if value := strings.TrimSpace(campusSeed.SourceURL); value != "" {
				updates["source_url"] = value
			}
			if err := db.WithContext(ctx).Table("school_campuses").Where("id = ?", campus.ID).Updates(updates).Error; err != nil {
				return fmt.Errorf("update verified dining campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campus.ID
		}

		canteenIDs := make(map[string]string, len(schoolSeed.Canteens))
		for _, canteenSeed := range schoolSeed.Canteens {
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			if campusID == "" {
				return fmt.Errorf("update verified dining canteen %q/%q: campus %q is missing", schoolSeed.School, canteenSeed.Name, canteenSeed.Campus)
			}
			canteenID, err := findCampusDirectoryCanteenID(ctx, db, school.ID, &campusID, strings.TrimSpace(canteenSeed.Name))
			if err != nil {
				return fmt.Errorf("find verified dining canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			updates := map[string]any{
				"status":           "active",
				"confidence_level": "A",
				"review_note":      "2026-08-11高校官方来源复核通过",
				"reviewed_at":      gorm.Expr("COALESCE(reviewed_at, now())"),
				"updated_at":       gorm.Expr("now()"),
			}
			for column, value := range map[string]string{
				"location_text":     canteenSeed.LocationText,
				"building_or_floor": canteenSeed.BuildingOrFloor,
				"service_type":      canteenSeed.ServiceType,
				"source_url":        canteenSeed.SourceURL,
				"source_org":        canteenSeed.SourceOrg,
				"source_type":       canteenSeed.SourceType,
			} {
				if value = strings.TrimSpace(value); value != "" {
					updates[column] = value
				}
			}
			if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", *canteenID).Updates(updates).Error; err != nil {
				return fmt.Errorf("update verified dining canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			canteenIDs[campusCanteenKey(canteenSeed.Campus, canteenSeed.Name)] = *canteenID
		}

		for _, windowSeed := range schoolSeed.Windows {
			canteenID := canteenIDs[campusCanteenKey(windowSeed.Campus, windowSeed.Canteen)]
			if canteenID == "" {
				return fmt.Errorf("update verified window %q/%q: parent canteen %q is missing", schoolSeed.School, windowSeed.Name, windowSeed.Canteen)
			}
			if err := db.WithContext(ctx).Table("canteen_windows").
				Where("canteen_id = ? AND lower(name) = lower(?)", canteenID, strings.TrimSpace(windowSeed.Name)).
				Where("status <> ?", "deleted").
				Updates(map[string]any{
					"floor":      strings.TrimSpace(windowSeed.Floor),
					"source_url": strings.TrimSpace(windowSeed.SourceURL),
					"status":     "active",
					"updated_at": gorm.Expr("now()"),
				}).Error; err != nil {
				return fmt.Errorf("activate verified window %q/%q: %w", schoolSeed.School, windowSeed.Name, err)
			}
		}
	}
	return nil
}

// verifyCapitalCityVerifiedDiningDirectory checks the exact hierarchy encoded
// in the seed, not just aggregate batch counters. Returning an error rolls the
// publication transaction back instead of reporting success with skipped
// schools or partially-visible directory rows.
func verifyCapitalCityVerifiedDiningDirectory(ctx context.Context, db *gorm.DB) error {
	batch, err := loadCapitalCityVerifiedDiningSeed()
	if err != nil {
		return err
	}

	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").
			Take(&school).Error; err != nil {
			return fmt.Errorf("verify published school %q: %w", schoolSeed.School, err)
		}

		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campus struct{ ID string }
			query := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, strings.TrimSpace(campusSeed.Name), "active")
			if address := strings.TrimSpace(campusSeed.Address); address != "" {
				query = query.Where("address = ?", address)
			}
			if err := query.
				Take(&campus).Error; err != nil {
				return fmt.Errorf("verify published campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campus.ID
		}

		canteenIDs := make(map[string]string, len(schoolSeed.Canteens))
		for _, canteenSeed := range schoolSeed.Canteens {
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			if campusID == "" {
				return fmt.Errorf("verify published canteen %q/%q: campus %q is missing from seed", schoolSeed.School, canteenSeed.Name, canteenSeed.Campus)
			}
			var canteen struct{ ID string }
			if err := db.WithContext(ctx).Table("school_canteens").Select("id").
				Where("school_id = ? AND campus_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, campusID, strings.TrimSpace(canteenSeed.Name), "active").
				Where("building_or_floor = ?", strings.TrimSpace(canteenSeed.BuildingOrFloor)).
				Take(&canteen).Error; err != nil {
				return fmt.Errorf("verify published canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			canteenIDs[campusCanteenKey(canteenSeed.Campus, canteenSeed.Name)] = canteen.ID
		}

		for _, windowSeed := range schoolSeed.Windows {
			canteenID := canteenIDs[campusCanteenKey(windowSeed.Campus, windowSeed.Canteen)]
			if canteenID == "" {
				return fmt.Errorf("verify published window %q/%q: parent canteen %q is missing", schoolSeed.School, windowSeed.Name, windowSeed.Canteen)
			}
			var count int64
			if err := db.WithContext(ctx).Table("canteen_windows").
				Where("canteen_id = ? AND lower(name) = lower(?) AND status = ?", canteenID, strings.TrimSpace(windowSeed.Name), "active").
				Where("floor = ? AND source_url = ?", strings.TrimSpace(windowSeed.Floor), strings.TrimSpace(windowSeed.SourceURL)).
				Count(&count).Error; err != nil {
				return fmt.Errorf("verify published window %q/%q: %w", schoolSeed.School, windowSeed.Name, err)
			}
			if count != 1 {
				return fmt.Errorf("verify published window %q/%q: got %d active rows, want 1", schoolSeed.School, windowSeed.Name, count)
			}
		}
	}

	var approvedBatchCount int64
	if err := db.WithContext(ctx).Table("campus_directory_import_batches").
		Where("name = ? AND status = ?", capitalCityVerifiedDiningBatchName, "approved").
		Count(&approvedBatchCount).Error; err != nil {
		return fmt.Errorf("verify capital-city approved batch: %w", err)
	}
	if approvedBatchCount != 1 {
		return fmt.Errorf("verify capital-city approved batch: got %d rows, want 1", approvedBatchCount)
	}
	return nil
}
