// public-library-portion-repair 修复「公共库菜品 1份 被当成 1g」写进用户记录的重量。
//
// 旧逻辑在公共库条目缺少 intake/weight 时把一份的重量兜底成 1g，于是记录里的 weight
// 实际是「份数」，营养是「份数 × 一份营养」。份数 ≤ max-portion-count 时按份数理解，
// 只把 weight/intake 改成 份数 × 一份真实重量（营养本来就对）；份数更大时用户填的是克数，
// 保留 weight 并把营养按 1/一份重量 缩放。默认只做 dry-run；--apply 前会把原始行备份到 backup-dir。
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

const repairMarker = "public_library_portion_2026_10_19"

// affectedItemsSQL 与 internal/utility/repo/public_food_portion.go 的重量解析保持一致。
const affectedItemsSQL = `
WITH lib AS (
	SELECT p.id::text AS id, p.total_calories AS portion_calories,
		(SELECT CASE WHEN count(*) = count(iw) THEN sum(iw) END FROM (
			SELECT COALESCE(
				NULLIF((it->>'intake')::numeric, 0),
				NULLIF((it->>'weight')::numeric, 0),
				NULLIF((it->>'estimatedWeightGrams')::numeric, 0),
				NULLIF((it->>'final_weight_g')::numeric, 0),
				NULLIF((it->>'originalWeightGrams')::numeric, 0),
				(substring(it->>'portion_description' FROM '(\d+(?:\.\d+)?)\s*(?:ml|mL|ML|g|G|克|毫升)'))::numeric
			) AS iw
			FROM jsonb_array_elements(p.items) it
		) s) AS portion_weight,
		(jsonb_array_length(p.items) <> 1
			OR (COALESCE((p.items->0->>'intake')::numeric, 0) <= 0 AND COALESCE((p.items->0->>'weight')::numeric, 0) <= 0)) AS used_one_gram
	FROM public_food_library p
	WHERE jsonb_typeof(p.items) = 'array'
)
SELECT r.id AS record_id, r.user_id, (x.ord - 1)::int AS item_index, x.e->>'name' AS name,
	(x.e->>'weight')::float8 AS weight, (x.e->'nutrients'->>'calories')::float8 AS calories,
	l.portion_calories::float8 AS portion_calories, l.portion_weight::float8 AS portion_weight
FROM user_food_records r
CROSS JOIN LATERAL jsonb_array_elements(r.items) WITH ORDINALITY AS x(e, ord)
JOIN lib l ON l.id = x.e->>'manual_source_id'
WHERE x.e->>'manual_source' = 'public_library'
	AND COALESCE(x.e->>'weight_repair', '') = ''
	AND (x.e->>'weight')::numeric > 0
	AND l.portion_calories > 0
	AND l.portion_weight > 0
	AND l.used_one_gram
	AND (
		abs((x.e->'nutrients'->>'calories')::numeric - (x.e->>'weight')::numeric * l.portion_calories)
			<= greatest(1, (x.e->'nutrients'->>'calories')::numeric * 0.02)
		OR (x.e->'nutrients'->>'calories')::numeric / (x.e->>'weight')::numeric > 9.18
	)
ORDER BY r.id, item_index`

type affectedItem struct {
	RecordID        string  `gorm:"column:record_id" json:"record_id"`
	UserID          string  `gorm:"column:user_id" json:"user_id"`
	ItemIndex       int     `gorm:"column:item_index" json:"item_index"`
	Name            string  `gorm:"column:name" json:"name"`
	Weight          float64 `gorm:"column:weight" json:"weight"`
	Calories        float64 `gorm:"column:calories" json:"calories"`
	PortionCalories float64 `gorm:"column:portion_calories" json:"portion_calories"`
	PortionWeight   float64 `gorm:"column:portion_weight" json:"portion_weight"`
}

type recordRow struct {
	ID            string         `gorm:"column:id" json:"id"`
	Items         datatypes.JSON `gorm:"column:items" json:"items"`
	TotalCalories float64        `gorm:"column:total_calories" json:"total_calories"`
	TotalProtein  float64        `gorm:"column:total_protein" json:"total_protein"`
	TotalCarbs    float64        `gorm:"column:total_carbs" json:"total_carbs"`
	TotalFat      float64        `gorm:"column:total_fat" json:"total_fat"`
	TotalWeight   float64        `gorm:"column:total_weight_grams" json:"total_weight_grams"`
}

