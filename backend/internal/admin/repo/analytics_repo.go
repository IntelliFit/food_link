package repo

import (
	"context"
	"food_link/backend/internal/admin/domain"
	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
	"time"
)

var AnalyticsTimezone = time.FixedZone("Asia/Shanghai", 8*60*60)

func AnalyticsDate(t time.Time) time.Time {
	t = t.In(AnalyticsTimezone)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, AnalyticsTimezone)
}

type AnalyticsRepo struct{ db *gorm.DB }

func NewAnalyticsRepo(db *gorm.DB) *AnalyticsRepo { return &AnalyticsRepo{db: db} }
func (r *AnalyticsRepo) StartedAt(ctx context.Context) (time.Time, error) {
	var row migrationdo.AnalyticsStateDO
	err := r.db.WithContext(ctx).First(&row, 1).Error
	return row.StartedAt, err
}
func (r *AnalyticsRepo) Record(ctx context.Context, userID string, at time.Time) error {
	return r.db.WithContext(ctx).Exec(`INSERT INTO admin_analytics_activity (day,user_id,created_at)
	SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM membership_payment_test_users WHERE user_id = ?)
	ON CONFLICT (day,user_id) DO NOTHING`, at.In(AnalyticsTimezone).Format("2006-01-02"), userID, at, userID).Error
}

// A refunded order is eligible before its refund, and never counted as net payment after it.
const eligiblePayment = `amount > 0 AND currency = 'CNY' AND paid_at IS NOT NULL
AND status IN ('paid','refunded') AND (refunded_at IS NULL OR refunded_at >= ?)
AND COALESCE(p.extra->>'xpay_env','0') <> '1'
AND NOT EXISTS (SELECT 1 FROM membership_payment_test_users t WHERE t.user_id = p.user_id)
AND NOT EXISTS (SELECT 1 FROM membership_plan_config pl WHERE pl.code = p.plan_code AND pl.is_test_plan = true)`

func (r *AnalyticsRepo) PayingUsers(ctx context.Context, start, end time.Time) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Table("pro_membership_payment_records p").Where(eligiblePayment, end).Where("paid_at >= ? AND paid_at < ?", start, end).Distinct("p.user_id").Count(&n).Error
	return n, err
}
func (r *AnalyticsRepo) ActivePaidMembers(ctx context.Context, at time.Time) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Raw(`SELECT count(DISTINCT m.user_id) FROM user_pro_memberships m
	WHERE m.status = 'active' AND m.expires_at > ? AND EXISTS (SELECT 1 FROM pro_membership_payment_records p WHERE p.user_id = m.user_id AND `+eligiblePayment+` AND p.paid_at <= ? AND p.paid_at >= m.current_period_start)`, at, at, at).Scan(&n).Error
	return n, err
}
func (r *AnalyticsRepo) ComputeDay(ctx context.Context, day, started, timeNow time.Time) (domain.AnalyticsDay, error) {
	day = AnalyticsDate(day)
	end := day.AddDate(0, 0, 1)
	if end.After(timeNow) {
		end = timeNow
	}
	row := domain.AnalyticsDay{Day: day.Format("2006-01-02"), UpdatedAt: timeNow}
	// The first collection day is partial. Historical unknowns are null, not zero.
	firstFull := AnalyticsDate(started).AddDate(0, 0, 1)
	if !day.Before(firstFull) || day.Equal(AnalyticsDate(timeNow)) {
		var n int64
		if err := r.db.WithContext(ctx).Table("admin_analytics_activity a").Where("day = ? AND NOT EXISTS (SELECT 1 FROM membership_payment_test_users t WHERE t.user_id = a.user_id)", row.Day).Count(&n).Error; err != nil {
			return row, err
		}
		row.DAU = &n
	}
	window := day.AddDate(0, 0, -29)
	if !window.Before(firstFull) {
		var n int64
		if err := r.db.WithContext(ctx).Table("admin_analytics_activity a").Where("day >= ? AND day <= ? AND NOT EXISTS (SELECT 1 FROM membership_payment_test_users t WHERE t.user_id = a.user_id)", window.Format("2006-01-02"), row.Day).Distinct("a.user_id").Count(&n).Error; err != nil {
			return row, err
		}
		row.MAU = &n
	}
	var err error
	row.PayingUsers, err = r.PayingUsers(ctx, day, end)
	return row, err
}
func (r *AnalyticsRepo) SaveDay(ctx context.Context, row domain.AnalyticsDay) error {
	return r.db.WithContext(ctx).Exec(`INSERT INTO admin_analytics_daily (day,dau,mau,paying_users,updated_at) VALUES (?,?,?,?,?)
	ON CONFLICT (day) DO UPDATE SET dau=excluded.dau,mau=excluded.mau,paying_users=excluded.paying_users,updated_at=excluded.updated_at`, row.Day, row.DAU, row.MAU, row.PayingUsers, row.UpdatedAt).Error
}
func (r *AnalyticsRepo) Days(ctx context.Context, start, end time.Time) ([]domain.AnalyticsDay, error) {
	rows := []domain.AnalyticsDay{}
	err := r.db.WithContext(ctx).Table("admin_analytics_daily").Select("to_char(day,'YYYY-MM-DD') AS day, dau, mau, paying_users, updated_at").Where("day >= ? AND day < ?", start.Format("2006-01-02"), end.Format("2006-01-02")).Order("day").Scan(&rows).Error
	return rows, err
}
