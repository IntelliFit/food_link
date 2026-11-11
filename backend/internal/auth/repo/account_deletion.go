package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type AccountDeletion = migrationdo.AccountDeletionDO

var ErrDeletionUnavailable = &commonerrors.AppError{Code: 20020, Message: "注销服务暂不可用，请稍后重试", HTTPStatus: 503}
var ErrAccountDeleting = &commonerrors.AppError{Code: 20021, Message: "账号正在注销，请查看注销状态", HTTPStatus: 403}
var ErrDeletionTooLate = &commonerrors.AppError{Code: 20022, Message: "已开始永久清理，无法撤销", HTTPStatus: 409}
var ErrDeletionSession = &commonerrors.AppError{Code: 20023, Message: "请重新登录验证身份", HTTPStatus: 401}

func (r *UserRepo) AccountDeletionEnabled() bool { return r.db.Migrator().HasTable(&AccountDeletion{}) }

func (r *UserRepo) DeletionStatus(ctx context.Context, id string) (*AccountDeletion, error) {
	var d AccountDeletion
	err := r.db.WithContext(ctx).Where("user_id = ?", id).First(&d).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &d, err
}

// Fail closed when the dedicated migration has not been applied.
func (r *UserRepo) CheckAccountAccess(ctx context.Context, id string, issued int64, path, method string) error {
	d, err := r.DeletionStatus(ctx, id)
	if err != nil {
		return ErrDeletionUnavailable
	}
	if d != nil && issued <= d.RevokedBefore {
		return ErrDeletionSession
	}
	statusRoute := path == "/api/user/account/deletion" && method == "GET"
	cancelRoute := path == "/api/user/account/deletion/cancel" && method == "POST"
	if d != nil && d.State != "cancelled" {
		if statusRoute || cancelRoute {
			return nil
		}
		return ErrAccountDeleting
	}
	var count int64
	if err := r.db.WithContext(ctx).Table("weapp_user").Where("id = ?", id).Count(&count).Error; err != nil {
		return ErrDeletionUnavailable
	}
	if count == 0 {
		return ErrDeletionSession
	}
	return nil
}

type deletionSnapshot struct {
	Privacy     map[string]any    `json:"privacy"`
	Foods       map[string]string `json:"foods"`
	CustomFoods map[string]string `json:"custom_foods"`
}

func (r *UserRepo) RequestDeletion(ctx context.Context, id string, days int, now time.Time) (*AccountDeletion, error) {
	if days != 0 && days != 7 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请选择立即注销或7天冷静期", HTTPStatus: 400}
	}
	var out AccountDeletion
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&user).Error; err != nil {
			return err
		}
		var old AccountDeletion
		err := tx.Where("user_id = ?", id).First(&old).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil && old.State != "cancelled" {
			out = old
			return nil
		}
		snap := deletionSnapshot{Privacy: map[string]any{}, Foods: map[string]string{}, CustomFoods: map[string]string{}}
		for _, key := range []string{"searchable", "public_records", "friends_can_view_records", "public_favorite_recipes"} {
			if !tx.Migrator().HasColumn("weapp_user", key) {
				continue
			}
			var value *bool
			if err := tx.Table("weapp_user").Select(key).Where("id = ?", id).Scan(&value).Error; err != nil {
				return err
			}
			snap.Privacy[key] = value
		}
		for _, item := range []struct {
			table, column string
			dest          map[string]string
		}{{"public_food_library", "status", snap.Foods}, {"user_custom_foods", "public_status", snap.CustomFoods}} {
			if !tx.Migrator().HasColumn(item.table, item.column) {
				continue
			}
			var rows []struct{ ID, Value string }
			if err := tx.Table(item.table).Select("id, "+item.column+" AS value").Where("user_id = ?", id).Scan(&rows).Error; err != nil {
				return err
			}
			for _, row := range rows {
				item.dest[row.ID] = row.Value
			}
			if err := tx.Table(item.table).Where("user_id = ?", id).Update(item.column, "account_deletion").Error; err != nil {
				return err
			}
		}
		privacy := map[string]any{}
		for k := range snap.Privacy {
			privacy[k] = false
		}
		if len(privacy) > 0 {
			if err := tx.Table("weapp_user").Where("id = ?", id).Updates(privacy).Error; err != nil {
				return err
			}
		}
		data, err := json.Marshal(snap)
		if err != nil {
			return err
		}
		// Stop queued work before the write guard takes effect, so a suspended
		// account cannot sit at the head of a shared worker queue.
		for _, job := range []struct{ table, state string }{{"analysis_tasks", "failed"}, {"food_expiry_notification_jobs", "cancelled"}, {"push_deliveries", "cancelled"}} {
			if !tx.Migrator().HasColumn(job.table, "status") {
				continue
			}
			updates := map[string]any{"status": job.state}
			if tx.Migrator().HasColumn(job.table, "updated_at") {
				updates["updated_at"] = now
			}
			if job.table == "analysis_tasks" && tx.Migrator().HasColumn(job.table, "error_message") {
				updates["error_message"] = "账号已申请注销，未完成的识别已停止"
			}
			if err := tx.Table(job.table).Where("user_id = ? AND status IN ?", id, []string{"pending", "processing", "queued", "retrying"}).Updates(updates).Error; err != nil {
				return err
			}
		}
		out = AccountDeletion{UserID: id, State: "pending", RequestedAt: now, ExecuteAt: now.Add(time.Duration(days) * 24 * time.Hour), RevokedBefore: now.UnixNano(), Snapshot: string(data)}
		return tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&out).Error
	})
	return &out, err
}

