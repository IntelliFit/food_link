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
	remainingCapitalVerifiedDiningBatchName = "剩余省会高校官方食堂楼层-20260812"
	remainingCapitalVerifiedDiningSeedPath  = "data/remaining_capital_verified_dining_seed_20260812.json"
)

type supersededCapitalDiningRow struct {
	school string
	campus string
	name   string
	note   string
}

var supersededCapitalDiningRows = []supersededCapitalDiningRow{
	{school: "重庆大学", campus: "科学城校区虎溪校园", name: "第一学生食堂", note: "2026-08-12官方页面确认已停止供餐"},
	{school: "天津大学", campus: "卫津路校区", name: "清真食堂", note: "2026-08-12复核为学五食堂二层重复子记录"},
}

// RemainingCapitalVerifiedDiningDryRun summarizes the exact official-source
// hierarchy that would be created or reused. It never writes to the database.
type RemainingCapitalVerifiedDiningDryRun struct {
	Schools          int
	Campuses         int
	Canteens         int
	ExistingCampuses int
	ExistingCanteens int
	NewCampuses      int
	NewCanteens      int
}

// InspectRemainingCapitalVerifiedDiningDirectory validates the target school
// hierarchy and reports the idempotent delta without changing any rows.
func InspectRemainingCapitalVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*RemainingCapitalVerifiedDiningDryRun, error) {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return nil, fmt.Errorf("set remaining-capital directory schema: %w", err)
	}

	batch, err := loadRemainingCapitalVerifiedDiningSeed()
	if err != nil {
		return nil, err
	}
	result := &RemainingCapitalVerifiedDiningDryRun{Schools: len(batch.Schools)}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").
			Take(&school).Error; err != nil {
			return nil, fmt.Errorf("find remaining-capital verified school %q: %w", schoolSeed.School, err)
		}

		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			result.Campuses++
			var campuses []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, strings.TrimSpace(campusSeed.Name), "deleted").
				Find(&campuses).Error; err != nil {
				return nil, fmt.Errorf("inspect remaining-capital campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			if len(campuses) > 1 {
				return nil, fmt.Errorf("inspect remaining-capital campus %q/%q: found %d non-deleted rows", schoolSeed.School, campusSeed.Name, len(campuses))
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
				return nil, fmt.Errorf("inspect remaining-capital canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if count > 1 {
				return nil, fmt.Errorf("inspect remaining-capital canteen %q/%q/%q: found %d reusable rows", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, count)
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

// PublishRemainingCapitalVerifiedDiningDirectory transactionally imports and
// publishes only the 179 official-source records in this reviewed batch.
func PublishRemainingCapitalVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set remaining-capital directory schema: %w", err)
		}
		if err := ensureCampusDirectoryResearchSeedFile(ctx, tx, remainingCapitalVerifiedDiningSeedPath); err != nil {
			return fmt.Errorf("import remaining-capital verified dining seed: %w", err)
		}
		if err := tx.Exec(`UPDATE campus_directory_sources AS source
			SET review_status = 'approved', updated_at = now()
			FROM campus_directory_import_batches AS batch
			WHERE source.batch_id = batch.id
			  AND batch.name = ?
			  AND source.evidence_level = 'A'
			  AND source.review_status <> 'approved'`, remainingCapitalVerifiedDiningBatchName).Error; err != nil {
			return fmt.Errorf("approve remaining-capital directory sources: %w", err)
		}
		if err := applyRemainingCapitalVerifiedDiningMetadata(ctx, tx); err != nil {
			return err
		}
		if err := withdrawSupersededCapitalDiningRows(ctx, tx); err != nil {
			return err
		}
		if err := tx.Exec(`UPDATE campus_directory_import_batches
			SET status = 'approved', updated_at = now()
			WHERE name = ?`, remainingCapitalVerifiedDiningBatchName).Error; err != nil {
			return fmt.Errorf("approve remaining-capital directory batch: %w", err)
		}
		return verifyRemainingCapitalVerifiedDiningDirectory(ctx, tx)
	})
}

func loadRemainingCapitalVerifiedDiningSeed() (*campusDirectoryPendingResearchSeed, error) {
	data, err := os.ReadFile(remainingCapitalVerifiedDiningSeedPath)
	if err != nil {
		return nil, fmt.Errorf("read remaining-capital verified dining seed: %w", err)
	}
	var batches []campusDirectoryPendingResearchSeed
	if err := json.Unmarshal(data, &batches); err != nil {
		return nil, fmt.Errorf("parse remaining-capital verified dining seed: %w", err)
	}
	if len(batches) != 1 || batches[0].BatchName != remainingCapitalVerifiedDiningBatchName {
		return nil, fmt.Errorf("remaining-capital verified dining seed has unexpected batch metadata")
	}
	return &batches[0], nil
}

