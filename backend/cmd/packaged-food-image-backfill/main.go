package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"food_link/backend/pkg/storage"

	"github.com/spf13/viper"
	"gorm.io/gorm"
)

type reviewRow struct {
	Index int
	ID    string
	Name  string
}

type resultRow struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Key         string `json:"key"`
	AccessURL   string `json:"access_url"`
	Status      string `json:"status"`
	Reason      string `json:"reason,omitempty"`
	Uploaded    bool   `json:"uploaded"`
	DBUpdated   bool   `json:"db_updated"`
	ImageBytes  int    `json:"image_bytes"`
	ContentType string `json:"content_type"`
}

var idCellPattern = regexp.MustCompile("`([0-9a-fA-F-]{36})`")

func main() {
	configFile := flag.String("config-file", "config.yaml", "backend config YAML file")
	markdown := flag.String("markdown", "tmp/packaged-food-empty-image-review.md", "review markdown path")
	imageDir := flag.String("image-dir", "tmp", "directory containing <food_id>.jpg files")
	keyPrefix := flag.String("key-prefix", "packaged-food/backfill", "COS object key prefix")
	apply := flag.Bool("apply", false, "upload images and update database")
	forceUpdateExisting := flag.Bool("force-update-existing", false, "replace source_image_urls even when it already has values")
	timeout := flag.Duration("timeout", 5*time.Minute, "overall timeout")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	cfg, err := loadConfig(*configFile)
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
		if err := db.WithContext(ctx).Exec("SET search_path TO " + cfg.Database.Schema).Error; err != nil {
			log.Fatalf("设置数据库 schema 失败: %v", err)
		}
	}

	rows, err := parseReviewMarkdown(*markdown)
	if err != nil {
		log.Fatalf("读取审核清单失败: %v", err)
	}
	storageClient := storage.New(cfg.Storage)
	results := make([]resultRow, 0, len(rows))
	for _, row := range rows {
		result := processRow(ctx, db, storageClient, row, *imageDir, *keyPrefix, *apply, *forceUpdateExisting)
		results = append(results, result)
	}

	summary := map[string]any{
		"apply":   *apply,
		"total":   len(results),
		"results": results,
	}
	encoded, err := json.MarshalIndent(summary, "", "  ")
	if err != nil {
		log.Fatalf("编码结果失败: %v", err)
	}
	fmt.Println(string(encoded))
}

func loadConfig(path string) (*config.Config, error) {
	v := viper.New()
	v.SetConfigFile(path)
	v.SetConfigType("yaml")
	var cfg config.Config
	if err := v.ReadInConfig(); err != nil {
		return nil, err
	}
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, err
	}
	if cfg.Database.Host == "" || cfg.Database.Name == "" || cfg.Database.User == "" {
		return nil, fmt.Errorf("database config is incomplete in %s", path)
	}
	if cfg.Database.Port == 0 {
		cfg.Database.Port = 5432
	}
	if strings.TrimSpace(cfg.Database.SSLMode) == "" {
		cfg.Database.SSLMode = "disable"
	}
	if strings.TrimSpace(cfg.Database.Schema) == "" {
		cfg.Database.Schema = "public"
	}
	if cfg.Storage.COSRegion == "" || cfg.Storage.COSSecretID == "" || cfg.Storage.COSSecretKey == "" || cfg.Storage.COSFoodImagesBucket == "" {
		return nil, fmt.Errorf("food-images COS config is incomplete in %s", path)
	}
	return &cfg, nil
}

func parseReviewMarkdown(path string) ([]reviewRow, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(string(data), "\n")
	rows := []reviewRow{}
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "|") {
			continue
		}
		cells := splitMarkdownRow(line)
		if len(cells) != 11 || !isDigits(cells[0]) {
			continue
		}
		match := idCellPattern.FindStringSubmatch(cells[1])
		if len(match) != 2 {
			return nil, fmt.Errorf("第 %s 行无法解析食品 ID: %s", cells[0], cells[1])
		}
		var index int
		if _, err := fmt.Sscanf(cells[0], "%d", &index); err != nil {
			return nil, fmt.Errorf("解析序号失败 %q: %w", cells[0], err)
		}
		rows = append(rows, reviewRow{
			Index: index,
			ID:    strings.ToLower(match[1]),
			Name:  strings.TrimSpace(cells[2]),
		})
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("未在 %s 中解析到审核行", path)
	}
	return rows, nil
}

