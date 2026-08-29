package migration

import (
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const (
	henanOwnerVerifiedDiningBatchName = "河南本科院校食堂汇总-用户确认可见-20260826"
	henanOwnerVerifiedDiningSeedPath  = "data/henan_owner_verified_dining_seed_20260826.json"
	henanOwnerVerifiedSourceType      = "user_requested_verified_compilation"
)

var henanOwnerVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  henanOwnerVerifiedDiningBatchName,
	SeedPath:   henanOwnerVerifiedDiningSeedPath,
	ReviewNote: "用户要求发布的河南本科院校食堂汇总；仅纳入原表已核实行",
}

// InspectHenanOwnerVerifiedDiningDirectory validates every school and reports
// the idempotent delta without changing the target database.
func InspectHenanOwnerVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, henanOwnerVerifiedDiningSpec)
}

// PublishHenanOwnerVerifiedDiningDirectory publishes only the workbook rows
// marked 已核实. The user-provided compilation remains D-level evidence and
// never downgrades stronger approved A/B/C metadata already in the directory.
func PublishHenanOwnerVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	if err := validateVerifiedDiningBatchSpec(henanOwnerVerifiedDiningSpec); err != nil {
		return err
	}
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Henan owner-verified directory schema: %w", err)
		}
		batch, err := loadVerifiedDiningBatch(henanOwnerVerifiedDiningSpec)
		if err != nil {
			return err
		}
		if err := canonicalizeVerifiedDiningCampuses(ctx, tx, *batch); err != nil {
			return err
		}
		if err := canonicalizeVerifiedDiningCanteens(ctx, tx, *batch); err != nil {
			return err
		}
		if err := ensureCampusDirectoryResearchBatch(ctx, tx, *batch); err != nil {
			return err
		}

		statements := []string{
			`UPDATE campus_directory_sources AS source
			 SET review_status = 'approved', updated_at = now()
			 FROM campus_directory_import_batches AS batch
			 WHERE source.batch_id = batch.id
			   AND batch.name = ?
			   AND source.source_type = ?
			   AND source.review_status <> 'approved'`,
			`UPDATE school_canteens AS canteen
			 SET status = 'active',
			     review_note = CASE
			       WHEN COALESCE(canteen.confidence_level, 'D') = 'D' THEN ?
			       ELSE canteen.review_note
			     END,
			     reviewed_at = COALESCE(canteen.reviewed_at, now()),
			     updated_at = now()
			 WHERE canteen.status IN ('pending_review', 'inactive')
			   AND EXISTS (
			     SELECT 1
			     FROM campus_directory_sources AS source
			     JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id
			     WHERE source.canteen_id = canteen.id
			       AND batch.name = ?
			       AND source.source_type = ?
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
			       AND source.source_type = ?
			       AND source.review_status = 'approved'
			   )`,
			`UPDATE campus_directory_import_batches
			 SET status = 'approved', updated_at = now()
			 WHERE name = ?`,
		}
		args := [][]any{
			{henanOwnerVerifiedDiningBatchName, henanOwnerVerifiedSourceType},
			{henanOwnerVerifiedDiningSpec.ReviewNote, henanOwnerVerifiedDiningBatchName, henanOwnerVerifiedSourceType},
			{henanOwnerVerifiedDiningBatchName, henanOwnerVerifiedSourceType},
			{henanOwnerVerifiedDiningBatchName},
		}
		for i, statement := range statements {
			if err := tx.Exec(statement, args[i]...).Error; err != nil {
				return fmt.Errorf("publish Henan owner-verified dining directory: %w", err)
			}
		}
		if err := applyHenanOwnerVerifiedDiningMetadata(ctx, tx, *batch); err != nil {
			return err
		}
		return verifyHenanOwnerVerifiedDiningDirectory(ctx, tx, *batch)
	})
}

