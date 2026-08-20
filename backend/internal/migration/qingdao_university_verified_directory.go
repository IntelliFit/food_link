package migration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const (
	qingdaoUniversityVerifiedDiningBatchName = "青岛大学官方食堂楼层确认集-20260816"
	qingdaoUniversityVerifiedDiningSeedPath  = "data/qingdao_university_verified_dining_seed_20260816.json"
)

var qingdaoUniversityVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  qingdaoUniversityVerifiedDiningBatchName,
	SeedPath:   qingdaoUniversityVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16青岛大学官方来源楼层复核通过",
}

func InspectQingdaoUniversityVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	if err := validateVerifiedDiningBatchSpec(qingdaoUniversityVerifiedDiningSpec); err != nil {
		return nil, err
	}
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return nil, fmt.Errorf("set Qingdao verified dining schema: %w", err)
	}
	batch, err := loadVerifiedDiningBatch(qingdaoUniversityVerifiedDiningSpec)
	if err != nil {
		return nil, err
	}
	result := &VerifiedDiningBatchDryRun{Schools: len(batch.Schools)}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").Take(&school).Error; err != nil {
			return nil, fmt.Errorf("find Qingdao verified dining school %q: %w", schoolSeed.School, err)
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			result.Campuses++
			var campuses []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").
				Where("school_id = ? AND lower(name) IN ? AND status <> ?", school.ID, verifiedDiningCampusNames(campusSeed), "deleted").Find(&campuses).Error; err != nil {
				return nil, err
			}
			if len(campuses) > 1 {
				return nil, fmt.Errorf("inspect Qingdao campus %q: found %d rows", campusSeed.Name, len(campuses))
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
			if err := db.WithContext(ctx).Table("school_canteens").Where(
				"school_id = ? AND campus_id = ? AND lower(name) IN ? AND status NOT IN ?",
				school.ID, campusID, verifiedDiningCanteenNames(canteenSeed), []string{"deleted", "rejected"},
			).Count(&count).Error; err != nil {
				return nil, err
			}
			if count > 0 {
				result.ExistingCanteens++
			} else {
				result.NewCanteens++
			}
		}
	}
	return result, nil
}

func PublishQingdaoUniversityVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Qingdao verified dining schema: %w", err)
		}
		if err := collapseQingdaoUniversityDiningParents(ctx, tx); err != nil {
			return err
		}
		if err := PublishVerifiedDiningBatch(ctx, tx, schema, qingdaoUniversityVerifiedDiningSpec); err != nil {
			return err
		}
		if err := rejectQingdaoFloorChildSources(ctx, tx); err != nil {
			return err
		}
		if err := rejectQingdaoSupersededActivitySources(ctx, tx); err != nil {
			return err
		}
		if err := deactivateEmptyQingdaoCampus(ctx, tx); err != nil {
			return err
		}
		return verifyQingdaoParentCollapse(ctx, tx)
	})
}

func rejectQingdaoSupersededActivitySources(ctx context.Context, db *gorm.DB) error {
	result := db.WithContext(ctx).Exec(`UPDATE campus_directory_sources AS source
		SET review_status = 'rejected', updated_at = now()
		FROM school_canteens AS canteen, schools AS school, campus_directory_import_batches AS batch
		WHERE source.canteen_id = canteen.id
		  AND canteen.school_id = school.id
		  AND source.batch_id = batch.id
		  AND school.name = '青岛大学'
		  AND canteen.name IN ('仁园餐厅', '莘园餐厅')
		  AND batch.name = ?
		  AND source.source_url = 'https://houqin.qdu.edu.cn/info/1027/4636.htm'
		  AND source.review_status <> 'rejected'`, qingdaoUniversityVerifiedDiningBatchName)
	if result.Error != nil {
		return fmt.Errorf("reject Qingdao superseded activity sources: %w", result.Error)
	}
	if result.RowsAffected > 2 {
		return fmt.Errorf("reject Qingdao superseded activity sources: updated %d rows, want at most 2", result.RowsAffected)
	}
	return nil
}

func rejectQingdaoFloorChildSources(ctx context.Context, db *gorm.DB) error {
	result := db.WithContext(ctx).Exec(`UPDATE campus_directory_sources AS source
		SET review_status = 'rejected', updated_at = now()
		FROM school_canteens AS canteen, schools AS school, campus_directory_import_batches AS batch
		WHERE source.canteen_id = canteen.id
		  AND canteen.school_id = school.id
		  AND source.batch_id = batch.id
		  AND school.name = '青岛大学'
		  AND canteen.status = 'rejected'
		  AND batch.name = ?
		  AND source.review_status <> 'rejected'`, qingdaoUniversityVerifiedDiningBatchName)
	if result.Error != nil {
		return fmt.Errorf("reject Qingdao floor-child sources: %w", result.Error)
	}
	if result.RowsAffected > 5 {
		return fmt.Errorf("reject Qingdao floor-child sources: updated %d rows, want at most 5", result.RowsAffected)
	}
	return nil
}