func splitMarkdownRow(line string) []string {
	text := strings.TrimSpace(line)
	text = strings.TrimPrefix(text, "|")
	text = strings.TrimSuffix(text, "|")
	parts := strings.Split(text, "|")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

func isDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func processRow(ctx context.Context, db *gorm.DB, storageClient *storage.Client, row reviewRow, imageDir, keyPrefix string, apply bool, forceUpdateExisting bool) resultRow {
	key := strings.Trim(strings.TrimSpace(keyPrefix), "/") + "/" + row.ID + "/" + row.ID + ".jpg"
	accessURL := storageClient.BuildAccessURL("food-images", key)
	result := resultRow{
		ID:        row.ID,
		Name:      row.Name,
		Key:       key,
		AccessURL: accessURL,
		Status:    "dry_run",
	}

	hasImage, err := packagedFoodHasImage(ctx, db, row.ID)
	if err != nil {
		result.Status = "error"
		result.Reason = err.Error()
		return result
	}
	if hasImage && !forceUpdateExisting {
		result.Status = "skipped"
		result.Reason = "source_image_urls already has value"
		return result
	}

	imagePath := filepath.Join(imageDir, row.ID+".jpg")
	data, err := os.ReadFile(imagePath)
	if err != nil {
		result.Status = "error"
		result.Reason = err.Error()
		return result
	}
	result.ImageBytes = len(data)
	result.ContentType = http.DetectContentType(data)
	if result.ContentType == "" || result.ContentType == "application/octet-stream" {
		result.ContentType = "image/jpeg"
	}
	if !apply {
		return result
	}

	uploadedURL, err := storageClient.UploadBytes("food-images", key, data, result.ContentType)
	if err != nil {
		result.Status = "error"
		result.Reason = err.Error()
		return result
	}
	result.Uploaded = true
	if strings.TrimSpace(uploadedURL) != "" {
		result.AccessURL = uploadedURL
	}

	updated, err := updatePackagedFoodImage(ctx, db, row.ID, result.AccessURL, forceUpdateExisting)
	if err != nil {
		result.Status = "error"
		result.Reason = err.Error()
		return result
	}
	if !updated {
		result.Status = "skipped"
		result.Reason = "row missing or source_image_urls became non-empty"
		return result
	}
	result.DBUpdated = true
	result.Status = "updated"
	return result
}

func packagedFoodHasImage(ctx context.Context, db *gorm.DB, id string) (bool, error) {
	var count int64
	err := db.WithContext(ctx).Raw(`
SELECT COUNT(*)::bigint
FROM packaged_food_library
WHERE id = ?
  AND EXISTS (
	  SELECT 1
	  FROM jsonb_array_elements_text(COALESCE(source_image_urls, '[]'::jsonb)) AS image_url
	  WHERE NULLIF(trim(image_url), '') IS NOT NULL
  )
`, id).Scan(&count).Error
	return count > 0, err
}

func updatePackagedFoodImage(ctx context.Context, db *gorm.DB, id string, value string, force bool) (bool, error) {
	query := `
UPDATE packaged_food_library
SET source_image_urls = to_jsonb(ARRAY[?]::text[]),
    updated_at = NOW()
WHERE id = ?`
	args := []any{value, id}
	if !force {
		query += `
  AND NOT EXISTS (
	  SELECT 1
	  FROM jsonb_array_elements_text(COALESCE(source_image_urls, '[]'::jsonb)) AS image_url
	  WHERE NULLIF(trim(image_url), '') IS NOT NULL
  )`
	}
	result := db.WithContext(ctx).Exec(query, args...)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}
