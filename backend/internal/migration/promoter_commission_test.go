package migration

import (
	"context"
	"testing"

	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
)

func TestMigratePromoterCommissionIsIdempotentAndConstrainsRows(t *testing.T) {
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, MigratePromoterCommission(ctx, db, "public"))
	require.NoError(t, MigratePromoterCommission(ctx, db, "public"))

	const promoter = `11111111-1111-1111-1111-111111111111`
	const user = `22222222-2222-2222-2222-222222222222`
	require.NoError(t, db.Exec(`INSERT INTO promoters (id, user_id, promo_code) VALUES (?, ?, 'FL8K2QA')`, promoter, user).Error)
	require.Error(t, db.Exec(`INSERT INTO promoters (user_id, promo_code) VALUES (gen_random_uuid(), 'fl-lower')`).Error, "promo code format")
	require.Error(t, db.Exec(`INSERT INTO promoters (user_id, promo_code) VALUES (?, 'FL8K2QB')`, user).Error, "one promoter per user")

	invitee := `33333333-3333-3333-3333-333333333333`
	bind := `INSERT INTO promoter_bindings (invitee_user_id, promoter_id, promo_code) VALUES (?, ?, 'FL8K2QA')`
	require.NoError(t, db.Exec(bind, invitee, promoter).Error)
	require.Error(t, db.Exec(bind, invitee, promoter).Error, "a user is bound once")

	commission := `INSERT INTO promoter_commissions (promoter_id, binding_id, payment_id, invitee_user_id, pay_channel, order_amount_cents, rate_bps, commission_cents, paid_at, settle_at)
VALUES (?, gen_random_uuid(), ?, ?, 'wechat_mini_program', 1990, 2000, ?, now(), now() + interval '7 days')`
	payment := `44444444-4444-4444-4444-444444444444`
	require.NoError(t, db.Exec(commission, promoter, payment, invitee, 398).Error)
	require.Error(t, db.Exec(commission, promoter, payment, invitee, 398).Error, "one commission per order")
	require.Error(t, db.Exec(commission, promoter, `55555555-5555-5555-5555-555555555555`, invitee, 2000).Error, "commission above order amount")

	withdrawal := `INSERT INTO promoter_withdrawals (promoter_id, request_key, amount_cents, net_amount_cents, status) VALUES (?, ?, 1000, 1000, ?)`
	require.NoError(t, db.Exec(withdrawal, promoter, "req-1", "reviewing").Error)
	require.Error(t, db.Exec(withdrawal, promoter, "req-2", "reviewing").Error, "one withdrawal in flight")
	require.NoError(t, db.Exec(`UPDATE promoter_withdrawals SET status = 'succeeded' WHERE request_key = 'req-1'`).Error)
	require.NoError(t, db.Exec(withdrawal, promoter, "req-2", "reviewing").Error)
	require.Error(t, db.Exec(withdrawal, promoter, "req-2", "rejected").Error, "request key is idempotent")
	require.Error(t, db.Exec(`INSERT INTO promoter_withdrawals (promoter_id, request_key, amount_cents, tax_withheld_cents, net_amount_cents) VALUES (?, 'req-3', 1000, 100, 1000)`, promoter).Error, "net must equal amount minus tax")
}
