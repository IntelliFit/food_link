package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	adminrepo "food_link/backend/internal/admin/repo"
	adminservice "food_link/backend/internal/admin/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const cleanupPageSize = 100

type cleanupStats struct {
	Total           int64
	Scanned         int
	SkippedExisting int
	Kept            int
	KeptUnlabeled   int
	Excluded        int
	Reasons         map[string]int
	Labels          map[string]int
	FoodNames       map[string]int
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing config.yaml")
	apply := flag.Bool("apply", false, "persist annotations; default is dry-run")
	refreshAutomated := flag.Bool("refresh-automated", false, "recompute records without a manual reviewer")
	maxPhotos := flag.Int("max", 0, "maximum unannotated photos to classify; 0 means all")
	timeout := flag.Duration("timeout", 20*time.Minute, "batch timeout")
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
		log.Fatalf("获取 SQL 数据库连接失败: %v", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库 ping 失败: %v", err)
	}

	annotations, stats, err := collectAnnotations(ctx, db, *maxPhotos, *refreshAutomated)
	if err != nil {
		log.Fatalf("预演用户食物照片清洗失败: %v", err)
	}
	printStats(stats, *apply)
	if !*apply {
		fmt.Println("dry-run only; pass --apply to persist these annotations")
		return
	}
	if len(annotations) == 0 {
		fmt.Println("没有需要写入的未标注照片")
		return
	}
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		onConflict := clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "image_path"}},
			DoNothing: true,
		}
		if *refreshAutomated {
			onConflict.DoNothing = false
			onConflict.DoUpdates = clause.Assignments(map[string]any{
				"review_status":    gorm.Expr("EXCLUDED.review_status"),
				"labels":           gorm.Expr("EXCLUDED.labels"),
				"exclusion_reason": gorm.Expr("EXCLUDED.exclusion_reason"),
				"updated_at":       gorm.Expr("NOW()"),
			})
			onConflict.Where = clause.Where{Exprs: []clause.Expression{
				clause.Expr{SQL: "user_food_photo_annotations.reviewed_by IS NULL"},
			}}
		}
		return tx.Clauses(onConflict).CreateInBatches(annotations, 200).Error
	}); err != nil {
		log.Fatalf("写入自动清洗标注失败: %v", err)
	}
	var persisted int64
	if err := db.WithContext(ctx).Model(&adminrepo.UserFoodPhotoAnnotation{}).Count(&persisted).Error; err != nil {
		log.Fatalf("回查自动清洗标注失败: %v", err)
	}
	fmt.Printf("自动清洗写入完成: attempted=%d annotation_table_total=%d\n", len(annotations), persisted)
}

