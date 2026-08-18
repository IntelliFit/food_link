package migration

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"gorm.io/gorm"
)

const (
	shijiazhuangVerifiedDiningBatchName = "石家庄高校官方食堂楼层确认集-20260818"
	shijiazhuangVerifiedDiningSeedPath  = "data/shijiazhuang_verified_dining_seed_20260818.json"
)

var shijiazhuangVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  shijiazhuangVerifiedDiningBatchName,
	SeedPath:   shijiazhuangVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18石家庄高校官方来源楼层、当前运营及物理父食堂复核通过",
}

type shijiazhuangDiningParentMerge struct {
	School       string
	CampusNames  []string
	Canonical    string
	CanonicalOld string
	Aliases      []string
	Children     []string
	Active       bool
	ReviewNote   string
}

var shijiazhuangDiningParentMerges = []shijiazhuangDiningParentMerge{
	{
		School: "河北师范大学", CampusNames: []string{"裕华校区", "校本部"},
		Canonical: "主食堂", CanonicalOld: "第一餐厅",
		Aliases:  []string{"第一餐厅", "第二餐厅", "凝味创意餐厅（第三餐厅）"},
		Children: []string{"第二餐厅", "凝味创意餐厅（第三餐厅）"}, Active: true,
		ReviewNote: "2026-08-18父子去重：第二、第三餐厅经营区归并至物理主食堂",
	},
	{
		School: "河北师范大学", CampusNames: []string{"裕华校区", "校本部"},
		Canonical: "西食堂", CanonicalOld: "第四餐厅",
		Aliases:  []string{"第四餐厅", "民族餐厅", "书香智慧餐厅（第五餐厅）"},
		Children: []string{"民族餐厅", "书香智慧餐厅（第五餐厅）"}, Active: false,
		ReviewNote: "2026-08-18父子去重：西食堂经营区已归并；缺日期化同父当前供餐证据，暂不启用",
	},
	{
		School: "河北师范大学汇华学院", CampusNames: []string{"校本部", "北院"},
		Canonical: "餐饮中心", CanonicalOld: "汇雅苑餐厅",
		Aliases:  []string{"汇雅苑餐厅", "汇德苑餐厅", "汇馨苑餐厅（含回民餐厅）"},
		Children: []string{"汇德苑餐厅", "汇馨苑餐厅（含回民餐厅）"}, Active: true,
		ReviewNote: "2026-08-18父子去重：负一层、一层、二层经营区归并至物理餐饮中心",
	},
}

func InspectShijiazhuangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	if err := validateVerifiedDiningBatchSpec(shijiazhuangVerifiedDiningSpec); err != nil {
		return nil, err
	}
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return nil, fmt.Errorf("set Shijiazhuang verified dining schema: %w", err)
	}
	batch, err := loadVerifiedDiningBatch(shijiazhuangVerifiedDiningSpec)
	if err != nil {
		return nil, err
	}
	result := &VerifiedDiningBatchDryRun{Schools: len(batch.Schools)}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", strings.TrimSpace(schoolSeed.School), "active").Take(&school).Error; err != nil {
			return nil, fmt.Errorf("find Shijiazhuang verified dining school %q: %w", schoolSeed.School, err)
		}
		campusIDs := make(map[string]string, len(schoolSeed.Campuses))
		for _, campusSeed := range schoolSeed.Campuses {
			result.Campuses++
			var campuses []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) IN ? AND status <> ?", school.ID, verifiedDiningCampusNames(campusSeed), "deleted").Find(&campuses).Error; err != nil {
				return nil, err
			}
			if len(campuses) > 1 {
				return nil, fmt.Errorf("inspect Shijiazhuang campus %q: found %d rows", campusSeed.Name, len(campuses))
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

func PublishShijiazhuangVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Shijiazhuang verified dining schema: %w", err)
		}
		if err := normalizeShijiazhuangDiningParents(ctx, tx); err != nil {
			return err
		}
		if err := PublishVerifiedDiningBatch(ctx, tx, schema, shijiazhuangVerifiedDiningSpec); err != nil {
			return err
		}
		return verifyShijiazhuangDiningParents(ctx, tx)
	})
}