func applyRemainingCapitalVerifiedDiningMetadata(ctx context.Context, db *gorm.DB) error {
	batch, err := loadRemainingCapitalVerifiedDiningSeed()
	if err != nil {
		return err
	}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").
			Take(&school).Error; err != nil {
			return fmt.Errorf("find remaining-capital metadata school %q: %w", schoolSeed.School, err)
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campus struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, strings.TrimSpace(campusSeed.Name), "deleted").
				Take(&campus).Error; err != nil {
				return fmt.Errorf("find remaining-capital metadata campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			updates := map[string]any{"status": "active", "updated_at": gorm.Expr("now()")}
			if value := strings.TrimSpace(campusSeed.Address); value != "" {
				updates["address"] = value
			}
			if value := strings.TrimSpace(campusSeed.SourceURL); value != "" {
				updates["source_url"] = value
			}
			if err := db.WithContext(ctx).Table("school_campuses").Where("id = ?", campus.ID).Updates(updates).Error; err != nil {
				return fmt.Errorf("update remaining-capital campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campus.ID
		}

		for _, canteenSeed := range schoolSeed.Canteens {
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			if campusID == "" {
				return fmt.Errorf("update remaining-capital canteen %q/%q: campus %q is missing", schoolSeed.School, canteenSeed.Name, canteenSeed.Campus)
			}
			canteenID, findErr := findCampusDirectoryCanteenID(ctx, db, school.ID, &campusID, strings.TrimSpace(canteenSeed.Name))
			if findErr != nil {
				return fmt.Errorf("find remaining-capital canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, findErr)
			}
			updates := map[string]any{
				"status":           "active",
				"confidence_level": "A",
				"review_note":      "2026-08-12高校官方来源复核通过",
				"reviewed_at":      gorm.Expr("COALESCE(reviewed_at, now())"),
				"updated_at":       gorm.Expr("now()"),
			}
			for column, value := range map[string]string{
				"location_text": canteenSeed.LocationText, "building_or_floor": canteenSeed.BuildingOrFloor,
				"service_type": canteenSeed.ServiceType, "source_url": canteenSeed.SourceURL,
				"source_org": canteenSeed.SourceOrg, "source_type": canteenSeed.SourceType,
			} {
				if value = strings.TrimSpace(value); value != "" {
					updates[column] = value
				}
			}
			if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", *canteenID).Updates(updates).Error; err != nil {
				return fmt.Errorf("update remaining-capital canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
		}
	}
	return nil
}

func withdrawSupersededCapitalDiningRows(ctx context.Context, db *gorm.DB) error {
	for _, row := range supersededCapitalDiningRows {
		if err := db.WithContext(ctx).Exec(`UPDATE school_canteens AS canteen
			SET status = 'inactive', review_note = ?, reviewed_at = now(), updated_at = now()
			FROM schools AS school, school_campuses AS campus
			WHERE canteen.school_id = school.id
			  AND canteen.campus_id = campus.id
			  AND school.name = ?
			  AND lower(campus.name) = lower(?)
			  AND lower(canteen.name) = lower(?)
			  AND canteen.status = 'active'`, row.note, row.school, row.campus, row.name).Error; err != nil {
			return fmt.Errorf("withdraw superseded canteen %q/%q/%q: %w", row.school, row.campus, row.name, err)
		}
	}
	return nil
}

func verifyRemainingCapitalVerifiedDiningDirectory(ctx context.Context, db *gorm.DB) error {
	batch, err := loadRemainingCapitalVerifiedDiningSeed()
	if err != nil {
		return err
	}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").
			Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").Take(&school).Error; err != nil {
			return fmt.Errorf("verify remaining-capital school %q: %w", schoolSeed.School, err)
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			var campuses []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, strings.TrimSpace(campusSeed.Name), "active").
				Find(&campuses).Error; err != nil {
				return fmt.Errorf("verify remaining-capital campus %q/%q: %w", schoolSeed.School, campusSeed.Name, err)
			}
			if len(campuses) != 1 {
				return fmt.Errorf("verify remaining-capital campus %q/%q: got %d active rows, want 1", schoolSeed.School, campusSeed.Name, len(campuses))
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
				return fmt.Errorf("verify remaining-capital canteen %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if len(canteens) != 1 {
				return fmt.Errorf("verify remaining-capital canteen %q/%q/%q: got %d exact active rows, want 1", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, len(canteens))
			}
			var approvedSourceCount int64
			if err := db.WithContext(ctx).Table("campus_directory_sources").
				Where("canteen_id = ? AND source_url = ? AND evidence_level = ? AND review_status = ?", canteens[0].ID, strings.TrimSpace(canteenSeed.SourceURL), "A", "approved").
				Count(&approvedSourceCount).Error; err != nil {
				return fmt.Errorf("verify remaining-capital source %q/%q/%q: %w", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, err)
			}
			if approvedSourceCount != 1 {
				return fmt.Errorf("verify remaining-capital source %q/%q/%q: got %d approved rows, want 1", schoolSeed.School, canteenSeed.Campus, canteenSeed.Name, approvedSourceCount)
			}
		}
	}
	var approvedBatchCount int64
	if err := db.WithContext(ctx).Table("campus_directory_import_batches").
		Where("name = ? AND status = ?", remainingCapitalVerifiedDiningBatchName, "approved").Count(&approvedBatchCount).Error; err != nil {
		return fmt.Errorf("verify remaining-capital approved batch: %w", err)
	}
	if approvedBatchCount != 1 {
		return fmt.Errorf("verify remaining-capital approved batch: got %d rows, want 1", approvedBatchCount)
	}
	for _, row := range supersededCapitalDiningRows {
		var activeCount int64
		if err := db.WithContext(ctx).Table("school_canteens AS canteen").
			Joins("JOIN schools AS school ON school.id = canteen.school_id").
			Joins("JOIN school_campuses AS campus ON campus.id = canteen.campus_id").
			Where("school.name = ? AND lower(campus.name) = lower(?) AND lower(canteen.name) = lower(?) AND canteen.status = ?", row.school, row.campus, row.name, "active").
			Count(&activeCount).Error; err != nil {
			return fmt.Errorf("verify superseded canteen %q/%q/%q: %w", row.school, row.campus, row.name, err)
		}
		if activeCount != 0 {
			return fmt.Errorf("verify superseded canteen %q/%q/%q: got %d active rows, want 0", row.school, row.campus, row.name, activeCount)
		}
	}
	return nil
}
