package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"food_link/backend/internal/migration/do"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	imageExts     = map[string]bool{".jpg": true, ".jpeg": true, ".png": true}
	weightPattern = regexp.MustCompile(`^\s*([\d.]+)\s*g\s*$`)
)

type labelItem struct {
	Name        string  `json:"name"`
	WeightGrams float64 `json:"weight_grams"`
}

type sampleLabel struct {
	LabelType        string      `json:"label_type"`
	TotalWeightGrams *float64    `json:"total_weight_grams,omitempty"`
	Items            []labelItem `json:"items,omitempty"`
	RawLabel         string      `json:"raw_label"`
}

type options struct {
	BatchName    string
	DataDir      string
	ConfigDir    string
	COSPrefix    string
	DryRun       bool
	Force        bool
	SkipUpload   bool
	SkipExisting bool
	Stats        bool
	SampleLimit  int
	Timeout      time.Duration
}

func main() {
	opts := parseFlags()
	if opts.BatchName == "" {
		log.Fatal("--batch 不能为空")
	}
	if !opts.Stats && opts.DataDir == "" {
		log.Fatal("--data-dir 不能为空（使用 --stats 时除外）")
	}
	if opts.DataDir != "" {
		if info, err := os.Stat(opts.DataDir); err != nil || !info.IsDir() {
			log.Fatalf("--data-dir 不是有效目录: %s", opts.DataDir)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), opts.Timeout)
	defer cancel()

	cfg, err := config.Load(opts.ConfigDir)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}
	if err := database.Ping(ctx, db); err != nil {
		log.Fatalf("数据库 ping 失败: %v", err)
	}
	if cfg.Database.Schema != "" {
		if err := db.WithContext(ctx).Exec("SET search_path TO " + quoteIdent(cfg.Database.Schema)).Error; err != nil {
			log.Fatalf("设置 search_path 失败: %v", err)
		}
	}

	if opts.Stats {
		if err := runStats(ctx, db, opts); err != nil {
			log.Fatalf("统计失败: %v", err)
		}
		return
	}

	var storageClient *storage.Client
	if !opts.SkipUpload {
		storageClient = storage.New(cfg.Storage)
	}

	if err := runImport(ctx, db, storageClient, opts); err != nil {
		log.Fatalf("导入失败: %v", err)
	}
}

func parseFlags() options {
	var opts options
	flag.StringVar(&opts.BatchName, "batch", "", "批次名称，如 food_test_sanitized_20260424")
	flag.StringVar(&opts.DataDir, "data-dir", "", "批次根目录，包含图片、labels.txt、unlabeled_samples.txt")
	flag.StringVar(&opts.ConfigDir, "config-dir", ".", "backend 配置目录")
	flag.StringVar(&opts.COSPrefix, "cos-prefix", "datasets/food_test/20260424/", "COS key 前缀")
	flag.BoolVar(&opts.DryRun, "dry-run", false, "只解析和预览，不上传/不写入数据库")
	flag.BoolVar(&opts.Force, "force", false, "覆盖已存在的样本")
	flag.BoolVar(&opts.SkipUpload, "skip-upload", false, "不上传图片，仅写入数据库（图片已手动上传时可用）")
	flag.BoolVar(&opts.SkipExisting, "skip-existing", true, "跳过已存在的样本")
	flag.BoolVar(&opts.Stats, "stats", false, "仅统计数据库中该批次记录")
	flag.IntVar(&opts.SampleLimit, "sample", 0, "打印前 N 条记录详情（与 --stats 一起使用）")
	flag.DurationVar(&opts.Timeout, "timeout", 30*time.Minute, "整体超时")
	flag.Parse()

	opts.COSPrefix = strings.Trim(opts.COSPrefix, "/")
	if opts.COSPrefix != "" {
		opts.COSPrefix += "/"
	}
	return opts
}

