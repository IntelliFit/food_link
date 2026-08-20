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
	changchunVerifiedDiningBatchName = "长春高校官方食堂楼层确认集-20260818"
	changchunVerifiedDiningSeedPath  = "data/changchun_verified_dining_seed_20260818.json"
)

var changchunVerifiedDiningSpec = VerifiedDiningBatchSpec{
	BatchName:  changchunVerifiedDiningBatchName,
	SeedPath:   changchunVerifiedDiningSeedPath,
	ReviewNote: "2026-08-18长春高校官方来源楼层、当前运营及物理父食堂复核通过",
}

func InspectChangchunVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) (*VerifiedDiningBatchDryRun, error) {
	if err := validateVerifiedDiningBatchSpec(changchunVerifiedDiningSpec); err != nil {
		return nil, err
	}
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(schema)).Error; err != nil {
		return nil, fmt.Errorf("set Changchun verified dining schema: %w", err)
	}
	batch, err := loadVerifiedDiningBatch(changchunVerifiedDiningSpec)
	if err != nil {
		return nil, err
	}
	result := &VerifiedDiningBatchDryRun{Schools: len(batch.Schools)}
	for _, schoolSeed := range batch.Schools {
		var school struct{ ID string }
		if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", schoolSeed.School, "active").Take(&school).Error; err != nil {
			return nil, fmt.Errorf("find Changchun school %q: %w", schoolSeed.School, err)
		}
		campusIDs := map[string][]string{}
		for _, campusSeed := range schoolSeed.Campuses {
			result.Campuses++
			var campuses []struct{ ID string }
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) IN ? AND status <> ?", school.ID, verifiedDiningCampusNames(campusSeed), "deleted").Find(&campuses).Error; err != nil {
				return nil, err
			}
			if len(campuses) == 0 {
				result.NewCampuses++
			} else {
				result.ExistingCampuses++
				for _, campus := range campuses {
					campusIDs[campusSeed.Name] = append(campusIDs[campusSeed.Name], campus.ID)
				}
			}
		}
		for _, canteenSeed := range schoolSeed.Canteens {
			result.Canteens++
			ids := campusIDs[canteenSeed.Campus]
			if len(ids) == 0 {
				result.NewCanteens++
				continue
			}
			var count int64
			if err := db.WithContext(ctx).Table("school_canteens").Where("school_id = ? AND campus_id IN ? AND lower(name) IN ? AND status NOT IN ?", school.ID, ids, verifiedDiningCanteenNames(canteenSeed), []string{"deleted", "rejected"}).Count(&count).Error; err != nil {
				return nil, err
			}
			if count == 0 {
				result.NewCanteens++
			} else {
				result.ExistingCanteens++
			}
		}
	}
	return result, nil
}

func PublishChangchunVerifiedDiningDirectory(ctx context.Context, db *gorm.DB, schema string) error {
	schema = normalizeSchema(schema)
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("set Changchun verified dining schema: %w", err)
		}
		if err := normalizeChangchunExistingDirectory(ctx, tx); err != nil {
			return err
		}
		if err := PublishVerifiedDiningBatch(ctx, tx, schema, changchunVerifiedDiningSpec); err != nil {
			return err
		}
		return verifyChangchunNormalization(ctx, tx)
	})
}

