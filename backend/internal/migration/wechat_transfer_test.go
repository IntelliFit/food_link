package migration

import (
	"context"
	"strings"
	"testing"

	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
)

func TestMigrateWechatTransferIsIdempotentAndConstrainsRows(t *testing.T) {
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, MigrateWechatTransfer(ctx, db, "public"))
	require.NoError(t, MigrateWechatTransfer(ctx, db, "public"))

	insert := `INSERT INTO wechat_transfer_bills (biz_type, biz_id, out_bill_no, mch_id, appid, openid, transfer_scene_id,
  transfer_amount_cents, transfer_remark, report_infos, state)
VALUES (?, ?, ?, '1105991965', 'wx0000000000000000', 'o-openid', '1005', ?, ?, '[{"info_type":"岗位类型","info_content":"推广员"}]', ?)`
	const withdrawal = `11111111-1111-1111-1111-111111111111`
	require.NoError(t, db.Exec(insert, "promoter_withdrawal", withdrawal, "PW20261027AB12CD34", 2000, "食探推广佣金", "CREATED").Error)

	var state string
	require.NoError(t, db.Raw(`SELECT state FROM wechat_transfer_bills WHERE biz_id = ?`, withdrawal).Scan(&state).Error)
	require.Equal(t, "CREATED", state)

	other := `22222222-2222-2222-2222-222222222222`
	require.Error(t, db.Exec(insert, "promoter_withdrawal", withdrawal, "PW20261027ZZ", 2000, "食探推广佣金", "CREATED").Error, "one bill per withdrawal")
	require.Error(t, db.Exec(insert, "promoter_withdrawal", other, "PW20261027AB12CD34", 2000, "食探推广佣金", "CREATED").Error, "out_bill_no is unique")
	require.Error(t, db.Exec(insert, "promoter_withdrawal", other, "PW-2026", 2000, "食探推广佣金", "CREATED").Error, "out_bill_no is alphanumeric")
	require.Error(t, db.Exec(insert, "promoter_withdrawal", other, strings.Repeat("A", 33), 2000, "食探推广佣金", "CREATED").Error, "out_bill_no is at most 32 characters")
	require.Error(t, db.Exec(insert, "promoter_withdrawal", other, "PW2", 0, "食探推广佣金", "CREATED").Error, "amount is positive")
	require.Error(t, db.Exec(insert, "promoter_withdrawal", other, "PW3", 2000, strings.Repeat("佣", 33), "CREATED").Error, "remark is at most 32 characters")
	require.Error(t, db.Exec(insert, "promoter_withdrawal", other, "PW4", 2000, "食探推广佣金", "DONE").Error, "state is a WeChat state")
	require.Error(t, db.Exec(insert, "unknown", other, "PW5", 2000, "食探推广佣金", "CREATED").Error, "known business types only")
	require.NoError(t, db.Exec(insert, "canteen_collector_withdrawal", withdrawal, "CW20261027AB12CD34", 2000, "食堂采集收益", "WAIT_USER_CONFIRM").Error, "the same id under another business is fine")
}
