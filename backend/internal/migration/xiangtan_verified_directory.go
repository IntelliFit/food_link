package migration

import (
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const (
	xiangtanVerifiedDiningBatchName = "湘潭高校官方食堂楼层严格复核-20260820"
	xiangtanVerifiedDiningSeedPath  = "data/xiangtan_verified_dining_seed_20260820.json"
)

var xiangtanVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  xiangtanVerifiedDiningBatchName,
	SeedPath:   xiangtanVerifiedDiningSeedPath,
	ReviewNote: "2026-08-20湘潭高校官方来源楼层、当前运营及物理父食堂严格复核通过",
}

func InspectXiangtanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, xiangtanVerifiedDiningSpec)
}

func PublishXiangtanVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Xiangtan verified dining schema: %w", err)
		}
		if err := PublishVerifiedDiningBatch(ctx, tx, schema, xiangtanVerifiedDiningSpec); err != nil {
			return err
		}
		if err := retireUnverifiedXiangtanDining(ctx, tx); err != nil {
			return err
		}
		return retireUnverifiedXiangtanCampus(ctx, tx)
	})
}

type xiangtanDiningRetirement struct {
	school  string
	campus  string
	canteen string
	note    string
}

func retireUnverifiedXiangtanDining(ctx context.Context, db *gorm.DB) error {
	targets := []xiangtanDiningRetirement{
		{
			school: "湘潭大学", campus: "校本部", canteen: "北五餐厅",
			note: "2026-08-20湘潭严格复核：官方只写上、下两层，无法无推断映射为精确实际楼层",
		},
		{
			school: "湘潭大学兴湘学院", campus: "校本部", canteen: "兴湘餐厅",
			note: "2026-08-20湘潭严格复核：官方只写上、下两层，无法无推断映射为精确实际楼层",
		},
		{
			school: "湖南工程学院", campus: "北校区", canteen: "学海二食堂",
			note: "2026-08-20湘潭严格复核：一楼证据仅为2024年托管招标，缺少履约后实际开餐闭环",
		},
	}
	for _, target := range targets {
		var rows []struct{ ID string }
		if err := db.WithContext(ctx).Table("school_canteens AS canteen").
			Select("canteen.id").
			Joins("JOIN schools AS school ON school.id = canteen.school_id").
			Joins("JOIN school_campuses AS campus ON campus.id = canteen.campus_id").
			Where("school.name = ? AND lower(campus.name) = ? AND lower(canteen.name) = ? AND canteen.status NOT IN ?",
				target.school, strings.ToLower(target.campus), strings.ToLower(target.canteen), []string{"deleted", "rejected"}).
			Find(&rows).Error; err != nil {
			return fmt.Errorf("find unverified Xiangtan dining %q/%q/%q: %w", target.school, target.campus, target.canteen, err)
		}
		if len(rows) > 1 {
			return fmt.Errorf("retire unverified Xiangtan dining %q/%q/%q: found %d rows", target.school, target.campus, target.canteen, len(rows))
		}
		if len(rows) == 0 {
			continue
		}
		if err := db.WithContext(ctx).Table("campus_directory_sources").Where("canteen_id = ?", rows[0].ID).Updates(map[string]any{
			"review_status": "rejected", "updated_at": gorm.Expr("now()"),
		}).Error; err != nil {
			return fmt.Errorf("reject unverified Xiangtan dining sources %q/%q/%q: %w", target.school, target.campus, target.canteen, err)
		}
		if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", rows[0].ID).Updates(map[string]any{
			"status":      "inactive",
			"review_note": target.note,
			"reviewed_at": gorm.Expr("COALESCE(reviewed_at, now())"),
			"updated_at":  gorm.Expr("now()"),
		}).Error; err != nil {
			return fmt.Errorf("retire unverified Xiangtan dining %q/%q/%q: %w", target.school, target.campus, target.canteen, err)
		}
	}
	return nil
}

func retireUnverifiedXiangtanCampus(ctx context.Context, db *gorm.DB) error {
	var rows []struct{ ID string }
	if err := db.WithContext(ctx).Table("school_campuses AS campus").
		Select("campus.id").
		Joins("JOIN schools AS school ON school.id = campus.school_id").
		Where("school.name = ? AND lower(campus.name) = ? AND campus.status NOT IN ?",
			"湖南工程学院", strings.ToLower("北校区"), []string{"deleted", "rejected"}).
		Find(&rows).Error; err != nil {
		return fmt.Errorf("find unverified Xiangtan campus 湖南工程学院/北校区: %w", err)
	}
	if len(rows) > 1 {
		return fmt.Errorf("retire unverified Xiangtan campus 湖南工程学院/北校区: found %d rows", len(rows))
	}
	if len(rows) == 0 {
		return nil
	}
	if err := db.WithContext(ctx).Table("campus_directory_sources").Where("campus_id = ? AND canteen_id IS NULL", rows[0].ID).Updates(map[string]any{
		"review_status": "rejected", "updated_at": gorm.Expr("now()"),
	}).Error; err != nil {
		return fmt.Errorf("reject unverified Xiangtan campus sources 湖南工程学院/北校区: %w", err)
	}
	if err := db.WithContext(ctx).Table("school_campuses").Where("id = ?", rows[0].ID).Updates(map[string]any{
		"status":     "inactive",
		"updated_at": gorm.Expr("now()"),
	}).Error; err != nil {
		return fmt.Errorf("retire unverified Xiangtan campus 湖南工程学院/北校区: %w", err)
	}
	return nil
}
