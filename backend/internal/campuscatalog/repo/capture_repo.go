package repo

import (
	"context"
	"errors"
	"strings"
	"time"

	"food_link/backend/internal/campuscatalog/domain"

	"gorm.io/gorm"
)

// ErrLedgerDuplicate means a ledger row with the same source key or the same
// paid window already exists.
var ErrLedgerDuplicate = errors.New("canteen collector ledger entry already exists")

func isCaptureUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "23505") || strings.Contains(msg, "duplicate") || strings.Contains(msg, "unique")
}

func stampTimes(created, updated *time.Time) (*time.Time, *time.Time) {
	now := time.Now()
	if created == nil {
		created = &now
	}
	if updated == nil {
		updated = created
	}
	return created, updated
}

func firstOrNil[T any](err error, value *T) (*T, error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return value, nil
}

// CreateCaptureSession inserts a session, or returns the existing one when the
// client retried with the same key.
func (r *CatalogRepo) CreateCaptureSession(ctx context.Context, session *domain.CaptureSession) (*domain.CaptureSession, error) {
	session.CreatedAt, session.UpdatedAt = stampTimes(session.CreatedAt, session.UpdatedAt)
	err := r.db.WithContext(ctx).Create(session).Error
	if err == nil {
		return session, nil
	}
	if !isCaptureUniqueViolation(err) {
		return nil, err
	}
	return r.FindCaptureSessionByClientKey(ctx, session.ClientSessionKey)
}

func (r *CatalogRepo) FindCaptureSessionByClientKey(ctx context.Context, key string) (*domain.CaptureSession, error) {
	var session domain.CaptureSession
	err := r.db.WithContext(ctx).Where("client_session_key = ?", key).First(&session).Error
	return firstOrNil(err, &session)
}

func (r *CatalogRepo) GetCaptureSession(ctx context.Context, id string) (*domain.CaptureSession, error) {
	var session domain.CaptureSession
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&session).Error
	return firstOrNil(err, &session)
}

func (r *CatalogRepo) ListCaptureSessionsByUser(ctx context.Context, userID string, limit, offset int) ([]domain.CaptureSession, int64, error) {
	query := r.db.WithContext(ctx).Model(&domain.CaptureSession{}).Where("user_id = ?", userID)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	sessions := []domain.CaptureSession{}
	err := query.Omit("extraction").Order("created_at DESC").Limit(limit).Offset(offset).Find(&sessions).Error
	return sessions, total, err
}

// UpdateCaptureSession applies updates only while the session is still in
// one of the expected states; it reports whether a row changed.
func (r *CatalogRepo) UpdateCaptureSession(ctx context.Context, id string, expectStatuses []string, updates map[string]any) (bool, error) {
	updates["updated_at"] = time.Now()
	query := r.db.WithContext(ctx).Model(&domain.CaptureSession{}).Where("id = ?", id)
	if len(expectStatuses) > 0 {
		query = query.Where("status IN ?", expectStatuses)
	}
	result := query.Updates(updates)
	return result.RowsAffected == 1, result.Error
}

func (r *CatalogRepo) ListPendingCaptureExceptions(ctx context.Context, limit int) ([]domain.CaptureSession, error) {
	sessions := []domain.CaptureSession{}
	err := r.db.WithContext(ctx).
		Where("status = ? AND exception_status = ?", domain.CaptureStatusSubmitted, domain.CaptureExceptionPending).
		Order("submitted_at ASC").Limit(limit).Find(&sessions).Error
	return sessions, err
}

// CapturedWindowSummary tells collectors which windows of a canteen already
// earned the window reward, so they can pick another one.
type CapturedWindowSummary struct {
	WindowKey  string     `json:"window_key"`
	Floor      string     `json:"floor"`
	WindowName string     `json:"window_name"`
	Rewarded   bool       `json:"rewarded"`
	LastAt     *time.Time `json:"last_at"`
	Sessions   int        `json:"sessions"`
}

func (r *CatalogRepo) ListCapturedWindows(ctx context.Context, canteenKeyPrefix string, limit int) ([]CapturedWindowSummary, error) {
	rows := []CapturedWindowSummary{}
	err := r.db.WithContext(ctx).Raw(`
SELECT s.window_key, MAX(s.floor) AS floor, MAX(s.window_name) AS window_name,
       MAX(s.submitted_at) AS last_at, COUNT(*) AS sessions,
       EXISTS (SELECT 1 FROM canteen_collector_ledger l
               WHERE l.window_key = s.window_key AND l.entry_type = 'window_reward'
                 AND l.status IN ('confirmed','rate_pending')) AS rewarded
FROM canteen_capture_sessions s
WHERE s.status = 'submitted' AND left(s.window_key, char_length(?)) = ?
GROUP BY s.window_key
ORDER BY MAX(s.submitted_at) DESC
LIMIT ?`, canteenKeyPrefix, canteenKeyPrefix, limit).Scan(&rows).Error
	return rows, err
}