func runImport(ctx context.Context, db *gorm.DB, storageClient *storage.Client, opts options) error {
	labels, err := parseLabels(filepath.Join(opts.DataDir, "labels.txt"))
	if err != nil {
		return fmt.Errorf("解析 labels.txt 失败: %w", err)
	}

	unlabeled, err := parseUnlabeled(filepath.Join(opts.DataDir, "unlabeled_samples.txt"))
	if err != nil {
		return fmt.Errorf("解析 unlabeled_samples.txt 失败: %w", err)
	}

	entries, err := os.ReadDir(opts.DataDir)
	if err != nil {
		return fmt.Errorf("读取数据目录失败: %w", err)
	}

	var stats struct {
		Total      int
		Labeled    int
		Unlabeled  int
		Uploaded   int
		DBInserted int
		DBSkipped  int
		DBUpdated  int
		Failed     int
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if !imageExts[ext] {
			continue
		}

		sampleName := strings.TrimSuffix(name, ext)
		stats.Total++

		label, hasLabel := labels[sampleName]
		if !hasLabel {
			if _, ok := unlabeled[sampleName]; ok {
				label = sampleLabel{LabelType: "unlabeled", RawLabel: ""}
			} else {
				label = sampleLabel{LabelType: "unlabeled", RawLabel: ""}
				log.Printf("[warn] %s 未在 labels.txt 或 unlabeled_samples.txt 中找到，标记为 unlabeled", name)
			}
		}

		status := "labeled"
		if label.LabelType == "unlabeled" {
			status = "unlabeled"
			stats.Unlabeled++
		} else {
			stats.Labeled++
		}

		absPath, _ := filepath.Abs(filepath.Join(opts.DataDir, name))

		var objectKey, imageURL string
		if !opts.SkipUpload {
			data, contentType, err := readImage(filepath.Join(opts.DataDir, name))
			if err != nil {
				log.Printf("[error] 读取图片失败 %s: %v", name, err)
				stats.Failed++
				continue
			}
			objectKey = opts.COSPrefix + opts.BatchName + "/" + name
			if opts.DryRun {
				imageURL = storageClient.BuildAccessURL("food-images", objectKey)
				log.Printf("[dry-run] 将上传 %s -> %s", name, objectKey)
			} else {
				url, err := storageClient.UploadBytes("food-images", objectKey, data, contentType)
				if err != nil {
					log.Printf("[error] 上传 COS 失败 %s: %v", name, err)
					stats.Failed++
					continue
				}
				imageURL = url
				stats.Uploaded++
			}
		}

		if opts.DryRun {
			log.Printf("[dry-run] 将写入 %s label_type=%s status=%s", sampleName, label.LabelType, status)
			continue
		}

		record := buildRecord(opts.BatchName, sampleName, name, absPath, objectKey, imageURL, label, status)

		existing, err := findExisting(ctx, db, opts.BatchName, sampleName)
		if err != nil {
			log.Printf("[error] 查询已有记录失败 %s: %v", sampleName, err)
			stats.Failed++
			continue
		}

		if existing != nil {
			if opts.Force {
				record.ID = existing.ID
				record.CreatedAt = existing.CreatedAt
				if err := db.WithContext(ctx).Save(&record).Error; err != nil {
					log.Printf("[error] 更新记录失败 %s: %v", sampleName, err)
					stats.Failed++
					continue
				}
				stats.DBUpdated++
			} else if opts.SkipExisting {
				log.Printf("[skip] %s 已存在", sampleName)
				stats.DBSkipped++
				continue
			} else {
				log.Printf("[error] %s 已存在（使用 --force 覆盖或 --skip-existing=false 报错）", sampleName)
				stats.Failed++
				continue
			}
		} else {
			if err := db.WithContext(ctx).Create(&record).Error; err != nil {
				log.Printf("[error] 插入记录失败 %s: %v", sampleName, err)
				stats.Failed++
				continue
			}
			stats.DBInserted++
		}
	}

	fmt.Printf("\n导入统计:\n")
	fmt.Printf("  图片总数: %d\n", stats.Total)
	fmt.Printf("  已标注:   %d\n", stats.Labeled)
	fmt.Printf("  未标注:   %d\n", stats.Unlabeled)
	fmt.Printf("  上传成功: %d\n", stats.Uploaded)
	fmt.Printf("  插入成功: %d\n", stats.DBInserted)
	fmt.Printf("  跳过已有: %d\n", stats.DBSkipped)
	fmt.Printf("  覆盖更新: %d\n", stats.DBUpdated)
	fmt.Printf("  失败:     %d\n", stats.Failed)
	return nil
}

func parseLabels(path string) (map[string]sampleLabel, error) {
	labels := make(map[string]sampleLabel)
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return labels, nil
		}
		return nil, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(stripBOM(scanner.Text()))
		if line == "" {
			continue
		}

		var filename, rawLabel string
		if strings.Contains(line, "|") {
			parts := strings.SplitN(line, "|", 2)
			filename = strings.TrimSpace(parts[0])
			rawLabel = strings.TrimSpace(parts[1])
		} else {
			// 形如 "sample_0001.png 134g"：第一个空格分隔文件名与重量
			fields := strings.Fields(line)
			if len(fields) == 0 {
				continue
			}
			filename = fields[0]
			if len(fields) >= 2 {
				rawLabel = strings.Join(fields[1:], " ")
			}
		}

		sampleName := strings.TrimSuffix(filename, filepath.Ext(filename))
		if rawLabel == "" {
			labels[sampleName] = sampleLabel{LabelType: "unlabeled", RawLabel: line}
			continue
		}

		// 先尝试整体作为总重
		if weight, err := parseWeight(rawLabel); err == nil {
			labels[sampleName] = sampleLabel{
				LabelType:        "total",
				TotalWeightGrams: &weight,
				RawLabel:         line,
			}
			continue
		}

		// 尝试按分号分隔的逐项
		itemStrs := strings.Split(rawLabel, ";")
		var items []labelItem
		for _, s := range itemStrs {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			kv := strings.SplitN(s, "=", 2)
			if len(kv) != 2 {
				continue
			}
			name := strings.TrimSpace(kv[0])
			weight, err := parseWeight(kv[1])
			if err != nil {
				log.Printf("[warn] 无法解析重量 %q in %s: %v", s, filename, err)
				continue
			}
			items = append(items, labelItem{Name: name, WeightGrams: weight})
		}
		if len(items) == 0 {
			labels[sampleName] = sampleLabel{LabelType: "unlabeled", RawLabel: line}
		} else {
			labels[sampleName] = sampleLabel{
				LabelType: "items",
				Items:     items,
				RawLabel:  line,
			}
		}
	}
	return labels, scanner.Err()
}

