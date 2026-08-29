package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	adminrepo "food_link/backend/internal/admin/repo"
	adminservice "food_link/backend/internal/admin/service"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	_ "golang.org/x/image/webp"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	cleanupPageSize             = 500
	rankableImageDownloadLimit  = 20 << 20
	rankableImageRequestTimeout = 15 * time.Second
	rankableImageWorkers        = 16
)

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
	RankableChecked int
	RankablePassed  int
	RankableRemoved map[string]int
}

type rankableImageQualityGate struct {
	httpClient  *http.Client
	storage     *storage.Client
	trustedHost string
}

func main() {
	configDir := flag.String("config-dir", ".", "directory containing config.yaml")
	apply := flag.Bool("apply", false, "persist annotations; default is dry-run")
	refreshAutomated := flag.Bool("refresh-automated", false, "recompute records without a manual reviewer")
	refreshReviewed := flag.Bool("refresh-reviewed", false, "also recompute manually reviewed records; requires --refresh-automated")
	onlyLabel := flag.String("only-label", "", "with --refresh-automated, only recompute rows currently carrying this label")
	normalizeLabels := flag.Bool("normalize-labels", false, "merge dessert into snack and remove packaged_food without reclassifying photos")
	auditLabel := flag.String("audit-label", "", "read-only audit of currently stored annotations with this label")
	auditDerivedLabel := flag.String("audit-derived-label", "", "read-only audit of photos that the current classifier would assign this label")
	maxPhotos := flag.Int("max", 0, "maximum unannotated photos to classify; 0 means all")
	timeout := flag.Duration("timeout", 20*time.Minute, "batch timeout")
	flag.Parse()
	if *refreshReviewed && !*refreshAutomated {
		log.Fatal("--refresh-reviewed 必须与 --refresh-automated 一起使用")
	}
	if strings.TrimSpace(*onlyLabel) != "" && !*refreshAutomated {
		log.Fatal("--only-label 必须与 --refresh-automated 一起使用")
	}

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
	if *normalizeLabels {
		stats, err := normalizeStoredPhotoLabels(ctx, db, *apply)
		if err != nil {
			log.Fatalf("规范化用户食物照片标签失败: %v", err)
		}
		fmt.Printf("标签规范化完成: mode=%s total=%d changed=%d dessert_merged=%d packaged_food_removed=%d\n",
			map[bool]string{false: "dry-run", true: "apply"}[*apply], stats.Total, stats.Changed, stats.DessertMerged, stats.PackagedFoodRemoved)
		if !*apply {
			fmt.Println("dry-run only; pass --apply to persist these label changes")
		}
		return
	}
	if strings.TrimSpace(*auditLabel) != "" {
		if err := auditStoredLabel(ctx, db, strings.TrimSpace(*auditLabel)); err != nil {
			log.Fatalf("审查用户食物照片标签失败: %v", err)
		}
		return
	}
	if strings.TrimSpace(*auditDerivedLabel) != "" {
		if err := auditDerivedPhotoLabel(ctx, db, strings.TrimSpace(*auditDerivedLabel), *maxPhotos); err != nil {
			log.Fatalf("审查推导用户食物照片标签失败: %v", err)
		}
		return
	}
	qualityGate, err := newRankableImageQualityGate(cfg.Storage)
	if err != nil {
		log.Fatalf("初始化排行榜图片质量门禁失败: %v", err)
	}

	annotations, stats, err := collectAnnotations(ctx, db, qualityGate, *maxPhotos, *refreshAutomated, *refreshReviewed, strings.TrimSpace(*onlyLabel))
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
	if failures := rankableImageOperationalFailures(stats.RankableRemoved); stats.RankableChecked > 0 && failures*10 > stats.RankableChecked {
		log.Fatalf("排行榜图片读取失败比例过高: failures=%d checked=%d；已阻止写入，请检查 CDN 后重试", failures, stats.RankableChecked)
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
			if !*refreshReviewed {
				onConflict.Where = clause.Where{Exprs: []clause.Expression{
					clause.Expr{SQL: "user_food_photo_annotations.reviewed_by IS NULL"},
				}}
			}
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

func auditDerivedPhotoLabel(ctx context.Context, db *gorm.DB, label string, maxMatches int) error {
	photoRepo := adminrepo.NewUserFoodPhotoRepo(db)
	offset := 0
	matches := 0
	keptSources := make(map[string]struct{})
	for {
		result, err := photoRepo.List(ctx, adminrepo.ListUserFoodPhotoInput{
			AnnotationStatus: "all",
			SortBy:           "created_at",
			SortOrder:        "desc",
			Limit:            cleanupPageSize,
			Offset:           offset,
		})
		if err != nil {
			return err
		}
		for _, photo := range result.Items {
			classification := adminservice.ClassifyUserFoodPhotoForRanking(photo)
			if classification.ReviewStatus == "kept" && photo.SourceID != "" {
				sourceKey := photo.SourceType + "\x00" + photo.SourceID
				if _, duplicate := keptSources[sourceKey]; duplicate {
					classification = adminservice.UserFoodPhotoClassification{ReviewStatus: "excluded", ExclusionReason: "duplicate"}
				} else {
					keptSources[sourceKey] = struct{}{}
				}
			}
			if !containsString(classification.Labels, label) {
				continue
			}
			itemNames := ""
			if photo.Nutrition != nil {
				itemNames = strings.Join(photo.Nutrition.ItemNames, " | ")
			}
			fmt.Printf("%s\t%s\t%s\t%s\t%s\n",
				photo.CreatedAt.Format(time.RFC3339), photo.SourceType, photo.SourceID, photo.Description, itemNames)
			matches++
			if maxMatches > 0 && matches >= maxMatches {
				fmt.Printf("derived_label=%s matches_shown=%d truncated=true\n", label, matches)
				return nil
			}
		}
		offset += len(result.Items)
		if len(result.Items) == 0 || int64(offset) >= result.Total {
			break
		}
	}
	fmt.Printf("derived_label=%s matches=%d truncated=false\n", label, matches)
	return nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func auditStoredLabel(ctx context.Context, db *gorm.DB, label string) error {
	photoRepo := adminrepo.NewUserFoodPhotoRepo(db)
	offset := 0
	for {
		result, err := photoRepo.List(ctx, adminrepo.ListUserFoodPhotoInput{
			AnnotationStatus: "kept",
			AnnotationLabel:  label,
			SortBy:           "created_at",
			SortOrder:        "desc",
			Limit:            cleanupPageSize,
			Offset:           offset,
		})
		if err != nil {
			return err
		}
		if offset == 0 {
			fmt.Printf("stored_label=%s total=%d\n", label, result.Total)
		}
		for _, photo := range result.Items {
			itemNames := ""
			if photo.Nutrition != nil {
				itemNames = strings.Join(photo.Nutrition.ItemNames, " | ")
			}
			classification := adminservice.ClassifyUserFoodPhotoForRanking(photo)
			fmt.Printf("%s\t%s\t%s\t%s\t%s\t%s\n",
				photo.CreatedAt.Format(time.RFC3339), photo.SourceType, photo.SourceID,
				strings.Join(classification.Labels, ","), photo.Description, itemNames)
		}
		offset += len(result.Items)
		if len(result.Items) == 0 || int64(offset) >= result.Total {
			break
		}
	}
	return nil
}

func collectAnnotations(ctx context.Context, db *gorm.DB, qualityGate *rankableImageQualityGate, maxPhotos int, refreshAutomated, refreshReviewed bool, onlyLabel string) ([]adminrepo.UserFoodPhotoAnnotation, cleanupStats, error) {
	photoRepo := adminrepo.NewUserFoodPhotoRepo(db)
	stats := cleanupStats{
		Reasons:         make(map[string]int),
		Labels:          make(map[string]int),
		FoodNames:       make(map[string]int),
		RankableRemoved: make(map[string]int),
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
			AnnotationLabel:  onlyLabel,
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
		qualityAssessments := assessPageRankableImages(ctx, result.Items, qualityGate)
		for _, photo := range result.Items {
			stats.Scanned++
			identityKey := photo.UserID + "\x00" + photo.ImagePath
			if _, seen := seenIdentities[identityKey]; seen {
				continue
			}
			seenIdentities[identityKey] = struct{}{}
			if _, manual := manualKeys[identityKey]; manual && !refreshReviewed {
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
			if containsString(classification.Labels, "rankable") {
				stats.RankableChecked++
				assessment := qualityAssessments[identityKey]
				if assessment.Eligible {
					stats.RankablePassed++
				} else {
					classification.Labels = removeString(classification.Labels, "rankable")
					stats.RankableRemoved[assessment.Reason]++
				}
			}
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
				if containsString(classification.Labels, "rankable") && photo.Nutrition != nil {
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

func assessPageRankableImages(ctx context.Context, photos []adminrepo.UserFoodPhoto, qualityGate *rankableImageQualityGate) map[string]adminservice.RankableImageQualityAssessment {
	type job struct {
		key       string
		imagePath string
	}
	jobs := make(chan job)
	results := make(map[string]adminservice.RankableImageQualityAssessment)
	var resultsMu sync.Mutex
	var workers sync.WaitGroup
	for range rankableImageWorkers {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for item := range jobs {
				assessment := qualityGate.assess(ctx, item.imagePath)
				resultsMu.Lock()
				results[item.key] = assessment
				resultsMu.Unlock()
			}
		}()
	}
	for _, photo := range photos {
		classification := adminservice.ClassifyUserFoodPhotoForRanking(photo)
		if !containsString(classification.Labels, "rankable") {
			continue
		}
		jobs <- job{key: photo.UserID + "\x00" + photo.ImagePath, imagePath: photo.ImagePath}
	}
	close(jobs)
	workers.Wait()
	return results
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
	fmt.Printf("rankable_image_quality: checked=%d passed=%d removed=%d\n",
		stats.RankableChecked, stats.RankablePassed, stats.RankableChecked-stats.RankablePassed)
	printSortedCounts("rankable_removed_reasons", stats.RankableRemoved, 0)
	printSortedCounts("top_rankable_food_names", stats.FoodNames, 30)
}

func newRankableImageQualityGate(cfg config.StorageConfig) (*rankableImageQualityGate, error) {
	baseURL, err := url.Parse(strings.TrimSpace(cfg.CDNFoodImagesBaseURL))
	if err != nil || baseURL.Scheme != "https" || baseURL.Host == "" {
		return nil, fmt.Errorf("food-images CDN 地址无效")
	}
	return &rankableImageQualityGate{
		httpClient:  &http.Client{Timeout: rankableImageRequestTimeout},
		storage:     storage.New(cfg),
		trustedHost: strings.ToLower(baseURL.Host),
	}, nil
}

func (g *rankableImageQualityGate) assess(ctx context.Context, imagePath string) adminservice.RankableImageQualityAssessment {
	resolved := g.storage.ResolveReferenceURL("food-images", imagePath)
	parsed, err := url.Parse(resolved)
	if err != nil || parsed.Scheme != "https" || strings.ToLower(parsed.Host) != g.trustedHost {
		return adminservice.RankableImageQualityAssessment{Reason: "untrusted_or_missing_url"}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, resolved, nil)
	if err != nil {
		return adminservice.RankableImageQualityAssessment{Reason: "download_failed"}
	}
	resp, err := g.httpClient.Do(req)
	if err != nil {
		return adminservice.RankableImageQualityAssessment{Reason: "download_failed"}
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return adminservice.RankableImageQualityAssessment{Reason: "http_error"}
	}
	if resp.ContentLength > rankableImageDownloadLimit {
		return adminservice.RankableImageQualityAssessment{Reason: "file_too_large"}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, rankableImageDownloadLimit+1))
	if err != nil {
		return adminservice.RankableImageQualityAssessment{Reason: "download_failed"}
	}
	if len(data) == 0 || len(data) > rankableImageDownloadLimit {
		return adminservice.RankableImageQualityAssessment{Reason: "file_too_large"}
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return adminservice.RankableImageQualityAssessment{Reason: "decode_failed"}
	}
	return adminservice.AssessRankableImageQuality(img)
}

func removeString(values []string, target string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value != target {
			result = append(result, value)
		}
	}
	return result
}

func rankableImageOperationalFailures(reasons map[string]int) int {
	return reasons["download_failed"] + reasons["http_error"] + reasons["decode_failed"] + reasons["untrusted_or_missing_url"]
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