func normalizeChangchunExistingDirectory(ctx context.Context, db *gorm.DB) error {
	if err := mergeChangchunCampus(ctx, db, "东北师范大学", "人民大街校区", "自由校区"); err != nil {
		return err
	}
	if err := mergeChangchunCampus(ctx, db, "东北师范大学", "净月大街校区", "净月校区"); err != nil {
		return err
	}
	for _, merge := range []struct {
		school, campus, canonical string
		aliases                   []string
		children                  []string
		clearFloor                bool
	}{
		{"东北师范大学", "人民大街校区", "北苑餐厅", []string{"北苑食堂", "北苑清真餐厅"}, []string{"北苑清真餐厅"}, false},
		{"东北师范大学", "人民大街校区", "南苑餐厅", []string{"南苑食堂"}, nil, false},
		{"东北师范大学", "净月大街校区", "学生一食堂", []string{"净月一食堂"}, []string{"净月一食堂"}, true},
		{"东北师范大学", "净月大街校区", "学生二食堂", []string{"净月二食堂", "净月清真餐厅"}, []string{"净月二食堂", "净月清真餐厅"}, true},
		{"吉林大学", "前卫校区", "莘子园餐厅", []string{"莘子园食堂", "莘子园回族餐厅"}, nil, false},
	} {
		if err := mergeChangchunDiningParent(ctx, db, merge.school, merge.campus, merge.canonical, merge.aliases, merge.children, merge.clearFloor); err != nil {
			return err
		}
	}
	if err := retireChangchunCanteens(ctx, db, "吉林大学", []string{"南岭三餐厅清真餐厅", "和平清真餐厅"}, "2026-08-18长春严格复核：内部清真经营区或错误父体映射，缺唯一物理父食堂楼层闭环"); err != nil {
		return err
	}
	if err := db.WithContext(ctx).Exec(`UPDATE school_canteens AS canteen
		SET name = '南岭六餐厅', aliases = '["六餐厅","南岭民族餐厅"]'::jsonb, updated_at = now()
		FROM schools AS school
		WHERE canteen.school_id = school.id AND school.name = '吉林大学'
		  AND lower(canteen.name) = lower('六餐厅') AND canteen.status NOT IN ('deleted','rejected')`).Error; err != nil {
		return fmt.Errorf("normalize Jilin University sixth dining hall: %w", err)
	}
	if err := db.WithContext(ctx).Exec(`UPDATE campus_directory_sources AS source
		SET review_status = 'rejected', updated_at = now()
		FROM school_canteens AS canteen
		JOIN schools AS school ON school.id = canteen.school_id
		WHERE source.canteen_id = canteen.id AND school.name = '东北师范大学'
		  AND (source.source_url LIKE '%innenu.com%'
		       OR (source.source_url LIKE '%xxhb.nenu.edu.cn/%' AND source.source_url LIKE '%.pdf%'))`).Error; err != nil {
		return fmt.Errorf("reject stale NENU terminal-location sources: %w", err)
	}
	return nil
}

func mergeChangchunCampus(ctx context.Context, db *gorm.DB, schoolName, canonicalName, duplicateName string) error {
	var school struct{ ID string }
	if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", schoolName, "active").Take(&school).Error; err != nil {
		return fmt.Errorf("find Changchun campus school %q: %w", schoolName, err)
	}
	var target, duplicate struct{ ID string }
	targetErr := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, canonicalName, "deleted").Take(&target).Error
	if targetErr != nil && !errors.Is(targetErr, gorm.ErrRecordNotFound) {
		return fmt.Errorf("find Changchun canonical campus %q/%q: %w", schoolName, canonicalName, targetErr)
	}
	err := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, duplicateName, "deleted").Take(&duplicate).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find Changchun duplicate campus %q/%q: %w", schoolName, duplicateName, err)
	}
	if errors.Is(targetErr, gorm.ErrRecordNotFound) {
		return db.WithContext(ctx).Table("school_campuses").Where("id = ?", duplicate.ID).Updates(map[string]any{
			"name": canonicalName, "updated_at": gorm.Expr("now()"),
		}).Error
	}
	for _, table := range []string{"school_canteens", "canteen_windows", "public_food_library", "campus_food_collection_batches", "campus_food_catalog_items", "campus_canteen_applications", "campus_directory_sources"} {
		if err := db.WithContext(ctx).Table(table).Where("campus_id = ?", duplicate.ID).Update("campus_id", target.ID).Error; err != nil {
			return fmt.Errorf("move %s campus reference: %w", table, err)
		}
	}
	return db.WithContext(ctx).Table("school_campuses").Where("id = ?", duplicate.ID).Updates(map[string]any{
		"status": "deleted", "updated_at": gorm.Expr("now()"),
	}).Error
}