func normalizeShijiazhuangDiningParents(ctx context.Context, db *gorm.DB) error {
	for _, merge := range shijiazhuangDiningParentMerges {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", merge.School, "active").Take(&school).Error; err != nil {
			return fmt.Errorf("find Shijiazhuang parent school %q: %w", merge.School, err)
		}
		campusNames := make([]string, 0, len(merge.CampusNames))
		for _, name := range merge.CampusNames {
			campusNames = append(campusNames, strings.ToLower(strings.TrimSpace(name)))
		}
		var campus struct{ ID string }
		if err := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) IN ? AND status <> ?", school.ID, campusNames, "deleted").Take(&campus).Error; err != nil {
			return fmt.Errorf("find Shijiazhuang parent campus %q/%q: %w", merge.School, merge.Canonical, err)
		}
		var canonical struct {
			ID   string
			Name string
		}
		if err := db.WithContext(ctx).Table("school_canteens").Select("id, name").Where(
			"school_id = ? AND campus_id = ? AND lower(name) IN ? AND status NOT IN ?",
			school.ID, campus.ID, []string{strings.ToLower(merge.Canonical), strings.ToLower(merge.CanonicalOld)}, []string{"deleted", "rejected"},
		).Order("created_at ASC").Take(&canonical).Error; err != nil {
			return fmt.Errorf("find Shijiazhuang canonical parent %q/%q: %w", merge.School, merge.Canonical, err)
		}
		for _, childName := range merge.Children {
			var children []struct {
				ID   string
				Name string
			}
			if err := db.WithContext(ctx).Table("school_canteens").Select("id, name").Where(
				"school_id = ? AND campus_id = ? AND lower(name) = lower(?) AND status NOT IN ?",
				school.ID, campus.ID, childName, []string{"deleted", "rejected"},
			).Find(&children).Error; err != nil {
				return err
			}
			if len(children) > 1 {
				return fmt.Errorf("merge Shijiazhuang child %q/%q: found %d rows", merge.School, childName, len(children))
			}
			if len(children) == 0 || children[0].ID == canonical.ID {
				continue
			}
			if err := moveQingdaoDiningReferences(ctx, db, children[0].ID, canonical.ID, children[0].Name, merge.Canonical); err != nil {
				return fmt.Errorf("merge Shijiazhuang child %q into %q: %w", childName, merge.Canonical, err)
			}
			if err := db.WithContext(ctx).Table("campus_directory_sources").Where("canteen_id = ?", children[0].ID).Updates(map[string]any{
				"review_status": "rejected", "updated_at": gorm.Expr("now()"),
			}).Error; err != nil {
				return err
			}
			if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", children[0].ID).Updates(map[string]any{
				"status": "rejected", "review_note": merge.ReviewNote,
				"reviewed_at": gorm.Expr("COALESCE(reviewed_at, now())"), "updated_at": gorm.Expr("now()"),
			}).Error; err != nil {
				return err
			}
		}
		aliasesJSON, err := json.Marshal(merge.Aliases)
		if err != nil {
			return err
		}
		status := "inactive"
		if merge.Active {
			status = "active"
		}
		if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", canonical.ID).Updates(map[string]any{
			"name": merge.Canonical, "aliases": gorm.Expr("?::jsonb", string(aliasesJSON)), "status": status,
			"review_note": merge.ReviewNote, "reviewed_at": gorm.Expr("COALESCE(reviewed_at, now())"), "updated_at": gorm.Expr("now()"),
		}).Error; err != nil {
			return fmt.Errorf("normalize Shijiazhuang parent %q/%q: %w", merge.School, merge.Canonical, err)
		}
		if !merge.Active {
			if err := db.WithContext(ctx).Table("campus_directory_sources").Where("canteen_id = ?", canonical.ID).Updates(map[string]any{
				"review_status": "rejected", "updated_at": gorm.Expr("now()"),
			}).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func verifyShijiazhuangDiningParents(ctx context.Context, db *gorm.DB) error {
	for _, expected := range []struct {
		school string
		active int64
	}{
		{school: "河北师范大学", active: 1},
		{school: "河北师范大学汇华学院", active: 1},
	} {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ?", expected.school).Take(&school).Error; err != nil {
			return err
		}
		var active int64
		if err := db.WithContext(ctx).Table("school_canteens").Where("school_id = ? AND status = ?", school.ID, "active").Count(&active).Error; err != nil {
			return err
		}
		if active != expected.active {
			return fmt.Errorf("verify Shijiazhuang active parents %q: got %d, want %d", expected.school, active, expected.active)
		}
		var approvedRejectedSources int64
		if err := db.WithContext(ctx).Table("campus_directory_sources AS source").Joins(
			"JOIN school_canteens AS canteen ON canteen.id = source.canteen_id",
		).Where("canteen.school_id = ? AND canteen.status = ? AND source.review_status = ?", school.ID, "rejected", "approved").Count(&approvedRejectedSources).Error; err != nil {
			return err
		}
		if approvedRejectedSources != 0 {
			return fmt.Errorf("verify Shijiazhuang retired child sources %q: got %d approved", expected.school, approvedRejectedSources)
		}
	}
	var activeWest int64
	if err := db.WithContext(ctx).Table("school_canteens AS canteen").Joins("JOIN schools AS school ON school.id = canteen.school_id").Where(
		"school.name = ? AND canteen.name = ? AND canteen.status = ?", "河北师范大学", "西食堂", "active",
	).Count(&activeWest).Error; err != nil {
		return err
	}
	if activeWest != 0 {
		return fmt.Errorf("verify Shijiazhuang west dining hall: got %d active rows, want 0", activeWest)
	}
	return nil
}
