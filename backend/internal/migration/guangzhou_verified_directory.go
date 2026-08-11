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
	guangzhouVerifiedDiningBatchName = "广州高校已核验食堂楼层-20260811"
	guangzhouVerifiedDiningSeedPath  = "data/guangzhou_verified_dining_seed_20260811.json"
)

// GuangzhouVerifiedDiningDryRun summarizes the exact official-source records
// that the Guangzhou publication would create or reuse. It performs no writes.
type GuangzhouVerifiedDiningDryRun struct {
	Schools          int
	Campuses         int
	Canteens         int
	ExistingCampuses int
	ExistingCanteens int
	NewCampuses      int
	NewCanteens      int
}

// InspectGuangzhouVerifiedDiningDirectory validates every school and reports
// the idempotent import delta without changing the target database.
func InspectGuangzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*GuangzhouVerifiedDiningDryRun, error) {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return nil, fmt.Errorf("set Guangzhou directory schema: %w", err)
	}

	batch, err := loadGuangzhouVerifiedDiningSeed()
	if err != nil {
		return nil, err
	}
	result := &GuangzhouVerifiedDiningDryRun{Schools: len(batch.Schools)}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").
			Take(&school).Error; err != nil {
			return nil, fmt.Errorf("find Guangzhou verified school %q: %w", schoolSeed.School, err)
		}

		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			result.Campuses++
			var campuses []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, strings.TrimSpace(campusSeed.Name), "deleted").
				Find(&campuses).Error; err != nil {
				return nil, fmt.Errorf("inspect Guangzhou campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			if len(campuses) > 1 {
				return nil, fmt.Errorf("inspect Guangzhou campus %q/%q: found %d non-deleted rows", schoolSeed.School, campusSeed.Name, len(campuses))
			}
			if len(campuses) == 1 {
				result.ExistingCampuses++
				campusIDs[strings.TrimSpace(campusSeed.Name)] = campuses[0].ID
			} else {
				result.NewCampuses++
			}
		}

		for _, canteenSeed := range schoolSeed.Canteens {
			result.Canteens++
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			if campusID == "" {
				result.NewCanteens++
				continue
			}
			var count int64
			if err := db.WithContext(ctx).Table("school_canteens").
				Where("school_id = ? AND campus_id = ? AND lower(name) = lower(?)", school.ID, campusID, strings.TrimSpace(canteenSeed.Name)).
				Where("status NOT IN ?", []string{"deleted", "rejected"}).
				Count(&count).Error; err != nil {
				return nil, fmt.Errorf("inspect Guangzhou canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if count > 1 {
				return nil, fmt.Errorf("inspect Guangzhou canteen %q/%q/%q: found %d reusable rows", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, count)
			}
			if count == 1 {
				result.ExistingCanteens++
			} else {
				result.NewCanteens++
			}
		}
	}
	return result, nil
}

// PublishGuangzhouVerifiedDiningDirectory imports and publishes only the 43
// current official-source rows in the reviewed Guangzhou batch. Older records
// awaiting recency checks and unverified candidates are absent from the seed.
func PublishGuangzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Guangzhou directory schema: %w", err)
		}
		if err := ensureCampusDirectoryResearchSeedFile(ctx, tx, guangzhouVerifiedDiningSeedPath); err != nil {
			return fmt.Errorf("import Guangzhou verified dining seed: %w", err)
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
			     review_note = '2026-08-11广州高校官方来源复核通过',
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
			if err := tx.Exec(statement, guangzhouVerifiedDiningBatchName).Error; err != nil {
				return fmt.Errorf("publish Guangzhou verified dining directory: %w", err)
			}
		}
		if err := applyGuangzhouVerifiedDiningMetadata(ctx, tx); err != nil {
			return err
		}
		return verifyGuangzhouVerifiedDiningDirectory(ctx, tx)
	})
}

func loadGuangzhouVerifiedDiningSeed() (*campusDirectoryPendingResearchSeed, error) {
	data, err := os.ReadFile(guangzhouVerifiedDiningSeedPath)
	if err != nil {
		return nil, fmt.Errorf("read Guangzhou verified dining seed: %w", err)
	}
	var batches []campusDirectoryPendingResearchSeed
	if err := json.Unmarshal(data, &batches); err != nil {
		return nil, fmt.Errorf("parse Guangzhou verified dining seed: %w", err)
	}
	if len(batches) != 1 || batches[0].BatchName != guangzhouVerifiedDiningBatchName {
		return nil, fmt.Errorf("Guangzhou verified dining seed has unexpected batch metadata")
	}
	return &batches[0], nil
}