func collapseQingdaoUniversityDiningParents(ctx context.Context, db *gorm.DB) error {
	batch, err := loadVerifiedDiningBatch(qingdaoUniversityVerifiedDiningSpec)
	if err != nil {
		return err
	}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").Take(&school).Error; err != nil {
			return fmt.Errorf("find Qingdao school for parent collapse: %w", err)
		}
		campusIDs := map[string]string{}
		for _, campusSeed := range schoolSeed.Campuses {
			var campus struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) IN ? AND status <> ?", school.ID, verifiedDiningCampusNames(campusSeed), "deleted").Take(&campus).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					continue
				}
				return fmt.Errorf("find Qingdao campus %q for parent collapse: %w", campusSeed.Name, err)
			}
			campusIDs[strings.TrimSpace(campusSeed.Name)] = campus.ID
		}
		for _, canteenSeed := range schoolSeed.Canteens {
			campusID := campusIDs[strings.TrimSpace(canteenSeed.Campus)]
			if campusID == "" {
				continue
			}
			var rows []struct {
				ID   string
				Name string
			}
			if err := db.WithContext(ctx).Table("school_canteens").Select("id, name").
				Where("school_id = ? AND campus_id = ? AND lower(name) IN ?", school.ID, campusID, verifiedDiningCanteenNames(canteenSeed)).
				Where("status NOT IN ?", []string{"deleted", "rejected"}).Order("created_at ASC").Find(&rows).Error; err != nil {
				return fmt.Errorf("find Qingdao parent candidates %q: %w", canteenSeed.Name, err)
			}
			if len(rows) == 0 {
				continue
			}
			canonical := rows[0]
			for _, row := range rows {
				if strings.EqualFold(strings.TrimSpace(row.Name), strings.TrimSpace(canteenSeed.Name)) {
					canonical = row
					break
				}
			}
			aliasesJSON, err := json.Marshal(canteenSeed.Aliases)
			if err != nil {
				return fmt.Errorf("encode Qingdao parent aliases %q: %w", canteenSeed.Name, err)
			}
			for _, row := range rows {
				if row.ID == canonical.ID {
					continue
				}
				if err := moveQingdaoDiningReferences(ctx, db, row.ID, canonical.ID, row.Name, canteenSeed.Name); err != nil {
					return fmt.Errorf("merge Qingdao dining child %q into %q: %w", row.Name, canteenSeed.Name, err)
				}
				if err := db.WithContext(ctx).Table("campus_directory_sources").Where("canteen_id = ?", row.ID).Updates(map[string]any{
					"review_status": "rejected", "updated_at": gorm.Expr("now()"),
				}).Error; err != nil {
					return err
				}
				if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", row.ID).Updates(map[string]any{
					"status": "rejected", "review_note": "2026-08-16父子去重：楼层经营区已归并至物理父食堂" + strings.TrimSpace(canteenSeed.Name),
					"reviewed_at": gorm.Expr("COALESCE(reviewed_at, now())"), "updated_at": gorm.Expr("now()"),
				}).Error; err != nil {
					return err
				}
			}
			if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", canonical.ID).Updates(map[string]any{
				"name": strings.TrimSpace(canteenSeed.Name), "aliases": gorm.Expr("?::jsonb", string(aliasesJSON)), "updated_at": gorm.Expr("now()"),
			}).Error; err != nil {
				return fmt.Errorf("rename Qingdao dining parent %q: %w", canteenSeed.Name, err)
			}
		}
	}
	return nil
}

func moveQingdaoDiningReferences(ctx context.Context, db *gorm.DB, fromID, toID, fromName, toName string) error {
	for _, table := range []string{
		"public_food_library", "canteen_windows", "campus_food_collection_batches",
		"campus_food_catalog_items", "campus_canteen_applications",
	} {
		if err := db.WithContext(ctx).Table(table).Where("canteen_id = ?", fromID).Update("canteen_id", toID).Error; err != nil {
			return fmt.Errorf("move %s canteen reference: %w", table, err)
		}
	}
	for _, target := range []struct {
		table  string
		column string
	}{
		{table: "public_food_library", column: "canteen_name"},
		{table: "campus_food_collection_batches", column: "canteen_name"},
		{table: "campus_food_catalog_items", column: "canteen_name"},
		{table: "campus_canteen_applications", column: "requested_canteen_name"},
	} {
		if err := db.WithContext(ctx).Table(target.table).
			Where("canteen_id = ? AND lower(trim("+target.column+")) = lower(trim(?))", toID, fromName).
			Update(target.column, strings.TrimSpace(toName)).Error; err != nil {
			return fmt.Errorf("normalize %s.%s after canteen merge: %w", target.table, target.column, err)
		}
	}
	return nil
}