func collectAnnotations(ctx context.Context, db *gorm.DB, maxPhotos int, refreshAutomated bool) ([]adminrepo.UserFoodPhotoAnnotation, cleanupStats, error) {
	photoRepo := adminrepo.NewUserFoodPhotoRepo(db)
	stats := cleanupStats{
		Reasons:   make(map[string]int),
		Labels:    make(map[string]int),
		FoodNames: make(map[string]int),
	}
	manualKeys, err := loadManualAnnotationKeys(ctx, db)
	if err != nil {
		return nil, stats, err
	}
	annotations := make([]adminrepo.UserFoodPhotoAnnotation, 0, 1024)
	keptSources := make(map[string]struct{})
	seenIdentities := make(map[string]struct{})
	offset := 0
	for {
		annotationStatus := "pending"
		if refreshAutomated {
			annotationStatus = "all"
		}
		result, err := photoRepo.List(ctx, adminrepo.ListUserFoodPhotoInput{
			AnnotationStatus: annotationStatus,
			SortBy:           "created_at",
			SortOrder:        "desc",
			Limit:            cleanupPageSize,
			Offset:           offset,
		})
		if err != nil {
			return nil, stats, err
		}
		stats.Total = result.Total
		if len(result.Items) == 0 {
			break
		}
		for _, photo := range result.Items {
			stats.Scanned++
			identityKey := photo.UserID + "\x00" + photo.ImagePath
			if _, seen := seenIdentities[identityKey]; seen {
				continue
			}
			seenIdentities[identityKey] = struct{}{}
			if _, manual := manualKeys[identityKey]; manual {
				if photo.AnnotationStatus == "kept" && photo.SourceID != "" {
					keptSources[photo.SourceType+"\x00"+photo.SourceID] = struct{}{}
				}
				stats.SkippedExisting++
				continue
			}
			if !refreshAutomated && photo.AnnotationUpdatedAt != nil {
				stats.SkippedExisting++
				continue
			}
			classification := adminservice.ClassifyUserFoodPhotoForRanking(photo)
			if classification.ReviewStatus == "kept" && photo.SourceID != "" {
				sourceKey := photo.SourceType + "\x00" + photo.SourceID
				if _, duplicate := keptSources[sourceKey]; duplicate {
					classification = adminservice.UserFoodPhotoClassification{ReviewStatus: "excluded", ExclusionReason: "duplicate"}
				} else {
					keptSources[sourceKey] = struct{}{}
				}
			}
			annotation := adminrepo.UserFoodPhotoAnnotation{
				UserID:          photo.UserID,
				ImagePath:       photo.ImagePath,
				ReviewStatus:    classification.ReviewStatus,
				Labels:          datatypes.NewJSONSlice(classification.Labels),
				ExclusionReason: classification.ExclusionReason,
			}
			annotations = append(annotations, annotation)
			if classification.ReviewStatus == "kept" {
				stats.Kept++
				if len(classification.Labels) == 0 {
					stats.KeptUnlabeled++
				}
				if photo.Nutrition != nil {
					for _, name := range photo.Nutrition.ItemNames {
						name = strings.TrimSpace(name)
						if name != "" {
							stats.FoodNames[name]++
						}
					}
				}
			} else {
				stats.Excluded++
				stats.Reasons[classification.ExclusionReason]++
			}
			for _, label := range classification.Labels {
				stats.Labels[label]++
			}
			if maxPhotos > 0 && len(annotations) >= maxPhotos {
				return annotations, stats, nil
			}
		}
		offset += len(result.Items)
		if int64(offset) >= result.Total {
			break
		}
	}
	return annotations, stats, nil
}

func loadManualAnnotationKeys(ctx context.Context, db *gorm.DB) (map[string]struct{}, error) {
	type annotationIdentity struct {
		UserID    string `gorm:"column:user_id"`
		ImagePath string `gorm:"column:image_path"`
	}
	var rows []annotationIdentity
	if err := db.WithContext(ctx).Model(&adminrepo.UserFoodPhotoAnnotation{}).
		Select("user_id", "image_path").Where("reviewed_by IS NOT NULL").Scan(&rows).Error; err != nil {
		return nil, err
	}
	keys := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		keys[row.UserID+"\x00"+row.ImagePath] = struct{}{}
	}
	return keys, nil
}

func printStats(stats cleanupStats, applying bool) {
	mode := "dry-run"
	if applying {
		mode = "apply"
	}
	fmt.Printf("mode=%s total=%d scanned=%d skipped_existing=%d kept=%d kept_unlabeled=%d excluded=%d\n",
		mode, stats.Total, stats.Scanned, stats.SkippedExisting, stats.Kept, stats.KeptUnlabeled, stats.Excluded)
	printSortedCounts("exclusion_reasons", stats.Reasons, 0)
	printSortedCounts("labels", stats.Labels, 0)
	printSortedCounts("top_rankable_food_names", stats.FoodNames, 30)
}

func printSortedCounts(title string, values map[string]int, limit int) {
	type pair struct {
		Name  string
		Count int
	}
	pairs := make([]pair, 0, len(values))
	for name, count := range values {
		pairs = append(pairs, pair{Name: name, Count: count})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].Count == pairs[j].Count {
			return pairs[i].Name < pairs[j].Name
		}
		return pairs[i].Count > pairs[j].Count
	})
	if limit > 0 && len(pairs) > limit {
		pairs = pairs[:limit]
	}
	fmt.Printf("%s:", title)
	for _, item := range pairs {
		fmt.Printf(" %s=%d", item.Name, item.Count)
	}
	fmt.Println()
}
