package migration

import (
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const (
	jinanVerifiedDiningBatchName = "济南高校官方食堂楼层确认集-20260818"
	jinanVerifiedDiningSeedPath  = "data/jinan_verified_dining_seed_20260818.json"
)

var jinanVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  jinanVerifiedDiningBatchName,
	SeedPath:   jinanVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18济南高校官方来源楼层、当前运营及物理父食堂复核通过",
}

func InspectJinanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, jinanVerifiedDiningSpec)
}

func PublishJinanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Jinan verified dining schema: %w", err)
		}
		if err := PublishVerifiedDiningBatch(ctx, tx, schema, jinanVerifiedDiningSpec); err != nil {
			return err
		}
		return retireUnverifiedJinanDining(ctx, tx)
	})
}

func retireUnverifiedJinanDining(ctx context.Context, db *gorm.DB) error {
	var rows []struct{ ID string }
	if err := db.WithContext(ctx).Table("school_canteens AS canteen").
		Select("canteen.id").
		Joins("JOIN schools AS school ON school.id = canteen.school_id").
		Joins("JOIN school_campuses AS campus ON campus.id = canteen.campus_id").
		Where("school.name = ? AND lower(campus.name) = ? AND lower(canteen.name) = ? AND canteen.status NOT IN ?",
			"山东大学", strings.ToLower("洪家楼校区"), strings.ToLower("第三食堂"), []string{"deleted", "rejected"}).
		Find(&rows).Error; err != nil {
		return fmt.Errorf("find unverified Jinan dining rows: %w", err)
	}
	if len(rows) > 1 {
		return fmt.Errorf("retire unverified Jinan dining: found %d rows", len(rows))
	}
	if len(rows) == 0 {
		return nil
	}
	if err := db.WithContext(ctx).Table("campus_directory_sources").Where("canteen_id = ?", rows[0].ID).Updates(map[string]any{
		"review_status": "rejected", "updated_at": gorm.Expr("now()"),
	}).Error; err != nil {
		return fmt.Errorf("reject unverified Jinan dining sources: %w", err)
	}
	if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", rows[0].ID).Updates(map[string]any{
		"status":      "inactive",
		"review_note": "2026-08-18济南严格复核：东、西二厅不是实际楼层，缺逐层当前供餐证据",
		"reviewed_at": gorm.Expr("COALESCE(reviewed_at, now())"),
		"updated_at":  gorm.Expr("now()"),
	}).Error; err != nil {
		return fmt.Errorf("retire unverified Jinan dining row: %w", err)
	}
	return nil
}
