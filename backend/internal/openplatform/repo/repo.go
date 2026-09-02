package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/openplatform/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInvalidCredential   = errors.New("invalid open api credential")
	ErrAppInactive         = errors.New("open api app is inactive")
	ErrInsufficientBalance = errors.New("insufficient open api balance")
	ErrIdempotencyConflict = errors.New("idempotency key was used for another operation")
	ErrReservationNotFound = errors.New("open api reservation not found")
)

type Repository struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Authenticate(ctx context.Context, secretHash string) (*domain.Principal, error) {
	var key domain.APIKey
	err := r.db.WithContext(ctx).
		Where("secret_hash = ? AND status = ?", secretHash, domain.KeyStatusActive).
		First(&key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrInvalidCredential
	}
	if err != nil {
		return nil, err
	}
	if key.ExpiresAt != nil && !key.ExpiresAt.After(time.Now()) {
		return nil, ErrInvalidCredential
	}

	var app domain.App
	err = r.db.WithContext(ctx).Where("id = ?", key.AppID).First(&app).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrInvalidCredential
	}
	if err != nil {
		return nil, err
	}
	if app.Status != domain.AppStatusActive {
		return nil, ErrAppInactive
	}

	now := time.Now()
	_ = r.db.WithContext(ctx).Model(&domain.APIKey{}).
		Where("id = ?", key.ID).
		Update("last_used_at", now).Error

	scopes := make(map[string]struct{}, len(key.Scopes))
	for _, scope := range key.Scopes {
		if scope != "" {
			scopes[scope] = struct{}{}
		}
	}
	return &domain.Principal{App: app, KeyID: key.ID, Scopes: scopes}, nil
}

type ReservationResult struct {
	Request   domain.Request
	Duplicate bool
	Balance   int64
}

func (r *Repository) Reserve(ctx context.Context, appID, idempotencyKey, operation string, costUnits int64, metadata map[string]any) (ReservationResult, error) {
	result := ReservationResult{}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var app domain.App
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", appID).First(&app).Error; err != nil {
			return err
		}
		if app.Status != domain.AppStatusActive {
			return ErrAppInactive
		}

		var existing domain.Request
		err := tx.Where("app_id = ? AND idempotency_key = ?", appID, idempotencyKey).First(&existing).Error
		if err == nil {
			if existing.Operation != operation {
				return ErrIdempotencyConflict
			}
			result = ReservationResult{Request: existing, Duplicate: true, Balance: app.BalanceUnits}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if costUnits <= 0 {
			return fmt.Errorf("cost units must be positive")
		}
		if app.BalanceUnits < costUnits {
			return ErrInsufficientBalance
		}

		now := time.Now()
		request := domain.Request{
			ID:             uuid.NewString(),
			AppID:          appID,
			IdempotencyKey: idempotencyKey,
			Operation:      operation,
			Status:         domain.RequestStatusReserved,
			CostUnits:      costUnits,
			Metadata:       metadata,
			CreatedAt:      &now,
			UpdatedAt:      &now,
		}
		if request.Metadata == nil {
			request.Metadata = map[string]any{}
		}
		if err := tx.Create(&request).Error; err != nil {
			return err
		}

		newBalance := app.BalanceUnits - costUnits
		if err := tx.Model(&domain.App{}).Where("id = ?", app.ID).Updates(map[string]any{
			"balance_units": newBalance,
			"updated_at":    now,
		}).Error; err != nil {
			return err
		}
		ledger := domain.UsageLedger{
			ID:           uuid.NewString(),
			AppID:        app.ID,
			RequestID:    &request.ID,
			EntryType:    "analysis_reserve",
			DeltaUnits:   -costUnits,
			BalanceAfter: newBalance,
			ReferenceKey: "reserve:" + request.ID,
			Description:  "预留食物分析 API 点数",
			Metadata:     metadata,
			CreatedAt:    &now,
		}
		if ledger.Metadata == nil {
			ledger.Metadata = map[string]any{}
		}
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}
		result = ReservationResult{Request: request, Balance: newBalance}
		return nil
	})
	return result, err
}