func parseWeight(s string) (float64, error) {
	s = strings.TrimSpace(s)
	if m := weightPattern.FindStringSubmatch(s); m != nil {
		return strconv.ParseFloat(m[1], 64)
	}
	return 0, fmt.Errorf("invalid weight format: %q", s)
}

func parseUnlabeled(path string) (map[string]bool, error) {
	set := make(map[string]bool)
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return set, nil
		}
		return nil, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(stripBOM(scanner.Text()))
		if line == "" {
			continue
		}
		set[strings.TrimSuffix(line, filepath.Ext(line))] = true
	}
	return set, scanner.Err()
}

func stripBOM(s string) string {
	return strings.TrimPrefix(s, "\uFEFF")
}

func readImage(path string) ([]byte, string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	contentType := http.DetectContentType(data)
	if contentType == "application/octet-stream" {
		contentType = mime.TypeByExtension(filepath.Ext(path))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	return data, contentType, nil
}

func buildRecord(batchName, sampleName, filename, sourcePath, objectKey, imageURL string, label sampleLabel, status string) do.FoodWeightLabeledSampleDO {
	itemsMap := make(map[string]float64)
	if label.LabelType == "total" && label.TotalWeightGrams != nil {
		itemsMap["__total__"] = *label.TotalWeightGrams
	} else {
		for _, it := range label.Items {
			itemsMap[it.Name] = it.WeightGrams
		}
	}

	metadata := map[string]any{
		"raw_label":   label.RawLabel,
		"imported_at": time.Now().UTC().Format(time.RFC3339),
	}

	record := do.FoodWeightLabeledSampleDO{
		ID:               uuid.New().String(),
		BatchName:        batchName,
		SampleName:       sampleName,
		OriginalFilename: filename,
		LabelType:        label.LabelType,
		Items:            itemsMap,
		Status:           status,
		SourcePath:       &sourcePath,
		Metadata:         metadata,
	}
	if objectKey != "" {
		record.ImageObjectKey = &objectKey
	}
	if imageURL != "" {
		record.ImageURL = &imageURL
	}
	if label.TotalWeightGrams != nil {
		w := *label.TotalWeightGrams
		record.TotalWeightGrams = &w
	}
	now := time.Now()
	record.CreatedAt = &now
	record.UpdatedAt = &now
	return record
}

func findExisting(ctx context.Context, db *gorm.DB, batchName, sampleName string) (*do.FoodWeightLabeledSampleDO, error) {
	var record do.FoodWeightLabeledSampleDO
	err := db.WithContext(ctx).Where("batch_name = ? AND sample_name = ?", batchName, sampleName).First(&record).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func runStats(ctx context.Context, db *gorm.DB, opts options) error {
	type statRow struct {
		BatchName string
		LabelType string
		Status    string
		Count     int64
	}
	var rows []statRow
	if err := db.WithContext(ctx).Model(&do.FoodWeightLabeledSampleDO{}).
		Select("batch_name, label_type, status, COUNT(*) as count").
		Where("batch_name = ?", opts.BatchName).
		Group("batch_name, label_type, status").
		Scan(&rows).Error; err != nil {
		return err
	}
	fmt.Printf("批次 %s 统计:\n", opts.BatchName)
	var total int64
	for _, r := range rows {
		fmt.Printf("  label_type=%s status=%s count=%d\n", r.LabelType, r.Status, r.Count)
		total += r.Count
	}
	fmt.Printf("  总计: %d\n", total)

	if opts.SampleLimit > 0 {
		var samples []do.FoodWeightLabeledSampleDO
		if err := db.WithContext(ctx).Where("batch_name = ?", opts.BatchName).
			Order("sample_name").Limit(opts.SampleLimit).Find(&samples).Error; err != nil {
			return err
		}
		fmt.Printf("\n前 %d 条记录:\n", len(samples))
		for _, s := range samples {
			url := ""
			if s.ImageURL != nil {
				url = *s.ImageURL
			}
			fmt.Printf("  %s | %s | label_type=%s | status=%s | url=%s\n", s.SampleName, s.OriginalFilename, s.LabelType, s.Status, url)
		}
	}
	return nil
}

func quoteIdent(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}