func applyGuangzhouVerifiedDiningMetadata(ctx context.Context, db *gorm.DB) error {
	batch, err := loadGuangzhouVerifiedDiningSeed()
	if err != nil {
		return err
	}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").
			Take(&school).Error; err != nil {
			return fmt.Errorf("find Guangzhou metadata school %q: %w", schoolSeed.School, err)
		}

		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campus struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, strings.TrimSpace(campusSeed.Name), "deleted").
				Take(&campus).Error; err != nil {
				return fmt.Errorf("find Guangzhou metadata campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			updates := map[string]any{"status": "active", "updated_at": gorm.Expr("now()")}
			if sourceURL := strings.TrimSpace(campusSeed.SourceURL); sourceURL != "" {
				updates["source_url"] = sourceURL
			}
			if err := db.WithContext(ctx).Table("school_campuses").Where("id = ?", campus.ID).Updates(updates).Error; err != nil {
				return fmt.Errorf("update Guangzhou metadata campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campus.ID
		}

		for _, canteenSeed := range schoolSeed.Canteens {
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			if campusID == "" {
				return fmt.Errorf("update Guangzhou canteen %q/%q: campus %q is missing", schoolSeed.School, canteenSeed.Name, canteenSeed.Campus)
			}
			canteenID, findErr := findCampusDirectoryCanteenID(ctx, db, school.ID, &campusID, strings.TrimSpace(canteenSeed.Name))
			if findErr != nil {
				return fmt.Errorf("find Guangzhou canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, findErr)
			}
			updates := map[string]any{
				"status":           "active",
				"confidence_level": "A",
				"review_note":      "2026-08-11广州高校官方来源复核通过",
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
				return fmt.Errorf("update Guangzhou canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
		}
	}
	return nil
}

func verifyGuangzhouVerifiedDiningDirectory(ctx context.Context, db *gorm.DB) error {
	batch, err := loadGuangzhouVerifiedDiningSeed()
	if err != nil {
		return err
	}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").
			Take(&school).Error; err != nil {
			return fmt.Errorf("verify Guangzhou school %q: %w", schoolSeed.School, err)
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campuses []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, strings.TrimSpace(campusSeed.Name), "active").
				Find(&campuses).Error; err != nil {
				return fmt.Errorf("verify Guangzhou campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			if len(campuses) != 1 {
				return fmt.Errorf("verify Guangzhou campus %q/%q: got %d active rows, want 1", schoolSeed.School, campusSeed.Name, len(campuses))
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campuses[0].ID
		}

		for _, canteenSeed := range schoolSeed.Canteens {
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			var canteens []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_canteens").Select("id").
				Where("school_id = ? AND campus_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, campusID, strings.TrimSpace(canteenSeed.Name), "active").
				Where("building_or_floor = ? AND confidence_level = ?", strings.TrimSpace(canteenSeed.BuildingOrFloor), "A").
				Find(&canteens).Error; err != nil {
				return fmt.Errorf("verify Guangzhou canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if len(canteens) != 1 {
				return fmt.Errorf("verify Guangzhou canteen %q/%q/%q: got %d exact active rows, want 1", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, len(canteens))
			}
			var approvedSourceCount int64
			if err := db.WithContext(ctx).Table("campus_directory_sources AS source").
				Joins("JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id").
				Where("source.canteen_id = ? AND source.source_url = ?", canteens[0].ID, strings.TrimSpace(canteenSeed.SourceURL)).
				Where("source.evidence_level = ? AND source.review_status = ? AND batch.name = ?", "A", "approved", guangzhouVerifiedDiningBatchName).
				Count(&approvedSourceCount).Error; err != nil {
				return fmt.Errorf("verify Guangzhou source %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if approvedSourceCount != 1 {
				return fmt.Errorf("verify Guangzhou source %q/%q/%q: got %d approved rows, want 1", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, approvedSourceCount)
			}
		}
	}

	var approvedBatchCount int64
	if err := db.WithContext(ctx).Table("campus_directory_import_batches").
		Where("name = ? AND status = ?", guangzhouVerifiedDiningBatchName, "approved").
		Count(&approvedBatchCount).Error; err != nil {
		return fmt.Errorf("verify Guangzhou approved batch: %w", err)
	}
	if approvedBatchCount != 1 {
		return fmt.Errorf("verify Guangzhou approved batch: got %d rows, want 1", approvedBatchCount)
	}
	return nil
}
