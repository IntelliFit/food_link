package migration

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

const (
	panjinVerifiedDiningBatchName = "盘锦高校官方食堂楼层确认集-20260816"
	panjinVerifiedDiningSeedPath  = "data/panjin_verified_dining_seed_20260816.json"
)

var panjinVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  panjinVerifiedDiningBatchName,
	SeedPath:   panjinVerifiedDiningSeedPath,
	ReviewNote: "2026-08-16盘锦高校官方来源楼层及当前状态复核通过",
}

func InspectPanjinVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, panjinVerifiedDiningSpec)
}

func PublishPanjinVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Panjin verified dining schema: %w", err)
		}
		if err := PublishVerifiedDiningBatch(ctx, tx, schema, panjinVerifiedDiningSpec); err != nil {
			return err
		}
		var school struct{ ID string }
		if err := tx.Table("schools").Select("id").Where("name = ? AND status = ?", "大连理工大学", "active").Take(&school).Error; err != nil {
			return fmt.Errorf("find Dalian University of Technology for Panjin deduplication: %w", err)
		}
		var campus struct{ ID string }
		if err := tx.Table("school_campuses").Select("id").Where("school_id = ? AND name = ? AND status = ?", school.ID, "盘锦校区", "active").Take(&campus).Error; err != nil {
			return fmt.Errorf("find Panjin campus for dining deduplication: %w", err)
		}
		result := tx.Table("school_canteens").Where(
			"school_id = ? AND campus_id = ? AND name = ? AND status = ?",
			school.ID, campus.ID, "第八食堂清真拉面", "active",
		).Updates(map[string]any{
			"status":      "inactive",
			"review_note": "2026-08-16父子去重：清真拉面是第八食堂内部档口，楼层关系已归并父食堂",
			"reviewed_at": gorm.Expr("COALESCE(reviewed_at, now())"),
			"updated_at":  gorm.Expr("now()"),
		})
		if result.Error != nil {
			return fmt.Errorf("deactivate duplicate Panjin dining child: %w", result.Error)
		}
		if result.RowsAffected > 1 {
			return fmt.Errorf("deactivate duplicate Panjin dining child: updated %d rows, want at most 1", result.RowsAffected)
		}
		return nil
	})
}