// CreateCaptureAsset inserts a photo, or returns the existing row when the same
// content was already uploaded to this session.
func (r *CatalogRepo) CreateCaptureAsset(ctx context.Context, asset *domain.CaptureAsset) (*domain.CaptureAsset, bool, error) {
	asset.CreatedAt, asset.UpdatedAt = stampTimes(asset.CreatedAt, asset.UpdatedAt)
	err := r.db.WithContext(ctx).Create(asset).Error
	if err == nil {
		return asset, true, nil
	}
	if !isCaptureUniqueViolation(err) {
		return nil, false, err
	}
	var existing domain.CaptureAsset
	findErr := r.db.WithContext(ctx).
		Where("session_id = ? AND content_sha256 = ?", asset.SessionID, asset.ContentSHA256).
		First(&existing).Error
	if findErr != nil {
		return nil, false, findErr
	}
	if existing.Status != "active" || existing.Kind != asset.Kind || existing.ItemKey != asset.ItemKey || existing.DishName != asset.DishName {
		updates := map[string]any{"status": "active", "kind": asset.Kind, "item_key": asset.ItemKey, "dish_name": asset.DishName, "updated_at": time.Now()}
		if err := r.db.WithContext(ctx).Model(&existing).Updates(updates).Error; err != nil {
			return nil, false, err
		}
		existing.Status, existing.Kind, existing.ItemKey, existing.DishName = "active", asset.Kind, asset.ItemKey, asset.DishName
	}
	return &existing, false, nil
}

func (r *CatalogRepo) ListCaptureAssets(ctx context.Context, sessionID string) ([]domain.CaptureAsset, error) {
	assets := []domain.CaptureAsset{}
	err := r.db.WithContext(ctx).
		Where("session_id = ? AND status = ?", sessionID, "active").
		Order("created_at ASC").Find(&assets).Error
	return assets, err
}

func (r *CatalogRepo) UpdateCaptureAsset(ctx context.Context, sessionID, assetID string, updates map[string]any) (bool, error) {
	updates["updated_at"] = time.Now()
	result := r.db.WithContext(ctx).Model(&domain.CaptureAsset{}).
		Where("id = ? AND session_id = ?", assetID, sessionID).Updates(updates)
	return result.RowsAffected == 1, result.Error
}

// CountReusedCaptureHashes returns how many of the hashes were already
// submitted in another user's session or for another window.
func (r *CatalogRepo) CountReusedCaptureHashes(ctx context.Context, hashes []string, sessionID, userID, windowKey string) (int, error) {
	if len(hashes) == 0 {
		return 0, nil
	}
	var count int64
	err := r.db.WithContext(ctx).Raw(`
SELECT COUNT(DISTINCT a.content_sha256)
FROM canteen_capture_assets a
JOIN canteen_capture_sessions s ON s.id = a.session_id
WHERE a.content_sha256 IN ? AND a.session_id <> ? AND a.status = 'active'
  AND s.status = 'submitted' AND (s.user_id <> ? OR s.window_key <> ?)`,
		hashes, sessionID, userID, windowKey).Scan(&count).Error
	return int(count), err
}

// CreateLedgerEntry inserts an earning row. A repeated source key or a second
// reward for an already paid window yields ErrLedgerDuplicate.
func (r *CatalogRepo) CreateLedgerEntry(ctx context.Context, entry *domain.CollectorLedgerEntry) error {
	entry.CreatedAt, entry.UpdatedAt = stampTimes(entry.CreatedAt, entry.UpdatedAt)
	err := r.db.WithContext(ctx).Create(entry).Error
	if isCaptureUniqueViolation(err) {
		return ErrLedgerDuplicate
	}
	return err
}

func (r *CatalogRepo) FindLedgerBySourceKey(ctx context.Context, sourceKey string) (*domain.CollectorLedgerEntry, error) {
	var entry domain.CollectorLedgerEntry
	err := r.db.WithContext(ctx).Where("source_key = ?", sourceKey).First(&entry).Error
	return firstOrNil(err, &entry)
}

func (r *CatalogRepo) WindowRewardTaken(ctx context.Context, windowKey string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.CollectorLedgerEntry{}).
		Where("window_key = ? AND entry_type = ? AND status IN ?", windowKey, domain.LedgerWindowReward,
			[]string{domain.LedgerStatusConfirmed, domain.LedgerStatusRatePending}).
		Count(&count).Error
	return count > 0, err
}

// LedgerTotals summarises one collector's money in fen.
type LedgerTotals struct {
	Earned        int64 `json:"earned_cents"`
	Spent         int64 `json:"spent_cents"`
	Withdrawing   int64 `json:"withdrawing_cents"`
	Withdrawn     int64 `json:"withdrawn_cents"`
	Available     int64 `json:"available_cents"`
	RatePending   int   `json:"rate_pending_windows"`
	RewardWindows int   `json:"reward_windows"`
}