func deactivateEmptyQingdaoCampus(ctx context.Context, db *gorm.DB) error {
	result := db.WithContext(ctx).Exec(`UPDATE school_campuses AS campus
		SET status = 'inactive', updated_at = now()
		FROM schools AS school
		WHERE campus.school_id = school.id
		  AND school.name = '青岛大学'
		  AND campus.name = '松山校区'
		  AND campus.status = 'active'
		  AND NOT EXISTS (
		    SELECT 1 FROM school_canteens AS canteen
		    WHERE canteen.campus_id = campus.id AND canteen.status = 'active'
		  )`)
	if result.Error != nil {
		return fmt.Errorf("deactivate empty Qingdao Songshan campus: %w", result.Error)
	}
	if result.RowsAffected > 1 {
		return fmt.Errorf("deactivate empty Qingdao Songshan campus: updated %d rows, want at most 1", result.RowsAffected)
	}
	return nil
}

func verifyQingdaoParentCollapse(ctx context.Context, db *gorm.DB) error {
	batch, err := loadVerifiedDiningBatch(qingdaoUniversityVerifiedDiningSpec)
	if err != nil {
		return err
	}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", schoolSeed.School, "active").Take(&school).Error; err != nil {
			return err
		}
		for _, canteenSeed := range schoolSeed.Canteens {
			var canonical int64
			if err := db.WithContext(ctx).Table("school_canteens").Where("school_id = ? AND lower(name) = lower(?) AND status = ?", school.ID, canteenSeed.Name, "active").Count(&canonical).Error; err != nil {
				return err
			}
			if canonical != 1 {
				return fmt.Errorf("verify Qingdao parent %q: got %d active canonical rows, want 1", canteenSeed.Name, canonical)
			}
			if len(canteenSeed.Aliases) == 0 {
				continue
			}
			aliases := make([]string, 0, len(canteenSeed.Aliases))
			for _, alias := range canteenSeed.Aliases {
				if !strings.EqualFold(strings.TrimSpace(alias), strings.TrimSpace(canteenSeed.Name)) {
					aliases = append(aliases, strings.ToLower(strings.TrimSpace(alias)))
				}
			}
			var reusableAliases int64
			if err := db.WithContext(ctx).Table("school_canteens").Where("school_id = ? AND lower(name) IN ? AND status NOT IN ?", school.ID, aliases, []string{"deleted", "rejected"}).Count(&reusableAliases).Error; err != nil {
				return err
			}
			if reusableAliases != 0 {
				return fmt.Errorf("verify Qingdao parent %q: found %d reusable floor child rows", canteenSeed.Name, reusableAliases)
			}
		}
		var activeSongshan int64
		if err := db.WithContext(ctx).Table("school_campuses").Where("school_id = ? AND name = ? AND status = ?", school.ID, "松山校区", "active").Count(&activeSongshan).Error; err != nil {
			return err
		}
		if activeSongshan != 0 {
			return fmt.Errorf("verify Qingdao empty Songshan campus: got %d active rows, want 0", activeSongshan)
		}
		var approvedChildSources int64
		if err := db.WithContext(ctx).Table("campus_directory_sources AS source").
			Joins("JOIN school_canteens AS canteen ON canteen.id = source.canteen_id").
			Joins("JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id").
			Where("canteen.school_id = ? AND canteen.status = ? AND batch.name = ? AND source.review_status = ?", school.ID, "rejected", qingdaoUniversityVerifiedDiningBatchName, "approved").
			Count(&approvedChildSources).Error; err != nil {
			return err
		}
		if approvedChildSources != 0 {
			return fmt.Errorf("verify Qingdao floor-child sources: got %d approved rows, want 0", approvedChildSources)
		}
		var approvedSupersededActivitySources int64
		if err := db.WithContext(ctx).Table("campus_directory_sources AS source").
			Joins("JOIN school_canteens AS canteen ON canteen.id = source.canteen_id").
			Joins("JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id").
			Where("canteen.school_id = ? AND canteen.name IN ? AND batch.name = ? AND source.source_url = ? AND source.review_status = ?", school.ID, []string{"仁园餐厅", "莘园餐厅"}, qingdaoUniversityVerifiedDiningBatchName, "https://houqin.qdu.edu.cn/info/1027/4636.htm", "approved").
			Count(&approvedSupersededActivitySources).Error; err != nil {
			return err
		}
		if approvedSupersededActivitySources != 0 {
			return fmt.Errorf("verify Qingdao superseded activity sources: got %d approved rows, want 0", approvedSupersededActivitySources)
		}
	}
	return nil
}