func mergeChangchunDiningParent(ctx context.Context, db *gorm.DB, schoolName, campusName, canonicalName string, aliases, children []string, clearFloor bool) error {
	var school struct{ ID string }
	if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ?", schoolName).Take(&school).Error; err != nil {
		return err
	}
	var campus struct{ ID string }
	campusNames := []string{strings.ToLower(strings.TrimSpace(campusName))}
	if schoolName == "吉林大学" && campusName == "前卫校区" {
		campusNames = append(campusNames, strings.ToLower("前卫南区（中心校区）"))
	}
	if err := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) IN ? AND status <> ?", school.ID, campusNames, "deleted").Take(&campus).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	canonicalNames := append([]string{canonicalName}, aliases...)
	for i := range canonicalNames {
		canonicalNames[i] = strings.ToLower(strings.TrimSpace(canonicalNames[i]))
	}
	var rows []struct {
		ID   string
		Name string
	}
	if err := db.WithContext(ctx).Table("school_canteens").Select("id, name").Where("school_id = ? AND campus_id = ? AND lower(name) IN ? AND status NOT IN ?", school.ID, campus.ID, canonicalNames, []string{"deleted", "rejected"}).Order("created_at ASC").Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	canonical := rows[0]
	preferredName := canonicalName
	if canonicalName == "北苑餐厅" {
		preferredName = "北苑食堂"
	} else if canonicalName == "南苑餐厅" {
		preferredName = "南苑食堂"
	}
	for _, row := range rows {
		if strings.EqualFold(row.Name, preferredName) {
			canonical = row
			break
		}
	}
	childrenSet := map[string]bool{}
	for _, child := range children {
		childrenSet[strings.ToLower(child)] = true
	}
	for _, row := range rows {
		if row.ID == canonical.ID {
			continue
		}
		if len(childrenSet) > 0 && !childrenSet[strings.ToLower(row.Name)] && !strings.EqualFold(row.Name, canonicalName) {
			continue
		}
		if err := moveQingdaoDiningReferences(ctx, db, row.ID, canonical.ID, row.Name, canonicalName); err != nil {
			return err
		}
		if err := db.WithContext(ctx).Table("campus_directory_sources").Where("canteen_id = ?", row.ID).Updates(map[string]any{"review_status": "rejected", "updated_at": gorm.Expr("now()")}).Error; err != nil {
			return err
		}
		if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", row.ID).Updates(map[string]any{"status": "rejected", "review_note": "2026-08-18长春物理父食堂去重", "updated_at": gorm.Expr("now()")}).Error; err != nil {
			return err
		}
	}
	aliasesJSON, err := json.Marshal(aliases)
	if err != nil {
		return err
	}
	updates := map[string]any{"name": canonicalName, "aliases": gorm.Expr("?::jsonb", string(aliasesJSON)), "status": "active", "updated_at": gorm.Expr("now()")}
	if clearFloor {
		updates["building_or_floor"] = nil
		updates["location_text"] = nil
	}
	return db.WithContext(ctx).Table("school_canteens").Where("id = ?", canonical.ID).Updates(updates).Error
}

func retireChangchunCanteens(ctx context.Context, db *gorm.DB, schoolName string, names []string, note string) error {
	var rows []struct{ ID string }
	if err := db.WithContext(ctx).Table("school_canteens AS canteen").Select("canteen.id").Joins("JOIN schools AS school ON school.id = canteen.school_id").Where("school.name = ? AND lower(canteen.name) IN ? AND canteen.status NOT IN ?", schoolName, lowerStrings(names), []string{"deleted", "rejected"}).Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		if err := db.WithContext(ctx).Table("campus_directory_sources").Where("canteen_id = ?", row.ID).Updates(map[string]any{"review_status": "rejected", "updated_at": gorm.Expr("now()")}).Error; err != nil {
			return err
		}
		if err := db.WithContext(ctx).Table("school_canteens").Where("id = ?", row.ID).Updates(map[string]any{"status": "rejected", "review_note": note, "updated_at": gorm.Expr("now()")}).Error; err != nil {
			return err
		}
	}
	return nil
}

func lowerStrings(values []string) []string {
	result := make([]string, len(values))
	for i, value := range values {
		result[i] = strings.ToLower(strings.TrimSpace(value))
	}
	return result
}

func verifyChangchunNormalization(ctx context.Context, db *gorm.DB) error {
	for _, check := range []struct {
		school string
		names  []string
	}{
		{"东北师范大学", []string{"自由校区", "净月校区"}},
	} {
		var count int64
		if err := db.WithContext(ctx).Table("school_campuses AS campus").Joins("JOIN schools AS school ON school.id = campus.school_id").Where("school.name = ? AND lower(campus.name) IN ? AND campus.status <> ?", check.school, lowerStrings(check.names), "deleted").Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return fmt.Errorf("verify Changchun duplicate campuses %q: got %d", check.school, count)
		}
	}
	var badSources int64
	if err := db.WithContext(ctx).Table("campus_directory_sources AS source").Joins("JOIN school_canteens AS canteen ON canteen.id = source.canteen_id").Joins("JOIN schools AS school ON school.id = canteen.school_id").Where("school.name IN ? AND canteen.status = ? AND source.review_status = ?", []string{"东北师范大学", "吉林大学"}, "rejected", "approved").Count(&badSources).Error; err != nil {
		return err
	}
	if badSources != 0 {
		return fmt.Errorf("verify Changchun retired sources: got %d approved", badSources)
	}
	return nil
}
