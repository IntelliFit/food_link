// Command foodmap-lead-import publishes reviewed restaurant leads to the food map
// as official public_food_library rows. Default is a dry-run; --apply writes in one
// transaction and --rollback marks a previous import's rows deleted.
//
// Imported rows carry availability_status=unknown (nobody verified the shop is open
// or the dish on sale), nutrition_status=pending and no published_at, so they stay
// behind reviewed dishes in lists and out of recommendations and record search.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"food_link/backend/internal/migration/do"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	insertBatchSize = 500
	maxFoodNameLen  = 40
)

var leadItemNamespace = uuid.MustParse("6f1c3a52-8f0e-4a57-9a0b-2f4f3d0c7e11")

type importRow struct {
	LeadID          string  `json:"lead_id"`
	DishID          string  `json:"dish_id"`
	FoodName        string  `json:"food_name"`
	MerchantName    string  `json:"merchant_name"`
	MerchantAddress string  `json:"merchant_address"`
	DetailAddress   string  `json:"detail_address"`
	Province        string  `json:"province"`
	City            string  `json:"city"`
	District        string  `json:"district"`
	Latitude        float64 `json:"latitude"`
	Longitude       float64 `json:"longitude"`
}

type existingFood struct {
	ID           string  `gorm:"column:id"`
	Status       string  `gorm:"column:status"`
	FoodName     *string `gorm:"column:food_name"`
	MerchantName *string `gorm:"column:merchant_name"`
}

type report struct {
	Rows           int    `json:"rows"`
	Shops          int    `json:"shops"`
	WouldInsert    int    `json:"would_insert"`
	ExistingByID   int    `json:"existing_by_id"`
	ExistingByName int    `json:"existing_by_merchant_and_name"`
	Inserted       int64  `json:"inserted"`
	Mode           string `json:"mode"`
}

func main() {
	rowsPath := flag.String("rows", "", "import-rows.jsonl produced by prepare_import.py")
	idsPath := flag.String("ids", "", "file to write the inserted row IDs to (required with --apply)")
	cities := flag.String("cities", "", "comma-separated city filter for a staged rollout")
	apply := flag.Bool("apply", false, "write rows; default is dry-run")
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
		affected, err := rollbackImport(ctx, db, *rollback, *apply)
		if err != nil {
			log.Fatalf("回滚失败: %v", err)
		}
		fmt.Printf("rollback mode=%s rows=%d\n", modeName(*apply), affected)
		return
	}
	if *rowsPath == "" {
		log.Fatal("--rows is required")
	}
	if *apply && *idsPath == "" {
		log.Fatal("--ids is required with --apply so the import can be rolled back")
	}
	rows, err := loadRows(*rowsPath, *cities)
	if err != nil {
		log.Fatalf("读取导入文件失败: %v", err)
	}
	result, ids, err := run(ctx, db, rows, *apply)
	if err != nil {
		log.Fatalf("导入失败: %v", err)
	}
	if *apply {
		if err := os.WriteFile(*idsPath, []byte(strings.Join(ids, "\n")+"\n"), 0o644); err != nil {
			log.Fatalf("写入 ID 文件失败（数据已写入）: %v", err)
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

func loadRows(path, cityFilter string) ([]importRow, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	wanted := map[string]bool{}
	for _, city := range strings.Split(cityFilter, ",") {
		if city = strings.TrimSpace(city); city != "" {
			wanted[city] = true
		}
	}
	rows := []importRow{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 1024*1024), 16*1024*1024)
	for line := 1; scanner.Scan(); line++ {
		var row importRow
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			return nil, fmt.Errorf("line %d: %w", line, err)
		}
		if err := validateRow(row); err != nil {
			return nil, fmt.Errorf("line %d: %w", line, err)
		}
		if len(wanted) > 0 && !wanted[row.City] {
			continue
		}
		rows = append(rows, row)
	}
	return rows, scanner.Err()
}

func validateRow(row importRow) error {
	if strings.TrimSpace(row.LeadID) == "" || strings.TrimSpace(row.DishID) == "" {
		return fmt.Errorf("lead_id and dish_id are required")
	}
	if name := strings.TrimSpace(row.FoodName); name == "" || len([]rune(name)) > maxFoodNameLen {
		return fmt.Errorf("invalid food_name %q", row.FoodName)
	}
	if strings.TrimSpace(row.MerchantName) == "" {
		return fmt.Errorf("merchant_name is required")
	}
	// Mainland China bounding box: anything outside is a geocoding error for this data.
	if row.Latitude < 3 || row.Latitude > 54 || row.Longitude < 73 || row.Longitude > 136 {
		return fmt.Errorf("coordinate outside China: %f,%f", row.Latitude, row.Longitude)
	}
	return nil
}