func (r *Repository) MarkSubmitted(ctx context.Context, requestID, taskID string) error {
	now := time.Now()
	result := r.db.WithContext(ctx).Model(&domain.Request{}).
		Where("id = ? AND status = ?", requestID, domain.RequestStatusReserved).
		Updates(map[string]any{
			"task_id":       taskID,
			"status":        domain.RequestStatusSubmitted,
			"error_message": nil,
			"updated_at":    now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrReservationNotFound
	}
	return nil
}

func (r *Repository) Refund(ctx context.Context, requestID, reason string) (int64, bool, error) {
	var balance int64
	refunded := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var request domain.Request
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", requestID).First(&request).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrReservationNotFound
			}
			return err
		}
		var app domain.App
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", request.AppID).First(&app).Error; err != nil {
			return err
		}
		balance = app.BalanceUnits
		if request.Status == domain.RequestStatusRefunded {
			return nil
		}
		if request.Status != domain.RequestStatusReserved && request.Status != domain.RequestStatusSubmitted && request.Status != domain.RequestStatusFailed {
			return nil
		}

		now := time.Now()
		balance = app.BalanceUnits + request.CostUnits
		if err := tx.Model(&domain.App{}).Where("id = ?", app.ID).Updates(map[string]any{
			"balance_units": balance,
			"updated_at":    now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.Request{}).Where("id = ?", request.ID).Updates(map[string]any{
			"status":        domain.RequestStatusRefunded,
			"error_message": reason,
			"updated_at":    now,
		}).Error; err != nil {
			return err
		}
		ledger := domain.UsageLedger{
			ID:           uuid.NewString(),
			AppID:        app.ID,
			RequestID:    &request.ID,
			EntryType:    "analysis_refund",
			DeltaUnits:   request.CostUnits,
			BalanceAfter: balance,
			ReferenceKey: "refund:" + request.ID,
			Description:  "退还失败食物分析 API 点数",
			Metadata:     map[string]any{"reason": reason},
			CreatedAt:    &now,
		}
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}
		refunded = true
		return nil
	})
	return balance, refunded, err
}

func (r *Repository) FindRequestByTask(ctx context.Context, appID, taskID string) (*domain.Request, error) {
	var request domain.Request
	err := r.db.WithContext(ctx).Where("app_id = ? AND task_id = ?", appID, taskID).First(&request).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &request, err
}

func (r *Repository) FindRefundCandidates(ctx context.Context, reservedBefore time.Time, limit int) ([]domain.Request, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var requests []domain.Request
	err := r.db.WithContext(ctx).
		Table("open_api_requests AS r").
		Select("r.*").
		Joins("LEFT JOIN analysis_tasks AS t ON t.id = r.task_id").
		Where("(r.status = ? AND t.status IN ?) OR (r.status = ? AND r.created_at < ?)",
			domain.RequestStatusSubmitted, []string{"failed", "cancelled", "timed_out", "violated"},
			domain.RequestStatusReserved, reservedBefore).
		Order("r.created_at ASC").
		Limit(limit).
		Find(&requests).Error
	return requests, err
}

// TryReconciliationLeadership keeps one PostgreSQL session advisory lock for
// the full reconciliation loop, so only one API pod scans/refunds at a time.
func (r *Repository) TryReconciliationLeadership(ctx context.Context, fn func(context.Context) error) (bool, error) {
	if fn == nil {
		return false, errors.New("open api reconciliation function is required")
	}
	if r.db.Dialector.Name() != "postgres" {
		return true, fn(ctx)
	}
	const lockKey = "food-link:open-api-reconciliation"
	acquired := false
	err := r.db.WithContext(ctx).Connection(func(connection *gorm.DB) error {
		if err := connection.Raw("SELECT pg_try_advisory_lock(hashtextextended(?, 0))", lockKey).Scan(&acquired).Error; err != nil {
			return err
		}
		if !acquired {
			return nil
		}
		defer func() {
			unlockDB := connection.Session(&gorm.Session{NewDB: true}).WithContext(context.Background())
			_ = unlockDB.Exec("SELECT pg_advisory_unlock(hashtextextended(?, 0))", lockKey).Error
		}()
		return fn(ctx)
	})
	return acquired, err
}

func (r *Repository) TopUp(ctx context.Context, appID string, units int64, referenceKey, description string, metadata map[string]any) (int64, bool, error) {
	var balance int64
	created := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing domain.UsageLedger
		err := tx.Where("reference_key = ?", referenceKey).First(&existing).Error
		if err == nil {
			if existing.AppID != appID {
				return ErrIdempotencyConflict
			}
			balance = existing.BalanceAfter
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var app domain.App
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", appID).First(&app).Error; err != nil {
			return err
		}
		if units <= 0 {
			return fmt.Errorf("top up units must be positive")
		}
		now := time.Now()
		balance = app.BalanceUnits + units
		if err := tx.Model(&domain.App{}).Where("id = ?", app.ID).Updates(map[string]any{
			"balance_units": balance,
			"updated_at":    now,
		}).Error; err != nil {
			return err
		}
		ledger := domain.UsageLedger{
			ID:           uuid.NewString(),
			AppID:        app.ID,
			EntryType:    "top_up",
			DeltaUnits:   units,
			BalanceAfter: balance,
			ReferenceKey: referenceKey,
			Description:  description,
			Metadata:     metadata,
			CreatedAt:    &now,
		}
		if ledger.Metadata == nil {
			ledger.Metadata = map[string]any{}
		}
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	return balance, created, err
}

