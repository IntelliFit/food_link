package migration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"gorm.io/gorm"
)

type VerifiedDiningBatchSpec struct {
	BatchName  string
	SeedPath   string
	ReviewNote string
}

type VerifiedDiningBatchDryRun struct {
	Schools          int
	Campuses         int
	Canteens         int
	ExistingCampuses int
	ExistingCanteens int
	NewCampuses      int
	NewCanteens      int
}

func InspectVerifiedDiningBatch(ctx context.Context, db *gorm.DB, schema string, spec VerifiedDiningBatchSpec) (*VerifiedDiningBatchDryRun, error) {
	if err := validateVerifiedDiningBatchSpec(spec); err != nil {
		return nil, err
	}
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return nil, fmt.Errorf("set verified dining batch schema: %w", err)
	}
	batch, err := loadVerifiedDiningBatch(spec)
	if err != nil {
		return nil, err
	}
	result := &VerifiedDiningBatchDryRun{Schools: len(batch.Schools)}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").Take(&school).Error; err != nil {
			return nil, fmt.Errorf("find verified dining school %q: %w", schoolSeed.School, err)
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			result.Campuses++
			var campuses []struct {
				ID   string
				Name string
			}
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) IN ? AND status <> ?", school.ID, verifiedDiningCampusNames(campusSeed), "deleted").Find(&campuses).Error; err != nil {
				return nil, fmt.Errorf("inspect verified dining campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			if len(campuses) > 1 {
				return nil, fmt.Errorf("inspect verified dining campus %q/%q: found %d non-deleted rows", schoolSeed.School, campusSeed.Name, len(campuses))
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
				Where("school_id = ? AND campus_id = ? AND lower(name) IN ?", school.ID, campusID, verifiedDiningCanteenNames(canteenSeed)).
				Where("status NOT IN ?", []string{"deleted", "rejected"}).Count(&count).Error; err != nil {
				return nil, fmt.Errorf("inspect verified dining canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if count > 1 {
				return nil, fmt.Errorf("inspect verified dining canteen %q/%q/%q: found %d reusable rows", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, count)
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

func PublishVerifiedDiningBatch(ctx context.Context, db *gorm.DB, schema string, spec VerifiedDiningBatchSpec) error {
	if err := validateVerifiedDiningBatchSpec(spec); err != nil {
		return err
	}
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set verified dining batch schema: %w", err)
		}
		batch, err := loadVerifiedDiningBatch(spec)
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
		if err := tx.Exec(`UPDATE campus_directory_sources AS source
			SET review_status = 'approved', updated_at = now()
			FROM campus_directory_import_batches AS batch
			WHERE source.batch_id = batch.id
			  AND batch.name = ?
			  AND source.evidence_level = 'A'
			  AND source.review_status <> 'approved'`, spec.BatchName).Error; err != nil {
			return fmt.Errorf("approve verified dining sources: %w", err)
		}
		if err := applyVerifiedDiningBatchMetadata(ctx, tx, *batch, spec); err != nil {
			return err
		}
		if err := tx.Table("campus_directory_import_batches").Where("name = ?", spec.BatchName).
			Updates(map[string]any{"status": "approved", "updated_at": gorm.Expr("now()")}).Error; err != nil {
			return fmt.Errorf("approve verified dining batch: %w", err)
		}
		return verifyVerifiedDiningBatch(ctx, tx, *batch, spec)
	})
}

func canonicalizeVerifiedDiningCampuses(ctx context.Context, db *gorm.DB, batch campusDirectoryPendingResearchSeed) error {
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").Take(&school).Error; err != nil {
			return fmt.Errorf("find verified dining canonical school %q: %w", schoolSeed.School, err)
		}
		for _, campusSeed := range schoolSeed.Campuses {
			var campuses []struct {
				ID   string
				Name string
			}
			if err := db.WithContext(ctx).Table("school_campuses").Select("id, name").
				Where("school_id = ? AND lower(name) IN ? AND status <> ?", school.ID, verifiedDiningCampusNames(campusSeed), "deleted").Find(&campuses).Error; err != nil {
				return fmt.Errorf("find verified dining canonical campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			if len(campuses) > 1 {
				return fmt.Errorf("canonicalize verified dining campus %q/%q: found %d alias-matched rows", schoolSeed.School, campusSeed.Name, len(campuses))
			}
			if len(campuses) == 0 || strings.EqualFold(strings.TrimSpace(campuses[0].Name), strings.TrimSpace(campusSeed.Name)) {
				continue
			}
			aliasesJSON, err := json.Marshal(campusSeed.Aliases)
			if err != nil {
				return fmt.Errorf("encode verified dining campus aliases %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			if err := db.WithContext(ctx).Table("school_campuses").Where("id = ?", campuses[0].ID).Updates(map[string]any{
				"name":       strings.TrimSpace(campusSeed.Name),
				"aliases":    gorm.Expr("?::jsonb", string(aliasesJSON)),
				"updated_at": gorm.Expr("now()"),
			}).Error; err != nil {
				return fmt.Errorf("canonicalize verified dining campus %q/%q from %q: %w", schoolSeed.School, campusSeed.Name, campuses[0].Name, err)
			}
		}
	}
	return nil
}