type itemChange struct {
	RecordID       string  `json:"record_id"`
	ItemIndex      int     `json:"item_index"`
	Name           string  `json:"name"`
	Mode           string  `json:"mode"`
	OldWeight      float64 `json:"old_weight"`
	NewWeight      float64 `json:"new_weight"`
	OldCalories    float64 `json:"old_calories"`
	NewCalories    float64 `json:"new_calories"`
	OldKcalPerGram float64 `json:"old_kcal_per_g"`
	NewKcalPerGram float64 `json:"new_kcal_per_g"`
}

type recordChange struct {
	Before recordRow    `json:"before"`
	After  recordRow    `json:"after"`
	Items  []itemChange `json:"items"`
}

func main() {
	configDir := flag.String("config-dir", ".", "backend config directory")
	maxPortionCount := flag.Float64("max-portion-count", 5, "stored weights up to this are portion counts; larger ones are grams the user typed")
	apply := flag.Bool("apply", false, "write repaired records; dry-run otherwise")
	backupDir := flag.String("backup-dir", filepath.Join("..", "tmp"), "directory for the before/after JSON written on --apply")
	timeout := flag.Duration("timeout", 3*time.Minute, "command timeout")
	flag.Parse()

	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	changes, err := planChanges(ctx, db, *maxPortionCount)
	if err != nil {
		log.Fatalf("plan: %v", err)
	}
	printSummary(changes)
	if !*apply {
		fmt.Println("dry-run: nothing written (pass --apply to write)")
		return
	}
	backupPath, err := writeBackup(*backupDir, changes)
	if err != nil {
		log.Fatalf("backup: %v", err)
	}
	fmt.Printf("backup written: %s\n", backupPath)
	if err := applyChanges(ctx, db, changes); err != nil {
		log.Fatalf("apply (rolled back): %v", err)
	}
	fmt.Printf("applied: %d records\n", len(changes))
}

func planChanges(ctx context.Context, db *gorm.DB, maxPortionCount float64) ([]recordChange, error) {
	var affected []affectedItem
	if err := db.WithContext(ctx).Raw(affectedItemsSQL).Scan(&affected).Error; err != nil {
		return nil, err
	}
	byRecord := map[string][]affectedItem{}
	order := make([]string, 0)
	for _, item := range affected {
		if _, ok := byRecord[item.RecordID]; !ok {
			order = append(order, item.RecordID)
		}
		byRecord[item.RecordID] = append(byRecord[item.RecordID], item)
	}
	changes := make([]recordChange, 0, len(order))
	for _, recordID := range order {
		var row recordRow
		err := db.WithContext(ctx).Raw(`SELECT id, items, total_calories, total_protein, total_carbs, total_fat, COALESCE(total_weight_grams, 0) AS total_weight_grams FROM user_food_records WHERE id = ?`, recordID).Scan(&row).Error
		if err != nil {
			return nil, err
		}
		change, err := repairRecord(row, byRecord[recordID], maxPortionCount)
		if err != nil {
			return nil, fmt.Errorf("record %s: %w", recordID, err)
		}
		changes = append(changes, change)
	}
	return changes, nil
}

