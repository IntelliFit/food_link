package migration

import (
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const (
	hengyangVerifiedDiningBatchName = "衡阳高校官方食堂楼层严格复核-20260820"
	hengyangVerifiedDiningSeedPath  = "data/hengyang_verified_dining_seed_20260820.json"
	hengyangPreviousDiningBatchName = "衡阳高校官方食堂楼层确认集-20260816"
	hengyangWeakQiuShiSourceURL     = "https://gwxy.usc.edu.cn/info/1027/7146.htm"
	hengyangWeakBoXueSourceURL      = "https://nic.usc.edu.cn/__local/D/BB/A6/0405D2A46DF844D3B81A45BE430_B9966634_2E0D5D.pdf"
)

var hengyangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  hengyangVerifiedDiningBatchName,
	SeedPath:   hengyangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-20衡阳高校官方来源实际餐饮楼层、当前运营及旧弱证严格复核通过",
}

func InspectHengyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	return InspectVerifiedDiningBatch(ctx, db, schema, hengyangVerifiedDiningSpec)
}

func PublishHengyangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Hengyang verified dining schema: %w", err)
		}
		if err := PublishVerifiedDiningBatch(ctx, tx, schema, hengyangVerifiedDiningSpec); err != nil {
			return err
		}
		return retireUnverifiedHengyangDining(ctx, tx)
	})
}

type hengyangDiningCorrection struct {
	school     string
	campus     string
	canteen    string
	weakURL    string
	deactivate bool
	reviewNote string
}

var hengyangDiningCorrections = []hengyangDiningCorrection{
	{
		school: "南华大学", campus: "红湘校区", canteen: "求是园食堂",
		weakURL:    hengyangWeakQiuShiSourceURL,
		reviewNote: "2026-08-20衡阳严格复核：旧来源仅为包饺子活动，不单独支持日常售餐；改由本批一楼共进午餐和同父当前运营来源续证",
	},
	{
		school: "南华大学", campus: "红湘校区", canteen: "博学园食堂",
		weakURL:    hengyangWeakBoXueSourceURL,
		reviewNote: "2026-08-20衡阳严格复核：旧来源仅为一卡通充值窗口，不单独支持餐饮楼层；改由本批一楼实际进餐和同父当前运营来源续证",
	},
	{
		school: "衡阳师范学院", campus: "东校区", canteen: "东校区新食堂",
		deactivate: true,
		reviewNote: "2026-08-20衡阳严格复核：一楼仅为包饺子活动地点，二楼仅为档口比选，缺履约后正常售餐、取餐或堂食闭环",
	},
}

func retireUnverifiedHengyangDining(ctx context.Context, db *gorm.DB) error {
	var previousBatches []struct{ ID string }
	if err := db.WithContext(ctx).Table("campus_directory_import_batches").
		Select("id").Where("name = ?", hengyangPreviousDiningBatchName).Find(&previousBatches).Error; err != nil {
		return fmt.Errorf("find previous Hengyang dining batch: %w", err)
	}
	if len(previousBatches) > 1 {
		return fmt.Errorf("find previous Hengyang dining batch: got %d rows, want at most 1", len(previousBatches))
	}
	for _, correction := range hengyangDiningCorrections {
		var rows []struct{ ID string }
		if err := db.WithContext(ctx).Table("school_canteens AS canteen").
			Select("canteen.id").
			Joins("JOIN schools AS school ON school.id = canteen.school_id").
			Joins("JOIN school_campuses AS campus ON campus.id = canteen.campus_id").
			Where("school.name = ? AND lower(campus.name) = ? AND lower(canteen.name) = ? AND canteen.status NOT IN ?",
				correction.school, strings.ToLower(correction.campus), strings.ToLower(correction.canteen), []string{"deleted", "rejected"}).
			Find(&rows).Error; err != nil {
			return fmt.Errorf("find Hengyang dining correction %q/%q/%q: %w", correction.school, correction.campus, correction.canteen, err)
		}
		if len(rows) > 1 {
			return fmt.Errorf("find Hengyang dining correction %q/%q/%q: got %d rows, want at most 1", correction.school, correction.campus, correction.canteen, len(rows))
		}
		if len(rows) == 0 {
			continue
		}
		if len(previousBatches) == 1 {
			sources := db.WithContext(ctx).Table("campus_directory_sources").
				Where("batch_id = ? AND canteen_id = ?", previousBatches[0].ID, rows[0].ID)
			if strings.TrimSpace(correction.weakURL) != "" {
				sources = sources.Where("source_url = ?", correction.weakURL)
			}
			if err := sources.Updates(map[string]any{
				"review_status": "rejected", "updated_at": gorm.Expr("now()"),
			}).Error; err != nil {
				return fmt.Errorf("reject weak Hengyang sources %q/%q/%q: %w", correction.school, correction.campus, correction.canteen, err)
			}
		}
		if !correction.deactivate {
			continue
		}
		if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", rows[0].ID).Updates(map[string]any{
			"status": "inactive", "confidence_level": "B", "review_note": correction.reviewNote,
			"reviewed_at": gorm.Expr("COALESCE(reviewed_at, now())"), "updated_at": gorm.Expr("now()"),
		}).Error; err != nil {
			return fmt.Errorf("deactivate weak Hengyang dining %q/%q/%q: %w", correction.school, correction.campus, correction.canteen, err)
		}
	}
	return nil
}