func verifiedDiningCampusNames(seed campusDirectoryResearchCampus) []string {
	names := make([]string, 0, 1+len(seed.Aliases))
	seen := map[string]struct{}{}
	for _, value := range append([]string{seed.Name}, seed.Aliases...) {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		names = append(names, value)
	}
	return names
}

func canonicalizeVerifiedDiningCanteens(ctx context.Context, db *gorm.DB, batch campusDirectoryPendingResearchSeed) error {
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").Take(&school).Error; err != nil {
			return fmt.Errorf("find verified dining canonical school %q: %w", schoolSeed.School, err)
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campus struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, strings.TrimSpace(campusSeed.Name), "deleted").Take(&campus).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					continue
				}
				return fmt.Errorf("find verified dining canonical campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campus.ID
		}
		for _, canteenSeed := range schoolSeed.Canteens {
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			if campusID == "" {
				continue
			}
			var canteens []struct {
				ID   string
				Name string
			}
			if err := db.WithContext(ctx).Table("school_canteens").Select("id, name").
				Where("school_id = ? AND campus_id = ? AND lower(name) IN ?", school.ID, campusID, verifiedDiningCanteenNames(canteenSeed)).
				Where("status NOT IN ?", []string{"deleted", "rejected"}).Find(&canteens).Error; err != nil {
				return fmt.Errorf("find verified dining canonical canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if len(canteens) > 1 {
				return fmt.Errorf("canonicalize verified dining canteen %q/%q/%q: found %d alias-matched rows", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, len(canteens))
			}
			if len(canteens) == 0 {
				continue
			}
			aliasesJSON, err := json.Marshal(canteenSeed.Aliases)
			if err != nil {
				return fmt.Errorf("encode verified dining canteen aliases %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", canteens[0].ID).Updates(map[string]any{
				"name":       strings.TrimSpace(canteenSeed.Name),
				"aliases":    gorm.Expr("?::jsonb", string(aliasesJSON)),
				"updated_at": gorm.Expr("now()"),
			}).Error; err != nil {
				return fmt.Errorf("canonicalize verified dining canteen %q/%q/%q from %q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, canteens[0].Name, err)
			}
		}
	}
	return nil
}

func verifiedDiningCanteenNames(seed campusDirectoryResearchCanteen) []string {
	names := make([]string, 0, 1+len(seed.Aliases))
	seen := map[string]struct{}{}
	for _, value := range append([]string{seed.Name}, seed.Aliases...) {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		names = append(names, value)
	}
	return names
}

func ensureCampusDirectoryResearchBatch(ctx context.Context, db *gorm.DB, batch campusDirectoryPendingResearchSeed) error {
	batchID, err := ensureCampusDirectoryPendingBatch(ctx, db, batch)
	if err != nil {
		return err
	}
	for _, schoolSeed := range batch.Schools {
		if err := ensureCampusDirectoryPendingSchoolResearch(ctx, db, batchID, schoolSeed); err != nil {
			return err
		}
	}
	return nil
}

func loadVerifiedDiningBatch(spec VerifiedDiningBatchSpec) (*campusDirectoryPendingResearchSeed, error) {
	data, err := os.ReadFile(spec.SeedPath)
	if err != nil {
		return nil, fmt.Errorf("read verified dining seed %q: %w", spec.SeedPath, err)
	}
	var batches []campusDirectoryPendingResearchSeed
	if err := json.Unmarshal(data, &batches); err != nil {
		return nil, fmt.Errorf("parse verified dining seed %q: %w", spec.SeedPath, err)
	}
	var match *campusDirectoryPendingResearchSeed
	for i := range batches {
		if strings.TrimSpace(batches[i].BatchName) == strings.TrimSpace(spec.BatchName) {
			if match != nil {
				return nil, fmt.Errorf("verified dining seed contains duplicate batch %q", spec.BatchName)
			}
			match = &batches[i]
		}
	}
	if match == nil {
		return nil, fmt.Errorf("verified dining seed does not contain batch %q", spec.BatchName)
	}
	return match, nil
}

func applyVerifiedDiningBatchMetadata(ctx context.Context, db *gorm.DB, batch campusDirectoryPendingResearchSeed, spec VerifiedDiningBatchSpec) error {
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").Take(&school).Error; err != nil {
			return fmt.Errorf("find verified dining metadata school %q: %w", schoolSeed.School, err)
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campus struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, strings.TrimSpace(campusSeed.Name), "deleted").Take(&campus).Error; err != nil {
				return fmt.Errorf("find verified dining metadata campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
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
				"status": "active", "confidence_level": "A", "review_note": spec.ReviewNote,
				"reviewed_at": gorm.Expr("COALESCE(reviewed_at, now())"), "updated_at": gorm.Expr("now()"),
			}
			for column, value := range map[string]string{
				"location_text": canteenSeed.LocationText, "building_or_floor": canteenSeed.BuildingOrFloor,
				"service_type": canteenSeed.ServiceType, "audience": canteenSeed.Audience,
				"source_url": canteenSeed.SourceURL, "source_org": canteenSeed.SourceOrg, "source_type": canteenSeed.SourceType,
			} {
				if value = strings.TrimSpace(value); value != "" {
					updates[column] = value
				}
			}
			if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", *canteenID).Updates(updates).Error; err != nil {
				return fmt.Errorf("update verified dining canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
		}
	}
	return nil
}

