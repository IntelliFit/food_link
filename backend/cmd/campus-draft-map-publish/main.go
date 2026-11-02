// Command campus-draft-map-publish shows collected campus draft dishes on the food map
// without running nutrition analysis. Default is a dry-run; --apply writes in one
// transaction and --rollback marks a previous run's rows deleted.
//
// It only inserts public_food_library rows and leaves the catalog items as draft: a
// published catalog item with no nutrition is picked up by the campus maintenance loop,
// which submits a paid AI analysis per item. Rows carry nutrition_status=pending, so the
// client shows nutrition as unavailable and blocks recording, and availability_status=
// unknown, which keeps them out of recommendations and record search.
package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	insertBatchSize = 500
	maxFoodNameLen  = 30
)

var notADishName = regexp.MustCompile(`(?i)待核|参考|价目|菜单|餐标|档口|窗口|食堂|测试|test|codex|暂无|未知|^套餐[A-Za-z0-9]*$|\d+\s*g/|^[\d\s\p{P}\p{S}]+$`)

const candidateQuery = `SELECT ci.id::text AS id, COALESCE(ci.name, '') AS name, ci.canteen_id::text AS canteen_id,
		ci.canteen_name, ci.organization_name AS school_name, c.status AS canteen_status
	FROM campus_food_catalog_items ci
	JOIN campus_food_collection_batches b ON b.id = ci.batch_id AND b.venue_type = 'university'
	JOIN schools s ON s.id = ci.school_id AND s.status = 'active'
	JOIN school_canteens c ON c.id = ci.canteen_id AND c.status IN ('active', 'pending_review')
	WHERE ci.status = 'draft' AND ci.entry_type = 'dish' AND ci.source_channel = 'admin_batch'
		AND NOT EXISTS (SELECT 1 FROM public_food_library p WHERE p.id = ci.id)
	ORDER BY ci.created_at ASC, ci.id ASC`

const insertSQL = `INSERT INTO public_food_library (
		id, user_id, image_paths, total_calories, total_protein, total_carbs, total_fat, items, description,
		food_name, merchant_name, merchant_address, detail_address, status, type, published_at, created_at, updated_at,
		is_campus_food, school_id, campus_id, canteen_id, window_id, school_name, campus_name, canteen_name, floor, window_name,
		price, price_type, price_min, price_max, price_unit, price_collected_at, portion_description, campus_location_text,
		content_version, nutrition_source_version, nutrition_status, availability_status)
	SELECT ci.id, ci.contributor_user_id, '[]', 0, 0, 0, 0, '[]', ci.description,
		ci.name, ci.canteen_name, loc.text, loc.text, 'published', 'campus', NULL, ?, ?,
		TRUE, ci.school_id, ci.campus_id, ci.canteen_id, ci.window_id, ci.organization_name, ci.area_name, ci.canteen_name, ci.floor, ci.window_name,
		ci.price, CASE ci.price_type WHEN 'fixed' THEN 'fixed' WHEN 'range' THEN 'range' WHEN 'combo' THEN 'combo' WHEN 'by_weight' THEN 'weight' ELSE 'unknown' END,
		ci.price_min, ci.price_max, ci.price_unit, ci.captured_at, ci.portion_description, loc.text,
		ci.version, 0, 'pending', 'unknown'
	FROM campus_food_catalog_items ci
	CROSS JOIN LATERAL (SELECT concat_ws(' · ', NULLIF(BTRIM(ci.organization_name), ''), NULLIF(BTRIM(ci.area_name), ''),
		NULLIF(BTRIM(ci.canteen_name), ''), NULLIF(BTRIM(ci.floor), ''), NULLIF(BTRIM(ci.window_name), '')) AS text) loc
	WHERE ci.id IN ? AND ci.status = 'draft' AND ci.entry_type = 'dish'
	ON CONFLICT (id) DO NOTHING`

type candidate struct {
	ID            string `gorm:"column:id"`
	Name          string `gorm:"column:name"`
	CanteenID     string `gorm:"column:canteen_id"`
	CanteenName   string `gorm:"column:canteen_name"`
	SchoolName    string `gorm:"column:school_name"`
	CanteenStatus string `gorm:"column:canteen_status"`
}

type report struct {
	Candidates     int            `json:"candidates"`
	WouldInsert    int            `json:"would_insert"`
	Skipped        map[string]int `json:"skipped"`
	Schools        int            `json:"schools"`
	Canteens       int            `json:"canteens"`
	PendingCanteen int            `json:"dishes_in_pending_review_canteens"`
	Inserted       int64          `json:"inserted"`
	Mode           string         `json:"mode"`
}

