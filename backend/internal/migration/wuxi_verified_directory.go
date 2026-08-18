package migration

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

const (
	wuxiVerifiedDiningBatchName = "无锡高校官方食堂楼层确认集-20260818"
	wuxiVerifiedDiningSeedPath  = "data/wuxi_verified_dining_seed_20260818.json"
)

var wuxiVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  wuxiVerifiedDiningBatchName,
	SeedPath:   wuxiVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18无锡高校官方来源楼层及当前状态复核通过",
}

func InspectWuxiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, wuxiVerifiedDiningSpec)
}

func PublishWuxiVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Wuxi verified dining schema: %w", err)
		}
		if err := PublishVerifiedDiningBatch(ctx, tx, schema, wuxiVerifiedDiningSpec); err != nil {
			return err
		}
		return deactivateWuxiDuplicateDiningChild(tx)
	})
}

func deactivateWuxiDuplicateDiningChild(db *gorm.DB) error {
	var school struct{ ID string }
	if err := db.Table("schools").Select("id").Where("name = ? AND status = ?", "江南大学", "active").Take(&school).Error; err != nil {
		return fmt.Errorf("find Jiangnan University for Wuxi deduplication: %w", err)
	}
	var campus struct{ ID string }
	if err := db.Table("school_campuses").Select("id").Where("school_id = ? AND name = ? AND status = ?", school.ID, "蠡湖校区", "active").Take(&campus).Error; err != nil {
		return fmt.Errorf("find Lihu campus for Wuxi deduplication: %w", err)
	}
	var canteens []struct{ ID string }
	if err := db.Table("school_canteens").Select("id").Where(
		"school_id = ? AND campus_id = ? AND name = ? AND status NOT IN ?",
		school.ID, campus.ID, "民族餐厅", []string{"deleted", "rejected"},
	).Find(&canteens).Error; err != nil {
		return fmt.Errorf("find duplicate Wuxi dining child: %w", err)
	}
	if len(canteens) > 1 {
		return fmt.Errorf("find duplicate Wuxi dining child: got %d rows, want at most 1", len(canteens))
	}
	if len(canteens) == 0 {
		return nil
	}
	if err := db.Table("campus_directory_sources").Where("canteen_id = ? AND review_status <> ?", canteens[0].ID, "rejected").Updates(map[string]any{
		"review_status": "rejected",
		"updated_at":    gorm.Expr("now()"),
	}).Error; err != nil {
		return fmt.Errorf("reject duplicate Wuxi dining child sources: %w", err)
	}
	result := db.Table("school_canteens").Where("id = ? AND status = ?", canteens[0].ID, "active").Updates(map[string]any{
		"status":      "inactive",
		"review_note": "2026-08-18父子去重：民族餐厅是梁溪苑餐厅二楼内部民族风味区，已归并至物理父食堂",
		"reviewed_at": gorm.Expr("COALESCE(reviewed_at, now())"),
		"updated_at":  gorm.Expr("now()"),
	})
	if result.Error != nil {
		return fmt.Errorf("deactivate duplicate Wuxi dining child: %w", result.Error)
	}
	if result.RowsAffected > 1 {
		return fmt.Errorf("deactivate duplicate Wuxi dining child: updated %d rows, want at most 1", result.RowsAffected)
	}
	return nil
}