func itemID(row importRow) string {
	return uuid.NewSHA1(leadItemNamespace, []byte(row.LeadID+":"+row.DishID)).String()
}

func foodKey(merchant, food string) string {
	return strings.TrimSpace(merchant) + "\x00" + strings.TrimSpace(food)
}

func run(ctx context.Context, db *gorm.DB, rows []importRow, apply bool) (report, []string, error) {
	result := report{Rows: len(rows), Mode: modeName(apply)}
	existing, err := loadExisting(ctx, db, rows)
	if err != nil {
		return result, nil, err
	}
	byID, byName := map[string]bool{}, map[string]bool{}
	for _, row := range existing {
		byID[row.ID] = true
		if row.FoodName != nil && row.MerchantName != nil {
			byName[foodKey(*row.MerchantName, *row.FoodName)] = true
		}
	}
	shops := map[string]bool{}
	pending := make([]do.PublicFoodItemDO, 0, len(rows))
	ids := make([]string, 0, len(rows))
	now := time.Now()
	for _, row := range rows {
		shops[row.LeadID] = true
		id := itemID(row)
		switch {
		case byID[id]:
			result.ExistingByID++
			continue
		case byName[foodKey(row.MerchantName, row.FoodName)]:
			// Includes deleted rows on purpose: a removed dish must not come back.
			result.ExistingByName++
			continue
		}
		byName[foodKey(row.MerchantName, row.FoodName)] = true
		pending = append(pending, buildRow(id, row, now))
		ids = append(ids, id)
	}
	result.Shops = len(shops)
	result.WouldInsert = len(pending)
	if !apply || len(pending) == 0 {
		return result, ids, nil
	}
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for start := 0; start < len(pending); start += insertBatchSize {
			end := min(start+insertBatchSize, len(pending))
			batch := pending[start:end]
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&batch)
			if created.Error != nil {
				return created.Error
			}
			result.Inserted += created.RowsAffected
		}
		return nil
	})
	if err != nil {
		result.Inserted = 0
	}
	return result, ids, err
}

func loadExisting(ctx context.Context, db *gorm.DB, rows []importRow) ([]existingFood, error) {
	ids, merchants := make([]string, 0, len(rows)), map[string]bool{}
	for _, row := range rows {
		ids = append(ids, itemID(row))
		merchants[row.MerchantName] = true
	}
	names := make([]string, 0, len(merchants))
	for name := range merchants {
		names = append(names, name)
	}
	existing := []existingFood{}
	err := db.WithContext(ctx).Table("public_food_library").
		Select("id, status, food_name, merchant_name").
		Where("id IN ? OR merchant_name IN ?", ids, names).
		Scan(&existing).Error
	return existing, err
}

func optionalText(value string) *string {
	if value = strings.TrimSpace(value); value == "" {
		return nil
	}
	return &value
}

func buildRow(id string, row importRow, now time.Time) do.PublicFoodItemDO {
	latitude, longitude := row.Latitude, row.Longitude
	zero := 0.0
	count := 0
	return do.PublicFoodItemDO{
		ID: id, FoodName: optionalText(row.FoodName), MerchantName: optionalText(row.MerchantName),
		MerchantAddress: optionalText(row.MerchantAddress), DetailAddress: optionalText(row.DetailAddress),
		Province: optionalText(row.Province), City: optionalText(row.City), District: optionalText(row.District),
		Latitude: &latitude, Longitude: &longitude,
		ImagePaths: []string{}, Items: []map[string]any{}, UserTags: []string{},
		TotalCalories: &zero, TotalProtein: &zero, TotalCarbs: &zero, TotalFat: &zero,
		LikeCount: &count, CommentCount: &count, CollectionCount: &count, AvgRating: &zero,
		Status: "published", Type: "common", ContentVersion: 1,
		NutritionStatus: "pending", AvailabilityStatus: "unknown",
		CreatedAt: &now, UpdatedAt: &now,
	}
}

func rollbackImport(ctx context.Context, db *gorm.DB, path string, apply bool) (int64, error) {
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
		Where("id IN ? AND availability_status = 'unknown' AND status = 'published'", ids)
	if !apply {
		var count int64
		return count, query.Count(&count).Error
	}
	updated := query.Updates(map[string]any{"status": "deleted", "updated_at": time.Now()})
	return updated.RowsAffected, updated.Error
}
