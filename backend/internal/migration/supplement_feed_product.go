package migration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	contentsecurity "food_link/backend/internal/contentsecurity/service"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/internal/supplement/domain"
	"food_link/backend/pkg/logger"
	"gorm.io/gorm"
)

// MigrateSupplementFeedProduct adds only the optional bottle identity snapshot.
// Legacy intakes remain NULL; the explicit, moderated backfill is separate.
func MigrateSupplementFeedProduct(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	if db.WithContext(ctx).Migrator().HasColumn(&migrationdo.SupplementIntakeDO{}, "ProductSnapshot") {
		return nil
	}
	return db.WithContext(ctx).Migrator().AddColumn(&migrationdo.SupplementIntakeDO{}, "ProductSnapshot")
}

type SupplementProductBackfillReport struct {
	Apply       bool     `json:"apply"`
	Eligible    int      `json:"eligible"`
	Updated     int      `json:"updated"`
	Rejected    int      `json:"rejected"`
	Unavailable int      `json:"unavailable"`
	Changed     int      `json:"changed"`
	UpdatedIDs  []string `json:"updated_ids"`
}

// BackfillSupplementFeedProduct attaches current bottle metadata only when all
// immutable label facts match the same author's cabinet. It never republishes
// hidden/private/reported intakes or changes dosage, components or private notes.
func BackfillSupplementFeedProduct(ctx context.Context, db *gorm.DB, schema string, before time.Time, apply bool, check func(context.Context, string, map[string]any) error) (*SupplementProductBackfillReport, error) {
	if before.IsZero() || before.After(time.Now()) || (apply && check == nil) {
		return nil, fmt.Errorf("产品资料补齐须指定已有记录截止时间，执行时须配置内容审核")
	}
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("数据库 schema 无效")
	}
	intakes := quoteIdent(schema) + ".supplement_intakes"
	products := quoteIdent(schema) + ".user_supplements"
	users := quoteIdent(schema) + ".weapp_user"
	reports := quoteIdent(schema) + ".feed_reports"
	eligible := func() *gorm.DB {
		return db.WithContext(ctx).Table(intakes+" AS s").
			Joins("JOIN "+products+" p ON p.id = s.supplement_id AND p.user_id = s.user_id").
			Where("s.product_snapshot IS NULL AND s.hidden_from_feed = false AND s.created_at < ?", before).
			Where("p.status = 'active' AND p.name = s.supplement_name AND p.serving_label = s.serving_label AND p.components = s.components_snapshot").
			Where("p.created_at <= s.created_at AND p.updated_at <= s.created_at").
			Where("(btrim(p.brand) <> '' OR COALESCE(p.image_url, '') <> '' OR p.image_urls <> '[]'::jsonb)").
			Where("EXISTS (SELECT 1 FROM " + users + " u WHERE u.id = s.user_id AND COALESCE(u.public_records,true) = true AND COALESCE(u.openid,'') <> '')").
			Where("NOT EXISTS (SELECT 1 FROM " + reports + " r WHERE r.target_type = 'supplement_intake' AND r.target_id = s.id)")
	}
	type candidate struct {
		ID                 string
		UserID             string
		SupplementName     string
		ServingLabel       string
		ComponentsSnapshot []domain.Component `gorm:"serializer:json"`
		Brand              string
		ImageURL           *string
		ImageURLs          []string `gorm:"serializer:json"`
	}
	var candidates []candidate
	if err := eligible().Select("s.id,s.user_id,s.supplement_name,s.serving_label,s.components_snapshot,p.brand,p.image_url,p.image_urls").Order("s.created_at,s.id").Find(&candidates).Error; err != nil {
		return nil, err
	}
	report := &SupplementProductBackfillReport{Apply: apply, Eligible: len(candidates), UpdatedIDs: []string{}}
	logger.Info(ctx, "补剂动态产品资料补齐范围已核对", slog.Bool("apply", apply), slog.Int("eligible_count", len(candidates)))
	if !apply {
		return report, nil
	}
	for _, item := range candidates {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		images := append([]string{}, item.ImageURLs...)
		if len(images) == 0 && item.ImageURL != nil && strings.TrimSpace(*item.ImageURL) != "" {
			images = []string{*item.ImageURL}
		}
		product := domain.ProductSnapshot{Brand: strings.TrimSpace(item.Brand), ImageURLs: images, Source: "cabinet_match"}
		err := check(ctx, item.UserID, map[string]any{"name": item.SupplementName, "serving_label": item.ServingLabel, "components": item.ComponentsSnapshot, "product": product})
		if err != nil {
			if errors.Is(err, contentsecurity.ErrRejected) {
				report.Rejected++
			} else {
				report.Unavailable++
			}
			logger.Warn(ctx, "补剂动态产品资料审核未通过，保持原记录", slog.String("intake_id", item.ID), slog.String("user_id", item.UserID))
			continue
		}
		body, err := json.Marshal(product)
		if err != nil {
			return report, err
		}
		originalImages, err := json.Marshal(item.ImageURLs)
		if err != nil {
			return report, err
		}
		// Recheck both label and product identity in the atomic UPDATE; a cabinet
		// edit, hide, report, deletion or competing backfill invalidates the item.
		match := eligible().Select("s.id").Where("s.id = ? AND p.brand = ? AND p.image_url IS NOT DISTINCT FROM ? AND p.image_urls = ?::jsonb", item.ID, item.Brand, item.ImageURL, string(originalImages))
		result := db.WithContext(ctx).Table(intakes).Where("id IN (?) AND product_snapshot IS NULL AND hidden_from_feed = false", match).UpdateColumn("product_snapshot", gorm.Expr("?::jsonb", string(body)))
		if result.Error != nil {
			logger.Error(ctx, "补齐补剂动态产品资料失败", result.Error, slog.String("intake_id", item.ID))
			return report, result.Error
		}
		if result.RowsAffected == 1 {
			report.Updated++
			report.UpdatedIDs = append(report.UpdatedIDs, item.ID)
		} else {
			report.Changed++
		}
	}
	logger.Info(ctx, "补剂动态产品资料补齐完成", slog.Int("updated_count", report.Updated), slog.Int("rejected_count", report.Rejected), slog.Int("unavailable_count", report.Unavailable), slog.Int("changed_count", report.Changed))
	return report, nil
}
