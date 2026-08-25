package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"
	"unicode"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type foodRow struct {
	ID             string         `gorm:"column:id"`
	CanonicalName  string         `gorm:"column:canonical_name"`
	NormalizedName string         `gorm:"column:normalized_name"`
	ImagePath      *string        `gorm:"column:image_path"`
	ImagePaths     datatypes.JSON `gorm:"column:image_paths"`
	IsActive       bool           `gorm:"column:is_active"`
}

type duplicatePlan struct {
	Key    string
	Winner foodRow
	Losers []foodRow
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing config.yaml")
	apply := flag.Bool("apply", false, "delete unreferenced duplicate variants; default is dry-run")
	timeout := flag.Duration("timeout", 5*time.Minute, "command timeout")
	flag.Parse()

	cfg, err := config.Load(*configDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("获取数据库连接失败: %v", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	plans, err := buildDuplicatePlans(ctx, db)
	if err != nil {
		log.Fatalf("审计标准食物重复失败: %v", err)
	}
	for _, plan := range plans {
		for _, loser := range plan.Losers {
			fmt.Printf("duplicate key=%s keep=%s(%s) remove=%s(%s)\n",
				plan.Key, plan.Winner.CanonicalName, plan.Winner.ID, loser.CanonicalName, loser.ID)
		}
	}
	if !*apply {
		fmt.Printf("mode=dry-run groups=%d removals=%d\n", len(plans), planRemovalCount(plans))
		return
	}
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, plan := range plans {
			if err := tx.Table("food_nutrition_library").Where("id = ?", plan.Winner.ID).
				Update("normalized_name", plan.Key).Error; err != nil {
				return err
			}
			for _, loser := range plan.Losers {
				if err := ensureUnreferenced(ctx, tx, loser.ID); err != nil {
					return err
				}
				if err := tx.Exec("DELETE FROM food_nutrition_library WHERE id = ?", loser.ID).Error; err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		log.Fatalf("清理标准食物重复失败（事务已回滚）: %v", err)
	}
	fmt.Printf("mode=apply groups=%d removed=%d\n", len(plans), planRemovalCount(plans))
}

func buildDuplicatePlans(ctx context.Context, db *gorm.DB) ([]duplicatePlan, error) {
	var rows []foodRow
	if err := db.WithContext(ctx).Table("food_nutrition_library").
		Select("id, canonical_name, normalized_name, image_path, image_paths, is_active").Find(&rows).Error; err != nil {
		return nil, err
	}
	groups := make(map[string][]foodRow)
	for _, row := range rows {
		key := normalizeComparableName(row.CanonicalName)
		if key != "" {
			groups[key] = append(groups[key], row)
		}
	}
	keys := make([]string, 0)
	for key, group := range groups {
		if len(group) > 1 {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	plans := make([]duplicatePlan, 0, len(keys))
	for _, key := range keys {
		group := groups[key]
		sort.SliceStable(group, func(i, j int) bool { return preferFood(group[i], group[j]) })
		plans = append(plans, duplicatePlan{Key: key, Winner: group[0], Losers: group[1:]})
	}
	return plans, nil
}

func normalizeComparableName(raw string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if r == '氽' {
			r = '汆'
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func preferFood(left, right foodRow) bool {
	leftImage, rightImage := hasImage(left), hasImage(right)
	if leftImage != rightImage {
		return leftImage
	}
	leftTypo := strings.Contains(left.CanonicalName, "氽")
	rightTypo := strings.Contains(right.CanonicalName, "氽")
	if leftTypo != rightTypo {
		return !leftTypo
	}
	if left.IsActive != right.IsActive {
		return left.IsActive
	}
	return left.ID < right.ID
}

func hasImage(row foodRow) bool {
	return row.ImagePath != nil && strings.TrimSpace(*row.ImagePath) != "" ||
		len(strings.TrimSpace(string(row.ImagePaths))) > 2
}

func ensureUnreferenced(ctx context.Context, db *gorm.DB, foodID string) error {
	checks := []struct{ table, column string }{
		{"food_nutrition_aliases", "food_id"},
		{"food_nutrition_embeddings", "food_id"},
		{"food_nutrition_alias_candidates", "proposed_food_id"},
		{"food_nutrition_contributions", "target_food_id"},
	}
	for _, check := range checks {
		var count int64
		if err := db.WithContext(ctx).Table(check.table).Where(check.column+" = ?", foodID).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("记录 %s 仍被 %s.%s 引用 %d 次", foodID, check.table, check.column, count)
		}
	}
	return nil
}

func planRemovalCount(plans []duplicatePlan) int {
	total := 0
	for _, plan := range plans {
		total += len(plan.Losers)
	}
	return total
}
