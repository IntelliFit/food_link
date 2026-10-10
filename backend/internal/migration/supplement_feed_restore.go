package migration

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	contentsecurity "food_link/backend/internal/contentsecurity/service"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/internal/supplement/domain"
	"food_link/backend/pkg/logger"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type SupplementFeedRestoreOptions struct {
	Before     time.Time
	RunKey     string
	Apply      bool
	ExcludeIDs []string
}

type SupplementFeedRestoreReport struct {
	Apply                    bool      `json:"apply"`
	Before                   time.Time `json:"before"`
	Hidden                   int64     `json:"hidden"`
	Eligible                 int       `json:"eligible"`
	Restored                 int       `json:"restored"`
	Rejected                 int       `json:"rejected"`
	Unavailable              int       `json:"unavailable"`
	ChangedOrAlreadyRestored int       `json:"changed_or_already_restored"`
	RestoredIDs              []string  `json:"restored_ids"`
}

// RestoreSupplementFeed is an explicit data repair, never part of server startup
// or the normal schema migration. It preserves private profiles, reported posts,
// caller-supplied author hides, intake snapshots, times, and nutrition totals.
func RestoreSupplementFeed(ctx context.Context, db *gorm.DB, schema string, opts SupplementFeedRestoreOptions, check func(context.Context, string, map[string]any) error) (*SupplementFeedRestoreReport, error) {
	if opts.Before.IsZero() || opts.Before.After(time.Now()) || strings.TrimSpace(opts.RunKey) == "" {
		return nil, fmt.Errorf("恢复须指定已有记录截止时间和审计标识")
	}
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return nil, fmt.Errorf("数据库 schema 无效")
	}
	for _, id := range opts.ExcludeIDs {
		if _, err := uuid.Parse(id); err != nil {
			return nil, fmt.Errorf("排除记录 ID 无效")
		}
	}
	if opts.Apply && check == nil {
		return nil, fmt.Errorf("恢复须配置内容审核")
	}
	intakes := quoteIdent(schema) + ".supplement_intakes"
	users := quoteIdent(schema) + ".weapp_user"
	reports := quoteIdent(schema) + ".feed_reports"
	receipts := quoteIdent(schema) + ".supplement_feed_restorations"
	report := &SupplementFeedRestoreReport{Apply: opts.Apply, Before: opts.Before, RestoredIDs: []string{}}
	q := db.WithContext(ctx).Table(intakes+" AS s").Where("s.hidden_from_feed = true AND s.created_at < ?", opts.Before)
	if err := q.Count(&report.Hidden).Error; err != nil {
		return nil, err
	}
	q = q.Where("EXISTS (SELECT 1 FROM " + users + " u WHERE u.id = s.user_id AND COALESCE(u.public_records, true) = true AND COALESCE(u.openid, '') <> '')").
		Where("NOT EXISTS (SELECT 1 FROM " + reports + " r WHERE r.target_type = 'supplement_intake' AND r.target_id = s.id)")
	if len(opts.ExcludeIDs) > 0 {
		q = q.Where("s.id NOT IN ?", opts.ExcludeIDs)
	}
	var hasReceipts bool
	if err := db.WithContext(ctx).Raw("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = 'supplement_feed_restorations')", schema).Scan(&hasReceipts).Error; err != nil {
		return nil, err
	}
	if hasReceipts {
		q = q.Where("NOT EXISTS (SELECT 1 FROM " + receipts + " a WHERE a.intake_id = s.id)")
	}
	var candidates []domain.SupplementIntake
	// Do not read private notes or idempotency keys into the publication payload.
	if err := q.Select("s.id,s.user_id,s.supplement_name,s.servings,s.serving_label,s.components_snapshot,s.created_at").Order("s.created_at,s.id").Find(&candidates).Error; err != nil {
		return nil, err
	}
	report.Eligible = len(candidates)
	logger.Info(ctx, "补剂历史动态恢复范围已核对", slog.Bool("apply", opts.Apply), slog.Int64("hidden_count", report.Hidden), slog.Int("eligible_count", report.Eligible), slog.String("run_key", opts.RunKey))
	if !opts.Apply {
		return report, nil
	}
	if err := db.WithContext(ctx).Table(receipts).AutoMigrate(&migrationdo.SupplementFeedRestorationDO{}); err != nil {
		return report, err
	}
	for _, item := range candidates {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		err := check(ctx, item.UserID, map[string]any{"name": item.SupplementName, "serving_label": item.ServingLabel, "components": item.ComponentsSnapshot})
		if err != nil {
			if errors.Is(err, contentsecurity.ErrRejected) {
				report.Rejected++
			} else {
				report.Unavailable++
			}
			logger.Warn(ctx, "补剂历史动态审核未通过，保持隐藏", slog.String("intake_id", item.ID), slog.String("user_id", item.UserID))
			continue
		}
		changed := false
		err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			// Recheck visibility, snapshot, profile and reports under the intake
			// row lock. Deleted or changed candidates are never recreated.
			var current domain.SupplementIntake
			err := tx.Table(intakes).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", item.ID).Take(&current).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			if !current.HiddenFromFeed || !current.CreatedAt.Before(opts.Before) {
				return nil
			}
			var allowed int64
			if err := tx.Table(users).Where("id = ? AND COALESCE(public_records,true) = true", item.UserID).Count(&allowed).Error; err != nil {
				return err
			}
			if allowed != 1 {
				return nil
			}
			var reported int64
			if err := tx.Table(reports).Where("target_type = 'supplement_intake' AND target_id = ?", item.ID).Count(&reported).Error; err != nil {
				return err
			}
			if reported > 0 {
				return nil
			}
			// Snapshots are immutable; still compare reviewed fields defensively.
			if current.SupplementName != item.SupplementName || current.ServingLabel != item.ServingLabel || !sameSupplementComponents(current.ComponentsSnapshot, item.ComponentsSnapshot) {
				return nil
			}
			receipt := migrationdo.SupplementFeedRestorationDO{IntakeID: item.ID, RunKey: opts.RunKey, RestoredAt: time.Now()}
			insert := tx.Table(receipts).Clauses(clause.OnConflict{DoNothing: true}).Create(&receipt)
			if insert.Error != nil {
				return insert.Error
			}
			if insert.RowsAffected == 0 {
				return nil
			}
			result := tx.Table(intakes).Where("id = ? AND hidden_from_feed = true", item.ID).UpdateColumn("hidden_from_feed", false)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf("补剂恢复更新数量异常")
			}
			changed = true
			return nil
		})
		if err != nil {
			logger.Error(ctx, "恢复补剂历史动态失败", err, slog.String("intake_id", item.ID))
			return report, err
		}
		if changed {
			report.Restored++
			report.RestoredIDs = append(report.RestoredIDs, item.ID)
		} else {
			report.ChangedOrAlreadyRestored++
		}
	}
	logger.Info(ctx, "补剂历史动态恢复完成", slog.Int("restored_count", report.Restored), slog.Int("rejected_count", report.Rejected), slog.Int("unavailable_count", report.Unavailable), slog.String("run_key", opts.RunKey))
	return report, nil
}

func sameSupplementComponents(a, b []domain.Component) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
