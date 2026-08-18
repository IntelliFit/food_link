package migration

import (
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const tangshanRejectedDiningBatchName = "唐山高校官方食堂楼层确认集-20260816"

type TangshanDirectoryCorrectionDryRun struct {
	BatchSources    int64
	ActiveCampuses  int64
	ActiveCanteens  int64
	RejectedSources int64
}

type tangshanDirectoryCandidate struct {
	School  string
	Campus  string
	Canteen string
}

var tangshanDirectoryCandidates = []tangshanDirectoryCandidate{
	{School: "唐山师范学院", Campus: "大学道校区", Canteen: "第一食堂"},
	{School: "唐山师范学院", Campus: "大学道校区", Canteen: "第三食堂"},
	{School: "唐山幼儿师范高等专科学校", Campus: "京唐智慧港校区", Canteen: "第三食堂"},
}

func InspectTangshanDirectoryCorrection(ctx context.Context, db *gorm.DB, schema string) (*TangshanDirectoryCorrectionDryRun, error) {
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return nil, fmt.Errorf("set Tangshan correction schema: %w", err)
	}
	result := &TangshanDirectoryCorrectionDryRun{}
	if err := db.WithContext(ctx).Table("campus_directory_sources AS source").
		Joins("JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id").
		Where("batch.name = ?", tangshanRejectedDiningBatchName).Count(&result.BatchSources).Error; err != nil {
		return nil, fmt.Errorf("count Tangshan batch sources: %w", err)
	}
	if err := db.WithContext(ctx).Table("campus_directory_sources AS source").
		Joins("JOIN campus_directory_import_batches AS batch ON batch.id = source.batch_id").
		Where("batch.name = ? AND source.review_status = ?", tangshanRejectedDiningBatchName, "rejected").Count(&result.RejectedSources).Error; err != nil {
		return nil, fmt.Errorf("count rejected Tangshan sources: %w", err)
	}
	seenCampuses := map[string]struct{}{}
	for _, candidate := range tangshanDirectoryCandidates {
		var rows []struct {
			CanteenID string
			CampusID  string
		}
		if err := db.WithContext(ctx).Table("school_canteens AS canteen").
			Select("canteen.id AS canteen_id, campus.id AS campus_id").
			Joins("JOIN schools AS school ON school.id = canteen.school_id").
			Joins("JOIN school_campuses AS campus ON campus.id = canteen.campus_id").
			Where("school.name = ? AND campus.name = ? AND canteen.name = ? AND canteen.status = ?", candidate.School, candidate.Campus, candidate.Canteen, "active").
			Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("inspect Tangshan candidate %q/%q/%q: %w", candidate.School, candidate.Campus, candidate.Canteen, err)
		}
		result.ActiveCanteens += int64(len(rows))
		campusKey := strings.Join([]string{candidate.School, candidate.Campus}, "\x00")
		if _, exists := seenCampuses[campusKey]; !exists {
			seenCampuses[campusKey] = struct{}{}
			var activeCampuses int64
			if err := db.WithContext(ctx).Table("school_campuses AS campus").
				Joins("JOIN schools AS school ON school.id = campus.school_id").
				Where("school.name = ? AND campus.name = ? AND campus.status = ?", candidate.School, candidate.Campus, "active").
				Count(&activeCampuses).Error; err != nil {
				return nil, fmt.Errorf("inspect Tangshan campus %q/%q: %w", candidate.School, candidate.Campus, err)
			}
			result.ActiveCampuses += activeCampuses
		}
	}
	return result, nil
}

