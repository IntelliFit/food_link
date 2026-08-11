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
	xianOwnerVerifiedDiningBatchName = "西安高校食堂目录-产品负责人确认-20260811"
	xianOwnerVerifiedDiningSeedPath  = "data/xian_owner_verified_dining_seed_20260811.json"
)

// XianOwnerVerifiedDiningDryRun summarizes the exact records that the Xi'an
// publication would create or reuse. It performs no writes.
type XianOwnerVerifiedDiningDryRun struct {
	Schools          int
	Campuses         int
	Canteens         int
	ExistingCampuses int
	ExistingCanteens int
	NewCampuses      int
	NewCanteens      int
}

// InspectXianOwnerVerifiedDiningDirectory validates that every school in the
// owner-confirmed seed exists in the target database and reports the expected
// idempotent import delta without changing any rows.
func InspectXianOwnerVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*XianOwnerVerifiedDiningDryRun, error) {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return nil, fmt.Errorf("set Xi'an directory schema: %w", err)
	}

	batch, err := loadXianOwnerVerifiedDiningSeed()
	if err != nil {
		return nil, err
	}
	result := &XianOwnerVerifiedDiningDryRun{Schools: len(batch.Schools)}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").
			Take(&school).Error; err != nil {
			return nil, fmt.Errorf("find Xi'an owner-confirmed school %q: %w", schoolSeed.School, err)
		}

		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			result.Campuses++
			var campuses []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, strings.TrimSpace(campusSeed.Name), "deleted").
				Find(&campuses).Error; err != nil {
				return nil, fmt.Errorf("inspect Xi'an campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			if len(campuses) > 1 {
				return nil, fmt.Errorf("inspect Xi'an campus %q/%q: found %d non-deleted rows", schoolSeed.School, campusSeed.Name, len(campuses))
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
				return nil, fmt.Errorf("inspect Xi'an canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if count > 1 {
				return nil, fmt.Errorf("inspect Xi'an canteen %q/%q/%q: found %d reusable rows", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, count)
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

// PublishXianOwnerVerifiedDiningDirectory imports only the rows marked "ok"
// in the owner-provided Xi'an workbook. The importer is transactional and
// idempotent; pending/warn workbook rows are not present in the seed and cannot
// become user-visible through this path.
func PublishXianOwnerVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Xi'an directory schema: %w", err)
		}
		if err := ensureCampusDirectoryResearchSeedFile(ctx, tx, xianOwnerVerifiedDiningSeedPath); err != nil {
			return fmt.Errorf("import Xi'an owner-confirmed dining seed: %w", err)
		}

		statements := []string{
			`UPDATE campus_directory_sources AS source
			 SET review_status = 'approved', updated_at = now()
			 FROM campus_directory_import_batches AS batch
			 WHERE source.batch_id = batch.id
			   AND batch.name = ?
			   AND source.source_type = 'user_verified_owner_approved_compilation'
			   AND source.review_status <> 'approved'`,
			`UPDATE school_canteens AS canteen
			 SET status = 'active',
			     review_note = '产品负责人确认的西安高校现行食堂目录',
			     reviewed_at = COALESCE(canteen.reviewed_at, now()),
			     updated_at = now()
			 WHERE canteen.status IN ('pending_review', 'inactive')
			   AND EXISTS (
			     SELECT 1
			     FROM campus_directory_sources AS source
			     JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id
			     WHERE source.canteen_id = canteen.id
			       AND batch.name = ?
			       AND source.source_type = 'user_verified_owner_approved_compilation'
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
			if err := tx.Exec(statement, xianOwnerVerifiedDiningBatchName).Error; err != nil {
				return fmt.Errorf("publish Xi'an owner-confirmed dining directory: %w", err)
			}
		}
		if err := applyXianOwnerVerifiedDiningMetadata(ctx, tx); err != nil {
			return err
		}
		return verifyXianOwnerVerifiedDiningDirectory(ctx, tx)
	})
}

func loadXianOwnerVerifiedDiningSeed() (*campusDirectoryPendingResearchSeed, error) {
	data, err := os.ReadFile(xianOwnerVerifiedDiningSeedPath)
	if err != nil {
		return nil, fmt.Errorf("read Xi'an owner-confirmed dining seed: %w", err)
	}
	var batches []campusDirectoryPendingResearchSeed
	if err := json.Unmarshal(data, &batches); err != nil {
		return nil, fmt.Errorf("parse Xi'an owner-confirmed dining seed: %w", err)
	}
	if len(batches) != 1 || batches[0].BatchName != xianOwnerVerifiedDiningBatchName {
		return nil, fmt.Errorf("Xi'an owner-confirmed dining seed has unexpected batch metadata")
	}
	return &batches[0], nil
}

func applyXianOwnerVerifiedDiningMetadata(ctx context.Context, db *gorm.DB) error {
	batch, err := loadXianOwnerVerifiedDiningSeed()
	if err != nil {
		return err
	}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").
			Take(&school).Error; err != nil {
			return fmt.Errorf("find Xi'an metadata school %q: %w", schoolSeed.School, err)
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campus struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, strings.TrimSpace(campusSeed.Name), "active").
				Take(&campus).Error; err != nil {
				return fmt.Errorf("find Xi'an metadata campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campus.ID
		}

		for _, canteenSeed := range schoolSeed.Canteens {
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			canteenID, findErr := findCampusDirectoryCanteenID(ctx, db, school.ID, &campusID, strings.TrimSpace(canteenSeed.Name))
			if findErr != nil {
				return fmt.Errorf("find Xi'an metadata canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, findErr)
			}
			updates := map[string]any{
				"location_text":     nullableText(strings.TrimSpace(canteenSeed.LocationText)),
				"building_or_floor": nullableText(strings.TrimSpace(canteenSeed.BuildingOrFloor)),
				"service_type":      nullableText(strings.TrimSpace(canteenSeed.ServiceType)),
				"source_url":        nullableText(strings.TrimSpace(canteenSeed.SourceURL)),
				"source_org":        nullableText(strings.TrimSpace(canteenSeed.SourceOrg)),
				"source_type":       nullableText(strings.TrimSpace(canteenSeed.SourceType)),
				"review_note":       "产品负责人确认的西安高校现行食堂目录",
				"updated_at":        gorm.Expr("now()"),
			}
			result := db.WithContext(ctx).Table("school_canteens AS canteen").
				Where("canteen.id = ? AND COALESCE(canteen.confidence_level, 'D') = ?", *canteenID, "D").
				Where(`NOT EXISTS (
					SELECT 1 FROM campus_directory_sources AS stronger
					WHERE stronger.canteen_id = canteen.id
					  AND stronger.review_status = 'approved'
					  AND stronger.evidence_level IN ('A', 'B', 'C')
				)`).
				Updates(updates)
			if result.Error != nil {
				return fmt.Errorf("update Xi'an metadata canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, result.Error)
			}
		}
	}
	return nil
}

func verifyXianOwnerVerifiedDiningDirectory(ctx context.Context, db *gorm.DB) error {
	batch, err := loadXianOwnerVerifiedDiningSeed()
	if err != nil {
		return err
	}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").
			Take(&school).Error; err != nil {
			return fmt.Errorf("verify Xi'an school %q: %w", schoolSeed.School, err)
		}

		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campuses []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, strings.TrimSpace(campusSeed.Name), "active").
				Find(&campuses).Error; err != nil {
				return fmt.Errorf("verify Xi'an campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			if len(campuses) != 1 {
				return fmt.Errorf("verify Xi'an campus %q/%q: got %d active rows, want 1", schoolSeed.School, campusSeed.Name, len(campuses))
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campuses[0].ID
		}

		for _, canteenSeed := range schoolSeed.Canteens {
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			if campusID == "" {
				return fmt.Errorf("verify Xi'an canteen %q/%q: campus %q is missing", schoolSeed.School, canteenSeed.Name, canteenSeed.Campus)
			}
			var canteens []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_canteens").Select("id").
				Where("school_id = ? AND campus_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, campusID, strings.TrimSpace(canteenSeed.Name), "active").
				Find(&canteens).Error; err != nil {
				return fmt.Errorf("verify Xi'an canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if len(canteens) != 1 {
				return fmt.Errorf("verify Xi'an canteen %q/%q/%q: got %d active rows, want 1", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, len(canteens))
			}
			var approvedSourceCount int64
			if err := db.WithContext(ctx).Table("campus_directory_sources AS source").
				Joins("JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id").
				Where("source.canteen_id = ? AND source.source_url = ?", canteens[0].ID, strings.TrimSpace(canteenSeed.SourceURL)).
				Where("source.review_status = ? AND batch.name = ?", "approved", xianOwnerVerifiedDiningBatchName).
				Count(&approvedSourceCount).Error; err != nil {
				return fmt.Errorf("verify Xi'an source %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if approvedSourceCount != 1 {
				return fmt.Errorf("verify Xi'an source %q/%q/%q: got %d approved rows, want 1", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, approvedSourceCount)
			}
		}
	}

	var approvedBatchCount int64
	if err := db.WithContext(ctx).Table("campus_directory_import_batches").
		Where("name = ? AND status = ?", xianOwnerVerifiedDiningBatchName, "approved").
		Count(&approvedBatchCount).Error; err != nil {
		return fmt.Errorf("verify Xi'an approved batch: %w", err)
	}
	if approvedBatchCount != 1 {
		return fmt.Errorf("verify Xi'an approved batch: got %d rows, want 1", approvedBatchCount)
	}
	return nil
}