func (r *UserRepo) CancelDeletion(ctx context.Context, id string, now time.Time) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The user lock is also taken by the worker and request path.
		var user User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&user).Error; err != nil {
			return ErrDeletionTooLate
		}
		var d AccountDeletion
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", id).First(&d).Error; err != nil {
			return err
		}
		if d.State == "cancelled" {
			return nil
		}
		if d.State != "pending" || !now.Before(d.ExecuteAt) {
			return ErrDeletionTooLate
		}
		if err := tx.Model(&d).Updates(map[string]any{"state": "cancelled", "revoked_before": now.UnixNano()}).Error; err != nil {
			return err
		}
		var snap deletionSnapshot
		if err := json.Unmarshal([]byte(d.Snapshot), &snap); err != nil {
			return err
		}
		if len(snap.Privacy) > 0 {
			if err := tx.Table("weapp_user").Where("id = ?", id).Updates(snap.Privacy).Error; err != nil {
				return err
			}
		}
		for _, item := range []struct {
			table, column string
			values        map[string]string
		}{{"public_food_library", "status", snap.Foods}, {"user_custom_foods", "public_status", snap.CustomFoods}} {
			for foodID, status := range item.values {
				if err := tx.Table(item.table).Where("id = ? AND user_id = ? AND "+item.column+" = ?", foodID, id, "account_deletion").Update(item.column, status).Error; err != nil {
					return err
				}
			}
		}
		return tx.Model(&d).Updates(map[string]any{"state": "cancelled", "snapshot": "{}", "revoked_before": now.UnixNano()}).Error
	})
}

func (r *UserRepo) DueDeletions(ctx context.Context, now time.Time) ([]AccountDeletion, error) {
	var rows []AccountDeletion
	err := r.db.WithContext(ctx).Where("state IN ? AND execute_at <= ?", []string{"pending", "cleaning"}, now).Order("execute_at").Limit(20).Find(&rows).Error
	return rows, err
}

// The persisted cleaning state is committed before any external object removal.
func (r *UserRepo) BeginDeletion(ctx context.Context, id string, now time.Time) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&user).Error; err != nil {
			return err
		}
		result := tx.Model(&AccountDeletion{}).Where("user_id = ? AND state IN ? AND execute_at <= ?", id, []string{"pending", "cleaning"}, now).Updates(map[string]any{"state": "cleaning", "attempts": gorm.Expr("attempts + 1")})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrDeletionTooLate
		}
		return nil
	})
}

func (r *UserRepo) FinishDeletion(ctx context.Context, id string, now time.Time, retentionDays int) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&user).Error; err != nil {
			return err
		}
		var d AccountDeletion
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND state = ?", id, "cleaning").First(&d).Error; err != nil {
			return err
		}
		if err := retainDeletionEvidence(tx, id, now, retentionDays); err != nil {
			return err
		}
		if err := deleteAccountOwnedData(tx, id); err != nil {
			return err
		}
		if err := deleteAdditionalAccountData(tx, id); err != nil {
			return err
		}
		if err := tx.Where("id = ?", id).Delete(&User{}).Error; err != nil {
			return err
		}
		return tx.Model(&d).Updates(map[string]any{"state": "completed", "completed_at": now, "snapshot": "{}"}).Error
	})
}