func ApplyTangshanDirectoryCorrection(ctx context.Context, db *gorm.DB, schema string) error {
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Tangshan correction schema: %w", err)
		}
		var batches []struct{ ID string }
		if err := tx.Table("campus_directory_import_batches").Select("id").Where("name = ?", tangshanRejectedDiningBatchName).Find(&batches).Error; err != nil {
			return fmt.Errorf("find Tangshan rejected batch: %w", err)
		}
		if len(batches) != 1 {
			return fmt.Errorf("find Tangshan rejected batch: got %d rows, want 1", len(batches))
		}
		if err := tx.Table("campus_directory_sources").Where("batch_id = ?", batches[0].ID).Updates(map[string]any{
			"review_status": "rejected", "evidence_level": "B", "updated_at": gorm.Expr("now()"),
		}).Error; err != nil {
			return fmt.Errorf("reject Tangshan procurement-only sources: %w", err)
		}
		campusIDs := map[string]string{}
		for _, candidate := range tangshanDirectoryCandidates {
			var rows []struct {
				CanteenID string
				CampusID  string
			}
			if err := tx.Table("school_canteens AS canteen").
				Select("canteen.id AS canteen_id, campus.id AS campus_id").
				Joins("JOIN schools AS school ON school.id = canteen.school_id").
				Joins("JOIN school_campuses AS campus ON campus.id = canteen.campus_id").
				Where("school.name = ? AND campus.name = ? AND canteen.name = ? AND canteen.status NOT IN ?", candidate.School, candidate.Campus, candidate.Canteen, []string{"deleted", "rejected"}).
				Find(&rows).Error; err != nil {
				return fmt.Errorf("find Tangshan candidate %q/%q/%q: %w", candidate.School, candidate.Campus, candidate.Canteen, err)
			}
			if len(rows) != 1 {
				return fmt.Errorf("find Tangshan candidate %q/%q/%q: got %d rows, want 1", candidate.School, candidate.Campus, candidate.Canteen, len(rows))
			}
			if err := tx.Table("school_canteens").Where("id = ?", rows[0].CanteenID).Updates(map[string]any{
				"status": "inactive", "confidence_level": "B",
				"review_note": "2026-08-16严格复核降级：仅有招采或未来合同期限，缺成交、履约及实际供餐闭环",
				"reviewed_at": gorm.Expr("COALESCE(reviewed_at, now())"), "updated_at": gorm.Expr("now()"),
			}).Error; err != nil {
				return fmt.Errorf("deactivate Tangshan candidate %q/%q/%q: %w", candidate.School, candidate.Campus, candidate.Canteen, err)
			}
			campusIDs[rows[0].CampusID] = candidate.Campus
		}
		for campusID, campusName := range campusIDs {
			result := tx.Exec(`UPDATE school_campuses AS campus
				SET status = 'inactive', updated_at = now()
				WHERE campus.id = ?
				  AND campus.status = 'active'
				  AND NOT EXISTS (
				    SELECT 1 FROM school_canteens AS canteen
				    WHERE canteen.campus_id = campus.id AND canteen.status = 'active'
				  )`, campusID)
			if result.Error != nil {
				return fmt.Errorf("deactivate empty Tangshan campus %q: %w", campusName, result.Error)
			}
			if result.RowsAffected > 1 {
				return fmt.Errorf("deactivate empty Tangshan campus %q: updated %d rows, want at most 1", campusName, result.RowsAffected)
			}
		}
		note := "2026-08-16严格复核拒绝：三项均只有招采/未来合同期，缺成交、履约或实际供餐证据"
		if err := tx.Table("campus_directory_import_batches").Where("id = ?", batches[0].ID).Updates(map[string]any{
			"status": "rejected", "notes": note, "updated_at": gorm.Expr("now()"),
		}).Error; err != nil {
			return fmt.Errorf("reject Tangshan directory batch: %w", err)
		}
		result, err := InspectTangshanDirectoryCorrection(ctx, tx, schema)
		if err != nil {
			return err
		}
		if result.ActiveCanteens != 0 || result.ActiveCampuses != 0 || result.RejectedSources != result.BatchSources {
			return fmt.Errorf("verify Tangshan correction: active_canteens=%d active_campuses=%d rejected_sources=%d batch_sources=%d", result.ActiveCanteens, result.ActiveCampuses, result.RejectedSources, result.BatchSources)
		}
		var rejectedBatches int64
		if err := tx.Table("campus_directory_import_batches").Where("id = ? AND status = ?", batches[0].ID, "rejected").Count(&rejectedBatches).Error; err != nil {
			return err
		}
		if rejectedBatches != 1 {
			return fmt.Errorf("verify Tangshan rejected batch: got %d rows, want 1", rejectedBatches)
		}
		return nil
	})
}

func tangshanDirectoryCandidateKey(candidate tangshanDirectoryCandidate) string {
	return strings.Join([]string{candidate.School, candidate.Campus, candidate.Canteen}, "\x00")
}