func (r *Repository) CreateAppAndKey(ctx context.Context, app *domain.App, key *domain.APIKey, user *authrepo.User, initialUnits int64) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		if user.ID == "" {
			user.ID = uuid.NewString()
		}
		if err := tx.Create(user).Error; err != nil {
			return err
		}
		if app.ID == "" {
			app.ID = uuid.NewString()
		}
		app.ServiceUserID = user.ID
		app.BalanceUnits = initialUnits
		app.Status = domain.AppStatusActive
		app.CreatedAt = &now
		app.UpdatedAt = &now
		if err := tx.Create(app).Error; err != nil {
			return err
		}
		if key.ID == "" {
			key.ID = uuid.NewString()
		}
		key.AppID = app.ID
		key.Status = domain.KeyStatusActive
		key.CreatedAt = &now
		key.UpdatedAt = &now
		if err := tx.Create(key).Error; err != nil {
			return err
		}
		if initialUnits > 0 {
			ledger := domain.UsageLedger{
				ID:           uuid.NewString(),
				AppID:        app.ID,
				EntryType:    "promotional_grant",
				DeltaUnits:   initialUnits,
				BalanceAfter: initialUnits,
				ReferenceKey: "initial:" + app.ID,
				Description:  "开放平台封闭测试赠送点数",
				Metadata:     map[string]any{},
				CreatedAt:    &now,
			}
			if err := tx.Create(&ledger).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) ListAppsByOwner(ctx context.Context, ownerUserID string) ([]domain.App, error) {
	var apps []domain.App
	err := r.db.WithContext(ctx).
		Where("owner_user_id = ?", ownerUserID).
		Order("created_at DESC").
		Find(&apps).Error
	return apps, err
}

func (r *Repository) GetOwnedApp(ctx context.Context, ownerUserID, appID string) (*domain.App, error) {
	var app domain.App
	err := r.db.WithContext(ctx).Where("id = ? AND owner_user_id = ?", appID, ownerUserID).First(&app).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &app, err
}

func (r *Repository) ListKeys(ctx context.Context, appID string) ([]domain.APIKey, error) {
	var keys []domain.APIKey
	err := r.db.WithContext(ctx).Where("app_id = ?", appID).Order("created_at DESC").Find(&keys).Error
	return keys, err
}

func (r *Repository) CreateKey(ctx context.Context, key *domain.APIKey) error {
	now := time.Now()
	if key.ID == "" {
		key.ID = uuid.NewString()
	}
	key.Status = domain.KeyStatusActive
	key.CreatedAt = &now
	key.UpdatedAt = &now
	return r.db.WithContext(ctx).Create(key).Error
}

func (r *Repository) RevokeKey(ctx context.Context, appID, keyID string) (bool, error) {
	result := r.db.WithContext(ctx).Model(&domain.APIKey{}).
		Where("id = ? AND app_id = ? AND status = ?", keyID, appID, domain.KeyStatusActive).
		Updates(map[string]any{"status": domain.KeyStatusRevoked, "updated_at": time.Now()})
	return result.RowsAffected > 0, result.Error
}

func (r *Repository) ListLedger(ctx context.Context, appID string, limit int) ([]domain.UsageLedger, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var entries []domain.UsageLedger
	err := r.db.WithContext(ctx).Where("app_id = ?", appID).Order("created_at DESC").Limit(limit).Find(&entries).Error
	return entries, err
}

func (r *Repository) ListActivePackages(ctx context.Context) ([]domain.CreditPackage, error) {
	var packages []domain.CreditPackage
	err := r.db.WithContext(ctx).Where("is_active = ?", true).Order("sort_order ASC, units ASC").Find(&packages).Error
	return packages, err
}

func (r *Repository) GetActivePackage(ctx context.Context, code string) (*domain.CreditPackage, error) {
	var creditPackage domain.CreditPackage
	err := r.db.WithContext(ctx).Where("code = ? AND is_active = ?", code, true).First(&creditPackage).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &creditPackage, err
}