func verifyVerifiedDiningBatch(ctx context.Context, db *gorm.DB, batch campusDirectoryPendingResearchSeed, spec VerifiedDiningBatchSpec) error {
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").Take(&school).Error; err != nil {
			return err
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campuses []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, strings.TrimSpace(campusSeed.Name), "active").Find(&campuses).Error; err != nil {
				return err
			}
			if len(campuses) != 1 {
				return fmt.Errorf("verify verified dining campus %q/%q: got %d active rows, want 1", schoolSeed.School, campusSeed.Name, len(campuses))
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campuses[0].ID
		}
		for _, canteenSeed := range schoolSeed.Canteens {
			var rows []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_canteens").Select("id").
				Where("school_id = ? AND campus_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, campusIDs[strings.TrimSpace(canteenSeed.Campus)], strings.TrimSpace(canteenSeed.Name), "active").
				Where("building_or_floor = ? AND confidence_level = ?", strings.TrimSpace(canteenSeed.BuildingOrFloor), "A").Find(&rows).Error; err != nil {
				return err
			}
			if len(rows) != 1 {
				return fmt.Errorf("verify verified dining canteen %q/%q/%q: got %d exact active rows, want 1", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, len(rows))
			}
			sourceURLs := []string{strings.TrimSpace(canteenSeed.SourceURL)}
			for _, source := range canteenSeed.AdditionalSources {
				sourceURLs = append(sourceURLs, strings.TrimSpace(source.SourceURL))
			}
			for _, sourceURL := range sourceURLs {
				if sourceURL == "" {
					continue
				}
				// An already-approved source may have been introduced by an earlier
				// batch. Reusing that exact canteen/source pair must not move it out
				// of its original audit batch or require a duplicate source row.
				sources, err := countApprovedVerifiedDiningSources(ctx, db, rows[0].ID, sourceURL)
				if err != nil {
					return err
				}
				if sources < 1 {
					return fmt.Errorf("verify verified dining source %q/%q/%q/%s: got %d approved rows, want at least 1", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, sourceURL, sources)
				}
			}
		}
	}
	var approved int64
	if err := db.WithContext(ctx).Table("campus_directory_import_batches").Where("name = ? AND status = ?", spec.BatchName, "approved").Count(&approved).Error; err != nil {
		return err
	}
	if approved != 1 {
		return fmt.Errorf("verify verified dining approved batch %q: got %d rows, want 1", spec.BatchName, approved)
	}
	return nil
}

func countApprovedVerifiedDiningSources(ctx context.Context, db *gorm.DB, canteenID string, sourceURL string) (int64, error) {
	var sources int64
	err := db.WithContext(ctx).Table("campus_directory_sources").
		Where("canteen_id = ? AND source_url = ? AND evidence_level = ? AND review_status = ?", canteenID, sourceURL, "A", "approved").
		Count(&sources).Error
	return sources, err
}

func validateVerifiedDiningBatchSpec(spec VerifiedDiningBatchSpec) error {
	if strings.TrimSpace(spec.BatchName) == "" || strings.TrimSpace(spec.SeedPath) == "" {
		return fmt.Errorf("verified dining batch name and seed path are required")
	}
	return nil
}

func normalizeSchema(schema string) string {
	if schema = strings.TrimSpace(schema); schema == "" {
		return "public"
	}
	return schema
}