func repairRecord(row recordRow, targets []affectedItem, maxPortionCount float64) (recordChange, error) {
	var items []map[string]any
	if err := json.Unmarshal(row.Items, &items); err != nil {
		return recordChange{}, err
	}
	after := row
	change := recordChange{Before: row}
	for _, target := range targets {
		if target.ItemIndex < 0 || target.ItemIndex >= len(items) {
			return recordChange{}, fmt.Errorf("item %d out of range", target.ItemIndex)
		}
		item := items[target.ItemIndex]
		oldWeight := number(item["weight"])
		oldIntake := number(item["intake"])
		ratio := number(item["ratio"])
		if ratio <= 0 {
			ratio = 100
		}
		nutrients, _ := item["nutrients"].(map[string]any)
		if nutrients == nil {
			return recordChange{}, fmt.Errorf("item %d has no nutrients", target.ItemIndex)
		}
		oldMacros := macros(nutrients)

		mode := "portions"
		newWeight := round1(oldWeight * target.PortionWeight)
		if oldWeight > maxPortionCount {
			// 用户把克数填进了「份」输入框：重量保留，营养按真实每克密度重算。
			mode = "grams"
			newWeight = oldWeight
			scale := 1 / target.PortionWeight
			item["nutrients"] = scaleNumbers(nutrients, scale)
			for _, key := range []string{"waterMl", "water_ml"} {
				if value, ok := item[key]; ok {
					item[key] = round1(number(value) * scale)
				}
			}
		}
		newIntake := round1(newWeight * ratio / 100)
		item["weight"] = newWeight
		item["intake"] = newIntake
		item["weight_repair"] = repairMarker

		newMacros := macros(item["nutrients"].(map[string]any))
		factor := ratio / 100
		after.TotalCalories = round1(after.TotalCalories + (newMacros[0]-oldMacros[0])*factor)
		after.TotalProtein = round1(after.TotalProtein + (newMacros[1]-oldMacros[1])*factor)
		after.TotalCarbs = round1(after.TotalCarbs + (newMacros[2]-oldMacros[2])*factor)
		after.TotalFat = round1(after.TotalFat + (newMacros[3]-oldMacros[3])*factor)
		if oldIntake <= 0 {
			oldIntake = oldWeight * factor
		}
		after.TotalWeight = math.Max(0, after.TotalWeight+newIntake-oldIntake)

		change.Items = append(change.Items, itemChange{
			RecordID:       row.ID,
			ItemIndex:      target.ItemIndex,
			Name:           target.Name,
			Mode:           mode,
			OldWeight:      oldWeight,
			NewWeight:      newWeight,
			OldCalories:    oldMacros[0],
			NewCalories:    newMacros[0],
			OldKcalPerGram: round1(oldMacros[0] / oldWeight),
			NewKcalPerGram: round1(newMacros[0] / newWeight),
		})
	}
	after.TotalWeight = math.Round(after.TotalWeight)
	encoded, err := json.Marshal(items)
	if err != nil {
		return recordChange{}, err
	}
	after.Items = encoded
	change.After = after
	return change, nil
}

func applyChanges(ctx context.Context, db *gorm.DB, changes []recordChange) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, change := range changes {
			before, after := change.Before, change.After
			// items 与 dry-run 时读到的一致才写，防止覆盖期间被用户再次编辑的记录。
			result := tx.Exec(`UPDATE user_food_records
				SET items = ?::jsonb, total_calories = ?, total_protein = ?, total_carbs = ?, total_fat = ?, total_weight_grams = ?
				WHERE id = ? AND items = ?::jsonb`,
				string(after.Items), after.TotalCalories, after.TotalProtein, after.TotalCarbs, after.TotalFat, int(after.TotalWeight),
				before.ID, string(before.Items))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf("record %s changed since planning (rows=%d)", before.ID, result.RowsAffected)
			}
		}
		return nil
	})
}

func printSummary(changes []recordChange) {
	items := make([]itemChange, 0)
	for _, change := range changes {
		items = append(items, change.Items...)
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Mode > items[j].Mode })
	fmt.Printf("%-36s %3s %-14s %-8s %10s %10s %10s %10s %8s %8s\n", "record_id", "idx", "name", "mode", "old_w", "new_w", "old_kcal", "new_kcal", "old/g", "new/g")
	for _, item := range items {
		fmt.Printf("%-36s %3d %-14s %-8s %10.1f %10.1f %10.1f %10.1f %8.1f %8.1f\n",
			item.RecordID, item.ItemIndex, truncate(item.Name, 7), item.Mode, item.OldWeight, item.NewWeight, item.OldCalories, item.NewCalories, item.OldKcalPerGram, item.NewKcalPerGram)
	}
	fmt.Printf("records=%d items=%d\n", len(changes), len(items))
}

func writeBackup(dir string, changes []recordChange) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, fmt.Sprintf("public-library-portion-repair-%s.json", time.Now().Format("20060102-150405")))
	encoded, err := json.MarshalIndent(changes, "", "  ")
	if err != nil {
		return "", err
	}
	return path, os.WriteFile(path, encoded, 0o600)
}

func macros(nutrients map[string]any) [4]float64 {
	return [4]float64{number(nutrients["calories"]), number(nutrients["protein"]), number(nutrients["carbs"]), number(nutrients["fat"])}
}

func scaleNumbers(values map[string]any, scale float64) map[string]any {
	next := make(map[string]any, len(values))
	for key, value := range values {
		if n, ok := value.(float64); ok {
			next[key] = math.Round(n*scale*100) / 100
			continue
		}
		next[key] = value
	}
	return next
}

func number(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case json.Number:
		n, _ := v.Float64()
		return n
	case string:
		var n float64
		_, _ = fmt.Sscanf(v, "%f", &n)
		return n
	default:
		return 0
	}
}

func round1(value float64) float64 {
	return math.Round(value*10) / 10
}

func truncate(value string, runes int) string {
	r := []rune(value)
	if len(r) <= runes {
		return value
	}
	return string(r[:runes])
}