func main() {
	apply := flag.Bool("apply", false, "write rows; default is dry-run")
	idsPath := flag.String("ids", "", "new file for the inserted IDs (required with --apply)")
	auditPath := flag.String("audit", "", "CSV of every candidate and its decision")
	rollback := flag.String("rollback", "", "ID file from a previous --apply; marks those rows deleted")
	flag.Parse()

	cfg, err := config.Load(".")
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	if *rollback != "" {
		affected, err := rollbackRun(ctx, db, *rollback, *apply)
		if err != nil {
			log.Fatalf("回滚失败: %v", err)
		}
		fmt.Printf("rollback mode=%s rows=%d\n", modeName(*apply), affected)
		return
	}
	if *apply {
		if *idsPath == "" {
			log.Fatal("--ids is required with --apply so the run can be rolled back")
		}
		if _, err := os.Stat(*idsPath); err == nil {
			log.Fatalf("--ids file %s already exists; use a new path", *idsPath)
		}
	}
	result, ids, decisions, err := run(ctx, db, *apply)
	if err != nil {
		log.Fatalf("发布失败: %v", err)
	}
	if *apply {
		if err := os.WriteFile(*idsPath, []byte(strings.Join(ids, "\n")+"\n"), 0o644); err != nil {
			log.Fatalf("写入 ID 文件失败（数据已写入）: %v", err)
		}
	}
	if *auditPath != "" {
		if err := writeAudit(*auditPath, decisions); err != nil {
			log.Fatalf("写入审计文件失败: %v", err)
		}
	}
	encoded, _ := json.MarshalIndent(result, "", " ")
	fmt.Println(string(encoded))
}

func modeName(apply bool) string {
	if apply {
		return "apply"
	}
	return "dry-run"
}

func validDishName(name string) bool {
	name = strings.TrimSpace(name)
	length := len([]rune(name))
	return length >= 2 && length <= maxFoodNameLen && !notADishName.MatchString(name)
}

func dishKey(canteenID, name string) string {
	return canteenID + "\x00" + strings.ToLower(strings.Join(strings.Fields(name), ""))
}

type decision struct {
	Item   candidate
	Action string
}

func run(ctx context.Context, db *gorm.DB, apply bool) (report, []string, []decision, error) {
	result := report{Mode: modeName(apply), Skipped: map[string]int{}}
	var candidates []candidate
	if err := db.WithContext(ctx).Raw(candidateQuery).Scan(&candidates).Error; err != nil {
		return result, nil, nil, err
	}
	result.Candidates = len(candidates)
	existing, err := existingDishKeys(ctx, db)
	if err != nil {
		return result, nil, nil, err
	}
	schools, canteens := map[string]bool{}, map[string]bool{}
	ids := make([]string, 0, len(candidates))
	decisions := make([]decision, 0, len(candidates))
	for _, item := range candidates {
		key := dishKey(item.CanteenID, item.Name)
		action := "insert"
		switch {
		case !validDishName(item.Name):
			action = "skip_bad_name"
		case existing[key]:
			action = "skip_same_dish_in_canteen"
		}
		decisions = append(decisions, decision{Item: item, Action: action})
		if action != "insert" {
			result.Skipped[action]++
			continue
		}
		existing[key] = true
		ids = append(ids, item.ID)
		schools[item.SchoolName] = true
		canteens[item.CanteenID] = true
		if item.CanteenStatus == "pending_review" {
			result.PendingCanteen++
		}
	}
	result.WouldInsert, result.Schools, result.Canteens = len(ids), len(schools), len(canteens)
	if !apply || len(ids) == 0 {
		return result, ids, decisions, nil
	}
	now := time.Now()
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for start := 0; start < len(ids); start += insertBatchSize {
			end := min(start+insertBatchSize, len(ids))
			inserted := tx.Exec(insertSQL, now, now, ids[start:end])
			if inserted.Error != nil {
				return inserted.Error
			}
			result.Inserted += inserted.RowsAffected
		}
		return nil
	})
	if err != nil {
		result.Inserted = 0
	}
	return result, ids, decisions, err
}

func existingDishKeys(ctx context.Context, db *gorm.DB) (map[string]bool, error) {
	var rows []struct {
		CanteenID string `gorm:"column:canteen_id"`
		FoodName  string `gorm:"column:food_name"`
	}
	// Includes deleted rows on purpose: a removed dish must not come back.
	err := db.WithContext(ctx).Table("public_food_library").
		Select("canteen_id::text AS canteen_id, COALESCE(food_name, '') AS food_name").
		Where("canteen_id IS NOT NULL").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	keys := make(map[string]bool, len(rows))
	for _, row := range rows {
		keys[dishKey(row.CanteenID, row.FoodName)] = true
	}
	return keys, nil
}

func writeAudit(path string, decisions []decision) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.WriteString("\xef\xbb\xbf"); err != nil {
		return err
	}
	writer := csv.NewWriter(file)
	_ = writer.Write([]string{"action", "school", "canteen", "canteen_status", "name", "id"})
	for _, entry := range decisions {
		item := entry.Item
		_ = writer.Write([]string{entry.Action, item.SchoolName, item.CanteenName, item.CanteenStatus, item.Name, item.ID})
	}
	writer.Flush()
	return writer.Error()
}

func rollbackRun(ctx context.Context, db *gorm.DB, path string, apply bool) (int64, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	ids := strings.Fields(string(raw))
	for _, id := range ids {
		if _, err := uuid.Parse(id); err != nil {
			return 0, fmt.Errorf("invalid id %q: %w", id, err)
		}
	}
	query := db.WithContext(ctx).Table("public_food_library").
		Where("id IN ? AND type = 'campus' AND availability_status = 'unknown' AND status = 'published' AND COALESCE(total_calories, 0) <= 0", ids)
	if !apply {
		var count int64
		return count, query.Count(&count).Error
	}
	updated := query.Updates(map[string]any{"status": "deleted", "updated_at": time.Now()})
	return updated.RowsAffected, updated.Error
}