func applyHenanOwnerVerifiedDiningMetadata(ctx context.Context, db *gorm.DB, batch campusDirectoryPendingResearchSeed) error {
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").Take(&school).Error; err != nil {
			return fmt.Errorf("find Henan owner-verified school %q: %w", schoolSeed.School, err)
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campus struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, strings.TrimSpace(campusSeed.Name), "active").Take(&campus).Error; err != nil {
				return fmt.Errorf("find Henan owner-verified campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campus.ID
		}

		for _, canteenSeed := range schoolSeed.Canteens {
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			if campusID == "" {
				return fmt.Errorf("update Henan owner-verified canteen %q/%q: campus %q is missing", schoolSeed.School, canteenSeed.Name, canteenSeed.Campus)
			}
			canteenID, err := findCampusDirectoryCanteenID(ctx, db, school.ID, &campusID, strings.TrimSpace(canteenSeed.Name))
			if err != nil {
				return fmt.Errorf("find Henan owner-verified canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			updates := map[string]any{
				"location_text":     nullableText(strings.TrimSpace(canteenSeed.LocationText)),
				"building_or_floor": nullableText(strings.TrimSpace(canteenSeed.BuildingOrFloor)),
				"service_type":      nullableText(strings.TrimSpace(canteenSeed.ServiceType)),
				"audience":          nullableText(strings.TrimSpace(canteenSeed.Audience)),
				"source_url":        nullableText(strings.TrimSpace(canteenSeed.SourceURL)),
				"source_org":        nullableText(strings.TrimSpace(canteenSeed.SourceOrg)),
				"source_type":       nullableText(strings.TrimSpace(canteenSeed.SourceType)),
				"review_note":       henanOwnerVerifiedDiningSpec.ReviewNote,
				"updated_at":        gorm.Expr("now()"),
			}
			result := db.WithContext(ctx).Table("school_canteens AS canteen").
				Where("canteen.id = ? AND COALESCE(canteen.confidence_level, 'D') = ?", *canteenID, "D").
				Where(`NOT EXISTS (
					SELECT 1 FROM campus_directory_sources AS stronger
					WHERE stronger.canteen_id = canteen.id
					  AND stronger.review_status = 'approved'
					  AND stronger.evidence_level IN ('A', 'B', 'C')
				)`).Updates(updates)
			if result.Error != nil {
				return fmt.Errorf("update Henan owner-verified canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, result.Error)
			}
		}
	}
	return nil
}

func verifyHenanOwnerVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, batch campusDirectoryPendingResearchSeed) error {
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").Take(&school).Error; err != nil {
			return fmt.Errorf("verify Henan owner-verified school %q: %w", schoolSeed.School, err)
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campuses []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, strings.TrimSpace(campusSeed.Name), "active").Find(&campuses).Error; err != nil {
				return fmt.Errorf("verify Henan owner-verified campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			if len(campuses) != 1 {
				return fmt.Errorf("verify Henan owner-verified campus %q/%q: got %d active rows, want 1", schoolSeed.School, campusSeed.Name, len(campuses))
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campuses[0].ID
		}
		for _, canteenSeed := range schoolSeed.Canteens {
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			var canteens []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_canteens").Select("id").
				Where("school_id = ? AND campus_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, campusID, strings.TrimSpace(canteenSeed.Name), "active").Find(&canteens).Error; err != nil {
				return fmt.Errorf("verify Henan owner-verified canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if len(canteens) != 1 {
				return fmt.Errorf("verify Henan owner-verified canteen %q/%q/%q: got %d active rows, want 1", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, len(canteens))
			}
			var approvedSourceCount int64
			if err := db.WithContext(ctx).Table("campus_directory_sources AS source").
				Joins("JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id").
				Where("source.canteen_id = ? AND source.source_url = ?", canteens[0].ID, strings.TrimSpace(canteenSeed.SourceURL)).
				Where("source.source_type = ? AND source.review_status = ? AND batch.name = ?", henanOwnerVerifiedSourceType, "approved", henanOwnerVerifiedDiningBatchName).
				Count(&approvedSourceCount).Error; err != nil {
				return fmt.Errorf("verify Henan owner-verified source %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if approvedSourceCount != 1 {
				return fmt.Errorf("verify Henan owner-verified source %q/%q/%q: got %d approved rows, want 1", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, approvedSourceCount)
			}
		}
	}

	var approvedBatchCount int64
	if err := db.WithContext(ctx).Table("campus_directory_import_batches").
		Where("name = ? AND status = ?", henanOwnerVerifiedDiningBatchName, "approved").Count(&approvedBatchCount).Error; err != nil {
		return fmt.Errorf("verify Henan owner-verified approved batch: %w", err)
	}
	if approvedBatchCount != 1 {
		return fmt.Errorf("verify Henan owner-verified approved batch: got %d rows, want 1", approvedBatchCount)
	}
	return nil
}