func (r *Repository) UpsertCreditPackage(ctx context.Context, creditPackage *domain.CreditPackage) error {
	now := time.Now()
	creditPackage.UpdatedAt = &now
	if creditPackage.CreatedAt == nil {
		creditPackage.CreatedAt = &now
	}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "code"}},
		DoUpdates: clause.Assignments(map[string]any{
			"name": creditPackage.Name, "description": creditPackage.Description, "units": creditPackage.Units,
			"amount_fen": creditPackage.AmountFen, "is_active": creditPackage.IsActive, "sort_order": creditPackage.SortOrder, "updated_at": now,
		}),
	}).Create(creditPackage).Error
}

func (r *Repository) CreatePaymentOrder(ctx context.Context, order *domain.PaymentOrder) error {
	now := time.Now()
	if order.ID == "" {
		order.ID = uuid.NewString()
	}
	if order.Status == "" {
		order.Status = domain.PaymentOrderPending
	}
	if order.NotifyPayload == nil {
		order.NotifyPayload = map[string]any{}
	}
	order.CreatedAt = &now
	order.UpdatedAt = &now
	return r.db.WithContext(ctx).Create(order).Error
}

func (r *Repository) UpdatePaymentCodeURL(ctx context.Context, orderNo, codeURL string) error {
	return r.db.WithContext(ctx).Model(&domain.PaymentOrder{}).Where("order_no = ? AND status = ?", orderNo, domain.PaymentOrderPending).
		Updates(map[string]any{"code_url": codeURL, "updated_at": time.Now()}).Error
}

func (r *Repository) MarkPaymentFailed(ctx context.Context, orderNo, reason string) error {
	return r.db.WithContext(ctx).Model(&domain.PaymentOrder{}).Where("order_no = ? AND status = ?", orderNo, domain.PaymentOrderPending).
		Updates(map[string]any{"status": domain.PaymentOrderFailed, "notify_payload": datatypes.JSONMap{"failure_reason": reason}, "updated_at": time.Now()}).Error
}

func (r *Repository) GetOwnedPaymentOrder(ctx context.Context, ownerUserID, orderNo string) (*domain.PaymentOrder, error) {
	var order domain.PaymentOrder
	err := r.db.WithContext(ctx).Where("order_no = ? AND owner_user_id = ?", orderNo, ownerUserID).First(&order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &order, err
}

func (r *Repository) GetPaymentOrderByOrderNo(ctx context.Context, orderNo string) (*domain.PaymentOrder, error) {
	var order domain.PaymentOrder
	err := r.db.WithContext(ctx).Where("order_no = ?", orderNo).First(&order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &order, err
}

func (r *Repository) MarkPaymentPaidAndTopUp(ctx context.Context, orderNo, transactionID string, paidAt time.Time, payload map[string]any) (*domain.PaymentOrder, bool, error) {
	var result domain.PaymentOrder
	credited := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("order_no = ?", orderNo).First(&result).Error; err != nil {
			return err
		}
		if result.Status == domain.PaymentOrderPaid {
			return nil
		}
		if result.Status != domain.PaymentOrderPending {
			return fmt.Errorf("payment order is not pending")
		}
		var app domain.App
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", result.AppID).First(&app).Error; err != nil {
			return err
		}
		balance := app.BalanceUnits + result.Units
		now := time.Now()
		if err := tx.Model(&domain.App{}).Where("id = ?", app.ID).Updates(map[string]any{"balance_units": balance, "updated_at": now}).Error; err != nil {
			return err
		}
		ledger := domain.UsageLedger{
			ID: uuid.NewString(), AppID: app.ID, EntryType: "payment_top_up", DeltaUnits: result.Units,
			BalanceAfter: balance, ReferenceKey: "payment:" + result.OrderNo, Description: "微信支付充值 API 点数",
			Metadata: map[string]any{"order_no": result.OrderNo, "package_code": result.PackageCode, "amount_fen": result.AmountFen}, CreatedAt: &now,
		}
		if err := tx.Create(&ledger).Error; err != nil {
			return err
		}
		updates := map[string]any{"status": domain.PaymentOrderPaid, "wechat_transaction_id": transactionID, "paid_at": paidAt, "notify_payload": datatypes.JSONMap(payload), "updated_at": now}
		if err := tx.Model(&domain.PaymentOrder{}).Where("id = ?", result.ID).Updates(updates).Error; err != nil {
			return err
		}
		result.Status = domain.PaymentOrderPaid
		result.WechatTransactionID = &transactionID
		result.PaidAt = &paidAt
		credited = true
		return nil
	})
	return &result, credited, err
}