func ledgerTotalsQuery(db *gorm.DB, userID string) (*LedgerTotals, error) {
	type row struct {
		EntryType string
		Status    string
		Amount    int64
		Rows      int
	}
	rows := []row{}
	err := db.Raw(`SELECT entry_type, status, COALESCE(SUM(amount_cents),0) AS amount, COUNT(*) AS rows
FROM canteen_collector_ledger WHERE user_id = ? GROUP BY entry_type, status`, userID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	totals := &LedgerTotals{}
	for _, item := range rows {
		switch {
		case item.EntryType == domain.LedgerWindowReward && item.Status == domain.LedgerStatusConfirmed:
			totals.Earned += item.Amount
			totals.RewardWindows += item.Rows
		case item.EntryType == domain.LedgerWindowReward && item.Status == domain.LedgerStatusRatePending:
			totals.RatePending += item.Rows
			totals.RewardWindows += item.Rows
		case item.EntryType == domain.LedgerMembershipSpend && item.Status == domain.LedgerStatusConfirmed:
			totals.Spent += -item.Amount
		case item.EntryType == domain.LedgerWithdrawal && item.Status == domain.LedgerStatusRequested:
			totals.Withdrawing += -item.Amount
		case item.EntryType == domain.LedgerWithdrawal && item.Status == domain.LedgerStatusPaid:
			totals.Withdrawn += -item.Amount
		}
	}
	totals.Available = totals.Earned - totals.Spent - totals.Withdrawing - totals.Withdrawn
	return totals, nil
}

func (r *CatalogRepo) GetLedgerTotals(ctx context.Context, userID string) (*LedgerTotals, error) {
	return ledgerTotalsQuery(r.db.WithContext(ctx), userID)
}

// CreateLedgerSpend locks the collector's ledger, re-checks the balance and
// inserts the negative row in one transaction, so two taps cannot spend the
// same money twice.
func (r *CatalogRepo) CreateLedgerSpend(ctx context.Context, entry *domain.CollectorLedgerEntry, check func(*LedgerTotals) error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "canteen_ledger:"+entry.UserID).Error; err != nil {
			return err
		}
		var existing domain.CollectorLedgerEntry
		if err := tx.Where("source_key = ?", entry.SourceKey).First(&existing).Error; err == nil {
			*entry = existing
			return ErrLedgerDuplicate
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		totals, err := ledgerTotalsQuery(tx, entry.UserID)
		if err != nil {
			return err
		}
		if err := check(totals); err != nil {
			return err
		}
		entry.CreatedAt, entry.UpdatedAt = stampTimes(entry.CreatedAt, entry.UpdatedAt)
		return tx.Create(entry).Error
	})
}

func (r *CatalogRepo) UpdateLedgerStatus(ctx context.Context, id string, fromStatuses []string, toStatus, note string, extraUpdates map[string]any) (bool, error) {
	updates := map[string]any{"status": toStatus, "updated_at": time.Now()}
	if note != "" {
		updates["review_note"] = note
	}
	for key, value := range extraUpdates {
		updates[key] = value
	}
	result := r.db.WithContext(ctx).Model(&domain.CollectorLedgerEntry{}).
		Where("id = ? AND status IN ?", id, fromStatuses).Updates(updates)
	return result.RowsAffected == 1, result.Error
}

func (r *CatalogRepo) ListLedgerByUser(ctx context.Context, userID string, limit int) ([]domain.CollectorLedgerEntry, error) {
	entries := []domain.CollectorLedgerEntry{}
	err := r.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at DESC").Limit(limit).Find(&entries).Error
	return entries, err
}

func (r *CatalogRepo) ListLedgerByTypeStatus(ctx context.Context, entryType, status string, limit int) ([]domain.CollectorLedgerEntry, error) {
	entries := []domain.CollectorLedgerEntry{}
	err := r.db.WithContext(ctx).Where("entry_type = ? AND status = ?", entryType, status).
		Order("created_at ASC").Limit(limit).Find(&entries).Error
	return entries, err
}

// ReleaseRatePendingRewards prices window rewards earned before the amounts
// were published. The status predicate makes a re-run harmless.
func (r *CatalogRepo) ReleaseRatePendingRewards(ctx context.Context, amountFor func(meta map[string]any) int64, limit int) (int, error) {
	entries, err := r.ListLedgerByTypeStatus(ctx, domain.LedgerWindowReward, domain.LedgerStatusRatePending, limit)
	if err != nil {
		return 0, err
	}
	updated := 0
	for _, entry := range entries {
		amount := amountFor(entry.Meta)
		if amount <= 0 {
			continue
		}
		result := r.db.WithContext(ctx).Model(&domain.CollectorLedgerEntry{}).
			Where("id = ? AND status = ?", entry.ID, domain.LedgerStatusRatePending).
			Updates(map[string]any{"status": domain.LedgerStatusConfirmed, "amount_cents": amount, "updated_at": time.Now()})
		if result.Error != nil {
			return updated, result.Error
		}
		updated += int(result.RowsAffected)
	}
	return updated, nil
}