func retainDeletionEvidence(tx *gorm.DB, id string, now time.Time, days int) error {
	for _, item := range []struct {
		table, where string
		fields       []string
	}{
		{"pro_membership_payment_records", "user_id = ?", []string{"id", "order_no", "plan_code", "amount", "currency", "status", "pay_channel", "wx_transaction_id", "paid_at", "refunded_at", "created_at"}},
		{"private_message_reports", "reporter_user_id = ? OR reported_user_id = ?", []string{"id", "message_id", "reason", "status", "created_at"}},
		{"feed_reports", "reporter_user_id = ? OR reported_user_id = ?", []string{"id", "target_type", "target_id", "reason", "status", "created_at"}},
	} {
		if !tableExists(tx, item.table) {
			continue
		}
		fields := []string{}
		for _, f := range item.fields {
			if tx.Migrator().HasColumn(item.table, f) {
				fields = append(fields, f)
			}
		}
		args := []any{id}
		if item.table != "pro_membership_payment_records" {
			args = append(args, id)
		}
		var rows []map[string]any
		if err := tx.Table(item.table).Select(fields).Where(item.where, args...).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) > 0 && days <= 0 {
			return fmt.Errorf("account deletion evidence retention policy is not configured")
		}
		for _, row := range rows {
			payload, err := json.Marshal(row)
			if err != nil {
				return err
			}
			record := migrationdo.AccountDeletionRetainedDO{ID: fmt.Sprintf("%s:%v", item.table, row["id"]), Kind: item.table, Payload: string(payload), DeleteAfter: now.AddDate(0, 0, days)}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&record).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *UserRepo) ValidateDeletionEvidencePolicy(ctx context.Context, id string, days int) error {
	if days > 0 {
		return nil
	}
	for _, table := range []string{"pro_membership_payment_records", "private_message_reports", "feed_reports"} {
		if !tableExists(r.db, table) {
			continue
		}
		q := r.db.WithContext(ctx).Table(table)
		if table == "pro_membership_payment_records" {
			q = q.Where("user_id = ?", id)
		} else {
			q = q.Where("reporter_user_id = ? OR reported_user_id = ?", id, id)
		}
		var count int64
		if err := q.Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("账号注销必要凭证保留期限尚未配置")
		}
	}
	return nil
}

func deleteAdditionalAccountData(tx *gorm.DB, id string) error {
	for _, table := range []string{"user_sleep_records", "user_membership_grants", "user_vouchers", "push_devices", "push_reminder_preferences", "push_deliveries", "product_update_acknowledgements", "campus_collector_applications", "campus_collector_scopes", "campus_canteen_applications", "packaged_food_correction_submissions", "food_nutrition_contributions", "critical_samples_weapp"} {
		if tx.Migrator().HasColumn(table, "user_id") {
			if err := deleteFromTableIfExists(tx, table, "user_id = ?", id); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *UserRepo) PurgeDeletionReceipts(ctx context.Context, now time.Time) error {
	if err := r.db.WithContext(ctx).Where("delete_after <= ?", now).Delete(&migrationdo.AccountDeletionRetainedDO{}).Error; err != nil {
		return err
	}
	return r.db.WithContext(ctx).Where("state = ? AND completed_at < ?", "completed", now.AddDate(0, 0, -30)).Delete(&AccountDeletion{}).Error
}

func (r *UserRepo) WithDeletionLease(ctx context.Context, run func() error) error {
	return r.db.WithContext(ctx).Connection(func(conn *gorm.DB) error {
		var acquired bool
		if err := conn.Raw("SELECT pg_try_advisory_lock(hashtext(current_database() || ':' || current_schema() || ':account-deletion'))").Scan(&acquired).Error; err != nil {
			return err
		}
		if !acquired {
			return nil
		}
		defer func() {
			unlockCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			conn.WithContext(unlockCtx).Exec("SELECT pg_advisory_unlock(hashtext(current_database() || ':' || current_schema() || ':account-deletion'))")
		}()
		return run()
	})
}
